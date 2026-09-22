"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { useSession } from "@/components/SessionProvider";
import { Alert, Spinner } from "@/components/ui";

function LoginForm() {
  const { t, tError } = useI18n();
  const { refresh } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/conta";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      await refresh();
      router.replace(next.startsWith("/") ? next : "/conta");
      router.refresh();
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container form-narrow animate-in">
      <h1>{t("auth.login.title")}</h1>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t("auth.email")}</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("auth.password")}</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t("common.loading") : t("auth.login.submit")}
        </button>
      </form>
      <p className="muted">
        <Link href="/recuperar-senha">{t("auth.forgot.link")}</Link>
      </p>
      <p className="muted">
        {t("auth.login.noAccount")}{" "}
        <Link href="/registar">{t("auth.login.createAccount")}</Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="container form-narrow animate-in">
          <Spinner />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
