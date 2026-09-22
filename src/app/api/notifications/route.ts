import { ok, route } from "@/lib/http";
import { paginationSchema, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { listNotifications } from "@/server/notifications/notification.service";

/** Current user's notifications, with unread count. */
export const GET = route(async (request) => {
  const auth = await requireAuth();
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listNotifications(auth.user.id, pagination));
});
