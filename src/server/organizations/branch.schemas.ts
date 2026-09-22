import { z } from "zod";
import { BranchStatus } from "@prisma/client";

export const createBranchSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(200),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
});

export const updateBranchSchema = createBranchSchema.partial().extend({
  status: z.nativeEnum(BranchStatus).optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
