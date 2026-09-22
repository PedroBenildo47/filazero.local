#!/usr/bin/env bash
#
# Boots the production build of FilaZero, runs the HTTP API test suite against
# it, then shuts the server down.
#
# Requirements:
#   - DATABASE_URL pointing at a real PostgreSQL with migrations applied
#     (run `npm run db:migrate:deploy` first)
#   - AUTH_SECRET, APP_URL, ALLOWED_ORIGINS (see .env.example)
#
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
BASE_URL="http://127.0.0.1:${PORT}"

echo "==> Building the application"
npm run build

echo "==> Starting the server on ${BASE_URL}"
npx next start -p "${PORT}" &
SERVER_PID=$!
cleanup() { kill "${SERVER_PID}" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Waiting for the server to be ready"
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

echo "==> Running the HTTP API test suite"
API_BASE_URL="${BASE_URL}" npm run test:api
