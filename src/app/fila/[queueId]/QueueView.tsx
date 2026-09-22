"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/components/LanguageProvider";
import { useQueueStream } from "@/components/useQueueStream";
import { useSession } from "@/components/SessionProvider";
import { Alert, Badge, Spinner } from "@/components/ui";
import { queueStatusKey, statusTone } from "@/lib/ui";

interface QueueInfo {
  id: string;
  name: string;
  description: string | null;
  status: string;
  waitingCount: number;
  branch: { id: string; name: string; city: string | null; address: string | null };
  organization: { id: string; name: string; category: string | null };
}

export function QueueView({ queueId }: { queueId: string }) {
  const { t, tError } = useI18n();
  const { user } = useSession();
  const router = useRouter();

  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      setQueue(await api<QueueInfo>(`/api/queues/${queueId}`));
      setError(null);
    } catch (caught) {
      setError(tError(caught));
    } finally {
      setLoading(false);
    }
  }, [queueId, tError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live waiting count: the event is only a signal, we re-read the queue.
  const streamStatus = useQueueStream(queueId, () => {
    void load();
  });

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      await api(`/api/queues/${queueId}/tickets`, { method: "POST" });
      router.push("/conta");
      router.refresh();
    } catch (caught) {
      setJoinError(tError(caught));
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <main className="container">
        <Spinner label={t("common.loading")} />
      </main>
    );
  }

  if (error || !queue) {
    return (
      <main className="container">
        <Alert kind="error">{error ?? t("queue.notFound")}</Alert>
        <p>
          <Link href="/pesquisar" className="btn btn-ghost">
            {t("common.back")}
          </Link>
        </p>
      </main>
    );
  }

  const isOpen = queue.status === "OPEN";

  return (
    <main className="container form-narrow animate-in">
      <p>
        <Link href={`/estabelecimento/${queue.organization.id}`} className="muted">
          ← {queue.organization.name}
        </Link>
      </p>

      <h1>{queue.name}</h1>
      <p className="muted">
        {t("queue.organization")}: {queue.organization.name} · {t("queue.branch")}:{" "}
        {queue.branch.name}
      </p>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{queue.waitingCount}</span>
          <span className="stat-label">{t("staff.countWaiting")}</span>
        </div>
        <div className="stat">
          <Badge tone={statusTone(queue.status)}>{t(queueStatusKey(queue.status))}</Badge>
          {user && (
            <span className="muted stream-status">
              {streamStatus === "live"
                ? t("realtime.live")
                : streamStatus === "connecting"
                  ? t("realtime.connecting")
                  : t("realtime.offline")}
            </span>
          )}
        </div>
      </div>

      {queue.description && <p>{queue.description}</p>}
      {joinError && <Alert kind="error">{joinError}</Alert>}

      {user ? (
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={!isOpen || joining}
          onClick={() => void join()}
        >
          {joining ? t("common.loading") : isOpen ? t("queue.join") : t("errors.QUEUE_CLOSED")}
        </button>
      ) : (
        <Link
          href={`/login?next=/fila/${queueId}`}
          className="btn btn-primary btn-lg btn-block"
        >
          {t("queue.loginToJoin")}
        </Link>
      )}
    </main>
  );
}
