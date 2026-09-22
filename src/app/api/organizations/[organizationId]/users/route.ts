import { ok, route } from "@/lib/http";
import { paginationSchema, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { searchUsers } from "@/server/organizations/member.service";

type Context = { params: Promise<{ organizationId: string }> };

/**
 * Finds existing users to attach to the organization as members.
 * Manager/admin only (enforced inside `searchUsers`).
 */
export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const pagination = parseSearchParams(request, paginationSchema);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return ok(await searchUsers(auth, organizationId, q, pagination));
});
