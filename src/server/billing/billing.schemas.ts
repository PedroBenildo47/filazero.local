import { z } from "zod";
import { uuidSchema } from "@/lib/validation";

export const checkoutSchema = z.object({
  organizationId: uuidSchema,
  planId: uuidSchema,
});

export const assignPlanSchema = z.object({
  planId: uuidSchema,
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
