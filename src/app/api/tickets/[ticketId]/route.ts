import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getTicket } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ ticketId: string }> };

/** Ticket detail: the owner, or staff of the owning organization. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  return ok(await getTicket(auth, ticketId));
});
