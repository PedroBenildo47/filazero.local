import { ok, route } from "@/lib/http";
import { listPlans } from "@/server/billing/plan.service";

/** Public plan catalogue (active plans only). */
export const GET = route(async () => {
  return ok({ items: await listPlans() });
});
