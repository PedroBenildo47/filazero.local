"use client";
/**
 * Dedicated B2B subscription & billing page.
 *
 * Plans and payment were removed from the operational dashboards: this is the
 * single place where a manager sees the current subscription, the plan quotas,
 * the invoice/transaction history and chooses a new plan. Plan selection hands
 * off to the real checkout (`/checkout?plan=<code>`); the subscription is only
 * activated by the signature-verified webhook, never here.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  formatMoney,
  paymentMethodKey,
  statusTone,
  subscriptionStatusKey,
  transactionStatusKey,
} from "@/lib/ui";

interface Organization {
  id: string;
  name: string;
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
  effectiveStatus: string | null;
  daysRemaining: number | null;
}

interface Transaction {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  reference: string;
  provider: string;
  method: string;
  invoiceNumber: string | null;
  paidAt: string | null;
  proofSubmittedAt: string | null;
  createdAt: string;
  failureReason: string | null;
}

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  reference: string;
  amountCents: number;
  currency: string;
  method: string;
  status: string;
  paidAt: string | null;
  plan: { code: string; name: string };
  periodStart: string | null;
  periodEnd: string | null;
}

function formatKz(cents: number): string {
  const kz = Math.round(cents / 100);
  return `${kz.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
}

function BillingView() {
  const { t, tError } = useI18n();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proofBusyId, setProofBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [orgResult, planResult] = await Promise.all([
          api<{ items: Organization[] }>("/api/organizations?pageSize=50"),
          api<{ items: Plan[] }>("/api/plans"),
        ]);
        if (!active) return;
        setOrganizations(orgResult.items);
        setPlans(planResult.items);
        if (orgResult.items[0]) setOrganizationId(orgResult.items[0].id);
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

  const load = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        const [billingData, transactionList, invoiceList] = await Promise.all([
          api<BillingOverview>(`/api/organizations/${id}/subscription`),
          api<{ items: Transaction[] }>(`/api/organizations/${id}/transactions?pageSize=20`),
          api<{ items: Invoice[] }>(`/api/organizations/${id}/invoices?pageSize=20`),
        ]);
        setBilling(billingData);
        setTransactions(transactionList.items);
        setInvoices(invoiceList.items);
      } catch (caught) {
        setError(tError(caught));
      }
    },
    [tError],
  );

  useEffect(() => {
    void load(organizationId);
  }, [organizationId, load]);

  async function submitProof(transactionId: string, file: File) {
    setProofBusyId(transactionId);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        `/api/organizations/${organizationId}/transactions/${transactionId}/proof`,
        { method: "POST", body, credentials: "include" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? t("errors.NETWORK"));
      setNotice(t("billing.proofSent"));
      await load(organizationId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("errors.NETWORK"));
    } finally {
      setProofBusyId(null);
    }
  }

  function printInvoice(invoice: Invoice) {
    const esc = (value: string) =>
      value.replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
      );
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    win.document.write(`<!doctype html><html lang="pt"><head><meta charset="utf-8" />
      <title>${esc(invoice.invoiceNumber ?? invoice.reference)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:40px;color:#0f172a}h1{font-size:22px}table{border-collapse:collapse;margin-top:24px;width:100%}td{padding:8px 0;border-bottom:1px solid #e2e8f0}td:last-child{text-align:right;font-weight:600}.muted{color:#64748b;font-size:13px}</style>
      </head><body>
      <h1>FilaZero</h1>
      <p class="muted">Fatura ${esc(invoice.invoiceNumber ?? "—")}</p>
      <table>
        <tr><td>Plano</td><td>${esc(invoice.plan.name)}</td></tr>
        <tr><td>Valor</td><td>${esc(formatMoney(invoice.amountCents, invoice.currency))}</td></tr>
        <tr><td>Método</td><td>${esc(t(paymentMethodKey(invoice.method)))}</td></tr>
        <tr><td>Referência</td><td>${esc(invoice.reference)}</td></tr>
        <tr><td>Pago em</td><td>${esc(invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : "—")}</td></tr>
        <tr><td>Válida até</td><td>${esc(invoice.periodEnd ? new Date(invoice.periodEnd).toLocaleDateString() : "—")}</td></tr>
      </table>
      <p class="muted" style="margin-top:32px">FilaZero — gestão de filas presenciais</p>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    win.document.close();
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
          <h1>{t("billing.title")}</h1>
          <p className="muted">{t("billing.pageSubtitle")}</p>
        </div>
        <Link href="/gestor" className="btn btn-ghost">
          {t("billing.backToPanel")}
        </Link>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {notice ? <Alert kind="success">{notice}</Alert> : null}

      {organizations.length > 1 ? (
        <Card title={t("checkout.organization")}>
          <div className="field">
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        </Card>
      ) : null}

      {!billing ? (
        <Spinner label={t("common.loading")} />
      ) : (
        <>
          {!billing.operational ? (
            <Alert kind="error">
              {t("billing.expiredWarning")} {t("billing.expiredHint")}
            </Alert>
          ) : null}

          <div className="kpi-grid">
            <StatCard
              label={t("billing.currentPlan")}
              value={billing.subscription ? billing.subscription.plan.name : "—"}
              tone="info"
            />
            <StatCard
              label={t("billing.status")}
              value={
                <Badge tone={statusTone(billing.effectiveStatus ?? "EXPIRED")}>
                  {t(subscriptionStatusKey(billing.effectiveStatus ?? "EXPIRED"))}
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

          <Card title={t("billing.usage")}>
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
          </Card>

          <Card title={t("billing.choosePlan")}>
            <p className="muted">{t("billing.choosePlanHint")}</p>
            <div className="mkt-plans-grid billing-plans-grid">
              {plans.map((plan) => {
                const current = billing.subscription?.plan.code === plan.code;
                const isFree = plan.priceCents <= 0;
                return (
                  <article
                    key={plan.id}
                    className={`mkt-plan${current ? " is-recommended" : ""}`}
                  >
                    {current ? (
                      <span className="mkt-plan-badge">{t("billing.currentPlan")}</span>
                    ) : null}
                    <h3>{plan.name}</h3>
                    <div className="mkt-plan-price">
                      {isFree ? t("landing.planFreePrice") : formatKz(plan.priceCents)}
                      {!isFree && <span>{t("landing.perMonth")}</span>}
                    </div>
                    {plan.description ? <p className="mkt-plan-desc">{plan.description}</p> : null}
                    <p className="mkt-plan-limits">
                      {t("landing.planLimits", {
                        branches: plan.maxBranches,
                        queues: plan.maxQueuesPerBranch,
                        staff: plan.maxStaff,
                      })}
                    </p>
                    {current || isFree ? (
                      <span className="btn btn-outline-light btn-block" aria-disabled="true">
                        {current ? t("billing.currentPlan") : t("landing.planFree")}
                      </span>
                    ) : (
                      <Link
                        href={`/checkout?plan=${encodeURIComponent(plan.code)}`}
                        className="btn btn-accent btn-block"
                      >
                        {t("billing.payNow")}
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
          </Card>

          <Card title={t("billing.history")}>
            {transactions.length === 0 ? (
              <EmptyState>{t("billing.noTransactions")}</EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("billing.reference")}</th>
                      <th>{t("billing.method")}</th>
                      <th>{t("billing.amount")}</th>
                      <th>{t("billing.status")}</th>
                      <th>{t("account.joinedDate")}</th>
                      <th>{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => {
                      const canUploadProof =
                        transaction.method !== "CARD" &&
                        (transaction.status === "PENDING" ||
                          transaction.status === "UNDER_REVIEW");
                      return (
                        <tr key={transaction.id}>
                          <td className="muted mono">{transaction.reference}</td>
                          <td className="muted">{t(paymentMethodKey(transaction.method))}</td>
                          <td>{formatMoney(transaction.amountCents, transaction.currency)}</td>
                          <td>
                            <Badge tone={statusTone(transaction.status)}>
                              {t(transactionStatusKey(transaction.status))}
                            </Badge>
                          </td>
                          <td className="muted">
                            {new Date(transaction.createdAt).toLocaleDateString()}
                          </td>
                          <td>
                            {canUploadProof ? (
                              <label className="btn btn-ghost btn-sm">
                                {proofBusyId === transaction.id
                                  ? t("common.loading")
                                  : t("billing.proofUpload")}
                                <input
                                  type="file"
                                  accept="application/pdf,image/jpeg,image/png,image/webp"
                                  hidden
                                  disabled={proofBusyId === transaction.id}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void submitProof(transaction.id, file);
                                    event.target.value = "";
                                  }}
                                />
                              </label>
                            ) : null}
                            {transaction.status !== "PENDING" &&
                            transaction.status !== "UNDER_REVIEW" &&
                            transaction.proofSubmittedAt ? (
                              <span className="muted">{t("billing.proofView")}</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t("billing.invoices")}>
            <p className="muted">{t("billing.receiptNote")}</p>
            {invoices.length === 0 ? (
              <EmptyState>{t("billing.noInvoices")}</EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("billing.invoiceNumber")}</th>
                      <th>{t("billing.plan")}</th>
                      <th>{t("billing.amount")}</th>
                      <th>{t("billing.paidAt")}</th>
                      <th>{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="mono">{invoice.invoiceNumber}</td>
                        <td>{invoice.plan.name}</td>
                        <td>{formatMoney(invoice.amountCents, invoice.currency)}</td>
                        <td className="muted">
                          {invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : "—"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => printInvoice(invoice)}
                          >
                            {t("billing.printInvoice")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}

export default function BillingPage() {
  return (
    <RequireAuth roles={["MANAGER"]}>
      <BillingView />
    </RequireAuth>
  );
}
