/**
 * Email delivery service.
 *
 * `sendPasswordResetEmail` returns false when SMTP is not configured — the
 * caller then falls back to the development behaviour (returning the token only
 * outside production). A delivery failure is logged but never surfaced to the
 * caller, so the endpoint cannot be used to probe which addresses exist.
 */
import "server-only";
import { getEnv, isEmailConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendMail } from "./mailer";
import {
  renderPasswordResetEmail,
  type EmailLang,
} from "./templates";

export function buildPasswordResetLink(token: string): string {
  return `${getEnv().APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

export interface PasswordResetEmailInput {
  to: string;
  name: string;
  token: string;
  lang: EmailLang;
}

/** Returns true when the message was handed to the SMTP server. */
export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const env = getEnv();
  const rendered = renderPasswordResetEmail({
    name: input.name,
    link: buildPasswordResetLink(input.token),
    expiresInMinutes: Math.max(1, Math.round(env.AUTH_PASSWORD_RESET_TTL_SECONDS / 60)),
    lang: input.lang,
  });

  try {
    await sendMail({ to: input.to, ...rendered });
    return true;
  } catch (error) {
    logger.error({ err: error, to: input.to }, "password reset email failed");
    return false;
  }
}
