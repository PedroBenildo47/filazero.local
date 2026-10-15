/**
 * End-customer (B2C) subscription.
 *
 * Every customer gets **1 month free** on registration; after that, continued
 * use is gated on the **2.000 Kz/month** plan. Payment goes through the same
 * Angolan methods as the B2B checkout (Multicaixa Express, bank transfer and
 * EMVCo QR), and the subscription is only activated by the signature-verified
 * webhook — never by the client.
 */
import "server-only";
import type {
  CustomerPayment,
  CustomerSubscription,
  PaymentMethod as PaymentMethodName,
} from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import type { AuthContext } from "@/server/context";
import {
  addInterval,
  type NormalizedPaymentEvent,
} from "@/server/billing/billing.rules";
import {
  createCheckoutSession,
  generatePaymentReference,
} from "@/server/billing/payment-provider";
import { providerForMethod } from "@/server/billing/payment-methods";

/** The single end-customer plan: 2.000 Kz / month. */
export const CUSTOMER_PLAN = {
  name: "FilaZero Cliente",
  priceCents: 200_000,
  currency: "AOA",
  interval: "MONTHLY" as const,
};

/** Free trial granted to every new customer account. */
export const CUSTOMER_TRIAL_DAYS = 30;

export interface CustomerPaymentView {
  id: string;
  status: string;
  method: string;
  provider: string;
  amountCents: number;
  currency: string;
  reference: string;
  providerReference: string | null;
  proofSubmittedAt: Date | null;
  paidAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}

export function serializeCustomerPayment(payment: CustomerPayment): CustomerPaymentView {
  return {
    id: payment.id,
    status: payment.status,
    method: payment.method,
    provider: payment.provider,
    amountCents: payment.amountCents,
    currency: payment.currency,
    reference: payment.reference,
    providerReference: payment.providerReference,
    proofSubmittedAt: payment.proofSubmittedAt,
    paidAt: payment.paidAt,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt,
  };
}

export function isCustomerOperational(
  subscription: Pick<CustomerSubscription, "status" | "currentPeriodEnd"> | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  if (subscription.status !== "TRIALING" && subscription.status !== "ACTIVE") return false;
  return subscription.currentPeriodEnd.getTime() > now.getTime();
}

/** Grants the 1-month trial to a newly registered customer. */
export async function attachCustomerTrial(userId: string): Promise<CustomerSubscription> {
  const now = new Date();
  return db.customerSubscription.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      status: "TRIALING",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + CUSTOMER_TRIAL_DAYS * 86_400_000),
    },
  });
}

/** Throws 402 unless the customer can use the platform (trial or paid). */
export async function assertCustomerOperational(userId: string): Promise<CustomerSubscription> {
  const subscription = await db.customerSubscription.findUnique({ where: { userId } });
  if (!subscription) {
    throw AppError.paymentRequired(
      "This account has no subscription. Start the free month to continue.",
      { reason: "NO_SUBSCRIPTION" },
    );
  }
  if (!isCustomerOperational(subscription)) {
    throw AppError.paymentRequired(
      "Your free month ended. Subscribe for 2.000 Kz/month to keep using FilaZero.",
      {
        reason: subscription.status === "PAST_DUE" ? "PAST_DUE" : "EXPIRED",
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      },
    );
  }
  return subscription;
}

export async function getCustomerBilling(ctx: AuthContext) {
  const subscription = await db.customerSubscription.findUnique({
    where: { userId: ctx.user.id },
  });
  const payments = await db.customerPayment.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const operational = isCustomerOperational(subscription);
  const daysRemaining = subscription
    ? Math.max(
        0,
        Math.ceil((subscription.currentPeriodEnd.getTime() - Date.now()) / 86_400_000),
      )
    : null;

  return {
    plan: CUSTOMER_PLAN,
    trialDays: CUSTOMER_TRIAL_DAYS,
    operational,
    daysRemaining,
    effectiveStatus: subscription
      ? operational
        ? subscription.status
        : ("EXPIRED" as const)
      : null,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
        }
      : null,
    payments: payments.map(serializeCustomerPayment),
  };
}

export interface CustomerCheckoutResult {
  payment: CustomerPaymentView;
  checkoutUrl: string | null;
  instructions: string | null;
  qrPayload: string | null;
  reference: string;
}

