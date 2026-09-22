import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { getQueueForStaff } from "@/server/queues/queue.service";

type Context = { params: Promise<{ queueId: string }> };

/** Staff/manager: operational view of a single queue. */
export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { queueId } = await context.params;
  return ok(await getQueueForStaff(auth, queueId));
});
