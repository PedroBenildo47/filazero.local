"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Badge, Card, EmptyState, Spinner, StatCard } from "@/components/ui";
import {
  formatMoney,
  organizationStatusKey,
  planNameKey,
  statusTone,
  subscriptionStatusKey,
} from "@/lib/ui";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface PlatformFinance {
  currency: string;
  period: { months: number; from: string; to: string };
  totals: {
    revenueCents: number;
    paidTransactions: number;
    mrrCents: number;
    activeSubscriptions: number;
    pendingCents: number;
    pendingTransactions: number;
  };
  revenueByPlan: {
    planId: string;
    code: string;
    name: string;
    currency: string;
    revenueCents: number;
    transactions: number;
  }[];
  subscriptionsByStatus: { status: string; count: number }[];
  organizations: { total: number; active: number; suspended: number; inactive: number };
  users: { total: number; active: number };
  monthlyRevenue: { month: string; revenueCents: number; transactions: number }[];
}

interface AdminOrganization {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  country: string | null;
  status: string;
  createdAt: string;
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: string;
    plan: {
      id: string;
      code: string;
      name: string;
      priceCents: number;
      currency: string;
      interval: string;
    };
  } | null;
  counts: { branches: number; queues: number; members: number; documents: number };
}

interface OrganizationListResponse {
  items: AdminOrganization[];
  total: number;
  page: number;
  pageSize: number;
}

interface PlanOption {
  id: string;
  code: string;
  name: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

interface AuditListResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

type Tab = "finance" | "organizations" | "audit";

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

function AdminDashboard() {
  const { t, tError, formatDateTime } = useI18n();

  const [tab, setTab] = useState<Tab>("finance");
  const [finance, setFinance] = useState<PlatformFinance | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationListResponse | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [audit, setAudit] = useState<AuditListResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Organization filters.
  const [orgQuery, setOrgQuery] = useState({ q: "", status: "", planCode: "" });
  const [auditQuery, setAuditQuery] = useState({ action: "", entityType: "" });

  // Delete confirmation modal.
  const [deleting, setDeleting] = useState<AdminOrganization | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const loadFinance = useCallback(async () => {
    setFinance(await api<PlatformFinance>("/api/admin/finance?months=12"));
  }, []);

  const loadOrganizations = useCallback(
    async (filters: { q: string; status: string; planCode: string }) => {
      const params = new URLSearchParams({ pageSize: "100" });
      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.status) params.set("status", filters.status);
      if (filters.planCode) params.set("planCode", filters.planCode);
      setOrganizations(
        await api<OrganizationListResponse>(`/api/admin/organizations?${params.toString()}`),
      );
    },
    [],
  );

