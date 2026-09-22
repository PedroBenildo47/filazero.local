/**
 * HTTP response envelope and route error handling.
 *
 * Success: { "data": ... }
 * Failure: { "error": { "code": "...", "message": "...", "details"?: ... } }
 *
 * Unexpected errors are logged with technical detail and returned as a generic
 * 500 — stack traces and internals are never exposed to clients.
 */
import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { Prisma } from "@/lib/db";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function fail(error: AppError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    { status: error.status, ...(error.headers ? { headers: error.headers } : {}) },
  );
}

/** Normalises any thrown value into an `AppError` suitable for the client. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return AppError.validation("Invalid request data", error.flatten());
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return AppError.conflict("Resource already exists");
    if (error.code === "P2025") return AppError.notFound();
    if (error.code === "P2003") {
      return AppError.badRequest("Related resource does not exist");
    }
    // P2023 = malformed value for a column, e.g. a non-UUID path parameter.
    if (error.code === "P2023") {
      return AppError.badRequest("Malformed identifier");
    }
  }

  return AppError.internal();
}

/**
 * Wraps a route handler: converts thrown errors into the standard envelope and
 * logs unexpected ones. Usage:
 *
 *   export const POST = route(async (req) => { ... });
 */
export function route<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: Args): Promise<NextResponse> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === "INTERNAL") {
        logError(error, { url: request.url, method: request.method });
      }
      return fail(appError);
    }
  };
}

/** Best-effort client IP extraction behind a trusted proxy. */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

/** Request metadata persisted on sessions and audit logs. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export function getRequestMeta(request: Request): RequestMeta {
  const userAgent = request.headers.get("user-agent");
  return {
    ipAddress: getClientIp(request),
    userAgent: userAgent ? userAgent.slice(0, 255) : null,
  };
}
