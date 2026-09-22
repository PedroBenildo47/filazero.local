"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { Alert, Badge, EmptyState, Spinner } from "@/components/ui";
import { queueStatusKey, statusTone } from "@/lib/ui";

interface Queue {
  id: string;
  name: string;
  description: string | null;
  status: string;
}
interface Branch {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  queues: Queue[];
}
interface Organization {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  branches: Branch[];
}

export function OrganizationView({ organizationId }: { organizationId: string }) {
  const { t, tError } = useI18n();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api<Organization>(
          `/api/public/organizations/${organizationId}`,
        );
        if (active) setOrganization(result);
      } catch (caught) {
        if (active) setError(tError(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, tError]);

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  if (error || !organization) {
    return (
      <main className="container">
        <Alert kind="error">{error ?? t("org.notFound")}</Alert>
        <p>
          <Link href="/pesquisar" className="btn btn-ghost">
            {t("common.back")}
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="container">
      <p>
        <Link href="/pesquisar" className="muted">
          ← {t("nav.search")}
        </Link>
      </p>
      <h1>{organization.name}</h1>
      <p className="muted">
        {[organization.category, organization.city, organization.country]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {organization.description && <p>{organization.description}</p>}
      {organization.address && (
        <p className="muted">
          {t("org.address")}: {organization.address}
        </p>
      )}

      <h2>{t("org.branches")}</h2>
      {organization.branches.length === 0 ? (
        <EmptyState>{t("org.noBranches")}</EmptyState>
      ) : (
        <div className="stack">
          {organization.branches.map((branch) => (
            <section key={branch.id} className="card card-hover animate-in">
              <header className="card-head">
                <h3 className="card-title">{branch.name}</h3>
                <span className="muted">{branch.city ?? ""}</span>
              </header>
              {branch.queues.length === 0 ? (
                <EmptyState>{t("org.noQueues")}</EmptyState>
              ) : (
                <ul className="queue-list">
                  {branch.queues.map((queue) => (
                    <li key={queue.id} className="queue-row">
                      <span>
                        <strong>{queue.name}</strong>{" "}
                        <Badge tone={statusTone(queue.status)}>
                          {t(queueStatusKey(queue.status))}
                        </Badge>
                      </span>
                      <Link href={`/fila/${queue.id}`} className="btn btn-primary btn-sm">
                        {t("org.enter")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
