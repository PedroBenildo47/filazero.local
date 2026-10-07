import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { listOrganizationsForAdmin } from "@/server/platform/organization-admin.service";
import { adminOrganizationQuerySchema } from "@/server/platform/platform.schemas";

/** Platform administrator: global organization directory (all tenants). */
export const GET = route(async (request) => {
  const context = await requireAuth();
  const query = parseSearchParams(request, adminOrganizationQuerySchema);
  return ok(await listOrganizationsForAdmin(context, query));
});
