/**
 * Pure billing rules: period arithmetic and webhook event normalisation.
 *
 * Kept free of Prisma/`server-only` so both can be unit-tested directly. The
 * service layer composes them with persistence.
 */
import type {
  BillingInterval,
  PaymentProvider as PaymentProviderName,
} from "@prisma/client";
import { AppError } from "@/lib/errors";

/** Adds one billing interval to a date (UTC, so results are deterministic). */
export function addInterval(date: Date, interval: BillingInterval): Date {
  const next = new Date(date.getTime());
  if (interval === "YEARLY") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

export interface NormalizedPaymentEvent {
  eventId: string;
  outcome: "succeeded" | "failed";
  reference: string;
  providerReference: string | null;
  paidAt: Date;
  provider: PaymentProviderName;
  rawType: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Accepts both the FilaZero gateway payload and a Stripe event, normalising
 * them into a single shape:
 *
 *   FilaZero: { id, type: "payment.succeeded" | "payment.failed",
 *               data: { reference, providerReference?, paidAt? } }
 *   Stripe:   { id, type: "checkout.session.completed",
 *               data: { object: { client_reference_id, id, payment_status } } }
 */
export function normalizePaymentEvent(rawBody: string): NormalizedPaymentEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw AppError.badRequest("Webhook body is not valid JSON");
  }

  const event = asRecord(parsed);
  const eventId = asString(event.id);
  const rawType = asString(event.type) ?? "";
  const data = asRecord(event.data);

  if (!eventId) throw AppError.badRequest("Webhook event is missing an id");

  if (rawType === "payment.succeeded" || rawType === "payment.failed") {
    const reference = asString(data.reference);
    if (!reference) throw AppError.badRequest("Webhook event is missing a reference");
    const paidAtRaw = asString(data.paidAt);
    const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date();
    return {
      eventId,
      outcome: rawType === "payment.succeeded" ? "succeeded" : "failed",
      reference,
      providerReference: asString(data.providerReference),
      paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
      provider: "INVOICE",
      rawType,
    };
  }

  const object = asRecord(data.object);

  if (rawType === "checkout.session.completed") {
    const reference = asString(object.client_reference_id);
    if (!reference) {
      throw AppError.badRequest("Stripe session has no client_reference_id");
    }
    const paymentStatus = asString(object.payment_status);
    const paid =
      paymentStatus === "paid" || paymentStatus === "no_payment_required";
    return {
      eventId,
      outcome: paid ? "succeeded" : "failed",
      reference,
      providerReference: asString(object.id),
      paidAt: new Date(),
      provider: "STRIPE",
      rawType,
    };
  }

  if (rawType === "payment_intent.payment_failed") {
    const metadata = asRecord(object.metadata);
    const reference = asString(metadata.reference);
    if (!reference) {
      throw AppError.badRequest("Stripe payment_intent has no reference metadata");
    }
    return {
      eventId,
      outcome: "failed",
      reference,
      providerReference: asString(object.id),
      paidAt: new Date(),
      provider: "STRIPE",
      rawType,
    };
  }

  throw AppError.badRequest(`Unsupported webhook event type: ${rawType || "(none)"}`);
}

/* -------------------------------------------------------------------------- */
/* Plan catalogue                                                              */
/* -------------------------------------------------------------------------- */

export interface PlanDefinition {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: BillingInterval;
  maxBranches: number;
  maxQueuesPerBranch: number;
  maxStaff: number;
}

/** Prices are in the smallest currency unit (cêntimos for AOA). */
export const PLAN_CATALOG: readonly PlanDefinition[] = [
  { code: "trial", name: "Trial", description: "Periodo de avaliacao, sem custo.",
    priceCents: 0, currency: "AOA", interval: "MONTHLY",
    maxBranches: 3, maxQueuesPerBranch: 15, maxStaff: 10 },
  { code: "starter", name: "Starter", description: "Uma clinica ou loja com poucas filas.",
    priceCents: 2_500_000, currency: "AOA", interval: "MONTHLY",
    maxBranches: 3, maxQueuesPerBranch: 20, maxStaff: 15 },
  { code: "growth", name: "Growth", description: "Varias filiais e equipas maiores.",
    priceCents: 7_500_000, currency: "AOA", interval: "MONTHLY",
    maxBranches: 10, maxQueuesPerBranch: 40, maxStaff: 60 },
  { code: "enterprise", name: "Enterprise", description: "Rede multi-filial com necessidades proprias.",
    priceCents: 20_000_000, currency: "AOA", interval: "MONTHLY",
    maxBranches: 100, maxQueuesPerBranch: 200, maxStaff: 1_000 },
];

/** Minimal client surface needed to upsert the catalogue. */
export interface PlanCatalogClient {
  plan: {
    upsert(args: {
      where: { code: string };
      update: Omit<PlanDefinition, "code" | "currency"> & { currency?: string };
      create: PlanDefinition;
    }): Promise<unknown>;
  };
}

/** Idempotent upsert of the catalogue. Safe to run repeatedly. */
export async function ensurePlanCatalog(client: PlanCatalogClient): Promise<void> {
  for (const plan of PLAN_CATALOG) {
    await client.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        maxBranches: plan.maxBranches,
        maxQueuesPerBranch: plan.maxQueuesPerBranch,
        maxStaff: plan.maxStaff,
      },
      create: plan,
    });
  }
}
