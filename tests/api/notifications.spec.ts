/**
 * HTTP suite: real SMS and WhatsApp notification delivery (Phase 4 · Block 3).
 *
 * A real HTTP sink stands in for both gateways on localhost. The application is
 * started with `SMS_API_URL` and `WHATSAPP_API_BASE` pointing at it, so the test
 * verifies the whole path — queue event → outbox row → provider request →
 * captured message — instead of asserting against a stub.
 */
import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { NotificationSink } from "./notification-sink";
import {
  DEFAULT_PASSWORD,
  createAdmin,
  createUser,
  loginUser,
  uniqueEmail,
  type Reporter,
} from "./support";

const WHATSAPP_RECIPIENT = "244923111222";
const SMS_RECIPIENT = "+244923111222";

export async function runNotificationChannelsSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const port = Number(process.env.TEST_NOTIFICATION_PORT ?? 2526);

  const sink = new NotificationSink();
  await sink.start(port);

  try {
    /* ---------------------------------------------------------------- */
    /* Fixtures: organization, branch, queue, staff and a customer      */
    /* ---------------------------------------------------------------- */

    const admin = await createAdmin(baseUrl, "notifadmin");
    const org = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Notificacoes ${Date.now()}`,
      city: "Luanda",
      category: "Saude",
    });
    if (org.status !== 201 || !org.data) throw new Error("could not create organization");

    const managerUser = await createUser(baseUrl, "notifmanager");
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

    const staffEmail = uniqueEmail("notifstaff");
    await manager.client.post(`/api/organizations/${org.data.id}/members`, {
      name: "Staff Notif",
      email: staffEmail,
      password: DEFAULT_PASSWORD,
      role: "STAFF",
      branchId: branch.data!.id,
    });
    const staff = await loginUser(baseUrl, staffEmail);

    /* ---------------------------------------------------------------- */
    /* Preferences                                                      */
    /* ---------------------------------------------------------------- */

    const anonymous = new ApiClient(baseUrl);
    reporter.errorCode(
      "notifications: preferences require authentication",
      await anonymous.get("/api/notifications/preferences"),
      401,
      "UNAUTHENTICATED",
    );

    const customer = await createUser(baseUrl, "notifcustomer");
    const initial = await customer.client.get<{
      phone: string | null;
      smsOptIn: boolean;
      whatsappOptIn: boolean;
      whatsappConfigured: boolean;
      smsConfigured: boolean;
    }>("/api/notifications/preferences");
    reporter.equal("notifications: preferences start opted out", initial.data?.whatsappOptIn, false);
    reporter.equal("notifications: WhatsApp provider is configured", initial.data?.whatsappConfigured, true);
    reporter.equal("notifications: SMS provider is configured", initial.data?.smsConfigured, true);

    reporter.errorCode(
      "notifications: an invalid phone is rejected",
      await customer.client.patch("/api/notifications/preferences", {
        phone: "abc",
        whatsappOptIn: true,
      }),
      422,
      "VALIDATION_ERROR",
    );

    const saved = await customer.client.patch<{
      phone: string | null;
      smsOptIn: boolean;
      whatsappOptIn: boolean;
    }>("/api/notifications/preferences", {
      phone: "923 111 222",
      whatsappOptIn: true,
      smsOptIn: true,
    });
    reporter.equal("notifications: preferences are saved", saved.status, 200);
    reporter.equal(
      "notifications: the phone is normalised to E.164",
      saved.data?.phone,
      "+244923111222",
    );

    /* ---------------------------------------------------------------- */
    /* Queue events become real messages                                */
    /* ---------------------------------------------------------------- */

    const join = await customer.client.post<{ id: string; ticketNumber: number }>(
      `/api/queues/${queue.data!.id}/tickets`,
    );
    reporter.equal("notifications: customer joins the queue", join.status, 201);

    const joinWhatsApp = await sink.waitForCondition(() =>
      sink.whatsapp.some((message) => message.message.includes("Entrou na fila")),
    );
    reporter.check("notifications: QUEUE_JOINED is delivered over WhatsApp", joinWhatsApp);
    const joinWhatsAppMessage = sink.whatsapp.find((m) => m.message.includes("Entrou na fila"));
    reporter.check(
      "notifications: the WhatsApp request carries a bearer token",
      (joinWhatsAppMessage?.authorization ?? "").startsWith("Bearer "),
    );
    reporter.check(
      "notifications: the WhatsApp message links back to the account",
      (joinWhatsAppMessage?.message ?? "").includes("/conta"),
    );

    const joinSms = await sink.waitForCondition(() =>
      sink.sms.some((message) => message.message.includes("Entrou na fila")),
    );
    reporter.check("notifications: QUEUE_JOINED is also delivered over SMS", joinSms);
    const joinSmsMessage = sink.sms.find((m) => m.message.includes("Entrou na fila"));
    reporter.equal(
      "notifications: the SMS is sent to the E.164 number",
      joinSmsMessage?.to,
      SMS_RECIPIENT,
    );
    reporter.equal(
      "notifications: the SMS gateway receives the configured sender",
      joinSmsMessage?.sender,
      "FilaZero",
    );

    const called = await staff.client.post<{ id: string }>(
      `/api/queues/${queue.data!.id}/call-next`,
    );
    reporter.equal("notifications: staff calls next", called.status, 200);
    const calledDelivered = await sink.waitForCondition(() =>
      sink.whatsapp.some((message) => message.message.includes("É a sua vez")),
    );
    reporter.check("notifications: CUSTOMER_CALLED is delivered over WhatsApp", calledDelivered);

    const serving = await staff.client.post(`/api/tickets/${called.data!.id}/serve`);
    reporter.equal("notifications: staff starts serving", serving.status, 200);
    const completed = await staff.client.post(`/api/tickets/${called.data!.id}/complete`);
    reporter.equal("notifications: staff completes the service", completed.status, 200);
    const completedDelivered = await sink.waitForCondition(() =>
      sink.sms.some((message) => message.message.includes("Atendimento concluído")),
    );
    reporter.check("notifications: SERVICE_COMPLETED is delivered over SMS", completedDelivered);

    /* ---------------------------------------------------------------- */
    /* In-app only events never hit a channel                           */
    /* ---------------------------------------------------------------- */

    const second = await createUser(baseUrl, "notifsecond");
    await second.client.patch("/api/notifications/preferences", {
      phone: "924 333 444",
      whatsappOptIn: true,
    });
    await second.client.post(`/api/queues/${queue.data!.id}/tickets`);
    // customer's ticket is completed; joining again triggers POSITION_CHANGED
    // for anyone still waiting, which must stay in-app only.
    await customer.client.post(`/api/queues/${queue.data!.id}/tickets`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const positionDeliveries = await db.notificationDelivery.count({
      where: { notification: { type: "POSITION_CHANGED" } },
    });
    reporter.equal(
      "notifications: POSITION_CHANGED never creates an out-of-app delivery",
      positionDeliveries,
      0,
    );

    /* ---------------------------------------------------------------- */
    /* Delivery history and tenancy                                     */
    /* ---------------------------------------------------------------- */

    const history = await customer.client.get<{
      items: { channel: string; status: string; notification: { type: string } }[];
      total: number;
    }>("/api/notifications/deliveries");
    reporter.equal("notifications: delivery history is readable", history.status, 200);
    reporter.check(
      "notifications: history holds sent deliveries",
      (history.data?.items ?? []).some((item) => item.status === "SENT"),
    );
    reporter.check(
      "notifications: history covers both channels",
      new Set((history.data?.items ?? []).map((item) => item.channel)).size === 2,
    );

    const otherHistory = await second.client.get<{
      items: { recipient: string }[];
      total: number;
    }>("/api/notifications/deliveries");
    reporter.check(
      "notifications: a user only sees their own deliveries",
      (otherHistory.data?.items ?? []).length > 0 &&
        (otherHistory.data?.items ?? []).every((item) => item.recipient !== SMS_RECIPIENT),
    );
  } finally {
    await sink.stop();
  }
}
