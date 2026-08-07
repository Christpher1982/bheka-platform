#!/usr/bin/env bash
# start_bheka.sh — bring up the full Bheka stack locally after a reboot.
# Usage: bash ~/start_bheka.sh
set -e

cd ~/bheka-platform

echo "=== 1. Check Docker is reachable ==="
if ! docker ps >/dev/null 2>&1; then
  echo "Docker isn't responding. Make sure Docker Desktop is open on Windows and fully started, then re-run this script."
  exit 1
fi

echo "=== 2. Start Postgres + Redis containers ==="
# Containers already exist from first-time setup — just start them if stopped.
docker start bheka-postgres bheka-redis 2>/dev/null || {
  echo "Containers not found, creating them fresh..."
  docker run -d --name bheka-postgres -e POSTGRES_USER=bheka -e POSTGRES_PASSWORD=bheka -e POSTGRES_DB=bheka -p 5432:5432 postgres:16
  docker run -d --name bheka-redis -p 6379:6379 redis:7
}
sleep 5
docker ps --filter "name=bheka-postgres" --filter "name=bheka-redis"

echo ""
echo "=== 3. Kill any leftover API/console processes on our ports ==="
fuser -k 8081/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 1

echo ""
echo "=== 4. Start API server (background, port 8081) ==="
export DATABASE_URL="postgres://bheka:bheka@localhost:5432/bheka"
export REDIS_URL="redis://localhost:6379"
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# Shared secret the mobile/desktop agents present in the X-Agent-Token header on
# POST /api/v1/agent/events. This is optional in the server's config schema (the
# gateway still boots without it), but the ingest endpoint rejects EVERY request
# with 401 while it is unset — that was the real cause of persistent upload 401s,
# unrelated to whatever token value the agent app itself has configured. Must
# match the token baked into the iOS/Android agent's fallback config and QR
# payload exactly.
export AGENT_INGEST_TOKEN="4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac"

nohup env DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" PORT=8081 \
  SESSION_SECRET="$SESSION_SECRET" \
  AGENT_INGEST_TOKEN="$AGENT_INGEST_TOKEN" \
  WEBAUTHN_RP_ID=localhost WEBAUTHN_RP_ORIGIN="http://localhost:8081" \
  ALLOWED_ORIGINS="http://localhost:5173" NODE_ENV=development \
  pnpm --filter @workspace/api-server run start > /tmp/api.log 2>&1 &
sleep 8
echo "--- api.log (last 15 lines) ---"
tail -n 15 /tmp/api.log

echo ""
echo "=== 5. Start console (background, port 5173) ==="
(cd artifacts/console && nohup env PORT=5173 BASE_PATH="/" pnpm run dev > /tmp/console.log 2>&1 &)
sleep 6
echo "--- console.log (last 15 lines) ---"
tail -n 15 /tmp/console.log

echo ""
echo "=== 6. Health check ==="
curl -s http://localhost:8081/api/v1/healthz || echo "API not responding yet — check /tmp/api.log"

echo ""
echo "=== DONE ==="
echo "Console:  http://localhost:5173"
echo "API:      http://localhost:8081/api/v1/healthz"
echo "Login:    admin@eride-technologies.test (dev-login, no password)"
