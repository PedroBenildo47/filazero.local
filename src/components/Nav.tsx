"use client";
/**
 * Top navigation. Links follow the session role — the backend still enforces
 * every permission.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { useSession } from "./SessionProvider";
import { Avatar } from "./ui";

export function Nav() {
  const { user, logout, loading } = useSession();
  const { t } = useI18n();
  const pathname = usePathname();

  const isStaff =
    user?.role === "STAFF" || user?.role === "MANAGER" || user?.role === "ADMINISTRATOR";
  const isManager = user?.role === "MANAGER" || user?.role === "ADMINISTRATOR";
  const isAdmin = user?.role === "ADMINISTRATOR";

  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className={`nav-link${pathname === href ? " is-active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          {t("app.name")}
        </Link>

        <div className="nav-links">
          {link("/", t("nav.home"))}
          {link("/pesquisar", t("nav.search"))}
          {user && link("/conta", t("nav.account"))}
          {isStaff && link("/staff", t("nav.staff"))}
          {isManager && link("/gestor", t("nav.manage"))}
          {isAdmin && link("/admin", t("nav.admin"))}
        </div>

        <div className="nav-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
          {loading ? null : user ? (
            <>
              <span className="nav-user" title={user.email}>
                <Avatar name={user.name} />
                {user.name}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
                {t("nav.logout")}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                {t("nav.login")}
              </Link>
              <Link href="/registar" className="btn btn-primary btn-sm">
                {t("nav.register")}
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
