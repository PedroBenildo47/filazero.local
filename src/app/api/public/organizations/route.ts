import { ok, route } from "@/lib/http";
import { parseSearchParams } from "@/lib/validation";
import { listPublicOrganizations } from "@/server/organizations/public.service";
import { publicDirectoryQuerySchema } from "@/server/organizations/public.schemas";

/** Public directory search. No authentication required. */
export const GET = route(async (request) => {
  const query = parseSearchParams(request, publicDirectoryQuerySchema);
  return ok(await listPublicOrganizations(query));
});
