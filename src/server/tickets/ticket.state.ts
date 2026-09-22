/**
 * Ticket state machine (pure, unit-testable).
 *
 * Kept free of database imports so it can be exercised by unit tests without a
 * running PostgreSQL.
 *
 *   WAITING ──► CALLED ──► SERVING ──► COMPLETED
 *      │           │          │
 *      └───────────┴──────────┴──► CANCELLED
 *      │           └─────────────► NO_SHOW
 */
import type { TicketStatus } from "@prisma/client";
import { AppError } from "@/lib/errors";

export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  WAITING: ["CALLED", "CANCELLED"],
  CALLED: ["SERVING", "NO_SHOW", "CANCELLED"],
  SERVING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// Mutable arrays: Prisma filters require `TicketStatus[]`, not `readonly`.
export const TERMINAL_TICKET_STATUSES: TicketStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

export const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  "WAITING",
  "CALLED",
  "SERVING",
];

export function isTerminalTicketStatus(status: TicketStatus): boolean {
  return TERMINAL_TICKET_STATUSES.includes(status);
}

export function isActiveTicketStatus(status: TicketStatus): boolean {
  return ACTIVE_TICKET_STATUSES.includes(status);
}

export function canTransitionTicket(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

/** Throws `INVALID_STATE` when the transition is not allowed. */
export function assertTicketTransition(
  from: TicketStatus,
  to: TicketStatus,
  message?: string,
): void {
  if (!canTransitionTicket(from, to)) {
    throw AppError.invalidState(message ?? `Invalid ticket transition: ${from} → ${to}`);
  }
}
