import { z } from "zod";
import { paginationSchema } from "@/lib/validation";

export const atmStatusSchema = z.enum([
  "OPERATIONAL",
  "OUT_OF_CASH",
  "OFFLINE",
  "UNKNOWN",
]);

/** Public list filters. */
export const atmQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  bank: z.string().trim().min(1).max(120).optional(),
  status: atmStatusSchema.optional(),
});

/** Community / manager status report. */
export const atmReportSchema = z.object({
  status: atmStatusSchema,
  note: z.string().trim().max(300).optional(),
  /** Optional display name for an anonymous community report. */
  reporterName: z.string().trim().max(120).optional(),
});

/** Platform admin: create an ATM. */
export const createAtmSchema = z.object({
  bank: z.string().trim().min(2).max(120),
  label: z.string().trim().max(160).optional(),
  address: z.string().trim().min(3).max(255),
  city: z.string().trim().min(2).max(120),
  province: z.string().trim().max(120).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  status: atmStatusSchema.default("UNKNOWN"),
  cashLevel: z.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(300).optional(),
});

/** Platform admin: update an ATM (partial). */
export const updateAtmSchema = createAtmSchema.partial().extend({
  active: z.boolean().optional(),
});

export type AtmQuery = z.infer<typeof atmQuerySchema>;
export type AtmReportInput = z.infer<typeof atmReportSchema>;
export type CreateAtmInput = z.infer<typeof createAtmSchema>;
export type UpdateAtmInput = z.infer<typeof updateAtmSchema>;
