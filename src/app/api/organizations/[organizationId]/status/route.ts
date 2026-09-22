import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { setOrganizationStatus } from "@/server/organizations/organization.service";
import { organizationStatusSchema } from "@/server/organizations/organization.schemas";

type Context = { params: Promise<{ organizationId: string }> };

/** Platform administrator only: suspend / reactivate an organization. */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, organizationStatusSchema);
  return ok(
    await setOrganizationStatus(auth, organizationId, body.status, getRequestMeta(request)),
  );
});
