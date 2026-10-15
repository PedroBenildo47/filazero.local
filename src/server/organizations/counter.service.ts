/**
 * Service counters (guichês).
 *
 * A counter belongs to a branch; staff members are assigned to a counter so the
 * public board can show where a ticket is being served. Managed by a MANAGER of
 * the organization.
 */
import "server-only";
import type { Counter } from "@prisma/client";
import { db, isUniqueConstraintError } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  type AuthContext,
} from "@/server/context";
import type {
  CreateCounterInput,
  ListCountersQuery,
  UpdateCounterInput,
} from "./counter.schemas";

export function publicCounter(counter: Counter) {
  return {
    id: counter.id,
    organizationId: counter.organizationId,
    branchId: counter.branchId,
    name: counter.name,
    active: counter.active,
    createdAt: counter.createdAt,
    updatedAt: counter.updatedAt,
  };
}

export async function listCounters(
  ctx: AuthContext,
  organizationId: string,
  query: ListCountersQuery,
) {
  assertOrganizationAccess(ctx, organizationId);
  const items = await db.counter.findMany({
    where: { organizationId, ...(query.branchId ? { branchId: query.branchId } : {}) },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
    include: {
      branch: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  });
  return {
    items: items.map((counter) => ({
      ...publicCounter(counter),
      branch: counter.branch,
      members: counter._count.members,
    })),
  };
}

export async function createCounter(
  ctx: AuthContext,
  organizationId: string,
  input: CreateCounterInput,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const branch = await db.branch.findFirst({
    where: { id: input.branchId, organizationId },
    select: { id: true },
  });
  if (!branch) throw AppError.badRequest("Branch does not belong to this organization");

  try {
    const counter = await db.counter.create({
      data: { organizationId, branchId: input.branchId, name: input.name },
    });
    await recordAudit(db, {
      actorUserId: ctx.user.id,
      action: "counter.create",
      entityType: "counter",
      entityId: counter.id,
      metadata: { organizationId, branchId: input.branchId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return publicCounter(counter);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw AppError.conflict("A counter with this name already exists in the branch");
    }
    throw error;
  }
}

export async function updateCounter(
  ctx: AuthContext,
  organizationId: string,
  counterId: string,
  input: UpdateCounterInput,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const existing = await db.counter.findFirst({
    where: { id: counterId, organizationId },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound("Counter not found");

  try {
    const counter = await db.counter.update({
      where: { id: counterId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });
    await recordAudit(db, {
      actorUserId: ctx.user.id,
      action: "counter.update",
      entityType: "counter",
      entityId: counterId,
      metadata: { organizationId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return publicCounter(counter);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw AppError.conflict("A counter with this name already exists in the branch");
    }
    throw error;
  }
}

export async function deleteCounter(
  ctx: AuthContext,
  organizationId: string,
  counterId: string,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const existing = await db.counter.findFirst({
    where: { id: counterId, organizationId },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound("Counter not found");

  await db.counter.delete({ where: { id: counterId } });
  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "counter.delete",
    entityType: "counter",
    entityId: counterId,
    metadata: { organizationId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { id: counterId, deleted: true };
}
