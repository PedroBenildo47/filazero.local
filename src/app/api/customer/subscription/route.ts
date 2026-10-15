import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getCustomerBilling } from "@/server/customer/customer-subscription.service";

/** Authenticated customer: subscription status, plan and payment history. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok(await getCustomerBilling(auth));
});
