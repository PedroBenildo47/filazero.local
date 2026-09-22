import { getRequestMeta, ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { callNext } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ queueId: string }> };

/** Staff: calls the next waiting customer (concurrency-safe). */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { queueId } = await context.params;
  return ok(await callNext(auth, queueId, getRequestMeta(request)));
});
