/**
 * Billing service: checkout, webhook application and plan assignment.
 *
 * Hard rule: **only the signature-verified webhook can mark a transaction as
 * SUCCEEDED.** There is no admin shortcut to "confirm" a payment, so a
 * transaction row always reflects something that really happened at the
 * provider.
 *
 * Applying a webhook is a single database transaction: claim the pending
 * transaction (conditional update), extend the subscription period and write
 * the audit entry either all succeed or none do. Replays are idempotent through
 * the unique `provider_event_id`.
 */
import "server-only";
import type {
  PaymentProvider as PaymentProviderName,
  Transaction,
} from "@prisma/client";
import {
  addInterval,
  normalizePaymentEvent,
  type NormalizedPaymentEvent,
} from "./billing.rules";
import { db, isUniqueConstraintError } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/server/context";
import {
  createCheckoutSession,
  generatePaymentReference,
  webhookSecretFor,
} from "./payment-provider";
import { verifySignature } from "./signature";
import { getSubscription } from "./subscription.service";

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

export function serializeTransaction(transaction: Transaction) {
  return {
    id: transaction.id,
    organizationId: transaction.organizationId,
    planId: transaction.planId,
    provider: transaction.provider,
    status: transaction.status,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    reference: transaction.reference,
    providerReference: transaction.providerReference,
    paidAt: transaction.paidAt,
    failureReason: transaction.failureReason,
    createdAt: transaction.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Pure rules (period arithmetic + event normalisation)                        */
/* -------------------------------------------------------------------------- */

export { addInterval, normalizePaymentEvent };
export type { NormalizedPaymentEvent };

/* -------------------------------------------------------------------------- */
/* Checkout                                                                    */
/* -------------------------------------------------------------------------- */

export interface CheckoutResult {
  transaction: ReturnType<typeof serializeTransaction>;
  checkoutUrl: string | null;
  instructions: string | null;
  reference: string;
}

export async function startCheckout(
  ctx: AuthContext,
  organizationId: string,
  planId: string,
  meta: RequestMeta,
): Promise<CheckoutResult> {
  requirePermission(ctx, "billing:manage");
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const plan = await db.plan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw AppError.notFound("Plan not found");
  if (plan.priceCents <= 0) {
    throw AppError.badRequest(
      "This plan is free; no checkout is required (assign it instead).",
    );
  }

  const subscription = await getSubscription(organizationId);
  const reference = generatePaymentReference();
  const provider: PaymentProviderName =
    getEnv().PAYMENT_PROVIDER === "stripe" ? "STRIPE" : "INVOICE";

  // A real payable record first: the reference exists even if the provider call
  // fails, and a failure is recorded rather than hidden.
  let transaction = await db.transaction.create({
    data: {
      organizationId,
      subscriptionId: subscription?.id ?? null,
      planId: plan.id,
      provider,
      status: "PENDING",
      amountCents: plan.priceCents,
      currency: plan.currency,
      reference,
    },
  });

  let session;
  try {
    session = await createCheckoutSession(transaction, plan);
  } catch (error) {
    await db.transaction.update({
      where: { id: transaction.id },
      data: {
        status: "FAILED",
        failureReason:
          error instanceof Error ? error.message.slice(0, 300) : "provider_error",
      },
    });
    throw error;
  }

  transaction = await db.transaction.update({
    where: { id: transaction.id },
    data: {
      providerReference: session.providerReference,
      metadata: session.instructions ? { instructions: session.instructions } : undefined,
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "billing.checkout_started",
    entityType: "transaction",
    entityId: transaction.id,
    metadata: { organizationId, plan: plan.code, reference, provider },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    transaction: serializeTransaction(transaction),
    checkoutUrl: session.checkoutUrl,
    instructions: session.instructions,
    reference,
  };
}

export async function listTransactions(
  ctx: AuthContext,
  organizationId: string,
  pagination: Pagination,
) {
  requirePermission(ctx, "billing:read");
  assertOrganizationAccess(ctx, organizationId);

  const { skip, take } = paginationToSkipTake(pagination);
  const [items, total] = await db.$transaction([
    db.transaction.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.transaction.count({ where: { organizationId } }),
  ]);

  return {
    items: items.map(serializeTransaction),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

/* -------------------------------------------------------------------------- */
/* Plan assignment (commercial, not a payment)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Platform administrator assigns a plan directly (signed B2B contract, pilot,
 * goodwill period). This does **not** create or mark any transaction: it only
 * sets the entitlement, and it is audit-logged.
 */
export async function assignPlan(
  ctx: AuthContext,
  organizationId: string,
  planId: string,
  meta: RequestMeta,
) {
  requirePermission(ctx, "organization:manage");

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  const plan = await db.plan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw AppError.notFound("Plan not found");

  const now = new Date();
  const end = addInterval(now, plan.interval);

  const subscription = await db.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: end,
    },
    update: {
      planId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "billing.plan_assigned",
    entityType: "subscription",
    entityId: subscription.id,
    metadata: { organizationId, plan: plan.code },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return subscription;
}

/* -------------------------------------------------------------------------- */
/* Webhook                                                                     */
/* -------------------------------------------------------------------------- */

export interface WebhookOutcome {
  duplicate: boolean;
  transaction: ReturnType<typeof serializeTransaction>;
}

/** Applies a normalised event atomically and idempotently. */
export async function applyPaymentEvent(
  event: NormalizedPaymentEvent,
  meta: RequestMeta,
): Promise<WebhookOutcome> {
  const result = await db.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { reference: event.reference },
    });
    if (!transaction) {
      throw AppError.notFound("Unknown payment reference");
    }

    // Already applied (same event replayed, or a different event for a
    // transaction that is already paid): acknowledge without side effects.
    if (
      transaction.providerEventId === event.eventId ||
      transaction.status === "SUCCEEDED"
    ) {
      return { duplicate: true as const, transaction };
    }

    if (event.outcome === "failed") {
      const failed = await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "FAILED",
          providerEventId: event.eventId,
          providerReference: event.providerReference,
          failureReason: "reported_failed_by_provider",
        },
      });
      await recordAudit(tx, {
        action: "billing.payment_failed",
        entityType: "transaction",
        entityId: failed.id,
        metadata: { reference: event.reference, provider: event.provider },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { duplicate: false as const, transaction: failed };
    }

    // Conditional claim: only one concurrent webhook can move PENDING -> SUCCEEDED.
    const claimed = await tx.transaction.updateMany({
      where: { id: transaction.id, status: "PENDING" },
      data: {
        status: "SUCCEEDED",
        providerEventId: event.eventId,
        providerReference: event.providerReference,
        paidAt: event.paidAt,
      },
    });
    if (claimed.count === 0) {
      return { duplicate: true as const, transaction };
    }

    const plan = await tx.plan.findUnique({ where: { id: transaction.planId } });
    if (!plan) throw AppError.notFound("Plan not found");

    const existing = await tx.subscription.findUnique({
      where: { organizationId: transaction.organizationId },
    });
    const now = new Date();
    const stillValid =
      existing !== null && existing.currentPeriodEnd.getTime() > now.getTime();
    const periodStart = stillValid ? existing.currentPeriodStart : now;
    const periodEnd = addInterval(stillValid ? existing.currentPeriodEnd : now, plan.interval);

    const subscription = await tx.subscription.upsert({
      where: { organizationId: transaction.organizationId },
      create: {
        organizationId: transaction.organizationId,
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      update: {
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
    });

    const paid = await tx.transaction.update({
      where: { id: transaction.id },
      data: { subscriptionId: subscription.id },
    });

    await recordAudit(tx, {
      action: "billing.payment_confirmed",
      entityType: "transaction",
      entityId: paid.id,
      metadata: {
        reference: event.reference,
        provider: event.provider,
        plan: plan.code,
        organizationId: transaction.organizationId,
        periodEnd: periodEnd.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { duplicate: false as const, transaction: paid };
  });

  return {
    duplicate: result.duplicate,
    transaction: serializeTransaction(result.transaction),
  };
}

/**
 * Verifies the signature and then applies the event. The raw body is what gets
 * signed, so it must be read as text by the route.
 */
export async function handlePaymentWebhook(
  rawBody: string,
  signatureHeader: string | null,
  meta: RequestMeta,
): Promise<WebhookOutcome> {
  const event = normalizePaymentEvent(rawBody);
  const secret = webhookSecretFor(event.provider);

  if (!secret) {
    throw AppError.serviceUnavailable(
      "Payment webhooks are disabled: no PAYMENT_WEBHOOK_SECRET configured.",
    );
  }

  const verification = verifySignature({
    secret,
    header: signatureHeader,
    payload: rawBody,
    toleranceSeconds: getEnv().PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
  });

  if (!verification.ok) {
    const reasons: Record<string, string> = {
      missing: "Missing signature header",
      malformed: "Malformed signature header",
      expired: "Signature timestamp outside the tolerance window",
      mismatch: "Signature does not match the payload",
    };
    const message = reasons[verification.reason ?? "mismatch"] ?? "Signature rejected";
    if (verification.reason === "expired") {
      throw AppError.badRequest(message);
    }
    throw AppError.unauthenticated(message);
  }

  try {
    return await applyPaymentEvent(event, meta);
  } catch (error) {
    // A concurrent duplicate could hit the unique provider_event_id: that is a
    // success from the provider's point of view, not an error.
    if (isUniqueConstraintError(error)) {
      const existing = await db.transaction.findUnique({
        where: { reference: event.reference },
      });
      if (existing) {
        return { duplicate: true, transaction: serializeTransaction(existing) };
      }
    }
    throw error;
  }
}
