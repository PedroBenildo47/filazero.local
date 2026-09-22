/**
 * Unit tests for payment webhook signature verification (no database).
 *
 * The scheme is Stripe-compatible (`t=<unix>,v1=<hex hmac>` over `"<t>.<body>"`),
 * so these cases also document what a real provider endpoint must send.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSignatureHeader,
  computeSignature,
  verifySignature,
} from "@/server/billing/signature";

const SECRET = "whsec_test_0123456789abcdef";
const PAYLOAD = JSON.stringify({
  id: "evt_1",
  type: "payment.succeeded",
  data: { reference: "FZ-ABC" },
});

test("a correctly signed payload verifies", () => {
  const header = buildSignatureHeader(SECRET, PAYLOAD);
  assert.deepEqual(verifySignature({ secret: SECRET, header, payload: PAYLOAD }), {
    ok: true,
    timestamp: Number(header.slice(2, header.indexOf(","))),
  });
});

test("the signature follows the documented formula", () => {
  const timestamp = 1_700_000_000;
  const header = buildSignatureHeader(SECRET, PAYLOAD, timestamp);
  const expected = computeSignature(SECRET, timestamp, PAYLOAD);
  assert.equal(header, `t=${timestamp},v1=${expected}`);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test("a tampered body is rejected", () => {
  const header = buildSignatureHeader(SECRET, PAYLOAD);
  const tampered = PAYLOAD.replace("FZ-ABC", "FZ-XYZ");
  const result = verifySignature({ secret: SECRET, header, payload: tampered });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "mismatch");
});

test("another secret does not verify", () => {
  const header = buildSignatureHeader("whsec_other_secret_value", PAYLOAD);
  assert.equal(
    verifySignature({ secret: SECRET, header, payload: PAYLOAD }).reason,
    "mismatch",
  );
});

test("a missing header is rejected", () => {
  assert.equal(
    verifySignature({ secret: SECRET, header: null, payload: PAYLOAD }).reason,
    "missing",
  );
  assert.equal(
    verifySignature({ secret: SECRET, header: "", payload: PAYLOAD }).reason,
    "missing",
  );
});

test("malformed headers are rejected", () => {
  for (const header of ["garbage", "t=abc,v1=deadbeef", "v1=deadbeef", "t=123"]) {
    const result = verifySignature({ secret: SECRET, header, payload: PAYLOAD });
    assert.equal(result.ok, false, `header "${header}" should not verify`);
    assert.ok(
      result.reason === "malformed" || result.reason === "mismatch",
      `unexpected reason for "${header}": ${result.reason}`,
    );
  }
});

test("a stale timestamp is rejected (anti-replay)", () => {
  const now = 1_700_000_000;
  const header = buildSignatureHeader(SECRET, PAYLOAD, now - 600);
  const result = verifySignature({
    secret: SECRET,
    header,
    payload: PAYLOAD,
    toleranceSeconds: 300,
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
});

test("a future timestamp beyond tolerance is rejected too", () => {
  const now = 1_700_000_000;
  const header = buildSignatureHeader(SECRET, PAYLOAD, now + 600);
  assert.equal(
    verifySignature({ secret: SECRET, header, payload: PAYLOAD, now }).reason,
    "expired",
  );
});

test("a timestamp inside the tolerance window is accepted", () => {
  const now = 1_700_000_000;
  const header = buildSignatureHeader(SECRET, PAYLOAD, now - 120);
  assert.equal(
    verifySignature({ secret: SECRET, header, payload: PAYLOAD, toleranceSeconds: 300, now })
      .ok,
    true,
  );
});

test("extra header fields do not break verification", () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const header = `t=${timestamp},v0=ignored,v1=${computeSignature(SECRET, timestamp, PAYLOAD)}`;
  assert.equal(
    verifySignature({ secret: SECRET, header, payload: PAYLOAD }).ok,
    true,
  );
});
