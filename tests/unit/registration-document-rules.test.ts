import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectedDocumentMimeType,
  isFinancialOrganizationCategory,
  requiredRegistrationDocuments,
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
