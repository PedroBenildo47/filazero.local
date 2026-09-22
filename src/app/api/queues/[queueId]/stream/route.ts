/**
 * Server-Sent Events stream for a queue.
 *
 * The stream carries *change signals* only — never authoritative state and
 * never personal data. Clients react by re-fetching the API, which enforces
 * authorization. PostgreSQL therefore remains the single source of truth.
 *
 * Reconnection: `retry:` sets the browser's reconnect delay, every event has an
 * `id:` (usable as `Last-Event-ID`), and a heartbeat comment keeps proxies from
 * closing idle connections. On every (re)connect the client is expected to
 * re-sync through the API.
 */
import "server-only";
import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { loadQueueScope } from "@/server/queues/queue.service";
import { subscribeToQueueEvents, type QueueEvent } from "@/server/realtime/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ queueId: string }> };

const HEARTBEAT_MS = 20_000;

function sseChunk(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

export const GET = route(async (request, context: Context) => {
  await requireAuth();
  const { queueId } = await context.params;

  // 404 for unknown queues before opening the stream.
  await loadQueueScope(queueId);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Ask the browser to retry after 3s if the connection drops.
      write("retry: 3000\n\n");
      // Sent on every connection, including reconnections: the client uses it
      // as the trigger to re-synchronise through the API.
      write(
        sseChunk("ready", {
          queueId,
          at: new Date().toISOString(),
        }),
      );

      unsubscribe = subscribeToQueueEvents((event: QueueEvent) => {
        if (event.queueId !== queueId) return;
        write(sseChunk(event.type, event, event.id));
      });

      heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
