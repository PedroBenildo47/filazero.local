/**
 * Organizations.
 *
 * Write operations are restricted to a platform ADMINISTRATOR (create/status) or
 * a MANAGER of the organization (update/operational data). Reads are scoped:
 * administrators see everything, everyone else only organizations where they
 * hold an active membership.
 */
import "server-only";
import type { OrganizationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/server/context";
import { publicOrganization } from "@/server/serializers";
import { attachTrialSubscription } from "@/server/billing/subscription.service";
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from "./organization.schemas";

export async function createOrganization(
  ctx: AuthContext,
  input: CreateOrganizationInput,
  meta: RequestMeta,
) {
  requirePermission(ctx, "organization:manage");

  const organization = await db.organization.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    },
  });

  // Every organization starts on a real trial subscription. Without a plan in
  // the catalogue it simply has no subscription, and billable writes are then
  // blocked with 402 until one is assigned.
  const subscription = await attachTrialSubscription(organization.id);

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "organization.create",
    entityType: "organization",
    entityId: organization.id,
    description: organization.name,
    metadata: subscription
      ? { trialEndsAt: subscription.currentPeriodEnd.toISOString() }
      : { trial: "none" },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicOrganization(organization);
}

export async function listOrganizations(
  ctx: AuthContext,
  pagination: Pagination & { status?: OrganizationStatus },
) {
  const { skip, take } = paginationToSkipTake(pagination);
  const isAdmin = ctx.user.role === "ADMINISTRATOR";
  const organizationIds = ctx.memberships
    .filter((membership) => membership.status === "ACTIVE")
    .map((membership) => membership.organizationId);

  const where = {
    ...(isAdmin ? {} : { id: { in: organizationIds } }),
    ...(pagination.status ? { status: pagination.status } : {}),
  };

  const [items, total] = await db.$transaction([
    db.organization.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
      include: {
        _count: { select: { branches: true, queues: true, members: true } },
      },
    }),
    db.organization.count({ where }),
  ]);

  return {
    items: items.map((organization) => ({
      ...publicOrganization(organization),
      counts: organization._count,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getOrganization(ctx: AuthContext, organizationId: string) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      branches: { orderBy: { name: "asc" } },
      _count: { select: { queues: true, members: true } },
    },
  });

  if (!organization) throw AppError.notFound("Organization not found");
  assertOrganizationAccess(ctx, organizationId);

  return {
    ...publicOrganization(organization),
    branches: organization.branches,
    counts: organization._count,
  };
}

export async function updateOrganization(
  ctx: AuthContext,
  organizationId: string,
  input: UpdateOrganizationInput,
  meta: RequestMeta,
) {
  const existing = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!existing) throw AppError.notFound("Organization not found");

  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const organization = await db.organization.update({
    where: { id: organizationId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.country === undefined ? {} : { country: input.country }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.email === undefined ? {} : { email: input.email }),
    },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "organization.update",
    entityType: "organization",
    entityId: organizationId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicOrganization(organization);
}

export async function setOrganizationStatus(
  ctx: AuthContext,
  organizationId: string,
  status: OrganizationStatus,
  meta: RequestMeta,
) {
  requirePermission(ctx, "platform:admin");

  const existing = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound("Organization not found");

  const organization = await db.organization.update({
    where: { id: organizationId },
    data: { status },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "organization.status_changed",
    entityType: "organization",
    entityId: organizationId,
    metadata: { status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicOrganization(organization);
}
