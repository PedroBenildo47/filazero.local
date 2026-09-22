import { z } from "zod";
import { TicketStatus } from "@prisma/client";
import { paginationSchema } from "@/lib/validation";

export const cancelTicketSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const queueStateQuerySchema = z.object({
  recentLimit: z.coerce.number().int().min(0).max(50).default(10),
});

export const myTicketsQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(TicketStatus).optional(),
});

export type CancelTicketInput = z.infer<typeof cancelTicketSchema>;
