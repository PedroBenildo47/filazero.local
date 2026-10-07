/**
 * Pure analytics export formatting.
 *
 * No I/O and no `server-only`: it turns an `OrganizationAnalyticsReport` into a
 * deterministic CSV string and derives the download file name. Labels are
 * injected by the caller so this module stays language-agnostic and unit-testable
 * (see `tests/unit/analytics-export.test.ts`).
 *
 * CSV notes:
 * - UTF-8 BOM so Excel (very common in Angola) detects the encoding.
 * - CRLF line endings, per RFC 4180.
 * - Every cell is quoted and embedded quotes are doubled.
 * - Cells starting with `=`, `+`, `-`, `@` (after optional spaces) are prefixed
 *   with an apostrophe to neutralise spreadsheet formula injection.
 */
import type {
  AnalyticsTicketStatus,
  OrganizationAnalyticsReport,
} from "./analytics.schemas";

export interface AnalyticsReportLabels {
  organization: string;
  periodFrom: string;
  periodTo: string;
  timezone: string;
  generatedAt: string;
  summary: string;
  metric: string;
  value: string;
  issuedTickets: string;
  completedTickets: string;
  cancelledTickets: string;
  noShowTickets: string;
  waitingTickets: string;
  completionRate: string;
  cancellationRate: string;
  noShowRate: string;
  averageWait: string;
  averageService: string;
  peak: string;
  busiestDay: string;
  busiestHour: string;
  daily: string;
  date: string;
  tickets: string;
  weekly: string;
  weekStart: string;
  queuePerformance: string;
  branchPerformance: string;
  branch: string;
  queue: string;
  completed: string;
  averageWaitSeconds: string;
  averageServiceSeconds: string;
  statusDistribution: string;
  status: string;
  statusLabels: Record<AnalyticsTicketStatus, string>;
  hourly: string;
  hour: string;
}

export interface AnalyticsReportMeta {
  organizationName: string;
  generatedAt: Date;
}

const BOM = "\uFEFF";
const CRLF = "\r\n";

/** `1400` → `14.00%` (two decimals, always). */
export function formatRateBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function escapeCell(value: string | number): string {
  let text = String(value);
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function row(cells: Array<string | number>): string {
  return cells.map(escapeCell).join(",");
}

function seconds(value: number | null): string | number {
  return value === null ? "" : value;
}

export function buildAnalyticsCsv(
  report: OrganizationAnalyticsReport,
  meta: AnalyticsReportMeta,
  labels: AnalyticsReportLabels,
): string {
  const lines: string[] = [];
  const blank = () => lines.push("");

  // ---- Identification ----------------------------------------------------
  lines.push(row([labels.organization, meta.organizationName]));
  lines.push(row([labels.periodFrom, report.period.from]));
  lines.push(row([labels.periodTo, report.period.to]));
  lines.push(row([labels.timezone, report.period.timezone]));
  lines.push(row([labels.generatedAt, meta.generatedAt.toISOString()]));
  blank();

  // ---- Summary / KPIs ----------------------------------------------------
  lines.push(row([labels.summary, labels.value]));
  lines.push(row([labels.issuedTickets, report.totals.issuedTickets]));
  lines.push(row([labels.completedTickets, report.totals.completedTickets]));
  lines.push(row([labels.cancelledTickets, report.totals.cancelledTickets]));
  lines.push(row([labels.noShowTickets, report.totals.noShowTickets]));
  lines.push(row([labels.waitingTickets, report.totals.waitingTickets]));
  lines.push(row([labels.completionRate, formatRateBps(report.totals.completionRateBps)]));
  lines.push(row([labels.cancellationRate, formatRateBps(report.totals.cancellationRateBps)]));
  lines.push(row([labels.noShowRate, formatRateBps(report.totals.noShowRateBps)]));
  lines.push(row([labels.averageWait, seconds(report.totals.averageWaitSeconds)]));
  lines.push(row([labels.averageService, seconds(report.totals.averageServiceSeconds)]));
  blank();

  // ---- Peak --------------------------------------------------------------
  lines.push(row([labels.peak, labels.value]));
  lines.push(
    row([
      labels.busiestDay,
      report.peak.busiestDay ? report.peak.busiestDay.date : "",
      report.peak.busiestDay ? report.peak.busiestDay.count : "",
    ]),
  );
  lines.push(
    row([
      labels.busiestHour,
      report.peak.busiestHour ? report.peak.busiestHour.hour : "",
      report.peak.busiestHour ? report.peak.busiestHour.count : "",
    ]),
  );
  blank();

  // ---- Daily series ------------------------------------------------------
  lines.push(row([labels.daily, labels.date, labels.tickets]));
  for (const entry of report.issuedByDay) {
    lines.push(row([labels.daily, entry.date, entry.count]));
  }
  blank();

  // ---- Weekly series -----------------------------------------------------
  lines.push(row([labels.weekly, labels.weekStart, labels.tickets]));
  for (const entry of report.issuedByWeek) {
    lines.push(row([labels.weekly, entry.weekStart, entry.count]));
  }
  blank();

  // ---- Branch performance ------------------------------------------------
  lines.push(
    row([
      labels.branchPerformance,
      labels.branch,
      labels.completed,
      labels.averageWaitSeconds,
      labels.averageServiceSeconds,
    ]),
  );
  for (const entry of report.branchPerformance) {
    lines.push(
      row([
        labels.branchPerformance,
        entry.branchName,
        entry.completedTickets,
        seconds(entry.averageWaitSeconds),
        seconds(entry.averageServiceSeconds),
      ]),
    );
  }
  blank();

  // ---- Queue performance -------------------------------------------------
  lines.push(
    row([
      labels.queuePerformance,
      labels.branch,
      labels.queue,
      labels.completed,
      labels.averageWaitSeconds,
      labels.averageServiceSeconds,
    ]),
  );
  for (const entry of report.queuePerformance) {
    lines.push(
      row([
        labels.queuePerformance,
        entry.branchName,
        entry.queueName,
        entry.completedTickets,
        seconds(entry.averageWaitSeconds),
        seconds(entry.averageServiceSeconds),
      ]),
    );
  }
  blank();

  // ---- Status distribution ----------------------------------------------
  lines.push(row([labels.statusDistribution, labels.status, labels.tickets]));
  for (const entry of report.statusDistribution) {
    lines.push(row([labels.statusDistribution, labels.statusLabels[entry.status], entry.count]));
  }
  blank();

  // ---- Hourly distribution ----------------------------------------------
  lines.push(row([labels.hourly, labels.hour, labels.completed]));
  for (const entry of report.completedByHour) {
    lines.push(row([labels.hourly, entry.hour, entry.count]));
  }

  return BOM + lines.join(CRLF) + CRLF;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 60) : "organizacao";
}

/** `filazero-analytics-<org>-<from>_<to>.<ext>` with the dates as `YYYY-MM-DD`. */
export function analyticsReportFileName(
  meta: AnalyticsReportMeta,
  report: OrganizationAnalyticsReport,
  extension: "csv" | "pdf",
): string {
  const from = report.period.from.slice(0, 10);
  const to = report.period.to.slice(0, 10);
  return `filazero-analytics-${slugify(meta.organizationName)}-${from}_${to}.${extension}`;
}
