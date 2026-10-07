import { z } from "zod";

/**
 * Update for the customer's out-of-app notification preferences. Every field is
 * optional so a client can change one thing at a time; the service normalises
 * and validates the phone number itself.
 */
export const notificationPreferencesSchema = z
  .object({
    phone: z.union([z.string().trim().max(32), z.null()]).optional(),
    smsOptIn: z.boolean().optional(),
    whatsappOptIn: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference must be provided",
  });

export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
