import { z } from "zod";
import { isValidCompanyNif, isValidNif } from "@/lib/nif";
import { uuidSchema } from "@/lib/validation";

export const paymentMethodSchema = z.enum([
  "MULTICAIXA_EXPRESS",
  "BANK_TRANSFER",
  "CARD",
]);

/** Shared normalisation: trim, drop separators, upper-case province letters. */
const nifBase = z
  .string()
  .trim()
  .max(20)
  .transform((value) => value.replace(/[\s.\-/]/g, "").toUpperCase());

/**
 * Any Angolan NIF: company (10 digits, leading `5`), individual (9 digits) or the
 * full 14-character BI. Empty strings are treated as "not provided".
 */
export const nifSchema = nifBase
  .refine((value) => value === "" || isValidNif(value), { message: "invalid_nif" })
  .optional();

/** Company (pessoa coletiva) NIF. Optional. */
export const companyNifSchema = nifBase
  .refine((value) => value === "" || isValidCompanyNif(value), {
    message: "invalid_company_nif",
  })
  .optional();

/** Company NIF that must be present and valid (organization onboarding). */
export const requiredCompanyNifSchema = nifBase.refine(isValidCompanyNif, {
  message: "invalid_company_nif",
});

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
