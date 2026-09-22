/**
 * Shared support for the HTTP test suites.
 *
 * Each suite is self-contained: it creates its own users through the real API
 * and reports through the shared `Reporter` so the runner can keep one summary.
 */
import { db } from "@/lib/db";
import { ApiClient, type ApiResult } from "./client";

export interface Reporter {
  check(name: string, condition: boolean, detail?: string): void;
  equal<T>(name: string, actual: T, expected: T): void;
  errorCode(name: string, result: ApiResult<unknown>, status: number, code: string): void;
}

export const DEFAULT_PASSWORD = "Password123!";

let counter = 0;

export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@api.filazero.test`;
}

export interface TestUser {
  client: ApiClient;
  email: string;
  userId: string;
}

/** Registers a CUSTOMER through the real endpoint and keeps the session. */
export async function createUser(
  baseUrl: string,
  prefix: string,
  password: string = DEFAULT_PASSWORD,
): Promise<TestUser> {
  const client = new ApiClient(baseUrl);
  const email = uniqueEmail(prefix);
  const result = await client.post<{ user: { id: string } }>("/api/auth/register", {
    name: prefix,
    email,
    password,
  });
  if (result.status !== 201 || !result.data) {
    throw new Error(
      `could not register ${email}: HTTP ${result.status} ${JSON.stringify(result.error)}`,
    );
  }
  return { client, email, userId: result.data.user.id };
}

export async function loginUser(
  baseUrl: string,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<TestUser> {
  const client = new ApiClient(baseUrl);
  const result = await client.post<{ user: { id: string } }>("/api/auth/login", {
    email,
    password,
  });
  if (result.status !== 200 || !result.data) {
    throw new Error(
      `could not log in ${email}: HTTP ${result.status} ${JSON.stringify(result.error)}`,
    );
  }
  return { client, email, userId: result.data.user.id };
}

/**
 * Creates a user and promotes it to ADMINISTRATOR directly in the database
 * (bootstrap only — the API never hands out that role).
 */
export async function createAdmin(baseUrl: string, prefix: string): Promise<TestUser> {
  const user = await createUser(baseUrl, prefix);
  await db.user.update({
    where: { id: user.userId },
    data: { role: "ADMINISTRATOR" },
  });
  return loginUser(baseUrl, user.email);
}
