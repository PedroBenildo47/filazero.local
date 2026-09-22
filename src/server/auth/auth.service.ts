/**
 * Authentication service.
 *
 * Real credentials, real sessions, real persistence. No HTTP/cookie concerns
 * live here — route handlers attach the session cookie to the returned token.
 */
import "server-only";
import { db, isUniqueConstraintError } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { exposesPasswordResetToken, getEnv } from "@/lib/env";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import { hashPassword, verifyPassword } from "./password";
import { createSession, revokeSession } from "./session.store";
import { generateOpaqueToken, hashToken } from "./tokens";
import { sendPasswordResetEmail } from "@/server/email/email.service";
import type { EmailLang } from "@/server/email/templates";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas";
import type { User } from "@prisma/client";

export interface AuthResult {
  /** Full row; route handlers always serialize it through `publicUser`. */
  user: User;
  token: string;
  expiresAt: Date;
}

const INVALID_CREDENTIALS = "Invalid email or password";

export async function register(
  input: RegisterInput,
  meta: RequestMeta,
): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  let user;
  try {
    user = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw AppError.conflict("This email is already registered");
    }
    throw error;
  }

  const session = await createSession(user.id, meta);
  await recordAudit(db, {
    actorUserId: user.id,
    action: "auth.register",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { user, token: session.token, expiresAt: session.expiresAt };
}

export async function login(
  input: LoginInput,
  meta: RequestMeta,
): Promise<AuthResult> {
  const user = await db.user.findUnique({ where: { email: input.email } });

  // Same error for unknown email and wrong password: no account enumeration.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    await recordAudit(db, {
      actorUserId: user?.id ?? null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw AppError.unauthenticated(INVALID_CREDENTIALS);
  }

  if (user.status !== "ACTIVE") {
    throw AppError.forbidden("This account is not active");
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  const session = await createSession(user.id, meta);

  await recordAudit(db, {
    actorUserId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { user: updated, token: session.token, expiresAt: session.expiresAt };
}

export async function logout(token: string, meta: RequestMeta): Promise<void> {
  await revokeSession(token);
  await recordAudit(db, {
    action: "auth.logout",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export interface PasswordResetRequestResult {
  /** Always true — the endpoint never reveals whether the email exists. */
  accepted: true;
  /** True when the message was handed to the SMTP server. */
  delivered?: boolean;
  /**
   * Only present when email delivery is not configured AND we are outside
   * production (or `AUTH_EXPOSE_RESET_TOKEN=true`), so the flow stays testable.
   */
  resetToken?: string;
  expiresInSeconds?: number;
}

export async function requestPasswordReset(
  email: string,
  meta: RequestMeta,
  lang: EmailLang = "pt",
): Promise<PasswordResetRequestResult> {
  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.status === "DEACTIVATED") {
    return { accepted: true };
  }

  const rawToken = generateOpaqueToken();
  const ttlSeconds = getEnv().AUTH_PASSWORD_RESET_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.$transaction([
    // Invalidate any outstanding token before issuing a new one.
    db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
    }),
  ]);

  // Real delivery: the message goes out through SMTP when it is configured.
  const delivered = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token: rawToken,
    lang,
  });

  await recordAudit(db, {
    actorUserId: user.id,
    action: "auth.password_reset_requested",
    entityType: "user",
    entityId: user.id,
    metadata: { delivered, lang },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  if (delivered) {
    // The token travelled by email; never echo it back over HTTP.
    return { accepted: true, delivered: true };
  }

  if (exposesPasswordResetToken()) {
    return {
      accepted: true,
      delivered: false,
      resetToken: rawToken,
      expiresInSeconds: ttlSeconds,
    };
  }

  return { accepted: true, delivered: false };
}

export async function resetPassword(
  input: ResetPasswordInput,
  meta: RequestMeta,
): Promise<void> {
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });

  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    throw AppError.badRequest("This reset token is invalid or has expired");
  }

  const passwordHash = await hashPassword(input.password);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // Any stolen session must die when the password is reset.
    await tx.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: record.userId,
      action: "auth.password_reset",
      entityType: "user",
      entityId: record.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  meta: RequestMeta,
  currentToken?: string | null,
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound("User not found");

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) {
    throw AppError.badRequest("Current password is incorrect");
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentToken ? { tokenHash: { not: hashToken(currentToken) } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: userId,
      action: "auth.password_changed",
      entityType: "user",
      entityId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });
}
