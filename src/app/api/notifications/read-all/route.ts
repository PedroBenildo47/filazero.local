import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { markAllNotificationsRead } from "@/server/notifications/notification.service";

/** Marks every notification of the current user as read. */
export const POST = route(async () => {
  const auth = await requireAuth();
  const updated = await markAllNotificationsRead(auth.user.id);
  return ok({ updated });
});
