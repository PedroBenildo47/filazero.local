/**
 * Angolan tax identification number (NIF) rules.
 *
 * Legal basis: Decreto Executivo n.º 366/17 and Decreto Presidencial n.º 245/21.
 *
 * - **Pessoa colectiva (company)**: exactly 10 numeric digits, starting with `5`.
 * - **Pessoa singular (individual)**: the NIF is the BI number. The base form is
 *   9 digits; the full BI is 14 characters — 9 digits + a two-letter province
 *   code + 3 digits (e.g. `000123456LA041`).
 *
 * Angola does not expose a single public check-digit algorithm that covers every
 * NIF (the AGT reference validators only enforce the documented structure), so
 * this module validates that structure — deliberately stricter than the old
 * "any 9–10 digits" rule, which accepted impossible numbers.
 *
 * The module is dependency-free and runs on both the server and the browser, so
 * the same rule powers the API schema and the registration form.
 */

/** Two-letter province codes embedded in an Angolan BI / individual NIF. */
export const ANGOLAN_PROVINCE_CODES: ReadonlySet<string> = new Set([
  "LA", // Luanda
  "BG", // Bengo
  "BO", // Benguela
  "BE", // Bié
  "CB", // Cabinda
  "CC", // Cuando Cubango
  "CN", // Cuanza Norte
  "CS", // Cuanza Sul
  "CU", // Cunene
  "HA", // Huambo
  "HL", // Huíla
  "LN", // Lunda Norte
  "LS", // Lunda Sul
  "MA", // Malanje
  "MX", // Moxico
  "NB", // Namibe
  "UI", // Uíge
  "ZA", // Zaire
]);

export type NifKind = "COMPANY" | "INDIVIDUAL" | "BI";

/**
 * Canonical form of a NIF: separators removed and letters upper-cased.
 * Returns `null` when the value is empty, `null` or `undefined`.
 */
export function normalizeNif(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.replace(/[\s.\-/]/g, "").toUpperCase();
  return cleaned.length === 0 ? null : cleaned;
}

/** Rejects degenerate values such as `000000000` or `5555555555`. */
function isDegenerate(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

/**
 * Classifies a NIF, or returns `null` when it does not match any Angolan
 * taxpayer format.
 */
export function nifKind(value: string | null | undefined): NifKind | null {
  const nif = normalizeNif(value);
  if (nif === null) return null;

  // Company: 10 digits, leading `5`.
  if (/^\d{10}$/.test(nif)) {
    return nif.startsWith("5") && !isDegenerate(nif) ? "COMPANY" : null;
  }

  // Individual (base form): 9 digits.
  if (/^\d{9}$/.test(nif)) {
    return isDegenerate(nif) ? null : "INDIVIDUAL";
  }

  // Individual (full BI): 9 digits + province code + 3 digits.
  const bi = /^(\d{9})([A-Z]{2})(\d{3})$/.exec(nif);
  const province = bi?.[2];
  if (province && ANGOLAN_PROVINCE_CODES.has(province)) {
    return "BI";
  }

  return null;
}

/** `true` for any valid Angolan NIF (company, individual or BI). */
export function isValidNif(value: string | null | undefined): boolean {
  return nifKind(value) !== null;
}

/** `true` only for a valid company NIF (10 digits, leading `5`). */
export function isValidCompanyNif(value: string | null | undefined): boolean {
  return nifKind(value) === "COMPANY";
}

/** Human-readable label for the detected taxpayer type. */
export function nifKindLabel(kind: NifKind): string {
  switch (kind) {
    case "COMPANY":
      return "Pessoa coletiva";
    case "INDIVIDUAL":
      return "Pessoa singular";
    case "BI":
      return "Pessoa singular (BI)";
  }
}
