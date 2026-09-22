/**
 * Unit tests for the PT/EN dictionaries.
 *
 * TypeScript already guarantees that `en` has every key `pt` has; these tests
 * cover the runtime guarantees (nothing empty, interpolation, error mapping).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LANG,
  LANGS,
  dictionaries,
  isErrorCode,
  isLang,
  localeTag,
  translate,
} from "@/lib/i18n";

test("both languages are registered with the same keys", () => {
  const ptKeys = Object.keys(dictionaries.pt).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.deepEqual(enKeys, ptKeys);
  assert.ok(ptKeys.length > 100, "the dictionary covers the whole UI");
  assert.deepEqual([...LANGS], ["pt", "en"]);
  assert.equal(DEFAULT_LANG, "pt");
});

test("no translation is empty or left as a placeholder", () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(dictionaries[lang])) {
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
      assert.ok(!value.includes("TODO"), `${lang}.${key} is unfinished`);
    }
  }
});

test("translate interpolates parameters and keeps unknown ones visible", () => {
  assert.equal(translate("pt", "account.position", { position: 4 }), "Posição 4");
  assert.equal(translate("en", "account.position", { position: 4 }), "Position 4");
  assert.equal(translate("pt", "staff.countWaiting"), "À espera");
  assert.equal(
    translate("en", "queue.waiting", { count: 3 }),
    "3 person(s) waiting",
  );
  // A placeholder with no matching param is left untouched rather than blanked.
  assert.match(translate("pt", "account.position"), /\{position\}/);
});

test("the two languages actually differ where it matters", () => {
  for (const key of ["landing.title", "staff.callNext", "errors.FORBIDDEN"] as const) {
    assert.notEqual(dictionaries.pt[key], dictionaries.en[key], `${key} is untranslated`);
  }
});

test("localeTag maps to a usable BCP-47 tag", () => {
  assert.equal(localeTag("pt"), "pt-PT");
  assert.equal(localeTag("en"), "en-GB");
  // Must not throw when handed to Intl.
  assert.ok(new Intl.DateTimeFormat(localeTag("en")).format(new Date(0)).length > 0);
});

test("the error vocabulary is covered by both dictionaries", () => {
  const codes = [
    "BAD_REQUEST",
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "SESSION_EXPIRED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "QUEUE_CLOSED",
    "INVALID_STATE",
    "RATE_LIMITED",
    "INTERNAL",
  ];
  for (const code of codes) {
    assert.ok(isErrorCode(code), `${code} should be a known error code`);
    for (const lang of LANGS) {
      const message = translate(lang, `errors.${code}` as "errors.INTERNAL");
      assert.ok(message.length > 0, `missing ${lang} message for ${code}`);
    }
  }
  assert.equal(isErrorCode("NOT_A_CODE"), false);
  assert.equal(isErrorCode(undefined), false);
});

test("isLang only accepts supported languages", () => {
  assert.equal(isLang("pt"), true);
  assert.equal(isLang("en"), true);
  assert.equal(isLang("fr"), false);
  assert.equal(isLang(null), false);
});
