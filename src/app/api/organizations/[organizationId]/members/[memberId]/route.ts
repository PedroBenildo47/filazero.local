import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { removeMember, updateMember } from "@/server/organizations/member.service";
import { updateMemberSchema } from "@/server/organizations/member.schemas";

type Context = { params: Promise<{ organizationId: string; memberId: string }> };

export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, memberId } = await context.params;
  const body = await parseJsonBody(request, updateMemberSchema);
  return ok(
    await updateMember(auth, organizationId, memberId, body, getRequestMeta(request)),
  );
});

export const DELETE = route(async (_request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, memberId } = await context.params;
  await removeMember(auth, organizationId, memberId, getRequestMeta(_request));
  return ok({ success: true });
});