  const loadAudit = useCallback(
    async (filters: { action: string; entityType: string }) => {
      const params = new URLSearchParams({ pageSize: "100" });
      if (filters.action.trim()) params.set("action", filters.action.trim());
      if (filters.entityType.trim()) params.set("entityType", filters.entityType.trim());
      setAudit(await api<AuditListResponse>(`/api/admin/audit-logs?${params.toString()}`));
    },
    [],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [financeData, orgData, planData] = await Promise.all([
          api<PlatformFinance>("/api/admin/finance?months=12"),
          api<OrganizationListResponse>("/api/admin/organizations?pageSize=100"),
          api<{ items: PlanOption[] }>("/api/plans"),
        ]);
        if (!active) return;
        setFinance(financeData);
        setOrganizations(orgData);
        setPlans(planData.items);
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

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.details &&
        typeof caught.details === "object" &&
        (caught.details as { reason?: string }).reason === "HAS_PAID_TRANSACTIONS"
      ) {
        setError(t("admin.deleteBlocked"));
      } else {
        setError(tError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  function planLabel(plan: { code: string; name: string } | null): string {
    if (!plan) return t("admin.noPlan");
    const key = planNameKey(plan.code);
    return key ? t(key) : plan.name;
  }

  async function changeStatus(organization: AdminOrganization, status: "ACTIVE" | "SUSPENDED") {
    await run(async () => {
      await api(`/api/admin/organizations/${organization.id}/status`, {
        method: "PATCH",
        json: { status },
      });
      await Promise.all([
        loadOrganizations(orgQuery),
        loadFinance(),
      ]);
    }, t("admin.statusChanged"));
  }

  async function confirmDelete() {
    if (!deleting) return;
    if (deleteName.trim().toLowerCase() !== deleting.name.trim().toLowerCase()) {
      setError(t("admin.deleteMismatch"));
      return;
    }
    await run(async () => {
      await api(`/api/admin/organizations/${deleting.id}`, {
        method: "DELETE",
        json: { confirmName: deleteName.trim() },
      });
      setDeleting(null);
      setDeleteName("");
      await Promise.all([loadOrganizations(orgQuery), loadFinance()]);
    }, t("admin.deleteSuccess"));
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
          <h1>{t("admin.title")}</h1>
          <p className="muted">{t("admin.subtitle")}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await Promise.all([
                loadFinance(),
                loadOrganizations(orgQuery),
                loadAudit(auditQuery),
              ]);
            })
          }
        >
          {t("admin.refresh")}
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="tabs" role="tablist">
        {(["finance", "organizations", "audit"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tab${tab === value ? " is-active" : ""}`}
            onClick={() => setTab(value)}
          >
            {t(`admin.tab.${value}` as const)}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Finance                                                           */}
      {/* ---------------------------------------------------------------- */}
      {tab === "finance" && (
        <section className="stack">
          <p className="muted">{t("admin.finance.subtitle")}</p>
          {!finance ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <>
              <div className="kpi-grid">
                <StatCard
                  label={t("admin.revenueTotal")}
                  value={formatMoney(finance.totals.revenueCents, finance.currency)}
                  hint={t("admin.paidTransactions") + `: ${finance.totals.paidTransactions}`}
                  tone="ok"
                />
                <StatCard
                  label={t("admin.mrr")}
                  value={formatMoney(finance.totals.mrrCents, finance.currency)}
                  hint={t("admin.activeSubscriptions") + `: ${finance.totals.activeSubscriptions}`}
                  tone="info"
                />
                <StatCard
                  label={t("admin.pendingAmount")}
                  value={formatMoney(finance.totals.pendingCents, finance.currency)}
                  hint={t("admin.pendingTransactions") + `: ${finance.totals.pendingTransactions}`}
                  tone="warn"
                />
                <StatCard
                  label={t("admin.organizations")}
                  value={finance.organizations.total}
                  hint={`${t("admin.orgStatus.ACTIVE")}: ${finance.organizations.active} · ${t(
                    "admin.orgStatus.SUSPENDED",
                  )}: ${finance.organizations.suspended} · ${t("admin.orgStatus.INACTIVE")}: ${
                    finance.organizations.inactive
                  }`}
                  tone="info"
                />
                <StatCard
                  label={t("admin.usersTotal")}
                  value={finance.users.total}
                  hint={`${t("admin.usersActive")}: ${finance.users.active}`}
                  tone="info"
                />
              </div>

              <Card title={t("admin.revenueByPlan")}>
                {finance.revenueByPlan.length === 0 ? (
                  <EmptyState>{t("admin.noData")}</EmptyState>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("admin.table.plan")}</th>
                        <th>{t("admin.revenue")}</th>
                        <th>{t("admin.transactionsCount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance.revenueByPlan.map((row) => (
                        <tr key={row.planId}>
                          <td>
                            <strong>{planLabel(row)}</strong>{" "}
                            <span className="muted mono">{row.code}</span>
                          </td>
                          <td>{formatMoney(row.revenueCents, row.currency)}</td>
                          <td className="muted">{row.transactions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <div className="row" style={{ alignItems: "flex-start", gap: "1rem" }}>
                <Card title={t("admin.monthlyRevenue")}>
                  {finance.monthlyRevenue.length === 0 ? (
                    <EmptyState>{t("admin.noData")}</EmptyState>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t("admin.month")}</th>
                          <th>{t("admin.revenue")}</th>
                          <th>{t("admin.transactionsCount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finance.monthlyRevenue.map((row) => (
                          <tr key={row.month}>
                            <td className="mono">{row.month}</td>
                            <td>{formatMoney(row.revenueCents, finance.currency)}</td>
                            <td className="muted">{row.transactions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>

                <Card title={t("admin.subscriptionsByStatus")}>
                  {finance.subscriptionsByStatus.length === 0 ? (
                    <EmptyState>{t("admin.noData")}</EmptyState>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t("billing.status")}</th>
                          <th>{t("admin.organizations")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finance.subscriptionsByStatus.map((row) => (
                          <tr key={row.status}>
                            <td>
                              <Badge tone={statusTone(row.status)}>
                                {t(subscriptionStatusKey(row.status))}
                              </Badge>
                            </td>
                            <td>{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Organizations                                                     */}
      {/* ---------------------------------------------------------------- */}
      {tab === "organizations" && (
        <section className="stack">
          <p className="muted">{t("admin.organizations.subtitle")}</p>

          <form
            className="row form-inline"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => loadOrganizations(orgQuery));
            }}
          >
            <input
              className="input"
              placeholder={t("admin.searchOrganizations")}
              value={orgQuery.q}
              onChange={(event) => setOrgQuery({ ...orgQuery, q: event.target.value })}
            />
            <select
              className="input"
              value={orgQuery.status}
              onChange={(event) => setOrgQuery({ ...orgQuery, status: event.target.value })}
            >
              <option value="">{t("admin.allStatuses")}</option>
              <option value="ACTIVE">{t("admin.orgStatus.ACTIVE")}</option>
              <option value="SUSPENDED">{t("admin.orgStatus.SUSPENDED")}</option>
              <option value="INACTIVE">{t("admin.orgStatus.INACTIVE")}</option>
            </select>
            <select
              className="input"
              value={orgQuery.planCode}
              onChange={(event) => setOrgQuery({ ...orgQuery, planCode: event.target.value })}
            >
              <option value="">{t("admin.allPlans")}</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.code}>
                  {planLabel(plan)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t("common.search")}
            </button>
          </form>

          {!organizations || organizations.items.length === 0 ? (
            <EmptyState>{t("admin.noOrganizationsFound")}</EmptyState>
          ) : (
            <>
              <p className="muted">
                {t("search.results", { count: organizations.total })}
              </p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("admin.table.organization")}</th>
                      <th>{t("admin.table.sector")}</th>
                      <th>{t("admin.table.city")}</th>
                      <th>{t("admin.table.plan")}</th>
                      <th>{t("admin.table.branches")}</th>
                      <th>{t("admin.table.users")}</th>
                      <th>{t("admin.table.queues")}</th>
                      <th>{t("admin.table.status")}</th>
                      <th>{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.items.map((organization) => (
                      <tr key={organization.id}>
                        <td>
                          <strong>{organization.name}</strong>
                        </td>
                        <td className="muted">{organization.category ?? "—"}</td>
                        <td className="muted">{organization.city ?? "—"}</td>
                        <td>
                          {organization.subscription ? (
                            <>
                              {planLabel(organization.subscription.plan)}{" "}
                              <span className="muted mono">
                                {organization.subscription.plan.code}
                              </span>
                            </>
                          ) : (
                            <span className="muted">{t("admin.noPlan")}</span>
                          )}
                        </td>
                        <td>{organization.counts.branches}</td>
                        <td>{organization.counts.members}</td>
                        <td>{organization.counts.queues}</td>
                        <td>
                          <Badge tone={statusTone(organization.status)}>
                            {t(organizationStatusKey(organization.status))}
                          </Badge>
                        </td>
                        <td>
                          <div className="row">
                            {organization.status === "SUSPENDED" ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={busy}
                                onClick={() => void changeStatus(organization, "ACTIVE")}
                              >
                                {t("admin.reactivate")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={busy}
                                onClick={() => void changeStatus(organization, "SUSPENDED")}
                              >
                                {t("admin.suspend")}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setNotice(null);
                                setDeleteName("");
                                setDeleting(organization);
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
            </>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Audit                                                             */}
      {/* ---------------------------------------------------------------- */}
      {tab === "audit" && (
        <section className="stack">
          <p className="muted">{t("admin.audit.subtitle")}</p>

          <form
            className="row form-inline"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => loadAudit(auditQuery));
            }}
          >
            <input
              className="input"
              placeholder={t("admin.audit.filterAction")}
              value={auditQuery.action}
              onChange={(event) => setAuditQuery({ ...auditQuery, action: event.target.value })}
            />
            <input
              className="input"
              placeholder={t("admin.audit.filterEntity")}
              value={auditQuery.entityType}
              onChange={(event) =>
                setAuditQuery({ ...auditQuery, entityType: event.target.value })
              }
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t("common.search")}
            </button>
          </form>

          {!audit || audit.items.length === 0 ? (
            <EmptyState>{t("admin.audit.empty")}</EmptyState>
          ) : (
            <>
              <p className="muted">{t("search.results", { count: audit.total })}</p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("admin.audit.when")}</th>
                      <th>{t("admin.audit.action")}</th>
                      <th>{t("admin.audit.actor")}</th>
                      <th>{t("admin.audit.entity")}</th>
                      <th>{t("admin.audit.description")}</th>
                      <th>{t("admin.audit.ip")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.items.map((entry) => (
                      <tr key={entry.id}>
                        <td className="muted">{formatDateTime(entry.createdAt)}</td>
                        <td className="mono">{entry.action}</td>
                        <td>
                          {entry.actor ? (
                            <>
                              <strong>{entry.actor.name}</strong>
                              <div className="muted">{entry.actor.email}</div>
                            </>
                          ) : (
                            <span className="muted">{t("admin.audit.system")}</span>
                          )}
                        </td>
                        <td className="muted">
                          {entry.entityType ?? "—"}
                          {entry.entityId ? (
                            <div className="mono subtle">{entry.entityId.slice(0, 8)}…</div>
                          ) : null}
                        </td>
                        <td className="muted">{entry.description ?? "—"}</td>
                        <td className="mono subtle">{entry.ipAddress ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Delete modal                                                      */}
      {/* ---------------------------------------------------------------- */}
      {deleting && (
        <div className="qr-overlay" onClick={() => setDeleting(null)}>
          <section
            className="qr-print-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="admin-delete-title">{t("admin.deleteTitle")}</h2>
            <p>{deleting.name}</p>
            <Alert kind="error">{t("admin.deleteBody")}</Alert>
            <label className="field">
              <span>{t("admin.deleteHint", { name: deleting.name })}</span>
              <input
                className="input"
                value={deleteName}
                onChange={(event) => setDeleteName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="row qr-actions">
              <button
                type="button"
                className="btn btn-danger"
                disabled={
                  busy ||
                  deleteName.trim().toLowerCase() !== deleting.name.trim().toLowerCase()
                }
                onClick={() => void confirmDelete()}
              >
                {t("admin.deleteConfirm")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDeleting(null);
                  setDeleteName("");
                }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </section>
        </div>
      )}
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
