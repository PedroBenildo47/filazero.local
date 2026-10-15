import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getPlatformOverview } from "@/server/platform/monitoring.service";

/** Platform administrator: global KPIs, real-time activity and growth. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok(await getPlatformOverview(auth));
});
