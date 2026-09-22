/**
 * Payment webhook signature verification.
 *
 * Scheme (identical to Stripe's, so a Stripe endpoint can be plugged in without
 * changing the verifier):
 *
 *   header:  t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>
 *
 * Properties:
 *   - the signature covers the **raw** body, so the route must not re-serialise
 *     JSON before verifying;
 *   - `timingSafeEqual` avoids leaking the expected digest through timing;
 *   - a timestamp tolerance window makes captured payloads useless after a
 *     short period (anti-replay), and the unique `provider_event_id` column
 *     makes a replayed-but-still-fresh event idempotent.
 *
 * Pure module: no I/O, fully unit-tested.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-filazero-signature";

export type SignatureFailure = "malformed" | "expired" | "mismatch" | "missing";

export interface SignatureVerification {
  ok: boolean;
  reason?: SignatureFailure;
  timestamp?: number;
}

export function computeSignature(
  secret: string,
  timestamp: number | string,
  payload: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

/** Builds a signature header value (used by tests and by outbound calls). */
export function buildSignatureHeader(
  secret: string,
  payload: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestampSeconds},v1=${computeSignature(secret, timestampSeconds, payload)}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseHeader(header: string): { t?: string; v1?: string } {
  const parsed: { t?: string; v1?: string } = {};
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") parsed.t = value;
    else if (key === "v1") parsed.v1 = value;
  }
  return parsed;
}

export function verifySignature(options: {
  secret: string;
  header: string | null | undefined;
  payload: string;
  toleranceSeconds?: number;
  now?: number;
}): SignatureVerification {
  const {
    secret,
    header,
    payload,
    toleranceSeconds = 300,
    now = Math.floor(Date.now() / 1000),
  } = options;

  if (!header) return { ok: false, reason: "missing" };

  const { t, v1 } = parseHeader(header);
  if (!t || !v1 || !/^\d+$/.test(t)) return { ok: false, reason: "malformed" };

  const timestamp = Number(t);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { ok: false, reason: "expired", timestamp };
  }

  const expected = computeSignature(secret, timestamp, payload);
  if (!safeEqual(expected, v1)) return { ok: false, reason: "mismatch", timestamp };

  return { ok: true, timestamp };
}
