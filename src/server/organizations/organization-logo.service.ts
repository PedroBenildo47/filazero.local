import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface OrganizationLogoPayload {
  mimeType: string;
  sha256: string;
  content: Buffer;
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
