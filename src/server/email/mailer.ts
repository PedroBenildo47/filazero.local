/**
 * SMTP transport.
 *
 * Configured entirely through environment variables; when `SMTP_HOST` is unset
 * the application does not try to send anything (and says so), rather than
 * pretending an email was delivered.
 */
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const globalForMailer = globalThis as unknown as {
  filazeroMailer?: Transporter;
};

function buildTransporter(): Transporter {
  const env = getEnv();
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: env.SMTP_REQUIRE_TLS,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" }
      : undefined,
    // Opportunistic STARTTLS unless the server offers none (a plain local sink
    // simply proceeds in clear text).
    tls: { rejectUnauthorized: env.NODE_ENV === "production" },
  });
}

function getTransporter(): Transporter {
  if (!globalForMailer.filazeroMailer) {
    globalForMailer.filazeroMailer = buildTransporter();
  }
  return globalForMailer.filazeroMailer;
}

/** Sends a message. Throws on transport failure (the caller decides the UX). */
export async function sendMail(message: MailMessage): Promise<void> {
  const env = getEnv();
  const info = await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  logger.info(
    { messageId: info.messageId, to: message.to, subject: message.subject },
    "email sent",
  );
}
