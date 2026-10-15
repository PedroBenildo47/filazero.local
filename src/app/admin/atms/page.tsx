"use client";
/**
 * Platform admin — ATM registry (Fase 3).
 *
 * Registers the real Multicaixa ATMs (bank, address, coordinates) and lets the
 * operator update their status/cash level. Community reports arrive from the
 * public page; this is the authoritative source of the ATM list.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
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
  cashLevel: number | null;
  active: boolean;
  lastReportedAt: string;
}

const STATUSES: AtmStatus[] = ["OPERATIONAL", "OUT_OF_CASH", "OFFLINE", "UNKNOWN"];
const STATUS_TONE: Record<AtmStatus, "ok" | "warn" | "danger" | "muted"> = {
  OPERATIONAL: "ok",
  OUT_OF_CASH: "warn",
  OFFLINE: "danger",
  UNKNOWN: "muted",
};

const EMPTY_FORM = {
  bank: "",
  label: "",
  address: "",
  city: "",
  province: "",
  latitude: "-8.8383",
  longitude: "13.2344",
  status: "OPERATIONAL" as AtmStatus,
  cashLevel: "",
  notes: "",
};

function AdminAtmsPage() {
  const { t, tError, formatDateTime } = useI18n();
  const [atms, setAtms] = useState<Atm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setAtms((await api<{ items: Atm[] }>("/api/admin/atms?pageSize=100")).items);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api<{ items: Atm[] }>("/api/admin/atms?pageSize=100");
        if (active) setAtms(result.items);
      } catch (caught) {
        if (active) setError(tError(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tError]);

  async function run(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (message) setNotice(message);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createAtm() {
    await run(async () => {
      await api("/api/admin/atms", {
        method: "POST",
        json: {
          bank: form.bank,
          ...(form.label ? { label: form.label } : {}),
          address: form.address,
          city: form.city,
          ...(form.province ? { province: form.province } : {}),
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          status: form.status,
          ...(form.cashLevel !== "" ? { cashLevel: Number(form.cashLevel) } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
        },
      });
      setForm(EMPTY_FORM);
      await load();
    }, t("adminAtms.created"));
  }

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  return (
    <main className="container animate-in">
      <div className="row spread manager-heading">
        <div>
          <h1>{t("adminAtms.title")}</h1>
          <p className="muted">{t("adminAtms.subtitle")}</p>
        </div>
        <Link href="/admin" className="btn btn-ghost">
          {t("common.back")}
        </Link>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title={t("adminAtms.new")}>
        <div className="row form-inline">
          <label className="field">
            <span>{t("adminAtms.bank")}</span>
            <input className="input" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.label")}</span>
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.address")}</span>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.city")}</span>
            <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.province")}</span>
            <input className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.latitude")}</span>
            <input className="input" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.longitude")}</span>
            <input className="input" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          </label>
          <label className="field">
            <span>{t("adminAtms.status")}</span>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AtmStatus })}>
              {STATUSES.map((status) => (
                <option key={status} value={status}>{t(`atms.status.${status}` as const)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("adminAtms.cashLevel")}</span>
            <input className="input" value={form.cashLevel} onChange={(e) => setForm({ ...form, cashLevel: e.target.value })} />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || form.bank.trim().length < 2 || form.address.trim().length < 3 || form.city.trim().length < 2}
            onClick={() => void createAtm()}
          >
            {t("adminAtms.create")}
          </button>
        </div>
      </Card>

      {atms.length === 0 ? (
        <EmptyState>{t("adminAtms.empty")}</EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("adminAtms.bank")}</th>
                <th>{t("adminAtms.address")}</th>
                <th>{t("adminAtms.city")}</th>
                <th>{t("common.status")}</th>
                <th>{t("atms.lastReported", { time: "" })}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {atms.map((atm) => (
                <tr key={atm.id}>
                  <td>
                    <strong>{atm.bank}</strong>
                    {atm.label ? <div className="muted">{atm.label}</div> : null}
                  </td>
                  <td className="muted">{atm.address}</td>
                  <td className="muted">{atm.city}</td>
                  <td>
                    <Badge tone={atm.active ? STATUS_TONE[atm.status] : "muted"}>
                      {atm.active
                        ? t(`atms.status.${atm.status}` as const)
                        : t("adminAtms.inactive")}
                    </Badge>
                  </td>
                  <td className="muted subtle">{formatDateTime(atm.lastReportedAt)}</td>
                  <td>
                    <div className="row">
                      <select
                        className="input input-sm"
                        value={atm.status}
                        disabled={busy}
                        onChange={(event) =>
                          void run(async () => {
                            await api(`/api/admin/atms/${atm.id}`, {
                              method: "PATCH",
                              json: { status: event.target.value },
                            });
                            await load();
                          }, t("adminAtms.updated"))
                        }
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>{t(`atms.status.${status}` as const)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/api/admin/atms/${atm.id}`, {
                              method: "PATCH",
                              json: { active: !atm.active },
                            });
                            await load();
                          }, t("adminAtms.updated"))
                        }
                      >
                        {atm.active ? t("adminAtms.deactivate") : t("adminAtms.activate")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(t("adminAtms.confirmDelete"))) return;
                          void run(async () => {
                            await api(`/api/admin/atms/${atm.id}`, { method: "DELETE" });
                            await load();
                          }, t("adminAtms.deleted"));
                        }}
                      >
                        {t("admin.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function AdminAtmsRoute() {
  return (
    <RequireAuth roles={["ADMINISTRATOR"]}>
      <AdminAtmsPage />
    </RequireAuth>
  );
}
