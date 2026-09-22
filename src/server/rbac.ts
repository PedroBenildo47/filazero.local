/**
 * Role-based access control.
 *
 * This is the single source of truth for "which role may do what". It is pure
 * data + pure functions, so it can be unit-tested and reused by every API route
 * and server action. Hiding a button in the UI is never enough — every mutating
 * route must call `can()` / `assertCan()`.
 */
import type { UserRole } from "@prisma/client";
import { AppError } from "@/lib/errors";

export const PERMISSIONS = [
  // Customer
  "queue:read",
  "ticket:join",
  "ticket:read:self",
  "ticket:leave:self",
  "notification:read:self",
  "profile:update:self",

  // Staff
  "ticket:read:organization",
  "ticket:call",
  "ticket:serve",
  "ticket:complete",
  "ticket:cancel",

  // Manager
  "queue:manage",
  "branch:read:organization",
  "member:manage",
  "billing:read",
  "billing:manage",

  // Administrator
  "organization:manage",
  "branch:manage",
  "user:manage",
  "audit:read",
  "platform:admin",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER_PERMISSIONS: Permission[] = [
  "queue:read",
  "ticket:join",
  "ticket:read:self",
  "ticket:leave:self",
  "notification:read:self",
  "profile:update:self",
];

const STAFF_PERMISSIONS: Permission[] = [
  ...CUSTOMER_PERMISSIONS,
  "ticket:read:organization",
  "ticket:call",
  "ticket:serve",
  "ticket:complete",
  "ticket:cancel",
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  "queue:manage",
  "branch:read:organization",
  "member:manage",
  "billing:read",
  "billing:manage",
];

const ADMINISTRATOR_PERMISSIONS: Permission[] = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  CUSTOMER: new Set(CUSTOMER_PERMISSIONS),
  STAFF: new Set(STAFF_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  ADMINISTRATOR: new Set(ADMINISTRATOR_PERMISSIONS),
};

export function permissionsFor(role: UserRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function assertCan(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw AppError.forbidden();
  }
}

/** Organization-scoped roles that require an `organization_members` row. */
export const ORGANIZATION_ROLES: readonly UserRole[] = ["STAFF", "MANAGER"];

export function isOrganizationRole(role: UserRole): boolean {
  return ORGANIZATION_ROLES.includes(role);
}
