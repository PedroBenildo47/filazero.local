import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import {
  deleteOrganizationPermanently,
  getOrganizationDetailForAdmin,
} from "@/server/platform/organization-admin.service";
import { deleteOrganizationSchema } from "@/server/platform/platform.schemas";

type Context = { params: Promise<{ organizationId: string }> };

/** Platform administrator: full organization detail. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  return ok(await getOrganizationDetailForAdmin(auth, organizationId));
});

/**
 * Platform administrator: permanently remove an organization.
 * Blocked when the organization has paid transactions; suspend it instead.
 */
export const DELETE = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, deleteOrganizationSchema);
  return ok(
    await deleteOrganizationPermanently(
      auth,
      organizationId,
      body,
      getRequestMeta(request),
    ),
  );
});
