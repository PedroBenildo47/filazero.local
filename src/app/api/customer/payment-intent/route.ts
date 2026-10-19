import { created, getRequestMeta, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { startCustomerCardIntent } from "@/server/customer/customer-subscription.service";

/**
 * Creates a real Stripe PaymentIntent for the end-customer embedded card form.
 * Card data is collected by Stripe Elements in the browser; the subscription is
 * only activated by the signature-verified webhook.
 */
export const POST = route(async (request) => {
  const auth = await requireAuth();
  return created(await startCustomerCardIntent(auth, getRequestMeta(request)));
});
