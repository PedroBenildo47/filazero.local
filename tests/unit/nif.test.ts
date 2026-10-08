/**
 * Unit tests for the shared Angolan NIF rules (`@/lib/nif`).
 *
 * These are the pure rules reused by the API schemas and the registration form:
 * company NIFs are 10 digits starting with 5, individual NIFs are 9 digits, and
 * the full 14-character BI is accepted when the province code is valid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANGOLAN_PROVINCE_CODES,
  isValidCompanyNif,
  isValidNif,
  nifKind,
  normalizeNif,
} from "@/lib/nif";

test("normalizeNif strips separators and upper-cases letters", () => {
  assert.equal(normalizeNif(" 541 700 0000 "), "5417000000");
  assert.equal(normalizeNif("541.700.0000"), "5417000000");
  assert.equal(normalizeNif("541-700-0000"), "5417000000");
  assert.equal(normalizeNif("000123456la041"), "000123456LA041");
  assert.equal(normalizeNif(""), null);
  assert.equal(normalizeNif("   "), null);
  assert.equal(normalizeNif(null), null);
  assert.equal(normalizeNif(undefined), null);
});

test("company NIF: 10 digits starting with 5", () => {
  assert.equal(isValidCompanyNif("5417000000"), true);
  assert.equal(isValidCompanyNif("500 123 456 7"), true);
  assert.equal(nifKind("5417000000"), "COMPANY");

  // Wrong length, wrong prefix or degenerate values are rejected.
  assert.equal(isValidCompanyNif("541700000"), false);
  assert.equal(isValidCompanyNif("6417000000"), false);
  assert.equal(isValidCompanyNif("4417000000"), false);
  assert.equal(isValidCompanyNif("5555555555"), false);
  assert.equal(isValidCompanyNif(""), false);
  assert.equal(isValidCompanyNif(null), false);
});

test("individual NIF: 9 digits", () => {
  assert.equal(isValidNif("500123456"), true);
  assert.equal(nifKind("500123456"), "INDIVIDUAL");
  assert.equal(isValidNif("000000000"), false, "all-zero is degenerate");
  assert.equal(isValidNif("111111111"), false, "all-same is degenerate");
});

test("individual NIF: the full 14-character BI with a valid province", () => {
  assert.equal(isValidNif("000123456LA041"), true);
  assert.equal(nifKind("000123456LA041"), "BI");
  assert.equal(isValidNif("000123456LA041".toLowerCase()), true);

  // Unknown province code, wrong layout or wrong length are rejected.
  assert.equal(isValidNif("000123456ZZ041"), false);
  assert.equal(isValidNif("000123456LA04"), false);
  assert.equal(isValidNif("00012345LA041"), false);
  assert.equal(isValidNif("0001234561A041"), false);
});

test("isValidNif rejects malformed and impossible values", () => {
  assert.equal(isValidNif("12345"), false);
  assert.equal(isValidNif("12345678901"), false);
  assert.equal(isValidNif("50012A456"), false);
  assert.equal(isValidNif("1234567890"), false, "10 digits must start with 5");
  assert.equal(isValidNif(""), false);
  assert.equal(isValidNif(null), false);
});

test("the province table contains every Angolan province", () => {
  assert.equal(ANGOLAN_PROVINCE_CODES.size, 18);
  for (const code of ["LA", "BG", "BO", "HA", "CB", "ZA"]) {
    assert.equal(ANGOLAN_PROVINCE_CODES.has(code), true, `missing province ${code}`);
  }
});
