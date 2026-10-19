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

/** Inline feature icons (stroke-based, corporate blue). */
const FEATURE_ICONS: Record<string, React.ReactNode> = {
  mobile: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2.5" width="10" height="19" rx="2.4" />
      <path d="M11 18.5h2" />
    </svg>
  ),
  realtime: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  ),
  qr: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.4" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1.4" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1.4" />
      <path d="M14.5 14.5h2.5v2.5M20.5 14.5v6M14.5 20.5h6" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V8M17 20v-9" />
    </svg>
  ),
  multifila: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8.5" r="2.4" />
      <path d="M3.5 17c0-2.1 2-3.6 4.5-3.6s4.5 1.5 4.5 3.6" />
      <circle cx="16.5" cy="9.5" r="2" />
      <path d="M13.5 17c0-1.8 1.4-3 3-3s3 1.2 3 3" />
    </svg>
  ),
  secure: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2l6.5 2.4v5.3c0 4.1-2.7 7.4-6.5 8.9-3.8-1.5-6.5-4.8-6.5-8.9V5.6z" />
      <path d="M9.3 12.2l1.9 1.9 3.5-3.7" />
    </svg>
  ),
};

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
    { title: t("landing.how1Title"), text: t("landing.how1Text") },
    { title: t("landing.how2Title"), text: t("landing.how2Text") },
    { title: t("landing.how3Title"), text: t("landing.how3Text") },
  ];

  const features = [
    { icon: "mobile", title: t("landing.feature1Title"), text: t("landing.feature1Text") },
    { icon: "realtime", title: t("landing.feature2Title"), text: t("landing.feature2Text") },
    { icon: "qr", title: t("landing.feature3Title"), text: t("landing.feature3Text") },
    { icon: "analytics", title: t("landing.feature4Title"), text: t("landing.feature4Text") },
    { icon: "multifila", title: t("landing.feature5Title"), text: t("landing.feature5Text") },
    { icon: "secure", title: t("landing.feature6Title"), text: t("landing.feature6Text") },
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
              <p className="mkt-path-note">{t("landing.pathCompanyNote")}</p>
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

        {/* Como funciona? */}
        <section id="como-funciona" className="mkt-section">
          <Reveal variant="up" className="mkt-section-head">
            <h2>{t("landing.howTitle")}</h2>
            <p>{t("landing.howSubtitle")}</p>
          </Reveal>
          <div className="mkt-steps">
            {howSteps.map((step, index) => (
              <Reveal
                key={step.title}
                as="article"
                variant="up"
                delay={index * 90}
                className="mkt-step"
              >
                <span className="mkt-step-num">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Tudo o que precisa */}
        <section id="funcionalidades" className="mkt-section">
          <Reveal variant="up" className="mkt-section-head">
            <h2>{t("landing.featuresTitle")}</h2>
            <p>{t("landing.featuresSubtitle")}</p>
          </Reveal>
          <div className="mkt-features">
            {features.map((feature, index) => (
              <Reveal
                key={feature.title}
                as="article"
                variant="up"
                delay={index * 70}
                className="mkt-feature"
              >
                <span className="mkt-feature-icon" aria-hidden="true">
                  {FEATURE_ICONS[feature.icon]}
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Planos e Preços */}
        <section id="planos" className="mkt-section">
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
                    {plan.description && <p className="mkt-plan-desc">{plan.description}</p>}
                    <div className="mkt-plan-price">
                      {isFree ? t("landing.planFreePrice") : formatKz(plan.priceCents)}
                      {!isFree && <span>{t("landing.perMonth")}</span>}
                    </div>

                    <ul className="mkt-plan-features">
                      <li className="mkt-plan-feature">
                        {t("landing.planFeatureBranches", { count: plan.maxBranches })}
                      </li>
                      <li className="mkt-plan-feature">
                        {t("landing.planFeatureQueues", { count: plan.maxQueuesPerBranch })}
                      </li>
                      <li className="mkt-plan-feature">
                        {t("landing.planFeatureStaff", { count: plan.maxStaff })}
                      </li>
                      <li className="mkt-plan-feature">{t("landing.planFeatureQr")}</li>
                    </ul>

                    <Link
                      href={
                        canCheckout
                          ? `/checkout?plan=${encodeURIComponent(plan.code)}`
                          : `/registar-organizacao?plan=${encodeURIComponent(plan.code)}`
                      }
                      className={`btn ${recommended ? "btn-accent" : "btn-outline-light"}`}
                    >
                      {isFree ? t("landing.planStartFree") : t("landing.planStartNow")}
                    </Link>
                  </Reveal>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
