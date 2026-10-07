import { z } from "zod";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const analyticsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .default("Africa/Luanda")
      .refine(isTimeZone, "Invalid IANA time zone"),
  })
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    message: "The from date must be earlier than the to date",
    path: ["from"],
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
