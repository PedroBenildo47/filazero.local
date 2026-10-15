/**
 * Proof of payment for an end-customer subscription payment.
 *
 * Mirrors the B2B proof flow: the bytes are sniffed, hashed and stored; the
 * payment moves to UNDER_REVIEW and is never marked as paid here.
 */
import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import type { AuthContext } from "@/server/context";
import {
  detectProofMimeType,
  validatePaymentProof,
} from "@/server/billing/payment-methods";

export interface CustomerProofUpload {
  fileName: string;
  bytes: Uint8Array;
}

function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "comprovativo";
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 200) || "comprovativo";
}

export async function submitCustomerProof(
  ctx: AuthContext,
  paymentId: string,
  upload: CustomerProofUpload,
  meta: RequestMeta,
) {
  const payment = await db.customerPayment.findFirst({
    where: { id: paymentId, userId: ctx.user.id },
  });
  if (!payment) throw AppError.notFound("Payment not found");
  if (payment.status === "SUCCEEDED") {
    throw AppError.badRequest("This payment is already confirmed.");
  }
  if (payment.status === "FAILED" || payment.status === "REFUNDED") {
    throw AppError.badRequest("This payment can no longer receive a proof.");
  }

  const failure = validatePaymentProof(upload.bytes);
  if (failure) {
    throw AppError.validation(failure.message, { reason: failure.code });
  }
  const mimeType = detectProofMimeType(upload.bytes)!;

  const proof = await db.$transaction(async (tx) => {
    const created = await tx.customerPaymentProof.create({
      data: {
        paymentId: payment.id,
        fileName: safeFileName(upload.fileName),
        mimeType,
        sizeBytes: upload.bytes.byteLength,
        sha256: createHash("sha256").update(upload.bytes).digest("hex"),
        content: new Uint8Array(upload.bytes),
      },
    });

    await tx.customerPayment.update({
      where: { id: payment.id },
      data: {
        proofSubmittedAt: new Date(),
        status: payment.status === "PENDING" ? "UNDER_REVIEW" : payment.status,
      },
    });

    await recordAudit(tx, {
      actorUserId: ctx.user.id,
      action: "customer.proof_submitted",
      entityType: "customer_payment",
      entityId: payment.id,
      metadata: {
        reference: payment.reference,
        fileName: created.fileName,
        sizeBytes: created.sizeBytes,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return created;
  });

  return {
    id: proof.id,
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    sizeBytes: proof.sizeBytes,
    sha256: proof.sha256,
    createdAt: proof.createdAt,
  };
}
