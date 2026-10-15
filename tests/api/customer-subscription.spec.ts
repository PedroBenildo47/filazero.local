/**
 * HTTP suite: end-customer (B2C) subscription.
 *
 * Verifies the free month, the automatic block after it, the Angolan checkout,
 * the webhook activation and the proof upload — all over real HTTP.
 */
import { db } from "@/lib/db";
import { buildSignatureHeader } from "@/server/billing/signature";
import { ApiClient } from "./client";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

const pdfBytes = () =>
  new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);

function proofForm(bytes: Uint8Array, name = "comprovativo.pdf"): FormData {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
  return form;
}

interface CustomerBillingDto {
  operational: boolean;
  effectiveStatus: string | null;
  daysRemaining: number | null;
  subscription: { currentPeriodEnd: string } | null;
}

export async function runCustomerSubscriptionSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "cust-admin");
    userIds.push(admin.userId);

    const org = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `Cust Org ${Date.now()}`,
      city: "Luanda",
    });
    reporter.equal(
      "customer sub: setup creates an organization",
      org.status,
      201,
    );
    if (!org.data) return;
    organizationIds.push(org.data.id);

    // The platform admin creates the organization; a MANAGER of that
    // organization owns the branch/queue (branch:manage is a tenant permission).
    const managerUser = await createUser(baseUrl, "cust-manager");
    userIds.push(managerUser.userId);
    await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
    await db.organizationMember.create({
      data: { userId: managerUser.userId, organizationId: org.data.id, role: "MANAGER" },
    });
    const manager = await loginUser(baseUrl, managerUser.email);

    const branch = await manager.client.post<{ id: string }>(
      `/api/organizations/${org.data.id}/branches`,
      { name: `Cust Branch ${Date.now()}`, city: "Luanda" },
    );
    reporter.equal("customer sub: setup creates a branch", branch.status, 201);
    if (!branch.data) return;
    const queue = await manager.client.post<{ id: string }>(
      `/api/branches/${branch.data.id}/queues`,
      { name: `Cust Queue ${Date.now()}`, status: "OPEN" },
    );
    reporter.equal("customer sub: setup creates an open queue", queue.status, 201);
    if (!queue.data) return;

    /* --------------------------- free month ----------------------------- */

    const customer = await createUser(baseUrl, "cust-user");
    userIds.push(customer.userId);

    const billing = await customer.client.get<CustomerBillingDto>(
      "/api/customer/subscription",
    );
    reporter.equal("customer sub: the endpoint responds", billing.status, 200);
    reporter.equal("customer sub: registration grants a free month", billing.data?.effectiveStatus, "TRIALING");
    reporter.equal("customer sub: the trial is operational", billing.data?.operational, true);
    reporter.check(
      "customer sub: the trial lasts about a month",
      (billing.data?.daysRemaining ?? 0) >= 29 && (billing.data?.daysRemaining ?? 0) <= 31,
      String(billing.data?.daysRemaining),
    );

    const join1 = await customer.client.post<{ id: string }>(
      `/api/queues/${queue.data!.id}/tickets`,
      {},
    );
    reporter.equal("customer sub: a trialing customer can join a queue", join1.status, 201);
    if (join1.data) {
      await customer.client.post(`/api/tickets/${join1.data.id}/leave`, {});
    }

    /* ----------------------- expired trial blocks ----------------------- */

    await db.customerSubscription.update({
      where: { userId: customer.userId },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    reporter.errorCode(
      "customer sub: an expired trial blocks joining a queue",
      await customer.client.post(`/api/queues/${queue.data!.id}/tickets`, {}),
      402,
      "PAYMENT_REQUIRED",
    );

    /* ------------------------- Angolan checkout ------------------------- */

    const checkout = await customer.client.post<{
      payment: { id: string; status: string };
      reference: string;
      instructions: string | null;
    }>("/api/customer/checkout", { method: "MULTICAIXA_EXPRESS" });
    reporter.equal("customer sub: checkout starts a payment", checkout.status, 201);
    reporter.equal("customer sub: the payment is pending", checkout.data?.payment.status, "PENDING");
    reporter.check(
      "customer sub: the reference is quotable",
      (checkout.data?.reference ?? "").startsWith("FZ-"),
      checkout.data?.reference,
    );
    reporter.check(
      "customer sub: Multicaixa returns instructions",
      (checkout.data?.instructions ?? "").includes(checkout.data?.reference ?? "@"),
    );

    const proof = await customer.client.postForm(
      `/api/customer/payments/${checkout.data!.payment.id}/proof`,
      proofForm(pdfBytes()),
    );
    reporter.equal("customer sub: a proof of payment is accepted", proof.status, 201);

    /* --------------------- webhook activates it ------------------------- */

    const eventBody = JSON.stringify({
      id: `evt_cust_${Date.now()}`,
      type: "payment.succeeded",
      data: { reference: checkout.data!.reference, paidAt: new Date().toISOString() },
    });
    const confirmed = await anonymous.request<{
      scope: string;
      transaction: { status: string };
    }>("/api/billing/webhook", {
      method: "POST",
      rawBody: eventBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, eventBody) },
    });
    reporter.equal("customer sub: the webhook routes to the customer scope", confirmed.data?.scope, "customer");
    reporter.equal("customer sub: the payment is confirmed", confirmed.data?.transaction.status, "SUCCEEDED");

    const afterPayment = await customer.client.get<CustomerBillingDto>(
      "/api/customer/subscription",
    );
    reporter.equal("customer sub: the subscription is active", afterPayment.data?.effectiveStatus, "ACTIVE");
    reporter.equal("customer sub: access is restored", afterPayment.data?.operational, true);

    const join2 = await customer.client.post<{ id: string }>(
      `/api/queues/${queue.data!.id}/tickets`,
      {},
    );
    reporter.equal("customer sub: a paid customer can join a queue", join2.status, 201);

    /* ----------------------------- RBAC --------------------------------- */

    const other = await createUser(baseUrl, "cust-other");
    userIds.push(other.userId);
    reporter.errorCode(
      "customer sub: another customer cannot attach a proof to this payment",
      await other.client.postForm(
        `/api/customer/payments/${checkout.data!.payment.id}/proof`,
        proofForm(pdfBytes()),
      ),
      404,
      "NOT_FOUND",
    );
  } finally {
    if (organizationIds.length > 0) {
      await db.organization.deleteMany({ where: { id: { in: organizationIds } } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
