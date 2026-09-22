import { created, getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody, parseSearchParams, paginationSchema } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { createBranch, listBranches } from "@/server/organizations/branch.service";
import { createBranchSchema } from "@/server/organizations/branch.schemas";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listBranches(auth, organizationId, pagination));
});

export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, createBranchSchema);
  return created(await createBranch(auth, organizationId, body, getRequestMeta(request)));
});
