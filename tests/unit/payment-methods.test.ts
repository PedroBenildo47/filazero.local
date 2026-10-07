/**
 * Unit tests for the pure B2B payment rules and the receipt template.
 *
 * No database, no network: method resolution, invoice numbering, proof
 * validation and the two receipt languages are all deterministic functions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAYMENT_METHOD,
  MAX_PAYMENT_PROOF_BYTES,
  PAYMENT_METHODS,
  detectProofMimeType,
  formatInvoiceNumber,
  isPaymentMethod,
  providerForMethod,
  validatePaymentProof,
} from "@/server/billing/payment-methods";
import {
  paymentMethodLabel,
  renderPaymentReceiptEmail,
} from "@/server/email/templates";

const pdf = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = () =>
  new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("the three B2B payment methods are exposed with their transport", () => {
  const codes = PAYMENT_METHODS.map((method) => method.code);
  assert.deepEqual(codes, ["MULTICAIXA_EXPRESS", "BANK_TRANSFER", "CARD"]);
  assert.equal(providerForMethod("MULTICAIXA_EXPRESS"), "INVOICE");
  assert.equal(providerForMethod("BANK_TRANSFER"), "INVOICE");
  assert.equal(providerForMethod("CARD"), "STRIPE");
});

test("proof is expected for the reference-based methods only", () => {
  const byCode = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, m]));
  assert.equal(byCode.MULTICAIXA_EXPRESS!.requiresProof, true);
  assert.equal(byCode.BANK_TRANSFER!.requiresProof, true);
  assert.equal(byCode.CARD!.requiresProof, false);
  assert.equal(byCode.CARD!.hosted, true);
});

test("isPaymentMethod accepts only the known methods", () => {
  assert.equal(isPaymentMethod("CARD"), true);
  assert.equal(isPaymentMethod("MULTICAIXA_EXPRESS"), true);
  assert.equal(isPaymentMethod("PAYPAL"), false);
  assert.equal(isPaymentMethod(""), false);
  assert.equal(DEFAULT_PAYMENT_METHOD, "MULTICAIXA_EXPRESS");
});

test("invoice numbers are zero-padded and year-scoped", () => {
  assert.equal(formatInvoiceNumber(2026, 1), "FT/2026/000001");
  assert.equal(formatInvoiceNumber(2026, 123), "FT/2026/000123");
  assert.equal(formatInvoiceNumber(2030, 1_000_000), "FT/2030/1000000");
  assert.throws(() => formatInvoiceNumber(2026, 0));
  assert.throws(() => formatInvoiceNumber(2026, -3));
});

test("proof mime types are sniffed from the bytes, never the declared name", () => {
  assert.equal(detectProofMimeType(pdf()), "application/pdf");
  assert.equal(detectProofMimeType(jpeg()), "image/jpeg");
  assert.equal(detectProofMimeType(png()), "image/png");
  assert.equal(detectProofMimeType(webp()), "image/webp");
  assert.equal(detectProofMimeType(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null);
  assert.equal(detectProofMimeType(new Uint8Array()), null);
});

test("validatePaymentProof rejects empty, oversized and unknown files", () => {
  assert.equal(validatePaymentProof(new Uint8Array())?.code, "EMPTY_FILE");
  assert.equal(
    validatePaymentProof(new Uint8Array(MAX_PAYMENT_PROOF_BYTES + 1))?.code,
    "FILE_TOO_LARGE",
  );
  assert.equal(
    validatePaymentProof(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))?.code,
    "UNSUPPORTED_FILE",
  );
  assert.equal(validatePaymentProof(pdf()), null);
});

test("payment method labels are localised", () => {
  assert.equal(paymentMethodLabel("BANK_TRANSFER", "pt"), "Transferência bancária");
  assert.equal(paymentMethodLabel("BANK_TRANSFER", "en"), "Bank transfer");
  assert.equal(paymentMethodLabel("CARD", "en"), "Visa/Mastercard card");
  assert.equal(paymentMethodLabel("UNKNOWN", "pt"), "UNKNOWN");
});

test("the receipt template carries the invoice, plan, amount and method", () => {
  const pt = renderPaymentReceiptEmail({
    organizationName: "Clínica Alfa",
    invoiceNumber: "FT/2026/000042",
    planName: "Negócios",
    amount: "75000.00 AOA",
    method: "Transferência bancária",
    reference: "FZ-ABC123",
    paidAt: "5 de janeiro de 2026",
    periodEnd: "5 de fevereiro de 2026",
    lang: "pt",
  });
  assert.match(pt.subject, /FT\/2026\/000042/);
  assert.match(pt.text, /Clínica Alfa/);
  assert.match(pt.text, /Negócios/);
  assert.match(pt.text, /75000\.00 AOA/);
  assert.match(pt.text, /FZ-ABC123/);
  assert.match(pt.html, /FT\/2026\/000042/);

  const en = renderPaymentReceiptEmail({
    organizationName: "Clinic Alfa",
    invoiceNumber: "FT/2026/000042",
    planName: "Growth",
    amount: "75000.00 AOA",
    method: "Bank transfer",
    reference: "FZ-ABC123",
    paidAt: "5 January 2026",
    periodEnd: null,
    lang: "en",
  });
  assert.match(en.subject, /Payment receipt/);
  assert.match(en.text, /We have confirmed the payment/);
  assert.doesNotMatch(en.text, /Confirmámos/);
});
