"use client";
/**
 * Client-side route guard.
 *
 * This is a UX convenience only — every API call is authorised server-side.
 * Unauthenticated visitors are redirected to `/login?next=<path>`.
 */
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { useI18n } from "./LanguageProvider";
import { useSession } from "./SessionProvider";
import { Alert, Spinner } from "./ui";

export function RequireAuth({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: UserRole[];
}) {
  const { user, loading, error, refresh } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only bounce to login when we positively know the visitor is signed out —
    // never when the API is merely unreachable.
    if (!loading && !user && !error) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, error, router, pathname]);

  if (error && !user) {
    return (
      <main className="container">
        <div className="error-state">
          <Alert kind="error">{error}</Alert>
          <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
            {t("common.retry")}
          </button>
        </div>
      </main>
    );
  }

  if (loading || !user) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <main className="container">
        <Alert kind="error">{t("errors.FORBIDDEN")}</Alert>
      </main>
    );
  }

  return <>{children}</>;
}
