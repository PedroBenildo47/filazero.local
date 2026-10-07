import { z } from "zod";
import { ok, route } from "@/lib/http";
import { parseJsonBody, uuidSchema } from "@/lib/validation";
import { enforceRateLimits, ipKey } from "@/server/security/rate-limit.service";
import { joinQueueAsGuest } from "@/server/tickets/ticket.service";

type Context = { params: Promise<{ queueId: string }> };

/** Anonymous kiosk tickets are rate-limited per client IP. */
const KIOSK_RATE_LIMIT = { max: 8, windowSeconds: 60 } as const;

const guestTicketSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(32).optional(),
});

/**
 * Anonymous walk-in ticket from a kiosk/totem.
 *
 * Public and unauthenticated by design, so it is rate-limited per client IP and
 * only works for queues whose owner enabled kiosk mode.
 */
export const POST = route(async (request, context: Context) => {
  const { queueId } = await context.params;
  uuidSchema.parse(queueId);

  await enforceRateLimits([
    { rule: KIOSK_RATE_LIMIT, key: ipKey("kiosk:ticket", request) },
  ]);

  const input = await parseJsonBody(request, guestTicketSchema);
  return ok(await joinQueueAsGuest(queueId, input), { status: 201 });
});
