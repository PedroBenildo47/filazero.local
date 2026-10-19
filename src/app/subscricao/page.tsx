"use client";
/**
 * End-customer subscription page (B2C).
 *
 * The customer sees the free month status and, after it, pays the 2.000 Kz/month
 * plan with the Angolan methods (Multicaixa Express, bank transfer, EMVCo QR or
 * card). The subscription is activated by the signed webhook; the page polls
 * until it flips to active.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Badge, Card, Spinner, StatCard } from "@/components/ui";
import { CardPaymentForm } from "@/components/CardPaymentForm";
import {
  paymentMethodKey,
  statusTone,
  subscriptionStatusKey,
  transactionStatusKey,
} from "@/lib/ui";

interface CustomerBilling {
  plan: { name: string; priceCents: number; currency: string; interval: string };
  trialDays: number;
  operational: boolean;
  daysRemaining: number | null;
  effectiveStatus: string | null;
  subscription: { currentPeriodEnd: string } | null;
  payments: { id: string; status: string; reference: string; createdAt: string }[];
}

interface CheckoutResult {
  payment: { id: string; status: string; method: string };
  checkoutUrl: string | null;
  instructions: string | null;
  qrPayload: string | null;
  bankDetails: {
    bankName: string | null;
    accountNumber: string | null;
    iban: string | null;
    holder: string;
  } | null;
  reference: string;
}

interface CardIntent {
  clientSecret: string;
  publishableKey: string;
  reference: string;
  paymentId: string;
}

const METHODS = ["MULTICAIXA_EXPRESS", "BANK_TRANSFER", "QR_CODE", "CARD"] as const;
type Method = (typeof METHODS)[number];

function formatKz(cents: number): string {
  const kz = Math.round(cents / 100);
  return `${kz.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
}

function SubscriptionFlow() {
  const { t, tError } = useI18n();
  const [billing, setBilling] = useState<CustomerBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("MULTICAIXA_EXPRESS");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [proofSent, setProofSent] = useState(false);
  const [cardIntent, setCardIntent] = useState<CardIntent | null>(null);
  const [cardPaid, setCardPaid] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<CustomerBilling>("/api/customer/subscription");
        if (active) setBilling(data);
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

  // Poll until the webhook confirms the payment.
  useEffect(() => {
    if (!result || confirmed) return;
    let active = true;
    const check = async () => {
      try {
        const data = await api<CustomerBilling>("/api/customer/subscription");
        if (active) {
          setBilling(data);
          if (data.operational && data.effectiveStatus === "ACTIVE") setConfirmed(true);
        }
      } catch {
        /* transient */
      }
    };
    void check();
    const id = window.setInterval(() => void check(), 6000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [result, confirmed]);

  async function submit() {
    if (method === "MULTICAIXA_EXPRESS" && !/^9\d{8}$/.test(phone)) {
      setError(t("checkout.phoneInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    setProofSent(false);
    setConfirmed(false);
    setCardPaid(false);
    try {
      if (method === "CARD") {
        setCardIntent(await api<CardIntent>("/api/customer/payment-intent", { method: "POST" }));
        return;
      }
      setResult(
        await api<CheckoutResult>("/api/customer/checkout", {
          method: "POST",
          json: {
            method,
            ...(method === "MULTICAIXA_EXPRESS" ? { payerPhone: phone } : {}),
          },
        }),
      );
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitProof(paymentId: string, file: File) {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api(`/api/customer/payments/${paymentId}/proof`, { method: "POST", formData });
      setProofSent(true);
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

  const plan = billing?.plan;
  const status = billing?.effectiveStatus ?? "EXPIRED";

  return (
    <main className="container animate-in">
      <div className="row spread manager-heading">
        <div>
          <h1>{t("sub.title")}</h1>
          <p className="muted">{t("sub.subtitle")}</p>
        </div>
        <Link href="/conta" className="btn btn-ghost">{t("sub.goToAccount")}</Link>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="kpi-grid">
        <StatCard
          label={t("sub.plan")}
          value={plan ? formatKz(plan.priceCents) : "—"}
          hint={plan?.name}
          tone="info"
        />
        <StatCard
          label={t("billing.status")}
          value={<Badge tone={statusTone(status)}>{t(subscriptionStatusKey(status))}</Badge>}
          tone={billing?.operational ? "ok" : "danger"}
        />
        <StatCard
          label={t("sub.daysLeft")}
          value={billing?.daysRemaining ?? 0}
          hint={
            billing?.subscription
              ? t("sub.renewsAt", {
                  date: new Date(billing.subscription.currentPeriodEnd).toLocaleDateString(),
                })
              : undefined
          }
          tone={(billing?.daysRemaining ?? 0) <= 5 ? "warn" : "ok"}
        />
      </div>

      {billing?.operational && !confirmed ? (
        <Alert kind="success">{t("sub.active")}</Alert>
      ) : null}

      {result ? (
        <Card title={t("checkout.summary")}>
          <div className="kpi-grid">
            <StatCard label={t("checkout.amount")} value={plan ? formatKz(plan.priceCents) : "—"} />
            <StatCard label={t("billing.reference")} value={result.reference} />
            <StatCard
              label={t("checkout.method")}
              value={t(paymentMethodKey(result.payment.method))}
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
                  <dd className="mono">
                    {result.bankDetails.iban ?? t("checkout.notConfigured")}
                  </dd>
                </div>
                <div>
                  <dt>{t("billing.reference")}</dt>
                  <dd className="mono">{result.reference}</dd>
                </div>
              </dl>
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
              <QRCodeCanvas id="customer-bank-qr" value={result.qrPayload} size={224} level="M" />
            </div>
          ) : null}

          {result.checkoutUrl ? (
            <p>
              <a href={result.checkoutUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
                {t("billing.payNow")}
              </a>
            </p>
          ) : null}

          {result.payment.method !== "CARD" ? (
            <div className="stack" style={{ gap: "0.5rem" }}>
              <h3>{t("billing.proofTitle")}</h3>
              <p className="muted">{t("billing.proofHint")}</p>
              {proofSent ? (
                <Alert kind="success">{t("billing.proofSent")}</Alert>
              ) : (
                <label className="btn btn-ghost">
                  {busy ? t("common.loading") : t("billing.proofUpload")}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    hidden
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void submitProof(result.payment.id, file);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          ) : null}

          <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>
              {t("checkout.newCheckout")}
            </button>
          </div>
        </Card>
      ) : (
        <Card title={t("sub.subscribe")}>
          <div className="stack" style={{ gap: "0.75rem" }}>
            <p className="muted">{t("sub.trialNote", { days: billing?.trialDays ?? 30 })}</p>
            <div className="field">
              <span>{t("billing.chooseMethod")}</span>
              <div className="row method-picker">
                {METHODS.map((option) => (
                  <label key={option} className={`method-option${method === option ? " is-active" : ""}`}>
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
            {method === "MULTICAIXA_EXPRESS" ? (
              <div className="field">
                <label htmlFor="customer-phone">{t("checkout.phoneLabel")}</label>
                <div className={`phone-input${phone && !/^9\d{8}$/.test(phone) ? " is-invalid" : ""}`}>
                  <span className="phone-prefix">+244</span>
                  <input
                    id="customer-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="923 456 789"
                    value={phone.length > 6 ? `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}` : phone.length > 3 ? `${phone.slice(0, 3)} ${phone.slice(3)}` : phone}
                    onChange={(event) =>
                      setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))
                    }
                  />
                </div>
                <small className="muted">{t("checkout.phoneHint")}</small>
              </div>
            ) : null}
            {method === "CARD" ? (
              cardPaid ? (
                <Alert kind="success">{t("card.paid")}</Alert>
              ) : cardIntent ? (
                <CardPaymentForm
                  publishableKey={cardIntent.publishableKey}
                  clientSecret={cardIntent.clientSecret}
                  onSuccess={() => {
                    setCardPaid(true);
                    setConfirmed(true);
                  }}
                />
              ) : (
                <div className="card-panel">
                  <div className="card-brands" aria-hidden="true">
                    <span>VISA</span>
                    <span>Mastercard</span>
                  </div>
                  <p className="muted">{t("checkout.cardIntro")}</p>
                </div>
              )
            ) : null}
            {cardIntent || cardPaid ? null : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={busy || (method === "MULTICAIXA_EXPRESS" && !/^9\d{8}$/.test(phone))}
                onClick={() => void submit()}
              >
                {busy
                  ? t("checkout.submitting")
                  : t("sub.payNow", { price: plan ? formatKz(plan.priceCents) : "2.000 Kz" })}
              </button>
            )}
          </div>
        </Card>
      )}

      {billing && billing.payments.length > 0 ? (
        <Card title={t("sub.history")}>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("billing.reference")}</th>
                  <th>{t("billing.status")}</th>
                  <th>{t("account.joinedDate")}</th>
                </tr>
              </thead>
              <tbody>
                {billing.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="muted mono">{payment.reference}</td>
                    <td>
                      <Badge tone={statusTone(payment.status)}>
                        {t(transactionStatusKey(payment.status))}
                      </Badge>
                    </td>
                    <td className="muted">{new Date(payment.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </main>
  );
}

export default function SubscriptionPage() {
  return (
    <RequireAuth>
      <SubscriptionFlow />
    </RequireAuth>
  );
}
