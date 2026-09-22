import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { getQueueState } from "@/server/tickets/ticket.service";
import { queueStateQuerySchema } from "@/server/tickets/ticket.schemas";

type Context = { params: Promise<{ queueId: string }> };

/** Staff: full operational state of a queue (waiting, current, recent). */
export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { queueId } = await context.params;
  const { recentLimit } = parseSearchParams(request, queueStateQuerySchema);
  return ok(await getQueueState(auth, queueId, recentLimit));
});
