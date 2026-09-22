/**
 * Real-time event bus.
 *
 * The queue engine publishes lightweight *invalidation signals* here. Clients
 * receive them over Server-Sent Events and then re-synchronise through the
 * normal HTTP API. Events are therefore never the source of truth: PostgreSQL
 * is. If an event is lost (process restart, reconnect), the client simply
 * re-reads the API.
 *
 * Transport: in-process `EventEmitter`. A single Next.js/Node instance is the
 * current deployment target; for multi-instance deployments this file is the
 * only place that must change (swap for PostgreSQL LISTEN/NOTIFY or Redis).
 * See docs/ARCHITECTURE.md.
 */
import "server-only";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type QueueEventType =
  | "ticket.joined"
  | "ticket.left"
  | "ticket.called"
  | "ticket.serving"
  | "ticket.completed"
  | "ticket.cancelled"
  | "ticket.no_show"
  | "queue.status_changed";

export interface QueueEvent {
  /** Unique id, usable as an SSE `Last-Event-ID`. */
  id: string;
  type: QueueEventType;
  queueId: string;
  organizationId: string;
  ticketId?: string;
  ticketNumber?: number;
  ticketStatus?: string;
  queueStatus?: string;
  at: string;
}

export type QueueEventListener = (event: QueueEvent) => void;

const CHANNEL = "filazero:queue";

const globalForBus = globalThis as unknown as {
  filazeroEventBus?: EventEmitter;
};

const emitter = globalForBus.filazeroEventBus ?? new EventEmitter();
emitter.setMaxListeners(0);
if (!globalForBus.filazeroEventBus) {
  globalForBus.filazeroEventBus = emitter;
}

/**
 * Publishes an event. Call this AFTER the database transaction has committed,
 * so an event can never describe a change that was rolled back.
 */
export function publishQueueEvent(
  input: Omit<QueueEvent, "id" | "at"> & { at?: string },
): QueueEvent {
  const event: QueueEvent = {
    id: randomUUID(),
    at: input.at ?? new Date().toISOString(),
    ...input,
  };
  emitter.emit(CHANNEL, event);
  return event;
}

/** Subscribes to every queue event. Returns an unsubscribe function. */
export function subscribeToQueueEvents(listener: QueueEventListener): () => void {
  emitter.on(CHANNEL, listener);
  return () => {
    emitter.off(CHANNEL, listener);
  };
}

export function queueEventBusStats() {
  return { listeners: emitter.listenerCount(CHANNEL) };
}
