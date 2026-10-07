"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { useQueueStream } from "@/components/useQueueStream";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LiveStatus,
  PositionRing,
  Spinner,
  StatCard,
} from "@/components/ui";
import { notificationTypeKey, statusTone, ticketStatusKey } from "@/lib/ui";

interface Ticket {
  id: string;
  queueId: string;
  ticketNumber: number;
  status: string;
  position: number | null;
  joinedAt: string;
}
interface ActiveTicket {
  ticket: Ticket;
  waitingCount: number;
  queue: { id: string; name: string; status: string };
  branch: { id: string; name: string; city: string | null };
  organization: { id: string; name: string; category: string | null };
}
interface HistoryItem extends Ticket {
  queue: {
    id: string;
    name: string;
    branch: { id: string; name: string; city: string | null };
    organization: { id: string; name: string };
  };
}
interface MyTickets {
  active: ActiveTicket | null;
  history: { items: HistoryItem[]; total: number };
}
interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}
interface NotificationsResponse {
  items: Notification[];
  unread: number;
}
interface NotificationPreferences {
  phone: string | null;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  smsConfigured: boolean;
  whatsappConfigured: boolean;
}

function AccountDashboard() {
  const { t, tError, formatDateTime } = useI18n();
  const [data, setData] = useState<MyTickets | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tickets, notes, preferences] = await Promise.all([
        api<MyTickets>("/api/tickets/me"),
        api<NotificationsResponse>("/api/notifications?pageSize=20"),
        api<NotificationPreferences>("/api/notifications/preferences"),
      ]);
      setData(tickets);
      setNotifications(notes);
      setPrefs(preferences);
      setPhoneDraft((current) => (current.length === 0 ? preferences.phone ?? "" : current));
      setError(null);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setLoading(false);
    }
  }, [tError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const streamStatus = useQueueStream(data?.active?.ticket.queueId ?? null, () => {
    void refresh();
  });

  async function leave() {
    if (!data?.active) return;
    if (!window.confirm(t("account.leaveConfirm"))) return;
    try {
      await api(`/api/tickets/${data.active.ticket.id}/leave`, { method: "POST" });
      await refresh();
    } catch (caught) {
      setError(tError(caught));
    }
  }

  async function savePreferences(next: Partial<NotificationPreferences>) {
    setPrefsSaving(true);
    setPrefsSaved(false);
    try {
      const updated = await api<NotificationPreferences>("/api/notifications/preferences", {
        method: "PATCH",
        json: next,
      });
      setPrefs(updated);
      setPhoneDraft(updated.phone ?? "");
      setPrefsSaved(true);
      setError(null);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setPrefsSaving(false);
    }
  }

  async function markAllRead() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      await refresh();
    } catch (caught) {
      setError(tError(caught));
    }
  }

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  const active = data?.active ?? null;
  const history = data?.history.items ?? [];

  return (
    <main className="container">
      <div className="section-head">
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>
            {t("account.title")}
          </h1>
        </div>
        {active ? (
          <LiveStatus
            state={streamStatus}
            liveLabel={t("realtime.live")}
            connectingLabel={t("realtime.connecting")}
            offlineLabel={t("realtime.offline")}
          />
        ) : null}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {!active ? (
        <Card hover>
          <EmptyState>{t("account.noActive")}</EmptyState>
          <p className="muted">{t("account.noActiveHint")}</p>
          <Link href="/pesquisar" className="btn btn-primary">
            {t("account.searchNow")}
          </Link>
        </Card>
      ) : (
        <Card
          title={t("account.activeTicket")}
          subtitle={`${active.organization.name} · ${active.branch.name}`}
        >
          <div className="ticket-hero">
            <div>
              <span className="stat-label">
                {t("account.ticketNumber", { number: active.ticket.ticketNumber })}
              </span>
              <span className="ticket-number">#{active.ticket.ticketNumber}</span>
              <div style={{ marginTop: "0.5rem" }}>
                <Badge tone={statusTone(active.ticket.status)}>
                  {t(ticketStatusKey(active.ticket.status))}
                </Badge>
              </div>
            </div>

            {active.ticket.status === "WAITING" && active.ticket.position != null ? (
              <PositionRing
                value={active.ticket.position}
                total={Math.max(active.waitingCount, active.ticket.position)}
                label={t("staff.position")}
              />
            ) : null}
          </div>

          <div className="kpi-grid">
            <StatCard
              label={t("staff.position")}
              value={active.ticket.position ?? "—"}
              hint={
                active.ticket.position != null
                  ? t("account.waitingAhead", {
                      count: Math.max(0, active.ticket.position - 1),
                    })
                  : undefined
              }
              tone="info"
            />
            <StatCard
              label={t("staff.countWaiting")}
              value={active.waitingCount}
              tone="warn"
            />
            <StatCard
              label={t("queue.branch")}
              value={active.branch.city ?? active.branch.name}
              tone="ok"
            />
          </div>

          <p className="subtle">
            {t("account.joinedAt", { time: formatDateTime(active.ticket.joinedAt) })}
          </p>

          <div className="row">
            <Link href={`/fila/${active.queue.id}`} className="btn btn-ghost">
              {t("account.viewQueue")}
            </Link>
            {active.ticket.status === "WAITING" ? (
              <button type="button" className="btn btn-danger" onClick={() => void leave()}>
                {t("account.leave")}
              </button>
            ) : null}
          </div>
        </Card>
      )}

      <Card
        title={t("account.notifications")}
        subtitle={
          notifications?.unread
            ? t("account.unread", { count: notifications.unread })
            : undefined
        }
        actions={
          notifications && notifications.unread > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void markAllRead()}
            >
              {t("account.markAllRead")}
            </button>
          ) : null
        }
      >
        {!notifications || notifications.items.length === 0 ? (
          <EmptyState>{t("account.notificationsEmpty")}</EmptyState>
        ) : (
          <ul className="notif-list">
            {notifications.items.map((notification) => (
              <li key={notification.id} className={notification.read ? "is-read" : ""}>
                <div className="notif-head">
                  <strong>{t(notificationTypeKey(notification.type))}</strong>
                  <span className="subtle">{formatDateTime(notification.createdAt)}</span>
                </div>
                <p>{notification.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("account.prefsTitle")} subtitle={t("account.prefsSubtitle")}>
        <div className="field">
          <span>{t("account.prefsPhone")}</span>
          <input
            className="input"
            value={phoneDraft}
            onChange={(event) => setPhoneDraft(event.target.value)}
            placeholder="+244 9xx xxx xxx"
            inputMode="tel"
            autoComplete="tel"
          />
          <span className="subtle">{t("account.prefsPhoneHint")}</span>
        </div>
        <div className="row">
          <button
            type="button"
            className={`btn ${prefs?.whatsappOptIn ? "btn-primary" : "btn-ghost"}`}
            disabled={prefsSaving}
            onClick={() => void savePreferences({ whatsappOptIn: !prefs?.whatsappOptIn })}
          >
            {t("account.prefsWhatsapp")}
            {prefs && !prefs.whatsappConfigured
              ? ` — ${t("account.prefsNotConfigured")}`
              : ""}
          </button>
          <button
            type="button"
            className={`btn ${prefs?.smsOptIn ? "btn-primary" : "btn-ghost"}`}
            disabled={prefsSaving}
            onClick={() => void savePreferences({ smsOptIn: !prefs?.smsOptIn })}
          >
            {t("account.prefsSms")}
            {prefs && !prefs.smsConfigured ? ` — ${t("account.prefsNotConfigured")}` : ""}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={prefsSaving}
            onClick={() => void savePreferences({ phone: phoneDraft })}
          >
            {t("common.save")}
          </button>
        </div>
        <p className="subtle">{t("account.prefsOptInHint")}</p>
        {prefsSaved ? <p className="subtle">{t("account.prefsSaved")}</p> : null}
      </Card>

      <Card title={t("account.history")}>
        {history.length === 0 ? (
          <EmptyState>{t("account.historyEmpty")}</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("staff.queue")}</th>
                  <th className="nums">#</th>
                  <th>{t("common.status")}</th>
                  <th>{t("account.joinedDate")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.queue.organization.name} · {item.queue.name}
                    </td>
                    <td className="nums">{item.ticketNumber}</td>
                    <td>
                      <Badge tone={statusTone(item.status)}>
                        {t(ticketStatusKey(item.status))}
                      </Badge>
                    </td>
                    <td className="subtle">{formatDateTime(item.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountDashboard />
    </RequireAuth>
  );
}
