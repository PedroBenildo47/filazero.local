import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getSystemHealth } from "@/server/platform/monitoring.service";

/** Platform administrator: database latency, process metrics and counters. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok(await getSystemHealth(auth));
});
