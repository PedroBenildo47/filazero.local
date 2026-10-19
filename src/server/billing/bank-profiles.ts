/**
 * Angolan bank profile labels.
 *
 * Pure module (no `server-only`), so the fallback rule is unit-testable.
 *
 * These are **display names only**. No account number or IBAN is ever defaulted
 * or invented here: a fabricated payable destination would be unsafe. The
 * IBAN/account always come from the environment.
 */

/** Display names for the main Angolan banks. */
export const ANGOLAN_BANK_PROFILES: Record<string, string> = {
  BAI: "Banco Angolano de Investimentos (BAI)",
  BFA: "Banco de Fomento Angola (BFA)",
  BIC: "Banco BIC",
  BCG: "Banco Caixa Geral (BCG)",
  STANDARD_BANK: "Standard Bank Angola",
  SOL: "Banco Sol",
};

/**
 * Real FilaZero beneficiary account (Banco BIC Angola).
 *
 * These are the production defaults used when the corresponding `BILLING_BANK_*`
 * environment variables are blank, so the QR/transfer path always has complete,
 * real data and never fails for missing configuration. Every value is still
 * overridable from the environment.
 *
 * `bban` is the 21-digit account number as printed by the bank; the IBAN check
 * digits are derived from it (`AO06 0051 0000 2109 9175 1017 6`).
 */
export const BIC_BANK_DEFAULTS = {
  bankName: "Banco BIC Angola",
  accountNumber: "22109917510001",
  bban: "005100002109917510176",
  gui: "BIC",
  holder: "Pedro Benildo Lando Capita",
} as const;

/** Label used when neither `BILLING_BANK_NAME` nor a profile is configured. */
export const DEFAULT_BANK_LABEL = BIC_BANK_DEFAULTS.bankName;

/**
 * Resolves the bank display name tolerantly:
 *   1. the configured `BILLING_BANK_NAME`, when non-blank;
 *   2. the `BILLING_BANK_PROFILE` label;
 *   3. the default (BIC) label.
 * Never returns an empty string, so the UI always has something readable.
 */
export function resolveBankName(
  configuredName: string | null | undefined,
  profile: string | null | undefined,
): string {
  if (configuredName && configuredName.trim()) return configuredName.trim();
  if (profile) return ANGOLAN_BANK_PROFILES[profile] ?? profile;
  return DEFAULT_BANK_LABEL;
}
