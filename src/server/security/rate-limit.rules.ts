/**
 * Rate-limit rules (pure data + pure functions).
 *
 * Kept free of I/O so the policy can be unit-tested and reviewed in one place.
 * The counters themselves live in PostgreSQL (see `rate-limit.service.ts`), so
 * the limits also hold across instances and restarts.
 *
 * Windows are fixed (aligned to `windowSeconds`), which keeps the atomic
 * upsert trivial and the memory/row footprint bounded by the window size.
 */

export interface RateLimitRule {
  /** Length of the counting window, in seconds. */
  windowSeconds: number;
  /** Maximum number of requests allowed inside the window. */
  max: number;
}

export interface RateLimitRuleSet {
  ip: RateLimitRule;
  /** Optional second limit keyed on the targeted account (e.g. login email). */
  identity?: RateLimitRule;
}

export const RATE_LIMITS: Record<
  "login" | "register" | "passwordForgot" | "passwordReset" | "passwordChange",
  RateLimitRuleSet
> = {
  // Brute force: tight per account, looser per IP (shared NAT must still work).
  login: {
    ip: { windowSeconds: 300, max: 60 },
    identity: { windowSeconds: 300, max: 8 },
  },
  // Account creation: stops scripted mass registration without blocking an office.
  register: {
    ip: { windowSeconds: 3_600, max: 50 },
  },
  // Recovery: a reset email is expensive and abusable.
  passwordForgot: {
    ip: { windowSeconds: 900, max: 30 },
    identity: { windowSeconds: 900, max: 3 },
  },
  passwordReset: {
    ip: { windowSeconds: 900, max: 30 },
  },
  passwordChange: {
    ip: { windowSeconds: 900, max: 30 },
  },
};

/** Start of the fixed window containing `now`, aligned to `windowSeconds`. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** End (exclusive) of the fixed window, i.e. when the counter resets. */
export function windowEnd(start: Date, windowSeconds: number): Date {
  return new Date(start.getTime() + windowSeconds * 1000);
}

/** Whether a request that would bring the counter to `count` is still allowed. */
export function isAllowed(count: number, rule: RateLimitRule): boolean {
  return count <= rule.max;
}

/** Seconds the caller should wait before retrying, given the current window. */
export function retryAfterSeconds(
  now: Date,
  start: Date,
  rule: RateLimitRule,
): number {
  const end = windowEnd(start, rule.windowSeconds);
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000));
}
