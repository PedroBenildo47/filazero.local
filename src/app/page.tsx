"use client";
/**
 * Landing page. Informational only: every link points at a page that really
 * exists and consumes the real API.
 */
import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";

export default function HomePage() {
  const { t } = useI18n();

  const steps = [
    t("landing.step1"),
    t("landing.step2"),
    t("landing.step3"),
    t("landing.step4"),
    t("landing.step5"),
  ];

  const stack = [
    { title: t("landing.stack1"), text: t("landing.stack1Text") },
    { title: t("landing.stack2"), text: t("landing.stack2Text") },
    { title: t("landing.stack3"), text: t("landing.stack3Text") },
    { title: t("landing.stack4"), text: t("landing.stack4Text") },
  ];

  const roles = [
    { key: "CUSTOMER", text: t("landing.roleCustomer") },
    { key: "STAFF", text: t("landing.roleStaff") },
    { key: "MANAGER", text: t("landing.roleManager") },
    { key: "ADMINISTRATOR", text: t("landing.roleAdmin") },
  ] as const;

  return (
    <main className="container">
      <section className="hero">
        <span className="pill">
          <span className="pill-tag">v1</span>
          {t("landing.pill")}
        </span>
        <h1>{t("landing.title")}</h1>
        <p>{t("landing.subtitle")}</p>
        <div className="row landing-actions">
          <Link href="/pesquisar" className="btn btn-primary btn-lg">
            {t("landing.ctaCustomer")}
          </Link>
          <Link href="/registar-organizacao" className="btn btn-ghost btn-lg">
            {t("landing.ctaOrganization")}
          </Link>
        </div>
      </section>

      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step}>
            <span className="step-index">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>

      <div className="section-head">
        <div>
          <h2 className="section-title">{t("landing.stackTitle")}</h2>
        </div>
      </div>
      <div className="grid">
        {stack.map((item) => (
          <article key={item.title} className="tile">
            <h3>{item.title}</h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.86rem" }}>
              {item.text}
            </p>
          </article>
        ))}
      </div>

      <div className="section-head">
        <div>
          <h2 className="section-title">{t("landing.forBusiness")}</h2>
          <p className="section-sub">{t("landing.forBusinessText")}</p>
        </div>
      </div>
      <div className="grid">
        {roles.map((role) => (
          <article key={role.key} className="tile">
            <h3>{t(`role.${role.key}`)}</h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.86rem" }}>
              {role.text}
            </p>
          </article>
        ))}
      </div>
    </main>
  );
}
