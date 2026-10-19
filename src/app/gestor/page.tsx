"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { QRCodeCanvas } from "qrcode.react";
import { useI18n } from "@/components/LanguageProvider";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Spinner,
  StatCard,
} from "@/components/ui";
import {
  memberStatusKey,
  queueStatusKey,
  roleKey,
  statusTone,
} from "@/lib/ui";

interface Organization {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  description: string | null;
  taxId: string | null;
  logoUrl: string | null;
  status: string;
}
interface Branch {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
}
interface QueueItem {
  id: string;
  publicCode: string;
  name: string;
  description: string | null;
  status: string;
  waitingCount: number;
  totalTickets: number;
}
interface Member {
  id: string;
  userId: string;
  branchId: string | null;
  role: string;
  status: string;
  user: { id: string; name: string; email: string };
  branch: { id: string; name: string } | null;
}
interface Operations {
  generatedAt: string;
  totals: {
    activeQueues: number;
    totalQueues: number;
    waitingTickets: number;
    servingNow: number;
    ticketsToday: number;
    completedToday: number;
    noShowToday: number;
    averageWaitSeconds: number | null;
  };
  queues: Array<{
    id: string;
    name: string;
    prefix: string | null;
    status: string;
    branchName: string;
    waitingCount: number;
    currentTicketNumber: number | null;
    currentTicketStatus: string | null;
  }>;
}

interface CounterItem {
  id: string;
  branchId: string;
  name: string;
  active: boolean;
  branch: { id: string; name: string };
  members: number;
}


