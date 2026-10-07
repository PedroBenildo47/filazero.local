/**
 * Proof of payment (bank transfer / Multicaixa Express).
 *
 * The payer uploads the bank receipt; the transaction moves to `UNDER_REVIEW`
 * and waits for finance to confirm. Uploading a proof **never** marks anything
 * as paid — only the signature-verified webhook can do that, so the money trail
 * stays honest.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { Transaction } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/http";
import { recordAudit } from "@/server/audit/audit.service";
import {
  assertManagerOfOrganization,
  assertOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/server/context";
import {
  detectProofMimeType,
  validatePaymentProof,
} from "./payment-methods";

export interface PaymentProofUpload {
  fileName: string;
  bytes: Uint8Array;
}

export function serializeProof(proof: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}) {
  return {
    id: proof.id,
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    sizeBytes: proof.sizeBytes,
    sha256: proof.sha256,
    createdAt: proof.createdAt,
  };
}

function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "comprovativo";
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 200) || "comprovativo";
}

function assertProofableTransaction(transaction: Transaction): void {
  if (transaction.status === "SUCCEEDED") {
    throw AppError.badRequest("This payment is already confirmed.");
  }
  if (transaction.status === "FAILED" || transaction.status === "REFUNDED") {
    throw AppError.badRequest("This transaction can no longer receive a proof.");
  }
  if (transaction.method === "CARD") {
    throw AppError.badRequest("Card payments are confirmed by the provider directly.");
  }
}

export async function submitPaymentProof(
  ctx: AuthContext,
  organizationId: string,
  transactionId: string,
  upload: PaymentProofUpload,
  meta: RequestMeta,
) {
  requirePermission(ctx, "billing:manage");
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, organizationId },
  });
  if (!transaction) throw AppError.notFound("Transaction not found");
  assertProofableTransaction(transaction);

  const failure = validatePaymentProof(upload.bytes);
  if (failure) {
    throw AppError.validation(failure.message, { reason: failure.code });
  }
  const mimeType = detectProofMimeType(upload.bytes)!;

  const proof = await db.$transaction(async (tx) => {
    const created = await tx.paymentProof.create({
      data: {
        transactionId: transaction.id,
        uploadedById: ctx.user.id,
        fileName: safeFileName(upload.fileName),
        mimeType,
        sizeBytes: upload.bytes.byteLength,
        sha256: createHash("sha256").update(upload.bytes).digest("hex"),
        content: new Uint8Array(upload.bytes),
      },
    });

    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        proofSubmittedAt: new Date(),
        status: transaction.status === "PENDING" ? "UNDER_REVIEW" : transaction.status,
      },
    });

    await recordAudit(tx, {
      actorUserId: ctx.user.id,
      action: "billing.proof_submitted",
      entityType: "transaction",
      entityId: transaction.id,
      metadata: {
        organizationId,
        reference: transaction.reference,
        fileName: created.fileName,
        sizeBytes: created.sizeBytes,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return created;
  });

  return serializeProof(proof);
}

/** Latest proof for a transaction, for the finance download. */
export async function getLatestPaymentProof(
  ctx: AuthContext,
  organizationId: string,
  transactionId: string,
) {
  requirePermission(ctx, "billing:read");
  assertOrganizationAccess(ctx, organizationId);
  assertManagerOfOrganization(ctx, organizationId);

  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, organizationId },
    select: { id: true },
  });
  if (!transaction) throw AppError.notFound("Transaction not found");

  const proof = await db.paymentProof.findFirst({
    where: { transactionId },
    orderBy: { createdAt: "desc" },
  });
  if (!proof) throw AppError.notFound("No proof uploaded for this transaction");

  return {
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    content: Buffer.from(proof.content),
  };
}
