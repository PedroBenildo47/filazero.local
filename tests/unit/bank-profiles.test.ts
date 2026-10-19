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
  DEFAULT_BANK_LABEL,
  resolveBankName,
} from "@/server/billing/bank-profiles";

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
  assert.equal(DEFAULT_BANK_LABEL, "Banco BIC");
  assert.ok(resolveBankName(null, null).length > 0);
});

test("an unknown profile string is used verbatim rather than dropped", () => {
  assert.equal(resolveBankName(null, "BANCO_X"), "BANCO_X");
});
