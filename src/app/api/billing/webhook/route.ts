import { ok, route, getRequestMeta } from "@/lib/http";
import { handlePaymentWebhook } from "@/server/billing/billing.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Payment webhook.
 *
 * Security model:
 *   - the raw body is signed (HMAC-SHA256, `t=..,v1=..`) with a server-side
 *     secret; without a valid signature nothing is applied;
 *   - the timestamp must be inside the tolerance window (anti-replay);
 *   - the event id is stored uniquely, so a replayed event is acknowledged but
 *     applied at most once;
 *   - applying an event is a single database transaction.
 *
 * It is intentionally unauthenticated: the caller is the payment provider, and
 * the signature is the credential.
 */
export const POST = route(async (request) => {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-filazero-signature") ??
    request.headers.get("stripe-signature");

  const outcome = await handlePaymentWebhook(
    rawBody,
    signature,
    getRequestMeta(request),
  );

  return ok({
    received: true,
    duplicate: outcome.duplicate,
    transaction: outcome.transaction,
  });
});
