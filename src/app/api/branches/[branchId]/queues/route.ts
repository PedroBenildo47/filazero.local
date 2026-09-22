import { created, getRequestMeta, ok, route } from "@/lib/http";
import { paginationSchema, parseJsonBody, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { createQueue, listQueuesForBranch } from "@/server/queues/queue.service";
import { createQueueSchema } from "@/server/queues/queue.schemas";

type Context = { params: Promise<{ branchId: string }> };

export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { branchId } = await context.params;
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listQueuesForBranch(auth, branchId, pagination));
});

export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { branchId } = await context.params;
  const body = await parseJsonBody(request, createQueueSchema);
  return created(await createQueue(auth, branchId, body, getRequestMeta(request)));
});
