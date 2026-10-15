"use client";

/**
 * Waiting-room display (TV mode).
 *
 * Public, high-contrast board: the ticket being served, the next ones waiting
 * and the last called tickets (so someone who missed the first call can catch
 * up). It only ever renders ticket numbers — never a customer name.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { OrganizationLogo } from "@/components/OrganizationLogo";

interface Board {
  queue: {
    id: string;
    name: string;
    status: string;
    publicCode: string;
    organizationId: string;
    organizationName: string;
    organizationLogoUrl: string | null;
    branchName: string;
  };
  currentTicketNumber: number | null;
  waiting: { ticketNumber: number; position: number }[];
  recent: { ticketNumber: number; status: string; at: string }[];
  waitingCount: number;
  kioskEnabled: boolean;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DisplayBoardPage() {
  const params = useParams<{ queueId: string }>();
  const queueId = params?.queueId;
  const [board, setBoard] = useState<Board | null>(null);

  const load = useCallback(async () => {
    if (!queueId) return;
    try {
      setBoard(await api<Board>(`/api/public/queues/${queueId}/board`));
    } catch {
      /* keep the previous frame on a transient error */
    }
  }, [queueId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const next = board?.waiting.slice(0, 4) ?? [];
  const recent = board?.recent ?? [];

  return (
    <main className="tv">
      <header className="tv-head">
        <div className="tv-brand">
          <OrganizationLogo
            logoUrl={board?.queue.organizationLogoUrl}
            name={board?.queue.organizationName ?? "FilaZero"}
            size={64}
            variant="dark"
          />
          <div>
            <p className="tv-org">
              {board?.queue.organizationName ?? "FilaZero"} · {board?.queue.branchName ?? ""}
            </p>
            <h1 className="tv-queue">{board?.queue.name ?? "A carregar…"}</h1>
          </div>
        </div>
        <div className="tv-clock">{timeOf(new Date().toISOString())}</div>
      </header>

      <section className="tv-grid">
        <div className="tv-current">
          <p className="tv-label">A ATENDER</p>
          <strong className="tv-current-number">
            {board?.currentTicketNumber ?? "—"}
          </strong>
          {board && board.queue.status !== "OPEN" ? (
            <p className="tv-closed">FILA FECHADA</p>
          ) : null}
        </div>

        <div className="tv-col">
          <p className="tv-label">PRÓXIMAS</p>
          {next.length === 0 ? (
            <p className="tv-empty">Sem senhas em espera</p>
          ) : (
            <ol className="tv-list">
              {next.map((item) => (
                <li key={item.ticketNumber}>{item.ticketNumber}</li>
              ))}
            </ol>
          )}
          <p className="tv-waiting">{board?.waitingCount ?? 0} em espera</p>
        </div>

        <div className="tv-col">
          <p className="tv-label">ÚLTIMAS CHAMADAS</p>
          {recent.length === 0 ? (
            <p className="tv-empty">Sem chamadas recentes</p>
          ) : (
            <ol className="tv-list tv-list-small">
              {recent.map((item) => (
                <li key={`${item.ticketNumber}-${item.at}`}>
                  <span className="tv-recent-number">{item.ticketNumber}</span>
                  <span className="tv-recent-time">{timeOf(item.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}
