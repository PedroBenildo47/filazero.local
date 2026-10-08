"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { QrScanner, supportsQrScanning } from "@/components/QrScanner";
import { Alert, Badge, Card, EmptyState, Spinner } from "@/components/ui";
import { OrganizationLogo } from "@/components/OrganizationLogo";
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
  logoUrl: string | null;
  branches: PublicBranch[];
}
interface DirectoryResponse {
  items: PublicOrganization[];
  total: number;
}

/**
 * Extracts a queue reference (UUID or short public code) from a QR payload or a
 * pasted value: accepts a bare code, a bare id, or any URL containing
 * `/fila/<ref>`.
 */
function extractQueueRef(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const marker = value.indexOf("/fila/");
  if (marker !== -1) {
    const rest = value.slice(marker + "/fila/".length).split(/[?#]/)[0] ?? "";
    return rest.replace(/\/+$/, "") || null;
  }

  try {
    const url = new URL(value);
    const segment = url.pathname.split("/").filter(Boolean).pop();
    return segment ?? null;
  } catch {
    return value.split(/[?#]/)[0] ?? null;
  }
}

export default function SearchPage() {
  const { t, tError } = useI18n();
  const router = useRouter();

  // Directory search (Option B).
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // QR / code entry (Option A).
  const [code, setCode] = useState("");
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const canScan = supportsQrScanning();

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

  const resolveAndGo = useCallback(
    async (raw: string) => {
      const reference = extractQueueRef(raw);
      if (!reference) {
        setEntryError(t("entry.codeInvalid"));
        return;
      }
      setEntryBusy(true);
      setEntryError(null);
      try {
        const queue = await api<{ id: string }>(
          `/api/queues/${encodeURIComponent(reference)}`,
        );
        router.push(`/fila/${queue.id}`);
      } catch (caught) {
        setEntryError(tError(caught));
      } finally {
        setEntryBusy(false);
        setScanning(false);
      }
    },
    [router, t, tError],
  );

  return (
    <main className="container animate-in">
      <h1>{t("entry.heading")}</h1>
      <p className="muted">{t("entry.subtitle")}</p>

      <div className="entry-grid">
        <Card title={t("entry.qrTitle")}>
          <p className="muted">{t("entry.qrSubtitle")}</p>
          {entryError && <Alert kind="error">{entryError}</Alert>}

          {canScan && (
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={entryBusy}
              onClick={() => {
                setEntryError(null);
                setScanning(true);
              }}
            >
              {t("entry.scanButton")}
            </button>
          )}

          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void resolveAndGo(code);
            }}
          >
            <label className="field">
              <span>{t("entry.codeLabel")}</span>
              <input
                className="input"
                placeholder={t("entry.codePlaceholder")}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={entryBusy || !code.trim()}>
              {t("entry.codeSubmit")}
            </button>
          </form>

          {!canScan && <p className="subtle">{t("entry.scanUnsupported")}</p>}
        </Card>

        <Card title={t("entry.searchTitle")}>
          <p className="muted">{t("entry.searchSubtitle")}</p>
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
        </Card>
      </div>

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
                    <div className="row" style={{ alignItems: "center", gap: "0.75rem" }}>
                      <OrganizationLogo
                        logoUrl={organization.logoUrl}
                        name={organization.name}
                        size={44}
                      />
                      <h2 className="card-title">{organization.name}</h2>
                    </div>
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

      {scanning && (
        <div className="qr-overlay" onClick={() => setScanning(false)}>
          <div onClick={(event) => event.stopPropagation()}>
            <QrScanner onResult={(value) => void resolveAndGo(value)} onClose={() => setScanning(false)} />
          </div>
        </div>
      )}
    </main>
  );
}
