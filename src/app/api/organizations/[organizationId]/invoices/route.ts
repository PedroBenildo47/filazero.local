import { ok, route } from "@/lib/http";
import { paginationSchema, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { listInvoices } from "@/server/billing/invoice.service";

type Context = { params: Promise<{ organizationId: string }> };

/** Invoice history: paid subscriptions, each with its sequential invoice number. */
export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listInvoices(auth, organizationId, pagination));
});
