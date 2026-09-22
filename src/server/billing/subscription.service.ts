/**
 * Subscriptions and entitlements (B2B, one subscription per organization).
 *
 * `assertSubscriptionOperational` is the single gate every billable write goes
 * through. It lives in the server layer (not in Edge middleware) on purpose:
 * the decision needs the database, and Edge middleware cannot query PostgreSQL.
 */
import "server-only";
import type { Plan, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { getPlanByCode } from "./plan.service";

export type SubscriptionWithPlan = Subscription & { plan: Plan };

export interface BillingUsage {
  branches: number;
  queues: number;
  staff: number;
}

/** A subscription lets the organization operate while trialing or paid up. */
export function isSubscriptionOperational(
  subscription: Pick<Subscription, "status" | "currentPeriodEnd"> | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  if (subscription.status !== "TRIALING" && subscription.status !== "ACTIVE") {
    return false;
  }
  return subscription.currentPeriodEnd.getTime() > now.getTime();
}

export async function getSubscription(
  organizationId: string,
): Promise<SubscriptionWithPlan | null> {
  return db.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
}

export async function getUsage(organizationId: string): Promise<BillingUsage> {
  const [branches, queues, staff] = await db.$transaction([
    db.branch.count({ where: { organizationId } }),
    db.queue.count({ where: { organizationId } }),
    db.organizationMember.count({
      where: { organizationId, status: "ACTIVE" },
    }),
  ]);
  return { branches, queues, staff };
}

export interface BillingOverview {
  subscription: SubscriptionWithPlan | null;
  usage: BillingUsage;
  limits: {
    maxBranches: number;
    maxQueuesPerBranch: number;
    maxStaff: number;
  } | null;
  operational: boolean;
  daysRemaining: number | null;
}

export async function getBillingOverview(
  organizationId: string,
): Promise<BillingOverview> {
  const [subscription, usage] = await Promise.all([
    getSubscription(organizationId),
    getUsage(organizationId),
  ]);

  const operational = isSubscriptionOperational(subscription);
  const daysRemaining = subscription
    ? Math.max(
        0,
        Math.ceil(
          (subscription.currentPeriodEnd.getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  return {
    subscription,
    usage,
    limits: subscription
      ? {
          maxBranches: subscription.plan.maxBranches,
          maxQueuesPerBranch: subscription.plan.maxQueuesPerBranch,
          maxStaff: subscription.plan.maxStaff,
        }
      : null,
    operational,
    daysRemaining,
  };
}

/**
 * Throws `PAYMENT_REQUIRED` (402) unless the organization has a usable
 * subscription. Used by every billable write.
 */
export async function assertSubscriptionOperational(
  organizationId: string,
): Promise<SubscriptionWithPlan> {
  const subscription = await getSubscription(organizationId);

  if (!subscription) {
    throw AppError.paymentRequired(
      "This organization has no subscription. Start one to create branches and queues.",
      { reason: "NO_SUBSCRIPTION" },
    );
  }

  if (!isSubscriptionOperational(subscription)) {
    throw AppError.paymentRequired(
      "The subscription is expired or unpaid. Renew it to continue.",
      {
        reason: subscription.status === "PAST_DUE" ? "PAST_DUE" : "EXPIRED",
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      },
    );
  }

  return subscription;
}

/**
 * Grants the configured trial to a newly created organization. Returns null when
 * no trial plan exists (the organization is then blocked until one is assigned).
 */
export async function attachTrialSubscription(
  organizationId: string,
): Promise<Subscription | null> {
  const env = getEnv();
  const plan = await getPlanByCode(env.TRIAL_PLAN_CODE);
  if (!plan) return null;

  const now = new Date();
  const end = new Date(now.getTime() + env.TRIAL_DAYS * 86_400_000);

  return db.subscription.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      planId: plan.id,
      status: "TRIALING",
      currentPeriodStart: now,
      currentPeriodEnd: end,
    },
  });
}
