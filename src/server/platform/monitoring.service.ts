/**
 * Platform monitoring for the owner's control room.
 *
 * Three read-only views over real, persisted data (no mocks):
 *   - `getPlatformOverview` — global KPIs, real-time activity and growth;
 *   - `getPlatformAlerts`   — heuristic alerts for suspicious/anomalous states;
 *   - `getSystemHealth`     — database latency, process/system metrics and the
 *                             operational counters an operator needs.
 *
 * All three are platform-admin only (`platform:admin`).
 *
 * Privacy: the platform owner never sees the customers of a tenant. Alerts and
 * KPIs are aggregated counts and organization-level metadata only — never a
 * ticket holder's name, phone or the private notes staff write on tickets.
 */
import "server-only";
import os from "node:os";
import type { AuthContext } from "@/server/context";
import { assertPlatformAdmin } from "@/server/context";
import { db } from "@/lib/db";
import { listAuditLogs } from "./audit.service";

export const PLATFORM_TIMEZONE = "Africa/Luanda";

/* -------------------------------------------------------------------------- */
/* Time helpers (Angola is UTC+1 all year, no DST)                             */
/* -------------------------------------------------------------------------- */

const LUANDA_OFFSET_MS = 60 * 60 * 1000;

/** Start of the current day in Luanda, as an absolute instant. */
export function luandaDayStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLATFORM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year = 1970, month = 1, day = 1] = parts.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - LUANDA_OFFSET_MS);
}

/** `YYYY-MM-DD` of an instant in the Luanda timezone. */
function luandaDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PLATFORM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Monday (Luanda) of the ISO week that contains `date`. */
function weekStart(date: Date): Date {
  const start = luandaDayStart(date);
  const weekday = new Date(start.getTime() + LUANDA_OFFSET_MS).getUTCDay(); // 0=Sun..6=Sat
  const diff = (weekday + 6) % 7; // days since Monday
  return new Date(start.getTime() - diff * 86_400_000);
}

function monthStart(date: Date): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLATFORM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).format(date);
  const [year = 1970, month = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - LUANDA_OFFSET_MS);
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export interface GrowthBucket {
  label: string;
  count: number;
}

export interface PlatformOverview {
  generatedAt: string;
  organizations: { total: number; active: number; suspended: number; inactive: number };
  users: { total: number; active: number; managers: number; staff: number; customers: number };
  activity: {
    activeQueues: number;
    pausedQueues: number;
    waitingTickets: number;
    ticketsToday: number;
    completedToday: number;
    noShowToday: number;
  };
  growth: {
    organizationsByWeek: GrowthBucket[];
    organizationsByMonth: GrowthBucket[];
    usersByWeek: GrowthBucket[];
  };
}

function bucketize(
  dates: Date[],
  buckets: { key: string; label: string; from: Date; to: Date }[],
): GrowthBucket[] {
  const counts = new Map(buckets.map((bucket) => [bucket.key, 0]));
  for (const date of dates) {
    for (const bucket of buckets) {
      if (date >= bucket.from && date < bucket.to) {
        counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
        break;
      }
    }
  }
  return buckets.map((bucket) => ({ label: bucket.label, count: counts.get(bucket.key) ?? 0 }));
}

