import { getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { markNoShow } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ ticketId: string }> };

/** Staff: marks a CALLED ticket as no-show. */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  return ok(await markNoShow(auth, ticketId, getRequestMeta(request)));
});
