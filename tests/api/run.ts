/**
 * FilaZero — HTTP API test suite (Phase 14).
 *
 * Runs against a live Next.js server (`next start`) backed by a real
 * PostgreSQL. It exercises the public HTTP surface only: cookies, status codes,
 * error envelopes, RBAC, the queue engine, concurrency and the SSE stream.
 *
 *   API_BASE_URL=http://127.0.0.1:3000 npm run test:api
 *
 * The only direct database access is the bootstrap that promotes a freshly
 * registered user to ADMINISTRATOR (registrations always create CUSTOMERs).
 */
import { db } from "@/lib/db";
import { ApiClient, type ApiResult } from "./client";
import { runBillingSuite } from "./billing.spec";
import { runEmailSuite } from "./email.spec";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = "Password123!";
const STAFF_PASSWORD = "StaffPass123!";

interface Ctx {
  client: ApiClient;
  email: string;
  userId: string;
}

let passed = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(name, actual === expected, `got ${String(actual)}, expected ${String(expected)}`);
}

function expectStatus(name: string, result: ApiResult<unknown>, status: number) {
  ok(
    name,
    result.status === status,
    result.status === status
      ? `HTTP ${status}`
      : `HTTP ${result.status} (${result.error?.code ?? "sem código"})`,
  );
}

function expectCode(
  name: string,
  result: ApiResult<unknown>,
  status: number,
  code: string,
) {
  ok(
    name,
    result.status === status && result.error?.code === code,
    `HTTP ${result.status} / ${result.error?.code ?? "sem código"}`,
  );
}

