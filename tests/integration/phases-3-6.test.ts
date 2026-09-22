/**
 * FilaZero — integration test (Phases 3–6) against a real PostgreSQL engine.
 *
 * Runs the actual service layer (auth, organizations, branches, members,
 * queues, tickets) against PGlite served over TCP. No mocks, no fake data:
 * every assertion reads back from the database.
 */
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/server/context";
import type { RequestMeta } from "@/lib/http";
import {
  register,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  changePassword,
} from "@/server/auth/auth.service";
import { resolveAuthContext } from "@/server/auth/session.store";
import { createOrganization, updateOrganization, setOrganizationStatus } from "@/server/organizations/organization.service";
import { createBranch } from "@/server/organizations/branch.service";
import { addMember, removeMember } from "@/server/organizations/member.service";
import { createQueue, setQueueStatus, getPublicQueue } from "@/server/queues/queue.service";
import {
  joinQueue,
  getMyActiveTicket,
  leaveQueue,
  callNext,
  startServing,
  completeService,
  markNoShow,
  cancelTicket,
  getQueueState,
} from "@/server/tickets/ticket.service";

const meta: RequestMeta = { ipAddress: "127.0.0.1", userAgent: "integration-test" };

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function checkEqual<T>(name: string, actual: T, expected: T) {
  check(name, actual === expected, `got ${String(actual)}, expected ${String(expected)}`);
}

async function expectError(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, `expected ${code} but the call succeeded`);
  } catch (error) {
    const isApp = error instanceof AppError;
    check(
      name,
      isApp && (error as AppError).code === code,
      isApp ? `code=${(error as AppError).code}` : `unexpected: ${String(error)}`,
    );
  }
}

let seq = 0;
function email(prefix: string) {
  seq += 1;
  return `${prefix}.${seq}@filazero.test`;
}

const PASSWORD = "Password123!";

async function makeUser(prefix: string, role: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMINISTRATOR" = "CUSTOMER") {
  const mail = email(prefix);
  const result = await register({ name: prefix, email: mail, password: PASSWORD }, meta);
  if (role !== "CUSTOMER") {
    await db.user.update({ where: { id: result.user.id }, data: { role } });
  }
  const ctx = await resolveAuthContext(result.token);
  if (!ctx) throw new Error(`could not resolve context for ${prefix}`);
  return { id: result.user.id, email: mail, token: result.token, ctx };
}

