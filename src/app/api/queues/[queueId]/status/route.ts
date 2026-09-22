import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { setQueueStatus } from "@/server/queues/queue.service";
import { queueStatusSchema } from "@/server/queues/queue.schemas";

type Context = { params: Promise<{ queueId: string }> };

/** Staff/manager: open, pause or close a queue. */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { queueId } = await context.params;
  const body = await parseJsonBody(request, queueStatusSchema);
  return ok(
    await setQueueStatus(auth, queueId, body.status, getRequestMeta(request)),
  );
});
