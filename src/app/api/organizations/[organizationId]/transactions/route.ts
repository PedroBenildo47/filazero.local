import { ok, route } from "@/lib/http";
import { paginationSchema, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { listTransactions } from "@/server/billing/billing.service";

type Context = { params: Promise<{ organizationId: string }> };

/** Billing history (invoices/attempts) for the organization. */
export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listTransactions(auth, organizationId, pagination));
});
