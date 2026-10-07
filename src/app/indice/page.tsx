"use client";
import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";

export default function SiteIndexPage() {
  const { t } = useI18n();
  const platformLinks = [
    { href: "/", label: t("nav.home") },
    { href: "/pesquisar", label: t("index.customerDirectory") },
    { href: "/conta", label: t("index.customerAccount") },
    { href: "/registar-organizacao", label: t("index.organizationRegister") },
    { href: "/login?next=%2Fstaff", label: t("index.teamLogin") },
    { href: "/gestor", label: t("index.managerDashboard") },
    { href: "/gestor/analytics", label: t("index.analytics") },
  ];
  const informationLinks = [
    { href: "/informacao/aplicativos", label: t("footer.mobileApps") },
    { href: "/informacao/aviso-legal", label: t("footer.legalNotice") },
    { href: "/informacao/termos-de-uso", label: t("footer.termsOfUse") },
    { href: "/informacao/termos-de-venda", label: t("footer.termsOfSale") },
    { href: "/informacao/privacidade", label: t("footer.privacy") },
    { href: "/informacao/cookies", label: t("footer.cookies") },
    { href: "/informacao/contacto", label: t("footer.contact") },
  ];

  return (
    <main className="container information-page animate-in">
      <div className="information-header">
        <p className="eyebrow">{t("footer.platform")}</p>
        <h1>{t("index.title")}</h1>
        <p className="section-sub">{t("index.subtitle")}</p>
      </div>
      <div className="information-index-grid">
        <section className="information-index-section" aria-labelledby="site-map-platform">
          <h2 id="site-map-platform">{t("index.platform")}</h2>
          <ul className="information-link-list">
            {platformLinks.map((item) => (
              <li key={item.href}><Link href={item.href}>{item.label}</Link></li>
            ))}
          </ul>
        </section>
        <section className="information-index-section" aria-labelledby="site-map-information">
          <h2 id="site-map-information">{t("index.information")}</h2>
          <ul className="information-link-list">
            {informationLinks.map((item) => (
              <li key={item.href}><Link href={item.href}>{item.label}</Link></li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
