import { z } from "zod";
import { paginationSchema } from "@/lib/validation";

export const publicDirectoryQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(120).optional(),
});
