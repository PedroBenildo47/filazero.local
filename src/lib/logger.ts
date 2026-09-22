/**
 * Structured JSON logger (pino).
 *
 * Rules: never log passwords, tokens, full request bodies containing secrets or
 * other sensitive values. Log identifiers, actions and technical errors.
 */
import "server-only";
import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level,
  base: undefined,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "password_hash",
      "token",
      "tokenHash",
      "token_hash",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

export function logError(error: unknown, context?: Record<string, unknown>): void {
  if (error instanceof Error) {
    logger.error({ err: error, ...context }, error.message);
    return;
  }
  logger.error({ err: String(error), ...context }, "Unhandled error");
}