function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function ManagerDashboard() {
  const { t, tError } = useI18n();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [operations, setOperations] = useState<Operations | null>(null);
  const [counters, setCounters] = useState<CounterItem[]>([]);
  const [counterForm, setCounterForm] = useState({ branchId: "", name: "" });
  const [queueQr, setQueueQr] = useState<{ name: string; code: string; url: string } | null>(
    null,
  );
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);

  const [orgForm, setOrgForm] = useState({
    name: "",
    category: "",
    city: "",
    taxId: "",
  });
  const [branchForm, setBranchForm] = useState({ name: "", address: "", city: "" });
  const [queueForm, setQueueForm] = useState({ name: "", description: "", prefix: "" });
  const [memberForm, setMemberForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "STAFF",
    branchId: "",
    counterId: "",
  });

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

  const loadOrganization = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        const [branchList, memberList, operationsData, counterList] = await Promise.all([
          api<{ items: Branch[] }>(`/api/organizations/${id}/branches?pageSize=50`),
          api<{ items: Member[] }>(`/api/organizations/${id}/members?pageSize=50`),
          api<Operations>(`/api/organizations/${id}/operations`),
          api<{ items: CounterItem[] }>(`/api/organizations/${id}/counters`),
        ]);
        setBranches(branchList.items);
        setMembers(memberList.items);
        setOperations(operationsData);
        setCounters(counterList.items);
        setBranchId((current) =>
          branchList.items.some((branch) => branch.id === current)
            ? current
            : branchList.items[0]?.id ?? "",
        );
      } catch (caught) {
        setError(tError(caught));
      }
    },
    [tError],
  );

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api<{ logoUrl: string }>(
        `/api/organizations/${organizationId}/logo`,
        { method: "POST", formData },
      );
      setOrganizations((current) =>
        current.map((org) =>
          org.id === organizationId ? { ...org, logoUrl: result.logoUrl } : org,
        ),
      );
      setLogoVersion(Date.now());
      setNotice(t("manager.logoUpdated"));
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm(t("manager.confirmRemove"))) return;
    setLogoBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/organizations/${organizationId}/logo`, { method: "DELETE" });
      setOrganizations((current) =>
        current.map((org) =>
          org.id === organizationId ? { ...org, logoUrl: null } : org,
        ),
      );
      setLogoVersion(Date.now());
      setNotice(t("manager.logoRemoved"));
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setLogoBusy(false);
    }
  }

  useEffect(() => {
    const organization = organizations.find((item) => item.id === organizationId);
    if (organization) {
      setOrgForm({
        name: organization.name,
        category: organization.category ?? "",
        city: organization.city ?? "",
        taxId: organization.taxId ?? "",
      });
    }
    void loadOrganization(organizationId);
  }, [organizationId, organizations, loadOrganization]);

  const loadQueues = useCallback(
    async (id: string) => {
      if (!id) {
        setQueues([]);
        return;
      }
      try {
        const result = await api<{ items: QueueItem[] }>(
          `/api/branches/${id}/queues?pageSize=50`,
        );
        setQueues(result.items);
      } catch (caught) {
        setError(tError(caught));
      }
    },
    [tError],
  );

  useEffect(() => {
    void loadQueues(branchId);
  }, [branchId, loadQueues]);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setBusy(false);
    }
  }

  function downloadQueueQr() {
    const canvas = document.getElementById("queue-qr-code") as HTMLCanvasElement | null;
    if (!canvas || !queueQr) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `filazero-${queueQr.code}.png`;
    link.click();
  }

  async function copyQueueLink() {
    if (!queueQr) return;
    try {
      await navigator.clipboard.writeText(queueQr.url);
      setNotice(t("manager.linkCopied"));
    } catch {
      setNotice(queueQr.url);
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
      <div className="row spread manager-heading">
        <div>
          <h1>{t("manager.title")}</h1>
          <p className="muted">{t("manager.subtitle")}</p>
        </div>
        <Link href="/gestor/analytics" className="btn btn-ghost">
          {t("manager.analytics")}
        </Link>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {organizations.length === 0 ? (
        <EmptyState>{t("admin.noOrganizations")}</EmptyState>
      ) : (
        <>
          <label className="field">
            <span>{t("manager.organization")}</span>
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

          <Card title={t("manager.organizationData")}>
            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.name")}</span>
                <input
                  className="input"
                  value={orgForm.name}
                  onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.category")}</span>
                <input
                  className="input"
                  value={orgForm.category}
                  onChange={(event) => setOrgForm({ ...orgForm, category: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.city")}</span>
                <input
                  className="input"
                  value={orgForm.city}
                  onChange={(event) => setOrgForm({ ...orgForm, city: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.taxId")}</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder={t("manager.taxIdHint")}
                  value={orgForm.taxId}
                  onChange={(event) => setOrgForm({ ...orgForm, taxId: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api(`/api/organizations/${organizationId}`, {
                        method: "PATCH",
                        json: {
                          name: orgForm.name,
                          category: orgForm.category,
                          city: orgForm.city,
                          taxId: orgForm.taxId,
                        },
                      }),
                    t("manager.saved"),
                  )
                }
              >
                {t("manager.saveOrganization")}
              </button>
            </div>
          </Card>

          <Card title={t("manager.operations")}>
            {!operations ? (
              <Spinner label={t("common.loading")} />
            ) : (
              <>
                <div className="kpi-grid">
                  <StatCard
                    label={t("manager.op.serving")}
                    value={operations.totals.servingNow}
                    tone="info"
                  />
                  <StatCard
                    label={t("manager.op.waiting")}
                    value={operations.totals.waitingTickets}
                    tone="warn"
                  />
                  <StatCard
                    label={t("manager.op.avgWait")}
                    value={formatDuration(operations.totals.averageWaitSeconds)}
                    tone="info"
                  />
                  <StatCard
                    label={t("manager.op.today")}
                    value={operations.totals.ticketsToday}
                    hint={`${t("manager.op.completed")}: ${operations.totals.completedToday} · ${t("manager.op.noShow")}: ${operations.totals.noShowToday}`}
                    tone="ok"
                  />
                  <StatCard
                    label={t("manager.op.activeQueues")}
                    value={operations.totals.activeQueues}
                    hint={`${t("manager.op.totalQueues")}: ${operations.totals.totalQueues}`}
                    tone="ok"
                  />
                </div>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("manager.branch")}</th>
                        <th>{t("manager.name")}</th>
                        <th>{t("staff.countWaiting")}</th>
                        <th>{t("manager.op.nowServing")}</th>
                        <th>{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operations.queues.map((queue) => (
                        <tr key={queue.id}>
                          <td className="muted">{queue.branchName}</td>
                          <td>
                            {queue.prefix ? `${queue.prefix} · ` : ""}
                            {queue.name}
                          </td>
                          <td>{queue.waitingCount}</td>
                          <td>
                            {queue.currentTicketNumber === null
                              ? "—"
                              : `${queue.prefix ?? ""}${queue.currentTicketNumber}`}
                          </td>
                          <td>
                            <Badge tone={statusTone(queue.status)}>
                              {t(queueStatusKey(queue.status))}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card title={t("manager.logo")}>
            <div className="row" style={{ gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              {(() => {
                const logoUrl = organizations.find((org) => org.id === organizationId)?.logoUrl;
                if (!logoUrl) return <p className="muted">{t("manager.logoNone")}</p>;
                return (
                  <figure className="logo-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${logoUrl}${logoUrl.includes("?") ? "&" : "?"}v=${logoVersion}`}
                      alt={t("manager.logoCurrent")}
                      width={96}
                      height={96}
                    />
                    <figcaption className="muted">{t("manager.logoCurrent")}</figcaption>
                  </figure>
                );
              })()}
              <label className="btn btn-primary">
                {logoBusy ? t("common.loading") : t("manager.logoUpload")}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  disabled={logoBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadLogo(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-danger"
                disabled={logoBusy}
                onClick={() => void removeLogo()}
              >
                {t("manager.logoRemove")}
              </button>
            </div>
            <p className="muted">{t("manager.logoHint")}</p>
          </Card>

          <Card title={t("billing.title")}>
            <p className="muted">{t("billing.dedicatedHint")}</p>
            <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
              <Link href="/gestor/subscricao" className="btn btn-primary">
                {t("billing.openBilling")}
              </Link>
            </div>
          </Card>

          <Card title={t("manager.branches")}>
            {branches.length === 0 ? (
              <EmptyState>{t("manager.noBranches")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.name")}</th>
                    <th>{t("manager.city")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((branch) => (
                    <tr key={branch.id} className={branch.id === branchId ? "is-selected" : ""}>
                      <td>{branch.name}</td>
                      <td className="muted">{branch.city ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setBranchId(branch.id)}
                        >
                          {t("manager.queues")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.branchName")}</span>
                <input
                  className="input"
                  value={branchForm.name}
                  onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.branchAddress")}</span>
                <input
                  className="input"
                  value={branchForm.address}
                  onChange={(event) =>
                    setBranchForm({ ...branchForm, address: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>{t("manager.branchCity")}</span>
                <input
                  className="input"
                  value={branchForm.city}
                  onChange={(event) => setBranchForm({ ...branchForm, city: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || branchForm.name.trim().length < 2}
                onClick={() =>
                  void run(async () => {
                    await api(`/api/organizations/${organizationId}/branches`, {
                      method: "POST",
                      json: {
                        name: branchForm.name,
                        ...(branchForm.address ? { address: branchForm.address } : {}),
                        ...(branchForm.city ? { city: branchForm.city } : {}),
                      },
                    });
                    setBranchForm({ name: "", address: "", city: "" });
                    await loadOrganization(organizationId);
                  })
                }
              >
                {t("manager.createBranch")}
              </button>
            </div>
          </Card>

          <Card title={t("manager.counters")}>
            {counters.length === 0 ? (
              <EmptyState>{t("manager.noCounters")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.counterName")}</th>
                    <th>{t("manager.branch")}</th>
                    <th>{t("manager.counterMembers")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {counters.map((counter) => (
                    <tr key={counter.id}>
                      <td>{counter.name}</td>
                      <td className="muted">{counter.branch.name}</td>
                      <td>{counter.members}</td>
                      <td>
                        <Badge tone={counter.active ? "ok" : "muted"}>
                          {counter.active
                            ? t("manager.counterActive")
                            : t("manager.counterInactive")}
                        </Badge>
                      </td>
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(
                                  `/api/organizations/${organizationId}/counters/${counter.id}`,
                                  { method: "PATCH", json: { active: !counter.active } },
                                );
                                await loadOrganization(organizationId);
                              })
                            }
                          >
                            {counter.active
                              ? t("manager.counterDeactivate")
                              : t("manager.counterActivate")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(t("manager.confirmRemove"))) return;
                              void run(async () => {
                                await api(
                                  `/api/organizations/${organizationId}/counters/${counter.id}`,
                                  { method: "DELETE" },
                                );
                                await loadOrganization(organizationId);
                              });
                            }}
                          >
                            {t("manager.remove")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.branch")}</span>
                <select
                  className="input"
                  value={counterForm.branchId}
                  onChange={(event) =>
                    setCounterForm({ ...counterForm, branchId: event.target.value })
                  }
                >
                  <option value="">{t("manager.selectBranchFirst")}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("manager.counterName")}</span>
                <input
                  className="input"
                  maxLength={80}
                  placeholder="Guichê 01"
                  value={counterForm.name}
                  onChange={(event) =>
                    setCounterForm({ ...counterForm, name: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !counterForm.branchId || counterForm.name.trim().length < 1}
                onClick={() =>
                  void run(async () => {
                    await api(`/api/organizations/${organizationId}/counters`, {
                      method: "POST",
                      json: { branchId: counterForm.branchId, name: counterForm.name },
                    });
                    setCounterForm({ branchId: "", name: "" });
                    await loadOrganization(organizationId);
                  })
                }
              >
                {t("manager.createCounter")}
              </button>
            </div>
          </Card>

          <Card
            title={`${t("manager.queues")}${branchId ? ` · ${branches.find((b) => b.id === branchId)?.name ?? ""}` : ""}`}
          >
            {!branchId ? (
              <EmptyState>{t("manager.selectBranchFirst")}</EmptyState>
            ) : queues.length === 0 ? (
              <EmptyState>{t("manager.noQueues")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.name")}</th>
                    <th>{t("staff.countWaiting")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map((queue) => (
                    <tr key={queue.id}>
                      <td>{queue.name}</td>
                      <td>{queue.waitingCount}</td>
                      <td>
                        <Badge tone={statusTone(queue.status)}>
                          {t(queueStatusKey(queue.status))}
                        </Badge>
                      </td>
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setQueueQr({
                                name: queue.name,
                                code: queue.publicCode,
                                url: `${window.location.origin}/fila/${queue.publicCode}`,
                              })
                            }
                          >
                            {t("manager.generateQr")}
                          </button>
                          {(["OPEN", "PAUSED", "CLOSED"] as const)
                            .filter((status) => status !== queue.status)
                            .map((status) => (
                              <button
                                key={status}
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api(`/api/queues/${queue.id}/status`, {
                                      method: "PATCH",
                                      json: { status },
                                    });
                                    await loadQueues(branchId);
                                  })
                                }
                              >
                                {status === "OPEN"
                                  ? t("manager.open")
                                  : status === "PAUSED"
                                    ? t("manager.pause")
                                    : t("manager.close")}
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {branchId && (
              <div className="row form-inline">
                <label className="field">
                  <span>{t("manager.queueName")}</span>
                  <input
                    className="input"
                    value={queueForm.name}
                    onChange={(event) => setQueueForm({ ...queueForm, name: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t("manager.queueDescription")}</span>
                  <input
                    className="input"
                    value={queueForm.description}
                    onChange={(event) =>
                      setQueueForm({ ...queueForm, description: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("manager.queuePrefix")}</span>
                  <input
                    className="input"
                    maxLength={3}
                    placeholder="A"
                    value={queueForm.prefix}
                    onChange={(event) =>
                      setQueueForm({ ...queueForm, prefix: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || queueForm.name.trim().length < 2}
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/branches/${branchId}/queues`, {
                        method: "POST",
                        json: {
                          name: queueForm.name,
                          ...(queueForm.description
                            ? { description: queueForm.description }
                            : {}),
                          ...(queueForm.prefix.trim()
                            ? { prefix: queueForm.prefix.trim() }
                            : {}),
                          status: "OPEN",
                        },
                      });
                      setQueueForm({ name: "", description: "", prefix: "" });
                      await loadQueues(branchId);
                    })
                  }
                >
                  {t("manager.createQueue")}
                </button>
              </div>
            )}
          </Card>

          {queueQr && (
            <div className="qr-overlay" onClick={() => setQueueQr(null)}>
              <section
                className="qr-print-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="queue-qr-title"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="queue-qr-title">{queueQr.name}</h2>
                <p className="muted">{t("manager.qrDescription")}</p>
                <QRCodeCanvas id="queue-qr-code" value={queueQr.url} size={256} level="H" />
                <p className="mono qr-code-value">
                  {t("manager.queueCode")}: <strong>{queueQr.code}</strong>
                </p>
                <p className="mono qr-url">{queueQr.url}</p>
                <div className="row qr-actions">
                  <button type="button" className="btn btn-primary" onClick={downloadQueueQr}>
                    {t("manager.downloadPng")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void copyQueueLink()}>
                    {t("manager.copyLink")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                    {t("manager.printQr")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setQueueQr(null)}>
                    {t("common.close")}
                  </button>
                </div>
              </section>
            </div>
          )}

          <Card title={t("manager.members")}>
            {members.length === 0 ? (
              <EmptyState>{t("manager.noMembers")}</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("manager.memberName")}</th>
                    <th>{t("manager.memberEmail")}</th>
                    <th>{t("manager.memberRole")}</th>
                    <th>{t("manager.memberBranch")}</th>
                    <th>{t("manager.memberStatus")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>{member.user.name}</td>
                      <td className="muted">{member.user.email}</td>
                      <td>{t(roleKey(member.role))}</td>
                      <td className="muted">
                        {member.branch ? member.branch.name : t("manager.allBranches")}
                      </td>
                      <td>
                        <Badge tone={statusTone(member.status)}>
                          {t(memberStatusKey(member.status))}
                        </Badge>
                      </td>
                      <td>
                        <div className="row">
                          <select
                            className="input input-sm"
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              void run(async () => {
                                await api(
                                  `/api/organizations/${organizationId}/members/${member.id}`,
                                  { method: "PATCH", json: { role: event.target.value } },
                                );
                                await loadOrganization(organizationId);
                              })
                            }
                          >
                            <option value="STAFF">{t("role.STAFF")}</option>
                            <option value="MANAGER">{t("role.MANAGER")}</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(t("manager.confirmRemove"))) return;
                              void run(async () => {
                                await api(
                                  `/api/organizations/${organizationId}/members/${member.id}`,
                                  { method: "DELETE" },
                                );
                                await loadOrganization(organizationId);
                              });
                            }}
                          >
                            {t("manager.remove")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row form-inline">
              <label className="field">
                <span>{t("manager.memberName")}</span>
                <input
                  className="input"
                  value={memberForm.name}
                  onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.memberEmail")}</span>
                <input
                  className="input"
                  type="email"
                  value={memberForm.email}
                  onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("manager.memberPassword")}</span>
                <input
                  className="input"
                  type="password"
                  value={memberForm.password}
                  onChange={(event) =>
                    setMemberForm({ ...memberForm, password: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>{t("manager.memberRole")}</span>
                <select
                  className="input"
                  value={memberForm.role}
                  onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}
                >
                  <option value="STAFF">{t("role.STAFF")}</option>
                  <option value="MANAGER">{t("role.MANAGER")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("manager.memberBranch")}</span>
                <select
                  className="input"
                  value={memberForm.branchId}
                  onChange={(event) =>
                    setMemberForm({ ...memberForm, branchId: event.target.value })
                  }
                >
                  <option value="">{t("manager.allBranches")}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("manager.memberCounter")}</span>
                <select
                  className="input"
                  value={memberForm.counterId}
                  onChange={(event) =>
                    setMemberForm({ ...memberForm, counterId: event.target.value })
                  }
                >
                  <option value="">{t("manager.noCounter")}</option>
                  {counters
                    .filter((counter) => counter.active)
                    .map((counter) => (
                      <option key={counter.id} value={counter.id}>
                        {counter.name} · {counter.branch.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  memberForm.name.trim().length < 2 ||
                  !memberForm.email.includes("@") ||
                  memberForm.password.length < 8
                }
                onClick={() =>
                  void run(async () => {
                    await api(`/api/organizations/${organizationId}/members`, {
                      method: "POST",
                      json: {
                        name: memberForm.name,
                        email: memberForm.email,
                        password: memberForm.password,
                        role: memberForm.role,
                        branchId: memberForm.branchId || null,
                        counterId: memberForm.counterId || null,
                      },
                    });
                    setMemberForm({
                      name: "",
                      email: "",
                      password: "",
                      role: "STAFF",
                      branchId: "",
                      counterId: "",
                    });
                    await loadOrganization(organizationId);
                  })
                }
              >
                {t("manager.addMemberSubmit")}
              </button>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}

export default function ManagerPage() {
  return (
    <RequireAuth roles={["MANAGER"]}>
      <ManagerDashboard />
    </RequireAuth>
  );
}
