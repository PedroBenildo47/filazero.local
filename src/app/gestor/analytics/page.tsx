"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Card, EmptyState, Spinner, StatCard } from "@/components/ui";

interface OrganizationOption {
  id: string;
  name: string;
}

type TicketStatus = "WAITING" | "CALLED" | "SERVING" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

interface AnalyticsData {
  period: { from: string; to: string; timezone: string };
  totals: {
    issuedTickets: number;
    completedTickets: number;
    cancelledTickets: number;
    noShowTickets: number;
    waitingTickets: number;
    completionRateBps: number;
    cancellationRateBps: number;
    noShowRateBps: number;
    averageWaitSeconds: number | null;
    averageServiceSeconds: number | null;
  };
  issuedByDay: Array<{ date: string; count: number }>;
  issuedByWeek: Array<{ weekStart: string; count: number }>;
  queuePerformance: Array<{
    queueId: string;
    queueName: string;
    branchId: string;
    branchName: string;
    completedTickets: number;
    averageWaitSeconds: number | null;
    averageServiceSeconds: number | null;
  }>;
  branchPerformance: Array<{
    branchId: string;
    branchName: string;
    completedTickets: number;
    averageWaitSeconds: number | null;
    averageServiceSeconds: number | null;
  }>;
  statusDistribution: Array<{ status: TicketStatus; count: number }>;
  completedByHour: Array<{ hour: number; count: number }>;
  peak: {
    busiestDay: { date: string; count: number } | null;
    busiestHour: { hour: number; count: number } | null;
  };
}

interface ChartPoint {
  label: string;
  value: number;
}

