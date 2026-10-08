/**
 * Unit tests for the pure Angolan bank QR (EMVCo Merchant-Presented Mode).
 *
 * No database, no network: TLV encoding, the CRC-16/CCITT-FALSE checksum, the
 * Angolan IBAN check digits and the full payload assembly are deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AOA_CURRENCY_CODE,
  ANGOLA_COUNTRY_CODE,
  buildAngolaBankQr,
  crc16ccitt,
  formatQrAmount,
  isValidAngolaIban,
  normalizeIban,
  parseTlv,
  tlv,
  verifyEmvCoChecksum,
} from "@/server/billing/qr-payment";

/** A real-shaped, mod-97-valid Angolan IBAN. */
const IBAN = "AO06000600000100037131174";

test("CRC-16/CCITT-FALSE matches the canonical check value", () => {
  // Standard check value for poly 0x1021, init 0xFFFF, no reflection.
  assert.equal(crc16ccitt("123456789"), "29B1");
  assert.equal(crc16ccitt(""), "FFFF");
  assert.match(crc16ccitt("qualquer"), /^[0-9A-F]{4}$/);
});

test("TLV encodes the byte length and rejects malformed input", () => {
  assert.equal(tlv("00", "01"), "000201");
  assert.equal(tlv("59", "Café"), "5905Café"); // 5 UTF-8 bytes, not 4 chars
  assert.throws(() => tlv("1", "x"));
  assert.throws(() => tlv("00", "x".repeat(100)));
});

test("parseTlv is the inverse of tlv for a flat payload", () => {
  const payload = tlv("00", "01") + tlv("53", "973") + tlv("58", "AO");
  assert.deepEqual(parseTlv(payload), [
    { tag: "00", length: 2, value: "01" },
    { tag: "53", length: 3, value: "973" },
    { tag: "58", length: 2, value: "AO" },
  ]);
  assert.throws(() => parseTlv("0005ab")); // declares 5 bytes, only 2 present
});

test("Angolan IBAN validation uses the ISO 13616 mod-97 check", () => {
  assert.equal(isValidAngolaIban(IBAN), true);
  assert.equal(isValidAngolaIban("AO06 0006 0000 0100 0371 31174"), true);
  assert.equal(isValidAngolaIban("AO06000600000100037131175"), false);
  assert.equal(isValidAngolaIban("PT50000201231234567890154"), false);
  assert.equal(isValidAngolaIban(""), false);
  assert.equal(normalizeIban(" ao06 0006-0000 "), "AO0600060000");
});

test("formatQrAmount uses an explicit decimal point", () => {
  assert.equal(formatQrAmount(0), "0.00");
  assert.equal(formatQrAmount(123456), "1234.56");
  assert.throws(() => formatQrAmount(-1));
  assert.throws(() => formatQrAmount(1.5));
});

test("a dynamic bank QR carries the amount, currency, country and a valid CRC", () => {
  const payload = buildAngolaBankQr({
    iban: IBAN,
    merchantName: "FilaZero, Lda",
    merchantCity: "Luanda",
    amountCents: 7500000,
    reference: "FZ-ABC123",
    acquirerGui: "0040",
  });

  assert.equal(verifyEmvCoChecksum(payload), true);
  assert.equal(payload.slice(-8, -4), "6304");

  const top = Object.fromEntries(parseTlv(payload).map((e) => [e.tag, e.value]));
  assert.equal(top["00"], "01");
  assert.equal(top["01"], "12"); // dynamic
  assert.equal(top["53"], AOA_CURRENCY_CODE);
  assert.equal(top["54"], "75000.00");
  assert.equal(top["58"], ANGOLA_COUNTRY_CODE);
  assert.equal(top["59"], "FilaZero, Lda");
  assert.equal(top["60"], "Luanda");

  const domestic = Object.fromEntries(
    parseTlv(top["26"]!).map((e) => [e.tag, e.value]),
  );
  assert.equal(domestic["00"], "0040");
  assert.equal(domestic["01"], IBAN);
  assert.equal(domestic["02"], "FZ-ABC123");

  const additional = Object.fromEntries(
    parseTlv(top["62"]!).map((e) => [e.tag, e.value]),
  );
  assert.equal(additional["05"], "FZ-ABC123");
});

test("a static bank QR omits the amount and marks the initiation as static", () => {
  const payload = buildAngolaBankQr({
    iban: IBAN,
    merchantName: "Clínica Alfa",
    reference: "FZ-STATIC1",
  });
  assert.equal(verifyEmvCoChecksum(payload), true);
  const top = Object.fromEntries(parseTlv(payload).map((e) => [e.tag, e.value]));
  assert.equal(top["01"], "11");
  assert.equal(top["54"], undefined);
  assert.equal(top["60"], "Luanda"); // default city
});

test("building a QR refuses an invalid IBAN or a missing reference", () => {
  assert.throws(() =>
    buildAngolaBankQr({ iban: "AO00", merchantName: "X", reference: "R" }),
  );
  assert.throws(() =>
    buildAngolaBankQr({ iban: IBAN, merchantName: "", reference: "R" }),
  );
  assert.throws(() =>
    buildAngolaBankQr({ iban: IBAN, merchantName: "X", reference: "  " }),
  );
});
