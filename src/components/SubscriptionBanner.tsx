"use client";
/**
 * Subscription banner for the customer account page.
 *
 * Shows the free-month countdown (last week) or the "subscription required"
 * state once it ends, with a link to the payment page. Only customers see it.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { useSession } from "@/components/SessionProvider";
import { Alert } from "@/components/ui";

interface CustomerBilling {
  operational: boolean;
  daysRemaining: number | null;
  effectiveStatus: string | null;
}

export function SubscriptionBanner() {
  const { t } = useI18n();
  const { user } = useSession();
  const [billing, setBilling] = useState<CustomerBilling | null>(null);

  useEffect(() => {
    if (user?.role !== "CUSTOMER") return;
    let active = true;
    api<CustomerBilling>("/api/customer/subscription")
      .then((data) => {
        if (active) setBilling(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user?.role]);

  if (user?.role !== "CUSTOMER" || !billing) return null;

  if (!billing.operational) {
    return (
      <Alert kind="error">
        {t("sub.expiredBanner")}{" "}
        <Link href="/subscricao" className="btn btn-primary btn-sm">
          {t("sub.subscribe")}
        </Link>
      </Alert>
    );
  }

  if ((billing.daysRemaining ?? 99) <= 7) {
    return (
      <Alert kind="info">
        {t("sub.trialBanner", { days: billing.daysRemaining ?? 0 })}{" "}
        <Link href="/subscricao" className="btn btn-ghost btn-sm">
          {t("sub.subscribe")}
        </Link>
      </Alert>
    );
  }

  return null;
}
