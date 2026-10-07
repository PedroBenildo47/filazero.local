import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

/**
 * Phase 2 — QR codes and customer entry.
 *
 * Verifies that a freshly created queue is immediately reachable by customers
 * through every entry path: the public directory, a QR payload (public code) and
 * a direct link (UUID). It also checks that platform moderation (suspension)
 * is reflected in the public interface at once, and that codes are unique.
 */
interface DirectoryQueue {
  id: string;
  publicCode: string;
  status: string;
}
interface DirectoryResponse {
  items: { branches: { queues: DirectoryQueue[] }[] }[];
}

export async function runQueueEntrySuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "entry-admin");
    userIds.push(admin.userId);

    const organization = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Entry Organization ${Date.now()}`,
      city: "Luanda",
    });
    reporter.equal("entry: platform admin creates the organization", organization.status, 201);
    if (!organization.data) return;
    const organizationId = organization.data.id;
    organizationIds.push(organizationId);

    const managerUser = await createUser(baseUrl, "entry-manager");
    userIds.push(managerUser.userId);
    await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
    await db.organizationMember.create({
      data: { userId: managerUser.userId, organizationId, role: "MANAGER" },
    });
    const manager = await loginUser(baseUrl, managerUser.email);

    const branch = await manager.client.post<{ id: string }>(
      `/api/organizations/${organizationId}/branches`,
      { name: `Entry Branch ${Date.now()}`, city: "Luanda" },
    );
    reporter.equal("entry: manager creates a branch", branch.status, 201);
    if (!branch.data) return;

    const anonymous = new ApiClient(baseUrl);

    /* ------------------------------------------------------------------ */
    /* Queue creation carries a public code                                */
    /* ------------------------------------------------------------------ */

    const queue = await manager.client.post<{ id: string; publicCode: string; status: string }>(
      `/api/branches/${branch.data.id}/queues`,
      { name: `Entry Queue ${Date.now()}`, status: "OPEN" },
    );
    reporter.equal("entry: manager creates an OPEN queue", queue.status, 201);
    const code = queue.data?.publicCode ?? "";
    reporter.check(
      "entry: the created queue carries a short public code",
      /^[A-Z0-9]{6,12}$/.test(code),
      code,
    );

    const second = await manager.client.post<{ id: string; publicCode: string }>(
      `/api/branches/${branch.data.id}/queues`,
      { name: `Entry Queue B ${Date.now()}`, status: "OPEN" },
    );
    reporter.check(
      "entry: public codes are unique per queue",
      Boolean(second.data?.publicCode) && second.data?.publicCode !== code,
    );

    /* ------------------------------------------------------------------ */
    /* Immediate visibility in the public directory (synchronisation)       */
    /* ------------------------------------------------------------------ */

    const directory = await anonymous.get<DirectoryResponse>(
      `/api/public/organizations?q=Entry&pageSize=100`,
    );
    reporter.equal("entry: the public directory responds", directory.status, 200);
    const visible = (directory.data?.items ?? []).some((organization) =>
      organization.branches.some((entry) =>
        entry.queues.some((queueItem) => queueItem.id === queue.data!.id),
      ),
    );
    reporter.check(
      "entry: a freshly created queue is immediately visible in the public directory",
      visible,
    );

    /* ------------------------------------------------------------------ */
    /* QR payload / direct link resolution                                  */
    /* ------------------------------------------------------------------ */

    const byCode = await anonymous.get<{ id: string; publicCode: string }>(
      `/api/queues/${code.toLowerCase()}`,
    );
    reporter.equal("entry: a queue resolves by its public code (case-insensitive)", byCode.status, 200);
    reporter.equal("entry: the code resolves to the same queue", byCode.data?.id, queue.data!.id);

    const byId = await anonymous.get<{ id: string }>(`/api/queues/${queue.data!.id}`);
    reporter.equal("entry: a queue still resolves by its UUID (direct link)", byId.status, 200);

    const unknown = await anonymous.get("/api/queues/ZZZZZZZZ");
    reporter.errorCode("entry: an unknown code is a 404", unknown, 404, "NOT_FOUND");

    // A CLOSED queue still resolves (the QR must always open the queue page),
    // but the customer cannot join it.
    const closed = await manager.client.post<{ id: string; publicCode: string }>(
      `/api/branches/${branch.data.id}/queues`,
      { name: `Entry Closed ${Date.now()}`, status: "CLOSED" },
    );
    const closedByCode = await anonymous.get<{ id: string; status: string }>(
      `/api/queues/${closed.data?.publicCode}`,
    );
    reporter.equal("entry: a closed queue still resolves by code", closedByCode.status, 200);
    reporter.equal("entry: the closed queue reports its status", closedByCode.data?.status, "CLOSED");

    /* ------------------------------------------------------------------ */
    /* Moderation is reflected immediately in the public interface          */
    /* ------------------------------------------------------------------ */

    const suspend = await admin.client.patch(
      `/api/organizations/${organizationId}/status`,
      { status: "SUSPENDED" },
    );
    reporter.equal("entry: platform admin suspends the organization", suspend.status, 200);

    const whileSuspended = await anonymous.get(`/api/queues/${code}`);
    reporter.errorCode(
      "entry: a suspended organization's queue is no longer reachable",
      whileSuspended,
      404,
      "NOT_FOUND",
    );

    await admin.client.patch(`/api/organizations/${organizationId}/status`, {
      status: "ACTIVE",
    });
    const afterReactivate = await anonymous.get(`/api/queues/${code}`);
    reporter.equal(
      "entry: reactivation restores public access immediately",
      afterReactivate.status,
      200,
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
