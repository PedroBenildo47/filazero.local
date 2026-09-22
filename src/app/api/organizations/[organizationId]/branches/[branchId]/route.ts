import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { getBranch, updateBranch } from "@/server/organizations/branch.service";
import { updateBranchSchema } from "@/server/organizations/branch.schemas";

type Context = { params: Promise<{ organizationId: string; branchId: string }> };

export const GET = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, branchId } = await context.params;
  return ok(await getBranch(auth, organizationId, branchId));
});

export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, branchId } = await context.params;
  const body = await parseJsonBody(request, updateBranchSchema);
  return ok(
    await updateBranch(auth, organizationId, branchId, body, getRequestMeta(request)),
  );
});
