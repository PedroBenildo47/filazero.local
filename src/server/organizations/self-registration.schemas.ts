import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "@/lib/validation";
import { requiredCompanyNifSchema } from "@/server/billing/billing.schemas";

/** External logo URL. Only HTTPS is accepted; empty means "not provided". */
const logoUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || /^https:\/\/[^\s]+$/.test(value), {
    message: "invalid_logo_url",
  })
  .optional();

export const selfRegistrationSchema = z
  .object({
    ownerName: z.string().trim().min(2).max(160),
    ownerEmail: emailSchema,
    ownerPhone: phoneSchema.optional(),
    password: passwordSchema,
    organizationName: z.string().trim().min(2).max(200),
    category: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    address: z.string().trim().max(255).optional(),
    city: z.string().trim().max(120).optional(),
    country: z.string().trim().max(120).optional(),
    organizationPhone: phoneSchema.optional(),
    organizationEmail: emailSchema.optional(),
    /** Company NIF (pessoa coletiva): 10 digits starting with 5. Required. */
    taxId: requiredCompanyNifSchema,
    /** Optional external logo URL, used when no logo file is uploaded. */
    logoUrl: logoUrlSchema,
  })
  .strict();

export type SelfRegistrationInput = z.infer<typeof selfRegistrationSchema>;
