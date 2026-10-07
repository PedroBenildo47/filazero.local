import { z } from "zod";
import { uuidSchema } from "@/lib/validation";

export const paymentMethodSchema = z.enum([
  "MULTICAIXA_EXPRESS",
  "BANK_TRANSFER",
  "CARD",
]);

export const nifSchema = z
  .string()
  .trim()
  .max(20)
  .transform((value) => value.replace(/[\s.\-/]/g, ""))
  .refine((value) => value === "" || /^\d{9,10}$/.test(value), {
    message: "invalid_nif",
  })
  .optional();

export const checkoutSchema = z.object({
  organizationId: uuidSchema,
  planId: uuidSchema,
  method: paymentMethodSchema.default("MULTICAIXA_EXPRESS"),
  /** NIF to print on the invoice; falls back to the organization's NIF. */
  taxId: nifSchema,
});

export const assignPlanSchema = z.object({
  planId: uuidSchema,
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
