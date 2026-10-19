"use client";
/**
 * Angola-first checkout.
 *
 * A real e-commerce style payment screen for the B2B subscription:
 *  - order summary (plan, price, organization, period);
 *  - payment method cards (Multicaixa Express, bank transfer, EMVCo QR, card);
 *  - method-specific form — the Multicaixa Express phone is required and the
 *    payment request is pushed to it;
 *  - a payment panel with the quotable reference, the platform bank details,
 *    the QR payload and inline proof-of-payment upload.
 *
 * It never fakes a payment: the transaction is created PENDING and only the
 * signature-verified webhook can activate the subscription. Card payments are
 * completed on the provider's hosted, PCI-compliant page.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Badge, Card, Spinner, StatCard } from "@/components/ui";
import { paymentMethodKey, statusTone, transactionStatusKey } from "@/lib/ui";

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

interface BankDetails {
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  holder: string;
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
  bankDetails: BankDetails | null;
  reference: string;
}

const METHODS = ["MULTICAIXA_EXPRESS", "BANK_TRANSFER", "QR_CODE", "CARD"] as const;
type Method = (typeof METHODS)[number];

function formatKz(cents: number): string {
  const kz = Math.round(cents / 100);
  return `${kz.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
}

/** Groups 9 local digits as `9XX XXX XXX`. */
function formatPhoneDigits(digits: string): string {
  const d = digits.slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

function CheckoutFlow() {
  const { t, tError } = useI18n();

  const [planCode, setPlanCode] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("MULTICAIXA_EXPRESS");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofSent, setProofSent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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

  const phoneValid = /^9\d{8}$/.test(phone);

  async function submit() {
    if (!plan || !organization) return;
    if (method === "MULTICAIXA_EXPRESS" && !phoneValid) {
      setError(t("checkout.phoneInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    setProofSent(false);
    setConfirmed(false);
    try {
      const data = await api<CheckoutResult>("/api/billing/checkout", {
        method: "POST",
        json: {
          organizationId: organization.id,
          planId: plan.id,
          method,
          ...(method === "MULTICAIXA_EXPRESS" ? { payerPhone: phone } : {}),
        },
      });
      setResult(data);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  function copy(value: string, key: string) {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    });
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

  // Poll until the signed webhook confirms the payment.
  useEffect(() => {
    if (!result || !organization || confirmed) return;
    let active = true;
    const check = async () => {
      try {
        const data = await api<{ items: { id: string; status: string }[] }>(
          `/api/organizations/${organization.id}/transactions?pageSize=10`,
        );
        const match = data.items.find((item) => item.id === result.transaction.id);
        if (active && match?.status === "SUCCEEDED") setConfirmed(true);
      } catch {
        /* transient; the next tick retries */
      }
    };
    void check();
    const id = window.setInterval(() => void check(), 6000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [result, organization, confirmed]);

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("checkout.loading")} />
      </main>
    );
  }

  const intervalLabel =
    plan?.interval === "YEARLY" ? t("checkout.perYear") : t("checkout.perMonth");

  return (
    <main className="container animate-in checkout-page">
      <div className="checkout-head">
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
      ) : plan.priceCents <= 0 ? (
        <Card title={t("checkout.freePlan")}>
          <Link href="/gestor" className="btn btn-primary">
            {t("checkout.goToPanel")}
          </Link>
        </Card>
      ) : result ? (
        /* ---------------------------------------------------------- payment */
        <div className="checkout-layout">
          <div className="checkout-main">
            <Card title={t("checkout.summary")}>
              <div className="kpi-grid">
                <StatCard
                  label={t("checkout.amount")}
                  value={formatKz(result.transaction.amountCents)}
                />
                <StatCard label={t("billing.reference")} value={result.reference} />
                <StatCard
                  label={t("checkout.method")}
                  value={t(paymentMethodKey(result.transaction.method))}
                />
              </div>

              {confirmed ? (
                <Alert kind="success">{t("checkout.confirmed")}</Alert>
              ) : (
                <Alert kind="info">{t("checkout.pending")}</Alert>
              )}

              {result.bankDetails ? (
                <div className="bank-details">
                  <h3>{t("checkout.bankTitle")}</h3>
                  <dl>
                    <div>
                      <dt>{t("checkout.bankName")}</dt>
                      <dd>{result.bankDetails.bankName ?? t("checkout.notConfigured")}</dd>
                    </div>
                    <div>
                      <dt>{t("checkout.bankHolder")}</dt>
                      <dd>{result.bankDetails.holder}</dd>
                    </div>
                    <div>
                      <dt>{t("checkout.bankIban")}</dt>
                      <dd className="mono">{result.bankDetails.iban ?? t("checkout.notConfigured")}</dd>
                    </div>
                    {result.bankDetails.accountNumber ? (
                      <div>
                        <dt>{t("checkout.bankAccount")}</dt>
                        <dd className="mono">{result.bankDetails.accountNumber}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{t("billing.reference")}</dt>
                      <dd className="mono">{result.reference}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      copy(
                        [
                          result.bankDetails?.iban ?? "",
                          result.reference,
                          formatKz(result.transaction.amountCents),
                        ]
                          .filter(Boolean)
                          .join(" · "),
                        "bank",
                      )
                    }
                  >
                    {copied === "bank" ? t("checkout.copied") : t("checkout.copy")}
                  </button>
                </div>
              ) : null}

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

              {result.checkoutUrl ? (
                <div className="checkout-hosted">
                  <h3>{t("checkout.cardTitle")}</h3>
                  <p className="muted">{t("checkout.cardSecure")}</p>
                  <a
                    href={result.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-accent btn-lg"
                  >
                    {t("billing.payNow")}
                  </a>
                </div>
              ) : null}

              {result.transaction.method !== "CARD" ? (
                <div className="checkout-proof">
                  <h3>{t("billing.proofTitle")}</h3>
                  <p className="muted">{t("billing.proofHint")}</p>
                  {proofSent ? (
                    <Alert kind="success">{t("billing.proofSent")}</Alert>
                  ) : (
                    <label className="proof-drop">
                      <span>{proofBusy ? t("common.loading") : t("billing.proofUpload")}</span>
                      <small>{t("checkout.proofFormats")}</small>
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

              <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
                <Link href="/gestor/subscricao" className="btn btn-ghost">
                  {t("checkout.goToPanel")}
                </Link>
                <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>
                  {t("checkout.newCheckout")}
                </button>
              </div>
            </Card>
          </div>

          <aside className="checkout-aside">
            <Card title={t("checkout.orderSummary")}>
              <dl className="order-summary">
                <div>
                  <dt>{t("billing.plan")}</dt>
                  <dd>{plan.name}</dd>
                </div>
                <div>
                  <dt>{t("checkout.organization")}</dt>
                  <dd>{organization.name}</dd>
                </div>
                <div>
                  <dt>{t("checkout.period")}</dt>
                  <dd>{intervalLabel}</dd>
                </div>
                <div className="order-total">
                  <dt>{t("billing.amount")}</dt>
                  <dd>{formatKz(plan.priceCents)}</dd>
                </div>
              </dl>
              <div className="order-status">
                <span className="muted">{t("billing.status")}</span>
                <Badge tone={statusTone(confirmed ? "SUCCEEDED" : "PENDING")}>
                  {t(transactionStatusKey(confirmed ? "SUCCEEDED" : "PENDING"))}
                </Badge>
              </div>
            </Card>
          </aside>
        </div>
      ) : (
        /* ----------------------------------------------------------- method */
        <div className="checkout-layout">
          <div className="checkout-main">
            <Card title={t("checkout.methodTitle")}>
              <div className="checkout-methods" role="radiogroup" aria-label={t("billing.chooseMethod")}>
                {METHODS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={method === option}
                    className={`checkout-method${method === option ? " is-active" : ""}`}
                    onClick={() => {
                      setMethod(option);
                      setError(null);
                    }}
                  >
                    <span className="checkout-method-name">{t(paymentMethodKey(option))}</span>
                    <span className="checkout-method-hint">{t(`checkout.hint.${option}` as const)}</span>
                  </button>
                ))}
              </div>

              <div className="checkout-form">
                {method === "MULTICAIXA_EXPRESS" ? (
                  <div className="field">
                    <label htmlFor="payer-phone">{t("checkout.phoneLabel")}</label>
                    <div className={`phone-input${phone && !phoneValid ? " is-invalid" : ""}`}>
                      <span className="phone-prefix">+244</span>
                      <input
                        id="payer-phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        placeholder="923 456 789"
                        value={formatPhoneDigits(phone)}
                        onChange={(event) =>
                          setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))
                        }
                      />
                    </div>
                    <small className="muted">{t("checkout.phoneHint")}</small>
                  </div>
                ) : null}

                {method === "BANK_TRANSFER" ? (
                  <p className="muted">{t("checkout.bankIntro")}</p>
                ) : null}

                {method === "QR_CODE" ? (
                  <p className="muted">{t("checkout.qrIntro")}</p>
                ) : null}

                {method === "CARD" ? (
                  <div className="card-panel">
                    <div className="card-brands" aria-hidden="true">
                      <span>VISA</span>
                      <span>Mastercard</span>
                    </div>
                    <p className="muted">{t("checkout.cardIntro")}</p>
                    <ul className="card-points">
                      <li>{t("checkout.cardPoint1")}</li>
                      <li>{t("checkout.cardPoint2")}</li>
                      <li>{t("checkout.cardPoint3")}</li>
                    </ul>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="btn btn-accent btn-lg btn-block"
                  disabled={busy || (method === "MULTICAIXA_EXPRESS" && !phoneValid)}
                  onClick={() => void submit()}
                >
                  {busy
                    ? t("checkout.submitting")
                    : method === "CARD"
                      ? t("checkout.continueCard")
                      : t("checkout.continue")}
                </button>

                <Link href="/#planos" className="checkout-back">
                  {t("checkout.backToPlans")}
                </Link>
              </div>
            </Card>
          </div>

          <aside className="checkout-aside">
            <Card title={t("checkout.orderSummary")}>
              <dl className="order-summary">
                <div>
                  <dt>{t("billing.plan")}</dt>
                  <dd>{plan.name}</dd>
                </div>
                <div>
                  <dt>{t("checkout.organization")}</dt>
                  <dd>{organization.name}</dd>
                </div>
                <div>
                  <dt>{t("checkout.period")}</dt>
                  <dd>{intervalLabel}</dd>
                </div>
                <div className="order-total">
                  <dt>{t("billing.amount")}</dt>
                  <dd>{formatKz(plan.priceCents)}</dd>
                </div>
              </dl>
              {plan.description ? <p className="muted">{plan.description}</p> : null}
              <p className="muted order-limits">
                {t("landing.planLimits", {
                  branches: plan.maxBranches,
                  queues: plan.maxQueuesPerBranch,
                  staff: plan.maxStaff,
                })}
              </p>
            </Card>
          </aside>
        </div>
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
