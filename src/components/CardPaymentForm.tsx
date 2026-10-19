"use client";
/**
 * Embedded Stripe card form.
 *
 * Collects the card with Stripe Elements (PCI-compliant iframes owned by
 * Stripe) and confirms the PaymentIntent directly against Stripe. The card
 * number, expiry and CVC never reach FilaZero's server or DOM — only Stripe's
 * iframes hold them. Field formatting and validation are handled by Elements.
 */
import { useMemo, useState } from "react";
import { loadStripe, type Stripe, type StripeElementStyle } from "@stripe/stripe-js";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useI18n } from "./LanguageProvider";

const stripeCache = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  const existing = stripeCache.get(publishableKey);
  if (existing) return existing;
  const promise = loadStripe(publishableKey);
  stripeCache.set(publishableKey, promise);
  return promise;
}

const ELEMENT_STYLE: StripeElementStyle = {
  base: {
    fontSize: "16px",
    color: "#e2e8f0",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    "::placeholder": { color: "#64748b" },
    iconColor: "#67e8f9",
  },
  invalid: { color: "#f87171", iconColor: "#f87171" },
};

function InnerCardForm({
  clientSecret,
  onSuccess,
}: {
  clientSecret: string;
  onSuccess: () => void;
}) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardNumberElement);
    if (!card) {
      setError(t("card.notReady"));
      return;
    }
    setBusy(true);
    setError(null);

    const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card,
        billing_details: name.trim() ? { name: name.trim() } : undefined,
      },
    });

    if (stripeError) {
      setError(stripeError.message ?? t("card.failed"));
      setBusy(false);
      return;
    }

    if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
      onSuccess();
      return;
    }

    setError(t("card.failed"));
    setBusy(false);
  }

  return (
    <div className="card-form">
      <label className="card-field">
        <span>{t("card.number")}</span>
        <div className="card-element">
          <CardNumberElement options={{ style: ELEMENT_STYLE, showIcon: true }} />
        </div>
      </label>

      <div className="card-row">
        <label className="card-field">
          <span>{t("card.expiry")}</span>
          <div className="card-element">
            <CardExpiryElement options={{ style: ELEMENT_STYLE }} />
          </div>
        </label>
        <label className="card-field">
          <span>{t("card.cvc")}</span>
          <div className="card-element">
            <CardCvcElement options={{ style: ELEMENT_STYLE }} />
          </div>
        </label>
      </div>

      <label className="card-field">
        <span>{t("card.holder")}</span>
        <input
          type="text"
          className="card-name-input"
          autoComplete="cc-name"
          placeholder={t("card.holderPlaceholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {error ? <p className="card-error">{error}</p> : null}

      <button
        type="button"
        className="btn btn-accent btn-lg btn-block"
        disabled={busy || !stripe}
        onClick={() => void pay()}
      >
        {busy ? t("card.processing") : t("card.pay")}
      </button>

      <p className="card-secure-note">{t("card.secureNote")}</p>
    </div>
  );
}

export function CardPaymentForm({
  publishableKey,
  clientSecret,
  onSuccess,
}: {
  publishableKey: string;
  clientSecret: string;
  onSuccess: () => void;
}) {
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "night",
          variables: { colorPrimary: "#06b6d4", borderRadius: "10px" },
        },
      }}
    >
      <InnerCardForm clientSecret={clientSecret} onSuccess={onSuccess} />
    </Elements>
  );
}
