import { created, getRequestMeta, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { startCardIntent } from "@/server/billing/billing.service";
import { cardIntentSchema } from "@/server/billing/billing.schemas";

/**
 * Creates a real Stripe PaymentIntent for the embedded card form.
 *
 * The browser confirms the card with Stripe Elements against the returned
 * `clientSecret`; FilaZero never sees the card data. The transaction stays
 * PENDING until the signature-verified webhook marks it SUCCEEDED.
 */
export const POST = route(async (request) => {
  const auth = await requireAuth();
  const body = await parseJsonBody(request, cardIntentSchema);
  const result = await startCardIntent(
    auth,
    body.organizationId,
    body.planId,
    body.taxId ?? null,
    getRequestMeta(request),
  );
  return created(result);
});
