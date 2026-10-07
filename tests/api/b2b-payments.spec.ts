/**
 * HTTP suite: B2B payments (Phase 3).
 *
 * Exercises the three real payment paths over HTTP against PostgreSQL:
 *   - Multicaixa Express (reference + instructions, confirmed by webhook);
 *   - bank transfer with proof upload (PENDING → UNDER_REVIEW → SUCCEEDED);
 *   - Visa/Mastercard (hosted checkout; fails loudly without a Stripe key).
 *
 * It also verifies the sequential invoice numbering, the invoice history and the
 * automatic receipt delivered over a real SMTP conversation. Nothing here marks
 * a payment as paid except the signature-verified webhook.
 */
import { db } from "@/lib/db";
import { buildSignatureHeader } from "@/server/billing/signature";
import { ApiClient } from "./client";
import { SmtpSink, decodeQuotedPrintable } from "./smtp-sink";
import { createAdmin, createUser, loginUser, type Reporter } from "./support";

interface PlanDto {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
}

interface CheckoutDto {
  reference: string;
  method: string;
  checkoutUrl: string | null;
  instructions: string | null;
  transaction: {
    id: string;
    status: string;
    method: string;
    provider: string;
    invoiceNumber: string | null;
  };
}

const pdfBytes = () =>
  new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);

function proofForm(bytes: Uint8Array, name = "comprovativo.pdf"): FormData {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
  return form;
}

