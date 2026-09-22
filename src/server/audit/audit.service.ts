/**
 * Audit trail.
 *
 * Append-only record of administrative and operationally significant actions.
 * `metadata` must never contain secrets or plaintext passwords.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/lib/db";

export interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(
  client: DbClient,
  input: AuditInput,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      description: input.description ?? null,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