let sequence = 0;
function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}.${Date.now()}.${sequence}@api.filazero.test`;
}

async function registerUser(prefix: string): Promise<Ctx> {
  const client = new ApiClient(BASE_URL);
  const email = uniqueEmail(prefix);
  const result = await client.post<{ user: { id: string } }>("/api/auth/register", {
    name: prefix,
    email,
    password: PASSWORD,
  });
  if (result.status !== 201) {
    throw new Error(`register ${prefix} failed: ${JSON.stringify(result.error)}`);
  }
  return { client, email, userId: result.data!.user.id };
}

async function login(client: ApiClient, email: string, password = PASSWORD) {
  return client.post("/api/auth/login", { email, password });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n=== FILAZERO HTTP API TESTS (${BASE_URL}) ===\n`);

  /* ------------------------------------------------------------------ */
  /* Authentication                                                      */
  /* ------------------------------------------------------------------ */

  const anonymous = new ApiClient(BASE_URL);

  // Health + unauthenticated access.
  const health = await anonymous.get<{ status: string; database: string }>("/api/health");
  eq("GET /api/health reports a reachable database", health.data?.database, "reachable");
  expectStatus(
    "unauthenticated request is rejected",
    await anonymous.get("/api/organizations"),
    401,
  );
  expectCode(
    "unauthenticated error code is UNAUTHENTICATED",
    await anonymous.get("/api/tickets/me"),
    401,
    "UNAUTHENTICATED",
  );

  // Registration.
  const customerA = await registerUser("customerA");
  ok("register sets an httpOnly session cookie", customerA.client.hasSessionCookie());
  const sessionA = await customerA.client.get<{
    user: { email: string; role: string };
    memberships: unknown[];
  }>("/api/auth/session");
  eq("register creates a CUSTOMER", sessionA.data?.user.role, "CUSTOMER");
  eq(
    "session returns the registered email (normalised to lowercase)",
    sessionA.data?.user.email,
    customerA.email.toLowerCase(),
  );

  const duplicate = await new ApiClient(BASE_URL).post("/api/auth/register", {
    name: "duplicado",
    email: customerA.email,
    password: PASSWORD,
  });
  expectCode("duplicate email is rejected", duplicate, 409, "CONFLICT");

  const weakPassword = await new ApiClient(BASE_URL).post("/api/auth/register", {
    name: "fraca",
    email: uniqueEmail("weak"),
    password: "123",
  });
  expectCode("weak password is rejected", weakPassword, 422, "VALIDATION_ERROR");

  // Login / logout.
  const freshLogin = new ApiClient(BASE_URL);
  expectCode(
    "wrong password is rejected",
    await login(freshLogin, customerA.email, "WrongPassword1!"),
    401,
    "UNAUTHENTICATED",
  );
  expectStatus("correct password logs in", await login(freshLogin, customerA.email), 200);
  expectStatus("logout succeeds", await freshLogin.post("/api/auth/logout"), 200);
  expectStatus(
    "session is dead after logout",
    await freshLogin.get("/api/auth/session"),
    401,
  );

  // Password reset. Uses a dedicated account because resetting a password
  // revokes that user's sessions — customerA's session must survive.
  const resetAccount = await registerUser("resetflow");
  const forgot = await anonymous.post<{ accepted: boolean; resetToken?: string }>(
    "/api/auth/password/forgot",
    { email: resetAccount.email },
  );
  ok(
    "forgot returns a reset token outside production",
    typeof forgot.data?.resetToken === "string" && forgot.data.resetToken.length > 10,
  );
  const unknownForgot = await anonymous.post<{ resetToken?: string }>(
    "/api/auth/password/forgot",
    { email: "naoexiste@api.filazero.test" },
  );
  eq("forgot never reveals unknown emails", unknownForgot.data?.resetToken, undefined);

  expectStatus(
    "reset password succeeds",
    await anonymous.post("/api/auth/password/reset", {
      token: forgot.data!.resetToken!,
      password: "NewPassword456!",
    }),
    200,
  );
  expectCode(
    "old password stops working",
    await login(new ApiClient(BASE_URL), resetAccount.email),
    401,
    "UNAUTHENTICATED",
  );
  expectCode(
    "reset token is single-use",
    await anonymous.post("/api/auth/password/reset", {
      token: forgot.data!.resetToken!,
      password: "AnotherPassword789!",
    }),
    400,
    "BAD_REQUEST",
  );
  expectStatus(
    "reset revokes only that user's sessions",
    await resetAccount.client.get("/api/auth/session"),
    401,
  );
  expectStatus(
    "other users' sessions are unaffected by a reset",
    await customerA.client.get("/api/auth/session"),
    200,
  );

  // Change password.
  const pwdClient = new ApiClient(BASE_URL);
  await login(pwdClient, resetAccount.email, "NewPassword456!");
  expectStatus(
    "change password succeeds",
    await pwdClient.post("/api/auth/password/change", {
      currentPassword: "NewPassword456!",
      newPassword: PASSWORD,
    }),
    200,
  );
  expectCode(
    "change password rejects a wrong current password",
    await pwdClient.post("/api/auth/password/change", {
      currentPassword: "nao-e-esta",
      newPassword: "Whatever123!",
    }),
    400,
    "BAD_REQUEST",
  );

  /* ------------------------------------------------------------------ */
  /* RBAC + tenancy                                                      */
  /* ------------------------------------------------------------------ */

  const customerB = await registerUser("customerB");

  // Bootstrap the platform administrator.
  const adminCtx = await registerUser("admin");
  await db.user.update({
    where: { id: adminCtx.userId },
    data: { role: "ADMINISTRATOR" },
  });
  await login(adminCtx.client, adminCtx.email);

  expectCode(
    "customer cannot create an organization",
    await customerA.client.post("/api/organizations", { name: "Nao autorizado" }),
    403,
    "FORBIDDEN",
  );

  const orgA = await adminCtx.client.post<{ id: string }>("/api/organizations", {
    name: `Clinica A ${Date.now()}`,
    city: "Luanda",
    category: "Saude",
  });
  expectStatus("admin creates organization A", orgA, 201);
  const orgB = await adminCtx.client.post<{ id: string }>("/api/organizations", {
    name: `Clinica B ${Date.now()}`,
    city: "Benguela",
  });
  expectStatus("admin creates organization B", orgB, 201);

  // Manager A (created by the admin, with a password).
  const managerAEmail = uniqueEmail("managerA");
  const managerAResult = await adminCtx.client.post<{ id: string }>(
    `/api/organizations/${orgA.data!.id}/members`,
    { name: "Manager A", email: managerAEmail, password: STAFF_PASSWORD, role: "MANAGER" },
  );
  expectStatus("admin adds manager A", managerAResult, 201);

  const managerA = new ApiClient(BASE_URL);
  await login(managerA, managerAEmail, STAFF_PASSWORD);
  expectCode(
    "customer cannot list another organization members",
    await customerA.client.get(`/api/organizations/${orgA.data!.id}/members`),
    403,
    "FORBIDDEN",
  );

  const branchA = await managerA.post<{ id: string }>(
    `/api/organizations/${orgA.data!.id}/branches`,
    { name: `Filial Talatona ${Date.now()}`, city: "Luanda" },
  );
  expectStatus("manager creates a branch", branchA, 201);

  // Manager B must not touch organization A.
  const managerBEmail = uniqueEmail("managerB");
  await adminCtx.client.post(`/api/organizations/${orgB.data!.id}/members`, {
    name: "Manager B",
    email: managerBEmail,
    password: STAFF_PASSWORD,
    role: "MANAGER",
  });
  const managerB = new ApiClient(BASE_URL);
  await login(managerB, managerBEmail, STAFF_PASSWORD);
  expectCode(
    "manager B cannot create a branch in organization A",
    await managerB.post(`/api/organizations/${orgA.data!.id}/branches`, { name: "Intruso" }),
    403,
    "FORBIDDEN",
  );
  expectCode(
    "manager B cannot list branches of organization A",
    await managerB.get(`/api/organizations/${orgA.data!.id}/branches`),
    403,
    "FORBIDDEN",
  );

  // Staff A.
  const staffAEmail = uniqueEmail("staffA");
  await managerA.post(`/api/organizations/${orgA.data!.id}/members`, {
    name: "Staff A",
    email: staffAEmail,
    password: STAFF_PASSWORD,
    role: "STAFF",
    branchId: branchA.data!.id,
  });
  const staffA = new ApiClient(BASE_URL);
  await login(staffA, staffAEmail, STAFF_PASSWORD);
  const staffSession = await staffA.get<{ user: { role: string } }>("/api/auth/session");
  eq("staff membership promotes the global role to STAFF", staffSession.data?.user.role, "STAFF");

  const queueFromStaff = await staffA.post(`/api/branches/${branchA.data!.id}/queues`, {
    name: "Sem permissao",
  });
  expectCode("staff cannot create a queue", queueFromStaff, 403, "FORBIDDEN");

  /* ------------------------------------------------------------------ */
  /* Queues                                                             */
  /* ------------------------------------------------------------------ */

  const queueA = await managerA.post<{ id: string }>(
    `/api/branches/${branchA.data!.id}/queues`,
    { name: `Atendimento ${Date.now()}`, status: "OPEN" },
  );
  expectStatus("manager creates an OPEN queue", queueA, 201);

  const publicQueue = await anonymous.get<{ id: string; waitingCount: number; status: string }>(
    `/api/queues/${queueA.data!.id}`,
  );
  eq("public queue info is available without auth", publicQueue.data?.status, "OPEN");
  eq("public queue starts with zero waiting", publicQueue.data?.waitingCount, 0);

  const search = await anonymous.get<{ items: { id: string; branches: unknown[] }[] }>(
    "/api/public/organizations?q=Clinica",
  );
  ok(
    "public search returns organizations from the database",
    (search.data?.items.length ?? 0) >= 2,
    `${search.data?.items.length ?? 0} resultados`,
  );

  /* ------------------------------------------------------------------ */
  /* Queue engine over HTTP                                              */
  /* ------------------------------------------------------------------ */

  const join1 = await customerA.client.post<{ ticketNumber: number; position: number; id: string }>(
    `/api/queues/${queueA.data!.id}/tickets`,
  );
  expectStatus("customer joins the queue", join1, 201);
  eq("first ticket number is 1", join1.data?.ticketNumber, 1);
  eq("first ticket position is 1", join1.data?.position, 1);

  const join2 = await customerB.client.post<{ ticketNumber: number; position: number }>(
    `/api/queues/${queueA.data!.id}/tickets`,
  );
  eq("second ticket number is 2", join2.data?.ticketNumber, 2);
  eq("second ticket position is 2", join2.data?.position, 2);

  expectCode(
    "joining twice is rejected",
    await customerA.client.post(`/api/queues/${queueA.data!.id}/tickets`),
    409,
    "CONFLICT",
  );

  const ticket2Id = await ticketIdFor(queueA.data!.id, 2);
  ok("ticket 2 is persisted in PostgreSQL", typeof ticket2Id === "string");

  const myTickets = await customerA.client.get<{
    active: { ticket: { status: string; position: number } } | null;
    history: { total: number };
  }>("/api/tickets/me");
  eq("client ticket endpoint returns the active ticket", myTickets.data?.active?.ticket.status, "WAITING");
  eq("active position is computed live", myTickets.data?.active?.ticket.position, 1);

  expectCode(
    "customer cannot call next",
    await customerA.client.post(`/api/queues/${queueA.data!.id}/call-next`),
    403,
    "FORBIDDEN",
  );
  expectCode(
    "manager B cannot call next on organization A queue",
    await managerB.post(`/api/queues/${queueA.data!.id}/call-next`),
    403,
    "FORBIDDEN",
  );

  const state = await staffA.get<{
    counts: { waiting: number };
    waiting: { ticketNumber: number }[];
  }>(`/api/queues/${queueA.data!.id}/state`);
  eq("staff sees two waiting customers", state.data?.counts.waiting, 2);

  // Call → serve → complete.
  const called = await staffA.post<{ id: string; ticketNumber: number; status: string }>(
    `/api/queues/${queueA.data!.id}/call-next`,
  );
  eq("call next returns ticket 1", called.data?.ticketNumber, 1);
  eq("called ticket status is CALLED", called.data?.status, "CALLED");

  expectCode(
    "cannot call next while a customer is in progress",
    await staffA.post(`/api/queues/${queueA.data!.id}/call-next`),
    409,
    "INVALID_STATE",
  );
  expectCode(
    "cannot start serving a WAITING ticket",
    await staffA.post(`/api/tickets/${ticket2Id!}/serve`),
    409,
    "INVALID_STATE",
  );

  expectStatus("start serving the called ticket", await staffA.post(`/api/tickets/${called.data!.id}/serve`), 200);
  expectStatus("complete the served ticket", await staffA.post(`/api/tickets/${called.data!.id}/complete`), 200);
  expectCode(
    "cannot complete an already completed ticket",
    await staffA.post(`/api/tickets/${called.data!.id}/complete`),
    409,
    "INVALID_STATE",
  );

  const notifications = await customerA.client.get<{
    items: { type: string }[];
    unread: number;
  }>("/api/notifications");
  const types = (notifications.data?.items ?? []).map((item) => item.type);
  ok("CUSTOMER_CALLED notification was persisted", types.includes("CUSTOMER_CALLED"));
  ok("SERVICE_COMPLETED notification was persisted", types.includes("SERVICE_COMPLETED"));

  expectStatus(
    "mark all notifications as read",
    await customerA.client.post("/api/notifications/read-all"),
    200,
  );
  const afterRead = await customerA.client.get<{ unread: number }>("/api/notifications");
  eq("unread count drops to zero", afterRead.data?.unread, 0);

  // Leave (customer B).
  const leave = await customerB.client.post<{ status: string }>(
    `/api/tickets/${ticket2Id!}/leave`,
  );
  eq("customer can leave the queue", leave.data?.status, "CANCELLED");

  // No-show flow.
  const queueNoShow = await managerA.post<{ id: string }>(
    `/api/branches/${branchA.data!.id}/queues`,
    { name: `No-show ${Date.now()}`, status: "OPEN" },
  );
  await customerA.client.post(`/api/queues/${queueNoShow.data!.id}/tickets`);
  const nsCalled = await staffA.post<{ id: string }>(
    `/api/queues/${queueNoShow.data!.id}/call-next`,
  );
  expectStatus(
    "staff marks a called ticket as no-show",
    await staffA.post(`/api/tickets/${nsCalled.data!.id}/no-show`),
    200,
  );
  eq("no-show ticket is terminal", (await ticketStatus(queueNoShow.data!.id, 1)) ?? "", "NO_SHOW");

  // Closed queue rejects joins.
  expectStatus(
    "manager closes the queue",
    await managerA.patch(`/api/queues/${queueA.data!.id}/status`, { status: "CLOSED" }),
    200,
  );
  const customerC = await registerUser("customerC");
  expectCode(
    "closed queue rejects new tickets",
    await customerC.client.post(`/api/queues/${queueA.data!.id}/tickets`),
    409,
    "QUEUE_CLOSED",
  );

  /* ------------------------------------------------------------------ */
  /* Concurrency over HTTP                                               */
  /* ------------------------------------------------------------------ */

  const queueRace = await managerA.post<{ id: string }>(
    `/api/branches/${branchA.data!.id}/queues`,
    { name: `Concorrencia ${Date.now()}`, status: "OPEN" },
  );

  // Two simultaneous joins must get distinct ticket numbers.
  const [racer1, racer2] = await Promise.all([
    customerB.client.post<{ ticketNumber: number }>(`/api/queues/${queueRace.data!.id}/tickets`),
    registerUser("racer").then((ctx) =>
      ctx.client.post<{ ticketNumber: number }>(`/api/queues/${queueRace.data!.id}/tickets`),
    ),
  ]);
  const numbers = [racer1.data?.ticketNumber, racer2.data?.ticketNumber].filter(
    (value): value is number => typeof value === "number",
  );
  ok(
    "simultaneous joins produce distinct ticket numbers",
    numbers.length === 2 && numbers[0] !== numbers[1],
    `números=${numbers.join(",")}`,
  );

  // Two simultaneous "call next" requests: exactly one must win.
  const raceResults = await Promise.all([
    staffA.post(`/api/queues/${queueRace.data!.id}/call-next`),
    staffA.post(`/api/queues/${queueRace.data!.id}/call-next`),
  ]);
  const winners = raceResults.filter((result) => result.status === 200).length;
  const losers = raceResults.filter((result) => result.status !== 200).length;
  ok(
    "two simultaneous call-next requests: exactly one succeeds",
    winners === 1 && losers === 1,
    `200=${winners} outros=${losers}`,
  );
  const inProgress = await staffA.get<{ counts: { called: number; serving: number } }>(
    `/api/queues/${queueRace.data!.id}/state`,
  );
  eq(
    "only one customer is in progress after the race",
    (inProgress.data?.counts.called ?? 0) + (inProgress.data?.counts.serving ?? 0),
    1,
  );

  /* ------------------------------------------------------------------ */
  /* Server-Sent Events                                                  */
  /* ------------------------------------------------------------------ */

  const queueStream = await managerA.post<{ id: string }>(
    `/api/branches/${branchA.data!.id}/queues`,
    { name: `Stream ${Date.now()}`, status: "OPEN" },
  );

  const controller = new AbortController();
  const streamResponse = await fetch(
    new URL(`/api/queues/${queueStream.data!.id}/stream`, BASE_URL),
    {
      headers: { cookie: staffA.cookieHeader() },
      signal: controller.signal,
    },
  );
  eq("SSE stream responds 200", streamResponse.status, 200);
  ok(
    "SSE content-type is text/event-stream",
    (streamResponse.headers.get("content-type") ?? "").includes("text/event-stream"),
    streamResponse.headers.get("content-type") ?? "",
  );

  const reader = streamResponse.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamClosed = false;

  async function waitForEvent(name: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (buffer.includes(`event: ${name}`)) return;
      const remaining = deadline - Date.now();
      const read = await Promise.race([
        reader.read(),
        sleep(remaining).then(() => null),
      ]);
      if (!read) break;
      if (read.done) {
        streamClosed = true;
        break;
      }
      buffer += decoder.decode(read.value, { stream: true });
    }
    if (!buffer.includes(`event: ${name}`)) {
      throw new Error(`timeout waiting for SSE event "${name}"`);
    }
  }

  try {
    await waitForEvent("ready", 8000);
    ok("SSE sends a ready event on connect", buffer.includes("event: ready"));

    const streamCustomer = await registerUser("streamcustomer");
    await streamCustomer.client.post(`/api/queues/${queueStream.data!.id}/tickets`);
    await waitForEvent("ticket.joined", 8000);
    ok("SSE delivers ticket.joined when a customer joins", buffer.includes("event: ticket.joined"));
    ok("SSE event carries an id for Last-Event-ID resumption", buffer.includes("id: "));
    ok("SSE stream stays open for further events", !streamClosed);

    await staffA.post(`/api/queues/${queueStream.data!.id}/call-next`);
    await waitForEvent("ticket.called", 8000);
    ok("SSE delivers ticket.called when staff calls next", buffer.includes("event: ticket.called"));
  } catch (error) {
    ok("SSE event delivery", false, String(error));
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }

  /* ------------------------------------------------------------------ */
  /* Phase 13 — security headers, CORS and rate limiting                 */
  /* ------------------------------------------------------------------ */

  const ALLOWED_ORIGIN = "http://localhost:3100";
  const UNKNOWN_ORIGIN = "https://evil.example";

  // --- Security headers -------------------------------------------------
  const apiHealth = await anonymous.get("/api/health");
  eq("security: X-Content-Type-Options is nosniff", apiHealth.headers.get("x-content-type-options"), "nosniff");
  eq("security: X-Frame-Options is DENY", apiHealth.headers.get("x-frame-options"), "DENY");
  eq(
    "security: Referrer-Policy is set",
    apiHealth.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  ok(
    "security: Content-Security-Policy restricts sources",
    (apiHealth.headers.get("content-security-policy") ?? "").includes("default-src 'self'"),
  );
  ok(
    "security: frame-ancestors is locked down",
    (apiHealth.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"),
  );
  ok(
    "security: Permissions-Policy disables powerful APIs",
    (apiHealth.headers.get("permissions-policy") ?? "").includes("camera=()"),
  );
  ok(
    "security: HSTS is sent by the production server",
    (apiHealth.headers.get("strict-transport-security") ?? "").includes("max-age="),
  );
  eq("security: X-Powered-By is not leaked", apiHealth.headers.get("x-powered-by"), null);

  const landingPage = await anonymous.get("/");
  eq("security: the landing page is served", landingPage.status, 200);
  eq(
    "security: HTML responses also carry X-Frame-Options",
    landingPage.headers.get("x-frame-options"),
    "DENY",
  );

  // --- CORS -------------------------------------------------------------
  const preflightAllowed = await anonymous.request("/api/health", {
    method: "OPTIONS",
    headers: { origin: ALLOWED_ORIGIN, "access-control-request-method": "POST" },
  });
  eq("cors: preflight from an allowed origin is 204", preflightAllowed.status, 204);
  eq(
    "cors: preflight echoes the allowed origin",
    preflightAllowed.headers.get("access-control-allow-origin"),
    ALLOWED_ORIGIN,
  );
  eq(
    "cors: preflight allows credentials",
    preflightAllowed.headers.get("access-control-allow-credentials"),
    "true",
  );
  ok(
    "cors: preflight advertises the allowed methods",
    (preflightAllowed.headers.get("access-control-allow-methods") ?? "").includes("POST"),
  );

  const preflightDenied = await anonymous.request("/api/health", {
    method: "OPTIONS",
    headers: { origin: UNKNOWN_ORIGIN, "access-control-request-method": "POST" },
  });
  eq("cors: preflight from an unknown origin is rejected", preflightDenied.status, 403);

  const crossOriginDenied = await anonymous.request("/api/health", {
    headers: { origin: UNKNOWN_ORIGIN },
  });
  eq("cors: a request from an unknown origin is rejected", crossOriginDenied.status, 403);
  eq(
    "cors: the rejection uses the standard error envelope",
    crossOriginDenied.error?.code,
    "FORBIDDEN",
  );

  const crossOriginAllowed = await anonymous.request("/api/health", {
    headers: { origin: ALLOWED_ORIGIN },
  });
  eq("cors: a request from an allowed origin succeeds", crossOriginAllowed.status, 200);
  eq(
    "cors: the allowed origin is echoed",
    crossOriginAllowed.headers.get("access-control-allow-origin"),
    ALLOWED_ORIGIN,
  );
  ok(
    "cors: responses vary on Origin",
    (crossOriginAllowed.headers.get("vary") ?? "").includes("Origin"),
  );

  const noOrigin = await anonymous.request("/api/health");
  eq("cors: requests without an Origin are unaffected", noOrigin.status, 200);

  // --- Rate limiting ----------------------------------------------------
  const throttled = await registerUser("throttle");
  let processedAttempts = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await login(new ApiClient(BASE_URL), throttled.email, "WrongPassword1!");
    if (result.status === 401) processedAttempts += 1;
  }
  eq(
    "rate limit: the first attempts inside the window are still processed",
    processedAttempts,
    8,
  );

  const loginLimited = await login(new ApiClient(BASE_URL), throttled.email, "WrongPassword1!");
  expectCode("rate limit: login by the same account is throttled", loginLimited, 429, "RATE_LIMITED");
  ok(
    "rate limit: the 429 carries a usable Retry-After",
    Number(loginLimited.headers.get("retry-after")) > 0,
    `retry-after=${loginLimited.headers.get("retry-after")}`,
  );
  eq(
    "rate limit: the 429 reports zero remaining",
    loginLimited.headers.get("ratelimit-remaining"),
    "0",
  );

  const otherAccount = await login(new ApiClient(BASE_URL), customerA.email);
  eq("rate limit: other accounts are unaffected", otherAccount.status, 200);

  const recoveryEmail = uniqueEmail("throttle-forgot");
  let recoveryProcessed = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await anonymous.post("/api/auth/password/forgot", { email: recoveryEmail });
    if (result.status === 200) recoveryProcessed += 1;
  }
  eq(
    "rate limit: recovery requests inside the window are processed",
    recoveryProcessed,
    3,
  );
  const recoveryLimited = await anonymous.post("/api/auth/password/forgot", {
    email: recoveryEmail,
  });
  expectCode(
    "rate limit: password recovery is throttled per account",
    recoveryLimited,
    429,
    "RATE_LIMITED",
  );

  /* ------------------------------------------------------------------ */
  /* Billing, plan limits and real email delivery (sibling suites)        */
  const reporter = { check: ok, equal: eq, errorCode: expectCode };
  await runBillingSuite({ baseUrl: BASE_URL, reporter });
  await runEmailSuite({ baseUrl: BASE_URL, reporter });

  /* Frontend smoke (Phase 8 + i18n default)                             */
  /* ------------------------------------------------------------------ */

  const landing = await anonymous.request("/");
  const landingBody = await fetch(new URL("/", BASE_URL)).then((r) => r.text());
  eq("frontend: the landing page renders", landing.status, 200);
  ok(
    "frontend: the default language is Portuguese",
    landingBody.includes("Filas sem confusão"),
  );
  ok(
    "frontend: the language switcher is present",
    landingBody.includes("lang-btn") && landingBody.includes("PT") && landingBody.includes("EN"),
  );
  for (const path of ["/pesquisar", "/login", "/registar"]) {
    const page = await anonymous.request(path);
    eq(`frontend: ${path} renders`, page.status, 200);
  }

  /* ------------------------------------------------------------------ */
  /* Summary                                                             */
  /* ------------------------------------------------------------------ */

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length > 0) {
    console.log("Failed checks:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  await db.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

/* ---------------------------------------------------------------------- */
/* Small database helpers (read-only) used to assert persisted state       */
/* ---------------------------------------------------------------------- */

async function ticketIdFor(queueId: string, ticketNumber: number): Promise<string | null> {
  const ticket = await db.ticket.findFirst({
    where: { queueId, ticketNumber },
    select: { id: true },
  });
  return ticket?.id ?? null;
}

async function ticketStatus(queueId: string, ticketNumber: number): Promise<string | null> {
  const ticket = await db.ticket.findFirst({
    where: { queueId, ticketNumber },
    select: { status: true },
  });
  return ticket?.status ?? null;
}

main().catch(async (error) => {
  console.error("FATAL:", error);
  await db.$disconnect();
  process.exit(1);
});
