"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ProgressBar,
  Spinner,
  StatCard,
} from "@/components/ui";
import {
  billingIntervalKey,
  formatMoney,
  memberStatusKey,
  queueStatusKey,
  roleKey,
  statusTone,
  subscriptionStatusKey,
  transactionStatusKey,
} from "@/lib/ui";

interface Organization {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  description: string | null;
  status: string;
}
interface Branch {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
}
interface QueueItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  waitingCount: number;
  totalTickets: number;
}
interface Member {
  id: string;
  userId: string;
  branchId: string | null;
  role: string;
  status: string;
  user: { id: string; name: string; email: string };
  branch: { id: string; name: string } | null;
}
interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  maxBranches: number;
  maxQueuesPerBranch: number;
  maxStaff: number;
}
interface Subscription {
  id: string;
  planId: string;
  status: string;
  currentPeriodEnd: string;
  plan: Plan;
}
interface BillingOverview {
  subscription: Subscription | null;
  usage: { branches: number; queues: number; staff: number };
  limits: { maxBranches: number; maxQueuesPerBranch: number; maxStaff: number } | null;
  operational: boolean;
  daysRemaining: number | null;
}
interface Transaction {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  reference: string;
  provider: string;
  paidAt: string | null;
  createdAt: string;
  failureReason: string | null;
}
interface CheckoutResult {
  reference: string;
  checkoutUrl: string | null;
  instructions: string | null;
}

