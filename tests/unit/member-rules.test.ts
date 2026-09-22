import { test } from "node:test";
import assert from "node:assert/strict";
import { promotedRole } from "@/server/organizations/member.rules";

test("a CUSTOMER added as STAFF is promoted to STAFF", () => {
  assert.equal(promotedRole("CUSTOMER", "STAFF"), "STAFF");
});

test("a CUSTOMER added as MANAGER is promoted straight to MANAGER", () => {
  assert.equal(promotedRole("CUSTOMER", "MANAGER"), "MANAGER");
});

test("a STAFF added as MANAGER is promoted", () => {
  assert.equal(promotedRole("STAFF", "MANAGER"), "MANAGER");
});

test("an existing STAFF is never downgraded by a STAFF membership", () => {
  assert.equal(promotedRole("STAFF", "STAFF"), "STAFF");
});

test("an existing MANAGER is never downgraded by a STAFF membership", () => {
  assert.equal(promotedRole("MANAGER", "STAFF"), "MANAGER");
});

test("an ADMINISTRATOR is never touched", () => {
  assert.equal(promotedRole("ADMINISTRATOR", "STAFF"), "ADMINISTRATOR");
  assert.equal(promotedRole("ADMINISTRATOR", "MANAGER"), "ADMINISTRATOR");
});

test("pomotion is idempotent", () => {
  const once = promotedRole("CUSTOMER", "MANAGER");
  assert.equal(promotedRole(once, "MANAGER"), once);
});
