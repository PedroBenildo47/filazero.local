import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailSchema,
  paginationSchema,
  paginationToSkipTake,
  passwordSchema,
  phoneSchema,
  parseJsonBody,
  parseSearchParams,
  uuidSchema,
} from "@/lib/validation";
import { createOrganizationSchema } from "@/server/organizations/organization.schemas";
import { addMemberSchema, updateMemberSchema } from "@/server/organizations/member.schemas";
import { createQueueSchema, queueStatusSchema } from "@/server/queues/queue.schemas";
import { cancelTicketSchema } from "@/server/tickets/ticket.schemas";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("email schema trims and lowercases", () => {
  assert.equal(emailSchema.parse("  Ana.SILVA@Exemplo.AO "), "ana.silva@exemplo.ao");
});

test("email schema rejects malformed addresses", () => {
  for (const value of ["nao-e-email", "a@", "@b.com", ""]) {
    assert.equal(emailSchema.safeParse(value).success, false, value);
  }
});

test("password schema enforces the minimum length", () => {
  assert.equal(passwordSchema.safeParse("1234567").success, false);
  assert.equal(passwordSchema.safeParse("12345678").success, true);
  assert.equal(passwordSchema.safeParse("x".repeat(129)).success, false);
});

test("phone schema accepts Angolan-style numbers and rejects junk", () => {
  assert.equal(phoneSchema.safeParse("+244 923 456 789").success, true);
  assert.equal(phoneSchema.safeParse("923456789").success, true);
  assert.equal(phoneSchema.safeParse("abc").success, false);
});

test("uuid schema rejects non-uuid ids", () => {
  assert.equal(uuidSchema.safeParse("11111111-1111-1111-1111-111111111111").success, true);
  assert.equal(uuidSchema.safeParse("123").success, false);
});

test("pagination coerces strings and bounds pageSize to 100", () => {
  const parsed = paginationSchema.parse({ page: "3", pageSize: "50" });
  assert.equal(parsed.page, 3);
  assert.equal(parsed.pageSize, 50);
  assert.equal(paginationSchema.safeParse({ pageSize: "100" }).success, true);
  assert.equal(paginationSchema.safeParse({ pageSize: "500" }).success, false);
  assert.equal(paginationSchema.safeParse({ page: "0" }).success, false);
  assert.deepEqual(paginationToSkipTake({ page: 3, pageSize: 20 }), { skip: 40, take: 20 });
});

test("pagination defaults are applied", () => {
  const parsed = paginationSchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
});

test("parseJsonBody parses a valid body", async () => {
  const value = await parseJsonBody(jsonRequest({ name: "Ana" }), createOrganizationSchema);
  assert.equal(value.name, "Ana");
});

test("parseJsonBody rejects invalid JSON with a ZodError", async () => {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  await assert.rejects(() => parseJsonBody(request, createOrganizationSchema));
});

test("parseSearchParams validates query strings", () => {
  const request = new Request("http://localhost/api/test?page=2&pageSize=5");
  const parsed = parseSearchParams(request, paginationSchema);
  assert.deepEqual(parsed, { page: 2, pageSize: 5 });
});

test("organization schema requires a meaningful name", () => {
  assert.equal(createOrganizationSchema.safeParse({ name: "A" }).success, false);
  assert.equal(createOrganizationSchema.safeParse({ name: "Clínica Central" }).success, true);
});

test("addMember requires an existing user OR the data for a new one", () => {
  const byId = addMemberSchema.safeParse({
    userId: "11111111-1111-1111-1111-111111111111",
    role: "STAFF",
  });
  assert.equal(byId.success, true);

  const byNewUser = addMemberSchema.safeParse({
    name: "João",
    email: "joao@exemplo.ao",
    password: "Password123",
    role: "MANAGER",
  });
  assert.equal(byNewUser.success, true);

  const incomplete = addMemberSchema.safeParse({ name: "João", role: "STAFF" });
  assert.equal(incomplete.success, false);
});

test("addMember rejects CUSTOMER and ADMINISTRATOR as membership roles", () => {
  const base = { userId: "11111111-1111-1111-1111-111111111111" };
  assert.equal(addMemberSchema.safeParse({ ...base, role: "CUSTOMER" }).success, false);
  assert.equal(addMemberSchema.safeParse({ ...base, role: "ADMINISTRATOR" }).success, false);
});

test("updateMember accepts null branchId (access to every branch)", () => {
  const parsed = updateMemberSchema.parse({ role: "MANAGER", branchId: null });
  assert.equal(parsed.branchId, null);
});

test("queue schemas validate name and status enum", () => {
  assert.equal(createQueueSchema.safeParse({ name: "Atendimento" }).success, true);
  assert.equal(createQueueSchema.safeParse({ name: "X" }).success, false);
  assert.equal(queueStatusSchema.safeParse({ status: "OPEN" }).success, true);
  assert.equal(queueStatusSchema.safeParse({ status: "BANANA" }).success, false);
});

test("cancel ticket schema makes the reason optional and bounded", () => {
  assert.equal(cancelTicketSchema.safeParse({}).success, true);
  assert.equal(cancelTicketSchema.safeParse({ reason: "Duplicado" }).success, true);
  assert.equal(cancelTicketSchema.safeParse({ reason: "x".repeat(301) }).success, false);
});
