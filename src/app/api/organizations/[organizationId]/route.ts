import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import {
  getOrganization,
  updateOrganization,
} from "@/server/organizations/organization.service";
import { updateOrganizationSchema } from "@/server/organizations/organization.schemas";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  return ok(await getOrganization(auth, organizationId));
});

export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, updateOrganizationSchema);
  return ok(await updateOrganization(auth, organizationId, body, getRequestMeta(request)));
});
