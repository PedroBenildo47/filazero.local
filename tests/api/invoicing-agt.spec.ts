/**
 * HTTP suite: fiscal invoicing and AGT compliance (Phase 4, Block 1).
 *
 * Verifies over the real HTTP surface, backed by PostgreSQL, that a confirmed
 * payment issues a legal fiscal document: an official series number
 * (`FR<ano>/<sequência>`), the VAT breakdown derived from the gross amount, the
 * issuer and customer NIF, an integrity hash and QR payload, and a downloadable
 * PDF. Nothing here marks a payment as paid except the signed webhook.
 */
import { db } from "@/lib/db";
import { buildSignatureHeader } from "@/server/billing/signature";
import { ApiClient } from "./client";
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
  transaction: { id: string; status: string };
}

interface InvoiceDetailDto {
  invoiceNumber: string | null;
  documentType: string;
  seriesCode: string | null;
  sequence: number | null;
  amountCents: number;
  currency: string;
  subtotalCents: number | null;
  vatCents: number | null;
  vatRateBps: number | null;
  customerTaxId: string | null;
  issuerTaxId: string | null;
  invoiceHash: string | null;
  invoiceIssuedAt: string | null;
  agtCertified: boolean;
  organization: { name: string };
}

export async function runInvoicingAgtSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  const issuerNif = process.env.PLATFORM_TAX_ID ?? null;
  const year = new Date().getUTCFullYear();

  let organizationId = "";
  const userIds: string[] = [];

  try {
    const admin = await createAdmin(baseUrl, "agtadmin");
    userIds.push(admin.userId);

    const plansResponse = await anonymous.get<{ items: PlanDto[] }>("/api/plans");
    const starter = plansResponse.data!.items.find((plan) => plan.code === "starter")!;

    const organization = await admin.client.post<{ id: string }>("/api/organizations", {
      name: `AGT ${Date.now()}`,
      city: "Luanda",
    });
    organizationId = organization.data!.id;

    // The organization carries the taxpayer NIF used when the payer does not
    // supply one at checkout.
    const orgNif = "5417000000";

    const managerUser = await createUser(baseUrl, "agt-manager", "ManagerPass123!");
    userIds.push(managerUser.userId);
    await db.user.update({ where: { id: managerUser.userId }, data: { role: "MANAGER" } });
    await db.organizationMember.create({
      data: { userId: managerUser.userId, organizationId, role: "MANAGER" },
    });
    const manager = await loginUser(baseUrl, managerUser.email, "ManagerPass123!");

    // The NIF is edited through the real organization API and echoed back.
    const patched = await manager.client.patch<{ taxId: string | null }>(
      `/api/organizations/${organizationId}`,
      { taxId: orgNif },
    );
    reporter.equal(
      "agt: the organization NIF is editable through the API",
      patched.data?.taxId,
      orgNif,
    );
    reporter.errorCode(
      "agt: an invalid organization NIF is rejected",
      await manager.client.patch(`/api/organizations/${organizationId}`, { taxId: "12" }),
      422,
      "VALIDATION_ERROR",
    );

    const customer = await createUser(baseUrl, "agt-customer");
    userIds.push(customer.userId);

    /* --------------------------- NIF validation -------------------------- */

    reporter.errorCode(
      "agt: an invalid NIF is rejected at checkout",
      await manager.client.post("/api/billing/checkout", {
        organizationId,
        planId: starter.id,
        method: "MULTICAIXA_EXPRESS",
        taxId: "123",
      }),
      422,
      "VALIDATION_ERROR",
    );

    /* -------------------- Invoice 1: NIF from the org -------------------- */

    const first = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "MULTICAIXA_EXPRESS",
    });
    const firstTxId = first.data!.transaction.id;
    const firstBody = JSON.stringify({
      id: `evt_agt1_${Date.now()}`,
      type: "payment.succeeded",
      data: { reference: first.data!.reference, paidAt: new Date().toISOString() },
    });
    const firstPaid = await anonymous.request<{ transaction: { status: string } }>(
      "/api/billing/webhook",
      {
        method: "POST",
        rawBody: firstBody,
        headers: { "x-filazero-signature": buildSignatureHeader(secret, firstBody) },
      },
    );
    reporter.equal(
      "agt: the signed webhook confirms the payment",
      firstPaid.data?.transaction.status,
      "SUCCEEDED",
    );

    const invoice1 = await manager.client.get<InvoiceDetailDto>(
      `/api/organizations/${organizationId}/invoices/${firstTxId}`,
    );
    const inv = invoice1.data!;
    const expectedSeries = `FR${year}`;

    reporter.check(
      "agt: the invoice number follows the official series format",
      /^FR\d{4}\/\d{6}$/.test(inv.invoiceNumber ?? ""),
      inv.invoiceNumber ?? "",
    );
    reporter.equal(
      "agt: the invoice is a Factura-Recibo (FR)",
      inv.documentType,
      "FR",
    );
    reporter.equal(
      "agt: the series code is document type + year",
      inv.seriesCode,
      expectedSeries,
    );
    reporter.equal("agt: the first invoice in the series is number 1", inv.sequence, 1);
    reporter.equal("agt: the standard IVA rate is 14%", inv.vatRateBps, 1400);
    reporter.check(
      "agt: net + IVA equals the gross amount charged",
      (inv.subtotalCents ?? 0) + (inv.vatCents ?? 0) === inv.amountCents,
      `${inv.subtotalCents} + ${inv.vatCents} = ${inv.amountCents}`,
    );
    reporter.equal(
      "agt: the IVA is derived from the IVA-inclusive amount",
      inv.vatCents,
      inv.amountCents - Math.round((inv.amountCents * 10_000) / 11_400),
    );
    reporter.equal(
      "agt: the customer NIF falls back to the organization's NIF",
      inv.customerTaxId,
      orgNif,
    );
    if (issuerNif) {
      reporter.equal("agt: the issuer NIF is printed on the document", inv.issuerTaxId, issuerNif);
    }
    reporter.check(
      "agt: the invoice carries an integrity hash",
      typeof inv.invoiceHash === "string" && inv.invoiceHash.length >= 32,
      `${(inv.invoiceHash ?? "").slice(0, 12)}…`,
    );
    reporter.equal(
      "agt: without a certificate key the document is not marked AGT-certified",
      inv.agtCertified,
      false,
    );
    reporter.check(
      "agt: the issuance timestamp is recorded",
      typeof inv.invoiceIssuedAt === "string" && !Number.isNaN(Date.parse(inv.invoiceIssuedAt)),
    );

    const row1 = await db.transaction.findUnique({ where: { id: firstTxId } });
    reporter.check(
      "agt: the QR payload encodes the invoice number",
      (row1?.invoiceQr ?? "").includes(inv.invoiceNumber ?? "___"),
    );

    /* ---------------- Invoice 2: explicit NIF at checkout ---------------- */

    const second = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "MULTICAIXA_EXPRESS",
      taxId: "500 123 456",
    });
    const secondTxId = second.data!.transaction.id;
    const secondBody = JSON.stringify({
      id: `evt_agt2_${Date.now()}`,
      type: "payment.succeeded",
      data: { reference: second.data!.reference, paidAt: new Date().toISOString() },
    });
    await anonymous.request("/api/billing/webhook", {
      method: "POST",
      rawBody: secondBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, secondBody) },
    });

    const invoice2 = await manager.client.get<InvoiceDetailDto>(
      `/api/organizations/${organizationId}/invoices/${secondTxId}`,
    );
    const inv2 = invoice2.data!;
    reporter.equal(
      "agt: the NIF supplied at checkout is normalised and used",
      inv2.customerTaxId,
      "500123456",
    );
    reporter.equal(
      "agt: the second document advances the series",
      inv2.sequence,
      2,
    );
    reporter.check(
      "agt: the two invoices have distinct numbers",
      inv2.invoiceNumber !== inv.invoiceNumber,
      `${inv.invoiceNumber} → ${inv2.invoiceNumber}`,
    );

    /* ---------------------------- PDF download --------------------------- */

    const pdf = await manager.client.get(
      `/api/organizations/${organizationId}/invoices/${firstTxId}/pdf`,
    );
    reporter.equal("agt: the fiscal PDF downloads", pdf.status, 200);
    reporter.check(
      "agt: the PDF is served as application/pdf",
      (pdf.headers.get("content-type") ?? "").includes("application/pdf"),
    );
    reporter.check(
      "agt: the PDF response carries a real payload",
      Number(pdf.headers.get("content-length") ?? "0") > 500,
      pdf.headers.get("content-length") ?? "0",
    );
    reporter.check(
      "agt: the PDF is offered as a named download",
      (pdf.headers.get("content-disposition") ?? "").includes(".pdf"),
      pdf.headers.get("content-disposition") ?? "",
    );

    reporter.errorCode(
      "agt: a customer cannot download the organization's invoice",
      await customer.client.get(
        `/api/organizations/${organizationId}/invoices/${firstTxId}/pdf`,
      ),
      403,
      "FORBIDDEN",
    );
    reporter.errorCode(
      "agt: the platform admin cannot reach the tenant invoice PDF",
      await admin.client.get(
        `/api/organizations/${organizationId}/invoices/${firstTxId}/pdf`,
      ),
      403,
      "FORBIDDEN",
    );

    /* ------------------- A pending payment has no invoice ---------------- */

    const pending = await manager.client.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "MULTICAIXA_EXPRESS",
    });
    reporter.errorCode(
      "agt: a pending payment has no downloadable invoice",
      await manager.client.get(
        `/api/organizations/${organizationId}/invoices/${pending.data!.transaction.id}/pdf`,
      ),
      400,
      "BAD_REQUEST",
    );
  } finally {
    if (organizationId) {
      await db.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}
