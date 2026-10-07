/**
 * Invoice history (paid subscriptions) and fiscal document rendering.
 *
 * An invoice exists only once a payment has really succeeded and a sequential
 * number has been assigned inside the organization's official series, so the
 * history is an honest record of money received — pending or failed attempts
 * stay in the transaction list instead.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import {
  assertOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/server/context";
import { paymentMethodLabel } from "@/server/email/templates";
import type { InvoiceDocumentTypeName } from "./agt";
import { renderInvoicePdf } from "./invoice-pdf";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  reference: string;
  amountCents: number;
  currency: string;
  method: string;
  provider: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  plan: { code: string; name: string };
  subscription: { currentPeriodStart: Date; currentPeriodEnd: Date } | null;
  series: { documentType: InvoiceDocumentTypeName } | null;
  seriesCode: string | null;
  sequence: number | null;
  subtotalCents: number | null;
  vatCents: number | null;
  vatRateBps: number | null;
  customerTaxId: string | null;
  issuerTaxId: string | null;
  invoiceHash: string | null;
  invoiceQr: string | null;
  invoiceIssuedAt: Date | null;
  agtCertified: boolean;
}

function serializeInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    reference: row.reference,
    amountCents: row.amountCents,
    currency: row.currency,
    method: row.method,
    provider: row.provider,
    status: row.status,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    plan: { code: row.plan.code, name: row.plan.name },
    periodStart: row.subscription?.currentPeriodStart ?? null,
    periodEnd: row.subscription?.currentPeriodEnd ?? null,
    // Fiscal document (AGT).
    documentType: row.series?.documentType ?? "FR",
    seriesCode: row.seriesCode,
    sequence: row.sequence,
    subtotalCents: row.subtotalCents,
    vatCents: row.vatCents,
    vatRateBps: row.vatRateBps,
    customerTaxId: row.customerTaxId,
    issuerTaxId: row.issuerTaxId,
    invoiceHash: row.invoiceHash,
    invoiceIssuedAt: row.invoiceIssuedAt,
    agtCertified: row.agtCertified,
  };
}

const INVOICE_INCLUDE = {
  plan: { select: { code: true, name: true } },
  subscription: { select: { currentPeriodStart: true, currentPeriodEnd: true } },
  series: { select: { documentType: true } },
} as const;

export async function listInvoices(
  ctx: AuthContext,
  organizationId: string,
  pagination: Pagination,
) {
  requirePermission(ctx, "billing:read");
  assertOrganizationAccess(ctx, organizationId);

  const { skip, take } = paginationToSkipTake(pagination);
  const where = {
    organizationId,
    status: "SUCCEEDED" as const,
    invoiceNumber: { not: null },
  };

  const [items, total] = await db.$transaction([
    db.transaction.findMany({
      where,
      include: INVOICE_INCLUDE,
      orderBy: { paidAt: "desc" },
      skip,
      take,
    }),
    db.transaction.count({ where }),
  ]);

  return {
    items: items.map((item) => serializeInvoice(item as InvoiceRow)),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function getInvoice(
  ctx: AuthContext,
  organizationId: string,
  transactionId: string,
) {
  requirePermission(ctx, "billing:read");
  assertOrganizationAccess(ctx, organizationId);

  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, organizationId },
    include: {
      ...INVOICE_INCLUDE,
      organization: { select: { name: true, email: true, city: true, country: true } },
    },
  });
  if (!transaction) throw AppError.notFound("Invoice not found");

  return {
    ...serializeInvoice(transaction as InvoiceRow),
    organization: transaction.organization,
  };
}

/* -------------------------------------------------------------------------- */
/* Fiscal PDF                                                                  */
/* -------------------------------------------------------------------------- */

const PDF_INCLUDE = {
  plan: true,
  series: true,
  subscription: { select: { currentPeriodStart: true, currentPeriodEnd: true } },
  organization: { select: { name: true, taxId: true, address: true, city: true } },
} as const;

