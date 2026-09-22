/**
 * PostgreSQL-backed fixed-window rate limiter.
 *
 * The counter is incremented with a single atomic upsert, so concurrent
 * requests cannot slip past the limit. Storing counters in the database (rather
 * than in process memory) means the limit is shared by every instance and
 * survives restarts.
 *
 * Only applied at the HTTP boundary (auth routes): the domain services stay
 * free of transport concerns, which is why the integration suite is unaffected.
 */
import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getClientIp } from "@/lib/http";
import {
  isAllowed,
  retryAfterSeconds,
  windowEnd,
  windowStart,
  type RateLimitRule,
} from "./rate-limit.rules";

export interface RateLimitCheck {
  key: string;
  rule: RateLimitRule;
}

export interface RateLimitOutcome {
  count: number;
  limit: number;
  allowed: boolean;
  resetAt: Date;
  retryAfterSeconds: number;
}

/** Counter key scoped to the caller's IP address. */
export function ipKey(scope: string, request: Request): string {
  const ip = getClientIp(request) ?? "unknown";
  return `${scope}:ip:${ip}`;
}

/**
 * Counter key scoped to the targeted account. The value is hashed so the
 * counter table never stores emails.
 */
export function identityKey(scope: string, value: string): string {
  const digest = createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
  return `${scope}:id:${digest}`;
}

/** Opportunistic pruning of expired windows (cheap, keeps the table tiny). */
async function pruneExpired(): Promise<void> {
  if (Math.random() > 0.05) return;
  await db.$executeRaw`DELETE FROM "rate_limit_counters" WHERE "expires_at" < now()`;
}

export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitOutcome> {
  const start = windowStart(now, rule.windowSeconds);
  const expiresAt = windowEnd(start, rule.windowSeconds);

  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_counters" ("key", "window_start", "count", "expires_at")
    VALUES (${key}, ${start}, 1, ${expiresAt})
    ON CONFLICT ("key", "window_start")
    DO UPDATE SET "count" = "rate_limit_counters"."count" + 1
    RETURNING "count"
  `;

  const count = Number(rows[0]?.count ?? 1);
  await pruneExpired();

  return {
    count,
    limit: rule.max,
    allowed: isAllowed(count, rule),
    resetAt: expiresAt,
    retryAfterSeconds: retryAfterSeconds(now, start, rule),
  };
}

/**
 * Consumes every check and throws `RATE_LIMITED` (429 + `Retry-After`) as soon
 * as one of them is exhausted.
 */
export async function enforceRateLimits(
  checks: RateLimitCheck[],
): Promise<void> {
  for (const check of checks) {
    const outcome = await consumeRateLimit(check.key, check.rule);
    if (!outcome.allowed) {
      throw AppError.rateLimited(outcome.retryAfterSeconds);
    }
  }
}
