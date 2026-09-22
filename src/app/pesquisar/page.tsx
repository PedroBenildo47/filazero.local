"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { Alert, Badge, EmptyState, Spinner } from "@/components/ui";
import { queueStatusKey, statusTone } from "@/lib/ui";

interface PublicQueue {
  id: string;
  name: string;
  status: string;
}
interface PublicBranch {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  queues: PublicQueue[];
}
interface PublicOrganization {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  branches: PublicBranch[];
}
interface DirectoryResponse {
  items: PublicOrganization[];
  total: number;
}

export default function SearchPage() {
  const { t, tError } = useI18n();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (search: string, searchCity: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("q", search.trim());
        if (searchCity.trim()) params.set("city", searchCity.trim());
        const suffix = params.toString() ? `?${params.toString()}` : "";
        setData(await api<DirectoryResponse>(`/api/public/organizations${suffix}`));
      } catch (caught) {
        setError(tError(caught));
      } finally {
        setLoading(false);
      }
    },
    [tError],
  );

  useEffect(() => {
    void load("", "");
  }, [load]);

  return (
    <main className="container animate-in">
      <h1>{t("search.title")}</h1>
      <p className="muted">{t("search.subtitle")}</p>

      <form
        className="row form-inline"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query, city);
        }}
      >
        <input
          className="input"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <input
          className="input"
          placeholder={t("search.cityPlaceholder")}
          value={city}
          onChange={(event) => setCity(event.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          {t("common.search")}
        </button>
      </form>

      {error && <Alert kind="error">{error}</Alert>}
      {loading && <Spinner label={t("common.loading")} />}

      {!loading && data && (
        <>
          <p className="muted">{t("search.results", { count: data.total })}</p>
          {data.items.length === 0 ? (
            <EmptyState>{t("search.empty")}</EmptyState>
          ) : (
            <div className="stack">
              {data.items.map((organization) => (
                <article key={organization.id} className="card card-hover animate-in">
                  <header className="card-head">
                    <h2 className="card-title">{organization.name}</h2>
                    <Link
                      href={`/estabelecimento/${organization.id}`}
                      className="btn btn-ghost"
                    >
                      {t("search.view")}
                    </Link>
                  </header>
                  <p className="muted">
                    {[organization.category, organization.city]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <ul className="queue-list">
                    {organization.branches.map((branch) => (
                      <li key={branch.id}>
                        <strong>{branch.name}</strong>
                        {branch.city ? <span className="muted"> · {branch.city}</span> : null}
                        <ul className="queue-sublist">
                          {branch.queues.length === 0 ? (
                            <li className="muted">{t("org.noQueues")}</li>
                          ) : (
                            branch.queues.map((queue) => (
                              <li key={queue.id}>
                                <Link href={`/fila/${queue.id}`}>{queue.name}</Link>{" "}
                                <Badge tone={statusTone(queue.status)}>
                                  {t(queueStatusKey(queue.status))}
                                </Badge>
                              </li>
                            ))
                          )}
                        </ul>
                      </li>
                    ))}
                    {organization.branches.length === 0 && (
                      <li className="muted">{t("org.noBranches")}</li>
                    )}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
