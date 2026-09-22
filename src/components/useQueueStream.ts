"use client";

import { useEffect, useRef, useState } from "react";

const EVENT_TYPES = [
  "ticket.joined",
  "ticket.left",
  "ticket.called",
  "ticket.serving",
  "ticket.completed",
  "ticket.cancelled",
  "ticket.no_show",
  "queue.status_changed",
] as const;

export type StreamStatus = "connecting" | "live" | "offline";

const RETRY_MS = 3000;

/**
 * Subscribes to the queue's Server-Sent Events stream.
 *
 * The stream only carries change *signals*: `onSignal` should re-fetch the
 * authoritative data from the HTTP API. On every (re)connection the server sends
 * a `ready` event, which also triggers a re-sync — that is how missed events are
 * recovered. EventSource auto-reconnects, but we also reconnect explicitly after
 * an error so the retry delay is predictable and the status is visible.
 */
export function useQueueStream(
  queueId: string | null | undefined,
  onSignal: () => void,
): StreamStatus {
  const handler = useRef(onSignal);
  handler.current = onSignal;

  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    if (!queueId) {
      setStatus("offline");
      return;
    }

    let source: EventSource | null = null;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      source = new EventSource(`/api/queues/${queueId}/stream`, {
        withCredentials: true,
      });

      source.addEventListener("ready", () => {
        setStatus("live");
        handler.current();
      });

      for (const type of EVENT_TYPES) {
        source.addEventListener(type, () => handler.current());
      }

      source.onerror = () => {
        source?.close();
        source = null;
        setStatus("offline");
        if (stopped) return;
        retryTimer = setTimeout(connect, RETRY_MS);
      };
    };

    connect();

    // Re-sync when the tab becomes visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") handler.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      source?.close();
    };
  }, [queueId]);

  return status;
}
