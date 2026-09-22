import { ok, route } from "@/lib/http";
import { requireAuth } from "@/server/auth/session-cookie";
import { markNotificationRead } from "@/server/notifications/notification.service";

type Context = { params: Promise<{ notificationId: string }> };

/** Marks one notification as read (only the owner may). */
export const PATCH = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { notificationId } = await context.params;
  await markNotificationRead(auth.user.id, notificationId);
  return ok({ success: true });
});
