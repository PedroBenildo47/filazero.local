import { getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { leaveQueue } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ ticketId: string }> };

/** Customer leaves the queue (WAITING tickets only). */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  return ok(await leaveQueue(auth, ticketId, getRequestMeta(request)));
});
