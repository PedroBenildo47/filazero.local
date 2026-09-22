"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { useSession } from "@/components/SessionProvider";
import { Alert } from "@/components/ui";

export default function RegisterPage() {
  const { t, tError } = useI18n();
  const { refresh } = useSession();
  const router = useRouter();

  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", {
        method: "POST",
        json: {
          name: form.name,
          email: form.email,
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          password: form.password,
        },
      });
      await refresh();
      router.replace("/conta");
      router.refresh();
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container form-narrow animate-in">
      <h1>{t("auth.register.title")}</h1>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t("auth.name")}</span>
          <input
            className="input"
            required
            minLength={2}
            maxLength={160}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("auth.email")}</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </label>
        <label className="field">
          <span>
            {t("auth.phone")} <em className="muted">({t("common.optional")})</em>
          </span>
          <input
            className="input"
            type="tel"
            value={form.phone}
            onChange={(event) => update("phone", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("auth.password")}</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
          />
          <small className="muted">{t("auth.passwordHint")}</small>
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t("common.loading") : t("auth.register.submit")}
        </button>
      </form>
      <p className="muted">
        {t("auth.register.hasAccount")} <Link href="/login">{t("auth.register.signIn")}</Link>
      </p>
    </main>
  );
}
