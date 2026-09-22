"use client";
/**
 * PT/EN language selector. The choice is persisted by `LanguageProvider`.
 */
import { LANGS, type Lang } from "@/lib/i18n";
import { useI18n } from "./LanguageProvider";

const LABELS: Record<Lang, string> = { pt: "PT", en: "EN" };

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="lang-switch" role="group" aria-label={t("nav.language")}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-btn${code === lang ? " is-active" : ""}`}
          aria-pressed={code === lang}
          onClick={() => setLang(code)}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
