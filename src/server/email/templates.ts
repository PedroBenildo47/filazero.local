/**
 * Email templates (PT/EN).
 *
 * Pure functions: given the data, they return the exact message. No I/O, so
 * both languages are unit-tested.
 */

export type EmailLang = "pt" | "en";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface PasswordResetTemplateInput {
  name: string;
  link: string;
  expiresInMinutes: number;
  lang: EmailLang;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const COPY = {
  pt: {
    subject: "Redefinir a sua palavra-passe — FilaZero",
    greeting: (name: string) => `Olá ${name},`,
    intro:
      "Recebemos um pedido para redefinir a palavra-passe da sua conta FilaZero.",
    cta: "Redefinir palavra-passe",
    expiry: (minutes: number) =>
      `O link é válido durante ${minutes} minutos e só pode ser usado uma vez.`,
    ignore:
      "Se não pediu isto, ignore este email: a sua palavra-passe mantém-se igual.",
    fallback: "Se o botão não funcionar, copie este endereço para o navegador:",
    footer: "FilaZero — gestão de filas presenciais",
  },
  en: {
    subject: "Reset your password — FilaZero",
    greeting: (name: string) => `Hi ${name},`,
    intro: "We received a request to reset the password of your FilaZero account.",
    cta: "Reset password",
    expiry: (minutes: number) =>
      `The link is valid for ${minutes} minutes and can only be used once.`,
    ignore:
      "If you did not request this, ignore this email: your password stays the same.",
    fallback: "If the button does not work, copy this address into your browser:",
    footer: "FilaZero — on-site queue management",
  },
} as const;

export interface PaymentReceiptTemplateInput {
  organizationName: string;
  invoiceNumber: string;
  planName: string;
  amount: string;
  method: string;
  reference: string;
  paidAt: string;
  periodEnd: string | null;
  lang: EmailLang;
}

const RECEIPT_COPY = {
  pt: {
    subject: (invoice: string) => `Recibo de pagamento ${invoice} — FilaZero`,
    greeting: (name: string) => `Olá ${name},`,
    intro: "Confirmámos o pagamento da sua subscrição FilaZero. Obrigado!",
    invoice: "Fatura",
    plan: "Plano",
    amount: "Valor",
    method: "Método de pagamento",
    reference: "Referência",
    paidAt: "Data de pagamento",
    periodEnd: "Subscrição válida até",
    note: "Guarde este recibo para os seus registos. A fatura fica disponível no painel de gestão.",
    footer: "FilaZero — gestão de filas presenciais",
  },
  en: {
    subject: (invoice: string) => `Payment receipt ${invoice} — FilaZero`,
    greeting: (name: string) => `Hi ${name},`,
    intro: "We have confirmed the payment of your FilaZero subscription. Thank you!",
    invoice: "Invoice",
    plan: "Plan",
    amount: "Amount",
    method: "Payment method",
    reference: "Reference",
    paidAt: "Paid on",
    periodEnd: "Subscription valid until",
    note: "Keep this receipt for your records. The invoice is available in the management panel.",
    footer: "FilaZero — on-site queue management",
  },
} as const;

const PAYMENT_METHOD_LABELS: Record<string, { pt: string; en: string }> = {
  MULTICAIXA_EXPRESS: { pt: "Multicaixa Express", en: "Multicaixa Express" },
  BANK_TRANSFER: { pt: "Transferência bancária", en: "Bank transfer" },
  QR_CODE: { pt: "QR Code bancário", en: "Bank QR code" },
  CARD: { pt: "Cartão Visa/Mastercard", en: "Visa/Mastercard card" },
};

export function paymentMethodLabel(method: string, lang: EmailLang): string {
  return PAYMENT_METHOD_LABELS[method]?.[lang] ?? method;
}

export function renderPaymentReceiptEmail(
  input: PaymentReceiptTemplateInput,
): RenderedEmail {
  const copy = RECEIPT_COPY[input.lang];
  const rows: Array<[string, string]> = [
    [copy.invoice, input.invoiceNumber],
    [copy.plan, input.planName],
    [copy.amount, input.amount],
    [copy.method, input.method],
    [copy.reference, input.reference],
    [copy.paidAt, input.paidAt],
  ];
  if (input.periodEnd) rows.push([copy.periodEnd, input.periodEnd]);

  const text = [
    copy.greeting(input.organizationName),
    "",
    copy.intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    copy.note,
    "",
    copy.footer,
  ].join("\n");

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#475569;">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="${input.lang}">
  <body style="margin:0;padding:24px;background:#f6f8fb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;">FilaZero</h1>
      <p style="margin:0 0 12px;">${copy.greeting(escapeHtml(input.organizationName))}</p>
      <p style="margin:0 0 20px;color:#475569;">${copy.intro}</p>
      <table style="border-collapse:collapse;font-size:14px;">${rowsHtml}</table>
      <p style="margin:20px 0 0;color:#64748b;font-size:13px;">${copy.note}</p>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0;" />
      <p style="margin:0;color:#94a3b8;font-size:12px;">${copy.footer}</p>
    </div>
  </body>
</html>`;

  return { subject: copy.subject(input.invoiceNumber), text, html };
}

export function renderPasswordResetEmail(
  input: PasswordResetTemplateInput,
): RenderedEmail {
  const copy = COPY[input.lang];
  const safeName = escapeHtml(input.name);
  const safeLink = escapeHtml(input.link);

  const text = [
    copy.greeting(input.name),
    "",
    copy.intro,
    "",
    `${copy.cta}: ${input.link}`,
    "",
    copy.expiry(input.expiresInMinutes),
    copy.ignore,
    "",
    copy.footer,
  ].join("\n");

  const html = `<!doctype html>
<html lang="${input.lang}">
  <body style="margin:0;padding:24px;background:#f6f8fb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;">FilaZero</h1>
      <p style="margin:0 0 12px;">${copy.greeting(safeName)}</p>
      <p style="margin:0 0 20px;color:#475569;">${copy.intro}</p>
      <p style="margin:0 0 20px;">
        <a href="${safeLink}" style="display:inline-block;background:#0d6efd;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">${copy.cta}</a>
      </p>
      <p style="margin:0 0 8px;color:#475569;font-size:14px;">${copy.expiry(input.expiresInMinutes)}</p>
      <p style="margin:0 0 20px;color:#475569;font-size:14px;">${copy.ignore}</p>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;">${copy.fallback}</p>
      <p style="margin:0 0 20px;font-size:13px;word-break:break-all;">
        <a href="${safeLink}" style="color:#0d6efd;">${safeLink}</a>
      </p>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0;" />
      <p style="margin:0;color:#94a3b8;font-size:12px;">${copy.footer}</p>
    </div>
  </body>
</html>`;

  return { subject: copy.subject, text, html };
}
