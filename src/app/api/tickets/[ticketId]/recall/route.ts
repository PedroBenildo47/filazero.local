import { getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { recallTicket } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ ticketId: string }> };

/** Staff: re-announces a called/serving ticket (the customer may have missed it). */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  return ok(await recallTicket(auth, ticketId, getRequestMeta(request)));
});
