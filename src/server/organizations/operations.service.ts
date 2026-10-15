/**
 * Organization operations dashboard.
 *
 * A real-time, organization-wide view for the manager: which tickets are being
 * served, how many are waiting, today's performance and the per-queue breakdown.
 * Read-only; scoped to the organization.
 */
import "server-only";
import { db } from "@/lib/db";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  type AuthContext,
} from "@/server/context";

/** Start of the current day in Luanda (UTC+1, no DST). */
function luandaDayStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Luanda",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year = 1970, month = 1, day = 1] = parts.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 3_600_000);
}

export async function getOrganizationOperations(
  ctx: AuthContext,
  organizationId: string,
) {
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const todayStart = luandaDayStart();
  const queues = await db.queue.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      prefix: true,
      status: true,
      branch: { select: { id: true, name: true } },
      currentTicket: { select: { ticketNumber: true, status: true } },
      _count: { select: { tickets: { where: { status: "WAITING" } } } },
    },
    orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
  });

  const [
    waitingTickets,
    servingNow,
    ticketsToday,
    completedToday,
    noShowToday,
    completedTodayRows,
  ] = await db.$transaction([
    db.ticket.count({ where: { queue: { organizationId }, status: "WAITING" } }),
    db.ticket.count({
      where: { queue: { organizationId }, status: { in: ["CALLED", "SERVING"] } },
    }),
    db.ticket.count({ where: { queue: { organizationId }, joinedAt: { gte: todayStart } } }),
    db.ticket.count({
      where: { queue: { organizationId }, completedAt: { gte: todayStart } },
    }),
    db.ticket.count({
      where: {
        queue: { organizationId },
        status: "NO_SHOW",
        updatedAt: { gte: todayStart },
      },
    }),
    db.ticket.findMany({
      where: {
        queue: { organizationId },
        status: "COMPLETED",
        completedAt: { gte: todayStart },
        servingAt: { not: null },
      },
      select: { joinedAt: true, servingAt: true, completedAt: true },
    }),
  ]);

  const waitSamples = completedTodayRows.filter(
    (row) => row.servingAt !== null,
  );
  const averageWaitSeconds =
    waitSamples.length === 0
      ? null
      : Math.round(
          waitSamples.reduce(
            (total, row) => total + (row.servingAt!.getTime() - row.joinedAt.getTime()) / 1000,
            0,
          ) / waitSamples.length,
        );

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      activeQueues: queues.filter((queue) => queue.status === "OPEN").length,
      totalQueues: queues.length,
      waitingTickets,
      servingNow,
      ticketsToday,
      completedToday,
      noShowToday,
      averageWaitSeconds,
    },
    queues: queues.map((queue) => ({
      id: queue.id,
      name: queue.name,
      prefix: queue.prefix,
      status: queue.status,
      branchId: queue.branch.id,
      branchName: queue.branch.name,
      waitingCount: queue._count.tickets,
      currentTicketNumber: queue.currentTicket?.ticketNumber ?? null,
      currentTicketStatus: queue.currentTicket?.status ?? null,
    })),
  };
}
