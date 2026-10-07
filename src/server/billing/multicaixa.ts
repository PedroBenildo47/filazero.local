/**
 * Multicaixa Express adapter.
 *
 * Angola's Multicaixa Express settles a payment from a quotable reference the
 * payer confirms inside the bank app. Two real paths:
 *
 *  - with `MULTICAIXA_API_URL` configured, a real request is sent to the
 *    EMIS/aggregator gateway to open the payment (POST `<url>/payments`) and the
 *    returned payment link is surfaced to the payer;
 *  - without it, a real, unique reference plus step-by-step instructions are
 *    issued and the transaction stays PENDING until the signed webhook confirms
 *    the funds — nothing is ever marked as paid here.
 */
import "server-only";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

export interface MulticaixaResult {
  providerReference: string | null;
  checkoutUrl: string | null;
  instructions: string;
}

export interface MulticaixaRequestInput {
  reference: string;
  amountCents: number;
  currency: string;
  description: string;
  callbackUrl: string;
}

function formatAmount(amountCents: number, currency: string): string {
  return `${(amountCents / 100).toFixed(2)} ${currency}`;
}

function instructions(input: MulticaixaRequestInput): string {
  const env = getEnv();
  const lines = [
    "Pagamento por Multicaixa Express",
    `Referência: ${input.reference}`,
    `Valor: ${formatAmount(input.amountCents, input.currency)}`,
  ];
  if (env.MULTICAIXA_MERCHANT_NAME) lines.push(`Entidade: ${env.MULTICAIXA_MERCHANT_NAME}`);
  if (env.MULTICAIXA_MERCHANT_PHONE) lines.push(`Telefone: ${env.MULTICAIXA_MERCHANT_PHONE}`);
  lines.push(
    "",
    "1. Abra a aplicação Multicaixa Express.",
    "2. Escolha “Pagamentos” e introduza a referência acima.",
    "3. Confirme o valor com o seu PIN.",
    "A subscrição é ativada automaticamente quando o pagamento for confirmado.",
  );
  return lines.join("\n");
}

/**
 * Opens a Multicaixa Express payment. Throws a 503 when a gateway is configured
 * but refuses the request, so a broken integration is never silent.
 */
export async function createMulticaixaRequest(
  input: MulticaixaRequestInput,
): Promise<MulticaixaResult> {
  const env = getEnv();

  if (!env.MULTICAIXA_API_URL) {
    return {
      providerReference: input.reference,
      checkoutUrl: null,
      instructions: instructions(input),
    };
  }

  if (!env.MULTICAIXA_API_KEY) {
    throw AppError.serviceUnavailable(
      "MULTICAIXA_API_URL is set but MULTICAIXA_API_KEY is missing.",
      { provider: "multicaixa" },
    );
  }

  const response = await fetch(`${env.MULTICAIXA_API_URL.replace(/\/$/, "")}/payments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MULTICAIXA_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      reference: input.reference,
      amountCents: input.amountCents,
      currency: input.currency,
      description: input.description,
      callbackUrl: input.callbackUrl,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw AppError.serviceUnavailable("Multicaixa Express refused the payment request", {
      status: response.status,
      detail: detail.slice(0, 300),
    });
  }

  const session = (await response.json()) as {
    id?: string;
    paymentUrl?: string;
    instructions?: string;
  };

  return {
    providerReference: session.id ?? input.reference,
    checkoutUrl: session.paymentUrl ?? null,
    instructions: session.instructions ?? instructions(input),
  };
}
