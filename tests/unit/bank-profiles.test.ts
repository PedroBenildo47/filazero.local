/**
 * Unit tests for the tolerant bank-profile label resolution.
 *
 * The rule under test: a missing secondary bank field never crashes the
 * checkout — the bank display name always resolves to something readable, while
 * account numbers/IBANs are never invented (they are not part of this module).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANGOLAN_BANK_PROFILES,
  BIC_BANK_DEFAULTS,
  DEFAULT_BANK_LABEL,
  resolveBankName,
} from "@/server/billing/bank-profiles";
import { isValidAngolaIban, toAngolaIban } from "@/server/billing/qr-payment";

test("resolveBankName prefers the configured name", () => {
  assert.equal(resolveBankName("Meu Banco, S.A.", "BIC"), "Meu Banco, S.A.");
  assert.equal(resolveBankName("  Espaços  ", null), "Espaços");
});

test("resolveBankName falls back to the selected profile label", () => {
  assert.equal(resolveBankName("", "BAI"), ANGOLAN_BANK_PROFILES.BAI);
  assert.equal(resolveBankName(null, "BFA"), ANGOLAN_BANK_PROFILES.BFA);
  assert.equal(resolveBankName(undefined, "BIC"), ANGOLAN_BANK_PROFILES.BIC);
});

test("resolveBankName never returns an empty string (BIC default)", () => {
  assert.equal(resolveBankName(null, null), DEFAULT_BANK_LABEL);
  assert.equal(resolveBankName("   ", undefined), DEFAULT_BANK_LABEL);
  assert.equal(DEFAULT_BANK_LABEL, "Banco BIC Angola");
  assert.ok(resolveBankName(null, null).length > 0);
});

test("an unknown profile string is used verbatim rather than dropped", () => {
  assert.equal(resolveBankName(null, "BANCO_X"), "BANCO_X");
});

test("the Banco BIC defaults are complete and produce a valid Angolan IBAN", () => {
  assert.equal(BIC_BANK_DEFAULTS.bankName, "Banco BIC Angola");
  assert.equal(BIC_BANK_DEFAULTS.accountNumber, "22109917510001");
  assert.equal(BIC_BANK_DEFAULTS.gui, "BIC");
  assert.equal(BIC_BANK_DEFAULTS.holder, "Pedro Benildo Lando Capita");
  // The 21-digit BBAN promoted to its canonical IBAN (mod-97 valid).
  assert.equal(toAngolaIban(BIC_BANK_DEFAULTS.bban), "AO06005100002109917510176");
  assert.equal(isValidAngolaIban(BIC_BANK_DEFAULTS.bban), true);
});
