import { z } from "zod";
import { OrganizationStatus } from "@prisma/client";
import { paginationSchema } from "@/lib/validation";

/**
 * Query for the global organization directory (platform operator only).
 * Supports status, plan and free-text filters on top of pagination.
 */
export const adminOrganizationQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(OrganizationStatus).optional(),
  planCode: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

/**
 * Moderation status changes allowed from the platform panel.
 * Permanent removal is a separate, guarded operation (`DELETE`), so only the
 * reversible states are accepted here.
 */
export const adminOrganizationStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

/** Permanent deletion requires the operator to type the organization name. */
export const deleteOrganizationSchema = z.object({
  confirmName: z.string().trim().min(1).max(200),
});

/** Financial window for the consolidated revenue dashboard. */
export const adminFinanceQuerySchema = z.object({
  months: z.coerce.number().int().min(3).max(24).default(12),
});

/** Filters for the global audit trail. */
export const auditLogQuerySchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type AdminOrganizationQuery = z.infer<typeof adminOrganizationQuerySchema>;
export type AdminOrganizationStatusInput = z.infer<typeof adminOrganizationStatusSchema>;
export type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
export type AdminFinanceQuery = z.infer<typeof adminFinanceQuerySchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
