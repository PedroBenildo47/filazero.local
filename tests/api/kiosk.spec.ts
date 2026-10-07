/**
 * HTTP suite: kiosk / totem mode (Phase 4 · Block 4).
 *
 * Verifies the whole walk-in path: a manager enables kiosk mode, an anonymous
 * device takes a ticket without an account, and the public board reflects it —
 * plus that kiosk mode is refused everywhere it should be.
 */
import { db } from "@/lib/db";
import { ApiClient } from "./client";
import {
  DEFAULT_PASSWORD,
  createAdmin,
  createUser,
  loginUser,
  uniqueEmail,
  type Reporter,
} from "./support";

interface Board {
  queue: { id: string; name: string; status: string };
  currentTicketNumber: number | null;
  waiting: { ticketNumber: number; position: number }[];
  waitingCount: number;
  kioskEnabled: boolean;
}

export async function runKioskSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;

  const admin = await createAdmin(baseUrl, "kioskadmin");
  const org = await admin.client.post<{ id: string }>("/api/organizations", {
    name: `Quiosque ${Date.now()}`,
    city: "Luanda",
    category: "Saude",
  });
  if (org.status !== 201 || !org.data) throw new Error("could not create organization");

  const managerUser = await createUser(baseUrl, "kioskmanager");
  await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
  await db.organizationMember.create({
    data: { userId: managerUser.userId, organizationId: org.data.id, role: "MANAGER" },
  });
  const manager = await loginUser(baseUrl, managerUser.email);

  const branch = await manager.client.post<{ id: string }>(
    `/api/organizations/${org.data.id}/branches`,
    { name: `Filial ${Date.now()}`, city: "Luanda" },
  );
  const queue = await manager.client.post<{ id: string }>(
    `/api/branches/${branch.data!.id}/queues`,
    { name: `Fila ${Date.now()}`, status: "OPEN" },
  );
  const queueId = queue.data!.id;

  const boardUrl = `/api/public/queues/${queueId}/board`;
  const guestUrl = `/api/public/queues/${queueId}/tickets`;

  const anonymous = new ApiClient(baseUrl);

  const initialBoard = await anonymous.get<Board>(boardUrl);
  reporter.equal("kiosk: board is public", initialBoard.status, 200);
  reporter.equal("kiosk: kiosk mode starts disabled", initialBoard.data?.kioskEnabled, false);

  reporter.errorCode(
    "kiosk: guest tickets are refused while kiosk mode is off",
    await anonymous.post(guestUrl, {}),
    403,
    "FORBIDDEN",
  );

  const customer = await createUser(baseUrl, "kioskcustomer");
  reporter.errorCode(
    "kiosk: a non-manager cannot enable kiosk mode",
    await customer.client.patch(`/api/queues/${queueId}/kiosk`, { enabled: true }),
    403,
    "FORBIDDEN",
  );

  const enabled = await manager.client.patch<{ kioskEnabled: boolean }>(
    `/api/queues/${queueId}/kiosk`,
    { enabled: true },
  );
  reporter.equal("kiosk: a manager enables kiosk mode", enabled.status, 200);
  reporter.equal("kiosk: the queue now reports kiosk enabled", enabled.data?.kioskEnabled, true);

  const guest = await anonymous.post<{ ticketNumber: number; position: number }>(guestUrl, {
    name: "Visitante",
  });
  reporter.equal("kiosk: an anonymous device takes a ticket", guest.status, 201);
  reporter.equal("kiosk: the guest ticket gets number 1", guest.data?.ticketNumber, 1);

  const staffEmail = uniqueEmail("kioskstaff");
  await manager.client.post(`/api/organizations/${org.data.id}/members`, {
    name: "Staff Kiosk",
    email: staffEmail,
    password: DEFAULT_PASSWORD,
    role: "STAFF",
    branchId: branch.data!.id,
  });
  const staff = await loginUser(baseUrl, staffEmail);

  const called = await staff.client.post<{ id: string }>(
    `/api/queues/${queueId}/call-next`,
  );
  reporter.equal("kiosk: staff calls the guest ticket", called.status, 200);

  const boardAfter = await anonymous.get<Board>(boardUrl);
  reporter.equal(
    "kiosk: the board shows the ticket being served",
    boardAfter.data?.currentTicketNumber,
    1,
  );

  reporter.errorCode(
    "kiosk: an unknown queue is not found",
    await anonymous.post("/api/public/queues/00000000-0000-4000-8000-000000000000/tickets", {}),
    404,
    "NOT_FOUND",
  );
}
