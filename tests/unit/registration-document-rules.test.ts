import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LOGO_BYTES,
  detectedDocumentMimeType,
  detectedLogoMimeType,
  isFinancialOrganizationCategory,
  requiredRegistrationDocuments,
  validateLogoBytes,
} from "@/server/organizations/registration-document.rules";

test("financial organization categories require standard and regulator documents", () => {
  assert.equal(isFinancialOrganizationCategory("Banco"), true);
  assert.equal(isFinancialOrganizationCategory("Instituição Financeira"), true);
  assert.equal(isFinancialOrganizationCategory("Instituições Financeiras"), true);
  assert.equal(isFinancialOrganizationCategory("Serviços Financeiros"), false);
  assert.deepEqual(requiredRegistrationDocuments("Banco comercial"), [
    "COMPANY_REGISTRATION",
    "TAX_REGISTRATION",
    "BANKING_LICENSE",
    "REGULATOR_AUTHORIZATION",
  ]);
});

test("other sectors require only standard company documents", () => {
  assert.deepEqual(requiredRegistrationDocuments("Saúde"), [
    "COMPANY_REGISTRATION",
    "TAX_REGISTRATION",
  ]);
});

test("document MIME type is detected from its signature", () => {
  assert.equal(
    detectedDocumentMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])),
    "application/pdf",
  );
  assert.equal(
    detectedDocumentMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0x00])),
    "image/jpeg",
  );
  assert.equal(detectedDocumentMimeType(new Uint8Array([0x00, 0x01, 0x02])), null);
});

const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

test("logo detection accepts only PNG and JPEG", () => {
  assert.equal(detectedLogoMimeType(png()), "image/png");
  assert.equal(detectedLogoMimeType(jpeg()), "image/jpeg");
  // A PDF is a valid document but never a valid logo.
  assert.equal(detectedLogoMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), null);
  assert.equal(detectedLogoMimeType(new Uint8Array()), null);
});

test("validateLogoBytes rejects empty, oversized and unsupported files", () => {
  assert.equal(validateLogoBytes(new Uint8Array())?.code, "EMPTY_FILE");
  assert.equal(validateLogoBytes(new Uint8Array(MAX_LOGO_BYTES + 1))?.code, "FILE_TOO_LARGE");
  assert.equal(
    validateLogoBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38]))?.code,
    "UNSUPPORTED_FILE",
  );
  assert.equal(validateLogoBytes(png()), null);
  assert.equal(validateLogoBytes(jpeg()), null);
});
