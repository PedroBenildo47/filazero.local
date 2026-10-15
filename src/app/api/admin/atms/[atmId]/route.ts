import { getRequestMeta, ok, route } from "@/lib/http";
import { parseJsonBody, uuidSchema } from "@/lib/validation";
import { requireAuth } from "@/server/auth/session-cookie";
import { deleteAtm, updateAtm } from "@/server/atms/atm.service";
import { updateAtmSchema } from "@/server/atms/atm.schemas";

type Context = { params: Promise<{ atmId: string }> };

/** Platform administrator: update an ATM (location, status, cash level, active). */
export const PATCH = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { atmId } = await context.params;
  uuidSchema.parse(atmId);
  const body = await parseJsonBody(request, updateAtmSchema);
  return ok(await updateAtm(auth, atmId, body, getRequestMeta(request)));
});

/** Platform administrator: permanently remove an ATM. */
export const DELETE = route(async (request, context: Context) => {
  const auth = await requireAuth();
  const { atmId } = await context.params;
  uuidSchema.parse(atmId);
  return ok(await deleteAtm(auth, atmId, getRequestMeta(request)));
});
