import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

export async function runPlatformSecuritySuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "platform-security-admin");
    userIds.push(admin.userId);

    const [organizationA, organizationB] = await Promise.all([
      admin.client.post<{ id: string }>("/api/organizations", {
        name: `Private Organization A ${Date.now()}`,
      }),
      admin.client.post<{ id: string }>("/api/organizations", {
        name: `Private Organization B ${Date.now()}`,
      }),
    ]);
    reporter.equal("platform security: admin can create organization A", organizationA.status, 201);
    reporter.equal("platform security: admin can create organization B", organizationB.status, 201);
    if (!organizationA.data || !organizationB.data) return;

    const organizationAId = organizationA.data.id;
    const organizationBId = organizationB.data.id;
    organizationIds.push(organizationAId, organizationBId);

    const branch = await db.branch.create({
      data: { organizationId: organizationAId, name: `Private Branch ${Date.now()}` },
    });
    const queue = await db.queue.create({
      data: {
        organizationId: organizationAId,
        branchId: branch.id,
        name: `Private Queue ${Date.now()}`,
        status: "OPEN",
      },
    });

    async function createManager(organizationId: string, branchId: string | null, prefix: string) {
      const user = await createUser(baseUrl, prefix);
      userIds.push(user.userId);
      await db.user.update({ where: { id: user.userId }, data: { role: "MANAGER" } });
      await db.organizationMember.create({
        data: { userId: user.userId, organizationId, branchId, role: "MANAGER" },
      });
      return loginUser(baseUrl, user.email);
    }

    const [managerA, managerB, customer] = await Promise.all([
      createManager(organizationAId, branch.id, "platform-manager-a"),
      createManager(organizationBId, null, "platform-manager-b"),
      createUser(baseUrl, "platform-ticket-customer"),
    ]);
    userIds.push(customer.userId);

    const ticket = await customer.client.post<{ id: string }>(`/api/queues/${queue.id}/tickets`);
    reporter.equal("platform security: customer ticket fixture is created", ticket.status, 201);

    const metrics = await admin.client.get<{
      organizations: { total: number; active: number; suspended: number; inactive: number };
      users: { total: number; active: number };
    }>("/api/admin/metrics");
    reporter.equal("platform security: admin can read global metrics", metrics.status, 200);
    reporter.check(
      "platform security: metrics contain aggregate groups only",
      Object.keys(metrics.data ?? {}).sort().join(",") === "organizations,users" &&
        !JSON.stringify(metrics.data).includes(organizationAId) &&
        !JSON.stringify(metrics.data).includes(organizationBId),
    );
    reporter.check(
      "platform security: metrics count organizations and users",
      (metrics.data?.organizations.total ?? 0) >= 2 && (metrics.data?.users.total ?? 0) >= 4,
    );

    const adminDeniedRoutes = [
      "/api/organizations",
      `/api/organizations/${organizationAId}`,
      `/api/organizations/${organizationAId}/branches`,
      `/api/organizations/${organizationAId}/members`,
      `/api/organizations/${organizationAId}/transactions`,
      `/api/branches/${branch.id}/queues`,
      `/api/queues/${queue.id}/state`,
      `/api/queues/${queue.id}/staff`,
      `/api/queues/${queue.id}/stream`,
      "/api/tickets/me",
      `/api/tickets/${ticket.data?.id}`,
    ];
    for (const path of adminDeniedRoutes) {
      reporter.equal(
        `platform security: admin is denied ${path}`,
        (await admin.client.get(path)).status,
        403,
      );
    }

    reporter.equal(
      "platform security: manager can read own organization",
      (await managerA.client.get(`/api/organizations/${organizationAId}`)).status,
      200,
    );
    reporter.equal(
      "platform security: manager is denied another organization",
      (await managerA.client.get(`/api/organizations/${organizationBId}`)).status,
      403,
    );
    reporter.equal(
      "platform security: manager cannot read global metrics",
      (await managerA.client.get("/api/admin/metrics")).status,
      403,
    );
    reporter.equal(
      "platform security: unrelated manager cannot read organization A",
      (await managerB.client.get(`/api/organizations/${organizationAId}`)).status,
      403,
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
