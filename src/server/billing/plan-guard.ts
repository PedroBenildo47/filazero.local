/**
 * Plan entitlement guard ("middleware" for plan limits).
 *
 * Applied inside the billable services — branch creation, queue creation and
 * adding staff — so the check cannot be bypassed by calling a different route.
 * Two independent rules:
 *
 *   1. the subscription must be operational (not expired / unpaid) -> 402;
 *   2. the resulting count must stay inside the plan quota          -> 403.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertSubscriptionOperational } from "./subscription.service";

export async function assertCanCreateBranch(organizationId: string): Promise<void> {
  const subscription = await assertSubscriptionOperational(organizationId);

  const current = await db.branch.count({ where: { organizationId } });
  if (current >= subscription.plan.maxBranches) {
    throw AppError.quotaExceeded(
      "branches",
      current,
      subscription.plan.maxBranches,
    );
  }
}

export async function assertCanCreateQueue(
  organizationId: string,
  branchId: string,
): Promise<void> {
  const subscription = await assertSubscriptionOperational(organizationId);

  const current = await db.queue.count({ where: { branchId } });
  if (current >= subscription.plan.maxQueuesPerBranch) {
    throw AppError.quotaExceeded(
      "queues per branch",
      current,
      subscription.plan.maxQueuesPerBranch,
    );
  }
}

export async function assertCanAddMember(organizationId: string): Promise<void> {
  const subscription = await assertSubscriptionOperational(organizationId);

  const current = await db.organizationMember.count({
    where: { organizationId, status: "ACTIVE" },
  });
  if (current >= subscription.plan.maxStaff) {
    throw AppError.quotaExceeded("staff members", current, subscription.plan.maxStaff);
  }
}

/** Non-throwing summary used by the API responses (e.g. remaining quota). */
export async function describeQuota(organizationId: string) {
  const subscription = await assertSubscriptionOperational(organizationId);
  const [branches, queues, staff] = await db.$transaction([
    db.branch.count({ where: { organizationId } }),
    db.queue.count({ where: { organizationId } }),
    db.organizationMember.count({ where: { organizationId, status: "ACTIVE" } }),
  ]);

  return {
    plan: subscription.plan.code,
    branches: { used: branches, limit: subscription.plan.maxBranches },
    queues: { used: queues, limitPerBranch: subscription.plan.maxQueuesPerBranch },
    staff: { used: staff, limit: subscription.plan.maxStaff },
  };
}
