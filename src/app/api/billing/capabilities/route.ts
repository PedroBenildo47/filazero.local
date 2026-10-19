import { ok, route } from "@/lib/http";
import { getEnv, isStripeEmbeddedConfigured } from "@/lib/env";
import { isValidAngolaIban } from "@/server/billing/qr-payment";

/**
 * Payment capabilities.
 *
 * Public, read-only feature flags so the checkout can *disable* a method that is
 * not configured (and explain why) instead of letting the payer pick it and hit
 * a red "service unavailable" error. It exposes no secrets — only booleans.
 */
export const GET = route(async () => {
  const env = getEnv();
  const iban = env.BILLING_BANK_IBAN;
  const qrReady = Boolean(iban && isValidAngolaIban(iban));
  const bankConfigured = Boolean(env.BILLING_BANK_IBAN || env.BILLING_BANK_ACCOUNT);

  return ok({
    /** Reference-based methods always work (confirmed by the signed webhook). */
    multicaixa: true,
    bankTransfer: true,
    /** A real QR needs a valid Angolan IBAN. */
    qr: qrReady,
    /** Embedded Stripe Elements card form. */
    card: isStripeEmbeddedConfigured(),
    /** True when a real destination account/IBAN is published. */
    bankConfigured,
  });
});
