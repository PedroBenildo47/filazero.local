/**
 * Server-side analytics export (CSV and PDF).
 *
 * Reuses the exact same data path as the JSON analytics endpoint
 * (`getOrganizationAnalytics`), so the exported file can never diverge from what
 * the manager sees on screen — including branch scoping and tenant isolation.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dictionaries, type Lang } from "@/lib/i18n";
import type { AuthContext } from "@/server/context";
import { buildAnalyticsCsv, analyticsReportFileName, type AnalyticsReportLabels } from "./analytics-export";
import { renderAnalyticsPdf } from "./analytics-pdf";
import type { AnalyticsExportQuery } from "./analytics.schemas";
import { getOrganizationAnalytics } from "./analytics.service";

export interface AnalyticsExportResult {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
}

/** Builds the localised labels the pure formatter and the PDF renderer need. */
export function analyticsReportLabels(lang: Lang): AnalyticsReportLabels {
  const t = dictionaries[lang];
  return {
    organization: t["analytics.organization"],
    periodFrom: t["analytics.periodFrom"],
    periodTo: t["analytics.periodTo"],
    timezone: t["analytics.timezone"],
    generatedAt: t["analytics.generatedAt"],
    summary: t["analytics.summary"],
    metric: t["analytics.metric"],
    value: t["analytics.value"],
    issuedTickets: t["analytics.ticketsIssued"],
    completedTickets: t["analytics.ticketsCompleted"],
    cancelledTickets: t["analytics.cancelled"],
    noShowTickets: t["analytics.noShow"],
    waitingTickets: t["analytics.waiting"],
    completionRate: t["analytics.completionRate"],
    cancellationRate: t["analytics.cancellationRate"],
    noShowRate: t["analytics.noShowRate"],
    averageWait: t["analytics.averageWaitOverall"],
    averageService: t["analytics.averageServiceOverall"],
    peak: t["analytics.peak"],
    busiestDay: t["analytics.busiestDay"],
    busiestHour: t["analytics.busiestHour"],
    daily: t["analytics.daily"],
    date: t["analytics.date"],
    tickets: t["analytics.tickets"],
    weekly: t["analytics.weekly"],
    weekStart: t["analytics.weekStart"],
    queuePerformance: t["analytics.queuePerformance"],
    branchPerformance: t["analytics.branchPerformance"],
    branch: t["analytics.branch"],
    queue: t["analytics.queue"],
    completed: t["analytics.completed"],
    averageWaitSeconds: t["analytics.averageWait"],
    averageServiceSeconds: t["analytics.averageService"],
    statusDistribution: t["analytics.statusDistribution"],
    status: t["analytics.status"],
    statusLabels: {
      WAITING: t["analytics.status.WAITING"],
      CALLED: t["analytics.status.CALLED"],
      SERVING: t["analytics.status.SERVING"],
      COMPLETED: t["analytics.status.COMPLETED"],
      CANCELLED: t["analytics.status.CANCELLED"],
      NO_SHOW: t["analytics.status.NO_SHOW"],
    },
    hourly: t["analytics.completedByHour"],
    hour: t["analytics.hour"],
  };
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

export async function exportOrganizationAnalytics(
  context: AuthContext,
  organizationId: string,
  query: AnalyticsExportQuery,
): Promise<AnalyticsExportResult> {
  const report = await getOrganizationAnalytics(context, organizationId, query);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!organization) throw AppError.notFound("Organization not found");

  const meta = { organizationName: organization.name, generatedAt: new Date() };
  const labels = analyticsReportLabels(query.lang);

  if (query.format === "pdf") {
    const bytes = await renderAnalyticsPdf(
      report,
      meta,
      labels,
      dictionaries[query.lang]["analytics.exportTitle"],
    );
    return {
      bytes,
      fileName: analyticsReportFileName(meta, report, "pdf"),
      contentType: "application/pdf",
    };
  }

  const csv = buildAnalyticsCsv(report, meta, labels);
  return {
    bytes: toBytes(csv),
    fileName: analyticsReportFileName(meta, report, "csv"),
    contentType: "text/csv; charset=utf-8",
  };
}
