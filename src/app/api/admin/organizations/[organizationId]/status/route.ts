import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { setOrganizationStatusAdmin } from "@/server/platform/organization-admin.service";
import { adminOrganizationStatusSchema } from "@/server/platform/platform.schemas";

type Context = { params: Promise<{ organizationId: string }> };

/** Platform administrator: suspend / reactivate an organization. */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, adminOrganizationStatusSchema);
  return ok(
    await setOrganizationStatusAdmin(
      auth,
      organizationId,
      body.status,
      getRequestMeta(request),
    ),
  );
});
