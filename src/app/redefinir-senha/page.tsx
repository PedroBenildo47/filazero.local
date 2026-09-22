"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { Alert, Spinner } from "@/components/ui";

function ResetForm() {
  const { t, tError } = useI18n();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/password/reset", {
        method: "POST",
        json: { token, password },
      });
      setDone(true);
      router.replace("/login");
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="container form-narrow animate-in">
        <Alert kind="error">{t("auth.reset.invalidToken")}</Alert>
        <p>
          <Link href="/recuperar-senha" className="btn btn-ghost">
            {t("auth.forgot.title")}
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="container form-narrow animate-in">
      <h1>{t("auth.reset.title")}</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {done && <Alert kind="success">{t("auth.reset.done")}</Alert>}

      {!done && (
        <form onSubmit={submit} className="form">
          <label className="field">
            <span>{t("auth.reset.newPassword")}</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small className="muted">{t("auth.passwordHint")}</small>
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t("common.loading") : t("auth.reset.submit")}
          </button>
        </form>
      )}
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="container form-narrow animate-in">
          <Spinner />
        </main>
      }
    >
      <ResetForm />
    </Suspense>
  );
}
