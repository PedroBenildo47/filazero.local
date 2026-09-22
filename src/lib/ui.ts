/**
 * Small presentation helpers shared by the UI.
 *
 * Status → message-key mapping lives here (pure, no React) so pages stay
 * declarative and every label is translatable. The actual strings are in
 * `src/lib/i18n.ts`.
 */
import type { MessageKey } from "@/lib/i18n";

export type BadgeTone = "info" | "ok" | "warn" | "danger" | "muted";

/** Shape of the authenticated user returned by `GET /api/auth/session`. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMINISTRATOR";
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Organization membership carried with the session. */
export interface Membership {
  organizationId: string;
  branchId: string | null;
  role: string;
  status: string;
}

const STATUS_TONES: Record<string, BadgeTone> = {
  WAITING: "warn",
  CALLED: "info",
  SERVING: "info",
  COMPLETED: "ok",
  CANCELLED: "muted",
  NO_SHOW: "danger",
  OPEN: "ok",
  PAUSED: "warn",
  CLOSED: "muted",
  ACTIVE: "ok",
  SUSPENDED: "warn",
  INACTIVE: "muted",
  TRIALING: "info",
  PAST_DUE: "warn",
  EXPIRED: "danger",
  PENDING: "warn",
  SUCCEEDED: "ok",
  FAILED: "danger",
  REFUNDED: "muted",
};

/** Visual tone for a ticket/queue/organization status. */
export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? "muted";
}

export function ticketStatusKey(status: string): MessageKey {
  return `status.${status}` as MessageKey;
}

export function queueStatusKey(status: string): MessageKey {
  return `queueStatus.${status}` as MessageKey;
}

export function organizationStatusKey(status: string): MessageKey {
  return `admin.orgStatus.${status}` as MessageKey;
}

export function roleKey(role: string): MessageKey {
  return `role.${role}` as MessageKey;
}

export function notificationTypeKey(type: string): MessageKey {
  return `notif.type.${type}` as MessageKey;
}

export function memberStatusKey(status: string): MessageKey {
  return `memberStatus.${status}` as MessageKey;
}

export function subscriptionStatusKey(status: string): MessageKey {
  return `subscriptionStatus.${status}` as MessageKey;
}

export function transactionStatusKey(status: string): MessageKey {
  return `transactionStatus.${status}` as MessageKey;
}

export function billingIntervalKey(interval: string): MessageKey {
  return `interval.${interval}` as MessageKey;
}

/** Formats an amount given in the smallest currency unit. */
export function formatMoney(amountCents: number, currency: string): string {
  return `${(amountCents / 100).toFixed(2)} ${currency}`;
}
