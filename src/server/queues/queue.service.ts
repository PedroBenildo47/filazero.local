/**
 * Queues.
 *
 * A queue belongs to a branch (and, redundantly but usefully, to its
 * organization) and controls whether customers may join. Status transitions are
 * managed here and notify every waiting customer when a queue is paused or
 * closed.
 */
import "server-only";
import type { Queue, QueueStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import { createNotification } from "@/server/notifications/notification.service";
import { publishQueueEvent } from "@/server/realtime/bus";
import {
  assertBranchAccess,
  assertManagerOfOrganization,
  assertOrganizationAccess,
  type AuthContext,
} from "@/server/context";
import { assertCanCreateQueue } from "@/server/billing/plan-guard";
import type { CreateQueueInput, UpdateQueueInput } from "./queue.schemas";

interface QueueScope {
  id: string;
  name: string;
  status: QueueStatus;
  organizationId: string;
  branchId: string;
}

export function publicQueue(queue: Queue) {
  return {
    id: queue.id,
    organizationId: queue.organizationId,
    branchId: queue.branchId,
    name: queue.name,
    description: queue.description,
    status: queue.status,
    currentTicketId: queue.currentTicketId,
    createdAt: queue.createdAt,
    updatedAt: queue.updatedAt,
  };
}

/** Loads a queue and the tenant ids needed for access checks. */
export async function loadQueueScope(queueId: string): Promise<QueueScope> {
  const queue = await db.queue.findUnique({
    where: { id: queueId },
    select: {
      id: true,
      name: true,
      status: true,
      organizationId: true,
      branchId: true,
    },
  });
  if (!queue) throw AppError.notFound("Queue not found");
  return queue;
}

function assertQueueManagementAccess(ctx: AuthContext, scope: QueueScope): void {
  assertOrganizationAccess(ctx, scope.organizationId);
  assertBranchAccess(ctx, scope.organizationId, scope.branchId);
  assertManagerOfOrganization(ctx, scope.organizationId);
}

export async function createQueue(
  ctx: AuthContext,
  branchId: string,
  input: CreateQueueInput,
  meta: RequestMeta,
) {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true, organizationId: true },
  });
  if (!branch) throw AppError.notFound("Branch not found");

  assertOrganizationAccess(ctx, branch.organizationId);
  assertBranchAccess(ctx, branch.organizationId, branchId);
  assertManagerOfOrganization(ctx, branch.organizationId);

  // Plan gate: expired/unpaid subscription -> 402, quota exceeded -> 403.
  await assertCanCreateQueue(branch.organizationId, branchId);

  const queue = await db.queue.create({
    data: {
      organizationId: branch.organizationId,
      branchId,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? "CLOSED",
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "queue.create",
    entityType: "queue",
    entityId: queue.id,
    metadata: { branchId, organizationId: branch.organizationId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicQueue(queue);
}

export async function listQueuesForBranch(
  ctx: AuthContext,
  branchId: string,
  pagination: Pagination,
) {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true, organizationId: true },
  });
  if (!branch) throw AppError.notFound("Branch not found");

  assertOrganizationAccess(ctx, branch.organizationId);
  assertBranchAccess(ctx, branch.organizationId, branchId);

  const { skip, take } = paginationToSkipTake(pagination);
  const [items, total] = await db.$transaction([
    db.queue.findMany({
      where: { branchId },
      orderBy: { name: "asc" },
      skip,
      take,
      include: { _count: { select: { tickets: true } } },
    }),
    db.queue.count({ where: { branchId } }),
  ]);

  // Real waiting counts (one grouped query, not N+1).
  const waiting = await db.ticket.groupBy({
    by: ["queueId"],
    where: {
      queueId: { in: items.map((queue) => queue.id) },
      status: "WAITING",
    },
    _count: { _all: true },
  });
  const waitingByQueue = new Map(
    waiting.map((row) => [row.queueId, row._count._all]),
  );

  return {
    items: items.map((queue) => ({
      ...publicQueue(queue),
      totalTickets: queue._count.tickets,
      waitingCount: waitingByQueue.get(queue.id) ?? 0,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getQueueForStaff(ctx: AuthContext, queueId: string) {
  const scope = await loadQueueScope(queueId);
  assertOrganizationAccess(ctx, scope.organizationId);
  assertBranchAccess(ctx, scope.organizationId, scope.branchId);

  const [queue, waitingCount, activeCount] = await db.$transaction([
    db.queue.findUnique({
      where: { id: queueId },
      include: {
        branch: { select: { id: true, name: true, city: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
    db.ticket.count({ where: { queueId, status: "WAITING" } }),
    db.ticket.count({ where: { queueId, status: { in: ["CALLED", "SERVING"] } } }),
  ]);

  if (!queue) throw AppError.notFound("Queue not found");

  return {
    ...publicQueue(queue),
    branch: queue.branch,
    organization: queue.organization,
    waitingCount,
    activeCount,
  };
}

export async function updateQueue(
  ctx: AuthContext,
  queueId: string,
  input: UpdateQueueInput,
  meta: RequestMeta,
) {
  const scope = await loadQueueScope(queueId);
  assertQueueManagementAccess(ctx, scope);

  const queue = await db.queue.update({
    where: { id: queueId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.status === undefined ? {} : { status: input.status }),
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "queue.update",
    entityType: "queue",
    entityId: queueId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicQueue(queue);
}

export async function setQueueStatus(
  ctx: AuthContext,
  queueId: string,
  status: QueueStatus,
  meta: RequestMeta,
) {
  const scope = await loadQueueScope(queueId);
  assertQueueManagementAccess(ctx, scope);

  const queue = await db.$transaction(async (tx) => {
    const updated = await tx.queue.update({
      where: { id: queueId },
      data: { status },
    });

    // Tell everyone still waiting when a queue stops running.
    if (status !== "OPEN" && scope.status === "OPEN") {
      const waiting = await tx.ticket.findMany({
        where: { queueId, status: "WAITING" },
        select: { id: true, userId: true },
      });
      for (const ticket of waiting) {
        await createNotification(tx, {
          userId: ticket.userId,
          type: "QUEUE_STATUS_CHANGED",
          title: status === "PAUSED" ? "Fila em pausa" : "Fila encerrada",
          message:
            status === "PAUSED"
              ? `A fila "${updated.name}" está temporariamente em pausa.`
              : `A fila "${updated.name}" foi encerrada.`,
          ticketId: ticket.id,
        });
      }
    }

    return updated;
  });

  publishQueueEvent({
    type: "queue.status_changed",
    queueId,
    organizationId: scope.organizationId,
    queueStatus: queue.status,
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "queue.status_changed",
    entityType: "queue",
    entityId: queueId,
    metadata: { status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicQueue(queue);
}

/** Public queue information: no ticket owners, just availability. */
export async function getPublicQueue(queueId: string) {
  const queue = await db.queue.findFirst({
    where: {
      id: queueId,
      branch: { status: "ACTIVE", organization: { status: "ACTIVE" } },
    },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      branch: { select: { id: true, name: true, city: true, address: true } },
      organization: { select: { id: true, name: true, category: true } },
    },
  });

  if (!queue) throw AppError.notFound("Queue not found");

  const waitingCount = await db.ticket.count({
    where: { queueId, status: "WAITING" },
  });

  return { ...queue, waitingCount };
}
