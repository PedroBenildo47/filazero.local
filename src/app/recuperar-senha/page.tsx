"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { Alert } from "@/components/ui";

interface ForgotResponse {
  accepted: boolean;
  delivered?: boolean;
  resetToken?: string;
}

export default function ForgotPasswordPage() {
  const { t, tError } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<ForgotResponse>("/api/auth/password/forgot", {
        method: "POST",
        json: { email },
      });
      setSent(true);
      // Only present when SMTP is not configured (development/testing).
      setDevToken(result.resetToken ?? null);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container form-narrow animate-in">
      <h1>{t("auth.forgot.title")}</h1>
      <p className="muted">{t("auth.forgot.hint")}</p>

      {error && <Alert kind="error">{error}</Alert>}
      {sent && <Alert kind="success">{t("auth.forgot.sent")}</Alert>}
      {sent && devToken && (
        <Alert kind="info">
          {t("auth.forgot.devLink")}{" "}
          <Link href={`/redefinir-senha?token=${encodeURIComponent(devToken)}`}>
            /redefinir-senha
          </Link>
        </Alert>
      )}

      {!sent && (
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
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t("common.loading") : t("auth.forgot.submit")}
          </button>
        </form>
      )}

      <p className="muted">
        <Link href="/login">{t("auth.login.submit")}</Link>
      </p>
    </main>
  );
}
