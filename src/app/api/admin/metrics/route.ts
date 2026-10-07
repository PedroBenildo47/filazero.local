import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getPlatformMetrics } from "@/server/platform/metrics.service";

export const GET = route(async () => {
  const context = await requireAuth();
  return ok(await getPlatformMetrics(context));
});
