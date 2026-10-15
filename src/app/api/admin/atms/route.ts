import { created, getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { createAtm, listAdminAtms } from "@/server/atms/atm.service";
import { atmQuerySchema, createAtmSchema } from "@/server/atms/atm.schemas";

/** Platform administrator: list every ATM (active or not). */
export const GET = route(async (request) => {
  const auth = await requireAuth();
  const query = parseSearchParams(request, atmQuerySchema);
  return ok(await listAdminAtms(auth, query));
});

/** Platform administrator: register a new ATM. */
export const POST = route(async (request) => {
  const auth = await requireAuth();
  const body = await parseJsonBody(request, createAtmSchema);
  return created(await createAtm(auth, body, getRequestMeta(request)));
});
