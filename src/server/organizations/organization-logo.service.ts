import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  type AuthContext,
} from "@/server/context";
import {
  detectedLogoMimeType,
  validateLogoBytes,
} from "./registration-document.rules";

export interface OrganizationLogoPayload {
  mimeType: string;
  sha256: string;
  content: Buffer;
}

export interface OrganizationLogoUpload {
  fileName: string;
  bytes: Uint8Array;
}

/** Public URL an uploaded logo is served from. */
export function organizationLogoUrl(organizationId: string): string {
  return `/api/public/organizations/${organizationId}/logo`;
}

/**
 * Binary logo payload for an organization.
 *
 * Returns the stored bytes for the public logo endpoint. Throws a 404 when the
 * organization never uploaded a logo (an external `logoUrl` is served directly
 * by the browser, never through this endpoint).
 */
export async function getOrganizationLogo(
  organizationId: string,
): Promise<OrganizationLogoPayload> {
  const logo = await db.organizationLogo.findUnique({
    where: { organizationId },
    select: { mimeType: true, sha256: true, content: true },
  });
  if (!logo) throw AppError.notFound("Organization logo not found");

  return {
    mimeType: logo.mimeType,
    sha256: logo.sha256,
    content: Buffer.from(logo.content),
  };
}

/**
 * Replaces an organization's logo with an uploaded PNG/JPEG.
 *
 * Only a MANAGER of the organization can do this. The bytes are sniffed (the
 * declared content type is never trusted) and stored in `organization_logos`,
 * while `organizations.logo_url` points at the public endpoint.
 */
export async function setOrganizationLogo(
  ctx: AuthContext,
  organizationId: string,
  upload: OrganizationLogoUpload,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  const failure = validateLogoBytes(upload.bytes);
  if (failure) {
    throw AppError.validation(failure.message, { reason: failure.code });
  }
  const mimeType = detectedLogoMimeType(upload.bytes)!;
  const sha256 = createHash("sha256").update(upload.bytes).digest("hex");
  const sizeBytes = upload.bytes.byteLength;
  const logoUrl = organizationLogoUrl(organizationId);
  const logoUpdatedAt = new Date();

  await db.$transaction(async (tx) => {
    await tx.organizationLogo.upsert({
      where: { organizationId },
      create: {
        organizationId,
        mimeType,
        sizeBytes,
        sha256,
        content: new Uint8Array(upload.bytes),
      },
      update: {
        mimeType,
        sizeBytes,
        sha256,
        content: new Uint8Array(upload.bytes),
      },
    });

    await tx.organization.update({
      where: { id: organizationId },
      data: { logoUrl, logoUpdatedAt },
    });

    await recordAudit(tx, {
      actorUserId: ctx.user.id,
      action: "organization.logo_updated",
      entityType: "organization",
      entityId: organizationId,
      metadata: { mimeType, sizeBytes, sha256 },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });

  return { logoUrl, logoUpdatedAt, mimeType, sizeBytes, sha256 };
}

/** Removes an organization's uploaded logo (external `logoUrl` is cleared too). */
export async function clearOrganizationLogo(
  ctx: AuthContext,
  organizationId: string,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  await db.$transaction(async (tx) => {
    await tx.organizationLogo.deleteMany({ where: { organizationId } });
    await tx.organization.update({
      where: { id: organizationId },
      data: { logoUrl: null, logoUpdatedAt: null },
    });

    await recordAudit(tx, {
      actorUserId: ctx.user.id,
      action: "organization.logo_removed",
      entityType: "organization",
      entityId: organizationId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });

  return { logoUrl: null, logoUpdatedAt: null };
}
