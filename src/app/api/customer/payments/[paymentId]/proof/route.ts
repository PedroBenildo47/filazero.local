import { created, getRequestMeta, route } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { MAX_PAYMENT_PROOF_BYTES } from "@/server/billing/payment-methods";
import { submitCustomerProof } from "@/server/customer/customer-proof.service";
import { readMultipartFile } from "@/server/http/multipart";

type Context = { params: Promise<{ paymentId: string }> };

/** Customer uploads the proof of a subscription payment (PENDING → UNDER_REVIEW). */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { paymentId } = await context.params;
  uuidSchema.parse(paymentId);

  const upload = await readMultipartFile(request, {
    field: "file",
    maxBytes: MAX_PAYMENT_PROOF_BYTES,
  });

  return created(await submitCustomerProof(auth, paymentId, upload, getRequestMeta(request)));
});
