import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { getOrganizationLogo } from "@/server/organizations/organization-logo.service";

type Context = { params: Promise<{ organizationId: string }> };

/**
 * Public organization logo.
 *
 * Served without authentication because it is rendered on public surfaces: the
 * queue screen (`/ecra`), the kiosk (`/totem`) and the organization page. Only
 * uploaded logos live here; an external `logoUrl` is loaded directly from its
 * own origin.
 */
export const GET = route(async (_request, context: Context) => {
  const { organizationId } = await context.params;
  uuidSchema.parse(organizationId);

  const logo = await getOrganizationLogo(organizationId);

  return new NextResponse(new Uint8Array(logo.content), {
    status: 200,
    headers: {
      "content-type": logo.mimeType,
      "content-length": String(logo.content.byteLength),
      "cache-control": "public, max-age=300, must-revalidate",
      etag: `"${logo.sha256}"`,
    },
  });
});
