"use client";
/**
 * Public Multicaixa ATM directory (Fase 3 — ATMs).
 *
 * Citizens see which ATM near them has cash, filter by city/bank/status, and
 * report the real status when they get there (community report). The status is
 * real: it is whatever the most recent report said, and it goes back to
 * "unknown" when the last report is stale.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { Alert, Badge, Card, EmptyState, Spinner } from "@/components/ui";

type AtmStatus = "OPERATIONAL" | "OUT_OF_CASH" | "OFFLINE" | "UNKNOWN";

interface Atm {
  id: string;
  bank: string;
  label: string | null;
  address: string;
  city: string;
  province: string | null;
  latitude: number;
  longitude: number;
  status: AtmStatus;
  reportedStatus: AtmStatus;
  cashLevel: number | null;
  notes: string | null;
  fresh: boolean;
  lastReportedAt: string;
}

interface AtmList {
  items: Atm[];
  total: number;
  cities: string[];
  banks: string[];
}

const STATUSES: AtmStatus[] = ["OPERATIONAL", "OUT_OF_CASH", "OFFLINE", "UNKNOWN"];

const STATUS_TONE: Record<AtmStatus, "ok" | "warn" | "danger" | "muted"> = {
  OPERATIONAL: "ok",
  OUT_OF_CASH: "warn",
  OFFLINE: "danger",
  UNKNOWN: "muted",
};

const STATUS_COLOR: Record<AtmStatus, string> = {
  OPERATIONAL: "#22c55e",
  OUT_OF_CASH: "#f59e0b",
  OFFLINE: "#ef4444",
  UNKNOWN: "#94a3b8",
};

/* Angola bounds for the schematic map (lat/lng → viewBox). */
const BOUNDS = { minLat: -18.5, maxLat: -4, minLng: 11, maxLng: 24.5 };
const MAP_W = 800;
const MAP_H = 420;

function project(lat: number, lng: number) {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * MAP_W;
  const y = MAP_H - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * MAP_H;
  return { x: Math.max(8, Math.min(MAP_W - 8, x)), y: Math.max(8, Math.min(MAP_H - 8, y)) };
}

