/**
 * Unit tests for the pure AGT invoicing rules: NIF validation, VAT breakdown,
 * official series/number format, canonical signing string and QR payload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IVA_RATE_BPS_DEFAULT,
  buildInvoiceCanonical,
  buildInvoiceNumber,
  formatSeriesCode,
  formatVatRate,
  invoiceQrPayload,
  isValidNif,
  normalizeNif,
  previousHashOf,
  vatBreakdown,
  type InvoiceSignatureInput,
} from "@/server/billing/agt";

test("NIF accepts 9 or 10 digits and normalises separators", () => {
  assert.equal(normalizeNif(" 500 123 456 "), "500123456");
  assert.equal(normalizeNif("500.123.456-7"), "5001234567");
  assert.equal(normalizeNif(""), null);
  assert.equal(normalizeNif(null), null);

  assert.equal(isValidNif("500123456"), true);
  assert.equal(isValidNif("5001234567"), true);
  assert.equal(isValidNif("500 123 456"), true);
  assert.equal(isValidNif("12345"), false);
  assert.equal(isValidNif("12345678901"), false);
  assert.equal(isValidNif("50012A456"), false);
  assert.equal(isValidNif(""), false);
  assert.equal(isValidNif(null), false);
});

test("VAT is split out of a VAT-inclusive gross amount", () => {
  assert.equal(IVA_RATE_BPS_DEFAULT, 1400);
  assert.deepEqual(vatBreakdown(1140), { subtotalCents: 1000, vatCents: 140, totalCents: 1140 });
  assert.deepEqual(vatBreakdown(25000), {
    subtotalCents: 21930,
    vatCents: 3070,
    totalCents: 25000,
  });
  assert.deepEqual(vatBreakdown(1000, 0), {
    subtotalCents: 1000,
    vatCents: 0,
    totalCents: 1000,
  });
  assert.throws(() => vatBreakdown(-1));
  assert.throws(() => vatBreakdown(1.5));
});

test("official series and invoice numbers follow the AGT format", () => {
  assert.equal(formatSeriesCode("FR", 2026), "FR2026");
  assert.equal(formatSeriesCode("FT", 2026), "FT2026");
  assert.equal(buildInvoiceNumber("FR2026", 1), "FR2026/000001");
  assert.equal(buildInvoiceNumber("FR2026", 123), "FR2026/000123");
  assert.throws(() => buildInvoiceNumber("FR2026", 0));
});

const canonical: InvoiceSignatureInput = {
  issuerTaxId: "5000000000",
  customerTaxId: "5001234567",
  documentType: "FR",
  seriesCode: "FR2026",
  sequence: 42,
  issuedAt: "2026-01-05T10:00:00.000Z",
  subtotalCents: 21930,
  vatCents: 3070,
  totalCents: 25000,
  currency: "AOA",
  previousHash: "AB12",
};

test("the canonical string is stable and ordered", () => {
  const expected =
    "5000000000;5001234567;FR;FR2026;42;2026-01-05T10:00:00.000Z;21930;3070;25000;AOA;AB12";
  assert.equal(buildInvoiceCanonical(canonical), expected);
  assert.equal(buildInvoiceCanonical(canonical), buildInvoiceCanonical(canonical));
});

test("the QR payload carries the number, total and hash", () => {
  const payload = invoiceQrPayload({
    ...canonical,
    invoiceNumber: "FR2026/000042",
    hash: "deadbeef",
  });
  assert.deepEqual(payload.split("|"), [
    "5000000000",
    "5001234567",
    "FR",
    "FR2026/000042",
    "2026-01-05T10:00:00.000Z",
    "25000",
    "AOA",
    "deadbeef",
  ]);
});

test("previous hash chaining and VAT rate formatting", () => {
  assert.equal(previousHashOf("abcdef123456"), "abcd");
  assert.equal(previousHashOf(""), "");
  assert.equal(previousHashOf(null), "");
  assert.equal(formatVatRate(1400), "14%");
  assert.equal(formatVatRate(1250), "12.5%");
  assert.equal(formatVatRate(0), "0%");
});
