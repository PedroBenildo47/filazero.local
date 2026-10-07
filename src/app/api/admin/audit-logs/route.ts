import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { listAuditLogs } from "@/server/platform/audit.service";
import { auditLogQuerySchema } from "@/server/platform/platform.schemas";

/** Platform administrator: global, filterable audit trail. */
export const GET = route(async (request) => {
  const context = await requireAuth();
  const query = parseSearchParams(request, auditLogQuerySchema);
  return ok(await listAuditLogs(context, query));
});
