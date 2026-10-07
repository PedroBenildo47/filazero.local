/**
 * Sequential invoice numbering.
 *
 * One counter row per year (`billing_counters`), incremented atomically by the
 * database. Invoice numbers are only consumed when a payment really succeeds, so
 * abandoned checkouts never create gaps in the numbering.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatInvoiceNumber } from "./payment-methods";

type CounterClient = Pick<Prisma.TransactionClient, "billingCounter">;

export const INVOICE_COUNTER_SCOPE = "invoice";

export async function nextInvoiceNumber(
  client: CounterClient = db,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const period = String(year);

  const counter = await client.billingCounter.upsert({
    where: { scope_period: { scope: INVOICE_COUNTER_SCOPE, period } },
    create: { scope: INVOICE_COUNTER_SCOPE, period, value: 1 },
    update: { value: { increment: 1 } },
  });

  return formatInvoiceNumber(year, counter.value);
}
