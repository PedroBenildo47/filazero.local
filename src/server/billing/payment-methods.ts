/**
 * Pure B2B payment rules.
 *
 * No I/O and no `server-only`, so the checkout method resolution, invoice
 * numbering and proof validation are all unit-testable. The service layer
 * composes them with persistence and the provider adapters.
 */
import type {
  PaymentMethod as PaymentMethodName,
  PaymentProvider as PaymentProviderName,
} from "@prisma/client";

export interface PaymentMethodDefinition {
  code: PaymentMethodName;
  /** Transport that actually moves the money. */
  provider: PaymentProviderName;
  /** A payer-supplied proof of payment is expected for this method. */
  requiresProof: boolean;
  /** True when the method needs a hosted redirect (card) instead of a reference. */
  hosted: boolean;
}

/**
 * The methods offered at checkout.
 *
 * `MULTICAIXA_EXPRESS`, `BANK_TRANSFER` and `QR_CODE` all settle through a
 * quotable reference confirmed by the signed webhook (transport `INVOICE`);
 * `QR_CODE` additionally renders an EMVCo bank QR. `CARD` uses the hosted
 * Stripe Checkout session (transport `STRIPE`).
 */
export const PAYMENT_METHODS: readonly PaymentMethodDefinition[] = [
  { code: "MULTICAIXA_EXPRESS", provider: "INVOICE", requiresProof: true, hosted: false },
  { code: "BANK_TRANSFER", provider: "INVOICE", requiresProof: true, hosted: false },
  { code: "QR_CODE", provider: "INVOICE", requiresProof: true, hosted: false },
  { code: "CARD", provider: "STRIPE", requiresProof: false, hosted: true },
];

export const DEFAULT_PAYMENT_METHOD: PaymentMethodName = "MULTICAIXA_EXPRESS";

export function isPaymentMethod(value: string): value is PaymentMethodName {
  return PAYMENT_METHODS.some((method) => method.code === value);
}

export function paymentMethodDefinition(
  method: PaymentMethodName,
): PaymentMethodDefinition {
  const definition = PAYMENT_METHODS.find((candidate) => candidate.code === method);
  if (!definition) {
    throw new Error(`Unknown payment method: ${method}`);
  }
  return definition;
}

export function providerForMethod(method: PaymentMethodName): PaymentProviderName {
  return paymentMethodDefinition(method).provider;
}

/* -------------------------------------------------------------------------- */
/* Invoice numbering                                                           */
/* -------------------------------------------------------------------------- */

export const INVOICE_NUMBER_PREFIX = "FT";

/** `FT/2026/000123` — stable, sortable, human-quotable. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Invoice sequence must be a positive integer");
  }
  return `${INVOICE_NUMBER_PREFIX}/${year}/${String(sequence).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Proof of payment validation                                                 */
/* -------------------------------------------------------------------------- */

export const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;
export const PAYMENT_PROOF_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PaymentProofMimeType = (typeof PAYMENT_PROOF_MIME_TYPES)[number];

/**
 * Sniffs the real content type from the leading bytes. The client-declared
 * `Content-Type` is never trusted: a `.pdf` that is actually a ZIP is rejected.
 */
export function detectProofMimeType(bytes: Uint8Array): PaymentProofMimeType | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export interface ProofValidationFailure {
  code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE";
  message: string;
}

/**
 * Validates an uploaded proof. Returns `null` when the upload is acceptable, or
 * a structured failure the caller turns into a 422.
 */
export function validatePaymentProof(
  bytes: Uint8Array,
): ProofValidationFailure | null {
  if (bytes.byteLength === 0) {
    return { code: "EMPTY_FILE", message: "The uploaded proof is empty." };
  }
  if (bytes.byteLength > MAX_PAYMENT_PROOF_BYTES) {
    return {
      code: "FILE_TOO_LARGE",
      message: `The proof must be at most ${MAX_PAYMENT_PROOF_BYTES / (1024 * 1024)} MB.`,
    };
  }
  if (detectProofMimeType(bytes) === null) {
    return {
      code: "UNSUPPORTED_FILE",
      message: "The proof must be a PDF, JPEG, PNG or WebP file.",
    };
  }
  return null;
}
