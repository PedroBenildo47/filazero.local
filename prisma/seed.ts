/**
 * Seed script.
 *
 * This creates no demo/mock data. It bootstraps the two pieces of real
 * configuration a fresh deployment needs:
 *
 *   1. the plan catalogue (idempotent upsert by `code`);
 *   2. the first administrator account, from environment variables.
 *
 * Everything else is created by real users through the application.
 *
 * Usage: `npm run db:seed` (requires DATABASE_URL; SEED_ADMIN_* to create the
 * administrator).
 */
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  PLAN_CATALOG,
  ensurePlanCatalog,
} from "../src/server/billing/billing.rules";

const db = new PrismaClient();

async function main() {
  // Real product catalogue (idempotent).
  await ensurePlanCatalog(db);
  console.log(`[seed] Plan catalogue ready (${PLAN_CATALOG.length} plans).`);

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrator";

  if (!email || !password) {
    console.log(
      "[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping administrator bootstrap.",
    );
    return;
  }

  if (password.length < 8) {
    throw new Error("[seed] SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const rounds = Number.parseInt(process.env.PASSWORD_HASH_ROUNDS ?? "12", 10);
  const passwordHash = await bcrypt.hash(password, Number.isFinite(rounds) ? rounds : 12);

  const admin = await db.user.upsert({
    where: { email },
    update: { role: UserRole.ADMINISTRATOR, status: "ACTIVE" },
    create: {
      name,
      email,
      passwordHash,
      role: UserRole.ADMINISTRATOR,
      status: "ACTIVE",
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`[seed] Administrator ready: ${admin.email} (${admin.role})`);
}

main()
  .catch((error) => {
    console.error("[seed] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
