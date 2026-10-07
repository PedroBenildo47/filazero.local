/**
 * Manager control for kiosk (totem) mode.
 *
 * Kept separate from the general queue service so the authorization is explicit
 * and self-contained: only an active `MANAGER` of the queue's organization —
 * with org-wide scope or a membership on that exact branch — can toggle it.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireAuth } from "@/server/auth/session-cookie";

export async function setQueueKioskMode(queueId: string, enabled: boolean) {
  const auth = await requireAuth();

  const queue = await db.queue.findUnique({
    where: { id: queueId },
    select: { id: true, branchId: true, branch: { select: { organizationId: true } } },
  });
  if (!queue) throw AppError.notFound("Queue not found");

  const memberships = await db.organizationMember.findMany({
    where: {
      userId: auth.user.id,
      organizationId: queue.branch.organizationId,
      role: "MANAGER",
    },
    select: { branchId: true },
  });
  const allowed = memberships.some(
    (membership) => membership.branchId === null || membership.branchId === queue.branchId,
  );
  if (!allowed) throw AppError.forbidden();

  return db.queue.update({
    where: { id: queueId },
    data: { kioskEnabled: enabled },
    select: { id: true, kioskEnabled: true },
  });
}
