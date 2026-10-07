import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "@/lib/validation";

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
  })
  .strict();

export type SelfRegistrationInput = z.infer<typeof selfRegistrationSchema>;
