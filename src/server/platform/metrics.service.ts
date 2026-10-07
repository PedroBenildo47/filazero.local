import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/server/context";
import { requirePermission } from "@/server/context";

export async function getPlatformMetrics(context: AuthContext) {
  requirePermission(context, "platform:admin");

  const [totalOrganizations, activeOrganizations, suspendedOrganizations, inactiveOrganizations, totalUsers, activeUsers] =
    await db.$transaction([
      db.organization.count(),
      db.organization.count({ where: { status: "ACTIVE" } }),
      db.organization.count({ where: { status: "SUSPENDED" } }),
      db.organization.count({ where: { status: "INACTIVE" } }),
      db.user.count(),
      db.user.count({ where: { status: "ACTIVE" } }),
    ]);

  return {
    organizations: {
      total: totalOrganizations,
      active: activeOrganizations,
      suspended: suspendedOrganizations,
      inactive: inactiveOrganizations,
    },
    users: {
      total: totalUsers,
      active: activeUsers,
    },
  };
}
