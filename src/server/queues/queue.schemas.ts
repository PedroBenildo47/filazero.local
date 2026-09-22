import { z } from "zod";
import { QueueStatus } from "@prisma/client";

export const createQueueSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(160),
  description: z.string().trim().max(2000).optional(),
  status: z.nativeEnum(QueueStatus).optional(),
});

export const updateQueueSchema = createQueueSchema.partial();

export const queueStatusSchema = z.object({
  status: z.nativeEnum(QueueStatus),
});

export type CreateQueueInput = z.infer<typeof createQueueSchema>;
export type UpdateQueueInput = z.infer<typeof updateQueueSchema>;
