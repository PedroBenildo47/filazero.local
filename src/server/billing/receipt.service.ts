/**
 * Automatic payment receipt delivery.
 *
 * Called after a webhook has confirmed a payment. It is deliberately outside the
 * database transaction that marked the payment: SMTP must never be able to roll
 * back money. A delivery failure is logged and can be retried, and
 * `receipt_sent_at` makes the send idempotent.
 */
import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendPaymentReceiptEmail } from "@/server/email/email.service";

/** Best-effort billing contact: the organization email, else its first manager. */
async function billingRecipient(
  organizationId: string,
  organizationEmail: string | null,
): Promise<string | null> {
  if (organizationEmail) return organizationEmail;

  const manager = await db.organizationMember.findFirst({
    where: { organizationId, role: "MANAGER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true } } },
  });
  return manager?.user.email ?? null;
}

/**
 * Sends the receipt for a successful transaction once. Returns true when the
 * message was handed to SMTP (or had already been sent).
 */
export async function deliverPaymentReceipt(transactionId: string): Promise<boolean> {
  const transaction = await db.transaction.findUnique({
    where: { id: transactionId },
    include: {
      plan: true,
      organization: { select: { id: true, name: true, email: true } },
      subscription: { select: { currentPeriodEnd: true } },
    },
  });

  if (!transaction || transaction.status !== "SUCCEEDED" || !transaction.invoiceNumber) {
    return false;
  }
  if (transaction.receiptSentAt) return true;

  const to = await billingRecipient(
    transaction.organizationId,
    transaction.organization.email,
  );
  if (!to) {
    logger.warn(
      { transactionId },
      "no billing recipient found; payment receipt not sent",
    );
    return false;
  }

  const sent = await sendPaymentReceiptEmail({
    to,
    organizationName: transaction.organization.name,
    invoiceNumber: transaction.invoiceNumber,
    planName: transaction.plan.name,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    method: transaction.method,
    reference: transaction.reference,
    paidAt: transaction.paidAt ?? new Date(),
    periodEnd: transaction.subscription?.currentPeriodEnd ?? null,
    lang: "pt",
  });

  if (sent) {
    await db.transaction.update({
      where: { id: transactionId },
      data: { receiptSentAt: new Date() },
    });
  }

  return sent;
}
