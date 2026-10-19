"use client";
/**
 * Public marketing header.
 *
 * Minimal, corporate: the brand on the left and the two primary actions on the
 * right ("Entrar" / "Criar conta grátis"). The in-app `Nav` handles the signed-in
 * surfaces; this one is institutional only.
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
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8.5" r="2.1" />
              <path d="M4 16c0-1.9 1.8-3.2 4-3.2s4 1.3 4 3.2" />
              <circle cx="16.5" cy="8.5" r="2.1" />
              <path d="M13.5 16c0-1.9 1.5-3.2 3.5-3.2s3 1.3 3 3.2" />
            </svg>
          </span>
          {t("app.name")}
        </Link>

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
              <Link href="/login" className="btn btn-ghost mkt-login">
                {t("nav.login")}
              </Link>
              <Link href="/registar" className="btn btn-accent">
                {t("landing.createAccountFree")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
