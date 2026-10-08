/**
 * Public, read-only queue board for the totem/display screens.
 *
 * Shows ticket numbers only — never a customer name — so it is safe to leave on
 * a screen in the waiting room. Used by `/ecra/[queueId]` and by the kiosk to
 * compute its own position after taking a ticket.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface PublicBoard {
  queue: {
    id: string;
    name: string;
    status: string;
    organizationId: string;
    organizationName: string;
    organizationLogoUrl: string | null;
    branchName: string;
  };
  currentTicketNumber: number | null;
  waiting: { ticketNumber: number; position: number }[];
  waitingCount: number;
  kioskEnabled: boolean;
  updatedAt: string;
}

export async function getPublicBoard(queueId: string, limit = 8): Promise<PublicBoard> {
  const queue = await db.queue.findUnique({
    where: { id: queueId },
    select: {
      id: true,
      name: true,
      status: true,
      kioskEnabled: true,
      branch: {
        select: {
          name: true,
          organization: { select: { id: true, name: true, logoUrl: true } },
        },
      },
      currentTicket: { select: { ticketNumber: true } },
    },
  });
  if (!queue) throw AppError.notFound("Queue not found");

  const [waiting, waitingCount] = await db.$transaction([
    db.ticket.findMany({
      where: { queueId, status: "WAITING" },
      orderBy: [{ joinedAt: "asc" }, { ticketNumber: "asc" }],
      take: limit,
      select: { ticketNumber: true },
    }),
    db.ticket.count({ where: { queueId, status: "WAITING" } }),
  ]);

  return {
    queue: {
      id: queue.id,
      name: queue.name,
      status: queue.status,
      organizationId: queue.branch.organization.id,
      organizationName: queue.branch.organization.name,
      organizationLogoUrl: queue.branch.organization.logoUrl,
      branchName: queue.branch.name,
    },
    currentTicketNumber: queue.currentTicket?.ticketNumber ?? null,
    waiting: waiting.map((ticket, index) => ({
      ticketNumber: ticket.ticketNumber,
      position: index + 1,
    })),
    waitingCount,
    kioskEnabled: queue.kioskEnabled,
    updatedAt: new Date().toISOString(),
  };
}
