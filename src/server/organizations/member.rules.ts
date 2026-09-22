/**
 * Membership rules (pure, unit-testable).
 *
 * `users.role` is the platform-wide role that drives permissions;
 * `organization_members.role` is the role inside one organization. Adding a
 * membership may promote the global role, but must never downgrade it and must
 * never touch an ADMINISTRATOR.
 */
import type { UserRole } from "@prisma/client";

export type MemberRole = "STAFF" | "MANAGER";

export function promotedRole(current: UserRole, memberRole: MemberRole): UserRole {
  if (current === "ADMINISTRATOR") return current;
  if (memberRole === "MANAGER") return "MANAGER";
  if (current === "CUSTOMER") return "STAFF";
  return current;
}
