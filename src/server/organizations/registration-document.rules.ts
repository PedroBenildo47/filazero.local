export const REGISTRATION_DOCUMENT_TYPES = [
  "COMPANY_REGISTRATION",
  "TAX_REGISTRATION",
  "BANKING_LICENSE",
  "REGULATOR_AUTHORIZATION",
] as const;

export type RegistrationDocumentType = (typeof REGISTRATION_DOCUMENT_TYPES)[number];

const STANDARD_DOCUMENTS: RegistrationDocumentType[] = [
  "COMPANY_REGISTRATION",
  "TAX_REGISTRATION",
];

const FINANCIAL_DOCUMENTS: RegistrationDocumentType[] = [
  ...STANDARD_DOCUMENTS,
  "BANKING_LICENSE",
  "REGULATOR_AUTHORIZATION",
];

export const MAX_REGISTRATION_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_REGISTRATION_UPLOAD_BYTES = 36 * 1024 * 1024;

export function isRegistrationDocumentType(value: string): value is RegistrationDocumentType {
  return REGISTRATION_DOCUMENT_TYPES.includes(value as RegistrationDocumentType);
}

export function isFinancialOrganizationCategory(category: string): boolean {
  const normalized = category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-PT");
  return (
    normalized.includes("banco") ||
    normalized.includes("instituicao financeira") ||
    normalized.includes("instituicoes financeiras")
  );
}

export function requiredRegistrationDocuments(category: string): RegistrationDocumentType[] {
  return isFinancialOrganizationCategory(category)
    ? [...FINANCIAL_DOCUMENTS]
    : [...STANDARD_DOCUMENTS];
}

export const LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

export function isAllowedLogoMimeType(value: string): value is LogoMimeType {
  return (LOGO_MIME_TYPES as readonly string[]).includes(value);
}

/** Sniffs an image payload; only PNG and JPEG are accepted for logos. */
export function detectedLogoMimeType(bytes: Uint8Array): LogoMimeType | null {
  const detected = detectedDocumentMimeType(bytes);
  return detected === "image/png" || detected === "image/jpeg" ? detected : null;
}

export interface LogoValidationFailure {
  code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE";
  message: string;
}

/**
 * Validates a logo upload by its real bytes. Returns `null` when acceptable, or
 * a structured failure the caller turns into a 422. Shared by self-registration
 * and the manager panel so both paths apply exactly the same rules.
 */
export function validateLogoBytes(bytes: Uint8Array): LogoValidationFailure | null {
  if (bytes.byteLength === 0) {
    return { code: "EMPTY_FILE", message: "The uploaded logo is empty." };
  }
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return {
      code: "FILE_TOO_LARGE",
      message: `The organization logo must be smaller than ${MAX_LOGO_BYTES / (1024 * 1024)} MiB.`,
    };
  }
  if (detectedLogoMimeType(bytes) === null) {
    return {
      code: "UNSUPPORTED_FILE",
      message: "The organization logo must be a valid PNG or JPEG image.",
    };
  }
  return null;
}

export function detectedDocumentMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}
