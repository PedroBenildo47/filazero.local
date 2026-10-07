"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Spinner, StatCard } from "@/components/ui";

interface PlatformMetrics {
  organizations: {
    total: number;
    active: number;
    suspended: number;
    inactive: number;
  };
  users: { total: number; active: number };
}

function AdminDashboard() {
  const { t, tError } = useI18n();
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<PlatformMetrics>("/api/admin/metrics")
      .then((result) => {
        if (active) setMetrics(result);
      })
      .catch((caught) => {
        if (active) setError(tError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tError]);

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  return (
    <main className="container animate-in">
      <h1>{t("admin.title")}</h1>
      <p className="muted">{t("admin.subtitle")}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {metrics && (
        <div className="kpi-grid">
          <StatCard label={t("admin.organizations")} value={metrics.organizations.total} tone="info" />
          <StatCard label={t("admin.orgStatus.ACTIVE")} value={metrics.organizations.active} tone="ok" />
          <StatCard label={t("admin.orgStatus.SUSPENDED")} value={metrics.organizations.suspended} tone="warn" />
          <StatCard label={t("admin.orgStatus.INACTIVE")} value={metrics.organizations.inactive} tone="info" />
          <StatCard label={t("admin.usersTotal")} value={metrics.users.total} tone="info" />
          <StatCard label={t("admin.usersActive")} value={metrics.users.active} tone="ok" />
        </div>
      )}
    </main>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth roles={["ADMINISTRATOR"]}>
      <AdminDashboard />
    </RequireAuth>
  );
}
