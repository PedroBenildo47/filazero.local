/**
 * HTTP suite: ATM module (Fase 3).
 *
 * Exercises the public directory, the community report, the staff update and the
 * platform-admin registry — all over real HTTP against PostgreSQL.
 */
import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

interface AtmDto {
  id: string;
  bank: string;
  city: string;
  status: string;
  reportedStatus: string;
  active: boolean;
  fresh: boolean;
}

export async function runAtmsSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);
  const atmIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "atm-admin");
    userIds.push(admin.userId);

    /* --------------------------- create ATM ----------------------------- */

    const created = await admin.client.post<AtmDto>("/api/admin/atms", {
      bank: `Banco Teste ${Date.now()}`,
      label: "Agência Central",
      address: "Rua da Liberdade, 10",
      city: "Luanda",
      province: "Luanda",
      latitude: -8.8383,
      longitude: 13.2344,
      status: "OPERATIONAL",
    });
    reporter.equal("atm: platform admin registers an ATM", created.status, 201);
    const atmId = created.data?.id ?? "";
    if (atmId) atmIds.push(atmId);
    reporter.equal("atm: the new ATM starts with the given status", created.data?.status, "OPERATIONAL");

    /* --------------------------- public list ---------------------------- */

    const list = await anonymous.get<{
      items: AtmDto[];
      total: number;
      cities: string[];
      banks: string[];
    }>("/api/public/atms?city=Luanda&pageSize=100");
    reporter.equal("atm: the public directory responds", list.status, 200);
    reporter.check(
      "atm: the registered ATM is visible publicly",
      (list.data?.items ?? []).some((atm) => atm.id === atmId),
    );
    reporter.check(
      "atm: the directory exposes its filter values",
      (list.data?.cities ?? []).includes("Luanda"),
    );

    const detail = await anonymous.get<AtmDto & { reports: unknown[] }>(
      `/api/public/atms/${atmId}`,
    );
    reporter.equal("atm: the public detail responds", detail.status, 200);
    reporter.equal("atm: the detail reports a fresh status", detail.data?.fresh, true);

    /* ------------------------ community report -------------------------- */

    const report = await anonymous.post<AtmDto>(
      `/api/public/atms/${atmId}/reports`,
      { status: "OUT_OF_CASH", reporterName: "Cidadão" },
    );
    reporter.equal("atm: a community report is accepted", report.status, 201);
    reporter.equal("atm: the community report updates the status", report.data?.reportedStatus, "OUT_OF_CASH");

    const afterReport = await anonymous.get<AtmDto>(`/api/public/atms/${atmId}`);
    reporter.equal(
      "atm: the updated status is public",
      afterReport.data?.reportedStatus,
      "OUT_OF_CASH",
    );

    /* --------------------------- staff update --------------------------- */

    const staffUser = await createUser(baseUrl, "atm-staff");
    userIds.push(staffUser.userId);
    await db.user.update({ where: { id: staffUser.userId }, data: { role: "STAFF" } });
    const staff = await loginUser(baseUrl, staffUser.email);

    // A separate, untouched customer for the permission checks.
    const customer = await createUser(baseUrl, "atm-customer");
    userIds.push(customer.userId);

    const staffReport = await staff.client.request<AtmDto>(
      `/api/atms/${atmId}/status`,
      { method: "PATCH", json: { status: "OPERATIONAL" } },
    );
    reporter.equal("atm: staff can update the status", staffReport.status, 200);
    reporter.equal("atm: the staff update is applied", staffReport.data?.reportedStatus, "OPERATIONAL");

    reporter.errorCode(
      "atm: a customer cannot use the staff route",
      await customer.client.request(`/api/atms/${atmId}/status`, {
        method: "PATCH",
        json: { status: "OFFLINE" },
      }),
      403,
      "FORBIDDEN",
    );

    /* --------------------------- admin lifecycle ------------------------ */

    reporter.errorCode(
      "atm: a customer cannot register an ATM",
      await customer.client.post("/api/admin/atms", {
        bank: "Banco X",
        address: "Rua Y, 1",
        city: "Luanda",
        latitude: -8.8,
        longitude: 13.2,
      }),
      403,
      "FORBIDDEN",
    );

    const deactivated = await admin.client.request<AtmDto>(
      `/api/admin/atms/${atmId}`,
      { method: "PATCH", json: { active: false } },
    );
    reporter.equal("atm: the admin deactivates the ATM", deactivated.status, 200);
    const afterDeactivate = await anonymous.get<AtmDto>(`/api/public/atms/${atmId}`);
    reporter.equal(
      "atm: a deactivated ATM is no longer public",
      afterDeactivate.status,
      404,
    );

    const deleted = await admin.client.request<{ deleted: boolean }>(
      `/api/admin/atms/${atmId}`,
      { method: "DELETE" },
    );
    reporter.equal("atm: the admin deletes the ATM", deleted.status, 200);
    reporter.equal(
      "atm: the ATM is really gone",
      (await db.atm.findUnique({ where: { id: atmId } })) === null,
      true,
    );
  } finally {
    if (atmIds.length > 0) {
      await db.atm.deleteMany({ where: { id: { in: atmIds } } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
