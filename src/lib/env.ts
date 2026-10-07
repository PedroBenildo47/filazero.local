/**
 * Environment configuration.
 *
 * Values are validated lazily (on first access) rather than at module load, so
 * that `next build` does not require a live database or secrets. At runtime the
 * first request fails fast if configuration is missing or invalid.
 *
 * Never import this module from a client component.
 */
import "server-only";
import { z } from "zod";

/** Treats an empty string as "not set" so optional vars can be left blank. */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  );

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  APP_NAME: z.string().min(1).default("FilaZero"),
  APP_URL: z.string().url(),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  /**
   * TEST/DEV ONLY. When true, POST /api/auth/password/forgot returns the raw
   * reset token in the response (no email provider is wired yet). Must stay
   * false in production.
   */
  AUTH_EXPOSE_RESET_TOKEN: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  PASSWORD_HASH_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // --- Billing ------------------------------------------------------------
  PAYMENT_PROVIDER: z.enum(["invoice", "stripe"]).default("invoice"),
  /**
   * Secret used to verify payment webhooks (HMAC-SHA256, Stripe-style
   * `t=<unix>,v1=<hex>` header). When unset the webhook refuses to run — there
   * is no unsigned path that could mark a transaction as paid.
   */
  PAYMENT_WEBHOOK_SECRET: blankToUndefined(z.string().min(16).optional()),
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  /** Optional hosted gateway URL template, e.g. `https://pay.example/checkout?ref={reference}&amount={amount}`. */
  PAYMENT_CHECKOUT_URL_TEMPLATE: blankToUndefined(z.string().url().optional()),
  /** B2B bank transfer details shown on the invoice. */
  BILLING_BANK_NAME: blankToUndefined(z.string().max(160).optional()),
  BILLING_BANK_ACCOUNT: blankToUndefined(z.string().max(80).optional()),
  BILLING_BANK_IBAN: blankToUndefined(z.string().max(80).optional()),
  /** Stripe (only needed when PAYMENT_PROVIDER=stripe). */
  STRIPE_SECRET_KEY: blankToUndefined(z.string().min(10).optional()),
  STRIPE_WEBHOOK_SECRET: blankToUndefined(z.string().min(10).optional()),
  /**
   * Multicaixa Express through an EMIS/aggregator gateway. When unset, the
   * method still issues a real, quotable reference (confirmed by the signed
   * webhook) and shows the payer the step-by-step instructions.
   */
  MULTICAIXA_API_URL: blankToUndefined(z.string().url().optional()),
  MULTICAIXA_API_KEY: blankToUndefined(z.string().min(10).optional()),
  /** Merchant phone / name shown in the Multicaixa Express instructions. */
  MULTICAIXA_MERCHANT_PHONE: blankToUndefined(z.string().max(32).optional()),
  MULTICAIXA_MERCHANT_NAME: blankToUndefined(z.string().max(160).optional()),
  // --- Invoicing (AGT) ----------------------------------------------------
  /** Issuer NIF (emitente) printed on every fiscal document. */
  PLATFORM_TAX_ID: blankToUndefined(z.string().max(20).optional()),
  /** Legal name of the issuer shown on invoices. */
  PLATFORM_LEGAL_NAME: z.string().trim().min(1).max(200).default("FilaZero"),
  PLATFORM_ADDRESS: blankToUndefined(z.string().max(255).optional()),
  PLATFORM_CITY: blankToUndefined(z.string().max(120).optional()),
  /** Standard VAT (IVA) rate in basis points; 1400 = 14%. */
  IVA_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(1400),
  /**
   * AGT software-certificate private key (PEM). When set, invoices are signed
   * with RSA-SHA256 and marked `agtCertified`; otherwise a deterministic
   * integrity HMAC is used and the document is flagged as not yet certified.
   */
  AGT_PRIVATE_KEY: blankToUndefined(z.string().min(1).optional()),
  AGT_HASH_SECRET: blankToUndefined(z.string().min(16).optional()),

  /** Length of the trial granted when an organization is created. */
  TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(14),
  /** Plan code attached to a new organization's trial. */
  TRIAL_PLAN_CODE: z.string().trim().min(1).max(60).default("trial"),

  // --- Email (SMTP) -------------------------------------------------------
  SMTP_HOST: blankToUndefined(z.string().trim().min(1).optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: booleanish.default("false"),
  SMTP_USER: blankToUndefined(z.string().trim().optional()),
  SMTP_PASSWORD: blankToUndefined(z.string().optional()),
  SMTP_FROM: z.string().trim().min(3).default("FilaZero <no-reply@filazero.local>"),
  /** Force STARTTLS when the server advertises it (leave false for local sinks). */
  SMTP_REQUIRE_TLS: booleanish.default("false"),

  // --- SMS (generic HTTP gateway) -----------------------------------------
  /**
   * Contract: `POST <SMS_API_URL>` with `Authorization: Bearer <SMS_API_TOKEN>`
   * and JSON `{ to, message, sender }`. Most Angolan/aggregator gateways expose
   * this shape; unset means SMS is not configured and nothing is sent.
   */
  SMS_API_URL: blankToUndefined(z.string().url().optional()),
  SMS_API_TOKEN: blankToUndefined(z.string().min(8).optional()),
  SMS_SENDER_ID: z.string().trim().min(1).max(20).default("FilaZero"),

  // --- WhatsApp (Meta Cloud API) ------------------------------------------
  /** Base URL of the Graph API (overridable so tests can point at a local sink). */
  WHATSAPP_API_BASE: z.string().url().default("https://graph.facebook.com"),
  WHATSAPP_API_VERSION: z.string().trim().min(1).max(12).default("v21.0"),
  WHATSAPP_PHONE_NUMBER_ID: blankToUndefined(z.string().trim().min(1).optional()),
  WHATSAPP_ACCESS_TOKEN: blankToUndefined(z.string().min(8).optional()),
});

export type Env = Omit<z.infer<typeof envSchema>, "ALLOWED_ORIGINS"> & {
  ALLOWED_ORIGINS: string[];
};

let cached: Env | null = null;

/** Parse and cache the process environment. Throws on invalid configuration. */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data as Env;
  return cached;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

/**
 * Password reset tokens are only returned in the API response when explicitly
 * enabled (`AUTH_EXPOSE_RESET_TOKEN=true`) or outside production, because no
 * email provider is wired yet (see docs/ARCHITECTURE.md). The explicit flag lets
 * the HTTP test suite exercise the full reset flow against a production build
 * without weakening the production default.
 */
export function exposesPasswordResetToken(): boolean {
  const env = getEnv();
  return env.AUTH_EXPOSE_RESET_TOKEN || env.NODE_ENV !== "production";
}

/** True when SMTP is configured, i.e. password reset emails can be delivered. */
export function isEmailConfigured(): boolean {
  return Boolean(getEnv().SMTP_HOST);
}

/** True when a real SMS gateway is configured. */
export function isSmsConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SMS_API_URL && env.SMS_API_TOKEN);
}

/** True when the Meta WhatsApp Cloud API is configured. */
export function isWhatsAppConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
}
