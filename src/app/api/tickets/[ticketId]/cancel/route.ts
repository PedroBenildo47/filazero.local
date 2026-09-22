import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { cancelTicket } from "@/server/tickets/ticket.service";
import { cancelTicketSchema } from "@/server/tickets/ticket.schemas";

type Context = { params: Promise<{ ticketId: string }> };

/**
 * Cancels a ticket. The owner may cancel their own WAITING ticket; staff may
 * cancel tickets of their organization.
 */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  const body = await parseJsonBody(request, cancelTicketSchema);
  return ok(await cancelTicket(auth, ticketId, body, getRequestMeta(request)));
});
