import { db } from "@/lib/db";
import { ApiClient } from "./client";
import type { Reporter } from "./support";

const PDF_BYTES = "%PDF-1.7\nFilaZero test document\n%%EOF";

type DocumentType =
  | "COMPANY_REGISTRATION"
  | "TAX_REGISTRATION"
  | "BANKING_LICENSE"
  | "REGULATOR_AUTHORIZATION";

function registrationForm(category: string, email: string, documents: DocumentType[]) {
  const form = new FormData();
  form.set("ownerName", "Organization Owner");
  form.set("ownerEmail", email);
  form.set("password", "Password123!");
  form.set("organizationName", `Test ${category} ${Date.now()}`);
  form.set("category", category);
  form.set("city", "Luanda");
  for (const type of documents) {
    form.append(`document.${type}`, new Blob([PDF_BYTES], { type: "application/pdf" }), `${type}.pdf`);
  }
  return form;
}

export async function runOrganizationRegistrationSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const requiredStandard: DocumentType[] = ["COMPANY_REGISTRATION", "TAX_REGISTRATION"];
  const missingBankDocuments = registrationForm(
    "Banco",
    `missing-bank-docs.${Date.now()}@api.filazero.test`,
    requiredStandard,
  );
  const missingResponse = await new ApiClient(baseUrl).postForm(
    "/api/public/organizations/register",
    missingBankDocuments,
  );
  reporter.errorCode(
    "organization registration: bank without specific licenses is rejected",
    missingResponse,
    422,
    "VALIDATION_ERROR",
  );

  const standardEmail = `standard.${Date.now()}@api.filazero.test`;
  const standardClient = new ApiClient(baseUrl);
  const standardResponse = await standardClient.postForm<{
    user: { id: string; role: string };
    organization: { id: string; status: string };
    activated: boolean;
    documentTypes: DocumentType[];
  }>(
    "/api/public/organizations/register",
    registrationForm("Saúde", standardEmail, requiredStandard),
  );
  reporter.equal("organization registration: standard documents create the organization", standardResponse.status, 201);
  reporter.equal("organization registration: valid standard submission activates automatically", standardResponse.data?.organization.status, "ACTIVE");
  reporter.equal("organization registration: owner is created as manager", standardResponse.data?.user.role, "MANAGER");
  reporter.equal("organization registration: response sets a session cookie", standardClient.hasSessionCookie(), true);

  const organizationId = standardResponse.data?.organization.id;
  if (organizationId) {
    const storedDocuments = await db.organizationDocument.findMany({
      where: { organizationId },
      select: { type: true, content: true, sha256: true },
    });
    reporter.equal("organization registration: standard document bytes are persisted", storedDocuments.length, 2);
    reporter.check(
      "organization registration: stored files have content and SHA-256 digests",
      storedDocuments.every((document) => document.content.byteLength > 0 && document.sha256.length === 64),
    );

    const session = await standardClient.get<{
      user: { role: string };
      memberships: Array<{ organizationId: string; role: string }>;
    }>("/api/auth/session");
    reporter.equal("organization registration: session user has manager role", session.data?.user.role, "MANAGER");
    reporter.check(
      "organization registration: session includes the new manager membership",
      session.data?.memberships.some((membership) => membership.organizationId === organizationId && membership.role === "MANAGER") ?? false,
    );
  }

  const financialEmail = `financial.${Date.now()}@api.filazero.test`;
  const financialResponse = await new ApiClient(baseUrl).postForm<{
    organization: { id: string; status: string };
    documentTypes: DocumentType[];
  }>(
    "/api/public/organizations/register",
    registrationForm("Instituição Financeira", financialEmail, [
      ...requiredStandard,
      "BANKING_LICENSE",
      "REGULATOR_AUTHORIZATION",
    ]),
  );
  reporter.equal("organization registration: financial institutions activate with all licenses", financialResponse.status, 201);
  reporter.equal("organization registration: financial organization is active", financialResponse.data?.organization.status, "ACTIVE");
  reporter.equal("organization registration: all four document types are acknowledged", financialResponse.data?.documentTypes.length, 4);
}
