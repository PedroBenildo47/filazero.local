import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ok, route } from "@/lib/http";
import { getAuthContext } from "@/server/auth/session-cookie";
import { publicUser } from "@/server/serializers";

/**
 * Current session. Returns the authenticated user and their organization
 * memberships so the client can render the right navigation without ever
 * deciding permissions locally.
 */
export const GET = route(async () => {
  const context = await getAuthContext();
  if (!context) {
    throw AppError.unauthenticated();
  }

  const user = await db.user.findUnique({ where: { id: context.user.id } });
  if (!user) {
    throw AppError.unauthenticated();
  }

  return ok({
    user: publicUser(user),
    memberships: context.memberships,
  });
});
