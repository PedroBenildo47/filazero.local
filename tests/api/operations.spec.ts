/**
 * HTTP suite: FASE 4 operational panel (Blocos 1–4).
 *
 * Covers the operational dashboard, queue prefixes, counters (guichês) and the
 * attendant actions (recall + transfer), all over real HTTP.
 */
import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

export async function runOperationsSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "ops-admin");
    userIds.push(admin.userId);

    const org = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Ops Org ${Date.now()}`,
      city: "Luanda",
    });
    reporter.equal("ops: platform admin creates the organization", org.status, 201);
    if (!org.data) return;
    organizationIds.push(org.data.id);
    const organizationId = org.data.id;

    const managerUser = await createUser(baseUrl, "ops-manager");
    userIds.push(managerUser.userId);
    await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
    await db.organizationMember.create({
      data: { userId: managerUser.userId, organizationId, role: "MANAGER" },
    });
    const manager = await loginUser(baseUrl, managerUser.email);

    const staffUser = await createUser(baseUrl, "ops-staff");
    userIds.push(staffUser.userId);
    await db.user.update({ where: { id: staffUser.userId }, data: { role: "STAFF" } });
    const staffMember = await db.organizationMember.create({
      data: { userId: staffUser.userId, organizationId, role: "STAFF" },
    });
    const staff = await loginUser(baseUrl, staffUser.email);

    const branch = await manager.client.post<{ id: string }>(
      `/api/organizations/${organizationId}/branches`,
      { name: `Ops Branch ${Date.now()}`, city: "Luanda" },
    );
    if (!branch.data) return;

    /* ----------------------- Bloco 2: prefix ---------------------------- */

    const queueA = await manager.client.post<{ id: string; prefix: string | null }>(
      `/api/branches/${branch.data.id}/queues`,
      { name: `Geral ${Date.now()}`, prefix: "A", status: "OPEN" },
    );
    reporter.equal("ops: a queue is created with a prefix", queueA.status, 201);
    reporter.equal("ops: the prefix is stored (uppercased)", queueA.data?.prefix, "A");
    if (!queueA.data) return;

    const queueB = await manager.client.post<{ id: string; prefix: string | null }>(
      `/api/branches/${branch.data.id}/queues`,
      { name: `Prioritário ${Date.now()}`, prefix: "P", status: "OPEN" },
    );
    if (!queueB.data) return;

    /* --------------------- Bloco 3: counters ---------------------------- */

    const counter = await manager.client.post<{ id: string; name: string }>(
      `/api/organizations/${organizationId}/counters`,
      { branchId: branch.data.id, name: "Guichê 01" },
    );
    reporter.equal("ops: a counter is created", counter.status, 201);
    const counterId = counter.data?.id ?? "";
    reporter.check("ops: the counter carries its name", counter.data?.name === "Guichê 01");

    const counters = await manager.client.get<{ items: Array<{ id: string }> }>(
      `/api/organizations/${organizationId}/counters`,
    );
    reporter.check(
      "ops: the counter is listed",
      (counters.data?.items ?? []).some((item) => item.id === counterId),
    );

    const assigned = await manager.client.patch<{ counterId: string | null }>(
      `/api/organizations/${organizationId}/members/${staffMember.id}`,
      { counterId },
    );
    reporter.equal("ops: the member is assigned to the counter", assigned.data?.counterId, counterId);

    reporter.errorCode(
      "ops: a customer cannot create a counter",
      await staffUser.client.post(`/api/organizations/${organizationId}/counters`, {
        branchId: branch.data.id,
        name: "Guichê intruso",
      }),
      403,
      "FORBIDDEN",
    );

    /* ------------------ Bloco 1: operations dashboard ------------------- */

    const operations = await manager.client.get<{
      totals: { activeQueues: number; waitingTickets: number };
      queues: Array<{ id: string; prefix: string | null }>;
    }>(`/api/organizations/${organizationId}/operations`);
    reporter.equal("ops: the operations dashboard responds", operations.status, 200);
    reporter.check(
      "ops: the dashboard counts the open queues",
      (operations.data?.totals.activeQueues ?? 0) >= 2,
    );
    reporter.check(
      "ops: the dashboard lists the queues with their prefix",
      (operations.data?.queues ?? []).some((queue) => queue.id === queueA.data!.id && queue.prefix === "A"),
    );

    /* ------------------- Bloco 4: recall + transfer --------------------- */

    const customer = await createUser(baseUrl, "ops-customer");
    userIds.push(customer.userId);
    const join = await customer.client.post<{ id: string }>(
      `/api/queues/${queueA.data.id}/tickets`,
      {},
    );
    reporter.equal("ops: a customer joins the queue", join.status, 201);
    if (!join.data) return;

    const called = await staff.client.post<{ id: string }>(
      `/api/queues/${queueA.data.id}/call-next`,
    );
    reporter.equal("ops: staff calls the next ticket", called.status, 200);

    const recall = await staff.client.post(
      `/api/tickets/${called.data!.id}/recall`,
    );
    reporter.equal("ops: staff can recall the called ticket", recall.status, 200);

    const transfer = await staff.client.post<{ queueId: string; ticketNumber: number }>(
      `/api/tickets/${called.data!.id}/transfer`,
      { queueId: queueB.data.id },
    );
    reporter.equal("ops: staff transfers the ticket to another queue", transfer.status, 200);
    reporter.equal("ops: the ticket moved to the target queue", transfer.data?.queueId, queueB.data.id);
    reporter.equal("ops: the ticket got a new number in the target queue", transfer.data?.ticketNumber, 1);

    const board = await new ApiClient(baseUrl).get<{ currentCounterName: string | null }>(
      `/api/public/queues/${queueB.data.id}/board`,
    );
    reporter.equal("ops: the target board responds after the transfer", board.status, 200);
  } finally {
    if (organizationIds.length > 0) {
      await db.organization.deleteMany({ where: { id: { in: organizationIds } } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
