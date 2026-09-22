"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Badge, Card, EmptyState, Spinner, StatCard } from "@/components/ui";
import { organizationStatusKey, statusTone } from "@/lib/ui";

interface Organization {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  status: string;
  counts?: { branches: number; queues: number; members: number };
}

const STATUSES = ["ACTIVE", "SUSPENDED", "INACTIVE"] as const;

interface Plan {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
}

function AdminDashboard() {
  const { t, tError } = useI18n();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: "", city: "" });
  const [plans, setPlans] = useState<Plan[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await api<{ items: Organization[] }>("/api/organizations?pageSize=100");
      setOrganizations(result.items);
      setError(null);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setLoading(false);
    }
  }, [tError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api<{ items: Plan[] }>("/api/plans");
        if (active) setPlans(result.items);
      } catch {
        // The catalogue is optional for the rest of the screen.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(t("manager.saved"));
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  const activeCount = organizations.filter((org) => org.status === "ACTIVE").length;
  const suspendedCount = organizations.filter((org) => org.status === "SUSPENDED").length;

  return (
    <main className="container animate-in">
      <h1>{t("admin.title")}</h1>
      <p className="muted">{t("admin.subtitle")}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="kpi-grid">
        <StatCard
          label={t("admin.organizations")}
          value={organizations.length}
          tone="info"
        />
        <StatCard
          label={t("admin.orgStatus.ACTIVE")}
          value={activeCount}
          tone="ok"
        />
        <StatCard
          label={t("admin.orgStatus.SUSPENDED")}
          value={suspendedCount}
          tone={suspendedCount > 0 ? "warn" : "info"}
        />
      </div>

      <Card title={t("admin.newOrganization")}>
        <div className="row form-inline">
          <label className="field">
            <span>{t("admin.orgName")}</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("admin.orgCategory")}</span>
            <input
              className="input"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("admin.orgCity")}</span>
            <input
              className="input"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || form.name.trim().length < 2}
            onClick={() =>
              void run(async () => {
                await api("/api/organizations", {
                  method: "POST",
                  json: {
                    name: form.name,
                    ...(form.category ? { category: form.category } : {}),
                    ...(form.city ? { city: form.city } : {}),
                  },
                });
                setForm({ name: "", category: "", city: "" });
                await load();
              })
            }
          >
            {t("admin.createOrganization")}
          </button>
        </div>
      </Card>

      <Card title={`${t("admin.organizations")} (${organizations.length})`}>
        {organizations.length === 0 ? (
          <EmptyState>{t("admin.noOrganizations")}</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("admin.orgName")}</th>
                <th>{t("admin.orgCategory")}</th>
                <th>{t("admin.orgCity")}</th>
                <th>{t("admin.status")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id}>
                  <td>{organization.name}</td>
                  <td className="muted">{organization.category ?? "—"}</td>
                  <td className="muted">{organization.city ?? "—"}</td>
                  <td>
                    <Badge tone={statusTone(organization.status)}>
                      {t(organizationStatusKey(organization.status))}
                    </Badge>
                  </td>
                  <td>
                    <div className="row">
                      <select
                        className="input input-sm"
                        value={organization.status}
                        disabled={busy}
                        aria-label={t("admin.changeStatus")}
                        onChange={(event) =>
                          void run(async () => {
                            await api(`/api/organizations/${organization.id}/status`, {
                              method: "PATCH",
                              json: { status: event.target.value },
                            });
                            await load();
                          })
                        }
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t(organizationStatusKey(status))}
                          </option>
                        ))}
                      </select>
                      {plans.length > 0 && (
                        <select
                          className="input input-sm"
                          defaultValue=""
                          disabled={busy}
                          aria-label={t("admin.assignPlan")}
                          onChange={(event) => {
                            const planId = event.target.value;
                            if (!planId) return;
                            void run(async () => {
                              await api(`/api/organizations/${organization.id}/subscription`, {
                                method: "POST",
                                json: { planId },
                              });
                              await load();
                            });
                          }}
                        >
                          <option value="">{t("admin.assignPlan")}</option>
                          {plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <Link
                        href="/gestor"
                        className="btn btn-ghost btn-sm"
                        title={t("admin.manage")}
                      >
                        {t("admin.manage")}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth roles={["ADMINISTRATOR"]}>
      <AdminDashboard />
    </RequireAuth>
  );
}
