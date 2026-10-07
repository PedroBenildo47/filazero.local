import { z } from "zod";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .default("Africa/Luanda")
  .refine(isTimeZone, "Invalid IANA time zone");

function periodIsOrdered(query: { from?: Date; to?: Date }): boolean {
  return !query.from || !query.to || query.from < query.to;
}

export const analyticsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    timezone: timezoneSchema,
  })
  .refine(periodIsOrdered, {
    message: "The from date must be earlier than the to date",
    path: ["from"],
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const ANALYTICS_EXPORT_FORMATS = ["csv", "pdf"] as const;
export type AnalyticsExportFormat = (typeof ANALYTICS_EXPORT_FORMATS)[number];

/** Languages the exported report can be rendered in. */
export const ANALYTICS_EXPORT_LANGS = ["pt", "en"] as const;
export type AnalyticsExportLang = (typeof ANALYTICS_EXPORT_LANGS)[number];

export const analyticsExportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    timezone: timezoneSchema,
    format: z.enum(ANALYTICS_EXPORT_FORMATS).default("csv"),
    lang: z.enum(ANALYTICS_EXPORT_LANGS).default("pt"),
  })
  .refine(periodIsOrdered, {
    message: "The from date must be earlier than the to date",
    path: ["from"],
  });

export type AnalyticsExportQuery = z.infer<typeof analyticsExportQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Report model                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ticket states that can appear in the per-status distribution. Mirrors the
 * `TicketStatus` Prisma enum; kept here so the pure export/formatters do not
 * depend on the generated Prisma client.
 */
export const ANALYTICS_TICKET_STATUSES = [
  "WAITING",
  "CALLED",
  "SERVING",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type AnalyticsTicketStatus = (typeof ANALYTICS_TICKET_STATUSES)[number];

export interface AnalyticsPeriod {
  from: string;
  to: string;
  timezone: string;
}

export interface AnalyticsTotals {
  /** Tickets issued in the period (any status), by `joinedAt`. */
  issuedTickets: number;
  /** Tickets completed in the period, by `completedAt`. */
  completedTickets: number;
  /** Tickets issued in the period whose current status is CANCELLED. */
  cancelledTickets: number;
  /** Tickets issued in the period whose current status is NO_SHOW. */
  noShowTickets: number;
  /** Still waiting to be called, among tickets issued in the period. */
  waitingTickets: number;
  /** Completion rate over issued tickets, in basis points (10000 = 100%). */
  completionRateBps: number;
  /** Cancellation rate over issued tickets, in basis points. */
  cancellationRateBps: number;
  /** No-show rate over issued tickets, in basis points. */
  noShowRateBps: number;
  /** Organization-wide average wait (join → service), in seconds. */
  averageWaitSeconds: number | null;
  /** Organization-wide average service time (service → completion), in seconds. */
  averageServiceSeconds: number | null;
}

export interface AnalyticsQueuePerformance {
  queueId: string;
  queueName: string;
  branchId: string;
  branchName: string;
  completedTickets: number;
  averageWaitSeconds: number | null;
  averageServiceSeconds: number | null;
}

export interface AnalyticsBranchPerformance {
  branchId: string;
  branchName: string;
  completedTickets: number;
  averageWaitSeconds: number | null;
  averageServiceSeconds: number | null;
}

export interface AnalyticsStatusCount {
  status: AnalyticsTicketStatus;
  count: number;
}

export interface AnalyticsPeak {
  /** Day with the most tickets issued, or `null` when the period has no data. */
  busiestDay: { date: string; count: number } | null;
  /** Local hour with the most completions, or `null` when there are none. */
  busiestHour: { hour: number; count: number } | null;
}

export interface OrganizationAnalyticsReport {
  period: AnalyticsPeriod;
  totals: AnalyticsTotals;
  issuedByDay: Array<{ date: string; count: number }>;
  issuedByWeek: Array<{ weekStart: string; count: number }>;
  queuePerformance: AnalyticsQueuePerformance[];
  branchPerformance: AnalyticsBranchPerformance[];
  statusDistribution: AnalyticsStatusCount[];
  completedByHour: Array<{ hour: number; count: number }>;
  peak: AnalyticsPeak;
}
