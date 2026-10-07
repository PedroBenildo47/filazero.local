/**
 * Official document series.
 *
 * Each organization numbers its documents inside a series identified by document
 * type and year (`FR2026`), as the AGT requires. The counter is incremented
 * atomically by the database (`INSERT ... ON CONFLICT DO UPDATE`), so concurrent
 * payments never share a number.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildInvoiceNumber,
  formatSeriesCode,
  type InvoiceDocumentTypeName,
} from "./agt";

type SeriesClient = Pick<Prisma.TransactionClient, "invoiceSeries" | "transaction">;

export interface InvoiceAllocation {
  seriesId: string;
  seriesCode: string;
  sequence: number;
  invoiceNumber: string;
}

export async function allocateInvoiceNumber(
  client: SeriesClient,
  organizationId: string,
  documentType: InvoiceDocumentTypeName,
  date: Date = new Date(),
): Promise<InvoiceAllocation> {
  const year = date.getUTCFullYear();
  const code = formatSeriesCode(documentType, year);

  const series = await client.invoiceSeries.upsert({
    where: {
      organizationId_documentType_year: { organizationId, documentType, year },
    },
    create: { organizationId, documentType, year, code, nextNumber: 1 },
    update: { nextNumber: { increment: 1 } },
  });

  return {
    seriesId: series.id,
    seriesCode: series.code,
    sequence: series.nextNumber,
    invoiceNumber: buildInvoiceNumber(series.code, series.nextNumber),
  };
}

/**
 * Hash of the document immediately before `sequence` in the series. AGT
 * signatures chain documents; the first document chains to an empty string.
 */
export async function previousInvoiceHash(
  client: SeriesClient,
  seriesId: string,
  sequence: number,
): Promise<string> {
  if (sequence <= 1) return "";
  const previous = await client.transaction.findFirst({
    where: { seriesId, sequence: sequence - 1 },
    select: { invoiceHash: true },
  });
  return previous?.invoiceHash ?? "";
}

export async function listInvoiceSeries(organizationId: string) {
  return db.invoiceSeries.findMany({
    where: { organizationId },
    orderBy: [{ year: "desc" }, { documentType: "asc" }],
  });
}
