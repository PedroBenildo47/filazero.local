"use client";
/**
 * Public marketing header for the landing page.
 *
 * Separate from the in-app `Nav` (which follows the session role): the landing
 * header is institutional — anchors to the page sections, a customer entry point
 * and the highlighted "Register Company" call to action.
 */
import Link from "next/link";
import { useI18n } from "./LanguageProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function MarketingHeader() {
  const { t } = useI18n();

  return (
    <header className="mkt-header">
      <div className="mkt-header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          {t("app.name")}
        </Link>

        <nav className="mkt-links" aria-label={t("landing.navPlans")}>
          <a href="#como-funciona">{t("landing.navHow")}</a>
          <a href="#para-empresas">{t("landing.navBusiness")}</a>
          <a href="#planos">{t("landing.navPlans")}</a>
        </nav>

        <div className="mkt-actions">
          <LanguageSwitcher />
          <Link href="/login" className="btn btn-ghost">
            {t("landing.enterCustomer")}
          </Link>
          <Link href="/registar-organizacao" className="btn btn-primary">
            {t("landing.registerCompany")}
          </Link>
        </div>
      </div>
    </header>
  );
}
