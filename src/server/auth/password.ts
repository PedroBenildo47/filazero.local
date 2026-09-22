/**
 * Password hashing (bcrypt).
 *
 * Passwords are never stored, logged or returned. The cost factor comes from
 * `PASSWORD_HASH_ROUNDS` (>= 10).
 */
import "server-only";
import bcrypt from "bcryptjs";
import { getEnv } from "@/lib/env";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, getEnv().PASSWORD_HASH_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}
