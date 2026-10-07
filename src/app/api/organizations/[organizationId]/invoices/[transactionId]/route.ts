import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getInvoice } from "@/server/billing/invoice.service";

type Context = { params: Promise<{ organizationId: string; transactionId: string }> };

/** A single invoice with the organization data needed to render/print it. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, transactionId } = await context.params;
  return ok(await getInvoice(auth, organizationId, transactionId));
});
