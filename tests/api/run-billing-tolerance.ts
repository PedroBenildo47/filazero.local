/**
 * Focused HTTP runner for the checkout-tolerance suite.
 *
 * Used by `scripts/run-billing-tolerance-tests.sh`, which boots the production
 * server several times with different `BILLING_BANK_IBAN` values (blank, invalid,
 * configured) and runs this runner against each — proving the QR/transfer
 * checkout always answers 201 PENDING and never 503.
 *
 *   API_BASE_URL=http://127.0.0.1:3100 npx tsx tests/api/run-billing-tolerance.ts
 */
import type { ApiResult } from "./client";
import { runBillingToleranceSuite } from "./billing-tolerance.spec";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3100";

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

function expectCode(name: string, result: ApiResult<unknown>, status: number, code: string) {
  ok(
    name,
    result.status === status && result.error?.code === code,
    `HTTP ${result.status} / ${result.error?.code ?? "sem código"}`,
  );
}

async function main() {
  const scenario = (process.env.BILLING_BANK_IBAN ?? "").trim() === ""
    ? "blank-iban"
    : process.env.BILLING_BANK_IBAN;
  console.log(`\n=== FILAZERO CHECKOUT TOLERANCE (${BASE_URL}) — BILLING_BANK_IBAN=${scenario} ===\n`);

  const reporter = { check: ok, equal: eq, errorCode: expectCode };
  await runBillingToleranceSuite({ baseUrl: BASE_URL, reporter });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("Failed:");
    for (const name of failures) console.log(`  - ${name}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("fatal:", error);
  process.exit(1);
});
