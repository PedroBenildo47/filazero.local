import { ok, route } from "@/lib/http";
import { paginationSchema, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { listNotificationDeliveries } from "@/server/notifications/notification-dispatch.service";

/** Current user's SMS/WhatsApp delivery history (their own notifications only). */
export const GET = route(async (request) => {
  const auth = await requireAuth();
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listNotificationDeliveries(auth.user.id, pagination));
});
