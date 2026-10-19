"use client";
/**
 * Hero mockup — a live queue board.
 *
 * A pure CSS/JSX illustration of the product's real-time panel: the ticket being
 * served, the counters and the waiting list, rendered with translucent cards and
 * active-service indicators. It is decorative marketing art (aria-hidden) — it
 * does not read or write any real queue.
 */
import { useEffect, useState } from "react";
import { useI18n } from "./LanguageProvider";

/** Waiting tickets shown in the illustration (newest last). */
const WAITING = [
  { code: "A-015", wait: 3 },
  { code: "A-016", wait: 6 },
  { code: "A-017", wait: 9 },
];

export function QueueMockup() {
  const { t } = useI18n();
  const [now, setNow] = useState<string>("");

  // A real clock makes the panel feel alive without inventing queue data.
  useEffect(() => {
    const render = () =>
      setNow(
        new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }),
      );
    render();
    const id = window.setInterval(render, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="queue-mock" role="img" aria-label={t("landing.mockAlt")}>
      <div className="queue-mock-glow" aria-hidden="true" />

      <header className="queue-mock-head">
        <div className="queue-mock-org">
          <span className="queue-mock-logo" aria-hidden="true">
            F
          </span>
          <div>
            <strong>{t("landing.mockQueueName")}</strong>
            <span>{t("landing.mockBranch")}</span>
          </div>
        </div>
        <div className="queue-mock-live">
          <span className="queue-mock-pulse" aria-hidden="true" />
          {t("landing.mockLive")}
          <span className="queue-mock-clock">{now}</span>
        </div>
      </header>

      <div className="queue-mock-now">
        <span className="queue-mock-label">{t("landing.mockNow")}</span>
        <div className="queue-mock-ticket">
          <strong>A-014</strong>
          <span className="queue-mock-counter">{t("landing.mockCounter", { n: 3 })}</span>
        </div>
        <div className="queue-mock-bar" aria-hidden="true">
          <span />
        </div>
      </div>

      <div className="queue-mock-waiting">
        <div className="queue-mock-waiting-head">
          <span className="queue-mock-label">{t("landing.mockWaiting")}</span>
          <span className="queue-mock-count">{WAITING.length}</span>
        </div>
        <ul>
          {WAITING.map((ticket, index) => (
            <li key={ticket.code} style={{ animationDelay: `${index * 160}ms` }}>
              <span className="queue-mock-code">{ticket.code}</span>
              <span className="queue-mock-dots" aria-hidden="true" />
              <span className="queue-mock-wait">
                {t("landing.mockMinutes", { n: ticket.wait })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <footer className="queue-mock-foot">
        <div>
          <span className="queue-mock-label">{t("landing.mockEstimate")}</span>
          <strong>~12 min</strong>
        </div>
        <div className="queue-mock-avatars" aria-hidden="true">
          <span>A</span>
          <span>B</span>
          <span>C</span>
        </div>
      </footer>
    </div>
  );
}