export async function runB2BPaymentsSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  const port = Number(process.env.TEST_SMTP_PORT ?? 2525);

  const sink = new SmtpSink();
  await sink.start(port);

  let organizationId = "";
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "b2badmin");
    userIds.push(admin.userId);

    const plansResponse = await anonymous.get<{ items: PlanDto[] }>("/api/plans");
    const starter = plansResponse.data!.items.find((plan) => plan.code === "starter")!;

    const organization = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `B2B ${Date.now()}`,
      city: "Luanda",
    });
    reporter.equal("b2b: the administrator creates the organization", organization.status, 201);
    organizationId = organization.data!.id;

    const billingEmail = `billing.${Date.now()}@api.filazero.test`;
    await db.organization.update({
      where: { id: organizationId },
      data: { email: billingEmail },
    });

    const managerUser = await createUser(baseUrl, "b2b-manager", "ManagerPass123!");
    userIds.push(managerUser.userId);
    await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
    await db.organizationMember.create({
      data: { userId: managerUser.userId, organizationId, role: "MANAGER" },
    });
    const manager = await loginUser(baseUrl, managerUser.email, "ManagerPass123!");

    const customer = await createUser(baseUrl, "b2b-customer");
    userIds.push(customer.userId);

    /* ----------------------- Multicaixa Express -------------------------- */

    const multicaixa = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "MULTICAIXA_EXPRESS",
    });
    reporter.equal(
      "b2b: Multicaixa checkout creates a pending transaction",
      multicaixa.data?.transaction.status,
      "PENDING",
    );
    reporter.equal(
      "b2b: the transaction records the Multicaixa method",
      multicaixa.data?.transaction.method,
      "MULTICAIXA_EXPRESS",
    );
    reporter.equal(
      "b2b: Multicaixa settles through the invoice transport",
      multicaixa.data?.transaction.provider,
      "INVOICE",
    );
    reporter.check(
      "b2b: the Multicaixa reference is quotable",
      (multicaixa.data?.reference ?? "").startsWith("FZ-"),
      multicaixa.data?.reference,
    );
    reporter.check(
      "b2b: Multicaixa returns step-by-step instructions with the reference",
      typeof multicaixa.data?.instructions === "string" &&
        multicaixa.data!.instructions!.includes(multicaixa.data!.reference),
    );

    /* ------------------------ Bank transfer ------------------------------ */

    const bank = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "BANK_TRANSFER",
    });
    reporter.equal(
      "b2b: bank transfer records the method",
      bank.data?.transaction.method,
      "BANK_TRANSFER",
    );
    reporter.equal("b2b: bank transfer starts pending", bank.data?.transaction.status, "PENDING");
    const bankTxId = bank.data!.transaction.id;
    const bankReference = bank.data!.reference;

    /* --------------------------- Card ------------------------------------ */

    const card = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "CARD",
    });
    if (process.env.STRIPE_SECRET_KEY) {
      reporter.equal(
        "b2b: card checkout records the card method",
        card.data?.transaction.method,
        "CARD",
      );
      reporter.check(
        "b2b: card checkout returns a hosted payment page",
        typeof card.data?.checkoutUrl === "string",
      );
    } else {
      reporter.errorCode(
        "b2b: card checkout without a Stripe key fails loudly (never fakes a page)",
        card,
        503,
        "SERVICE_UNAVAILABLE",
      );
      const failedCard = await db.transaction.findFirst({
        where: { organizationId, method: "CARD" },
        orderBy: { createdAt: "desc" },
      });
      reporter.equal(
        "b2b: the failed card attempt is persisted as FAILED with a reason",
        failedCard?.status,
        "FAILED",
      );
    }

    /* ----------------------- Proof upload -------------------------------- */

    reporter.errorCode(
      "b2b: a customer cannot upload a proof of payment",
      await customer.client.postForm(
        `/api/organizations/${organizationId}/transactions/${bankTxId}/proof`,
        proofForm(pdfBytes()),
      ),
      403,
      "FORBIDDEN",
    );
    reporter.errorCode(
      "b2b: the platform admin cannot reach the tenant billing surface",
      await admin.client.postForm(
        `/api/organizations/${organizationId}/transactions/${bankTxId}/proof`,
        proofForm(pdfBytes()),
      ),
      403,
      "FORBIDDEN",
    );

    reporter.errorCode(
      "b2b: a proof that is not a real document is rejected",
      await manager.client.postForm(
        `/api/organizations/${organizationId}/transactions/${bankTxId}/proof`,
        proofForm(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "falso.pdf"),
      ),
      422,
      "VALIDATION_ERROR",
    );

    const uploaded = await manager.client.postForm<{
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
    }>(
      `/api/organizations/${organizationId}/transactions/${bankTxId}/proof`,
      proofForm(pdfBytes()),
    );
    reporter.equal("b2b: a valid proof is accepted", uploaded.status, 201);
    reporter.equal(
      "b2b: the stored proof keeps the sniffed content type",
      uploaded.data?.mimeType,
      "application/pdf",
    );
    reporter.equal(
      "b2b: the proof carries a SHA-256 content hash",
      (uploaded.data?.sha256 ?? "").length,
      64,
    );

    const afterProof = await db.transaction.findUnique({ where: { id: bankTxId } });
    reporter.equal(
      "b2b: uploading a proof moves the transaction to review",
      afterProof?.status,
      "UNDER_REVIEW",
    );
    reporter.check(
      "b2b: the proof timestamp is recorded",
      afterProof?.proofSubmittedAt instanceof Date,
    );
    reporter.equal(
      "b2b: a proof never marks the payment as paid on its own",
      afterProof?.invoiceNumber,
      null,
    );

    const download = await manager.client.get(
      `/api/organizations/${organizationId}/transactions/${bankTxId}/proof`,
    );
    reporter.equal("b2b: the uploaded proof can be downloaded", download.status, 200);
    reporter.check(
      "b2b: the download keeps the stored content type",
      (download.headers.get("content-type") ?? "").includes("application/pdf"),
    );

    /* ------------------- Webhook confirms the review --------------------- */

    const eventBody = JSON.stringify({
      id: `evt_b2b_${Date.now()}`,
      type: "payment.succeeded",
      data: {
        reference: bankReference,
        providerReference: "bank-proof-0001",
        paidAt: new Date().toISOString(),
      },
    });
    const confirmed = await anonymous.request<{
      duplicate: boolean;
      transaction: { status: string; invoiceNumber: string | null };
    }>("/api/billing/webhook", {
      method: "POST",
      rawBody: eventBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, eventBody) },
    });
    reporter.equal(
      "b2b: the signed webhook confirms an under-review payment",
      confirmed.data?.transaction.status,
      "SUCCEEDED",
    );
    const invoiceNumber = confirmed.data?.transaction.invoiceNumber ?? "";
    reporter.check(
      "b2b: a sequential invoice number is assigned on payment",
      /^FT\/\d{4}\/\d{6}$/.test(invoiceNumber),
      invoiceNumber,
    );

    /* ------------------------ Invoice history ---------------------------- */

    const invoices = await manager.client.get<{
      items: Array<{ id: string; invoiceNumber: string; reference: string }>;
    }>(`/api/organizations/${organizationId}/invoices`);
    reporter.equal("b2b: the invoice history responds", invoices.status, 200);
    reporter.check(
      "b2b: the paid invoice appears in the history",
      (invoices.data?.items ?? []).some((item) => item.invoiceNumber === invoiceNumber),
    );
    reporter.errorCode(
      "b2b: a customer cannot read the invoice history",
      await customer.client.get(`/api/organizations/${organizationId}/invoices`),
      403,
      "FORBIDDEN",
    );

    const detail = await manager.client.get<{
      invoiceNumber: string;
      organization: { name: string };
    }>(`/api/organizations/${organizationId}/invoices/${bankTxId}`);
    reporter.equal(
      "b2b: the invoice detail carries the organization",
      detail.data?.organization?.name?.startsWith("B2B"),
      true,
    );

    /* --------------------------- Receipt --------------------------------- */

    const receipt = await sink.waitForEmailTo(billingEmail, 12_000);
    const decoded = decodeQuotedPrintable(receipt.raw);
    reporter.check(
      "b2b: the automatic receipt is delivered to the billing email",
      decoded.includes(invoiceNumber),
    );
    reporter.check("b2b: the receipt names the plan", decoded.includes(starter.name));
    reporter.check(
      "b2b: the receipt shows the amount",
      decoded.includes(`${(starter.priceCents / 100).toFixed(2)} AOA`),
    );
    const paidRow = await db.transaction.findUnique({ where: { id: bankTxId } });
    reporter.check(
      "b2b: the receipt delivery is recorded on the transaction",
      paidRow?.receiptSentAt instanceof Date,
    );

    /* --------------------- Invoice numbering increases ------------------- */

    const second = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "MULTICAIXA_EXPRESS",
    });
    const secondBody = JSON.stringify({
      id: `evt_b2b2_${Date.now()}`,
      type: "payment.succeeded",
      data: { reference: second.data!.reference, paidAt: new Date().toISOString() },
    });
    const secondPaid = await anonymous.request<{
      transaction: { invoiceNumber: string | null };
    }>("/api/billing/webhook", {
      method: "POST",
      rawBody: secondBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, secondBody) },
    });
    const secondInvoice = secondPaid.data?.transaction.invoiceNumber ?? "";
    reporter.check(
      "b2b: invoice numbers are unique and increasing",
      secondInvoice !== invoiceNumber && secondInvoice > invoiceNumber,
      `${invoiceNumber} → ${secondInvoice}`,
    );

    /* ---------------------- Card cannot receive a proof ------------------ */

    const cardTx = await db.transaction.create({
      data: {
        organizationId,
        planId: starter.id,
        provider: "STRIPE",
        method: "CARD",
        status: "PENDING",
        amountCents: starter.priceCents,
        currency: starter.currency,
        reference: `FZ-CARD-${Date.now()}`,
      },
    });
    reporter.errorCode(
      "b2b: card payments cannot receive a manual proof",
      await manager.client.postForm(
        `/api/organizations/${organizationId}/transactions/${cardTx.id}/proof`,
        proofForm(pdfBytes()),
      ),
      400,
      "BAD_REQUEST",
    );
  } finally {
    await sink.stop();
    if (organizationId) {
      await db.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
