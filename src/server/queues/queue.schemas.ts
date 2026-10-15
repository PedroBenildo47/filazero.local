import { z } from "zod";
import { QueueStatus } from "@prisma/client";

/** 1–3 letters shown before the ticket number (e.g. A = geral, P = prioritário). */
export const queuePrefixSchema = z
  .string()
  .trim()
  .max(3)
  .transform((value) => value.toUpperCase())
  .refine((value) => value === "" || /^[A-Z]{1,3}$/.test(value), {
    message: "invalid_prefix",
  })
  .optional();

export const createQueueSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(160),
  description: z.string().trim().max(2000).optional(),
  prefix: queuePrefixSchema,
  status: z.nativeEnum(QueueStatus).optional(),
});

export const updateQueueSchema = createQueueSchema.partial();

export const queueStatusSchema = z.object({
  status: z.nativeEnum(QueueStatus),
});

export type CreateQueueInput = z.infer<typeof createQueueSchema>;
export type UpdateQueueInput = z.infer<typeof updateQueueSchema>;
