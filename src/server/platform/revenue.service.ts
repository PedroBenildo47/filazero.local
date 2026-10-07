/**
 * Platform operator (Super Admin) — consolidated financial overview.
 *
 * Revenue is derived from real, persisted transactions: only `SUCCEEDED`
 * transactions count, exactly like the B2B billing model. Nothing here can
 * fabricate a payment (there is no admin shortcut that marks a transaction as
 * paid — see docs/BILLING.md).
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPlatformAdmin, type AuthContext } from "@/server/context";
import type { AdminFinanceQuery } from "./platform.schemas";

/** Business timezone for month bucketing (Angola). */
export const PLATFORM_TIMEZONE = "Africa/Luanda";

interface MonthlyRevenueRow {
  month: string;
  amount_cents: bigint | number;
  count: number;
}

/** Monthly-normalised price of a plan (yearly plans are divided by 12). */
export function monthlyPriceCents(priceCents: number, interval: string): number {
  return interval === "YEARLY" ? Math.round(priceCents / 12) : priceCents;
}

export async function getPlatformFinancials(
  ctx: AuthContext,
  query: AdminFinanceQuery,
) {
  assertPlatformAdmin(ctx);

  const months = query.months;
  const now = new Date();
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );

  const [
    totalRevenue,
    paidTransactions,
    pendingAggregate,
    revenueByPlanRows,
    subscriptionStatusRows,
    activeSubscriptions,
    organizationCounts,
    userCounts,
    monthlyRows,
  ] = await Promise.all([
    db.transaction.aggregate({
      where: { status: "SUCCEEDED" },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db.transaction.count({ where: { status: "SUCCEEDED" } }),
    db.transaction.aggregate({
      where: { status: "PENDING" },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ["planId"],
      where: { status: "SUCCEEDED" },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db.subscription.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.subscription.findMany({
      where: { status: "ACTIVE" },
      include: { plan: true },
    }),
    db.organization.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.user.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.$queryRaw<MonthlyRevenueRow[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', paid_at AT TIME ZONE ${PLATFORM_TIMEZONE}), 'YYYY-MM') AS month,
             SUM(amount_cents)::bigint AS amount_cents,
             COUNT(*)::int AS count
      FROM transactions
      WHERE status = 'SUCCEEDED'
        AND paid_at IS NOT NULL
        AND paid_at >= ${from}
      GROUP BY 1
      ORDER BY 1
    `),
  ]);

  const planIds = revenueByPlanRows.map((row) => row.planId);
  const plans = planIds.length
    ? await db.plan.findMany({ where: { id: { in: planIds } } })
    : [];
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  const revenueByPlan = revenueByPlanRows
    .map((row) => {
      const plan = planById.get(row.planId);
      return {
        planId: row.planId,
        code: plan?.code ?? "unknown",
        name: plan?.name ?? "Unknown",
        currency: plan?.currency ?? "AOA",
        revenueCents: Number(row._sum.amountCents ?? 0),
        transactions: row._count._all,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const mrrCents = activeSubscriptions.reduce(
    (total, subscription) =>
      total +
      monthlyPriceCents(
        subscription.plan.priceCents,
        subscription.plan.interval,
      ),
    0,
  );

  const organizationByStatus = Object.fromEntries(
    organizationCounts.map((row) => [row.status, row._count._all]),
  );
  const userByStatus = Object.fromEntries(
    userCounts.map((row) => [row.status, row._count._all]),
  );

  return {
    currency: "AOA",
    period: { months, from: from.toISOString(), to: now.toISOString() },
    totals: {
      revenueCents: Number(totalRevenue._sum.amountCents ?? 0),
      paidTransactions,
      mrrCents,
      activeSubscriptions: activeSubscriptions.length,
      pendingCents: Number(pendingAggregate._sum.amountCents ?? 0),
      pendingTransactions: pendingAggregate._count._all,
    },
    revenueByPlan,
    subscriptionsByStatus: subscriptionStatusRows
      .map((row) => ({ status: row.status, count: row._count._all }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    organizations: {
      total: organizationCounts.reduce((sum, row) => sum + row._count._all, 0),
      active: organizationByStatus.ACTIVE ?? 0,
      suspended: organizationByStatus.SUSPENDED ?? 0,
      inactive: organizationByStatus.INACTIVE ?? 0,
    },
    users: {
      total: userCounts.reduce((sum, row) => sum + row._count._all, 0),
      active: userByStatus.ACTIVE ?? 0,
    },
    monthlyRevenue: monthlyRows.map((row) => ({
      month: row.month,
      revenueCents: Number(row.amount_cents),
      transactions: Number(row.count),
    })),
  };
}
