import { getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { startServing } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ ticketId: string }> };

/** Staff: starts the service for a CALLED ticket. */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  return ok(await startServing(auth, ticketId, getRequestMeta(request)));
});
