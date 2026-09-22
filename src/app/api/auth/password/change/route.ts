import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { changePassword } from "@/server/auth/auth.service";
import { changePasswordSchema } from "@/server/auth/auth.schemas";
import { readSessionToken, requireAuth } from "@/server/auth/session-cookie";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import { enforceRateLimits, ipKey } from "@/server/security/rate-limit.service";

/** Changes the password of the authenticated user and revokes other sessions. */
export const POST = route(async (request) => {
  const context = await requireAuth();
  await enforceRateLimits([
    {
      key: ipKey("auth:password-change", request),
      rule: RATE_LIMITS.passwordChange.ip,
    },
  ]);
  const body = await parseJsonBody(request, changePasswordSchema);
  const currentToken = await readSessionToken();
  await changePassword(context.user.id, body, getRequestMeta(request), currentToken);
  return ok({ success: true });
});