function relativeTime(iso: string, locale: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

export default function AtmsPage() {
  const { t, tError, lang } = useI18n();
  const [data, setData] = useState<AtmList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filters, setFilters] = useState({ q: "", city: "", bank: "", status: "" });
  const [reporting, setReporting] = useState<Atm | null>(null);
  const [reportForm, setReportForm] = useState<{ status: AtmStatus; note: string; reporterName: string }>({
    status: "OPERATIONAL",
    note: "",
    reporterName: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (current: typeof filters) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ pageSize: "100" });
        if (current.q.trim()) params.set("q", current.q.trim());
        if (current.city) params.set("city", current.city);
        if (current.bank) params.set("bank", current.bank);
        if (current.status) params.set("status", current.status);
        setData(await api<AtmList>(`/api/public/atms?${params.toString()}`));
      } catch (caught) {
        setError(tError(caught));
      } finally {
        setLoading(false);
      }
    },
    [tError],
  );

  useEffect(() => {
    void load({ q: "", city: "", bank: "", status: "" });
  }, [load]);

  const withCash = useMemo(
    () => data?.items.filter((atm) => atm.status === "OPERATIONAL").length ?? 0,
    [data],
  );

  async function submitReport() {
    if (!reporting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/public/atms/${reporting.id}/reports`, {
        method: "POST",
        json: {
          status: reportForm.status,
          ...(reportForm.note.trim() ? { note: reportForm.note.trim() } : {}),
          ...(reportForm.reporterName.trim()
            ? { reporterName: reportForm.reporterName.trim() }
            : {}),
        },
      });
      setNotice(t("atms.reportSent"));
      setReporting(null);
      setReportForm({ status: "OPERATIONAL", note: "", reporterName: "" });
      await load(filters);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container animate-in">
      <div className="section-head">
        <div>
          <h1>{t("atms.title")}</h1>
          <p className="section-sub">{t("atms.subtitle")}</p>
        </div>
        <Badge tone="ok">{t("atms.withCash", { count: withCash })}</Badge>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title={t("atms.filters")}>
        <form
          className="row form-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void load(filters);
          }}
        >
          <input
            className="input"
            placeholder={t("atms.searchPlaceholder")}
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
          <select
            className="input"
            value={filters.city}
            onChange={(event) => setFilters({ ...filters, city: event.target.value })}
          >
            <option value="">{t("atms.allCities")}</option>
            {(data?.cities ?? []).map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
          <select
            className="input"
            value={filters.bank}
            onChange={(event) => setFilters({ ...filters, bank: event.target.value })}
          >
            <option value="">{t("atms.allBanks")}</option>
            {(data?.banks ?? []).map((bank) => (
              <option key={bank} value={bank}>{bank}</option>
            ))}
          </select>
          <select
            className="input"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">{t("atms.allStatuses")}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>{t(`atms.status.${status}` as const)}</option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary">{t("common.search")}</button>
        </form>
      </Card>

      {loading ? (
        <Spinner label={t("common.loading")} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState>{t("atms.empty")}</EmptyState>
      ) : (
        <>
          <Card title={t("atms.mapTitle")}>
            <svg
              className="atm-map"
              viewBox={`0 0 ${MAP_W} ${MAP_H}`}
              role="img"
              aria-label={t("atms.mapTitle")}
            >
              <rect x="0" y="0" width={MAP_W} height={MAP_H} rx="16" fill="#0b1220" />
              {data.items.map((atm) => {
                const { x, y } = project(atm.latitude, atm.longitude);
                return (
                  <g key={atm.id}>
                    <circle cx={x} cy={y} r="12" fill={STATUS_COLOR[atm.status]} opacity="0.25" />
                    <circle cx={x} cy={y} r="5" fill={STATUS_COLOR[atm.status]} />
                    <title>{`${atm.bank} · ${atm.city}`}</title>
                  </g>
                );
              })}
            </svg>
            <div className="atm-legend">
              {STATUSES.map((status) => (
                <span key={status} className="atm-legend-item">
                  <span className="atm-legend-dot" style={{ background: STATUS_COLOR[status] }} />
                  {t(`atms.status.${status}` as const)}
                </span>
              ))}
            </div>
          </Card>

          <p className="muted">{t("atms.results", { count: data.total })}</p>
          <div className="atm-grid">
            {data.items.map((atm) => (
              <article key={atm.id} className="card atm-card">
                <header className="row spread">
                  <div>
                    <strong>{atm.bank}</strong>
                    <div className="muted">{atm.label ?? atm.city}</div>
                  </div>
                  <Badge tone={STATUS_TONE[atm.status]}>
                    {t(`atms.status.${atm.status}` as const)}
                  </Badge>
                </header>
                <p className="muted">{atm.address}</p>
                <p className="subtle">
                  {t("atms.lastReported", { time: relativeTime(atm.lastReportedAt, lang) })}
                </p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setNotice(null);
                    setReporting(atm);
                    setReportForm({
                      status: atm.reportedStatus === "UNKNOWN" ? "OPERATIONAL" : atm.reportedStatus,
                      note: "",
                      reporterName: "",
                    });
                  }}
                >
                  {t("atms.report")}
                </button>
              </article>
            ))}
          </div>
        </>
      )}

      {reporting && (
        <div className="qr-overlay" onClick={() => setReporting(null)}>
          <section
            className="qr-print-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="atm-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="atm-report-title">{t("atms.reportTitle")}</h2>
            <p className="muted">{reporting.bank} · {reporting.city}</p>
            <label className="field">
              <span>{t("atms.reportStatus")}</span>
              <select
                className="input"
                value={reportForm.status}
                onChange={(event) =>
                  setReportForm({ ...reportForm, status: event.target.value as AtmStatus })
                }
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{t(`atms.status.${status}` as const)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("atms.reportNote")}</span>
              <input
                className="input"
                maxLength={300}
                value={reportForm.note}
                onChange={(event) => setReportForm({ ...reportForm, note: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("atms.reportName")}</span>
              <input
                className="input"
                maxLength={120}
                placeholder={t("atms.reportNamePlaceholder")}
                value={reportForm.reporterName}
                onChange={(event) =>
                  setReportForm({ ...reportForm, reporterName: event.target.value })
                }
              />
            </label>
            <div className="row qr-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submitReport()}>
                {busy ? t("common.loading") : t("atms.reportSubmit")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setReporting(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
