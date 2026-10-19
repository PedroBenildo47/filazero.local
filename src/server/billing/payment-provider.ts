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
} from "@prisma/client";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { createMulticaixaRequest } from "./multicaixa";
import { providerForMethod } from "./payment-methods";
import { normalizeIban, tryBuildAngolaBankQr } from "./qr-payment";
import { resolveBankName } from "./bank-profiles";

/** Minimal shape the checkout adapters need from a payable subject. */
export interface CheckoutSubject {
  reference: string;
  amountCents: number;
  currency: string;
}

/** Minimal shape the checkout adapters need from a plan. */
export interface CheckoutPlan {
  name: string;
  priceCents: number;
  currency: string;
  interval: string;
}

export interface CheckoutSession {
  provider: PaymentProviderName;
  providerReference: string | null;
  checkoutUrl: string | null;
  /** Human instructions (bank transfer details); null for hosted checkout. */
  instructions: string | null;
  /** EMVCo bank QR payload the payer scans; only for QR_CODE. */
  qrPayload: string | null;
  /** Structured platform bank account, shown on the checkout screen. */
  bankDetails: BankDetails | null;
}

/** Platform bank account the payer transfers to (bank transfer / QR). */
export interface BankDetails {
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  holder: string;
  /** True when an IBAN/account is actually configured for real transfers. */
  configured: boolean;
}

/**
 * Reads the platform bank account from the environment (never hard-coded).
 *
 * Tolerance rule: a missing *secondary* field never crashes the checkout. Only
 * the bank display name has a fallback (`BILLING_BANK_PROFILE`, then BIC); the
 * IBAN/account stay exactly as configured, because inventing a payable
 * destination would be unsafe.
 */
export function platformBankDetails(): BankDetails {
  const env = getEnv();
  return {
    bankName: resolveBankName(env.BILLING_BANK_NAME, env.BILLING_BANK_PROFILE),
    accountNumber: env.BILLING_BANK_ACCOUNT ?? null,
    iban: env.BILLING_BANK_IBAN ? normalizeIban(env.BILLING_BANK_IBAN) : null,
    holder: env.PLATFORM_LEGAL_NAME,
    configured: Boolean(env.BILLING_BANK_IBAN || env.BILLING_BANK_ACCOUNT),
  };
}

/** Unique, quotable reference printed on the invoice. */
export function generatePaymentReference(): string {
  return `FZ-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function bankInstructions(reference: string, plan: CheckoutPlan): string | null {
  const bank = platformBankDetails();
  const lines: string[] = [
    `Referência: ${reference}`,
    `Plano: ${plan.name} (${formatAmount(plan.priceCents, plan.currency)})`,
  ];
  if (bank.bankName) lines.push(`Banco: ${bank.bankName}`);
  if (bank.accountNumber) lines.push(`Conta: ${bank.accountNumber}`);
  if (bank.iban) lines.push(`IBAN: ${bank.iban}`);
  if (lines.length === 2) {
    // No bank details configured: still a real, valid reference. The payer is
    // told to quote it so finance can match the transfer.
    lines.push("Pague por transferência e indique a referência.");
  }
  if (!bank.iban && !bank.accountNumber) {
    lines.push(
      "",
      "Os dados bancários da plataforma ainda não estão publicados. A tua referência já é válida: guarda-a e contacta o suporte para concluir a transferência.",
    );
  }
  return lines.join("\n");
}

function formatAmount(priceCents: number, currency: string): string {
  return `${(priceCents / 100).toFixed(2)} ${currency}`;
}

function qrInstructions(reference: string, plan: CheckoutPlan): string {
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

function buildCheckoutUrl(reference: string, plan: CheckoutPlan): string | null {
  const template = getEnv().PAYMENT_CHECKOUT_URL_TEMPLATE;
  if (!template) return null;
  return template
    .replaceAll("{reference}", encodeURIComponent(reference))
    .replaceAll("{amount}", String(plan.priceCents))
    .replaceAll("{currency}", encodeURIComponent(plan.currency));
}

async function createStripeCheckout(
  subject: CheckoutSubject,
  plan: CheckoutPlan,
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
    client_reference_id: subject.reference,
    success_url: `${env.APP_URL}/gestor?checkout=success`,
    cancel_url: `${env.APP_URL}/gestor?checkout=cancelled`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": plan.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(plan.priceCents),
    "line_items[0][price_data][product_data][name]": plan.name,
  });
  body.set("metadata[reference]", subject.reference);

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
    bankDetails: null,
  };
}

export async function createCheckoutSession(
  subject: CheckoutSubject,
  plan: CheckoutPlan,
  method: PaymentMethodName,
  payerPhone?: string | null,
): Promise<CheckoutSession> {
  const env = getEnv();

  if (method === "CARD") {
    return createStripeCheckout(subject, plan);
  }

  if (method === "MULTICAIXA_EXPRESS") {
    const result = await createMulticaixaRequest({
      reference: subject.reference,
      amountCents: subject.amountCents,
      currency: subject.currency,
      description: `Subscrição FilaZero — ${plan.name}`,
      callbackUrl: `${env.APP_URL}/api/billing/webhook`,
      payerPhone: payerPhone ?? null,
    });
    return {
      provider: providerForMethod(method),
      providerReference: result.providerReference,
      checkoutUrl: result.checkoutUrl,
      instructions: result.instructions,
      qrPayload: null,
      bankDetails: null,
    };
  }

  if (method === "QR_CODE") {
    const iban = env.BILLING_BANK_IBAN;
    // A QR only makes sense with a real, valid IBAN. Building it is wrapped in a
    // safe helper that returns null instead of throwing, so a missing or odd
    // secondary field degrades to bank-transfer instructions — the payer never
    // sees a 503.
    if (iban) {
      const qrPayload = tryBuildAngolaBankQr({
        iban,
        merchantName: env.BILLING_BANK_NAME ?? env.PLATFORM_LEGAL_NAME,
        merchantCity: env.PLATFORM_CITY ?? null,
        amountCents: subject.amountCents,
        reference: subject.reference,
        acquirerGui: env.BILLING_BANK_GUI ?? null,
      });
      if (qrPayload) {
        return {
          provider: providerForMethod(method),
          providerReference: subject.reference,
          checkoutUrl: null,
          instructions: qrInstructions(subject.reference, plan),
          qrPayload,
          bankDetails: platformBankDetails(),
        };
      }
    }

    return {
      provider: providerForMethod(method),
      providerReference: subject.reference,
      checkoutUrl: null,
      instructions: bankInstructions(subject.reference, plan),
      qrPayload: null,
      bankDetails: platformBankDetails(),
    };
  }

  // Bank transfer: a real, quotable reference plus the bank details.
  return {
    provider: providerForMethod(method),
    providerReference: subject.reference,
    checkoutUrl: buildCheckoutUrl(subject.reference, plan),
    instructions: bankInstructions(subject.reference, plan),
    qrPayload: null,
    bankDetails: platformBankDetails(),
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
