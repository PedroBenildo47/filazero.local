import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { getPublicQueue, updateQueue } from "@/server/queues/queue.service";
import { updateQueueSchema } from "@/server/queues/queue.schemas";

type Context = { params: Promise<{ queueId: string }> };

/** Public: queue availability for customers. */
export const GET = route(async (_request, context: Context) => {
  const { queueId } = await context.params;
  return ok(await getPublicQueue(queueId));
});

/** Staff/manager: edit name, description or status. */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { queueId } = await context.params;
  const body = await parseJsonBody(request, updateQueueSchema);
  return ok(await updateQueue(auth, queueId, body, getRequestMeta(request)));
});
