/**
 * Branches (units of an organization).
 *
 * Creating/updating requires org access plus MANAGER (or platform admin).
 * Reads require org access. Every lookup is scoped by organization so a branch
 * id from another tenant can never be fetched.
 */
import "server-only";
import type { Branch } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertBranchAccess,
  assertManagerOfOrganization,
  assertOrganizationAccess,
  type AuthContext,
} from "@/server/context";
import { assertCanCreateBranch } from "@/server/billing/plan-guard";
import type { CreateBranchInput, UpdateBranchInput } from "./branch.schemas";

export function publicBranch(branch: Branch) {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    status: branch.status,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}

async function findScopedBranch(organizationId: string, branchId: string) {
  const branch = await db.branch.findFirst({
    where: { id: branchId, organizationId },
  });
  if (!branch) throw AppError.notFound("Branch not found");
  return branch;
}

export async function createBranch(
  ctx: AuthContext,
  organizationId: string,
  input: CreateBranchInput,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  // Plan gate: expired/unpaid subscription -> 402, quota exceeded -> 403.
  await assertCanCreateBranch(organizationId);

  const branch = await db.branch.create({
    data: {
      organizationId,
      name: input.name,
      address: input.address ?? null,
      city: input.city ?? null,
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "branch.create",
    entityType: "branch",
    entityId: branch.id,
    metadata: { organizationId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicBranch(branch);
}

export async function listBranches(
  ctx: AuthContext,
  organizationId: string,
  pagination: Pagination,
) {
  assertOrganizationAccess(ctx, organizationId);
  const { skip, take } = paginationToSkipTake(pagination);

  const [items, total] = await db.$transaction([
    db.branch.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      skip,
      take,
      include: { _count: { select: { queues: true, members: true } } },
    }),
    db.branch.count({ where: { organizationId } }),
  ]);

  return {
    items: items.map((branch) => ({
      ...publicBranch(branch),
      counts: branch._count,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getBranch(
  ctx: AuthContext,
  organizationId: string,
  branchId: string,
) {
  const branch = await findScopedBranch(organizationId, branchId);
  assertBranchAccess(ctx, organizationId, branchId);

  const queues = await db.queue.findMany({
    where: { branchId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true },
  });

  return { ...publicBranch(branch), queues };
}

export async function updateBranch(
  ctx: AuthContext,
  organizationId: string,
  branchId: string,
  input: UpdateBranchInput,
  meta: RequestMeta,
) {
  const existing = await findScopedBranch(organizationId, branchId);
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const branch = await db.branch.update({
    where: { id: existing.id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.status === undefined ? {} : { status: input.status }),
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "branch.update",
    entityType: "branch",
    entityId: branch.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicBranch(branch);
}
