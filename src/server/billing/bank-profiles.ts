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

/** Label used when neither `BILLING_BANK_NAME` nor a profile is configured. */
export const DEFAULT_BANK_LABEL = ANGOLAN_BANK_PROFILES.BIC ?? "Banco BIC";

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
