/**
 * Organization members (`organization_members`).
 *
 * Links a user to an organization and, optionally, to a single branch.
 * `branchId = null` means the membership covers every branch of the
 * organization.
 *
 * Note on global role: `users.role` drives platform-wide permissions, while
 * `organization_members.role` is the role *inside that organization*. When a
 * CUSTOMER is added as STAFF/MANAGER their global role is promoted (never
 * downgraded, and never touches an ADMINISTRATOR).
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  type AuthContext,
} from "@/server/context";
import { hashPassword } from "@/server/auth/password";
import { publicMember } from "@/server/serializers";
import { assertCanAddMember } from "@/server/billing/plan-guard";
import { promotedRole } from "./member.rules";
import type { AddMemberInput, UpdateMemberInput } from "./member.schemas";

async function assertBranchBelongsToOrganization(
  organizationId: string,
  branchId: string,
): Promise<void> {
  const branch = await db.branch.findFirst({
    where: { id: branchId, organizationId },
    select: { id: true },
  });
  if (!branch) {
    throw AppError.badRequest("Branch does not belong to this organization");
  }
}

async function countActiveManagers(organizationId: string): Promise<number> {
  return db.organizationMember.count({
    where: { organizationId, role: "MANAGER", status: "ACTIVE" },
  });
}

export async function listMembers(
  ctx: AuthContext,
  organizationId: string,
  pagination: Pagination,
) {
  assertOrganizationAccess(ctx, organizationId);
  const { skip, take } = paginationToSkipTake(pagination);

  const [items, total] = await db.$transaction([
    db.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      skip,
      take,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true, status: true } },
        branch: { select: { id: true, name: true } },
      },
    }),
    db.organizationMember.count({ where: { organizationId } }),
  ]);

  return {
    items: items.map((member) => ({
      ...publicMember(member),
      user: member.user,
      branch: member.branch,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function addMember(
  ctx: AuthContext,
  organizationId: string,
  input: AddMemberInput,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  // Plan gate: expired/unpaid subscription -> 402, staff quota -> 403.
  await assertCanAddMember(organizationId);

  const branchId = input.branchId ?? null;
  if (branchId) {
    await assertBranchBelongsToOrganization(organizationId, branchId);
  }

  const member = await db.$transaction(async (tx) => {
    let userId = input.userId;

    if (userId) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!user) throw AppError.notFound("User not found");

      const nextRole = promotedRole(user.role, input.role);
      if (nextRole !== user.role) {
        await tx.user.update({ where: { id: userId }, data: { role: nextRole } });
      }
    } else {
      const passwordHash = await hashPassword(input.password!);
      const created = await tx.user.create({
        data: {
          name: input.name!,
          email: input.email!,
          phone: input.phone ?? null,
          passwordHash,
          role: input.role,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      userId = created.id;
    }

    return tx.organizationMember.create({
      data: {
        userId: userId!,
        organizationId,
        branchId,
        role: input.role,
        status: "ACTIVE",
      },
    });
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "member.add",
    entityType: "organization_member",
    entityId: member.id,
    metadata: { organizationId, role: member.role, branchId: member.branchId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicMember(member);
}

export async function updateMember(
  ctx: AuthContext,
  organizationId: string,
  memberId: string,
  input: UpdateMemberInput,
  meta: RequestMeta,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const existing = await db.organizationMember.findFirst({
    where: { id: memberId, organizationId },
  });
  if (!existing) throw AppError.notFound("Membership not found");

  const branchId = input.branchId === undefined ? existing.branchId : input.branchId ?? null;
  if (branchId) {
    await assertBranchBelongsToOrganization(organizationId, branchId);
  }

  // Never let an organization lose its last active manager.
  const losesManager =
    existing.role === "MANAGER" &&
    existing.status === "ACTIVE" &&
    ((input.role !== undefined && input.role !== "MANAGER") ||
      (input.status !== undefined && input.status !== "ACTIVE"));
  if (losesManager && (await countActiveManagers(organizationId)) <= 1) {
    throw AppError.conflict("An organization must keep at least one active manager");
  }

  const member = await db.$transaction(async (tx) => {
    const updated = await tx.organizationMember.update({
      where: { id: existing.id },
      data: {
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.status === undefined ? {} : { status: input.status }),
        branchId,
      },
    });

    // Keep the global role aligned when a membership is promoted.
    if (input.role !== undefined) {
      const user = await tx.user.findUnique({
        where: { id: updated.userId },
        select: { role: true },
      });
      if (user) {
        const nextRole = promotedRole(user.role, input.role);
        if (nextRole !== user.role) {
          await tx.user.update({
            where: { id: updated.userId },
            data: { role: nextRole },
          });
        }
      }
    }

    return updated;
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "member.update",
    entityType: "organization_member",
    entityId: member.id,
    metadata: { organizationId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicMember(member);
}

export async function removeMember(
  ctx: AuthContext,
  organizationId: string,
  memberId: string,
  meta: RequestMeta,
): Promise<void> {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const existing = await db.organizationMember.findFirst({
    where: { id: memberId, organizationId },
  });
  if (!existing) throw AppError.notFound("Membership not found");

  if (
    existing.role === "MANAGER" &&
    existing.status === "ACTIVE" &&
    (await countActiveManagers(organizationId)) <= 1
  ) {
    throw AppError.conflict("An organization must keep at least one active manager");
  }

  await db.organizationMember.delete({ where: { id: existing.id } });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "member.remove",
    entityType: "organization_member",
    entityId: existing.id,
    metadata: { organizationId, userId: existing.userId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/** Users available to be attached as members (search by email/name). */
export async function searchUsers(
  ctx: AuthContext,
  organizationId: string,
  query: string,
  pagination: Pagination,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);
  const { skip, take } = paginationToSkipTake(pagination);

  const where = query
    ? {
        OR: [
          { email: { contains: query, mode: "insensitive" as const } },
          { name: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await db.$transaction([
    db.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    }),
    db.user.count({ where }),
  ]);

  return { items, total, page: pagination.page, pageSize: pagination.pageSize };
}
