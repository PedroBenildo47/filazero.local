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
  Person,
  Spinner,
  StatCard,
} from "@/components/ui";
import { queueStatusKey, statusTone, ticketStatusKey } from "@/lib/ui";

interface Organization {
  id: string;
  name: string;
  city: string | null;
}
interface Branch {
  id: string;
  name: string;
  city: string | null;
}
interface QueueListItem {
  id: string;
  name: string;
  status: string;
  waitingCount: number;
  totalTickets: number;
}
interface TicketRow {
  id: string;
  ticketNumber: number;
  status: string;
  position: number | null;
  joinedAt: string;
  updatedAt: string;
  user: { id: string; name: string; phone?: string | null };
}
interface QueueState {
  queue: { id: string; name: string; status: string; description: string | null };
  branch: { id: string; name: string; city: string | null };
  organization: { id: string; name: string };
  current: TicketRow | null;
  waiting: TicketRow[];
  recent: TicketRow[];
  counts: {
    waiting: number;
    called: number;
    serving: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
}

function StaffDashboard() {
  const { t, tError, formatDateTime } = useI18n();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [queues, setQueues] = useState<QueueListItem[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [queueId, setQueueId] = useState("");

  const [state, setState] = useState<QueueState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api<{ items: Organization[] }>("/api/organizations?pageSize=50");
        if (!active) return;
        setOrganizations(result.items);
        if (result.items[0]) setOrganizationId(result.items[0].id);
      } catch (caught) {
        if (active) setError(tError(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tError]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    (async () => {
      try {
        const result = await api<{ items: Branch[] }>(
          `/api/organizations/${organizationId}/branches?pageSize=50`,
        );
        if (!active) return;
        setBranches(result.items);
        setBranchId(result.items[0]?.id ?? "");
        setQueueId("");
      } catch (caught) {
        if (active) setError(tError(caught));
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, tError]);

  useEffect(() => {
    if (!branchId) {
      setQueues([]);
      setQueueId("");
      return;
    }
    let active = true;
    (async () => {
      try {
        const result = await api<{ items: QueueListItem[] }>(
          `/api/branches/${branchId}/queues?pageSize=50`,
        );
        if (!active) return;
        setQueues(result.items);
        setQueueId((current) =>
          result.items.some((queue) => queue.id === current) ? current : result.items[0]?.id ?? "",
        );
      } catch (caught) {
        if (active) setError(tError(caught));
      }
    })();
    return () => {
      active = false;
    };
  }, [branchId, tError]);

  const loadState = useCallback(async () => {
    if (!queueId) {
      setState(null);
      return;
    }
    try {
      setState(await api<QueueState>(`/api/queues/${queueId}/state?recentLimit=8`));
      setError(null);
    } catch (caught) {
      setError(tError(caught));
    }
  }, [queueId, tError]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const streamStatus = useQueueStream(queueId || null, () => {
    void loadState();
  });

  async function act(path: string, method: "POST" = "POST", body?: unknown) {
    setBusy(true);
    try {
      await api(path, { method, ...(body === undefined ? {} : { json: body }) });
      await loadState();
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  return (
    <main className="container animate-in">
      <h1>{t("staff.title")}</h1>
      <p className="muted">{t("staff.subtitle")}</p>
      {error && <Alert kind="error">{error}</Alert>}

      {organizations.length === 0 ? (
        <EmptyState>{t("manager.noMembers")}</EmptyState>
      ) : (
        <div className="row form-inline">
          <label className="field">
            <span>{t("staff.organization")}</span>
            <select
              className="input"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("staff.branch")}</span>
            <select
              className="input"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              <option value="">{t("staff.selectBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("staff.queue")}</span>
            <select
              className="input"
              value={queueId}
              onChange={(event) => setQueueId(event.target.value)}
            >
              <option value="">{t("staff.selectQueue")}</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name} ({queue.waitingCount})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!queueId ? (
        <EmptyState>{queues.length === 0 ? t("staff.noQueues") : t("staff.selectQueue")}</EmptyState>
      ) : state ? (
        <>
          <div className="row spread">
            <div>
              <h2>{state.queue.name}</h2>
              <span className="muted">
                {state.organization.name} · {state.branch.name}
              </span>
            </div>
            <div className="row">
              <Badge tone={statusTone(state.queue.status)}>
                {t(queueStatusKey(state.queue.status))}
              </Badge>
              <LiveStatus
                state={streamStatus}
                liveLabel={t("realtime.live")}
                connectingLabel={t("realtime.connecting")}
                offlineLabel={t("realtime.offline")}
              />
            </div>
          </div>

          <div className="kpi-grid">
            <StatCard
              label={t("staff.countWaiting")}
              value={state.counts.waiting}
              tone="warn"
            />
            <StatCard
              label={t("staff.countServing")}
              value={state.counts.serving}
              tone="info"
            />
            <StatCard
              label={t("staff.countCompleted")}
              value={state.counts.completed}
              tone="ok"
            />
            <StatCard
              label={t("staff.countNoShow")}
              value={state.counts.noShow}
              tone="danger"
            />
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={busy || Boolean(state.current)}
            onClick={() => void act(`/api/queues/${queueId}/call-next`)}
          >
            {t("staff.callNext")}
          </button>

          <Card title={t("staff.current")}>
            {!state.current ? (
              <EmptyState>{t("staff.nobodyInService")}</EmptyState>
            ) : (
              <div className="service-row">
                <div>
                  <span className="ticket-number">#{state.current.ticketNumber}</span>
                  <div style={{ margin: "0.5rem 0" }}>
                    <Person name={state.current.user.name} meta={state.current.user.phone} />
                  </div>
                  <Badge tone={statusTone(state.current.status)}>
                    {t(ticketStatusKey(state.current.status))}
                  </Badge>
                </div>
                <div className="row">
                  {state.current.status === "CALLED" && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void act(`/api/tickets/${state.current!.id}/serve`)}
                      >
                        {t("staff.serve")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void act(`/api/tickets/${state.current!.id}/no-show`)}
                      >
                        {t("staff.noShow")}
                      </button>
                    </>
                  )}
                  {state.current.status === "SERVING" && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => void act(`/api/tickets/${state.current!.id}/complete`)}
                    >
                      {t("staff.complete")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(t("staff.cancelPrompt"));
                      if (reason === null) return;
                      void act(`/api/tickets/${state.current!.id}/cancel`, "POST", {
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      });
                    }}
                  >
                    {t("staff.cancel")}
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card title={`${t("staff.waitingList")} (${state.waiting.length})`}>
            {state.waiting.length === 0 ? (
              <EmptyState>{t("staff.noWaiting")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("role.CUSTOMER")}</th>
                    <th>{t("staff.position")}</th>
                    <th>{t("account.joinedDate")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.waiting.map((ticket) => (
                    <tr key={ticket.id}>
                      <td>{ticket.ticketNumber}</td>
                      <td>
                        <Person name={ticket.user.name} meta={ticket.user.phone} />
                      </td>
                      <td>{ticket.position ?? "—"}</td>
                      <td className="muted">{formatDateTime(ticket.joinedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void act(`/api/tickets/${ticket.id}/cancel`, "POST", {
                              reason: "removido pelo atendimento",
                            })
                          }
                        >
                          {t("staff.cancel")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={t("staff.recent")}>
            {state.recent.length === 0 ? (
              <EmptyState>{t("staff.noRecent")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("role.CUSTOMER")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("account.joinedDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.recent.map((ticket) => (
                    <tr key={ticket.id}>
                      <td>{ticket.ticketNumber}</td>
                      <td>{ticket.user.name}</td>
                      <td>
                        <Badge tone={statusTone(ticket.status)}>
                          {t(ticketStatusKey(ticket.status))}
                        </Badge>
                      </td>
                      <td className="muted">{formatDateTime(ticket.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : (
        <Spinner label={t("common.loading")} />
      )}

      <p>
        <Link href="/pesquisar" className="muted">
          {t("nav.search")}
        </Link>
      </p>
    </main>
  );
}

export default function StaffPage() {
  return (
    <RequireAuth roles={["STAFF", "MANAGER", "ADMINISTRATOR"]}>
      <StaffDashboard />
    </RequireAuth>
  );
}
