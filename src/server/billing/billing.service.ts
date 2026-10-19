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
  PaymentMethod as PaymentMethodName,
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
  type BankDetails,
  generatePaymentReference,
  webhookSecretFor,
} from "./payment-provider";
import { providerForMethod } from "./payment-methods";
import {
  createCardPaymentIntent,
  isCardPaymentsConfigured,
  stripePublishableKey,
} from "./stripe.service";
import {
  buildInvoiceCanonical,
  invoiceQrPayload,
  previousHashOf,
  vatBreakdown,
} from "./agt";
import {
  allocateInvoiceNumber,
  previousInvoiceHash,
} from "./invoice-series.service";
import { signInvoice } from "./invoice-signing";
import { deliverPaymentReceipt } from "./receipt.service";
import { verifySignature } from "./signature";
import { getSubscription } from "./subscription.service";
import {
  applyCustomerPaymentEvent,
  isCustomerPaymentReference,
  type CustomerPaymentView,
} from "@/server/customer/customer-subscription.service";

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

export function serializeTransaction(transaction: Transaction) {
  return {
    id: transaction.id,
    organizationId: transaction.organizationId,
    planId: transaction.planId,
    provider: transaction.provider,
    method: transaction.method,
    status: transaction.status,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    reference: transaction.reference,
    invoiceNumber: transaction.invoiceNumber,
    providerReference: transaction.providerReference,
    paidAt: transaction.paidAt,
    proofSubmittedAt: transaction.proofSubmittedAt,
    receiptSentAt: transaction.receiptSentAt,
    seriesCode: transaction.seriesCode,
    sequence: transaction.sequence,
    subtotalCents: transaction.subtotalCents,
    vatCents: transaction.vatCents,
    vatRateBps: transaction.vatRateBps,
    customerTaxId: transaction.customerTaxId,
    issuerTaxId: transaction.issuerTaxId,
    invoiceHash: transaction.invoiceHash,
    invoiceQr: transaction.invoiceQr,
    invoiceIssuedAt: transaction.invoiceIssuedAt,
    agtCertified: transaction.agtCertified,
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
  /** EMVCo bank QR payload the payer scans; only for QR_CODE. */
  qrPayload: string | null;
  /** Structured platform bank account; null for card / hosted checkout. */
  bankDetails: BankDetails | null;
  reference: string;
}

export async function startCheckout(
  ctx: AuthContext,
  organizationId: string,
  planId: string,
  method: PaymentMethodName,
  taxId: string | null | undefined,
  payerPhone: string | null | undefined,
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
  const provider: PaymentProviderName = providerForMethod(method);

  // A real payable record first: the reference exists even if the provider call
  // fails, and a failure is recorded rather than hidden.
  let transaction = await db.transaction.create({
    data: {
      organizationId,
      subscriptionId: subscription?.id ?? null,
      planId: plan.id,
      provider,
      method,
      status: "PENDING",
      amountCents: plan.priceCents,
      currency: plan.currency,
      reference,
      customerTaxId: taxId && taxId.length > 0 ? taxId : null,
      metadata: payerPhone ? { payerPhone } : undefined,
    },
  });

  let session;
  try {
    session = await createCheckoutSession(transaction, plan, method, payerPhone);
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
      metadata:
        session.instructions || session.qrPayload || payerPhone
          ? {
              ...(payerPhone ? { payerPhone } : {}),
              ...(session.instructions ? { instructions: session.instructions } : {}),
              ...(session.qrPayload ? { qrPayload: session.qrPayload } : {}),
            }
          : undefined,
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "billing.checkout_started",
    entityType: "transaction",
    entityId: transaction.id,
    metadata: { organizationId, plan: plan.code, reference, provider, method },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    transaction: serializeTransaction(transaction),
    checkoutUrl: session.checkoutUrl,
    instructions: session.instructions,
    qrPayload: session.qrPayload,
    bankDetails: session.bankDetails,
    reference,
  };
}

export interface CardIntentResult {
  clientSecret: string;
  publishableKey: string;
  reference: string;
  transactionId: string;
}

/**
 * Starts an embedded Stripe card payment for an organization's plan.
 *
 * Creates the PENDING transaction first (so the reference exists even if Stripe
 * refuses), then a real PaymentIntent. The card is confirmed in the browser with
 * Stripe Elements; only the signed webhook can move the transaction to
 * SUCCEEDED.
 */
export async function startCardIntent(
  ctx: AuthContext,
  organizationId: string,
  planId: string,
  taxId: string | null | undefined,
  meta: RequestMeta,
): Promise<CardIntentResult> {
  requirePermission(ctx, "billing:manage");
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  if (!isCardPaymentsConfigured()) {
    throw AppError.serviceUnavailable(
      "Card payments are not configured on this server.",
      { provider: "stripe", code: "CARD_NOT_CONFIGURED" },
    );
  }

  const plan = await db.plan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw AppError.notFound("Plan not found");
  if (plan.priceCents <= 0) {
    throw AppError.badRequest("This plan is free; no checkout is required.");
  }

  const subscription = await getSubscription(organizationId);
  const reference = generatePaymentReference();

  let transaction = await db.transaction.create({
    data: {
      organizationId,
      subscriptionId: subscription?.id ?? null,
      planId: plan.id,
      provider: "STRIPE",
      method: "CARD",
      status: "PENDING",
      amountCents: plan.priceCents,
      currency: plan.currency,
      reference,
      customerTaxId: taxId && taxId.length > 0 ? taxId : null,
    },
  });

  try {
    const intent = await createCardPaymentIntent({
      amountCents: plan.priceCents,
      currency: plan.currency,
      reference,
      description: `Subscrição FilaZero — ${plan.name}`,
      metadata: { organizationId, transactionId: transaction.id, plan: plan.code },
      customerEmail: ctx.user.email,
    });

    transaction = await db.transaction.update({
      where: { id: transaction.id },
      data: { providerReference: intent.id, metadata: { reference } },
    });

    await recordAudit(db, {
      actorUserId: ctx.user.id,
      action: "billing.card_intent_started",
      entityType: "transaction",
      entityId: transaction.id,
      metadata: { organizationId, plan: plan.code, reference },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      clientSecret: intent.clientSecret,
      publishableKey: stripePublishableKey(),
      reference,
      transactionId: transaction.id,
    };
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

export interface OrganizationWebhookOutcome {
  duplicate: boolean;
  transaction: ReturnType<typeof serializeTransaction>;
}

/** The webhook serves both the B2B (organization) and B2C (customer) surfaces. */
export type WebhookOutcome =
  | (OrganizationWebhookOutcome & { scope: "organization" })
  | { duplicate: boolean; scope: "customer"; payment: CustomerPaymentView };

/** Applies a normalised event atomically and idempotently. */
export async function applyPaymentEvent(
  event: NormalizedPaymentEvent,
  meta: RequestMeta,
): Promise<OrganizationWebhookOutcome> {
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

    // Conditional claim: only one concurrent webhook can move a pending (or
    // under-review) transaction to SUCCEEDED.
    const claimed = await tx.transaction.updateMany({
      where: { id: transaction.id, status: { in: ["PENDING", "UNDER_REVIEW"] } },
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

    // ---- Fiscal document (AGT) ------------------------------------------
    // Invoice numbers are only consumed by real, paid invoices.
    const issuedAt = event.paidAt ?? now;
    const organization = await tx.organization.findUnique({
      where: { id: transaction.organizationId },
      select: { taxId: true },
    });
    const allocation = await allocateInvoiceNumber(
      tx,
      transaction.organizationId,
      "FR",
      issuedAt,
    );
    const breakdown = vatBreakdown(transaction.amountCents, getEnv().IVA_RATE_BPS);
    const issuerTaxId = getEnv().PLATFORM_TAX_ID ?? "";
    // An explicit NIF given at checkout wins over the organization profile.
    const customerTaxId =
      transaction.customerTaxId ?? organization?.taxId ?? "";
    const previousHash = previousHashOf(
      await previousInvoiceHash(tx, allocation.seriesId, allocation.sequence),
    );
    const canonicalInput = {
      issuerTaxId,
      customerTaxId,
      documentType: "FR" as const,
      seriesCode: allocation.seriesCode,
      sequence: allocation.sequence,
      issuedAt: issuedAt.toISOString(),
      subtotalCents: breakdown.subtotalCents,
      vatCents: breakdown.vatCents,
      totalCents: breakdown.totalCents,
      currency: transaction.currency,
      previousHash,
    };
    const signature = signInvoice(buildInvoiceCanonical(canonicalInput));
    const invoiceNumber = allocation.invoiceNumber;

    const paid = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        subscriptionId: subscription.id,
        invoiceNumber,
        seriesId: allocation.seriesId,
        seriesCode: allocation.seriesCode,
        sequence: allocation.sequence,
        subtotalCents: breakdown.subtotalCents,
        vatCents: breakdown.vatCents,
        vatRateBps: getEnv().IVA_RATE_BPS,
        customerTaxId: customerTaxId || null,
        issuerTaxId: issuerTaxId || null,
        invoiceHash: signature.hash,
        invoiceQr: invoiceQrPayload({
          ...canonicalInput,
          invoiceNumber,
          hash: signature.hash,
        }),
        invoiceIssuedAt: issuedAt,
        agtCertified: signature.certified,
      },
    });

    await recordAudit(tx, {
      action: "billing.payment_confirmed",
      entityType: "transaction",
      entityId: paid.id,
      metadata: {
        reference: event.reference,
        provider: event.provider,
        method: transaction.method,
        plan: plan.code,
        organizationId: transaction.organizationId,
        invoiceNumber,
        periodEnd: periodEnd.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { duplicate: false as const, transaction: paid };
  });

  // The receipt is sent after the money is committed; SMTP can never roll back a
  // payment. Delivery is idempotent through `receipt_sent_at`.
  if (!result.duplicate && result.transaction.status === "SUCCEEDED") {
    await deliverPaymentReceipt(result.transaction.id).catch(() => undefined);
  }

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
    // A reference belongs either to an organization invoice or to an
    // end-customer subscription payment.
    if (await isCustomerPaymentReference(event.reference)) {
      const outcome = await applyCustomerPaymentEvent(event, meta);
      return { duplicate: outcome.duplicate, scope: "customer", payment: outcome.payment };
    }
    const outcome = await applyPaymentEvent(event, meta);
    return { ...outcome, scope: "organization" };
  } catch (error) {
    // A concurrent duplicate could hit the unique provider_event_id: that is a
    // success from the provider's point of view, not an error.
    if (isUniqueConstraintError(error)) {
      const existing = await db.transaction.findUnique({
        where: { reference: event.reference },
      });
      // Only a genuinely already-applied event counts as a duplicate. Any other
      // unique conflict (e.g. an invoicing invariant) must surface as an error
      // instead of silently pretending the payment was applied.
      if (existing && existing.providerEventId === event.eventId) {
        return {
          duplicate: true,
          scope: "organization",
          transaction: serializeTransaction(existing),
        };
      }
    }
    throw error;
  }
}
