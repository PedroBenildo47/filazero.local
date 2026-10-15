import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { transferTicket } from "@/server/tickets/ticket.service";
import { transferTicketSchema } from "@/server/tickets/ticket.schemas";

type Context = { params: Promise<{ ticketId: string }> };

/** Staff: moves an active ticket to another open queue of the same organization. */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  const body = await parseJsonBody(request, transferTicketSchema);
  return ok(
    await transferTicket(auth, ticketId, body.queueId, getRequestMeta(request)),
  );
});
