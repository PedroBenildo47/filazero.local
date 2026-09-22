/**
 * Plan catalogue access (server side).
 *
 * The catalogue data and the idempotent upsert live in `billing.rules.ts` so the
 * seed script can reuse them without pulling in `server-only`.
 */
import "server-only";
import { db } from "@/lib/db";

export {
  PLAN_CATALOG,
  ensurePlanCatalog,
  type PlanDefinition,
} from "./billing.rules";

export async function listPlans(includeInactive = false) {
  return db.plan.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { priceCents: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      priceCents: true,
      currency: true,
      interval: true,
      maxBranches: true,
      maxQueuesPerBranch: true,
      maxStaff: true,
    },
  });
}

export async function getPlanByCode(code: string) {
  return db.plan.findUnique({ where: { code } });
}
