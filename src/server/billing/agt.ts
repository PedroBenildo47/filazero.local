/**
 * Pure AGT (Angolan tax authority) invoicing rules.
 *
 * No I/O, no `server-only`: NIF validation, the VAT breakdown, the official
 * series/number format, the canonical string that gets signed and the QR
 * payload are all deterministic and unit-tested. The signing itself (which needs
 * a key) lives in `invoice-signing.ts`.
 *
 * Honest limitation: producing an AGT-*certified* signature requires the
 * software certificate issued by the AGT. When that key is configured the real
 * RSA signature is produced; otherwise a deterministic integrity HMAC is used
 * and the invoice is stored with `agtCertified = false`.
 */

export type InvoiceDocumentTypeName = "FT" | "FR";

/** Standard Angolan VAT rate (IVA), in basis points. 1400 = 14.00%. */
export const IVA_RATE_BPS_DEFAULT = 1400;

export const INVOICE_DOCUMENT_TYPES: readonly InvoiceDocumentTypeName[] = ["FT", "FR"];

export const INVOICE_DOCUMENT_LABELS: Record<
  InvoiceDocumentTypeName,
  { pt: string; en: string }
> = {
  FT: { pt: "Factura", en: "Invoice" },
  FR: { pt: "Factura-Recibo", en: "Invoice-Receipt" },
};

/* -------------------------------------------------------------------------- */
/* NIF                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Angolan NIF: 9 digits (individuals) or 10 digits (legal persons). Spaces and
 * dots are tolerated on input and stripped before validation.
 */
export function normalizeNif(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.replace(/[\s.\-/]/g, "").toUpperCase();
  return cleaned.length === 0 ? null : cleaned;
}

export function isValidNif(value: string | null | undefined): boolean {
  const nif = normalizeNif(value);
  return nif !== null && /^\d{9,10}$/.test(nif);
}

/* -------------------------------------------------------------------------- */
/* VAT                                                                         */
/* -------------------------------------------------------------------------- */

export interface VatBreakdown {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
}

/**
 * Splits a **VAT-inclusive** gross amount into net + VAT. Angolan retail/B2B
 * prices are normally quoted with IVA included, so `amountCents` stays the
 * amount actually charged and the breakdown is derived from it.
 */
export function vatBreakdown(grossCents: number, rateBps = IVA_RATE_BPS_DEFAULT): VatBreakdown {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error("Amount must be a non-negative integer number of cents");
  }
  if (rateBps <= 0) {
    return { subtotalCents: grossCents, vatCents: 0, totalCents: grossCents };
  }
  const subtotalCents = Math.round((grossCents * 10_000) / (10_000 + rateBps));
  return { subtotalCents, vatCents: grossCents - subtotalCents, totalCents: grossCents };
}

/* -------------------------------------------------------------------------- */
/* Series and numbering                                                        */
/* -------------------------------------------------------------------------- */

/** `FR` + `2026` → `FR2026`. */
export function formatSeriesCode(
  documentType: InvoiceDocumentTypeName,
  year: number,
): string {
  return `${documentType}${year}`;
}

/** `FR2026` + `1` → `FR2026/000001`. */
export function buildInvoiceNumber(seriesCode: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Invoice sequence must be a positive integer");
  }
  return `${seriesCode}/${String(sequence).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Canonical string, hash and QR                                               */
/* -------------------------------------------------------------------------- */

export interface InvoiceSignatureInput {
  issuerTaxId: string;
  customerTaxId: string;
  documentType: InvoiceDocumentTypeName;
  seriesCode: string;
  sequence: number;
  issuedAt: string;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  currency: string;
  /** First 4 characters of the previous document's hash in the series, or "". */
  previousHash: string;
}

/**
 * The exact string that is signed. Field order and separators are fixed so a
 * document can be verified later from its printed values.
 */
export function buildInvoiceCanonical(input: InvoiceSignatureInput): string {
  return [
    input.issuerTaxId,
    input.customerTaxId,
    input.documentType,
    input.seriesCode,
    String(input.sequence),
    input.issuedAt,
    String(input.subtotalCents),
    String(input.vatCents),
    String(input.totalCents),
    input.currency,
    input.previousHash,
  ].join(";");
}

export function previousHashOf(hash: string | null | undefined): string {
  if (!hash) return "";
  return hash.replace(/\s+/g, "").slice(0, 4);
}

/**
 * Payload encoded in the QR code printed on the document. Pipe-separated so it
 * stays human-inspectable and offline-verifiable.
 */
export function invoiceQrPayload(
  input: InvoiceSignatureInput & { invoiceNumber: string; hash: string },
): string {
  return [
    input.issuerTaxId,
    input.customerTaxId,
    input.documentType,
    input.invoiceNumber,
    input.issuedAt,
    String(input.totalCents),
    input.currency,
    input.hash,
  ].join("|");
}

/** `1400` → `14%` (trailing zeros trimmed). */
export function formatVatRate(rateBps: number): string {
  const percent = rateBps / 100;
  const formatted = Number.isInteger(percent)
    ? String(percent)
    : percent.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}%`;
}
