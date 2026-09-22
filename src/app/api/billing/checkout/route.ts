import { created, getRequestMeta, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { startCheckout } from "@/server/billing/billing.service";
import { checkoutSchema } from "@/server/billing/billing.schemas";

/**
 * Starts a real checkout for an organization's plan.
 *
 * Creates a payable reference (and, for hosted providers, a real checkout
 * session). It never marks anything as paid: that only happens through
 * `POST /api/billing/webhook` after the provider confirms.
 */
export const POST = route(async (request) => {
  const auth = await requireAuth();
  const body = await parseJsonBody(request, checkoutSchema);
  const result = await startCheckout(
    auth,
    body.organizationId,
    body.planId,
    getRequestMeta(request),
  );
  return created(result);
});
