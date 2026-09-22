import { z } from "zod";
import { OrganizationStatus } from "@prisma/client";
import { emailSchema, paginationSchema, phoneSchema } from "@/lib/validation";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(120).optional(),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const organizationStatusSchema = z.object({
  status: z.nativeEnum(OrganizationStatus),
});

export const listOrganizationsQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(OrganizationStatus).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
