"use client";
/**
 * Presentational primitives. All text is passed in already translated, so these
 * stay free of i18n concerns.
 */
import type { BadgeTone } from "@/lib/ui";

export function Spinner({ label }: { label?: string }) {
  return (
    <p className="muted stream-status" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ?? "…"}
    </p>
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Badge({
  tone = "muted",
  plain = false,
  children,
}: {
  tone?: BadgeTone;
  plain?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}${plain ? " badge-plain" : ""}`}>{children}</span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  hover = false,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  hover?: boolean;
}) {
  const hasHead = Boolean(title || actions || subtitle);
  return (
    <section className={`card${hover ? " card-hover" : ""}`}>
      {hasHead && (
        <header className="card-head">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** KPI tile used across the dashboards. */
export function StatCard({
  label,
  value,
  hint,
  tone = "info",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "ok" | "warn" | "danger" | "info";
}) {
  return (
    <div className={`stat-card is-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="subtle">{hint}</span> : null}
    </div>
  );
}

/** Quota/consumption bar. Turns amber→red as the limit approaches. */
export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label?: React.ReactNode;
}) {
  const safeMax = max > 0 ? max : 1;
  const percent = Math.min(100, Math.round((value / safeMax) * 100));
  return (
    <div>
      <div className="usage-row">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
        <div
          className={`progress-bar${percent >= 80 ? " is-warn" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Animated ring used for the client's live position. */
export function PositionRing({
  value,
  total,
  label,
}: {
  value: number;
  total: number;
  label: React.ReactNode;
}) {
  const safeTotal = total > 0 ? total : 1;
  const percent = Math.max(4, Math.min(100, Math.round(((safeTotal - value + 1) / safeTotal) * 100)));
  return (
    <div className="ring" style={{ "--p": percent } as React.CSSProperties}>
      <span className="ring-inner">
        <span className="ring-value">{value}</span>
        <span className="ring-label">{label}</span>
      </span>
    </div>
  );
}

/** Live SSE indicator (dot + label). */
export function LiveStatus({
  state,
  liveLabel,
  connectingLabel,
  offlineLabel,
}: {
  state: "live" | "connecting" | "offline";
  liveLabel: string;
  connectingLabel: string;
  offlineLabel: string;
}) {
  const label =
    state === "live" ? liveLabel : state === "connecting" ? connectingLabel : offlineLabel;
  return (
    <span className="stream-status">
      <span
        className={`live-dot${state === "live" ? " is-live" : state === "connecting" ? " is-connecting" : ""}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name.trim().slice(0, 2)}
    </span>
  );
}

export function Person({ name, meta }: { name: string; meta?: string | null }) {
  return (
    <span className="person">
      <Avatar name={name} />
      <span>
        <strong>{name}</strong>
        {meta ? <span className="muted"> · {meta}</span> : null}
      </span>
    </span>
  );
}
