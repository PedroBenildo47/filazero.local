/**
 * Session store (database-backed).
 *
 * A session is an opaque token whose HMAC digest lives in the `sessions` table.
 * This module contains no HTTP/cookie logic, so it can be exercised directly by
 * integration tests.
 */
import "server-only";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { RequestMeta } from "@/lib/http";
import type { AuthContext } from "@/server/context";
import { generateOpaqueToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "filazero_session";

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

export async function createSession(
  userId: string,
  meta: RequestMeta,
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const ttlSeconds = getEnv().AUTH_SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
    select: { id: true },
  });

  return { token, expiresAt, sessionId: session.id };
}

/**
 * Resolves a raw token into an authentication context, or null when the token
 * is unknown, revoked, expired, or belongs to a non-active user.
 */
export async function resolveAuthContext(
  token: string | null | undefined,
): Promise<AuthContext | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { memberships: true } } },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
    memberships: session.user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      branchId: membership.branchId,
      role: membership.role,
      status: membership.status,
    })),
  };
}

/** Revokes the session identified by a raw token. Idempotent. */
export async function revokeSession(token: string): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every active session of a user, optionally sparing one token. */
export async function revokeAllSessionsForUser(
  userId: string,
  exceptToken?: string,
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptToken ? { tokenHash: { not: hashToken(exceptToken) } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
