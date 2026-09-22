import { getRequestMeta, ok, route } from "@/lib/http";
import { logout } from "@/server/auth/auth.service";
import { clearSessionCookie, readSessionToken } from "@/server/auth/session-cookie";

export const POST = route(async (request) => {
  const token = await readSessionToken();
  if (token) {
    await logout(token, getRequestMeta(request));
  }
  await clearSessionCookie();
  return ok({ success: true });
});
