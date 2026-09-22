import { created, getRequestMeta, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { joinQueue } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ queueId: string }> };

/** Customer joins the queue. Creates the real ticket and returns its position. */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { queueId } = await context.params;
  return created(await joinQueue(auth, queueId, getRequestMeta(request)));
});
