/**
 * Platform operator (Super Admin) — global audit trail (read side).
 *
 * Audit rows are append-only and never deleted; the read surface only filters
 * and paginates them. `metadata` is returned as-is but must never contain
 * secrets (enforced at write time).
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { paginationToSkipTake } from "@/lib/validation";
import { assertPlatformAdmin, type AuthContext } from "@/server/context";
import type { AuditLogQuery } from "./platform.schemas";

export async function listAuditLogs(ctx: AuthContext, query: AuditLogQuery) {
  assertPlatformAdmin(ctx);
  const { skip, take } = paginationToSkipTake(query);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
    ...(query.entityType
      ? { entityType: { contains: query.entityType, mode: "insensitive" } }
      : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await db.$transaction([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    items: items.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      description: entry.description,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      createdAt: entry.createdAt,
      actor: entry.actor
        ? { id: entry.actor.id, name: entry.actor.name, email: entry.actor.email }
        : null,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
