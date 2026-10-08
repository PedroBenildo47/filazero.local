import "server-only";
import { createHash } from "node:crypto";
import type { Organization, User } from "@prisma/client";
import { db, isUniqueConstraintError } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import { getPlanByCode } from "@/server/billing/plan.service";
import { hashPassword } from "@/server/auth/password";
import { generateOpaqueToken, hashToken } from "@/server/auth/tokens";
import {
  detectedDocumentMimeType,
  detectedLogoMimeType,
  isRegistrationDocumentType,
  MAX_LOGO_BYTES,
  MAX_REGISTRATION_DOCUMENT_BYTES,
  MAX_REGISTRATION_UPLOAD_BYTES,
  requiredRegistrationDocuments,
  type RegistrationDocumentType,
} from "./registration-document.rules";
import type { SelfRegistrationInput } from "./self-registration.schemas";

export interface RegistrationDocumentUpload {
  type: RegistrationDocumentType;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface RegistrationLogoUpload {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface SelfRegistrationResult {
  user: User;
  organization: Organization;
  token: string;
  expiresAt: Date;
  documentTypes: RegistrationDocumentType[];
  logo: { url: string | null; uploaded: boolean };
}

function safeFileName(fileName: string): string {
  const sanitized = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 255);
  return sanitized || "document";
}

function validateUploads(
  category: string,
  uploads: RegistrationDocumentUpload[],
) {
  const required = requiredRegistrationDocuments(category);
  const seen = new Set<RegistrationDocumentType>();
  const totalBytes = uploads.reduce((total, upload) => total + upload.bytes.byteLength, 0);

  if (totalBytes > MAX_REGISTRATION_UPLOAD_BYTES) {
    throw AppError.validation("Organization documents exceed the upload limit");
  }

  for (const upload of uploads) {
    if (!isRegistrationDocumentType(upload.type) || seen.has(upload.type)) {
      throw AppError.validation("Organization document types must be valid and unique");
    }
    seen.add(upload.type);

    if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > MAX_REGISTRATION_DOCUMENT_BYTES) {
      throw AppError.validation("Each organization document must be smaller than 8 MiB");
    }

    const detectedMimeType = detectedDocumentMimeType(upload.bytes);
    if (!detectedMimeType || (upload.mimeType && upload.mimeType !== detectedMimeType)) {
      throw AppError.validation("Documents must be valid PDF, JPEG, or PNG files");
    }
  }

  const missing = required.filter((type) => !seen.has(type));
  const unexpected = [...seen].filter((type) => !required.includes(type));
  if (missing.length > 0 || unexpected.length > 0) {
    throw AppError.validation("Submitted documents do not meet the sector requirements", {
      required,
      missing,
      unexpected,
    });
  }

  return uploads.map((upload) => {
    const mimeType = detectedDocumentMimeType(upload.bytes)!;
    return {
      type: upload.type,
      fileName: safeFileName(upload.fileName),
      mimeType,
      sizeBytes: upload.bytes.byteLength,
      sha256: createHash("sha256").update(upload.bytes).digest("hex"),
      content: upload.bytes,
    };
  });
}

/** Validates and prepares an uploaded logo (PNG/JPEG, ≤ 2 MiB). */
function validateLogo(logo: RegistrationLogoUpload | undefined) {
  if (!logo) return null;
  if (logo.bytes.byteLength === 0 || logo.bytes.byteLength > MAX_LOGO_BYTES) {
    throw AppError.validation("The organization logo must be smaller than 2 MiB");
  }
  const mimeType = detectedLogoMimeType(logo.bytes);
  if (!mimeType || (logo.mimeType && logo.mimeType !== mimeType)) {
    throw AppError.validation("The organization logo must be a valid PNG or JPEG image");
  }
  return {
    mimeType,
    sizeBytes: logo.bytes.byteLength,
    sha256: createHash("sha256").update(logo.bytes).digest("hex"),
    content: logo.bytes,
  };
}

export async function selfRegisterOrganization(
  input: SelfRegistrationInput,
  uploads: RegistrationDocumentUpload[],
  logo: RegistrationLogoUpload | undefined,
  meta: RequestMeta,
): Promise<SelfRegistrationResult> {
  const preparedDocuments = validateUploads(input.category, uploads);
  const preparedLogo = validateLogo(logo);
  const passwordHash = await hashPassword(input.password);
  const env = getEnv();
  const trialPlan = await getPlanByCode(env.TRIAL_PLAN_CODE);
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_TTL_SECONDS * 1000);

  try {
    const result = await db.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.ownerName,
            email: input.ownerEmail,
            phone: input.ownerPhone ?? null,
            passwordHash,
            role: "MANAGER",
            status: "ACTIVE",
          },
        });

        let organization = await tx.organization.create({
          data: {
            name: input.organizationName,
            category: input.category,
            description: input.description ?? null,
            address: input.address ?? null,
            city: input.city ?? null,
            country: input.country ?? null,
            phone: input.organizationPhone ?? null,
            email: input.organizationEmail ?? null,
            taxId: input.taxId,
            logoUrl: preparedLogo ? null : input.logoUrl ?? null,
            logoUpdatedAt: preparedLogo || input.logoUrl ? new Date() : null,
            status: "ACTIVE",
          },
        });

        if (preparedLogo) {
          await tx.organizationLogo.create({
            data: {
              organizationId: organization.id,
              mimeType: preparedLogo.mimeType,
              sizeBytes: preparedLogo.sizeBytes,
              sha256: preparedLogo.sha256,
              content: Uint8Array.from(preparedLogo.content),
            },
          });
          organization = await tx.organization.update({
            where: { id: organization.id },
            data: {
              logoUrl: `/api/public/organizations/${organization.id}/logo`,
              logoUpdatedAt: new Date(),
            },
          });
        }

        await tx.organizationMember.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            role: "MANAGER",
            status: "ACTIVE",
          },
        });

        for (const document of preparedDocuments) {
          await tx.organizationDocument.create({
            data: {
              organizationId: organization.id,
              type: document.type,
              fileName: document.fileName,
              mimeType: document.mimeType,
              sizeBytes: document.sizeBytes,
              sha256: document.sha256,
              content: Uint8Array.from(document.content),
            },
          });
        }

        if (trialPlan) {
          const now = new Date();
          await tx.subscription.create({
            data: {
              organizationId: organization.id,
              planId: trialPlan.id,
              status: "TRIALING",
              currentPeriodStart: now,
              currentPeriodEnd: new Date(now.getTime() + env.TRIAL_DAYS * 86_400_000),
            },
          });
        }

        await tx.session.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          },
        });

        await recordAudit(tx, {
          actorUserId: user.id,
          action: "organization.self_registered",
          entityType: "organization",
          entityId: organization.id,
          description: organization.name,
          metadata: {
            category: input.category,
            documentTypes: preparedDocuments.map((document) => document.type),
            automaticallyActivated: true,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });

        return { user, organization };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );

    return {
      ...result,
      token,
      expiresAt,
      documentTypes: preparedDocuments.map((document) => document.type),
      logo: { url: result.organization.logoUrl, uploaded: preparedLogo !== null },
    };
  } catch (error) {
    if (isUniqueConstraintError(error, "email")) {
      throw AppError.conflict("This email is already registered");
    }
    throw error;
  }
}