function BarChart({
  points,
  label,
  showEvery = 1,
}: {
  points: ChartPoint[];
  label: string;
  showEvery?: number;
}) {
  const width = 760;
  const height = 250;
  const left = 34;
  const right = 14;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slotWidth = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(2, Math.min(28, slotWidth * 0.62));
  const maximum = Math.max(1, ...points.map((point) => point.value));

  return (
    <div className="analytics-chart-scroll">
      <svg
        className="analytics-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
      >
        <line className="analytics-axis" x1={left} y1={top + plotHeight} x2={width - right} y2={top + plotHeight} />
        {points.map((point, index) => {
          const barHeight = point.value === 0 ? 0 : (point.value / maximum) * plotHeight;
          const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = top + plotHeight - barHeight;
          const shouldShowLabel = index % showEvery === 0 || index === points.length - 1;
          return (
            <g key={`${point.label}-${index}`}>
              {point.value > 0 && (
                <rect className="analytics-bar" x={x} y={y} width={barWidth} height={barHeight} rx="2">
                  <title>{`${point.label}: ${point.value}`}</title>
                </rect>
              )}
              {shouldShowLabel && (
                <text className="analytics-axis-label" x={x + barWidth / 2} y={height - 15} textAnchor="middle">
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatDuration(seconds: number | null, locale: string, fallback: string): string {
  if (seconds === null) return fallback;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(minutes)} min ${remainder} s`;
}

function formatRate(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(bps / 10_000);
}

function AnalyticsDashboard() {
  const { t, tError, lang } = useI18n();
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [view, setView] = useState<"day" | "week">("day");
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<{ items: OrganizationOption[] }>("/api/organizations?pageSize=50")
      .then((result) => {
        if (!active) return;
        setOrganizations(result.items);
        if (result.items[0]) setOrganizationId(result.items[0].id);
      })
      .catch((caught) => {
        if (active) setError(tError(caught));
      })
      .finally(() => {
        if (active) setLoadingOrganizations(false);
      });
    return () => {
      active = false;
    };
  }, [tError]);

  useEffect(() => {
    if (!organizationId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoadingAnalytics(true);
    setError(null);
    void api<AnalyticsData>(`/api/organizations/${organizationId}/analytics`, {
      signal: controller.signal,
    })
      .then((result) => setData(result))
      .catch((caught) => {
        if (!controller.signal.aborted) setError(tError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAnalytics(false);
      });
    return () => controller.abort();
  }, [organizationId, tError]);

  async function downloadExport(format: "csv" | "pdf") {
    if (!organizationId) return;
    setExporting(format);
    setError(null);
    try {
      const params = new URLSearchParams({ format, lang });
      const response = await fetch(
        `/api/organizations/${organizationId}/analytics/export?${params.toString()}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        let code = "INTERNAL";
        try {
          code = ((await response.json()) as { error?: { code?: string } })?.error?.code ?? code;
        } catch {
          code = "INTERNAL";
        }
        throw new ApiError(code, t("analytics.exportFailed"), response.status);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] ?? `filazero-analytics.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 1_000);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setExporting(null);
    }
  }

  const organizationName = organizations.find((organization) => organization.id === organizationId)?.name ?? "";
  const locale = lang === "pt" ? "pt-PT" : "en-GB";
  const dailyPoints = data?.issuedByDay.map((row) => ({ label: row.date.slice(5), value: row.count })) ?? [];
  const weeklyPoints = data?.issuedByWeek.map((row) => ({ label: row.weekStart.slice(5), value: row.count })) ?? [];
  const hourlyPoints = data?.completedByHour.map((row) => ({ label: `${String(row.hour).padStart(2, "0")}h`, value: row.count })) ?? [];

  if (loadingOrganizations) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  return (
    <main className="container animate-in analytics-page">
      <div className="row spread analytics-header no-print">
        <div>
          <p className="eyebrow">{t("analytics.eyebrow")}</p>
          <h1>{t("analytics.title")}</h1>
          <p className="muted">{t("analytics.subtitle")}</p>
        </div>
        <Link href="/gestor" className="btn btn-ghost btn-sm">{t("common.back")}</Link>
      </div>

      {organizations.length > 0 && (
        <label className="field analytics-organization no-print">
          <span>{t("manager.organization")}</span>
          <select className="input" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
            {organizations.map((organization) => (
              <option value={organization.id} key={organization.id}>{organization.name}</option>
            ))}
          </select>
        </label>
      )}

      {data && (
        <div className="analytics-report">
          <div className="row spread analytics-report-heading">
            <div>
              <h2>{organizationName}</h2>
              <p className="muted">
                {t("analytics.last30Days")} · {t("analytics.timezone")}: {data.period.timezone}
              </p>
            </div>
            <div className="row analytics-actions no-print">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void downloadExport("csv")}
                disabled={exporting !== null}
              >
                {exporting === "csv" ? t("common.loading") : t("analytics.exportCsv")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void downloadExport("pdf")}
                disabled={exporting !== null}
              >
                {exporting === "pdf" ? t("common.loading") : t("analytics.exportPdf")}
              </button>
            </div>
          </div>

          <div className="kpi-grid">
            <StatCard label={t("analytics.ticketsIssued")} value={data.totals.issuedTickets} tone="info" />
            <StatCard label={t("analytics.ticketsCompleted")} value={data.totals.completedTickets} tone="ok" />
            <StatCard label={t("analytics.completionRate")} value={formatRate(data.totals.completionRateBps, locale)} tone="ok" />
            <StatCard label={t("analytics.cancelled")} value={data.totals.cancelledTickets} tone="info" />
            <StatCard label={t("analytics.noShow")} value={data.totals.noShowTickets} tone="info" />
            <StatCard label={t("analytics.averageWaitOverall")} value={formatDuration(data.totals.averageWaitSeconds, locale, "—")} tone="info" />
          </div>

          <Card title={t("analytics.peak")}>
            <div className="row" style={{ gap: "1.5rem", flexWrap: "wrap" }}>
              <p className="muted">
                {t("analytics.busiestDay")}:{" "}
                <strong>{data.peak.busiestDay ? `${data.peak.busiestDay.date} (${data.peak.busiestDay.count})` : "—"}</strong>
              </p>
              <p className="muted">
                {t("analytics.busiestHour")}:{" "}
                <strong>{data.peak.busiestHour ? `${String(data.peak.busiestHour.hour).padStart(2, "0")}h (${data.peak.busiestHour.count})` : "—"}</strong>
              </p>
            </div>
          </Card>

          <Card title={view === "day" ? t("analytics.issuedByDay") : t("analytics.issuedByWeek")}>
            <div className="analytics-segment no-print" role="group" aria-label={t("analytics.periodView")}>
              <button type="button" className={view === "day" ? "is-selected" : ""} aria-pressed={view === "day"} onClick={() => setView("day")}>{t("analytics.daily")}</button>
              <button type="button" className={view === "week" ? "is-selected" : ""} aria-pressed={view === "week"} onClick={() => setView("week")}>{t("analytics.weekly")}</button>
            </div>
            {(view === "day" ? dailyPoints : weeklyPoints).length > 0 ? (
              <BarChart
                points={view === "day" ? dailyPoints : weeklyPoints}
                label={view === "day" ? t("analytics.issuedByDay") : t("analytics.issuedByWeek")}
                showEvery={view === "day" ? 5 : 1}
              />
            ) : <EmptyState>{t("analytics.noData")}</EmptyState>}
          </Card>

          <Card title={t("analytics.branchPerformance")}>
            {data.branchPerformance.length === 0 ? (
              <EmptyState>{t("analytics.noData")}</EmptyState>
            ) : (
              <div className="analytics-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("analytics.branch")}</th>
                      <th className="nums">{t("analytics.completed")}</th>
                      <th className="nums">{t("analytics.averageWait")}</th>
                      <th className="nums">{t("analytics.averageService")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.branchPerformance.map((branch) => (
                      <tr key={branch.branchId}>
                        <td>{branch.branchName}</td>
                        <td className="nums">{branch.completedTickets}</td>
                        <td className="nums">{formatDuration(branch.averageWaitSeconds, locale, "—")}</td>
                        <td className="nums">{formatDuration(branch.averageServiceSeconds, locale, "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t("analytics.queuePerformance")}>
            {data.queuePerformance.length === 0 ? (
              <EmptyState>{t("analytics.noData")}</EmptyState>
            ) : (
              <div className="analytics-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("analytics.branch")}</th>
                      <th>{t("analytics.queue")}</th>
                      <th className="nums">{t("analytics.completed")}</th>
                      <th className="nums">{t("analytics.averageWait")}</th>
                      <th className="nums">{t("analytics.averageService")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queuePerformance.map((queue) => (
                      <tr key={queue.queueId}>
                        <td>{queue.branchName}</td>
                        <td>{queue.queueName}</td>
                        <td className="nums">{queue.completedTickets}</td>
                        <td className="nums">{formatDuration(queue.averageWaitSeconds, locale, "—")}</td>
                        <td className="nums">{formatDuration(queue.averageServiceSeconds, locale, "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t("analytics.statusDistribution")}>
            <div className="analytics-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("analytics.status")}</th>
                    <th className="nums">{t("analytics.tickets")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.statusDistribution.map((entry) => (
                    <tr key={entry.status}>
                      <td>{t(`analytics.status.${entry.status}`)}</td>
                      <td className="nums">{entry.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("analytics.completedByHour")}>
            {hourlyPoints.length > 0 ? (
              <BarChart points={hourlyPoints} label={t("analytics.completedByHour")} showEvery={2} />
            ) : <EmptyState>{t("analytics.noData")}</EmptyState>}
          </Card>
        </div>
      )}

      {loadingAnalytics && <Spinner label={t("common.loading")} />}
      {error && <Alert kind="error">{error}</Alert>}
      {!loadingAnalytics && organizations.length === 0 && !error && <EmptyState>{t("analytics.noOrganizations")}</EmptyState>}
    </main>
  );
}

export default function ManagerAnalyticsPage() {
  return (
    <RequireAuth roles={["MANAGER"]}>
      <AnalyticsDashboard />
    </RequireAuth>
  );
}
