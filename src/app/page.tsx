"use client";
/**
 * Public landing page.
 *
 * Institutional page for the product: fixed marketing header, hero, "how it
 * works", the public plan showcase and the business call to action. Every link
 * points at a page that really exists and the plan cards are fed by the real
 * public API (`GET /api/plans`) — nothing is hard-coded or simulated.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { MarketingHeader } from "@/components/MarketingHeader";

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

/** Recommended plan highlighted on the showcase. */
const RECOMMENDED_CODE = "growth";

/** Formats a price given in cents as Angolan Kwanzas, e.g. `100.000 Kz`. */
function formatKz(cents: number): string {
  const kwanza = Math.round(cents / 100);
  return `${kwanza.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
}

export default function HomePage() {
  const { t } = useI18n();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansError, setPlansError] = useState(false);
  const [plansLoaded, setPlansLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ items: Plan[] }>("/api/plans")
      .then((result) => {
        if (active) setPlans(result.items);
      })
      .catch(() => {
        if (active) setPlansError(true);
      })
      .finally(() => {
        if (active) setPlansLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const howSteps = [
    { n: "01", title: t("landing.how1Title"), text: t("landing.how1Text") },
    { n: "02", title: t("landing.how2Title"), text: t("landing.how2Text") },
    { n: "03", title: t("landing.how3Title"), text: t("landing.how3Text") },
  ];

  return (
    <>
      <MarketingHeader />

      <main className="mkt-main">
        {/* Hero */}
        <section className="mkt-hero">
          <div className="mkt-hero-copy">
            <span className="mkt-eyebrow">{t("landing.eyebrow")}</span>
            <h1 className="mkt-hero-title">{t("landing.heroTitle")}</h1>
            <p className="mkt-hero-subtitle">{t("landing.heroSubtitle")}</p>
            <div className="mkt-hero-actions">
              <Link href="/login" className="btn btn-primary btn-lg">
                {t("landing.heroPrimary")}
              </Link>
              <Link href="/registar-organizacao" className="btn btn-ghost btn-lg">
                {t("landing.heroSecondary")}
              </Link>
            </div>
          </div>

          <div className="mkt-hero-visual" role="img" aria-label={t("landing.heroImageAlt")}>
            <div className="mkt-hero-photo" aria-hidden="true" />
            <div className="mkt-float-card">
              <span className="mkt-float-dot" aria-hidden="true" />
              <div>
                <strong>{t("landing.heroCardTitle")}</strong>
                <span>{t("landing.heroCardPosition")}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="mkt-section">
          <div className="mkt-section-head">
            <h2>{t("landing.howTitle")}</h2>
            <p>{t("landing.howSubtitle")}</p>
          </div>
          <div className="mkt-how-grid">
            {howSteps.map((step) => (
              <article key={step.n} className="mkt-how-card">
                <span className="mkt-how-index">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="mkt-section mkt-section-alt">
          <div className="mkt-section-head">
            <h2>{t("landing.plansTitle")}</h2>
            <p>{t("landing.plansSubtitle")}</p>
          </div>

          {!plansLoaded ? (
            <p className="mkt-plans-note">{t("landing.plansLoading")}</p>
          ) : plansError || plans.length === 0 ? (
            <p className="mkt-plans-note">{t("landing.plansError")}</p>
          ) : (
            <div className="mkt-plans-grid">
              {plans.map((plan) => {
                const isFree = plan.priceCents === 0;
                const recommended = plan.code === RECOMMENDED_CODE;
                return (
                  <article
                    key={plan.id}
                    className={`mkt-plan${recommended ? " is-recommended" : ""}`}
                  >
                    {recommended && (
                      <span className="mkt-plan-badge">{t("landing.planRecommended")}</span>
                    )}
                    <h3>{plan.name}</h3>
                    <div className="mkt-plan-price">
                      {isFree ? t("landing.planFreePrice") : formatKz(plan.priceCents)}
                      {!isFree && <span>{t("landing.perMonth")}</span>}
                    </div>
                    {plan.description && <p className="mkt-plan-desc">{plan.description}</p>}
                    <p className="mkt-plan-limits">
                      {t("landing.planLimits", {
                        branches: plan.maxBranches,
                        queues: plan.maxQueuesPerBranch,
                        staff: plan.maxStaff,
                      })}
                    </p>
                    <Link
                      href={`/registar-organizacao?plan=${encodeURIComponent(plan.code)}`}
                      className={`btn ${recommended ? "btn-primary" : "btn-ghost"} btn-block`}
                    >
                      {isFree ? t("landing.planFree") : t("landing.planChoose")}
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Para empresas */}
        <section id="para-empresas" className="mkt-section mkt-business">
          <div className="mkt-business-copy">
            <h2>{t("landing.businessTitle")}</h2>
            <p>{t("landing.businessText")}</p>
            <Link href="/registar-organizacao" className="btn btn-primary btn-lg">
              {t("landing.businessCta")}
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
