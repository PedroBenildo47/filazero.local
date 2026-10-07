/**
 * Queue public codes.
 *
 * A queue's public code is the customer-facing identifier used by QR codes,
 * direct links and manual entry. It is short, unambiguous when read aloud or
 * typed, and independent from the internal UUID.
 *
 * Kept in a pure module (no Prisma / no `server-only`) so it can be unit tested
 * without a database.
 */
import { randomBytes } from "node:crypto";

/** Alphabet without visually ambiguous characters (no I/O/0/1). */
export const QUEUE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const QUEUE_CODE_LENGTH = 8;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_CODE_PATTERN = /^[A-Z0-9]{6,12}$/;

/** Cryptographically random public code (collisions retried by the caller). */
export function generateQueueCode(length = QUEUE_CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += QUEUE_CODE_ALPHABET[bytes[index]! % QUEUE_CODE_ALPHABET.length];
  }
  return code;
}

/** True when the value is a queue UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/** True when the value looks like a public code (already upper-cased). */
export function isQueueCode(value: string): boolean {
  return QUEUE_CODE_PATTERN.test(value.trim().toUpperCase());
}
