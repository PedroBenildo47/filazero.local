/**
 * Platform operator (Super Admin) — global organization management.
 *
 * This is the ONE surface that intentionally reads across tenants. It is kept
 * apart from `organizations/organization.service.ts` on purpose: the tenant
 * routes must stay forbidden for ADMINISTRATOR (enforced by
 * `assertOrganizationAccess`), while this module is reachable only through
 * `platform:admin`.
 *
 * Permanent deletion is transactional and preserves the audit trail: the
 * organization's operational rows cascade away, but the audit entry survives
 * with the deleted organization's identity captured in its metadata.
 */
import "server-only";
import type { OrganizationStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { paginationToSkipTake } from "@/lib/validation";
import { recordAudit } from "@/server/audit/audit.service";
import { assertPlatformAdmin, type AuthContext } from "@/server/context";
import type {
  AdminOrganizationQuery,
  DeleteOrganizationInput,
} from "./platform.schemas";

const adminOrganizationInclude = {
  subscription: { include: { plan: true } },
  _count: { select: { branches: true, queues: true, members: true, documents: true } },
} satisfies Prisma.OrganizationInclude;

type AdminOrganizationRow = Prisma.OrganizationGetPayload<{
  include: typeof adminOrganizationInclude;
}>;

function serializeAdminOrganization(organization: AdminOrganizationRow) {
  return {
    id: organization.id,
    name: organization.name,
    description: organization.description,
    category: organization.category,
    city: organization.city,
    country: organization.country,
    phone: organization.phone,
    email: organization.email,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    subscription: organization.subscription
      ? {
          id: organization.subscription.id,
          status: organization.subscription.status,
          currentPeriodStart: organization.subscription.currentPeriodStart,
          currentPeriodEnd: organization.subscription.currentPeriodEnd,
          plan: {
            id: organization.subscription.plan.id,
            code: organization.subscription.plan.code,
            name: organization.subscription.plan.name,
            priceCents: organization.subscription.plan.priceCents,
            currency: organization.subscription.plan.currency,
            interval: organization.subscription.plan.interval,
          },
        }
      : null,
    counts: {
      branches: organization._count.branches,
      queues: organization._count.queues,
      members: organization._count.members,
      documents: organization._count.documents,
    },
  };
}

/** Global, paginated organization directory for the platform operator. */
export async function listOrganizationsForAdmin(
  ctx: AuthContext,
  query: AdminOrganizationQuery,
) {
  assertPlatformAdmin(ctx);
  const { skip, take } = paginationToSkipTake(query);

  const where: Prisma.OrganizationWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.planCode
      ? { subscription: { plan: { code: query.planCode } } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { category: { contains: query.q, mode: "insensitive" } },
            { city: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await db.$transaction([
    db.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: adminOrganizationInclude,
    }),
    db.organization.count({ where }),
  ]);

  return {
    items: items.map(serializeAdminOrganization),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Full detail for a single organization, including branches. */
export async function getOrganizationDetailForAdmin(
  ctx: AuthContext,
  organizationId: string,
) {
  assertPlatformAdmin(ctx);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      ...adminOrganizationInclude,
      branches: {
        orderBy: { name: "asc" },
        include: { _count: { select: { queues: true, members: true } } },
      },
    },
  });

  if (!organization) throw AppError.notFound("Organization not found");

  return {
    ...serializeAdminOrganization(organization),
    branches: organization.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      city: branch.city,
      address: branch.address,
      status: branch.status,
      counts: { queues: branch._count.queues, members: branch._count.members },
    })),
  };
}

/**
 * Suspend / reactivate an organization. Reversible moderation only; it never
 * touches billing history.
 */
export async function setOrganizationStatusAdmin(
  ctx: AuthContext,
  organizationId: string,
  status: OrganizationStatus,
  meta: RequestMeta,
) {
  assertPlatformAdmin(ctx);

  const existing = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, status: true },
  });
  if (!existing) throw AppError.notFound("Organization not found");

  const organization = await db.organization.update({
    where: { id: organizationId },
    data: { status },
  });

  await recordAudit(db, {
    actorUserId: ctx.user.id,
    action: "platform.organization_status_changed",
    entityType: "organization",
    entityId: organizationId,
    description: organization.name,
    metadata: { from: existing.status, to: status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { id: organization.id, status: organization.status };
}

/**
 * Permanently removes an organization and everything reachable from it.
 *
 * Guard rail: an organization with at least one SUCCEEDED transaction is never
 * deleted — the financial/audit history must stay intact. Such organizations
 * can only be suspended. The operator must also type the exact name.
 */
export async function deleteOrganizationPermanently(
  ctx: AuthContext,
  organizationId: string,
  input: DeleteOrganizationInput,
  meta: RequestMeta,
) {
  assertPlatformAdmin(ctx);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      category: true,
      city: true,
      status: true,
      createdAt: true,
      subscription: { select: { plan: { select: { code: true } } } },
    },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  if (organization.name.trim().toLowerCase() !== input.confirmName.trim().toLowerCase()) {
    throw AppError.badRequest(
      "The confirmation name does not match the organization name",
      { reason: "CONFIRMATION_MISMATCH" },
    );
  }

  const paidTransactions = await db.transaction.count({
    where: { organizationId, status: "SUCCEEDED" },
  });
  if (paidTransactions > 0) {
    throw new AppError(
      "CONFLICT",
      "This organization has paid transactions and cannot be permanently deleted. Suspend it instead.",
      { reason: "HAS_PAID_TRANSACTIONS", paidTransactions },
    );
  }

  const [branchCount, queueCount, memberCount, ticketCount] = await db.$transaction([
    db.branch.count({ where: { organizationId } }),
    db.queue.count({ where: { organizationId } }),
    db.organizationMember.count({ where: { organizationId } }),
    db.ticket.count({ where: { queue: { organizationId } } }),
  ]);

  await db.$transaction(async (tx) => {
    // Cascades remove branches, queues, tickets, members, subscription,
    // transactions and documents. Audit rows are preserved (SetNull actor,
    // free-text entity id).
    await tx.organization.delete({ where: { id: organizationId } });

    await recordAudit(tx, {
      actorUserId: ctx.user.id,
      action: "platform.organization_deleted",
      entityType: "organization",
      entityId: organizationId,
      description: organization.name,
      metadata: {
        snapshot: {
          name: organization.name,
          category: organization.category,
          city: organization.city,
          status: organization.status,
          planCode: organization.subscription?.plan.code ?? null,
          createdAt: organization.createdAt.toISOString(),
        },
        removed: {
          branches: branchCount,
          queues: queueCount,
          members: memberCount,
          tickets: ticketCount,
        },
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });

  return {
    id: organizationId,
    deleted: true,
    removed: {
      branches: branchCount,
      queues: queueCount,
      members: memberCount,
      tickets: ticketCount,
    },
  };
}
