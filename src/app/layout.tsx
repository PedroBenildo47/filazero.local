import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import { SessionProvider } from "@/components/SessionProvider";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/ThemeProvider";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "FilaZero — filas sem confusão",
  description:
    "FilaZero — encontre estabelecimentos, entre numa fila e acompanhe a sua posição em tempo real.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning`: both `lang` and `data-theme` are set on the
    // client from the persisted choices.
    <html lang="pt" data-theme="light" suppressHydrationWarning>
      <body>
        {/* Blocking, before paint: avoids a flash of the wrong theme. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>
          <LanguageProvider>
            <SessionProvider>
              <Nav />
              {children}
              <footer className="footer">
                <div className="footer-inner">
                  <span>FilaZero</span>
                  <span>PostgreSQL · Next.js · SSE</span>
                </div>
              </footer>
            </SessionProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
