import { db } from "@/lib/db";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

/**
 * Phase 1 — Super Admin platform panel.
 *
 * Verifies the dedicated platform surface: global organization directory,
 * consolidated finance, global audit trail, moderation (suspend/reactivate) and
 * the guarded permanent deletion. It also re-checks that the platform routes do
 * NOT weaken tenant isolation (tenant routes stay 403 for ADMINISTRATOR).
 */
export async function runPlatformAdminSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "platform-admin-suite");
    userIds.push(admin.userId);

    // Two organizations to prove the listing is global, not scoped.
    const [orgA, orgB] = await Promise.all([
      admin.client.post<{ id: string }>("/api/organizations", {
        name: `Panel Organization A ${Date.now()}`,
      }),
      admin.client.post<{ id: string }>("/api/organizations", {
        name: `Panel Organization B ${Date.now()}`,
      }),
    ]);
    // Organization creation stays on the tenant route (allowed for the platform
    // admin); the panel reads it back through the platform surface.
    reporter.equal("platform admin: creates organization A", orgA.status, 201);
    reporter.equal("platform admin: creates organization B", orgB.status, 201);
    if (!orgA.data || !orgB.data) return;
    const organizationAId = orgA.data.id;
    const organizationBId = orgB.data.id;
    organizationIds.push(organizationAId, organizationBId);

    // Operational fixture inside organization A.
    const branch = await db.branch.create({
      data: { organizationId: organizationAId, name: `Panel Branch ${Date.now()}` },
    });
    const queue = await db.queue.create({
      data: {
        organizationId: organizationAId,
        branchId: branch.id,
        name: `Panel Queue ${Date.now()}`,
        status: "OPEN",
      },
    });
    const managerUser = await createUser(baseUrl, "panel-manager");
    userIds.push(managerUser.userId);
    await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
    await db.organizationMember.create({
      data: { userId: managerUser.userId, organizationId: organizationAId, role: "MANAGER" },
    });
    const manager = await loginUser(baseUrl, managerUser.email);

    const customer = await createUser(baseUrl, "panel-customer");
    userIds.push(customer.userId);
    const ticket = await customer.client.post<{ id: string }>(
      `/api/queues/${queue.id}/tickets`,
    );
    reporter.equal("platform admin: ticket fixture created", ticket.status, 201);

    /* ------------------------------------------------------------------ */
    /* Global directory                                                     */
    /* ------------------------------------------------------------------ */

    const directory = await admin.client.get<{
      items: {
        id: string;
        name: string;
        status: string;
        subscription: { plan: { code: string } } | null;
        counts: { branches: number; queues: number; members: number };
      }[];
      total: number;
    }>("/api/admin/organizations?pageSize=100");
    reporter.equal("platform admin: lists organizations globally", directory.status, 200);
    const ids = (directory.data?.items ?? []).map((item) => item.id);
    reporter.check(
      "platform admin: directory includes both organizations",
      ids.includes(organizationAId) && ids.includes(organizationBId),
    );
    const rowA = directory.data?.items.find((item) => item.id === organizationAId);
    reporter.check(
      "platform admin: directory row carries plan and counts",
      rowA?.subscription?.plan.code === "trial" &&
        rowA?.counts.branches === 1 &&
        rowA?.counts.queues === 1 &&
        rowA?.counts.members === 1,
      JSON.stringify(rowA?.counts ?? {}),
    );

    const filtered = await admin.client.get<{ items: { id: string }[] }>(
      `/api/admin/organizations?status=SUSPENDED&pageSize=100`,
    );
    reporter.equal("platform admin: filters organizations by status", filtered.status, 200);
    reporter.check(
      "platform admin: suspended filter excludes active organizations",
      !(filtered.data?.items ?? []).some((item) => item.id === organizationAId),
    );

    const detail = await admin.client.get<{ id: string; branches: { id: string }[] }>(
      `/api/admin/organizations/${organizationAId}`,
    );
    reporter.equal("platform admin: reads organization detail", detail.status, 200);
    reporter.check(
      "platform admin: detail includes branches",
      detail.data?.branches.some((entry) => entry.id === branch.id) ?? false,
    );

    /* ------------------------------------------------------------------ */
    /* Finance                                                              */
    /* ------------------------------------------------------------------ */

    const finance = await admin.client.get<{
      currency: string;
      totals: { revenueCents: number; mrrCents: number; activeSubscriptions: number };
      revenueByPlan: unknown[];
      organizations: { total: number; active: number };
      users: { total: number };
      monthlyRevenue: unknown[];
    }>("/api/admin/finance?months=12");
    reporter.equal("platform admin: reads consolidated finance", finance.status, 200);
    reporter.check(
      "platform admin: finance reports a currency and totals",
      finance.data?.currency === "AOA" &&
        typeof finance.data?.totals.revenueCents === "number" &&
        typeof finance.data?.totals.mrrCents === "number",
    );
    reporter.check(
      "platform admin: finance counts organizations and users",
      (finance.data?.organizations.total ?? 0) >= 2 && (finance.data?.users.total ?? 0) >= 3,
    );

    /* ------------------------------------------------------------------ */
    /* Moderation: suspend / reactivate                                    */
    /* ------------------------------------------------------------------ */

    const suspended = await admin.client.patch<{ status: string }>(
      `/api/admin/organizations/${organizationAId}/status`,
      { status: "SUSPENDED" },
    );
    reporter.equal("platform admin: suspends an organization", suspended.status, 200);
    reporter.equal("platform admin: suspension is persisted", suspended.data?.status, "SUSPENDED");
    const persistedSuspended = await db.organization.findUnique({
      where: { id: organizationAId },
      select: { status: true },
    });
    reporter.equal(
      "platform admin: suspension reaches PostgreSQL",
      persistedSuspended?.status,
      "SUSPENDED",
    );

    const reactivated = await admin.client.patch<{ status: string }>(
      `/api/admin/organizations/${organizationAId}/status`,
      { status: "ACTIVE" },
    );
    reporter.equal("platform admin: reactivates an organization", reactivated.status, 200);
    reporter.equal("platform admin: reactivation is persisted", reactivated.data?.status, "ACTIVE");

    /* ------------------------------------------------------------------ */
    /* Audit trail                                                          */
    /* ------------------------------------------------------------------ */

    const audit = await admin.client.get<{
      items: { action: string; entityType: string | null; entityId: string | null }[];
      total: number;
    }>("/api/admin/audit-logs?pageSize=100");
    reporter.equal("platform admin: reads the global audit trail", audit.status, 200);
    reporter.check(
      "platform admin: audit trail records the status change",
      (audit.data?.items ?? []).some(
        (entry) =>
          entry.action === "platform.organization_status_changed" &&
          entry.entityId === organizationAId,
      ),
    );

    const auditFiltered = await admin.client.get<{ items: { action: string }[] }>(
      "/api/admin/audit-logs?action=platform.organization_deleted&pageSize=100",
    );
    reporter.equal("platform admin: filters audit by action", auditFiltered.status, 200);

    /* ------------------------------------------------------------------ */
    /* Tenant isolation is NOT weakened                                     */
    /* ------------------------------------------------------------------ */

    reporter.equal(
      "platform admin: still denied the tenant organization route",
      (await admin.client.get(`/api/organizations/${organizationAId}`)).status,
      403,
    );
    reporter.equal(
      "platform admin: still denied tenant branch listing",
      (await admin.client.get(`/api/organizations/${organizationAId}/branches`)).status,
      403,
    );

    /* ------------------------------------------------------------------ */
    /* Permanent deletion                                                   */
    /* ------------------------------------------------------------------ */

    const mismatch = await admin.client.request(
      `/api/admin/organizations/${organizationAId}`,
      { method: "DELETE", json: { confirmName: "nome errado" } },
    );
    reporter.equal("platform admin: delete rejects a wrong confirmation name", mismatch.status, 400);

    const deleted = await admin.client.request<{
      deleted: boolean;
      removed: { branches: number; queues: number; tickets: number; members: number };
    }>(`/api/admin/organizations/${organizationAId}`, {
      method: "DELETE",
      json: { confirmName: rowA?.name ?? "" },
    });
    reporter.equal("platform admin: permanently deletes an organization", deleted.status, 200);
    reporter.check(
      "platform admin: deletion reports the cascaded rows",
      deleted.data?.deleted === true &&
        deleted.data.removed.branches === 1 &&
        deleted.data.removed.queues === 1 &&
        deleted.data.removed.tickets === 1 &&
        deleted.data.removed.members === 1,
      JSON.stringify(deleted.data?.removed ?? {}),
    );

    const [orgGone, branchGone, queueGone, ticketsGone] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationAId } }),
      db.branch.findUnique({ where: { id: branch.id } }),
      db.queue.findUnique({ where: { id: queue.id } }),
      db.ticket.count({ where: { queueId: queue.id } }),
    ]);
    reporter.check(
      "platform admin: deletion cascades in PostgreSQL",
      orgGone === null && branchGone === null && queueGone === null && ticketsGone === 0,
    );

    const deletionAudit = await db.auditLog.findFirst({
      where: { action: "platform.organization_deleted", entityId: organizationAId },
    });
    reporter.check(
      "platform admin: deletion audit survives the cascade",
      deletionAudit !== null,
    );
    reporter.check(
      "platform admin: deletion audit captures a snapshot",
      typeof deletionAudit?.metadata === "object" && deletionAudit?.metadata !== null,
    );

    /* ------------------------------------------------------------------ */
    /* Deletion is blocked when there are paid transactions                */
    /* ------------------------------------------------------------------ */

    const orgC = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Panel Organization C ${Date.now()}`,
    });
    reporter.equal("platform admin: creates organization C", orgC.status, 201);
    if (!orgC.data) return;
    const organizationCId = orgC.data.id;
    organizationIds.push(organizationCId);

    const plan = await db.plan.findFirst({ where: { code: "starter" } });
    if (plan) {
      await db.transaction.create({
        data: {
          organizationId: organizationCId,
          planId: plan.id,
          provider: "INVOICE",
          status: "SUCCEEDED",
          amountCents: plan.priceCents,
          currency: plan.currency,
          reference: `PANEL-${Date.now()}`,
          paidAt: new Date(),
        },
      });
    }

    const blocked = await admin.client.request(
      `/api/admin/organizations/${organizationCId}`,
      { method: "DELETE", json: { confirmName: `Panel Organization C` } },
    );
    // The name above is intentionally not exact — a wrong name is rejected
    // first; assert the paid-transaction guard with the exact name.
    reporter.equal("platform admin: delete requires the exact name", blocked.status, 400);

    const orgCRow = await db.organization.findUnique({
      where: { id: organizationCId },
      select: { name: true },
    });
    const blockedExact = await admin.client.request<unknown>(
      `/api/admin/organizations/${organizationCId}`,
      { method: "DELETE", json: { confirmName: orgCRow?.name ?? "" } },
    );
    reporter.errorCode(
      "platform admin: organization with paid transactions cannot be deleted",
      blockedExact,
      409,
      "CONFLICT",
    );
    reporter.check(
      "platform admin: blocked organization is preserved",
      (await db.organization.findUnique({ where: { id: organizationCId } })) !== null,
    );

    /* ------------------------------------------------------------------ */
    /* RBAC: only the platform admin reaches the panel                      */
    /* ------------------------------------------------------------------ */

    const adminPaths = [
      "/api/admin/organizations",
      "/api/admin/finance",
      "/api/admin/audit-logs",
      `/api/admin/organizations/${organizationBId}`,
    ];
    for (const path of adminPaths) {
      reporter.equal(
        `platform admin: manager is denied ${path}`,
        (await manager.client.get(path)).status,
        403,
      );
    }
    reporter.equal(
      "platform admin: manager is denied a status change",
      (
        await manager.client.patch(`/api/admin/organizations/${organizationBId}/status`, {
          status: "SUSPENDED",
        })
      ).status,
      403,
    );
    reporter.equal(
      "platform admin: manager is denied permanent deletion",
      (
        await manager.client.request(`/api/admin/organizations/${organizationBId}`, {
          method: "DELETE",
          json: { confirmName: "x" },
        })
      ).status,
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
