/**
 * Edge middleware for the API surface.
 *
 * Responsibilities:
 *   1. CORS hardening — a browser request carrying an `Origin` is only allowed
 *      when it is same-origin or explicitly listed in `ALLOWED_ORIGINS`/`APP_URL`.
 *      Anything else gets a 403 before it can reach a route handler.
 *   2. Preflight — answers `OPTIONS` with the correct CORS headers, or 403.
 *   3. `Vary: Origin` — so caches never serve one origin's response to another.
 *
 * Security headers (HSTS, CSP, nosniff, …) are set statically in
 * `next.config.mjs` so they also cover non-API routes.
 *
 * Runs on the Edge runtime: no database, no Node APIs — only headers.
 */
import { NextResponse, type NextRequest } from "next/server";

const CORS_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const CORS_HEADERS = "Content-Type";

/** Origins explicitly allowed, from `ALLOWED_ORIGINS` and `APP_URL`. */
function allowedOrigins(): string[] {
  const raw = `${process.env.ALLOWED_ORIGINS ?? ""},${process.env.APP_URL ?? ""}`;
  return raw
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function isPermitted(origin: string | null, host: string | null): boolean {
  // No Origin header: not a cross-origin browser request (curl, mobile app…).
  if (!origin) return true;
  // "null" comes from sandboxed frames / file:// — never trusted implicitly.
  if (origin === "null") return false;

  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  // Same-origin requests always pass, whatever the configured allowlist.
  if (host && originHost === host) return true;

  return allowedOrigins().includes(origin.replace(/\/$/, ""));
}

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const permitted = isPermitted(origin, host);

  if (request.method === "OPTIONS") {
    if (!permitted) {
      return new NextResponse(null, { status: 403, headers: { Vary: "Origin" } });
    }
    return new NextResponse(null, {
      status: 204,
      headers: origin ? corsHeaders(origin) : { Vary: "Origin" },
    });
  }

  if (!permitted) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Origin not allowed" } },
      { status: 403, headers: { Vary: "Origin" } },
    );
  }

  const response = NextResponse.next();
  response.headers.set("Vary", "Origin");
  if (origin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
