import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { deleteCounter, updateCounter } from "@/server/organizations/counter.service";
import { updateCounterSchema } from "@/server/organizations/counter.schemas";

type Context = { params: Promise<{ organizationId: string; counterId: string }> };

/** Manager: rename/activate/deactivate a counter. */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, counterId } = await context.params;
  const body = await parseJsonBody(request, updateCounterSchema);
  return ok(await updateCounter(auth, organizationId, counterId, body, getRequestMeta(request)));
});

/** Manager: remove a counter. */
export const DELETE = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId, counterId } = await context.params;
  return ok(await deleteCounter(auth, organizationId, counterId, getRequestMeta(request)));
});
