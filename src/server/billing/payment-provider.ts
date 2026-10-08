/**
 * Payment provider boundary.
 *
 * Two real strategies, no simulation:
 *
 *  - `invoice` (default): a real, unique payable reference is issued and the
 *    bank details are returned for a B2B transfer. The transaction stays
 *    PENDING until a signature-verified webhook confirms the funds.
 *  - `stripe`: a real Checkout Session is created through Stripe's REST API.
 *    When the key is missing the call fails loudly (503) instead of pretending
 *    a payment page exists.
 *
 * Nothing here can mark a transaction as paid — only the webhook handler can.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import type {
  PaymentMethod as PaymentMethodName,
  PaymentProvider as PaymentProviderName,
  Plan,
  Transaction,
} from "@prisma/client";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { createMulticaixaRequest } from "./multicaixa";
import { providerForMethod } from "./payment-methods";
import { buildAngolaBankQr, isValidAngolaIban, normalizeIban } from "./qr-payment";

export interface CheckoutSession {
  provider: PaymentProviderName;
  providerReference: string | null;
  checkoutUrl: string | null;
  /** Human instructions (bank transfer details); null for hosted checkout. */
  instructions: string | null;
  /** EMVCo bank QR payload the payer scans; only for QR_CODE. */
  qrPayload: string | null;
}

/** Unique, quotable reference printed on the invoice. */
export function generatePaymentReference(): string {
  return `FZ-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function bankInstructions(reference: string, plan: Plan): string | null {
  const env = getEnv();
  const lines: string[] = [
    `Referência: ${reference}`,
    `Plano: ${plan.name} (${formatAmount(plan.priceCents, plan.currency)})`,
  ];
  if (env.BILLING_BANK_NAME) lines.push(`Banco: ${env.BILLING_BANK_NAME}`);
  if (env.BILLING_BANK_ACCOUNT) lines.push(`Conta: ${env.BILLING_BANK_ACCOUNT}`);
  if (env.BILLING_BANK_IBAN) lines.push(`IBAN: ${env.BILLING_BANK_IBAN}`);
  if (lines.length === 2) {
    // No bank details configured: still a real, valid reference.
    lines.push("Pague por transferência e indique a referência.");
  }
  return lines.join("\n");
}

function formatAmount(priceCents: number, currency: string): string {
  return `${(priceCents / 100).toFixed(2)} ${currency}`;
}

function qrInstructions(reference: string, plan: Plan): string {
  const env = getEnv();
  const lines: string[] = [
    "Pagamento por QR Code bancário (EMVCo)",
    `Referência: ${reference}`,
    `Valor: ${formatAmount(plan.priceCents, plan.currency)}`,
  ];
  if (env.BILLING_BANK_NAME) lines.push(`Banco: ${env.BILLING_BANK_NAME}`);
  if (env.BILLING_BANK_IBAN) lines.push(`IBAN: ${normalizeIban(env.BILLING_BANK_IBAN)}`);
  lines.push(
    "",
    "1. Abra a aplicação do seu banco (Multicaixa Express ou home-banking).",
    "2. Escolha “Pagar por QR Code” e digitalize o código apresentado.",
    "3. Confirme os dados e autorize o pagamento.",
    "A subscrição é ativada automaticamente quando o pagamento for confirmado.",
  );
  return lines.join("\n");
}

function buildCheckoutUrl(reference: string, plan: Plan): string | null {
  const template = getEnv().PAYMENT_CHECKOUT_URL_TEMPLATE;
  if (!template) return null;
  return template
    .replaceAll("{reference}", encodeURIComponent(reference))
    .replaceAll("{amount}", String(plan.priceCents))
    .replaceAll("{currency}", encodeURIComponent(plan.currency));
}

async function createStripeCheckout(
  transaction: Transaction,
  plan: Plan,
): Promise<CheckoutSession> {
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw AppError.serviceUnavailable(
      "PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY.",
      { provider: "stripe" },
    );
  }

  const body = new URLSearchParams({
    mode: "payment",
    client_reference_id: transaction.reference,
    success_url: `${env.APP_URL}/gestor?checkout=success`,
    cancel_url: `${env.APP_URL}/gestor?checkout=cancelled`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": plan.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(plan.priceCents),
    "line_items[0][price_data][product_data][name]": plan.name,
  });
  body.set("metadata[reference]", transaction.reference);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw AppError.serviceUnavailable("Stripe refused to create the checkout session", {
      status: response.status,
      detail: detail.slice(0, 300),
    });
  }

  const session = (await response.json()) as { id?: string; url?: string };
  return {
    provider: "STRIPE",
    providerReference: session.id ?? null,
    checkoutUrl: session.url ?? null,
    instructions: null,
    qrPayload: null,
  };
}

export async function createCheckoutSession(
  transaction: Transaction,
  plan: Plan,
  method: PaymentMethodName,
): Promise<CheckoutSession> {
  const env = getEnv();

  if (method === "CARD") {
    return createStripeCheckout(transaction, plan);
  }

  if (method === "MULTICAIXA_EXPRESS") {
    const result = await createMulticaixaRequest({
      reference: transaction.reference,
      amountCents: transaction.amountCents,
      currency: transaction.currency,
      description: `Subscrição FilaZero — ${plan.name}`,
      callbackUrl: `${env.APP_URL}/api/billing/webhook`,
    });
    return {
      provider: providerForMethod(method),
      providerReference: result.providerReference,
      checkoutUrl: result.checkoutUrl,
      instructions: result.instructions,
      qrPayload: null,
    };
  }

  if (method === "QR_CODE") {
    const iban = env.BILLING_BANK_IBAN;
    if (!iban || !isValidAngolaIban(iban)) {
      throw AppError.serviceUnavailable(
        "QR_CODE requires a valid Angolan BILLING_BANK_IBAN.",
        { provider: "qr" },
      );
    }
    const qrPayload = buildAngolaBankQr({
      iban,
      merchantName: env.BILLING_BANK_NAME ?? env.PLATFORM_LEGAL_NAME,
      merchantCity: env.PLATFORM_CITY ?? null,
      amountCents: transaction.amountCents,
      reference: transaction.reference,
      acquirerGui: env.BILLING_BANK_GUI ?? null,
    });
    return {
      provider: providerForMethod(method),
      providerReference: transaction.reference,
      checkoutUrl: null,
      instructions: qrInstructions(transaction.reference, plan),
      qrPayload,
    };
  }

  // Bank transfer: a real, quotable reference plus the bank details.
  return {
    provider: providerForMethod(method),
    providerReference: transaction.reference,
    checkoutUrl: buildCheckoutUrl(transaction.reference, plan),
    instructions: bankInstructions(transaction.reference, plan),
    qrPayload: null,
  };
}

/** Secret used to verify an inbound webhook, per provider. */
export function webhookSecretFor(provider: PaymentProviderName): string | null {
  const env = getEnv();
  if (provider === "STRIPE") {
    return env.STRIPE_WEBHOOK_SECRET ?? env.PAYMENT_WEBHOOK_SECRET ?? null;
  }
  return env.PAYMENT_WEBHOOK_SECRET ?? null;
}
