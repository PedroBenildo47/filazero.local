/**
 * Stripe card payments — embedded PaymentIntent flow.
 *
 * Card data never touches FilaZero: the browser collects it with Stripe Elements
 * (PCI-compliant iframes) and confirms the PaymentIntent directly against
 * Stripe. The server only creates the intent and reads the webhook — it never
 * sees a card number, and nothing is ever marked paid on the client.
 */
import "server-only";
import Stripe from "stripe";
import { AppError } from "@/lib/errors";
import { getEnv, isStripeEmbeddedConfigured } from "@/lib/env";

let cached: Stripe | null = null;

/** True when both the secret and publishable keys are configured. */
export function isCardPaymentsConfigured(): boolean {
  return isStripeEmbeddedConfigured();
}

function getStripeClient(): Stripe {
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw AppError.serviceUnavailable(
      "Card payments are not configured: STRIPE_SECRET_KEY is missing.",
      { provider: "stripe" },
    );
  }
  if (!cached) {
    // The SDK pins its own API version; passing one explicitly would break on
    // upgrade, so it is intentionally omitted.
    cached = new Stripe(env.STRIPE_SECRET_KEY, { typescript: true });
  }
  return cached;
}

export interface CardIntentInput {
  amountCents: number;
  currency: string;
  reference: string;
  description: string;
  /** Extra metadata echoed back on the webhook (organization, transaction id). */
  metadata?: Record<string, string>;
  customerEmail?: string | null;
}

export interface CardIntent {
  id: string;
  clientSecret: string;
}

/**
 * Creates a real Stripe PaymentIntent for a card payment. Idempotent per
 * reference so a retry can never create two payable intents for one invoice.
 */
export async function createCardPaymentIntent(input: CardIntentInput): Promise<CardIntent> {
  const stripe = getStripeClient();

  const intent = await stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      description: input.description,
      automatic_payment_methods: { enabled: true },
      metadata: { reference: input.reference, ...(input.metadata ?? {}) },
      ...(input.customerEmail ? { receipt_email: input.customerEmail } : {}),
    },
    { idempotencyKey: `filazero-pi-${input.reference}` },
  );

  if (!intent.client_secret) {
    throw AppError.serviceUnavailable("Stripe did not return a client secret.", {
      provider: "stripe",
    });
  }

  return { id: intent.id, clientSecret: intent.client_secret };
}

/** Publishable key handed to the browser to mount Stripe Elements. */
export function stripePublishableKey(): string {
  const key = getEnv().STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    throw AppError.serviceUnavailable("STRIPE_PUBLISHABLE_KEY is not configured.", {
      provider: "stripe",
    });
  }
  return key;
}
