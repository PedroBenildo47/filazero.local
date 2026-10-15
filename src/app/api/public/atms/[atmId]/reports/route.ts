import { created, getRequestMeta, route } from "@/lib/http";
import { parseJsonBody, uuidSchema } from "@/lib/validation";
import { RATE_LIMITS } from "@/server/security/rate-limit.rules";
import { enforceRateLimits, ipKey } from "@/server/security/rate-limit.service";
import { submitCommunityReport } from "@/server/atms/atm.service";
import { atmReportSchema } from "@/server/atms/atm.schemas";

type Context = { params: Promise<{ atmId: string }> };

/**
 * Public community report: a citizen says whether an ATM has cash. Open, but
 * rate-limited per IP; the report is recorded and updates the ATM status.
 */
export const POST = route(async (request, context: Context) => {
  await enforceRateLimits([
    { key: ipKey("atm-report", request), rule: RATE_LIMITS.atmReport.ip },
  ]);

  const { atmId } = await context.params;
  uuidSchema.parse(atmId);
  const body = await parseJsonBody(request, atmReportSchema);
  return created(await submitCommunityReport(atmId, body, getRequestMeta(request)));
});
