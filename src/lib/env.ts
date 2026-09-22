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
