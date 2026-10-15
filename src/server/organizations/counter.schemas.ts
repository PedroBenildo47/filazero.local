import { z } from "zod";
import { uuidSchema } from "@/lib/validation";

export const createCounterSchema = z.object({
  branchId: uuidSchema,
  name: z.string().trim().min(1).max(80),
});

export const updateCounterSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
});

export const listCountersQuerySchema = z.object({
  branchId: uuidSchema.optional(),
});

export type CreateCounterInput = z.infer<typeof createCounterSchema>;
export type UpdateCounterInput = z.infer<typeof updateCounterSchema>;
export type ListCountersQuery = z.infer<typeof listCountersQuerySchema>;
