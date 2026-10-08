"use client";
/**
 * Public checkout page (Fase 1).
 *
 * The landing page sends visitors here after they register their company with
 * `?plan=<code>`. This page confirms the selected plan against the real
 * catalogue (`GET /api/plans`) and starts a real payment through
 * `POST /api/billing/checkout` — it never fakes a payment. The transaction only
 * becomes PAID when the provider confirms it via `POST /api/billing/webhook`.
 *
 * Angolan payment experience: Multicaixa Express, bank transfer (IBAN) and an
 * EMVCo bank QR, each with inline proof-of-payment upload. The subscription is
 * only activated when the provider confirms the payment through the signed
 * webhook — never on the client.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Card, Spinner, StatCard } from "@/components/ui";
import { paymentMethodKey } from "@/lib/ui";

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

interface Organization {
  id: string;
  name: string;
}

interface CheckoutResult {
  transaction: {
    id: string;
    status: string;
    amountCents: number;
    currency: string;
    method: string;
  };
  checkoutUrl: string | null;
  instructions: string | null;
  qrPayload: string | null;
  reference: string;
}

const METHODS = ["MULTICAIXA_EXPRESS", "BANK_TRANSFER", "QR_CODE", "CARD"] as const;
type Method = (typeof METHODS)[number];

function formatKz(cents: number): string {
  const kz = Math.round(cents / 100);
  return `${kz.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
}

function CheckoutFlow() {
  const { t, tError } = useI18n();

  const [planCode, setPlanCode] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("MULTICAIXA_EXPRESS");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofSent, setProofSent] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("plan");
    setPlanCode(code);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [planData, orgData] = await Promise.all([
          api<{ items: Plan[] }>("/api/plans"),
          api<{ items: Organization[] }>("/api/organizations?pageSize=50"),
        ]);
        if (!alive) return;
        setPlans(planData.items);
        setOrganization(orgData.items[0] ?? null);
      } catch (caught) {
        if (alive) setError(tError(caught));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tError]);

  const plan = useMemo(
    () => (planCode ? plans.find((item) => item.code === planCode) ?? null : null),
    [plans, planCode],
  );

  async function submit() {
    if (!plan || !organization) return;
    setBusy(true);
    setError(null);
    setProofSent(false);
    try {
      const data = await api<CheckoutResult>("/api/billing/checkout", {
        method: "POST",
        json: { organizationId: organization.id, planId: plan.id, method },
      });
      setResult(data);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  function downloadQr() {
    const canvas = document.getElementById("checkout-bank-qr") as HTMLCanvasElement | null;
    if (!canvas || !result) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `filazero-qr-${result.reference}.png`;
    link.click();
  }

  async function submitProof(transactionId: string, file: File) {
    if (!organization) return;
    setProofBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api(`/api/organizations/${organization.id}/transactions/${transactionId}/proof`, {
        method: "POST",
        formData,
      });
      setProofSent(true);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setProofBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("checkout.loading")} />
      </main>
    );
  }

  return (
    <main className="container">
      <div className="section-head">
        <span className="pill-tag">{t("billing.checkout")}</span>
        <h1 className="section-title">{t("checkout.title")}</h1>
        <p className="section-sub">{t("checkout.subtitle")}</p>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {!organization ? (
        <Card title={t("checkout.needOrg")}>
          <Link href="/registar-organizacao" className="btn btn-primary">
            {t("landing.registerCompany")}
          </Link>
        </Card>
      ) : !plan ? (
        <Card title={t("checkout.noPlan")}>
          <Link href="/#planos" className="btn btn-primary">
            {t("checkout.backToPlans")}
          </Link>
        </Card>
      ) : result ? (
        <Card title={t("checkout.summary")}>
          <div className="kpi-grid">
            <StatCard label={t("checkout.amount")} value={formatKz(result.transaction.amountCents)} />
            <StatCard label={t("billing.reference")} value={result.reference} />
            <StatCard label={t("checkout.method")} value={t(paymentMethodKey(result.transaction.method))} />
          </div>

          <Alert kind="info">{t("checkout.pending")}</Alert>

          {result.instructions ? (
            <>
              <h3>{t("checkout.instructions")}</h3>
              <pre className="instructions">{result.instructions}</pre>
            </>
          ) : null}

          {result.qrPayload ? (
            <div className="qr-checkout">
              <h3>{t("checkout.qrTitle")}</h3>
              <p className="muted">{t("checkout.qrHint")}</p>
              <QRCodeCanvas id="checkout-bank-qr" value={result.qrPayload} size={224} level="M" />
              <div>
                <button type="button" className="btn btn-ghost" onClick={downloadQr}>
                  {t("checkout.qrDownload")}
                </button>
              </div>
            </div>
          ) : null}

          {result.transaction.method !== "CARD" ? (
            <div className="stack" style={{ gap: "0.5rem" }}>
              <h3>{t("billing.proofTitle")}</h3>
              <p className="muted">{t("billing.proofHint")}</p>
              {proofSent ? (
                <Alert kind="success">{t("billing.proofSent")}</Alert>
              ) : (
                <label className="btn btn-ghost">
                  {proofBusy ? t("common.loading") : t("billing.proofUpload")}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    hidden
                    disabled={proofBusy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void submitProof(result.transaction.id, file);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          ) : null}

          <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
            {result.checkoutUrl ? (
              <a href={result.checkoutUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
                {t("billing.payNow")}
              </a>
            ) : null}
            <Link href="/gestor" className="btn btn-ghost">
              {t("checkout.goToPanel")}
            </Link>
            <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>
              {t("checkout.newCheckout")}
            </button>
          </div>
        </Card>
      ) : plan.priceCents <= 0 ? (
        <Card title={t("checkout.freePlan")}>
          <Link href="/gestor" className="btn btn-primary">
            {t("checkout.goToPanel")}
          </Link>
        </Card>
      ) : (
        <Card title={`${plan.name} · ${formatKz(plan.priceCents)}${t("landing.perMonth")}`}>
          <div className="stack" style={{ gap: "0.75rem" }}>
            <div>
              <span className="muted">{t("checkout.organization")}: </span>
              <strong>{organization.name}</strong>
            </div>
            {plan.description ? <p className="muted">{plan.description}</p> : null}
            <p className="muted">
              {t("landing.planLimits", {
                branches: plan.maxBranches,
                queues: plan.maxQueuesPerBranch,
                staff: plan.maxStaff,
              })}
            </p>

            <div className="field">
              <span>{t("billing.chooseMethod")}</span>
              <div className="row method-picker">
                {METHODS.map((option) => (
                  <label
                    key={option}
                    className={`method-option${method === option ? " is-active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="method"
                      value={option}
                      checked={method === option}
                      onChange={() => setMethod(option)}
                    />
                    {t(paymentMethodKey(option))}
                  </label>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? t("checkout.submitting") : t("checkout.submit")}
              </button>
              <Link href="/#planos" className="btn btn-ghost">
                {t("checkout.backToPlans")}
              </Link>
            </div>
          </div>
        </Card>
      )}
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <RequireAuth roles={["MANAGER"]}>
      <CheckoutFlow />
    </RequireAuth>
  );
}
