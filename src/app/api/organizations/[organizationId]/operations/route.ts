import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getOrganizationOperations } from "@/server/organizations/operations.service";

type Context = { params: Promise<{ organizationId: string }> };

/** Manager: real-time operational dashboard for the organization. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  return ok(await getOrganizationOperations(auth, organizationId));
});
