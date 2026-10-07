import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { getPlatformFinancials } from "@/server/platform/revenue.service";
import { adminFinanceQuerySchema } from "@/server/platform/platform.schemas";

/** Platform administrator: consolidated revenue and subscription metrics. */
export const GET = route(async (request) => {
  const context = await requireAuth();
  const query = parseSearchParams(request, adminFinanceQuerySchema);
  return ok(await getPlatformFinancials(context, query));
});
