import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@/lib/errors";
import {
  ACTIVE_TICKET_STATUSES,
  TERMINAL_TICKET_STATUSES,
  assertTicketTransition,
  canTransitionTicket,
  isActiveTicketStatus,
  isTerminalTicketStatus,
  TICKET_TRANSITIONS,
} from "@/server/tickets/ticket.state";
import type { TicketStatus } from "@prisma/client";

const ALL_STATUSES: TicketStatus[] = [
  "WAITING",
  "CALLED",
  "SERVING",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

test("the happy path is exactly WAITING → CALLED → SERVING → COMPLETED", () => {
  assert.equal(canTransitionTicket("WAITING", "CALLED"), true);
  assert.equal(canTransitionTicket("CALLED", "SERVING"), true);
  assert.equal(canTransitionTicket("SERVING", "COMPLETED"), true);
});

test("skipping a step is rejected", () => {
  assert.equal(canTransitionTicket("WAITING", "SERVING"), false);
  assert.equal(canTransitionTicket("WAITING", "COMPLETED"), false);
  assert.equal(canTransitionTicket("CALLED", "COMPLETED"), false);
});

test("CALLED tickets may also become NO_SHOW", () => {
  assert.equal(canTransitionTicket("CALLED", "NO_SHOW"), true);
  assert.equal(canTransitionTicket("WAITING", "NO_SHOW"), false);
  assert.equal(canTransitionTicket("SERVING", "NO_SHOW"), false);
});

test("CANCELLED is reachable from every non-terminal state", () => {
  assert.equal(canTransitionTicket("WAITING", "CANCELLED"), true);
  assert.equal(canTransitionTicket("CALLED", "CANCELLED"), true);
  assert.equal(canTransitionTicket("SERVING", "CANCELLED"), true);
});

test("terminal states can never transition again", () => {
  for (const from of TERMINAL_TICKET_STATUSES) {
    for (const to of ALL_STATUSES) {
      assert.equal(canTransitionTicket(from, to), false, `${from} → ${to}`);
    }
    assert.deepEqual(TICKET_TRANSITIONS[from], []);
  }
});

test("no state can transition to itself", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canTransitionTicket(status, status), false, status);
  }
});

test("active and terminal classifications are complementary and correct", () => {
  for (const status of ALL_STATUSES) {
    assert.notEqual(isActiveTicketStatus(status), isTerminalTicketStatus(status), status);
  }
  assert.deepEqual([...ACTIVE_TICKET_STATUSES], ["WAITING", "CALLED", "SERVING"]);
  assert.deepEqual([...TERMINAL_TICKET_STATUSES], ["COMPLETED", "CANCELLED", "NO_SHOW"]);
});

test("assertTicketTransition throws INVALID_STATE on an illegal move", () => {
  assert.throws(
    () => assertTicketTransition("WAITING", "COMPLETED"),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_STATE",
  );
});

test("assertTicketTransition keeps the caller's message", () => {
  const message = "Só um ticket em atendimento pode ser concluído";
  assert.throws(
    () => assertTicketTransition("WAITING", "COMPLETED", message),
    (error: unknown) =>
      error instanceof AppError && error.code === "INVALID_STATE" && error.message === message,
  );
  // A legal transition must not throw.
  assert.doesNotThrow(() => assertTicketTransition("SERVING", "COMPLETED"));
});
