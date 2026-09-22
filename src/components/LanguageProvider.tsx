"use client";
/**
 * Language provider (PT/EN).
 *
 * Persistence: `localStorage` (primary) + a `filazero_lang` cookie (so a future
 * server-rendered shell could honour it). Initial value falls back to the
 * browser language, defaulting to Portuguese.
 *
 * The backend is untouched: API errors arrive as stable codes and are mapped to
 * localised messages here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LANG,
  LANG_COOKIE,
  LANG_STORAGE_KEY,
  isErrorCode,
  isLang,
  localeTag,
  translate,
  type Lang,
  type MessageKey,
} from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Turns any thrown value into a localised message. */
  tError: (error: unknown) => string;
  formatDateTime: (value: string | Date | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookie(name: string): string | null {
  const entry = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split("=").slice(1).join("=")) : null;
}

function detectLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // localStorage can be unavailable (private mode); fall through.
  }

  const cookie = readCookie(LANG_COOKIE);
  if (isLang(cookie)) return cookie;

  const browser = window.navigator.language?.toLowerCase() ?? "";
  return browser.startsWith("en") ? "en" : DEFAULT_LANG;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLangState(detectLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the in-memory choice still applies.
    }
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      tError: (error) => {
        if (error instanceof ApiError && isErrorCode(error.code)) {
          return translate(lang, `errors.${error.code}` as MessageKey);
        }
        if (error instanceof TypeError) {
          return translate(lang, "errors.NETWORK");
        }
        return translate(lang, "errors.INTERNAL");
      },
      formatDateTime: (input) => {
        if (!input) return "—";
        const date = typeof input === "string" ? new Date(input) : input;
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat(localeTag(lang), {
          dateStyle: "short",
          timeStyle: "short",
        }).format(date);
      },
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside <LanguageProvider>");
  }
  return context;
}
