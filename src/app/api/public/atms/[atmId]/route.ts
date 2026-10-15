import { ok, route } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { getPublicAtm } from "@/server/atms/atm.service";

type Context = { params: Promise<{ atmId: string }> };

/** Public ATM detail with its recent status reports. */
export const GET = route(async (_request, context: Context) => {
  const { atmId } = await context.params;
  uuidSchema.parse(atmId);
  return ok(await getPublicAtm(atmId));
});
