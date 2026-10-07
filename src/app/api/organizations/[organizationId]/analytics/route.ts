import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { analyticsQuerySchema } from "@/server/organizations/analytics.schemas";
import { getOrganizationAnalytics } from "@/server/organizations/analytics.service";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const query = analyticsQuerySchema.parse(params);
  return ok(await getOrganizationAnalytics(auth, organizationId, query));
});
