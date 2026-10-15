import { created, getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody, parseSearchParams } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { createCounter, listCounters } from "@/server/organizations/counter.service";
import {
  createCounterSchema,
  listCountersQuerySchema,
} from "@/server/organizations/counter.schemas";

type Context = { params: Promise<{ organizationId: string }> };

/** Manager: list the organization's service counters (optionally by branch). */
export const GET = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const query = parseSearchParams(request, listCountersQuerySchema);
  return ok(await listCounters(auth, organizationId, query));
});

/** Manager: create a service counter (guichê). */
export const POST = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { organizationId } = await context.params;
  const body = await parseJsonBody(request, createCounterSchema);
  return created(await createCounter(auth, organizationId, body, getRequestMeta(request)));
});
