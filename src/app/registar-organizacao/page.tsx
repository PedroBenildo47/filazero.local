"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { useSession } from "@/components/SessionProvider";
import { Alert } from "@/components/ui";

type DocumentType =
  | "COMPANY_REGISTRATION"
  | "TAX_REGISTRATION"
  | "BANKING_LICENSE"
  | "REGULATOR_AUTHORIZATION";

const STANDARD_DOCUMENTS: DocumentType[] = ["COMPANY_REGISTRATION", "TAX_REGISTRATION"];
const FINANCIAL_DOCUMENTS: DocumentType[] = ["BANKING_LICENSE", "REGULATOR_AUTHORIZATION"];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

const DOCUMENT_LABEL_KEYS = {
  COMPANY_REGISTRATION: "organizationRegister.documentCompany",
  TAX_REGISTRATION: "organizationRegister.documentTax",
  BANKING_LICENSE: "organizationRegister.documentBankingLicense",
  REGULATOR_AUTHORIZATION: "organizationRegister.documentRegulator",
} as const satisfies Record<DocumentType, string>;

function isFinancialSector(category: string): boolean {
  const normalized = category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return (
    normalized.includes("banco") ||
    normalized.includes("instituicao financeira") ||
    normalized.includes("instituicoes financeiras")
  );
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function OrganizationRegistrationPage() {
  const { t, tError } = useI18n();
  const { refresh } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    password: "",
    organizationName: "",
    category: "",
    description: "",
    address: "",
    city: "",
    country: "Angola",
    organizationPhone: "",
    organizationEmail: "",
  });
  const [files, setFiles] = useState<Partial<Record<DocumentType, File>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planCode, setPlanCode] = useState<string | null>(null);

  // The landing page links here with `?plan=<code>`; once the company is
  // registered we continue to the public checkout for that plan.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("plan");
    if (code) setPlanCode(code);
  }, []);

  const financialSector = isFinancialSector(form.category);
  const requiredDocuments = financialSector
    ? [...STANDARD_DOCUMENTS, ...FINANCIAL_DOCUMENTS]
    : STANDARD_DOCUMENTS;

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function selectCategory(category: string) {
    setForm((previous) => ({ ...previous, category }));
    if (!isFinancialSector(category)) {
      setFiles((previous) => {
        const next = { ...previous };
        delete next.BANKING_LICENSE;
        delete next.REGULATOR_AUTHORIZATION;
        return next;
      });
    }
  }

  function selectFile(type: DocumentType, file?: File) {
    setError(null);
    if (!file) {
      setFiles((previous) => ({ ...previous, [type]: undefined }));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t("organizationRegister.fileTooLarge", { size: formatFileSize(MAX_FILE_BYTES) }));
      return;
    }
    if (file.type && !ACCEPTED_FILE_TYPES.includes(file.type)) {
      setError(t("organizationRegister.fileTypeError"));
      return;
    }
    setFiles((previous) => ({ ...previous, [type]: file }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const missingDocument = requiredDocuments.find((type) => !files[type]);
    if (missingDocument) {
      setError(t("organizationRegister.missingDocument", { document: t(DOCUMENT_LABEL_KEYS[missingDocument]) }));
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) body.set(key, value);
      for (const type of requiredDocuments) body.append(`document.${type}`, files[type]!);

      await api("/api/public/organizations/register", { method: "POST", formData: body });
      await refresh();
      router.replace(
      planCode ? `/checkout?plan=${encodeURIComponent(planCode)}` : "/gestor",
    );
      router.refresh();
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container form-wide animate-in">
      <div className="section-head">
        <div>
          <p className="eyebrow">{t("organizationRegister.eyebrow")}</p>
          <h1>{t("organizationRegister.title")}</h1>
          <p className="section-sub">{t("organizationRegister.subtitle")}</p>
        </div>
        <Link href="/" className="btn btn-ghost btn-sm">
          {t("common.back")}
        </Link>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <form onSubmit={submit} className="form organization-form">
        <section className="form-section" aria-labelledby="org-details-heading">
          <h2 id="org-details-heading">{t("organizationRegister.organizationSection")}</h2>
          <div className="grid form-grid">
            <label className="field">
              <span>{t("organizationRegister.organizationName")}</span>
              <input className="input" required minLength={2} maxLength={200} value={form.organizationName} onChange={(event) => update("organizationName", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.category")}</span>
              <select className="input" required value={form.category} onChange={(event) => selectCategory(event.target.value)}>
                <option value="">{t("organizationRegister.chooseCategory")}</option>
                <option value="Comércio">{t("organizationRegister.sectorCommerce")}</option>
                <option value="Saúde">{t("organizationRegister.sectorHealth")}</option>
                <option value="Educação">{t("organizationRegister.sectorEducation")}</option>
                <option value="Serviços">{t("organizationRegister.sectorServices")}</option>
                <option value="Banco">{t("organizationRegister.sectorBank")}</option>
                <option value="Instituição Financeira">{t("organizationRegister.sectorFinancialInstitution")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("organizationRegister.organizationEmail")}</span>
              <input className="input" type="email" maxLength={255} value={form.organizationEmail} onChange={(event) => update("organizationEmail", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.organizationPhone")}</span>
              <input className="input" type="tel" value={form.organizationPhone} onChange={(event) => update("organizationPhone", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.address")}</span>
              <input className="input" maxLength={255} value={form.address} onChange={(event) => update("address", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.city")}</span>
              <input className="input" maxLength={120} value={form.city} onChange={(event) => update("city", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.country")}</span>
              <input className="input" maxLength={120} value={form.country} onChange={(event) => update("country", event.target.value)} />
            </label>
            <label className="field form-field-wide">
              <span>{t("organizationRegister.description")}</span>
              <textarea className="input textarea" maxLength={2000} rows={3} value={form.description} onChange={(event) => update("description", event.target.value)} />
            </label>
          </div>
        </section>

        <section className="form-section" aria-labelledby="owner-heading">
          <h2 id="owner-heading">{t("organizationRegister.ownerSection")}</h2>
          <div className="grid form-grid">
            <label className="field">
              <span>{t("organizationRegister.ownerName")}</span>
              <input className="input" required minLength={2} maxLength={160} autoComplete="name" value={form.ownerName} onChange={(event) => update("ownerName", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.ownerEmail")}</span>
              <input className="input" type="email" autoComplete="email" required value={form.ownerEmail} onChange={(event) => update("ownerEmail", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("organizationRegister.ownerPhone")}</span>
              <input className="input" type="tel" autoComplete="tel" value={form.ownerPhone} onChange={(event) => update("ownerPhone", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("auth.password")}</span>
              <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={(event) => update("password", event.target.value)} />
              <small className="muted">{t("auth.passwordHint")}</small>
            </label>
          </div>
        </section>

        <section className="form-section" aria-labelledby="documents-heading">
          <h2 id="documents-heading">{t("organizationRegister.documentsSection")}</h2>
          <p className="muted">{financialSector ? t("organizationRegister.financialDocumentHint") : t("organizationRegister.standardDocumentHint")}</p>
          <div className="grid form-grid document-grid">
            {requiredDocuments.map((type) => (
              <label className="field upload-field" key={type}>
                <span>{t(DOCUMENT_LABEL_KEYS[type])} <strong aria-hidden="true">*</strong></span>
                <input
                  className="input file-input"
                  type="file"
                  required
                  accept={FILE_ACCEPT}
                  onChange={(event) => selectFile(type, event.currentTarget.files?.[0])}
                />
                <small className="muted">
                  {files[type]
                    ? `${files[type]!.name} · ${formatFileSize(files[type]!.size)}`
                    : t("organizationRegister.fileHint", { size: formatFileSize(MAX_FILE_BYTES) })}
                </small>
              </label>
            ))}
          </div>
        </section>

        <div className="row form-submit-row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? t("common.loading") : t("organizationRegister.submit")}
          </button>
          <span className="muted">{t("organizationRegister.requiredNote")}</span>
        </div>
      </form>
    </main>
  );
}
