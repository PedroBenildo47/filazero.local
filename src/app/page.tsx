"use client";
/**
 * Public landing page — "Futuristic Aqua Blue".
 *
 * Institutional page for the product: glass marketing header, hero with the
 * neon-aqua identity, the three-step explainer, the public plan showcase fed by
 * the real API (`GET /api/plans`) and the business call to action. Nothing is
 * hard-coded or simulated — every card and every link points at something real.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { MarketingHeader } from "@/components/MarketingHeader";
import { HeroCarousel } from "@/components/HeroCarousel";
import { useSession } from "@/components/SessionProvider";

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

/** Recommended plan highlighted on the showcase (Profissional). */
const RECOMMENDED_CODE = "growth";

/** Highlights the word "fila" in the hero title with the accent colour. */
function highlightFila(text: string) {
  return text.split(/(fila)/i).map((part, index) =>
    /^fila$/i.test(part) ? (
      <span key={index} className="mkt-accent">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/** Formats a price given in cents as Angolan Kwanzas, e.g. `25.000 Kz`. */
function formatKz(cents: number): string {
  const kwanza = Math.round(cents / 100);
  return `${kwanza.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} Kz`;
}

export default function HomePage() {
  const { t } = useI18n();
  const { user } = useSession();
  // A signed-in manager already has an organization: choosing a plan must lead
  // straight to payment, never back to the registration form.
  const canCheckout = user?.role === "MANAGER";
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

  const metrics = [
    { value: t("landing.metric1Value"), label: t("landing.metric1Label") },
    { value: t("landing.metric2Value"), label: t("landing.metric2Label") },
    { value: t("landing.metric3Value"), label: t("landing.metric3Label") },
  ];

  return (
    <div className="mkt-page">
      {/* Decorative neon orbs (purely visual). */}
      <div className="mkt-bg" aria-hidden="true">
        <span className="mkt-orb is-1" />
        <span className="mkt-orb is-2" />
        <span className="mkt-orb is-3" />
      </div>

      <MarketingHeader />

      <main className="mkt-main">
        {/* Hero */}
        <section className="mkt-hero">
          <div className="mkt-hero-copy">
            <span className="mkt-eyebrow">{t("landing.eyebrow")}</span>
            <h1 className="mkt-hero-title">{highlightFila(t("landing.heroTitle"))}</h1>
            <p className="mkt-hero-subtitle">{t("landing.heroSubtitle")}</p>
            <div className="mkt-hero-actions">
              <Link href="/login" className="btn btn-accent btn-lg">
                {t("landing.heroPrimary")} <span aria-hidden="true">→</span>
              </Link>
              <Link href="/registar-organizacao" className="btn btn-outline-light btn-lg">
                {t("landing.heroSecondary")}
              </Link>
            </div>

            <dl className="mkt-metrics">
              {metrics.map((metric) => (
                <div key={metric.label} className="mkt-metric">
                  <dt>{metric.value}</dt>
                  <dd>{metric.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mkt-hero-visual">
            <HeroCarousel
              label={t("landing.heroImageAlt")}
              slides={[
                { src: "/marketing/hero-waiting-room.svg", alt: t("landing.slide1Alt") },
                { src: "/marketing/hero-reception.svg", alt: t("landing.slide2Alt") },
                { src: "/marketing/hero-phone.svg", alt: t("landing.slide3Alt") },
              ]}
            />
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
                      href={
                        canCheckout
                          ? `/checkout?plan=${encodeURIComponent(plan.code)}`
                          : `/registar-organizacao?plan=${encodeURIComponent(plan.code)}`
                      }
                      className={`btn ${recommended ? "btn-accent" : "btn-outline-light"} btn-block`}
                    >
                      {isFree
                        ? t("landing.planFree")
                        : canCheckout
                          ? t("landing.planPayNow")
                          : t("landing.planChoose")}
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
            <Link href="/registar-organizacao" className="btn btn-accent btn-lg">
              {t("landing.businessCta")} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