/** Everything the PDF layout needs, already loaded from the transaction. */
interface PdfSource {
  invoiceNumber: string | null;
  invoiceIssuedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  currency: string;
  amountCents: number;
  subtotalCents: number | null;
  vatCents: number | null;
  vatRateBps: number | null;
  method: string;
  reference: string;
  invoiceHash: string | null;
  invoiceQr: string | null;
  agtCertified: boolean;
  customerTaxId: string | null;
  series: { documentType: InvoiceDocumentTypeName } | null;
  plan: { name: string };
  subscription: { currentPeriodStart: Date; currentPeriodEnd: Date } | null;
  organization: {
    name: string;
    taxId: string | null;
    address: string | null;
    city: string | null;
  };
}

function toPdfInput(transaction: PdfSource) {
  const env = getEnv();
  return {
    issuer: {
      name: env.PLATFORM_LEGAL_NAME,
      taxId: env.PLATFORM_TAX_ID ?? null,
      address: env.PLATFORM_ADDRESS ?? null,
      city: env.PLATFORM_CITY ?? null,
    },
    customer: {
      name: transaction.organization.name,
      taxId: transaction.customerTaxId ?? transaction.organization.taxId ?? null,
      address: transaction.organization.address ?? null,
      city: transaction.organization.city ?? null,
    },
    document: {
      documentType: transaction.series?.documentType ?? "FR",
      invoiceNumber: transaction.invoiceNumber ?? "",
      issuedAt:
        transaction.invoiceIssuedAt ?? transaction.paidAt ?? transaction.createdAt,
      currency: transaction.currency,
      subtotalCents: transaction.subtotalCents ?? transaction.amountCents,
      vatCents: transaction.vatCents ?? 0,
      vatRateBps: transaction.vatRateBps ?? 0,
      totalCents: transaction.amountCents,
      planName: transaction.plan.name,
      periodStart: transaction.subscription?.currentPeriodStart ?? null,
      periodEnd: transaction.subscription?.currentPeriodEnd ?? null,
      methodLabel: paymentMethodLabel(transaction.method, "pt"),
      reference: transaction.reference,
      paidAt: transaction.paidAt,
      hash: transaction.invoiceHash ?? "",
      qrPayload: transaction.invoiceQr ?? "",
      agtCertified: transaction.agtCertified,
    },
  };
}

function invoiceFileName(invoiceNumber: string): string {
  return `fatura-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}

/** Renders the fiscal PDF for a paid invoice (tenant-scoped). */
export async function getInvoicePdf(
  ctx: AuthContext,
  organizationId: string,
  transactionId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  requirePermission(ctx, "billing:read");
  assertOrganizationAccess(ctx, organizationId);

  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, organizationId },
    include: PDF_INCLUDE,
  });
  if (!transaction) throw AppError.notFound("Invoice not found");
  if (transaction.status !== "SUCCEEDED" || !transaction.invoiceNumber) {
    throw AppError.badRequest("Only confirmed payments have a downloadable invoice.");
  }

  const bytes = await renderInvoicePdf(toPdfInput(transaction as PdfSource));
  return { bytes, fileName: invoiceFileName(transaction.invoiceNumber) };
}

/**
 * Renders the fiscal PDF straight from a transaction id, without an auth check.
 * Used by the automatic receipt email, which runs outside a request. Returns
 * `null` when the transaction is not a confirmed, invoiced payment.
 */
export async function renderInvoicePdfById(
  transactionId: string,
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const transaction = await db.transaction.findUnique({
    where: { id: transactionId },
    include: PDF_INCLUDE,
  });
  if (!transaction || transaction.status !== "SUCCEEDED" || !transaction.invoiceNumber) {
    return null;
  }
  const bytes = await renderInvoicePdf(toPdfInput(transaction as PdfSource));
  return { bytes, fileName: invoiceFileName(transaction.invoiceNumber) };
}
