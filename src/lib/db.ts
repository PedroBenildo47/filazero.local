/**
 * Prisma client singleton.
 *
 * In development Next.js hot-reloads server modules, which would otherwise open
 * a new connection pool on every reload. The instance is cached on `globalThis`.
 * The source of truth for all data is PostgreSQL — never localStorage.
 */
import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? [{ emit: "event", level: "error" }]
        : [
            { emit: "event", level: "error" },
            { emit: "event", level: "warn" },
          ],
  });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

/**
 * A Prisma client usable inside or outside an interactive transaction.
 * Services accept this type so they can run within `db.$transaction(tx => ...)`.
 */
export type DbClient = Prisma.TransactionClient;

/** True when `error` is a Prisma "unique constraint" violation. */
export function isUniqueConstraintError(
  error: unknown,
  target?: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (target === undefined ||
      (Array.isArray(error.meta?.target)
        ? (error.meta.target as string[]).includes(target)
        : error.meta?.target === target))
  );
}

/** True when `error` is a Prisma "record not found" error. */
export function isNotFoundError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025"
  );
}

export { Prisma };
