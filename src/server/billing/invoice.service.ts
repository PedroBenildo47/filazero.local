/**
 * Invoice history (paid subscriptions).
 *
 * An invoice exists only once a payment has really succeeded and a sequential
 * number has been assigned, so the history is an honest record of money
 * received — pending or failed attempts stay in the transaction list instead.
 */
import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { paginationToSkipTake, type Pagination } from "@/lib/validation";
import {
  assertOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/server/context";

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
  };
}

const INVOICE_INCLUDE = {
  plan: { select: { code: true, name: true } },
  subscription: { select: { currentPeriodStart: true, currentPeriodEnd: true } },
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
