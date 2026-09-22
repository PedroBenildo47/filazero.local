/**
 * Request authentication/authorization context.
 *
 * Populated by the authentication layer (Phase 3) from the session cookie.
 * Every handler that touches tenant data receives this context and must scope
 * its queries through `assertOrganizationAccess` / `assertBranchAccess`.
 *
 * These helpers are the guard against cross-organization data access: a STAFF
 * of organization A must not read organization B's data by changing an ID.
 */
import type { UserRole, MemberStatus } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { can, type Permission } from "@/server/rbac";

export interface MembershipContext {
  organizationId: string;
  /** null = access to every branch of the organization. */
  branchId: string | null;
  role: UserRole;
  status: MemberStatus;
}

export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  memberships: MembershipContext[];
}

/** Throws unless the caller may perform `permission`. */
export function requirePermission(ctx: AuthContext, permission: Permission): void {
  if (!can(ctx.user.role, permission)) {
    throw AppError.forbidden();
  }
}

function activeMemberships(ctx: AuthContext, organizationId: string) {
  return ctx.memberships.filter(
    (m) => m.organizationId === organizationId && m.status === "ACTIVE",
  );
}

/**
 * Adminstrators have global access. Everyone else must hold an active
 * membership for the organization.
 */
export function assertOrganizationAccess(
  ctx: AuthContext,
  organizationId: string,
): void {
  if (ctx.user.role === "ADMINISTRATOR") return;
  if (activeMemberships(ctx, organizationId).length === 0) {
    throw AppError.forbidden();
  }
}

/**
 * Branch-level access. A membership with `branchId = null` covers the whole
 * organization; a membership with a concrete branch covers only that branch.
 */
export function assertBranchAccess(
  ctx: AuthContext,
  organizationId: string,
  branchId: string,
): void {
  if (ctx.user.role === "ADMINISTRATOR") return;

  const memberships = activeMemberships(ctx, organizationId);
  const allowed = memberships.some(
    (m) => m.branchId === null || m.branchId === branchId,
  );
  if (!allowed) {
    throw AppError.forbidden();
  }
}

/** True when the caller holds one of `roles` inside the organization (or is admin). */
export function hasOrganizationRole(
  ctx: AuthContext,
  organizationId: string,
  roles: readonly UserRole[],
): boolean {
  if (ctx.user.role === "ADMINISTRATOR") return true;
  return activeMemberships(ctx, organizationId).some((m) =>
    roles.includes(m.role),
  );
}

/** Throws unless the caller holds one of `roles` inside the organization. */
export function assertOrganizationRole(
  ctx: AuthContext,
  organizationId: string,
  roles: readonly UserRole[],
): void {
  if (!hasOrganizationRole(ctx, organizationId, roles)) {
    throw AppError.forbidden();
  }
}

/**
 * Guard for organization-management operations (branches, queues, members).
 * Allowed for a MANAGER of the organization or a platform ADMINISTRATOR.
 */
export function assertManagerOfOrganization(
  ctx: AuthContext,
  organizationId: string,
): void {
  assertOrganizationRole(ctx, organizationId, ["MANAGER"]);
}
