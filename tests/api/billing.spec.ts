/**
 * HTTP suite: plans, subscriptions, checkout, webhook and plan limits.
 *
 * Everything runs over real HTTP against the real PostgreSQL database, and the
 * webhook is exercised as the payment provider would: a signed payload posted
 * to the endpoint. Nothing marks a transaction as paid except that path.
 */
import { db } from "@/lib/db";
import { ApiClient } from "./client";
import { buildSignatureHeader } from "@/server/billing/signature";
import {
  createAdmin,
  createUser,
  type Reporter,
} from "./support";

interface PlanDto {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: string;
  maxBranches: number;
  maxQueuesPerBranch: number;
  maxStaff: number;
}

interface BillingDto {
  subscription: { status: string; currentPeriodEnd: string; planId: string } | null;
  usage: { branches: number; queues: number; staff: number };
  limits: { maxBranches: number; maxQueuesPerBranch: number; maxStaff: number } | null;
  operational: boolean;
}

interface CheckoutDto {
  reference: string;
  checkoutUrl: string | null;
  instructions: string | null;
  transaction: { id: string; status: string; amountCents: number };
}

export async function runBillingSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);

  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  reporter.check(
    "billing: the webhook secret is configured for this run",
    secret.length >= 16,
  );

  /* ---------------------------- catalogue ------------------------------- */

  const planList = await anonymous.get<{ items: PlanDto[] }>("/api/plans");
  reporter.equal("billing: the plan catalogue is public", planList.status, 200);
  const plans = planList.data?.items ?? [];
  reporter.check(
    "billing: the catalogue contains the default plans",
    plans.length >= 4 && plans.some((plan) => plan.code === "trial"),
    `plans=${plans.map((plan) => plan.code).join(",")}`,
  );
  const starterPlan = plans.find((plan) => plan.code === "starter")!;
  const trialPlan = plans.find((plan) => plan.code === "trial")!;
  reporter.check("billing: paid plans carry a price", starterPlan.priceCents > 0);
  reporter.equal("billing: the trial plan is free", trialPlan.priceCents, 0);

  // A real plan row with tiny quotas, so the guard can be exercised cheaply.
  const tinyPlan = await db.plan.upsert({
    where: { code: "test-tiny" },
    update: { maxBranches: 1, maxQueuesPerBranch: 1, maxStaff: 1 },
    create: {
      code: "test-tiny",
      name: "Tiny",
      description: "fixture plan",
      priceCents: 100_000,
      currency: "AOA",
      interval: "MONTHLY",
      maxBranches: 1,
      maxQueuesPerBranch: 1,
      maxStaff: 1,
    },
  });

  /* --------------------------- subscription ----------------------------- */

  const admin = await createAdmin(baseUrl, "billingadmin");
  const customer = await createUser(baseUrl, "billingcustomer");

  const organization = await admin.client.post<{ id: string }>("/api/organizations", {
    name: `Billing ${Date.now()}`,
    city: "Luanda",
  });
  reporter.equal(
    "billing: the administrator creates a billable organization",
    organization.status,
    201,
  );
  const organizationId = organization.data!.id;

  const overview = await admin.client.get<BillingDto>(
    `/api/organizations/${organizationId}/subscription`,
  );
  reporter.equal(
    "billing: a new organization starts on a trial",
    overview.data?.subscription?.status,
    "TRIALING",
  );
  reporter.equal("billing: the trial is operational", overview.data?.operational, true);
  reporter.equal(
    "billing: the limits come from the plan",
    overview.data?.limits?.maxBranches,
    3,
  );

  reporter.equal(
    "billing: a customer cannot read organization billing",
    (await customer.client.get(`/api/organizations/${organizationId}/subscription`)).status,
    403,
  );
  reporter.errorCode(
    "billing: a customer cannot start a checkout",
    await customer.client.post("/api/billing/checkout", {
      organizationId,
      planId: starterPlan.id,
    }),
    403,
    "FORBIDDEN",
  );

  /* ----------------------------- checkout ------------------------------- */

  const checkout = await admin.client.post<CheckoutDto>("/api/billing/checkout", {
    organizationId,
    planId: starterPlan.id,
  });
  reporter.equal(
    "billing: checkout creates a pending transaction",
    checkout.data?.transaction.status,
    "PENDING",
  );
  const reference = checkout.data!.reference;
  reporter.check(
    "billing: checkout returns a payable reference",
    reference.startsWith("FZ-"),
    reference,
  );
  reporter.check(
    "billing: the B2B invoice carries payment instructions",
    typeof checkout.data?.instructions === "string" &&
      checkout.data!.instructions!.includes(reference),
  );
  reporter.equal(
    "billing: starting a checkout does not mark anything as paid",
    (await db.transaction.findUnique({ where: { reference } }))?.status,
    "PENDING",
  );

  /* ------------------------- webhook security --------------------------- */

  const eventBody = (eventId: string) =>
    JSON.stringify({
      id: eventId,
      type: "payment.succeeded",
      data: {
        reference,
        providerReference: "bank-transfer-0001",
        paidAt: new Date().toISOString(),
      },
    });

  reporter.equal(
    "billing: an unsigned webhook is rejected",
    (
      await anonymous.request("/api/billing/webhook", {
        method: "POST",
        rawBody: eventBody("evt_unsigned"),
      })
    ).status,
    401,
  );

  const wrongSecretBody = eventBody("evt_wrong_secret");
  reporter.equal(
    "billing: a webhook signed with another secret is rejected",
    (
      await anonymous.request("/api/billing/webhook", {
        method: "POST",
        rawBody: wrongSecretBody,
        headers: {
          "x-filazero-signature": buildSignatureHeader(
            "whsec_not_the_right_secret",
            wrongSecretBody,
          ),
        },
      })
    ).status,
    401,
  );

  const staleBody = eventBody("evt_stale");
  reporter.equal(
    "billing: a stale signature is rejected (anti-replay window)",
    (
      await anonymous.request("/api/billing/webhook", {
        method: "POST",
        rawBody: staleBody,
        headers: {
          "x-filazero-signature": buildSignatureHeader(
            secret,
            staleBody,
            Math.floor(Date.now() / 1000) - 3_600,
          ),
        },
      })
    ).status,
    400,
  );

  const tamperedBody = eventBody("evt_tampered");
  reporter.equal(
    "billing: a body that does not match the signature is rejected",
    (
      await anonymous.request("/api/billing/webhook", {
        method: "POST",
        rawBody: tamperedBody,
        headers: {
          "x-filazero-signature": buildSignatureHeader(secret, eventBody("evt_other")),
        },
      })
    ).status,
    401,
  );

  reporter.equal(
    "billing: no rejected webhook changed the transaction",
    (await db.transaction.findUnique({ where: { reference } }))?.status,
    "PENDING",
  );

  /* ---------------------- a real, signed confirmation ------------------- */

  const paidBody = eventBody(`evt_paid_${Date.now()}`);
  const paid = await anonymous.request<{
    duplicate: boolean;
    transaction: { status: string };
  }>("/api/billing/webhook", {
    method: "POST",
    rawBody: paidBody,
    headers: { "x-filazero-signature": buildSignatureHeader(secret, paidBody) },
  });
  reporter.equal("billing: a properly signed webhook is accepted", paid.status, 200);
  reporter.equal(
    "billing: the transaction is marked as paid",
    paid.data?.transaction.status,
    "SUCCEEDED",
  );
  reporter.equal("billing: the first application is not a duplicate", paid.data?.duplicate, false);

  const afterPayment = await admin.client.get<BillingDto>(
    `/api/organizations/${organizationId}/subscription`,
  );
  reporter.equal(
    "billing: the subscription becomes active",
    afterPayment.data?.subscription?.status,
    "ACTIVE",
  );
  const firstPeriodEnd = afterPayment.data!.subscription!.currentPeriodEnd;

  const replay = await anonymous.request<{ duplicate: boolean }>(
    "/api/billing/webhook",
    {
      method: "POST",
      rawBody: paidBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, paidBody) },
    },
  );
  reporter.equal("billing: a replayed webhook is idempotent", replay.data?.duplicate, true);
  const afterReplay = await admin.client.get<BillingDto>(
    `/api/organizations/${organizationId}/subscription`,
  );
  reporter.equal(
    "billing: a replay does not extend the period twice",
    afterReplay.data?.subscription?.currentPeriodEnd,
    firstPeriodEnd,
  );

  const unknownBody = JSON.stringify({
    id: `evt_unknown_${Date.now()}`,
    type: "payment.succeeded",
    data: { reference: "FZ-DOES-NOT-EXIST" },
  });
  reporter.errorCode(
    "billing: an unknown reference is rejected",
    await anonymous.request("/api/billing/webhook", {
      method: "POST",
      rawBody: unknownBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, unknownBody) },
    }),
    404,
    "NOT_FOUND",
  );

  /* ----------------------- the payment-blocking flow -------------------- */

  const beforeBlock = await db.branch.count({ where: { organizationId } });
  await db.subscription.update({
    where: { organizationId },
    data: { status: "EXPIRED" },
  });

  reporter.errorCode(
    "billing: an expired subscription blocks branch creation",
    await admin.client.post(`/api/organizations/${organizationId}/branches`, {
      name: "Bloqueada",
    }),
    402,
    "PAYMENT_REQUIRED",
  );
  reporter.equal(
    "billing: the blocked branch was really not created",
    await db.branch.count({ where: { organizationId } }),
    beforeBlock,
  );

  await db.subscription.update({
    where: { organizationId },
    data: { status: "TRIALING", currentPeriodEnd: new Date(Date.now() + 86_400_000) },
  });
  const allowedBranch = await admin.client.post<{ id: string }>(
    `/api/organizations/${organizationId}/branches`,
    { name: "Permitida" },
  );
  reporter.equal(
    "billing: an operational subscription allows branch creation",
    allowedBranch.status,
    201,
  );

  /* --------------------------- quota limits ----------------------------- */

  reporter.equal(
    "billing: the administrator can assign a plan",
    (
      await admin.client.post(`/api/organizations/${organizationId}/subscription`, {
        planId: tinyPlan.id,
      })
    ).status,
    200,
  );
  reporter.errorCode(
    "billing: a free plan cannot be checked out",
    await admin.client.post("/api/billing/checkout", {
      organizationId,
      planId: trialPlan.id,
    }),
    400,
    "BAD_REQUEST",
  );
  reporter.equal(
    "billing: assigning a plan creates no transaction",
    await db.transaction.count({ where: { organizationId, planId: tinyPlan.id } }),
    0,
  );
  reporter.errorCode(
    "billing: exceeding the branch quota is blocked",
    await admin.client.post(`/api/organizations/${organizationId}/branches`, {
      name: "Excedente",
    }),
    403,
    "QUOTA_EXCEEDED",
  );

  const branchForQuota = allowedBranch.data!.id;
  reporter.equal(
    "billing: the first queue fits the quota",
    (
      await admin.client.post(`/api/branches/${branchForQuota}/queues`, {
        name: "Fila 1",
        status: "OPEN",
      })
    ).status,
    201,
  );
  reporter.errorCode(
    "billing: exceeding the queue quota is blocked",
    await admin.client.post(`/api/branches/${branchForQuota}/queues`, {
      name: "Fila 2",
      status: "OPEN",
    }),
    403,
    "QUOTA_EXCEEDED",
  );

  const history = await admin.client.get<{ items: unknown[] }>(
    `/api/organizations/${organizationId}/transactions`,
  );
  reporter.check(
    "billing: the paid transaction appears in the history",
    (history.data?.items.length ?? 0) >= 1,
  );

  const persisted = await db.transaction.findMany({
    where: { organizationId },
    select: { status: true },
  });
  reporter.check(
    "billing: transactions are persisted with their final status",
    persisted.some((transaction) => transaction.status === "SUCCEEDED"),
  );
}
