"use client";
import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";

const SUPPORT_EMAIL = "suporte@filazero.ao";

export function Footer() {
  const { t } = useI18n();

  const platformLinks = [
    { label: t("footer.mobileApps"), href: "/informacao/aplicativos" },
    { label: t("footer.index"), href: "/indice" },
  ];
  const legalLinks = [
    { label: t("footer.legalNotice"), href: "/informacao/aviso-legal" },
    { label: t("footer.termsOfUse"), href: "/informacao/termos-de-uso" },
    { label: t("footer.termsOfSale"), href: "/informacao/termos-de-venda" },
    { label: t("footer.privacy"), href: "/informacao/privacidade" },
    { label: t("footer.cookies"), href: "/informacao/cookies" },
  ];

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link href="/" className="footer-name">FilaZero</Link>
          <p>{t("footer.tagline")}</p>
        </div>

        <nav className="footer-column" aria-label={t("footer.platform")}>
          <h2 className="footer-heading">{t("footer.platform")}</h2>
          <ul className="footer-links">
            {platformLinks.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="footer-link">{item.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/informacao/contacto" className="footer-link">
                {t("footer.contact")}
                <span className="footer-contact-email">{SUPPORT_EMAIL}</span>
              </Link>
            </li>
          </ul>
        </nav>

        <nav className="footer-column" aria-label={t("footer.legal")}>
          <h2 className="footer-heading">{t("footer.legal")}</h2>
          <ul className="footer-links">
            {legalLinks.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="footer-link">{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>{t("footer.copyright", { year: new Date().getFullYear() })}</span>
      </div>
    </footer>
  );
}
