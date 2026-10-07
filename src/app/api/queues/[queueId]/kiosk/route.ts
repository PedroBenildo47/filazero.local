import { z } from "zod";
import { ok, route } from "@/lib/http";
import { parseJsonBody, uuidSchema } from "@/lib/validation";
import { setQueueKioskMode } from "@/server/queues/kiosk.service";

type Context = { params: Promise<{ queueId: string }> };

const kioskModeSchema = z.object({ enabled: z.boolean() });

/** Enables or disables anonymous kiosk/totem tickets for a queue. */
export const PATCH = route(async (request, context: Context) => {
  const { queueId } = await context.params;
  uuidSchema.parse(queueId);
  const { enabled } = await parseJsonBody(request, kioskModeSchema);
  return ok(await setQueueKioskMode(queueId, enabled));
});
