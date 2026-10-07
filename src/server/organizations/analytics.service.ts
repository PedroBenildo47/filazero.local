import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/server/context";
import type { AnalyticsQuery } from "./analytics.schemas";

interface BucketRow {
  bucket: string;
  count: number;
}

interface QueuePerformanceRow {
  queueId: string;
  queueName: string;
  branchId: string;
  branchName: string;
  completedTickets: number;
  averageWaitSeconds: number | null;
  averageServiceSeconds: number | null;
}

function managerBranchScope(
  context: AuthContext,
  organizationId: string,
): string[] | null {
  if (context.user.role !== "MANAGER") throw AppError.forbidden();

  const memberships = context.memberships.filter(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.status === "ACTIVE" &&
      membership.role === "MANAGER",
  );
  if (memberships.length === 0) throw AppError.forbidden();
  if (memberships.some((membership) => membership.branchId === null)) return null;

  return [...new Set(memberships.map((membership) => membership.branchId!))];
}

function branchFilter(branchIds: string[] | null): Prisma.Sql {
  if (branchIds === null) return Prisma.empty;
  if (branchIds.length === 0) return Prisma.sql`AND false`;
  const ids = Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`));
  return Prisma.sql`AND q.branch_id IN (${ids})`;
}

function sumCounts(rows: BucketRow[]): number {
  return rows.reduce((total, row) => total + Number(row.count), 0);
}

export async function getOrganizationAnalytics(
  context: AuthContext,
  organizationId: string,
  query: AnalyticsQuery,
) {
  const branchIds = managerBranchScope(context, organizationId);
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
  const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;

  if (from.getTime() >= to.getTime()) {
    throw AppError.validation("The from date must be earlier than the to date");
  }
  if (rangeDays > 366) {
    throw AppError.validation("Analytics date range cannot exceed 366 days");
  }

  const branchScope = branchFilter(branchIds);
  const [dailyRows, weeklyRows, queueRows, hourlyRows] = await Promise.all([
    db.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', t.joined_at AT TIME ZONE ${query.timezone}), 'YYYY-MM-DD') AS bucket,
             COUNT(*)::int AS count
      FROM tickets t
      INNER JOIN queues q ON q.id = t.queue_id
      WHERE q.organization_id = ${organizationId}::uuid
        ${branchScope}
        AND t.joined_at >= ${from}
        AND t.joined_at < ${to}
      GROUP BY 1
      ORDER BY 1
    `),
    db.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT to_char(date_trunc('week', t.joined_at AT TIME ZONE ${query.timezone}), 'YYYY-MM-DD') AS bucket,
             COUNT(*)::int AS count
      FROM tickets t
      INNER JOIN queues q ON q.id = t.queue_id
      WHERE q.organization_id = ${organizationId}::uuid
        ${branchScope}
        AND t.joined_at >= ${from}
        AND t.joined_at < ${to}
      GROUP BY 1
      ORDER BY 1
    `),
    db.$queryRaw<QueuePerformanceRow[]>(Prisma.sql`
      SELECT q.id AS "queueId",
             q.name AS "queueName",
             b.id AS "branchId",
             b.name AS "branchName",
             COUNT(t.id)::int AS "completedTickets",
             ROUND(AVG(EXTRACT(EPOCH FROM (t.serving_at - t.joined_at)))::numeric)::int AS "averageWaitSeconds",
             ROUND(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.serving_at)))::numeric)::int AS "averageServiceSeconds"
      FROM queues q
      INNER JOIN branches b ON b.id = q.branch_id
      LEFT JOIN tickets t
        ON t.queue_id = q.id
        AND t.status = 'COMPLETED'
        AND t.completed_at >= ${from}
        AND t.completed_at < ${to}
      WHERE q.organization_id = ${organizationId}::uuid
        ${branchScope}
      GROUP BY q.id, q.name, b.id, b.name
      ORDER BY b.name, q.name
    `),
    db.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT EXTRACT(HOUR FROM (t.completed_at AT TIME ZONE ${query.timezone}))::int::text AS bucket,
             COUNT(*)::int AS count
      FROM tickets t
      INNER JOIN queues q ON q.id = t.queue_id
      WHERE q.organization_id = ${organizationId}::uuid
        ${branchScope}
        AND t.status = 'COMPLETED'
        AND t.completed_at IS NOT NULL
        AND t.completed_at >= ${from}
        AND t.completed_at < ${to}
      GROUP BY 1
      ORDER BY 1
    `),
  ]);

  const hourlyCounts = new Map(hourlyRows.map((row) => [Number(row.bucket), Number(row.count)]));

  return {
    period: { from: from.toISOString(), to: to.toISOString(), timezone: query.timezone },
    totals: {
      issuedTickets: sumCounts(dailyRows),
      completedTickets: sumCounts(hourlyRows),
    },
    issuedByDay: dailyRows.map((row) => ({ date: row.bucket, count: Number(row.count) })),
    issuedByWeek: weeklyRows.map((row) => ({ weekStart: row.bucket, count: Number(row.count) })),
    queuePerformance: queueRows.map((row) => ({
      ...row,
      completedTickets: Number(row.completedTickets),
      averageWaitSeconds:
        row.averageWaitSeconds === null ? null : Number(row.averageWaitSeconds),
      averageServiceSeconds:
        row.averageServiceSeconds === null ? null : Number(row.averageServiceSeconds),
    })),
    completedByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourlyCounts.get(hour) ?? 0,
    })),
  };
}
