"use client";
/**
 * Light/dark switch. Persistence lives in `ThemeProvider`.
 */
import { useI18n } from "./LanguageProvider";
import { useTheme, type Theme } from "./ThemeProvider";

function Icon({ theme }: { theme: Theme }) {
  if (theme === "dark") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeSwitcher() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-btn"
      onClick={toggle}
      aria-label={t(nextTheme === "dark" ? "theme.toDark" : "theme.toLight")}
      title={t(nextTheme === "dark" ? "theme.toDark" : "theme.toLight")}
    >
      <Icon theme={nextTheme} />
    </button>
  );
}
