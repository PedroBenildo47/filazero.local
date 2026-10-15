import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { listPublicAtms } from "@/server/atms/atm.service";
import { atmQuerySchema } from "@/server/atms/atm.schemas";

/**
 * Public ATM directory. Unauthenticated: a citizen checks which Multicaixa ATM
 * nearby has cash before walking there.
 */
export const GET = route(async (request) => {
  const query = parseSearchParams(request, atmQuerySchema);
  return ok(await listPublicAtms(query));
});
