/**
 * Health check.
 *
 * Performs a real round trip to PostgreSQL. It is not a fake "ok" endpoint:
 * if the database is unreachable the endpoint returns 503.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      data: {
        status: "ok",
        database: "reachable",
        latencyMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Health check failed: database unreachable");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Database unreachable" } },
      { status: 503 },
    );
  }
}
