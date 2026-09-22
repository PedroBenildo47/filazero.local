/**
 * Unit tests for the rate-limit policy (pure functions — no database).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RATE_LIMITS,
  isAllowed,
  retryAfterSeconds,
  windowEnd,
  windowStart,
} from "@/server/security/rate-limit.rules";

test("windowStart aligns timestamps to a fixed window", () => {
  const rule = { windowSeconds: 300, max: 10 };
  const start = new Date("2026-01-01T10:07:42.500Z");
  assert.equal(windowStart(start, rule.windowSeconds).toISOString(), "2026-01-01T10:05:00.000Z");

  const nextWindow = new Date("2026-01-01T10:10:00.000Z");
  assert.equal(
    windowStart(nextWindow, rule.windowSeconds).toISOString(),
    "2026-01-01T10:10:00.000Z",
    "a boundary instant starts a new window",
  );
});

test("windowEnd is the reset instant of the window", () => {
  const rule = { windowSeconds: 60, max: 5 };
  const start = windowStart(new Date("2026-01-01T00:00:30.000Z"), rule.windowSeconds);
  assert.equal(windowEnd(start, rule.windowSeconds).toISOString(), "2026-01-01T00:01:00.000Z");
});

test("isAllowed rejects only after the limit is exceeded", () => {
  const rule = { windowSeconds: 60, max: 3 };
  assert.equal(isAllowed(1, rule), true);
  assert.equal(isAllowed(3, rule), true, "the Nth request inside the limit passes");
  assert.equal(isAllowed(4, rule), false, "the (N+1)th request is rejected");
});

test("retryAfterSeconds points at the window reset and is never zero", () => {
  const rule = { windowSeconds: 300, max: 10 };
  const now = new Date("2026-01-01T10:00:00.000Z");
  const start = windowStart(now, rule.windowSeconds);
  assert.equal(retryAfterSeconds(now, start, rule), 300);

  const almostDone = new Date("2026-01-01T10:04:59.800Z");
  assert.equal(retryAfterSeconds(almostDone, start, rule), 1, "rounds up to at least 1 second");

  const exactlyAtReset = new Date("2026-01-01T10:05:00.000Z");
  assert.ok(retryAfterSeconds(exactlyAtReset, start, rule) >= 1);
});

test("login limits the targeted account more tightly than the IP", () => {
  const login = RATE_LIMITS.login;
  assert.ok(login.identity, "login has an identity rule");
  assert.ok(
    login.identity.max < login.ip.max,
    "per-account brute force is stricter than per-IP",
  );
  assert.ok(login.identity.max >= 3, "the account limit still allows honest typos");
});

test("every rule has a positive window and limit", () => {
  for (const [name, ruleSet] of Object.entries(RATE_LIMITS)) {
    for (const [kind, rule] of Object.entries(ruleSet)) {
      assert.ok(rule.windowSeconds > 0, `${name}.${kind} window must be positive`);
      assert.ok(rule.max > 0, `${name}.${kind} max must be positive`);
    }
  }
});

test("password recovery is the most restricted scope", () => {
  assert.ok(RATE_LIMITS.passwordForgot.identity);
  assert.ok(RATE_LIMITS.passwordForgot.identity.max <= 5);
});
