"use client";

/**
 * Waiting-room display (Fase 4 · Bloco 4).
 *
 * Public TV board: shows the ticket being served and the next ones waiting. It
 * only ever renders ticket numbers — never a customer name — so it is safe to
 * leave on a screen. Polls the public board endpoint every 3 seconds.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";

interface Board {
  queue: {
    id: string;
    name: string;
    status: string;
    organizationName: string;
    branchName: string;
  };
  currentTicketNumber: number | null;
  waiting: { ticketNumber: number; position: number }[];
  waitingCount: number;
  kioskEnabled: boolean;
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

  const next = board?.waiting.slice(0, 5) ?? [];

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: "2rem",
        padding: "3rem",
        background: "#0b1220",
        color: "#f8fafc",
      }}
    >
      <section style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "1rem" }}>
        <p style={{ margin: 0, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {board?.queue.organizationName ?? "FilaZero"} · {board?.queue.branchName ?? ""}
        </p>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>{board?.queue.name ?? "A carregar…"}</h1>
        <p style={{ margin: 0, opacity: 0.75, fontSize: "1.25rem" }}>A ATENDER</p>
        <strong style={{ fontSize: "11rem", lineHeight: 1, color: "#22c55e" }}>
          {board?.currentTicketNumber ?? "—"}
        </strong>
        {board && board.queue.status !== "OPEN" ? (
          <p style={{ margin: 0, opacity: 0.75 }}>Fila fechada</p>
        ) : null}
      </section>

      <section style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "1rem" }}>
        <p style={{ margin: 0, opacity: 0.75, fontSize: "1.25rem" }}>PRÓXIMAS</p>
        {next.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Sem senhas em espera</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
            {next.map((item) => (
              <li
                key={item.ticketNumber}
                style={{
                  fontSize: "2.5rem",
                  fontWeight: 700,
                  padding: "0.75rem 1.25rem",
                  borderRadius: "1rem",
                  background: "rgba(248,250,252,0.08)",
                }}
              >
                {item.ticketNumber}
              </li>
            ))}
          </ol>
        )}
        <p style={{ opacity: 0.6, fontSize: "0.95rem" }}>
          {board?.waitingCount ?? 0} em espera
        </p>
      </section>
    </main>
  );
}
