import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { resetPassword } from "@/server/auth/auth.service";
import { resetPasswordSchema } from "@/server/auth/auth.schemas";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import { enforceRateLimits, ipKey } from "@/server/security/rate-limit.service";

export const POST = route(async (request) => {
  const body = await parseJsonBody(request, resetPasswordSchema);
  await enforceRateLimits([
    {
      key: ipKey("auth:password-reset", request),
      rule: RATE_LIMITS.passwordReset.ip,
    },
  ]);
  await resetPassword(body, getRequestMeta(request));
  return ok({ success: true });
});
