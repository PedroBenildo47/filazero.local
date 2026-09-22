import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requestPasswordReset } from "@/server/auth/auth.service";
import { forgotPasswordSchema } from "@/server/auth/auth.schemas";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import {
  enforceRateLimits,
  identityKey,
  ipKey,
} from "@/server/security/rate-limit.service";
import { LANG_COOKIE, isLang } from "@/lib/i18n";

/**
 * Requests a password reset.
 *
 * Always returns 200 with the same body, whether or not the email exists, to
 * prevent account enumeration. When SMTP is configured the reset link is
 * emailed in the requester's language; otherwise (development only) the token
 * is returned so the flow remains testable.
 */
export const POST = route(async (request) => {
  const body = await parseJsonBody(request, forgotPasswordSchema);
  await enforceRateLimits([
    {
      key: ipKey("auth:password-forgot", request),
      rule: RATE_LIMITS.passwordForgot.ip,
    },
    {
      key: identityKey("auth:password-forgot", body.email),
      rule: RATE_LIMITS.passwordForgot.identity!,
    },
  ]);

  const cookieLang = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANG_COOKIE}=`))
    ?.slice(LANG_COOKIE.length + 1);

  const lang = isLang(cookieLang) ? cookieLang : "pt";

  const result = await requestPasswordReset(body.email, getRequestMeta(request), lang);
  return ok(result);
});
