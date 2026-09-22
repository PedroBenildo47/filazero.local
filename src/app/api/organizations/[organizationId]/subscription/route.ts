import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { assertOrganizationAccess, requirePermission } from "@/server/context";
import { getBillingOverview } from "@/server/billing/subscription.service";
import { assignPlan } from "@/server/billing/billing.service";
import { assignPlanSchema } from "@/server/billing/billing.schemas";

type Context = { params: Promise<{ organizationId: string }> };

/** Subscription, plan limits and current usage for the organization. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;

  requirePermission(auth, "billing:read");
  assertOrganizationAccess(auth, organizationId);

  return ok(await getBillingOverview(organizationId));
});

/**
 * Platform administrator assigns a plan directly (signed B2B contract, pilot).
 * This is an entitlement change, not a payment: it never touches transactions.
 */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, assignPlanSchema);

  const subscription = await assignPlan(
    auth,
    organizationId,
    body.planId,
    getRequestMeta(request),
  );

  return ok({
    id: subscription.id,
    organizationId: subscription.organizationId,
    planId: subscription.planId,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
  });
});
