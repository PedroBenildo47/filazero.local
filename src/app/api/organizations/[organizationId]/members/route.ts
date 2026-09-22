import { created, getRequestMeta, ok, route } from "@/lib/http";
import { paginationSchema, parseJsonBody, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { addMember, listMembers } from "@/server/organizations/member.service";
import { addMemberSchema } from "@/server/organizations/member.schemas";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const pagination = parseSearchParams(request, paginationSchema);
  return ok(await listMembers(auth, organizationId, pagination));
});

export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, addMemberSchema);
  return created(await addMember(auth, organizationId, body, getRequestMeta(request)));
});
