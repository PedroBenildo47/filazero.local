"use client";
/**
 * Public landing page — "Clean Corporate SaaS".
 *
 * Light, high-contrast institutional page: a minimal header, a centred hero with
 * the two entry paths (customer / company), the live queue mockup, the
 * three-step explainer, the real plan catalogue (`GET /api/plans`) and the
 * business call to action. Nothing is hard-coded or simulated.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { MarketingHeader } from "@/components/MarketingHeader";
import { QueueMockup } from "@/components/QueueMockup";
import { Reveal } from "@/components/Reveal";
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
  const router = useRouter();
  const { user } = useSession();
  // A signed-in manager already has an organization: choosing a plan must lead
  // straight to payment, never back to the registration form.
  const canCheckout = user?.role === "MANAGER";
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansError, setPlansError] = useState(false);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");

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

  function findQueue(event: React.FormEvent) {
    event.preventDefault();
    const query = companyQuery.trim();
    router.push(query ? `/pesquisar?q=${encodeURIComponent(query)}` : "/pesquisar");
  }

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
      <MarketingHeader />

      <main className="mkt-main">
        {/* Hero — centred, with the two entry paths */}
        <section className="mkt-hero">
          <Reveal variant="up" className="mkt-hero-center">
            <span className="mkt-eyebrow">
              <span className="mkt-eyebrow-dot" aria-hidden="true" />
              {t("landing.eyebrow")}
            </span>
            <h1 className="mkt-hero-title">{highlightFila(t("landing.heroTitle"))}</h1>
            <p className="mkt-hero-subtitle">{t("landing.heroSubtitle")}</p>
          </Reveal>

          <Reveal variant="up" delay={120} className="mkt-paths">
            {/* Cliente */}
            <form className="mkt-path mkt-path-client" onSubmit={findQueue}>
              <span className="mkt-path-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
                </svg>
              </span>
              <h2>{t("landing.pathClientTitle")}</h2>
              <p>{t("landing.pathClientText")}</p>
              <label className="mkt-path-field">
                <span className="sr-only">{t("landing.pathClientPlaceholder")}</span>
                <input
                  type="search"
                  placeholder={t("landing.pathClientPlaceholder")}
                  value={companyQuery}
                  onChange={(event) => setCompanyQuery(event.target.value)}
                />
              </label>
              <button type="submit" className="mkt-path-link">
                {t("landing.pathClientCta")} <span aria-hidden="true">→</span>
              </button>
            </form>

            {/* Empresa */}
            <div className="mkt-path mkt-path-company">
              <span className="mkt-path-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" />
                  <path d="M14 10h4a2 2 0 0 1 2 2v9" />
                  <path d="M3 21h18" />
                  <path d="M7.5 8.5h3M7.5 12h3M7.5 15.5h3" />
                </svg>
              </span>
              <h2>{t("landing.pathCompanyTitle")}</h2>
              <p>{t("landing.pathCompanyText")}</p>
              <Link href="/registar-organizacao" className="btn btn-block mkt-path-cta">
                <span aria-hidden="true">→</span> {t("landing.registerCompany")}
              </Link>
            </div>
          </Reveal>

          <Reveal variant="fade" delay={200} className="mkt-hero-metrics">
            <dl className="mkt-metrics">
              {metrics.map((metric) => (
                <div key={metric.label} className="mkt-metric">
                  <dt>{metric.value}</dt>
                  <dd>{metric.label}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </section>

        {/* Produto — painel de filas em tempo real */}
        <section className="mkt-section mkt-product">
          <Reveal variant="up" className="mkt-section-head">
            <h2>{t("landing.productTitle")}</h2>
            <p>{t("landing.productSubtitle")}</p>
          </Reveal>
          <Reveal variant="scale" className="mkt-hero-visual mkt-product-visual">
            <QueueMockup />
          </Reveal>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="mkt-section">
          <Reveal variant="up" className="mkt-section-head">
            <h2>{t("landing.howTitle")}</h2>
            <p>{t("landing.howSubtitle")}</p>
          </Reveal>
          <div className="mkt-how-grid">
            {howSteps.map((step, index) => (
              <Reveal
                key={step.n}
                as="article"
                variant="up"
                delay={index * 90}
                className="mkt-how-card"
              >
                <span className="mkt-how-index">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="mkt-section mkt-section-alt">
          <Reveal variant="up" className="mkt-section-head">
            <h2>{t("landing.plansTitle")}</h2>
            <p>{t("landing.plansSubtitle")}</p>
          </Reveal>

          {!plansLoaded ? (
            <p className="mkt-plans-note">{t("landing.plansLoading")}</p>
          ) : plansError || plans.length === 0 ? (
            <p className="mkt-plans-note">{t("landing.plansError")}</p>
          ) : (
            <div className="mkt-plans-grid">
              {plans.map((plan, index) => {
                const isFree = plan.priceCents === 0;
                const recommended = plan.code === RECOMMENDED_CODE;
                return (
                  <Reveal
                    key={plan.id}
                    as="article"
                    variant="up"
                    delay={index * 90}
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
                  </Reveal>
                );
              })}
            </div>
          )}
        </section>

        {/* Para empresas */}
        <section id="para-empresas" className="mkt-section mkt-business">
          <Reveal variant="up" className="mkt-business-copy">
            <h2>{t("landing.businessTitle")}</h2>
            <p>{t("landing.businessText")}</p>
            <Link href="/registar-organizacao" className="btn btn-accent btn-lg">
              {t("landing.businessCta")} <span aria-hidden="true">→</span>
            </Link>
          </Reveal>
        </section>
      </main>
    </div>
  );
}
