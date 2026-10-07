import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCan, can, permissionsFor, PERMISSIONS, isOrganizationRole } from "@/server/rbac";
import {
  assertBranchAccess,
  assertOrganizationAccess,
  assertOrganizationRole,
} from "@/server/context";
import { AppError } from "@/lib/errors";
import type { UserRole } from "@prisma/client";

const ALL_ROLES: UserRole[] = ["CUSTOMER", "STAFF", "MANAGER", "ADMINISTRATOR"];

test("every role has a permission set with no unknown permission", () => {
  const known = new Set<string>(PERMISSIONS);
  for (const role of ALL_ROLES) {
    for (const permission of permissionsFor(role)) {
      assert.ok(known.has(permission), `${role} has unknown permission ${permission}`);
    }
  }
});

test("ADMINISTRATOR has platform controls but no operational permissions", () => {
  assert.equal(can("ADMINISTRATOR", "organization:manage"), true);
  assert.equal(can("ADMINISTRATOR", "platform:admin"), true);
  for (const permission of [
    "queue:read",
    "ticket:join",
    "ticket:read:self",
    "ticket:read:organization",
    "ticket:call",
    "ticket:complete",
    "notification:read:self",
    "branch:read:organization",
    "branch:manage",
    "queue:manage",
    "member:manage",
    "billing:read",
    "billing:manage",
    "user:manage",
    "audit:read",
  ] as const) {
    assert.equal(can("ADMINISTRATOR", permission), false, permission);
  }
});

test("ADMINISTRATOR cannot use organization guards with an accidental membership", () => {
  const context = {
    user: {
      id: "admin",
      name: "Admin",
      email: "admin@example.test",
      role: "ADMINISTRATOR" as const,
    },
    memberships: [
      {
        organizationId: "org-a",
        branchId: null,
        role: "MANAGER" as const,
        status: "ACTIVE" as const,
      },
    ],
  };
  const forbidden = (error: unknown) =>
    error instanceof AppError && error.code === "FORBIDDEN";

  assert.throws(() => assertOrganizationAccess(context, "org-a"), forbidden);
  assert.throws(() => assertBranchAccess(context, "org-a", "branch-a"), forbidden);
  assert.throws(() => assertOrganizationRole(context, "org-a", ["MANAGER"]), forbidden);
});

test("CUSTOMER cannot perform staff or management actions", () => {
  for (const permission of [
    "ticket:call",
    "ticket:serve",
    "ticket:complete",
    "ticket:read:organization",
    "queue:manage",
    "member:manage",
    "organization:manage",
    "platform:admin",
  ] as const) {
    assert.equal(can("CUSTOMER", permission), false, permission);
  }
});

test("CUSTOMER can read queues, join tickets and manage their own profile", () => {
  for (const permission of [
    "queue:read",
    "ticket:join",
    "ticket:read:self",
    "ticket:leave:self",
    "notification:read:self",
    "profile:update:self",
  ] as const) {
    assert.equal(can("CUSTOMER", permission), true, permission);
  }
});

test("STAFF can run the counter but not manage the organization", () => {
  assert.equal(can("STAFF", "ticket:call"), true);
  assert.equal(can("STAFF", "ticket:serve"), true);
  assert.equal(can("STAFF", "ticket:complete"), true);
  assert.equal(can("STAFF", "ticket:read:organization"), true);
  assert.equal(can("STAFF", "queue:manage"), false);
  assert.equal(can("STAFF", "member:manage"), false);
  assert.equal(can("STAFF", "organization:manage"), false);
});

test("MANAGER can manage queues and members but is not a platform admin", () => {
  assert.equal(can("MANAGER", "queue:manage"), true);
  assert.equal(can("MANAGER", "member:manage"), true);
  assert.equal(can("MANAGER", "ticket:call"), true);
  assert.equal(can("MANAGER", "organization:manage"), false);
  assert.equal(can("MANAGER", "platform:admin"), false);
  assert.equal(can("MANAGER", "audit:read"), false);
});

test("permission sets are strictly hierarchical (customer ⊂ staff ⊂ manager)", () => {
  const customer = permissionsFor("CUSTOMER");
  const staff = permissionsFor("STAFF");
  const manager = permissionsFor("MANAGER");
  for (const permission of customer) assert.ok(staff.has(permission), permission);
  for (const permission of staff) assert.ok(manager.has(permission), permission);
});

test("assertCan throws FORBIDDEN with a stable code", () => {
  assert.throws(
    () => assertCan("CUSTOMER", "ticket:call"),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
});

test("assertCan is a no-op when the role holds the permission", () => {
  assert.doesNotThrow(() => assertCan("MANAGER", "queue:manage"));
  assert.doesNotThrow(() => assertCan("ADMINISTRATOR", "platform:admin"));
});

test("organization roles are exactly STAFF and MANAGER", () => {
  assert.equal(isOrganizationRole("STAFF"), true);
  assert.equal(isOrganizationRole("MANAGER"), true);
  assert.equal(isOrganizationRole("CUSTOMER"), false);
  assert.equal(isOrganizationRole("ADMINISTRATOR"), false);
});
