import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { getMyActiveTicket, listMyTickets } from "@/server/tickets/ticket.service";
import { myTicketsQuerySchema } from "@/server/tickets/ticket.schemas";

/**
 * Client dashboard endpoint: the current active ticket (with live position)
 * plus paginated history.
 */
export const GET = route(async (request) => {
  const auth = await requireAuth();
  const query = parseSearchParams(request, myTicketsQuerySchema);

  const [active, history] = await Promise.all([
    getMyActiveTicket(auth),
    listMyTickets(auth, query),
  ]);

  return ok({ active, history });
});