export async function getPlatformOverview(ctx: AuthContext): Promise<PlatformOverview> {
  assertPlatformAdmin(ctx);
  const now = new Date();
  const todayStart = luandaDayStart(now);

  const [
    orgsTotal,
    orgsActive,
    orgsSuspended,
    orgsInactive,
    usersTotal,
    usersActive,
    managers,
    staff,
    customers,
    activeQueues,
    pausedQueues,
    waitingTickets,
    ticketsToday,
    completedToday,
    noShowToday,
  ] = await db.$transaction([
    db.organization.count(),
    db.organization.count({ where: { status: "ACTIVE" } }),
    db.organization.count({ where: { status: "SUSPENDED" } }),
    db.organization.count({ where: { status: "INACTIVE" } }),
    db.user.count(),
    db.user.count({ where: { status: "ACTIVE" } }),
    db.user.count({ where: { role: "MANAGER" } }),
    db.user.count({ where: { role: "STAFF" } }),
    db.user.count({ where: { role: "CUSTOMER" } }),
    db.queue.count({ where: { status: "OPEN" } }),
    db.queue.count({ where: { status: "PAUSED" } }),
    db.ticket.count({ where: { status: "WAITING" } }),
    db.ticket.count({ where: { joinedAt: { gte: todayStart } } }),
    db.ticket.count({ where: { completedAt: { gte: todayStart } } }),
    db.ticket.count({ where: { status: "NO_SHOW", updatedAt: { gte: todayStart } } }),
  ]);

  // Growth windows: last 8 ISO weeks and last 6 months.
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const from = weekStart(new Date(now.getTime() - (7 - index) * 7 * 86_400_000));
    return {
      key: luandaDayKey(from),
      label: luandaDayKey(from),
      from,
      to: new Date(from.getTime() + 7 * 86_400_000),
    };
  });
  const months = Array.from({ length: 6 }, (_, index) => {
    const from = monthStart(new Date(now.getFullYear(), now.getMonth() - (5 - index), 1));
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: PLATFORM_TIMEZONE,
      year: "numeric",
      month: "2-digit",
    }).format(from);
    return {
      key,
      label: key,
      from,
      to: monthStart(new Date(from.getFullYear(), from.getMonth() + 1, 1)),
    };
  });

  const windowStart = weeks[0]!.from < months[0]!.from ? weeks[0]!.from : months[0]!.from;
  const [orgDates, userDates] = await db.$transaction([
    db.organization.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
    db.user.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    organizations: {
      total: orgsTotal,
      active: orgsActive,
      suspended: orgsSuspended,
      inactive: orgsInactive,
    },
    users: {
      total: usersTotal,
      active: usersActive,
      managers,
      staff,
      customers,
    },
    activity: {
      activeQueues,
      pausedQueues,
      waitingTickets,
      ticketsToday,
      completedToday,
      noShowToday,
    },
    growth: {
      organizationsByWeek: bucketize(orgDates.map((row) => row.createdAt), weeks),
      organizationsByMonth: bucketize(orgDates.map((row) => row.createdAt), months),
      usersByWeek: bucketize(userDates.map((row) => row.createdAt), weeks),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                      */
/* -------------------------------------------------------------------------- */

export type AlertSeverity = "high" | "medium" | "low";

export interface PlatformAlert {
  id: string;
  code: string;
  severity: AlertSeverity;
  /** Message key resolved by the UI (i18n). */
  messageKey: string;
  /** Interpolation values for the message key. */
  values: Record<string, string | number>;
  entityType?: string;
  entityId?: string;
  at: string;
}

export async function getPlatformAlerts(ctx: AuthContext): Promise<PlatformAlert[]> {
  assertPlatformAdmin(ctx);
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const alerts: PlatformAlert[] = [];

  const [
    suspendedOrgs,
    nonOperational,
    failedTransactions,
    failedDeliveries,
    newOrgs,
    burstOrgs,
  ] = await Promise.all([
    db.organization.findMany({
      where: { status: "SUSPENDED" },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.subscription.count({
      where: {
        OR: [
          { status: { in: ["PAST_DUE", "EXPIRED", "CANCELLED"] } },
          { currentPeriodEnd: { lt: now }, status: { in: ["TRIALING", "ACTIVE"] } },
        ],
      },
    }),
    db.transaction.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    db.notificationDelivery.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    db.organization.count({ where: { createdAt: { gte: dayAgo } } }),
    db.ticket.groupBy({
      by: ["queueId"],
      where: { joinedAt: { gte: hourAgo } },
      _count: { _all: true },
      orderBy: { _count: { queueId: "desc" } },
      take: 3,
    }),
  ]);

  for (const org of suspendedOrgs) {
    alerts.push({
      id: `suspended-${org.id}`,
      code: "ORGANIZATION_SUSPENDED",
      severity: "medium",
      messageKey: "admin.alert.organizationSuspended",
      values: { name: org.name },
      entityType: "organization",
      entityId: org.id,
      at: org.updatedAt.toISOString(),
    });
  }

  if (nonOperational > 0) {
    alerts.push({
      id: "non-operational-subscriptions",
      code: "NON_OPERATIONAL_SUBSCRIPTIONS",
      severity: "high",
      messageKey: "admin.alert.nonOperationalSubscriptions",
      values: { count: nonOperational },
      at: now.toISOString(),
    });
  }
  if (failedTransactions > 0) {
    alerts.push({
      id: "failed-transactions",
      code: "FAILED_TRANSACTIONS",
      severity: "medium",
      messageKey: "admin.alert.failedTransactions",
      values: { count: failedTransactions },
      at: now.toISOString(),
    });
  }
  if (failedDeliveries > 0) {
    alerts.push({
      id: "failed-notifications",
      code: "FAILED_NOTIFICATIONS",
      severity: "medium",
      messageKey: "admin.alert.failedNotifications",
      values: { count: failedDeliveries },
      at: now.toISOString(),
    });
  }
  if (newOrgs > 0) {
    alerts.push({
      id: "new-organizations",
      code: "NEW_ORGANIZATIONS",
      severity: "low",
      messageKey: "admin.alert.newOrganizations",
      values: { count: newOrgs },
      at: now.toISOString(),
    });
  }

  // A single queue issuing a very large number of tickets in one hour is a
  // classic sign of automated abuse.
  for (const burst of burstOrgs) {
    const count = burst._count._all;
    if (count < 100) continue;
    alerts.push({
      id: `burst-${burst.queueId}`,
      code: "TICKET_BURST",
      severity: "high",
      messageKey: "admin.alert.ticketBurst",
      values: { count },
      entityType: "queue",
      entityId: burst.queueId,
      at: now.toISOString(),
    });
  }

  const order: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* -------------------------------------------------------------------------- */
/* System health                                                               */
/* -------------------------------------------------------------------------- */

export interface SystemHealth {
  status: "ok" | "degraded";
  generatedAt: string;
  database: { reachable: boolean; latencyMs: number | null };
  process: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    nodeVersion: string;
  };
  system: {
    platform: string;
    cpuCount: number;
    loadAverage1m: number;
    freeMemoryBytes: number;
    totalMemoryBytes: number;
  };
  counters: {
    pendingTransactions: number;
    failedTransactions24h: number;
    pendingNotifications: number;
    failedNotifications24h: number;
    activeQueues: number;
    waitingTickets: number;
  };
  recentAudit: {
    id: string;
    action: string;
    entityType: string | null;
    description: string | null;
    createdAt: string;
    actor: { name: string; email: string } | null;
  }[];
}

export async function getSystemHealth(ctx: AuthContext): Promise<SystemHealth> {
  assertPlatformAdmin(ctx);

  let reachable = true;
  let latencyMs: number | null = null;
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    latencyMs = Date.now() - started;
  } catch {
    reachable = false;
  }

  const dayAgo = new Date(Date.now() - 86_400_000);
  const [
    pendingTransactions,
    failedTransactions24h,
    pendingNotifications,
    failedNotifications24h,
    activeQueues,
    waitingTickets,
  ] = await db.$transaction([
    db.transaction.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    db.transaction.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    db.notificationDelivery.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    db.notificationDelivery.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    db.queue.count({ where: { status: "OPEN" } }),
    db.ticket.count({ where: { status: "WAITING" } }),
  ]);
  const recentAudit = await listAuditLogs(ctx, { page: 1, pageSize: 10 });

  const memory = process.memoryUsage();
  const degraded =
    !reachable || (latencyMs !== null && latencyMs > 250) || failedNotifications24h > 25;

  return {
    status: degraded ? "degraded" : "ok",
    generatedAt: new Date().toISOString(),
    database: { reachable, latencyMs },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      nodeVersion: process.version,
    },
    system: {
      platform: `${os.platform()} ${os.release()}`,
      cpuCount: os.cpus().length,
      loadAverage1m: os.loadavg()[0] ?? 0,
      freeMemoryBytes: os.freemem(),
      totalMemoryBytes: os.totalmem(),
    },
    counters: {
      pendingTransactions,
      failedTransactions24h,
      pendingNotifications,
      failedNotifications24h,
      activeQueues,
      waitingTickets,
    },
    recentAudit: recentAudit.items.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      description: entry.description,
      createdAt: entry.createdAt.toISOString(),
      actor: entry.actor ? { name: entry.actor.name, email: entry.actor.email } : null,
    })),
  };
}