function ManagerDashboard() {
  const { t, tError } = useI18n();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);

  const [orgForm, setOrgForm] = useState({ name: "", category: "", city: "" });
  const [branchForm, setBranchForm] = useState({ name: "", address: "", city: "" });
  const [queueForm, setQueueForm] = useState({ name: "", description: "" });
  const [memberForm, setMemberForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "STAFF",
    branchId: "",
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api<{ items: Organization[] }>("/api/organizations?pageSize=50");
        if (!active) return;
        setOrganizations(result.items);
        if (result.items[0]) setOrganizationId(result.items[0].id);
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

  const loadOrganization = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        const [branchList, memberList, billingData, planList, transactionList] =
          await Promise.all([
            api<{ items: Branch[] }>(`/api/organizations/${id}/branches?pageSize=50`),
            api<{ items: Member[] }>(`/api/organizations/${id}/members?pageSize=50`),
            api<BillingOverview>(`/api/organizations/${id}/subscription`),
            api<{ items: Plan[] }>("/api/plans"),
            api<{ items: Transaction[] }>(
              `/api/organizations/${id}/transactions?pageSize=20`,
            ),
          ]);
        setBranches(branchList.items);
        setMembers(memberList.items);
        setBilling(billingData);
        setPlans(planList.items);
        setTransactions(transactionList.items);
        setBranchId((current) =>
          branchList.items.some((branch) => branch.id === current)
            ? current
            : branchList.items[0]?.id ?? "",
        );
      } catch (caught) {
        setError(tError(caught));
      }
    },
    [tError],
  );

  async function pay(planId: string) {
    setBusy(true);
    setError(null);
    setCheckout(null);
    try {
      const result = await api<CheckoutResult>("/api/billing/checkout", {
        method: "POST",
        json: { organizationId, planId },
      });
      setCheckout(result);
      if (result.checkoutUrl) window.open(result.checkoutUrl, "_blank", "noopener");
      await loadOrganization(organizationId);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const organization = organizations.find((item) => item.id === organizationId);
    if (organization) {
      setOrgForm({
        name: organization.name,
        category: organization.category ?? "",
        city: organization.city ?? "",
      });
    }
    void loadOrganization(organizationId);
  }, [organizationId, organizations, loadOrganization]);

  const loadQueues = useCallback(
    async (id: string) => {
      if (!id) {
        setQueues([]);
        return;
      }
      try {
        const result = await api<{ items: QueueItem[] }>(
          `/api/branches/${id}/queues?pageSize=50`,
        );
        setQueues(result.items);
      } catch (caught) {
        setError(tError(caught));
      }
    },
    [tError],
  );

  useEffect(() => {
    void loadQueues(branchId);
  }, [branchId, loadQueues]);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
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

  return (
    <main className="container animate-in">
      <h1>{t("manager.title")}</h1>
      <p className="muted">{t("manager.subtitle")}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {organizations.length === 0 ? (
        <EmptyState>{t("admin.noOrganizations")}</EmptyState>
      ) : (
        <>
          <label className="field">
            <span>{t("manager.organization")}</span>
            <select
              className="input"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>

          <Card title={t("manager.organizationData")}>
            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.name")}</span>
                <input
                  className="input"
                  value={orgForm.name}
                  onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.category")}</span>
                <input
                  className="input"
                  value={orgForm.category}
                  onChange={(event) => setOrgForm({ ...orgForm, category: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.city")}</span>
                <input
                  className="input"
                  value={orgForm.city}
                  onChange={(event) => setOrgForm({ ...orgForm, city: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api(`/api/organizations/${organizationId}`, {
                        method: "PATCH",
                        json: {
                          name: orgForm.name,
                          category: orgForm.category,
                          city: orgForm.city,
                        },
                      }),
                    t("manager.saved"),
                  )
                }
              >
                {t("manager.saveOrganization")}
              </button>
            </div>
          </Card>

          <Card title={t("billing.title")}>
            {!billing ? (
              <Spinner label={t("common.loading")} />
            ) : (
              <>
                {!billing.operational && (
                  <Alert kind="error">
                    {t("billing.expiredWarning")} {t("billing.expiredHint")}
                  </Alert>
                )}

                <div className="kpi-grid">
                  <StatCard
                    label={t("billing.currentPlan")}
                    value={billing.subscription ? billing.subscription.plan.name : "—"}
                    tone="info"
                  />
                  <StatCard
                    label={t("billing.status")}
                    value={
                      <Badge tone={statusTone(billing.subscription?.status ?? "EXPIRED")}>
                        {t(
                          subscriptionStatusKey(billing.subscription?.status ?? "EXPIRED"),
                        )}
                      </Badge>
                    }
                    tone={billing.operational ? "ok" : "danger"}
                  />
                  {billing.subscription ? (
                    <StatCard
                      label={t("billing.daysLeft", { days: billing.daysRemaining ?? 0 })}
                      value={billing.daysRemaining ?? 0}
                      hint={t("billing.renewsAt", {
                        date: new Date(billing.subscription.currentPeriodEnd).toLocaleDateString(),
                      })}
                      tone={(billing.daysRemaining ?? 0) <= 3 ? "warn" : "ok"}
                    />
                  ) : null}
                </div>

                <h3 style={{ marginTop: "1rem" }}>{t("billing.usage")}</h3>
                <div className="stack" style={{ gap: "0.75rem" }}>
                  <ProgressBar
                    label={t("billing.branches")}
                    value={billing.usage.branches}
                    max={billing.limits?.maxBranches ?? 0}
                  />
                  <ProgressBar
                    label={t("billing.queues")}
                    value={billing.usage.queues}
                    max={(billing.limits?.maxQueuesPerBranch ?? 0) * Math.max(1, billing.usage.branches)}
                  />
                  <ProgressBar
                    label={t("billing.staff")}
                    value={billing.usage.staff}
                    max={billing.limits?.maxStaff ?? 0}
                  />
                </div>

                <h3>{t("billing.choosePlan")}</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("billing.plan")}</th>
                      <th>{t("billing.amount")}</th>
                      <th>{t("billing.usage")}</th>
                      <th>{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan) => (
                      <tr
                        key={plan.id}
                        className={
                          plan.id === billing.subscription?.planId ? "is-selected" : ""
                        }
                      >
                        <td>
                          <strong>{plan.name}</strong>
                          <div className="muted">{plan.description}</div>
                        </td>
                        <td>
                          {plan.priceCents === 0
                            ? t("billing.free")
                            : `${formatMoney(plan.priceCents, plan.currency)} / ${t(
                                billingIntervalKey(plan.interval),
                              )}`}
                        </td>
                        <td className="muted">
                          {plan.maxBranches} {t("billing.branches")} ·{" "}
                          {plan.maxQueuesPerBranch} {t("billing.queues")} ·{" "}
                          {plan.maxStaff} {t("billing.staff")}
                        </td>
                        <td>
                          {plan.priceCents > 0 && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() => void pay(plan.id)}
                            >
                              {t("billing.checkout")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {checkout && (
                  <Alert kind="info">
                    <div>
                      <strong>{t("billing.reference")}:</strong> {checkout.reference}
                    </div>
                    {checkout.instructions && (
                      <pre className="instructions">{checkout.instructions}</pre>
                    )}
                    {checkout.checkoutUrl && (
                      <a href={checkout.checkoutUrl} target="_blank" rel="noreferrer">
                        {t("billing.payNow")}
                      </a>
                    )}
                  </Alert>
                )}

                <h3>{t("billing.history")}</h3>
                {transactions.length === 0 ? (
                  <EmptyState>{t("billing.noTransactions")}</EmptyState>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("billing.reference")}</th>
                        <th>{t("billing.amount")}</th>
                        <th>{t("billing.status")}</th>
                        <th>{t("account.joinedDate")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td className="muted">{transaction.reference}</td>
                          <td>
                            {formatMoney(transaction.amountCents, transaction.currency)}
                          </td>
                          <td>
                            <Badge tone={statusTone(transaction.status)}>
                              {t(transactionStatusKey(transaction.status))}
                            </Badge>
                          </td>
                          <td className="muted">
                            {new Date(transaction.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </Card>

          <Card title={t("manager.branches")}>
            {branches.length === 0 ? (
              <EmptyState>{t("manager.noBranches")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.name")}</th>
                    <th>{t("manager.city")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((branch) => (
                    <tr key={branch.id} className={branch.id === branchId ? "is-selected" : ""}>
                      <td>{branch.name}</td>
                      <td className="muted">{branch.city ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setBranchId(branch.id)}
                        >
                          {t("manager.queues")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.branchName")}</span>
                <input
                  className="input"
                  value={branchForm.name}
                  onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.branchAddress")}</span>
                <input
                  className="input"
                  value={branchForm.address}
                  onChange={(event) =>
                    setBranchForm({ ...branchForm, address: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>{t("manager.branchCity")}</span>
                <input
                  className="input"
                  value={branchForm.city}
                  onChange={(event) => setBranchForm({ ...branchForm, city: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || branchForm.name.trim().length < 2}
                onClick={() =>
                  void run(async () => {
                    await api(`/api/organizations/${organizationId}/branches`, {
                      method: "POST",
                      json: {
                        name: branchForm.name,
                        ...(branchForm.address ? { address: branchForm.address } : {}),
                        ...(branchForm.city ? { city: branchForm.city } : {}),
                      },
                    });
                    setBranchForm({ name: "", address: "", city: "" });
                    await loadOrganization(organizationId);
                  })
                }
              >
                {t("manager.createBranch")}
              </button>
            </div>
          </Card>

          <Card
            title={`${t("manager.queues")}${branchId ? ` · ${branches.find((b) => b.id === branchId)?.name ?? ""}` : ""}`}
          >
            {!branchId ? (
              <EmptyState>{t("manager.selectBranchFirst")}</EmptyState>
            ) : queues.length === 0 ? (
              <EmptyState>{t("manager.noQueues")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.name")}</th>
                    <th>{t("staff.countWaiting")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map((queue) => (
                    <tr key={queue.id}>
                      <td>{queue.name}</td>
                      <td>{queue.waitingCount}</td>
                      <td>
                        <Badge tone={statusTone(queue.status)}>
                          {t(queueStatusKey(queue.status))}
                        </Badge>
                      </td>
                      <td>
                        <div className="row">
                          {(["OPEN", "PAUSED", "CLOSED"] as const)
                            .filter((status) => status !== queue.status)
                            .map((status) => (
                              <button
                                key={status}
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api(`/api/queues/${queue.id}/status`, {
                                      method: "PATCH",
                                      json: { status },
                                    });
                                    await loadQueues(branchId);
                                  })
                                }
                              >
                                {status === "OPEN"
                                  ? t("manager.open")
                                  : status === "PAUSED"
                                    ? t("manager.pause")
                                    : t("manager.close")}
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {branchId && (
              <div className="row form-inline">
                <label className="field">
                  <span>{t("manager.queueName")}</span>
                  <input
                    className="input"
                    value={queueForm.name}
                    onChange={(event) => setQueueForm({ ...queueForm, name: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t("manager.queueDescription")}</span>
                  <input
                    className="input"
                    value={queueForm.description}
                    onChange={(event) =>
                      setQueueForm({ ...queueForm, description: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || queueForm.name.trim().length < 2}
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/branches/${branchId}/queues`, {
                        method: "POST",
                        json: {
                          name: queueForm.name,
                          ...(queueForm.description
                            ? { description: queueForm.description }
                            : {}),
                          status: "OPEN",
                        },
                      });
                      setQueueForm({ name: "", description: "" });
                      await loadQueues(branchId);
                    })
                  }
                >
                  {t("manager.createQueue")}
                </button>
              </div>
            )}
          </Card>

          <Card title={t("manager.members")}>
            {members.length === 0 ? (
              <EmptyState>{t("manager.noMembers")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.memberName")}</th>
                    <th>{t("manager.memberEmail")}</th>
                    <th>{t("manager.memberRole")}</th>
                    <th>{t("manager.memberBranch")}</th>
                    <th>{t("manager.memberStatus")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>{member.user.name}</td>
                      <td className="muted">{member.user.email}</td>
                      <td>{t(roleKey(member.role))}</td>
                      <td className="muted">
                        {member.branch ? member.branch.name : t("manager.allBranches")}
                      </td>
                      <td>
                        <Badge tone={statusTone(member.status)}>
                          {t(memberStatusKey(member.status))}
                        </Badge>
                      </td>
                      <td>
                        <div className="row">
                          <select
                            className="input input-sm"
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              void run(async () => {
                                await api(
                                  `/api/organizations/${organizationId}/members/${member.id}`,
                                  { method: "PATCH", json: { role: event.target.value } },
                                );
                                await loadOrganization(organizationId);
                              })
                            }
                          >
                            <option value="STAFF">{t("role.STAFF")}</option>
                            <option value="MANAGER">{t("role.MANAGER")}</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(t("manager.confirmRemove"))) return;
                              void run(async () => {
                                await api(
                                  `/api/organizations/${organizationId}/members/${member.id}`,
                                  { method: "DELETE" },
                                );
                                await loadOrganization(organizationId);
                              });
                            }}
                          >
                            {t("manager.remove")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.memberName")}</span>
                <input
                  className="input"
                  value={memberForm.name}
                  onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.memberEmail")}</span>
                <input
                  className="input"
                  type="email"
                  value={memberForm.email}
                  onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.memberPassword")}</span>
                <input
                  className="input"
                  type="password"
                  value={memberForm.password}
                  onChange={(event) =>
                    setMemberForm({ ...memberForm, password: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>{t("manager.memberRole")}</span>
                <select
                  className="input"
                  value={memberForm.role}
                  onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}
                >
                  <option value="STAFF">{t("role.STAFF")}</option>
                  <option value="MANAGER">{t("role.MANAGER")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("manager.memberBranch")}</span>
                <select
                  className="input"
                  value={memberForm.branchId}
                  onChange={(event) =>
                    setMemberForm({ ...memberForm, branchId: event.target.value })
                  }
                >
                  <option value="">{t("manager.allBranches")}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  memberForm.name.trim().length < 2 ||
                  !memberForm.email.includes("@") ||
                  memberForm.password.length < 8
                }
                onClick={() =>
                  void run(async () => {
                    await api(`/api/organizations/${organizationId}/members`, {
                      method: "POST",
                      json: {
                        name: memberForm.name,
                        email: memberForm.email,
                        password: memberForm.password,
                        role: memberForm.role,
                        branchId: memberForm.branchId || null,
                      },
                    });
                    setMemberForm({
                      name: "",
                      email: "",
                      password: "",
                      role: "STAFF",
                      branchId: "",
                    });
                    await loadOrganization(organizationId);
                  })
                }
              >
                {t("manager.addMemberSubmit")}
              </button>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}

export default function ManagerPage() {
  return (
    <RequireAuth roles={["MANAGER", "ADMINISTRATOR"]}>
      <ManagerDashboard />
    </RequireAuth>
  );
}