export async function startCustomerCheckout(
  ctx: AuthContext,
  method: PaymentMethodName,
  meta: RequestMeta,
): Promise<CustomerCheckoutResult> {
  const subscription = await db.customerSubscription.findUnique({
    where: { userId: ctx.user.id },
  });
  const reference = generatePaymentReference();
  const provider = providerForMethod(method);

  let payment = await db.customerPayment.create({
    data: {
      userId: ctx.user.id,
      subscriptionId: subscription?.id ?? null,
      provider,
      method,
      status: "PENDING",
      amountCents: CUSTOMER_PLAN.priceCents,
      currency: CUSTOMER_PLAN.currency,
      reference,
    },
  });

  let session;
  try {
    session = await createCheckoutSession(
      { reference, amountCents: payment.amountCents, currency: payment.currency },
      CUSTOMER_PLAN,
      method,
    );
  } catch (error) {
    await db.customerPayment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failureReason:
          error instanceof Error ? error.message.slice(0, 300) : "provider_error",
      },
    });
    throw error;
  }

  payment = await db.customerPayment.update({
    where: { id: payment.id },
    data: {
      providerReference: session.providerReference,
      metadata:
        session.instructions || session.qrPayload
          ? {
              ...(session.instructions ? { instructions: session.instructions } : {}),
              ...(session.qrPayload ? { qrPayload: session.qrPayload } : {}),
            }
          : undefined,
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "customer.checkout_started",
    entityType: "customer_payment",
    entityId: payment.id,
    metadata: { reference, method, provider },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    payment: serializeCustomerPayment(payment),
    checkoutUrl: session.checkoutUrl,
    instructions: session.instructions,
    qrPayload: session.qrPayload,
    reference,
  };
}

/** True when the reference belongs to an end-customer payment. */
export async function isCustomerPaymentReference(reference: string): Promise<boolean> {
  const found = await db.customerPayment.findUnique({
    where: { reference },
    select: { id: true },
  });
  return found !== null;
}

export interface CustomerWebhookOutcome {
  duplicate: boolean;
  payment: CustomerPaymentView;
}

/** Applies a webhook event to a customer payment and activates the subscription. */
export async function applyCustomerPaymentEvent(
  event: NormalizedPaymentEvent,
  meta: RequestMeta,
): Promise<CustomerWebhookOutcome> {
  return db.$transaction(async (tx) => {
    const payment = await tx.customerPayment.findUnique({
      where: { reference: event.reference },
    });
    if (!payment) throw AppError.notFound("Unknown customer payment reference");

    if (payment.providerEventId === event.eventId || payment.status === "SUCCEEDED") {
      return { duplicate: true, payment: serializeCustomerPayment(payment) };
    }

    if (event.outcome === "failed") {
      const failed = await tx.customerPayment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          providerEventId: event.eventId,
          providerReference: event.providerReference,
          failureReason: "reported_failed_by_provider",
        },
      });
      return { duplicate: false, payment: serializeCustomerPayment(failed) };
    }

    const claimed = await tx.customerPayment.updateMany({
      where: { id: payment.id, status: { in: ["PENDING", "UNDER_REVIEW"] } },
      data: {
        status: "SUCCEEDED",
        providerEventId: event.eventId,
        providerReference: event.providerReference,
        paidAt: event.paidAt,
      },
    });
    if (claimed.count === 0) {
      return { duplicate: true, payment: serializeCustomerPayment(payment) };
    }

    const existing = await tx.customerSubscription.findUnique({
      where: { userId: payment.userId },
    });
    const now = new Date();
    const stillValid =
      existing !== null && existing.currentPeriodEnd.getTime() > now.getTime();
    const periodStart = stillValid ? existing.currentPeriodStart : now;
    const periodEnd = addInterval(stillValid ? existing.currentPeriodEnd : now, "MONTHLY");

    const subscription = await tx.customerSubscription.upsert({
      where: { userId: payment.userId },
      create: {
        userId: payment.userId,
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      update: {
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
    });

    const paid = await tx.customerPayment.update({
      where: { id: payment.id },
      data: { subscriptionId: subscription.id },
    });

    await recordAudit(tx, {
      action: "customer.payment_confirmed",
      entityType: "customer_payment",
      entityId: paid.id,
      metadata: {
        reference: event.reference,
        userId: payment.userId,
        periodEnd: periodEnd.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { duplicate: false, payment: serializeCustomerPayment(paid) };
  });
}
