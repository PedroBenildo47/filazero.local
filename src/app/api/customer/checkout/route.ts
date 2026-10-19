import { z } from "zod";
import { created, getRequestMeta, route } from "@/lib/http";
import { angolanPhoneSchema, parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { paymentMethodSchema } from "@/server/billing/billing.schemas";
import { startCustomerCheckout } from "@/server/customer/customer-subscription.service";

const customerCheckoutSchema = z.object({
  method: paymentMethodSchema.default("MULTICAIXA_EXPRESS"),
  /** Required for Multicaixa Express: the request is pushed to this number. */
  payerPhone: angolanPhoneSchema.optional(),
});

/**
 * Starts a real end-customer subscription payment (2.000 Kz/month) through the
 * Angolan methods. The subscription is activated by the signed webhook.
 */
export const POST = route(async (request) => {
  const auth = await requireAuth();
  const body = await parseJsonBody(request, customerCheckoutSchema);
  return created(
    await startCustomerCheckout(auth, body.method, body.payerPhone ?? null, getRequestMeta(request)),
  );
});
