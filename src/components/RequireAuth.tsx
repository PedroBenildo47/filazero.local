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
  const { user, loading } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

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
