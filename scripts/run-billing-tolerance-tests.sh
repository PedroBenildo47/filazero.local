#!/usr/bin/env bash
#
# Proves the checkout tolerance rule over real HTTP: the QR and bank-transfer
# checkouts always answer 201 with a PENDING transaction — never 503 — for a
# blank, invalid or configured BILLING_BANK_IBAN.
#
# It boots the production build three times, each with a different IBAN, and
# runs the focused tolerance runner against it.
#
# Requirements:
#   - DATABASE_URL pointing at a real PostgreSQL with migrations applied
#   - AUTH_SECRET, APP_URL, ALLOWED_ORIGINS, PAYMENT_WEBHOOK_SECRET (see .env.example)
#
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3110}"
BASE_URL="http://127.0.0.1:${PORT}"

export RATE_LIMIT_REGISTER_MAX="${RATE_LIMIT_REGISTER_MAX:-1000}"

echo "==> Building the application"
npm run build

wait_ready() {
  node -e '
    const base = process.argv[1];
    const deadline = Date.now() + 60000;
    const poll = async () => {
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) process.exit(0);
      } catch {}
      if (Date.now() > deadline) {
        console.error("server did not become ready in time");
        process.exit(1);
      }
      setTimeout(poll, 500);
    };
    poll();
  ' "${BASE_URL}"
}

run_scenario() {
  local label="$1"
  local iban="$2"

  echo ""
  echo "=================================================================="
  echo "==> Scenario: ${label} (BILLING_BANK_IBAN='${iban}')"
  echo "=================================================================="

  BILLING_BANK_IBAN="${iban}" \
  BILLING_BANK_NAME="${BILLING_BANK_NAME:-Banco BIC Angola}" \
  BILLING_BANK_ACCOUNT="${BILLING_BANK_ACCOUNT:-22109917510001}" \
  BILLING_BANK_GUI="${BILLING_BANK_GUI:-BIC}" \
    npx next start -p "${PORT}" &
  local pid=$!
  # shellcheck disable=SC2064
  trap "kill ${pid} 2>/dev/null || true" RETURN

  wait_ready
  API_BASE_URL="${BASE_URL}" npx tsx tests/api/run-billing-tolerance.ts
  kill "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
  trap - RETURN
}

# 1. Blank: the real Banco BIC default is applied → QR is built.
run_scenario "blank IBAN (uses Banco BIC default)" ""

# 2. Invalid: no QR, degrades to transfer instructions — still 201 PENDING.
run_scenario "invalid IBAN (degrades to transfer)" "AO00INVALID"

# 3. Configured: the real 21-digit BBAN is promoted to its canonical IBAN.
run_scenario "configured real BIC account" "005100002109917510176"

echo ""
echo "==> Checkout tolerance suite passed for all scenarios."
