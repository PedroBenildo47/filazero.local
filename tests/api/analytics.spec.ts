import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

interface AnalyticsResponse {
  totals: { issuedTickets: number; completedTickets: number };
  issuedByDay: Array<{ date: string; count: number }>;
  issuedByWeek: Array<{ weekStart: string; count: number }>;
  queuePerformance: Array<{
    queueId: string;
    averageWaitSeconds: number | null;
    averageServiceSeconds: number | null;
  }>;
  completedByHour: Array<{ hour: number; count: number }>;
}

export async function runAnalyticsSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "analytics-admin");
    userIds.push(admin.userId);

    const orgAResult = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Analytics Scope A ${Date.now()}`,
      category: "Retail",
    });
    const orgBResult = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Analytics Scope B ${Date.now()}`,
      category: "Retail",
    });
    reporter.equal("analytics: organization A fixture is created", orgAResult.status, 201);
    reporter.equal("analytics: organization B fixture is created", orgBResult.status, 201);
    if (!orgAResult.data || !orgBResult.data) return;

    const organizationAId = orgAResult.data.id;
    const organizationBId = orgBResult.data.id;
    organizationIds.push(organizationAId, organizationBId);

    const [branchA, branchB] = await Promise.all([
      db.branch.create({
        data: { organizationId: organizationAId, name: `Analytics Branch A ${Date.now()}` },
      }),
      db.branch.create({
        data: { organizationId: organizationAId, name: `Analytics Branch B ${Date.now()}` },
      }),
    ]);

    async function managerFor(organizationId: string, branchId: string | null, name: string) {
      const user = await createUser(baseUrl, name);
      userIds.push(user.userId);
      await db.user.update({ where: { id: user.userId }, data: { role: "MANAGER" } });
      await db.organizationMember.create({
        data: {
          userId: user.userId,
          organizationId,
          branchId,
          role: "MANAGER",
        },
      });
      return loginUser(baseUrl, user.email);
    }

    const [managerA, managerB] = await Promise.all([
      managerFor(organizationAId, branchA.id, "analytics-manager-a"),
      managerFor(organizationBId, null, "analytics-manager-b"),
    ]);

    const [queueA, queueB] = await Promise.all([
      db.queue.create({
        data: {
          organizationId: organizationAId,
          branchId: branchA.id,
          name: `Analytics Queue A ${Date.now()}`,
          status: "OPEN",
        },
      }),
      db.queue.create({
        data: {
          organizationId: organizationAId,
          branchId: branchB.id,
          name: `Analytics Queue B ${Date.now()}`,
          status: "OPEN",
        },
      }),
    ]);

    const customer = await createUser(baseUrl, "analytics-customer");
    userIds.push(customer.userId);
    const now = Date.now();
    const firstJoinedAt = new Date(now - 90 * 60_000);
    const secondJoinedAt = new Date(now - 60 * 60_000);
    const branchBJoinedAt = new Date(now - 30 * 60_000);

    await db.ticket.createMany({
      data: [
        {
          queueId: queueA.id,
          userId: customer.userId,
          ticketNumber: 1,
          status: "COMPLETED",
          joinedAt: firstJoinedAt,
          servingAt: new Date(firstJoinedAt.getTime() + 5 * 60_000),
          completedAt: new Date(firstJoinedAt.getTime() + 15 * 60_000),
        },
        {
          queueId: queueA.id,
          userId: customer.userId,
          ticketNumber: 2,
          status: "COMPLETED",
          joinedAt: secondJoinedAt,
          servingAt: new Date(secondJoinedAt.getTime() + 10 * 60_000),
          completedAt: new Date(secondJoinedAt.getTime() + 25 * 60_000),
        },
        {
          queueId: queueB.id,
          userId: customer.userId,
          ticketNumber: 1,
          status: "COMPLETED",
          joinedAt: branchBJoinedAt,
          servingAt: new Date(branchBJoinedAt.getTime() + 40 * 60_000),
          completedAt: new Date(branchBJoinedAt.getTime() + 70 * 60_000),
        },
      ],
    });

    const from = new Date(now - 7 * 86_400_000).toISOString();
    const to = new Date(now + 60_000).toISOString();
    const query = new URLSearchParams({ from, to, timezone: "Africa/Luanda" });
    const analytics = await managerA.client.get<AnalyticsResponse>(
      `/api/organizations/${organizationAId}/analytics?${query}`,
    );

    reporter.equal("analytics: authorized branch manager gets a report", analytics.status, 200);
    reporter.equal("analytics: tickets are scoped to the manager branch", analytics.data?.totals.issuedTickets, 2);
    reporter.equal("analytics: completed volume is branch-scoped", analytics.data?.totals.completedTickets, 2);
    reporter.equal("analytics: daily series contains the expected tickets", analytics.data?.issuedByDay.reduce((sum, row) => sum + row.count, 0), 2);
    reporter.equal("analytics: weekly series contains the expected tickets", analytics.data?.issuedByWeek.reduce((sum, row) => sum + row.count, 0), 2);
    reporter.equal("analytics: only the manager's queue is included", analytics.data?.queuePerformance.length, 1);
    reporter.equal("analytics: average wait is measured from join to service", analytics.data?.queuePerformance[0]?.averageWaitSeconds, 450);
    reporter.equal("analytics: average service is measured from service to completion", analytics.data?.queuePerformance[0]?.averageServiceSeconds, 750);
    reporter.equal("analytics: the hourly series covers the whole day", analytics.data?.completedByHour.length, 24);
    reporter.equal("analytics: hourly completed volume matches branch scope", analytics.data?.completedByHour.reduce((sum, row) => sum + row.count, 0), 2);
    reporter.errorCode(
      "analytics: invalid time zones are rejected",
      await managerA.client.get(
        `/api/organizations/${organizationAId}/analytics?timezone=Not_A_Time_Zone`,
      ),
      422,
      "VALIDATION_ERROR",
    );

    reporter.errorCode(
      "analytics: manager from another organization is denied",
      await managerB.client.get(`/api/organizations/${organizationAId}/analytics`),
      403,
      "FORBIDDEN",
    );
    reporter.errorCode(
      "analytics: administrator is denied operational analytics",
      await admin.client.get(`/api/organizations/${organizationAId}/analytics`),
      403,
      "FORBIDDEN",
    );
  } finally {
    if (organizationIds.length > 0) {
      await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
}
