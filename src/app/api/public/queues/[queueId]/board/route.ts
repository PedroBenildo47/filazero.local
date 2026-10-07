import { ok, route } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { getPublicBoard } from "@/server/queues/public-board.service";

type Context = { params: Promise<{ queueId: string }> };

/** Public, read-only queue board (ticket numbers only) for kiosk/display screens. */
export const GET = route(async (_request, context: Context) => {
  const { queueId } = await context.params;
  uuidSchema.parse(queueId);
  return ok(await getPublicBoard(queueId));
});
