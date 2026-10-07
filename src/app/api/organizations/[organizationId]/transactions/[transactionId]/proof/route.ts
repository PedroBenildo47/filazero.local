import { NextResponse } from "next/server";
import { created, getRequestMeta, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { MAX_PAYMENT_PROOF_BYTES } from "@/server/billing/payment-methods";
import {
  getLatestPaymentProof,
  submitPaymentProof,
} from "@/server/billing/proof.service";
import { readMultipartFile } from "@/server/http/multipart";

type Context = { params: Promise<{ organizationId: string; transactionId: string }> };

/**
 * Manager uploads the proof of payment (bank transfer / Multicaixa Express).
 * The transaction moves to `UNDER_REVIEW`; it is never marked as paid here.
 */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, transactionId } = await context.params;

  const upload = await readMultipartFile(request, {
    field: "file",
    maxBytes: MAX_PAYMENT_PROOF_BYTES,
  });

  const proof = await submitPaymentProof(
    auth,
    organizationId,
    transactionId,
    upload,
    getRequestMeta(request),
  );
  return created(proof);
});

/** Manager/finance downloads the latest proof attached to a transaction. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, transactionId } = await context.params;
  const proof = await getLatestPaymentProof(auth, organizationId, transactionId);

  return new NextResponse(new Uint8Array(proof.content), {
    status: 200,
    headers: {
      "content-type": proof.mimeType,
      "content-disposition": `attachment; filename="${encodeURIComponent(proof.fileName)}"`,
      "content-length": String(proof.content.byteLength),
      "cache-control": "private, no-store",
    },
  });
});
