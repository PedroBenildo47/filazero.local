"use client";
import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";
import { informationContent, type InformationSection } from "@/lib/information-content";

const SUPPORT_EMAIL = "suporte@filazero.ao";

export function InformationPage({ section }: { section: InformationSection }) {
  const { lang, t } = useI18n();
  const content = informationContent[section][lang];

  return (
    <main className="container information-page animate-in">
      <div className="information-header">
        <p className="eyebrow">{t("information.eyebrow")}</p>
        <h1>{content.title}</h1>
        <p className="section-sub">{content.introduction}</p>
      </div>

      <div className="information-body">
        {content.sections.map((item) => (
          <section className="information-section" key={item.heading}>
            <h2>{item.heading}</h2>
            {item.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {item.bullets && (
              <ul>
                {item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            )}
          </section>
        ))}

        {section === "contacto" && (
          <section className="information-contact" aria-labelledby="support-email-heading">
            <h2 id="support-email-heading">{t("information.supportEmail")}</h2>
            <a className="information-email" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </section>
        )}
      </div>

      <div className="information-actions">
        <Link href="/indice" className="btn btn-ghost btn-sm">{t("information.backToIndex")}</Link>
        <Link href="/" className="btn btn-ghost btn-sm">{t("nav.home")}</Link>
      </div>
    </main>
  );
}
