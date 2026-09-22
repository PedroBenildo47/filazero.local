import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { login } from "@/server/auth/auth.service";
import { loginSchema } from "@/server/auth/auth.schemas";
import { setSessionCookie } from "@/server/auth/session-cookie";
import { publicUser } from "@/server/serializers";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import {
  enforceRateLimits,
  identityKey,
  ipKey,
} from "@/server/security/rate-limit.service";

export const POST = route(async (request) => {
  const body = await parseJsonBody(request, loginSchema);
  // Throttle before touching the database or hashing: brute force by IP and by
  // targeted account, counted before the password is even checked.
  await enforceRateLimits([
    { key: ipKey("auth:login", request), rule: RATE_LIMITS.login.ip },
    {
      key: identityKey("auth:login", body.email),
      rule: RATE_LIMITS.login.identity!,
    },
  ]);
  const result = await login(body, getRequestMeta(request));
  await setSessionCookie(result.token, result.expiresAt);
  return ok({ user: publicUser(result.user) });
});
