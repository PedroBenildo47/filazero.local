import { ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { notificationPreferencesSchema } from "@/server/notifications/notification.schemas";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/server/notifications/notification.service";

/** Current user's SMS/WhatsApp notification preferences. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok(await getNotificationPreferences(auth.user.id));
});

/** Updates the current user's phone and channel consent. */
export const PATCH = route(async (request) => {
  const auth = await requireAuth();
  const input = await parseJsonBody(request, notificationPreferencesSchema);
  return ok(await updateNotificationPreferences(auth.user.id, input));
});
