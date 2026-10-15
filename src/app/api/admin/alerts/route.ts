import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getPlatformAlerts } from "@/server/platform/monitoring.service";

/** Platform administrator: heuristic alerts (suspension, failures, bursts). */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok(await getPlatformAlerts(auth));
});