async function main() {
  console.log("\n=== FILAZERO INTEGRATION TEST (Phases 3–6) ===\n");

  /* ---------------- Phase 3: authentication ---------------- */

  const customer1 = await makeUser("customer1");
  const customer2 = await makeUser("customer2");
  checkEqual("register creates an ACTIVE CUSTOMER", customer1.ctx.user.role, "CUSTOMER");

  const dbUser = await db.user.findUniqueOrThrow({ where: { id: customer1.id } });
  check("password stored as bcrypt hash", dbUser.passwordHash.startsWith("$2"), dbUser.passwordHash.slice(0, 7));
  check("password is never the plaintext", dbUser.passwordHash !== PASSWORD);

  await expectError("duplicate email is rejected", "CONFLICT", () =>
    register({ name: "dup", email: customer1.email, password: PASSWORD }, meta),
  );

  await expectError("login with wrong password is rejected", "UNAUTHENTICATED", () =>
    login({ email: customer1.email, password: "WrongPassword1!" }, meta),
  );

  const loginResult = await login({ email: customer1.email, password: PASSWORD }, meta);
  check("login returns a session token", loginResult.token.length > 20);
  const resolved = await resolveAuthContext(loginResult.token);
  check("session token resolves to the user", resolved?.user.id === customer1.id);
  const tampered = await resolveAuthContext(`${loginResult.token}x`);
  check("tampered token does not resolve", tampered === null);

  const sessionRow = await db.session.findFirst({ where: { userId: customer1.id } });
  check("session stored as a hash, never the raw token", sessionRow !== null && sessionRow.tokenHash !== loginResult.token);

  await logout(loginResult.token, meta);
  check("logout revokes the session", (await resolveAuthContext(loginResult.token)) === null);

  // Password reset flow.
  const fresh = await login({ email: customer1.email, password: PASSWORD }, meta);
  const forgot = await requestPasswordReset(customer1.email, meta);
  check("password reset token issued", typeof forgot.resetToken === "string" && forgot.resetToken!.length > 20);
  const unknownForgot = await requestPasswordReset("nobody@filazero.test", meta);
  check("unknown email does not leak existence", unknownForgot.resetToken === undefined);

  await resetPassword({ token: forgot.resetToken!, password: "NewPassword456!" }, meta);
  await expectError("old password no longer works after reset", "UNAUTHENTICATED", () =>
    login({ email: customer1.email, password: PASSWORD }, meta),
  );
  check("session was revoked by the password reset", (await resolveAuthContext(fresh.token)) === null);
  await expectError("reset token is single-use", "BAD_REQUEST", () =>
    resetPassword({ token: forgot.resetToken!, password: "Another789!" }, meta),
  );

  const afterReset = await login({ email: customer1.email, password: "NewPassword456!" }, meta);
  await changePassword(customer1.id, { currentPassword: "NewPassword456!", newPassword: PASSWORD }, meta, afterReset.token);
  await expectError("change password rejects a wrong current password", "BAD_REQUEST", () =>
    changePassword(customer1.id, { currentPassword: "nope-not-it", newPassword: "Xyz12345!" }, meta, afterReset.token),
  );
  const finalLogin = await login({ email: customer1.email, password: PASSWORD }, meta);
  check("changed password works", finalLogin.token.length > 20);

  // Rebuild contexts after the password dance.
  const c1ctx = (await resolveAuthContext(finalLogin.token))!;
  const c2ctx = customer2.ctx;

  /* ---------------- Phase 4: tenancy ---------------- */

  const admin = await makeUser("admin", "ADMINISTRATOR");
  const orgA = await createOrganization(admin.ctx, { name: "Clinica Central A", city: "Luanda" }, meta);
  const orgB = await createOrganization(admin.ctx, { name: "Clinica Central B", city: "Benguela" }, meta);
  check("administrator creates organizations", Boolean(orgA.id) && Boolean(orgB.id));

  await expectError("customer cannot create an organization", "FORBIDDEN", () =>
    createOrganization(c1ctx, { name: "Nope" }, meta),
  );

  const branchA = await createBranch(admin.ctx, orgA.id, { name: "Filial Talatona", city: "Luanda" }, meta);
  const branchB = await createBranch(admin.ctx, orgB.id, { name: "Filial Benguela", city: "Benguela" }, meta);
  check("branches created under each organization", branchA.organizationId === orgA.id && branchB.organizationId === orgB.id);

  // Manager of A, then staff of A.
  const managerMail = email("managerA");
  await addMember(admin.ctx, orgA.id, { name: "Manager A", email: managerMail, password: PASSWORD, role: "MANAGER" }, meta);
  const managerA = await login({ email: managerMail, password: PASSWORD }, meta);
  const managerActx = (await resolveAuthContext(managerA.token))!;
  checkEqual("added member receives the global MANAGER role", managerActx.user.role, "MANAGER");
  check("membership grants access to organization A", managerActx.memberships.some((m) => m.organizationId === orgA.id));

  const staffMail = email("staffA");
  await addMember(managerActx, orgA.id, { name: "Staff A", email: staffMail, password: PASSWORD, role: "STAFF", branchId: branchA.id }, meta);
  const staffA = await login({ email: staffMail, password: PASSWORD }, meta);
  const staffActx = (await resolveAuthContext(staffA.token))!;
  checkEqual("added member receives the global STAFF role", staffActx.user.role, "STAFF");

  // Manager of B.
  const managerBMail = email("managerB");
  await addMember(admin.ctx, orgB.id, { name: "Manager B", email: managerBMail, password: PASSWORD, role: "MANAGER" }, meta);
  const managerBLogin = await login({ email: managerBMail, password: PASSWORD }, meta);
  const managerBctx = (await resolveAuthContext(managerBLogin.token))!;

  await expectError("manager B cannot create a branch in organization A", "FORBIDDEN", () =>
    createBranch(managerBctx, orgA.id, { name: "Intruso" }, meta),
  );

  const staffBResult = await addMember(managerBctx, orgB.id, { name: "Staff B", email: email("staffB"), password: PASSWORD, role: "STAFF" }, meta);
  check("manager B can manage its own organization", Boolean(staffBResult.id));

  // Last-manager protection.
  const managerMember = await db.organizationMember.findFirstOrThrow({
    where: { organizationId: orgB.id, role: "MANAGER", status: "ACTIVE" },
  });
  await expectError("cannot remove the last active manager", "CONFLICT", async () =>
    removeMember(managerBctx, orgB.id, managerMember.id, meta),
  );

  await updateOrganization(managerActx, orgA.id, { category: "Saude", description: "Clinica" }, meta);
  const orgAAfter = await db.organization.findUniqueOrThrow({ where: { id: orgA.id } });
  checkEqual("manager updates its organization", orgAAfter.category, "Saude");

  await expectError("customer cannot suspend an organization", "FORBIDDEN", () =>
    setOrganizationStatus(c1ctx, orgA.id, "SUSPENDED", meta),
  );

  /* ---------------- Phase 5: queues ---------------- */

  const queueA = await createQueue(managerActx, branchA.id, { name: "Atendimento Geral", status: "OPEN" }, meta);
  checkEqual("manager opens a queue", queueA.status, "OPEN");

  await expectError("staff cannot create a queue", "FORBIDDEN", () =>
    createQueue(staffActx, branchA.id, { name: "Sem permissao" }, meta),
  );

  const publicQueue = await getPublicQueue(queueA.id);
  check("public queue info is visible without auth", publicQueue.id === queueA.id && publicQueue.waitingCount === 0);

  /* ---------------- Phase 6: queue engine ---------------- */

  const t1 = await joinQueue(c1ctx, queueA.id, meta);
  const t2 = await joinQueue(c2ctx, queueA.id, meta);
  checkEqual("first ticket number is 1", t1.ticketNumber, 1);
  checkEqual("second ticket number is 2", t2.ticketNumber, 2);
  checkEqual("first ticket position is 1", t1.position, 1);
  checkEqual("second ticket position is 2", t2.position, 2);

  const persisted = await db.ticket.findUnique({ where: { id: t1.id } });
  check("ticket is persisted in the database", persisted !== null && persisted.status === "WAITING");

  await expectError("same customer cannot join the same queue twice", "CONFLICT", () =>
    joinQueue(c1ctx, queueA.id, meta),
  );

  // Concurrency: two simultaneous joins must receive distinct ticket numbers.
  const c3 = await makeUser("customer3");
  const c4 = await makeUser("customer4");
  const [j3, j4] = await Promise.all([
    joinQueue(c3.ctx, queueA.id, meta).catch((e) => e),
    joinQueue(c4.ctx, queueA.id, meta).catch((e) => e),
  ]);
  const joinNumbers = [j3, j4].filter((t) => !(t instanceof Error)).map((t) => t.ticketNumber).sort((a, b) => a - b);
  check(
    "concurrent joins produce unique sequential ticket numbers",
    joinNumbers.length === 2 && joinNumbers[0] !== joinNumbers[1],
    `numbers=${joinNumbers.join(",")}`,
  );

  // Position is live, not just the cached column.
  const active2 = await getMyActiveTicket(c2ctx);
  checkEqual("live position of customer 2 is 2", active2?.ticket.position, 2);

  // Access control on staff operations.
  await expectError("staff of organization B cannot call next on queue A", "FORBIDDEN", () =>
    callNext(managerBctx, queueA.id, meta),
  );
  await expectError("customer cannot call next", "FORBIDDEN", () =>
    callNext(c1ctx, queueA.id, meta),
  );

  // Call next.
  const called = await callNext(staffActx, queueA.id, meta);
  checkEqual("call next selects ticket 1", called.ticketNumber, 1);
  checkEqual("called ticket status is CALLED", called.status, "CALLED");
  const queueAfterCall = await db.queue.findUniqueOrThrow({ where: { id: queueA.id } });
  checkEqual("queue current ticket is set", queueAfterCall.currentTicketId, t1.id);

  const notified1 = await db.notification.findFirst({
    where: { userId: customer1.id, type: "CUSTOMER_CALLED" },
  });
  check("customer 1 received a real CALLED notification", notified1 !== null);

  const posAfterCall = (await getMyActiveTicket(c2ctx))?.ticket.position;
  checkEqual("customer 2 moved up to position 1", posAfterCall, 1);

  await expectError("cannot call next while a customer is in progress", "INVALID_STATE", () =>
    callNext(staffActx, queueA.id, meta),
  );

  // Invalid transition.
  await expectError("cannot start serving a WAITING ticket", "INVALID_STATE", () =>
    startServing(staffActx, t2.id, meta),
  );

  const serving = await startServing(staffActx, t1.id, meta);
  checkEqual("ticket moves to SERVING", serving.status, "SERVING");
  const servedNotif = await db.notification.findFirst({ where: { userId: customer1.id, type: "SERVING_STARTED" } });
  check("SERVING_STARTED notification persisted", servedNotif !== null);

  const completed = await completeService(staffActx, t1.id, meta);
  checkEqual("ticket completes", completed.status, "COMPLETED");
  const queueAfterComplete = await db.queue.findUniqueOrThrow({ where: { id: queueA.id } });
  check("queue current ticket is cleared", queueAfterComplete.currentTicketId === null);
  const completedNotif = await db.notification.findFirst({ where: { userId: customer1.id, type: "SERVICE_COMPLETED" } });
  check("SERVICE_COMPLETED notification persisted", completedNotif !== null);

  // Leave the queue (customer 2).
  const left = await leaveQueue(c2ctx, t2.id, meta);
  checkEqual("customer can leave the queue", left.status, "CANCELLED");
  const waitingAfterLeave = await db.ticket.findMany({
    where: { queueId: queueA.id, status: "WAITING" },
    orderBy: [{ joinedAt: "asc" }, { ticketNumber: "asc" }],
    select: { position: true },
  });
  check(
    "remaining positions recomputed starting at 1",
    waitingAfterLeave.length === 2 && waitingAfterLeave[0]?.position === 1 && waitingAfterLeave[1]?.position === 2,
    `positions=${waitingAfterLeave.map((t) => t.position).join(",")}`,
  );

  // No-show on ticket 3.
  const called3 = await callNext(staffActx, queueA.id, meta);
  checkEqual("call next selects the next waiting ticket", called3.ticketNumber, 3);
  const noShow = await markNoShow(staffActx, called3.id, meta);
  checkEqual("ticket marked as NO_SHOW", noShow.status, "NO_SHOW");

  // Staff cancellation of a ticket in progress.
  const called4 = await callNext(staffActx, queueA.id, meta);
  checkEqual("call next selects ticket 4", called4.ticketNumber, 4);
  const cancelled = await cancelTicket(staffActx, called4.id, { reason: "Duplicado" }, meta);
  checkEqual("staff cancels a called ticket", cancelled.status, "CANCELLED");

  // Queue state for staff.
  const state = await getQueueState(staffActx, queueA.id, 10);
  checkEqual("staff sees the waiting count", state.counts.waiting, 0);
  check("staff sees completed history", state.counts.completed >= 1 && state.counts.cancelled >= 1);
  check("staff sees recent finished tickets", state.recent.length >= 1);

  // True concurrency: two staff call "next" at the same instant.
  const queueC = await createQueue(managerActx, branchA.id, { name: "Concorrencia", status: "OPEN" }, meta);
  const cu1 = await makeUser("conc1");
  const cu2 = await makeUser("conc2");
  await joinQueue(cu1.ctx, queueC.id, meta);
  await joinQueue(cu2.ctx, queueC.id, meta);
  const race = await Promise.allSettled([
    callNext(staffActx, queueC.id, meta),
    callNext(staffActx, queueC.id, meta),
  ]);
  const succeeded = race.filter((r) => r.status === "fulfilled");
  const rejected = race.filter((r) => r.status === "rejected");
  check(
    "two simultaneous call-next: exactly one succeeds",
    succeeded.length === 1 && rejected.length === 1,
    `ok=${succeeded.length} rejected=${rejected.length}`,
  );
  const inProgress = await db.ticket.count({
    where: { queueId: queueC.id, status: { in: ["CALLED", "SERVING"] } },
  });
  checkEqual("only one customer is in progress after the race", inProgress, 1);

  // Closing a queue blocks new joins.
  await setQueueStatus(managerActx, queueA.id, "CLOSED", meta);
  const c5 = await makeUser("customer5");
  await expectError("closed queue rejects new tickets", "QUEUE_CLOSED", () =>
    joinQueue(c5.ctx, queueA.id, meta),
  );

  // Audit trail.
  const auditCount = await db.auditLog.count();
  check("audit log recorded the operations", auditCount >= 10, `${auditCount} entries`);

  // Tenant isolation on a suspended organization.
  await setOrganizationStatus(admin.ctx, orgB.id, "SUSPENDED", meta);
  const publicB = await db.organization.findUniqueOrThrow({ where: { id: orgB.id } });
  checkEqual("administrator suspends organization B", publicB.status, "SUSPENDED");

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length > 0) {
    console.log("Failed checks:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  await db.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("FATAL:", error);
  await db.$disconnect();
  process.exit(1);
});
