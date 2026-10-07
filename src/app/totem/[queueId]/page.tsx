"use client";

/**
 * Kiosk / totem mode (Fase 4 · Bloco 4).
 *
 * Public, unauthenticated screen: a walk-in customer taps once to take a ticket.
 * The page then shows the ticket number and live position and resets itself
 * after 20s of inactivity, ready for the next person. Only queues whose owner
 * enabled kiosk mode accept these tickets.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

interface IssuedTicket {
  ticketNumber: number;
  position: number;
}

const RESET_MS = 20000;

export default function TotemPage() {
  const params = useParams<{ queueId: string }>();
  const queueId = params?.queueId;
  const [board, setBoard] = useState<Board | null>(null);
  const [ticket, setTicket] = useState<IssuedTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetTimer = useRef<number | null>(null);

  const loadBoard = useCallback(async () => {
    if (!queueId) return;
    try {
      setBoard(await api<Board>(`/api/public/queues/${queueId}/board`));
    } catch {
      /* transient; the poll retries */
    }
  }, [queueId]);

  useEffect(() => {
    void loadBoard();
    const id = window.setInterval(() => void loadBoard(), 5000);
    return () => window.clearInterval(id);
  }, [loadBoard]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, []);

  function scheduleReset() {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setTicket(null), RESET_MS);
  }

  async function takeTicket() {
    if (!queueId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await api<IssuedTicket>(`/api/public/queues/${queueId}/tickets`, {
        method: "POST",
        json: {},
      });
      setTicket(issued);
      scheduleReset();
      await loadBoard();
    } catch {
      setError("Não foi possível retirar a senha. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const position =
    ticket && board
      ? board.waiting.find((item) => item.ticketNumber === ticket.ticketNumber)?.position ?? null
      : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "2rem",
        textAlign: "center",
        background: "#0b1220",
        color: "#f8fafc",
      }}
    >
      <p style={{ margin: 0, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {board?.queue.organizationName ?? "FilaZero"} · {board?.queue.branchName ?? ""}
      </p>
      <h1 style={{ margin: 0, fontSize: "2.5rem" }}>{board?.queue.name ?? "A carregar…"}</h1>

      {ticket ? (
        <div style={{ display: "grid", gap: "1rem" }}>
          <p style={{ margin: 0, opacity: 0.75 }}>A sua senha</p>
          <strong style={{ fontSize: "6rem", lineHeight: 1 }}>{ticket.ticketNumber}</strong>
          <p style={{ margin: 0, fontSize: "1.5rem" }}>
            {position ? `${position}º na fila` : "Aguarde ser chamado"}
          </p>
          <button
            type="button"
            onClick={() => setTicket(null)}
            style={{
              marginTop: "1rem",
              padding: "1rem 2rem",
              fontSize: "1.25rem",
              borderRadius: "999px",
              border: "1px solid rgba(248,250,252,0.3)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Concluir
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void takeTicket()}
          disabled={busy || !board?.kioskEnabled || board?.queue.status !== "OPEN"}
          style={{
            padding: "2.5rem 4rem",
            fontSize: "2rem",
            fontWeight: 700,
            borderRadius: "2rem",
            border: "none",
            background: board?.kioskEnabled && board?.queue.status === "OPEN" ? "#22c55e" : "#334155",
            color: "#04110a",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "A emitir…" : "Retirar senha"}
        </button>
      )}

      {board && !board.kioskEnabled ? (
        <p style={{ opacity: 0.75 }}>O modo quiosque não está ativo nesta fila.</p>
      ) : null}
      {board && board.kioskEnabled && board.queue.status !== "OPEN" ? (
        <p style={{ opacity: 0.75 }}>A fila está fechada neste momento.</p>
      ) : null}
      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
      <p style={{ opacity: 0.5, fontSize: "0.9rem" }}>
        Senhas à espera: {board?.waitingCount ?? 0}
      </p>
    </main>
  );
}
