import { z } from "zod";
import { uuidSchema } from "@/lib/validation";

export const paymentMethodSchema = z.enum([
  "MULTICAIXA_EXPRESS",
  "BANK_TRANSFER",
  "CARD",
]);

export const checkoutSchema = z.object({
  organizationId: uuidSchema,
  planId: uuidSchema,
  method: paymentMethodSchema.default("MULTICAIXA_EXPRESS"),
});

export const assignPlanSchema = z.object({
  planId: uuidSchema,
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
