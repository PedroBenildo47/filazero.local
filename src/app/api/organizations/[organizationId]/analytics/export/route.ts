import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { analyticsExportQuerySchema } from "@/server/organizations/analytics.schemas";
import { exportOrganizationAnalytics } from "@/server/organizations/analytics-export.service";

type Context = { params: Promise<{ organizationId: string }> };

/**
 * Downloads the organization analytics as a real file generated on the server:
 * `?format=csv` (UTF-8 CSV) or `?format=pdf` (A4 report). Same manager/branch
 * scoping as `GET .../analytics`.
 */
export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const query = analyticsExportQuerySchema.parse(params);
  const { bytes, fileName, contentType } = await exportOrganizationAnalytics(
    auth,
    organizationId,
    query,
  );

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
    },
  });
});
