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
import { useSession } from "./SessionProvider";
import { Avatar } from "./ui";

/** Where each signed-in role lands from the public header. */
function panelHref(role: string): string {
  if (role === "ADMINISTRATOR") return "/admin";
  if (role === "MANAGER") return "/gestor";
  if (role === "STAFF") return "/staff";
  return "/conta";
}

export function MarketingHeader() {
  const { t } = useI18n();
  const { user, loading, logout } = useSession();

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
          {loading ? null : user ? (
            <>
              <span className="nav-user" title={user.email}>
                <Avatar name={user.name} />
                {user.name}
              </span>
              <Link href={panelHref(user.role)} className="btn btn-accent">
                {t("landing.goToPanel")}
              </Link>
              <button
                type="button"
                className="btn btn-outline-light"
                onClick={() => void logout()}
              >
                {t("nav.logout")}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-outline-light">
                {t("landing.enterCustomer")}
              </Link>
              <Link href="/registar-organizacao" className="btn btn-accent">
                {t("landing.registerCompany")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
