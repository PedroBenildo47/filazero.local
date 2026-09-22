/**
 * Cookie-aware access to the current session.
 *
 * Kept apart from `session.store.ts` so the DB layer stays testable without a
 * Next.js request scope. Only route handlers / server components may import it.
 */
import "server-only";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/server/context";
import { SESSION_COOKIE, resolveAuthContext } from "./session.store";

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Returns the current context, or null when unauthenticated. */
export async function getAuthContext(): Promise<AuthContext | null> {
  return resolveAuthContext(await readSessionToken());
}

/** Returns the current context or throws 401. */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) {
    throw AppError.unauthenticated();
  }
  return context;
}
