import { created, getRequestMeta, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { register } from "@/server/auth/auth.service";
import { registerSchema } from "@/server/auth/auth.schemas";
import { setSessionCookie } from "@/server/auth/session-cookie";
import { publicUser } from "@/server/serializers";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import { enforceRateLimits, ipKey } from "@/server/security/rate-limit.service";

export const POST = route(async (request) => {
  const body = await parseJsonBody(request, registerSchema);
  await enforceRateLimits([
    { key: ipKey("auth:register", request), rule: RATE_LIMITS.register.ip },
  ]);
  const result = await register(body, getRequestMeta(request));
  await setSessionCookie(result.token, result.expiresAt);
  return created({ user: publicUser(result.user) });
});
