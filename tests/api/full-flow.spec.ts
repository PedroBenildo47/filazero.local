/**
 * HTTP suite: Fase 4 — end-to-end journey.
 *
 * Walks the whole commercial journey against a live server and a real
 * PostgreSQL, in one continuous chain (nothing is faked):
 *
 *   1. Landing page (public, PT default)
 *   2. Self-registration with logo + NIF (multipart, real files)
 *   3. Plan catalogue selection
 *   4. Checkout with the Angolan methods (QR EMVCo / Multicaixa / transfer)
 *   5. Signature-verified webhook → subscription ACTIVE + fiscal invoice
 *   6. Manager backoffice: update NIF, replace logo, public logo endpoint,
 *      public board carrying the organization logo
 *
 * The self-registration rate limit is scoped per IP/hour; the counter for this
 * scope is reset first because the dedicated registration suite already consumes
 * the whole budget in the same run.
 */
import { db } from "@/lib/db";
import { verifyEmvCoChecksum } from "@/server/billing/qr-payment";
import { buildSignatureHeader } from "@/server/billing/signature";
import { ApiClient } from "./client";
import type { Reporter } from "./support";

/** 1×1 transparent PNG — a real image payload for the logo sniffing check. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF_BYTES = "%PDF-1.7\nFilaZero end-to-end document\n%%EOF";

interface PlanDto {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
}

interface CheckoutDto {
  reference: string;
  checkoutUrl: string | null;
  instructions: string | null;
  qrPayload: string | null;
  transaction: { id: string; status: string; method: string; provider: string };
}

function registrationForm(email: string, taxId: string): FormData {
  const form = new FormData();
  form.set("ownerName", "E2E Owner");
  form.set("ownerEmail", email);
  form.set("password", "Password123!");
  form.set("organizationName", `E2E Journey ${Date.now()}`);
  form.set("category", "Saúde");
  form.set("city", "Luanda");
  form.set("taxId", taxId);
  form.append("logo", new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }), "logo.png");
  for (const type of ["COMPANY_REGISTRATION", "TAX_REGISTRATION"]) {
    form.append(`document.${type}`, new Blob([PDF_BYTES], { type: "application/pdf" }), `${type}.pdf`);
  }
  return form;
}

export async function runFullFlowSuite(options: {
  baseUrl: string;
  reporter: Reporter;
}): Promise<void> {
  const { baseUrl, reporter } = options;
  const anonymous = new ApiClient(baseUrl);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  const bankIban = process.env.BILLING_BANK_IBAN ?? "";

  let organizationId = "";
  let userId = "";

  try {
    /* ------------------------------------------------------------------ */
    /* 1. Landing page                                                     */
    /* ------------------------------------------------------------------ */
    const landing = await anonymous.request("/");
    const landingHtml = await fetch(new URL("/", baseUrl)).then((response) => response.text());
    reporter.equal("e2e: the public landing page renders", landing.status, 200);
    reporter.check(
      "e2e: the landing page is the Portuguese marketing page",
      landingHtml.includes("Menos fila. Mais vida."),
    );

    /* ------------------------------------------------------------------ */
    /* 2. Self-registration with logo + NIF                                */
    /* ------------------------------------------------------------------ */
    // The registration suite in the same run already spends the per-IP budget.
    await db.rateLimitCounter.deleteMany({
      where: { key: { startsWith: "organization:self-register" } },
    });

    const manager = new ApiClient(baseUrl);
    const registered = await manager.postForm<{
      user: { id: string; role: string };
      organization: { id: string; name: string; status: string; taxId: string | null; logoUrl: string | null };
      logo: { url: string | null; uploaded: boolean };
    }>("/api/public/organizations/register", registrationForm(`e2e.${Date.now()}@api.filazero.test`, "5417000000"));

    reporter.equal("e2e: self-registration creates the organization", registered.status, 201);
    organizationId = registered.data?.organization.id ?? "";
    userId = registered.data?.user.id ?? "";
    reporter.equal("e2e: the owner becomes a manager", registered.data?.user.role, "MANAGER");
    reporter.equal("e2e: the NIF is persisted at registration", registered.data?.organization.taxId, "5417000000");
    reporter.equal("e2e: the logo is uploaded at registration", registered.data?.logo.uploaded, true);
    reporter.check(
      "e2e: the session cookie is set for the new manager",
      manager.hasSessionCookie(),
    );

    /* ------------------------------------------------------------------ */
    /* 3. Plan catalogue                                                   */
    /* ------------------------------------------------------------------ */
    const plans = await anonymous.get<{ items: PlanDto[] }>("/api/plans");
    const starter = plans.data?.items.find((plan) => plan.code === "starter") ?? null;
    reporter.check(
      "e2e: the paid plan catalogue is public and contains a starter plan",
      starter !== null && starter.priceCents > 0,
      starter?.code,
    );
    if (!organizationId || !starter) return;

    /* ------------------------------------------------------------------ */
    /* 4. Checkout with the Angolan methods                                */
    /* ------------------------------------------------------------------ */
    const multicaixa = await manager.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "MULTICAIXA_EXPRESS",
    });
    reporter.equal("e2e: Multicaixa Express checkout starts PENDING", multicaixa.data?.transaction.status, "PENDING");
    reporter.check(
      "e2e: Multicaixa instructions quote the reference",
      (multicaixa.data?.instructions ?? "").includes(multicaixa.data?.reference ?? "@"),
    );

    const bank = await manager.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "BANK_TRANSFER",
    });
    reporter.equal("e2e: bank transfer checkout records the method", bank.data?.transaction.method, "BANK_TRANSFER");

    const qr = await manager.post<CheckoutDto>("/api/billing/checkout", {
      organizationId,
      planId: starter.id,
      method: "QR_CODE",
    });
    if (bankIban) {
      reporter.equal("e2e: QR_CODE checkout starts PENDING", qr.data?.transaction.status, "PENDING");
      reporter.check(
        "e2e: QR_CODE returns an EMVCo payload with a valid CRC-16/CCITT-FALSE",
        typeof qr.data?.qrPayload === "string" && verifyEmvCoChecksum(qr.data!.qrPayload!),
        (qr.data?.qrPayload ?? "").slice(-8),
      );
      reporter.check(
        "e2e: the bank QR carries the Angolan currency and country",
        (qr.data?.qrPayload ?? "").includes("5303973") &&
          (qr.data?.qrPayload ?? "").includes("5802AO"),
      );
    } else {
      reporter.errorCode(
        "e2e: QR_CODE without a configured Angolan IBAN fails loudly (503)",
        qr,
        503,
        "SERVICE_UNAVAILABLE",
      );
    }

    /* ------------------------------------------------------------------ */
    /* 5. Webhook activates the subscription and issues the invoice        */
    /* ------------------------------------------------------------------ */
    const reference = multicaixa.data!.reference;
    const eventBody = JSON.stringify({
      id: `evt_e2e_${Date.now()}`,
      type: "payment.succeeded",
      data: { reference, providerReference: "e2e-bank-0001", paidAt: new Date().toISOString() },
    });
    const confirmed = await anonymous.request<{
      transaction: { status: string; invoiceNumber: string | null };
    }>("/api/billing/webhook", {
      method: "POST",
      rawBody: eventBody,
      headers: { "x-filazero-signature": buildSignatureHeader(secret, eventBody) },
    });
    reporter.equal("e2e: the signed webhook confirms the payment", confirmed.data?.transaction.status, "SUCCEEDED");
    reporter.check(
      "e2e: a fiscal invoice number is assigned on payment",
      /^FR\d{4}\/\d{6}$/.test(confirmed.data?.transaction.invoiceNumber ?? ""),
      confirmed.data?.transaction.invoiceNumber ?? "",
    );

    const subscription = await manager.get<{ subscription: { status: string } | null }>(
      `/api/organizations/${organizationId}/subscription`,
    );
    reporter.equal(
      "e2e: the subscription is ACTIVE after confirmation",
      subscription.data?.subscription?.status,
      "ACTIVE",
    );

    /* ------------------------------------------------------------------ */
    /* 6. Manager backoffice: NIF, logo and public surfaces                */
    /* ------------------------------------------------------------------ */
    const nifUpdate = await manager.patch<{ taxId: string | null }>(
      `/api/organizations/${organizationId}`,
      { taxId: "5417000001" },
    );
    reporter.equal("e2e: the manager updates the NIF", nifUpdate.data?.taxId, "5417000001");

    const logoUpload = await manager.postForm<{ logoUrl: string }>(
      `/api/organizations/${organizationId}/logo`,
      (() => {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }), "logo.png");
        return form;
      })(),
    );
    reporter.equal("e2e: the manager replaces the organization logo", logoUpload.status, 201);
    reporter.check(
      "e2e: the logo URL points at the platform endpoint",
      (logoUpload.data?.logoUrl ?? "").endsWith("/logo"),
    );

    const publicOrg = await anonymous.get<{ logoUrl: string | null }>(
      `/api/public/organizations/${organizationId}`,
    );
    reporter.check(
      "e2e: the public organization exposes the logo",
      (publicOrg.data?.logoUrl ?? "").endsWith("/logo"),
    );

    const branch = await manager.post<{ id: string }>(
      `/api/organizations/${organizationId}/branches`,
      { name: `E2E Branch ${Date.now()}`, city: "Luanda" },
    );
    const queue = await manager.post<{ id: string }>(`/api/branches/${branch.data!.id}/queues`, {
      name: `E2E Queue ${Date.now()}`,
      status: "OPEN",
    });
    reporter.equal("e2e: the manager creates a branch", branch.status, 201);
    reporter.equal("e2e: the manager creates an OPEN queue", queue.status, 201);

    const publicQueue = await anonymous.get<{ organization: { logoUrl: string | null } }>(
      `/api/queues/${queue.data!.id}`,
    );
    reporter.check(
      "e2e: the public queue carries the organization logo",
      (publicQueue.data?.organization.logoUrl ?? "").endsWith("/logo"),
    );

    const board = await anonymous.get<{ queue: { organizationLogoUrl: string | null } }>(
      `/api/public/queues/${queue.data!.id}/board`,
    );
    reporter.check(
      "e2e: the waiting-room board carries the organization logo",
      (board.data?.queue.organizationLogoUrl ?? "").endsWith("/logo"),
    );

    const removed = await manager.del<{ logoUrl: null }>(`/api/organizations/${organizationId}/logo`);
    reporter.equal("e2e: the manager removes the logo", removed.status, 200);
    const afterRemoval = await anonymous.get<{ logoUrl: string | null }>(
      `/api/public/organizations/${organizationId}`,
    );
    reporter.equal(
      "e2e: removing the logo clears the public URL",
      afterRemoval.data?.logoUrl ?? null,
      null,
    );
  } finally {
    if (organizationId) {
      await db.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    if (userId) {
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  }
}
