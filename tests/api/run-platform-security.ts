import { db } from "@/lib/db";
import { runPlatformSecuritySuite } from "./platform-security.spec";
import type { Reporter } from "./support";
import type { ApiResult } from "./client";

let failures = 0;
const reporter: Reporter = {
  check(name, condition, detail = "") {
    console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
    if (!condition) failures += 1;
  },
  equal(name, actual, expected) {
    const condition = actual === expected;
    console.log(`${condition ? "PASS" : "FAIL"} ${name}: ${String(actual)} (expected ${String(expected)})`);
    if (!condition) failures += 1;
  },
  errorCode(name, result: ApiResult<unknown>, status, code) {
    const condition = result.status === status && result.error?.code === code;
    console.log(`${condition ? "PASS" : "FAIL"} ${name}: HTTP ${result.status} / ${result.error?.code ?? "none"}`);
    if (!condition) failures += 1;
  },
};

async function main() {
  try {
    await runPlatformSecuritySuite({
      baseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:3001",
      reporter,
    });
  } finally {
    await db.$disconnect();
  }
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
