import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody, uuidSchema } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { submitStaffReport } from "@/server/atms/atm.service";
import { atmReportSchema } from "@/server/atms/atm.schemas";

type Context = { params: Promise<{ atmId: string }> };

/** Authenticated staff/manager updates an ATM's cash status (source MANAGER/ADMIN). */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { atmId } = await context.params;
  uuidSchema.parse(atmId);
  const body = await parseJsonBody(request, atmReportSchema);
  return ok(await submitStaffReport(auth, atmId, body, getRequestMeta(request)));
});
