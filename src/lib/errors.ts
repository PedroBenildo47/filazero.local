/**
 * Application error model.
 *
 * Every layer throws `AppError` for expected failures. The HTTP layer converts
 * them into a consistent JSON envelope; unexpected errors are logged and
 * returned as a generic 500 without leaking internals.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUEUE_CLOSED"
  | "INVALID_STATE"
  | "SESSION_EXPIRED"
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUEUE_CLOSED: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  // 402 is exactly "you must pay before this can happen" — used for an expired
  // or missing subscription.
  PAYMENT_REQUIRED: 402,
  // Exceeding an entitlement is a 403: the caller is authenticated but the plan
  // does not allow it.
  QUOTA_EXCEEDED: 403,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Extra response headers (e.g. `Retry-After` on 429). */
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: unknown,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.headers = headers;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError("BAD_REQUEST", message, details);
  }
  static validation(message: string, details?: unknown) {
    return new AppError("VALIDATION_ERROR", message, details);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError("UNAUTHENTICATED", message);
  }
  static sessionExpired(message = "Session expired") {
    return new AppError("SESSION_EXPIRED", message);
  }
  static forbidden(message = "You do not have permission to do this") {
    return new AppError("FORBIDDEN", message);
  }
  static notFound(message = "Resource not found") {
    return new AppError("NOT_FOUND", message);
  }
  static conflict(message: string) {
    return new AppError("CONFLICT", message);
  }
  static queueClosed(message = "This queue is not accepting new customers") {
    return new AppError("QUEUE_CLOSED", message);
  }
  static invalidState(message: string) {
    return new AppError("INVALID_STATE", message);
  }
  static serviceUnavailable(message: string, details?: unknown) {
    return new AppError("SERVICE_UNAVAILABLE", message, details);
  }
  static paymentRequired(
    message = "An active subscription is required for this operation",
    details?: unknown,
  ) {
    return new AppError("PAYMENT_REQUIRED", message, details);
  }
  static quotaExceeded(
    resource: string,
    current: number,
    limit: number,
  ) {
    return new AppError(
      "QUOTA_EXCEEDED",
      `Your plan allows ${limit} ${resource} and you already have ${current}`,
      { resource, current, limit },
    );
  }
  static rateLimited(retryAfterSeconds: number) {
    const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
    return new AppError(
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      { retryAfterSeconds: retryAfter },
      {
        "Retry-After": String(retryAfter),
        "RateLimit-Limit": "reached",
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(retryAfter),
      },
    );
  }
  static internal(message = "Internal server error") {
    return new AppError("INTERNAL", message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
