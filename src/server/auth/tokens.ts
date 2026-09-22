/**
 * Opaque token generation and hashing.
 *
 * Session and password-reset tokens are random 256-bit values returned to the
 * client exactly once. The database stores only a keyed HMAC-SHA256 digest, so
 * a database leak alone does not expose usable tokens.
 */
import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(token).digest("hex");
}
