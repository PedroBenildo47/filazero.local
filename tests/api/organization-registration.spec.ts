import { db } from "@/lib/db";
import { ApiClient } from "./client";
import type { Reporter } from "./support";

const PDF_BYTES = "%PDF-1.7\nFilaZero test document\n%%EOF";

/** 1×1 transparent PNG — a real image payload for the logo sniffing check. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

type DocumentType =
  | "COMPANY_REGISTRATION"
  | "TAX_REGISTRATION"
  | "BANKING_LICENSE"
  | "REGULATOR_AUTHORIZATION";

function registrationForm(
  category: string,
  email: string,
  documents: DocumentType[],
  options: { taxId?: string; withLogo?: boolean } = {},
) {
  const form = new FormData();
  form.set("ownerName", "Organization Owner");
  form.set("ownerEmail", email);
  form.set("password", "Password123!");
  form.set("organizationName", `Test ${category} ${Date.now()}`);
  form.set("category", category);
  form.set("city", "Luanda");
  form.set("taxId", options.taxId ?? "5417000000");
  if (options.withLogo) {
    form.append("logo", new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }), "logo.png");
  }
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
    organization: { id: string; status: string; taxId: string | null; logoUrl: string | null };
    activated: boolean;
    documentTypes: DocumentType[];
    logo: { url: string | null; uploaded: boolean };
  }>(
    "/api/public/organizations/register",
    registrationForm("Saúde", standardEmail, requiredStandard, { withLogo: true }),
  );
  reporter.equal("organization registration: standard documents create the organization", standardResponse.status, 201);
  reporter.equal("organization registration: valid standard submission activates automatically", standardResponse.data?.organization.status, "ACTIVE");
  reporter.equal("organization registration: owner is created as manager", standardResponse.data?.user.role, "MANAGER");
  reporter.equal("organization registration: response sets a session cookie", standardClient.hasSessionCookie(), true);
  reporter.equal(
    "organization registration: the company NIF is persisted",
    standardResponse.data?.organization.taxId,
    "5417000000",
  );
  reporter.equal(
    "organization registration: the uploaded logo is recorded",
    standardResponse.data?.logo?.uploaded,
    true,
  );
  reporter.check(
    "organization registration: the logo URL points at the platform endpoint",
    (standardResponse.data?.organization.logoUrl ?? "").endsWith("/logo"),
    standardResponse.data?.organization.logoUrl ?? "<none>",
  );

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

    const storedLogo = await db.organizationLogo.findUnique({
      where: { organizationId },
      select: { mimeType: true, sizeBytes: true, sha256: true, content: true },
    });
    reporter.equal("organization registration: the logo image is persisted", storedLogo?.mimeType, "image/png");
    reporter.check(
      "organization registration: the stored logo has content and a SHA-256 digest",
      (storedLogo?.content.byteLength ?? 0) > 0 && (storedLogo?.sha256.length ?? 0) === 64,
    );

    const logoResponse = await new ApiClient(baseUrl).get<unknown>(
      `/api/public/organizations/${organizationId}/logo`,
    );
    reporter.equal(
      "organization registration: the public logo endpoint serves the image",
      logoResponse.status,
      200,
    );
    reporter.equal(
      "organization registration: the logo endpoint returns the stored content type",
      logoResponse.headers.get("content-type"),
      "image/png",
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

  const invalidNifResponse = await new ApiClient(baseUrl).postForm(
    "/api/public/organizations/register",
    registrationForm("Saúde", `bad-nif.${Date.now()}@api.filazero.test`, requiredStandard, {
      taxId: "12",
    }),
  );
  reporter.errorCode(
    "organization registration: an invalid company NIF is rejected",
    invalidNifResponse,
    422,
    "VALIDATION_ERROR",
  );

  const missingNifResponse = await new ApiClient(baseUrl).postForm(
    "/api/public/organizations/register",
    registrationForm("Saúde", `no-nif.${Date.now()}@api.filazero.test`, requiredStandard, {
      taxId: "",
    }),
  );
  reporter.errorCode(
    "organization registration: a missing NIF is rejected",
    missingNifResponse,
    422,
    "VALIDATION_ERROR",
  );

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
