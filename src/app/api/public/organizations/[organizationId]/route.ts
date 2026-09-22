import { ok, route } from "@/lib/http";
import { getPublicOrganization } from "@/server/organizations/public.service";

type Context = { params: Promise<{ organizationId: string }> };

/** Public organization detail with branches and queues. */
export const GET = route(async (_request, context: Context) => {
  const { organizationId } = await context.params;
  return ok(await getPublicOrganization(organizationId));
});
