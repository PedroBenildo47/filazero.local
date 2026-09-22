import { getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { completeService } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ ticketId: string }> };

/** Staff: completes a SERVING ticket. */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { ticketId } = await context.params;
  return ok(await completeService(auth, ticketId, getRequestMeta(request)));
});
