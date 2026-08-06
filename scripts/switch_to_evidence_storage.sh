#!/usr/bin/env bash
set -e
REPO_DIR="/home/eride_technologies/bheka-platform"
cd "$REPO_DIR"

echo "== Ensuring Postgres and Redis containers are up =="
docker start bheka-postgres bheka-redis 2>/dev/null || true
sleep 2

echo "== Stopping any running API server / console =="
fuser -k 8081/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 1

echo "== Switching to feature/evidence-storage =="
git fetch origin
git checkout feature/evidence-storage
git pull origin feature/evidence-storage

echo "== Installing dependencies =="
pnpm install

echo "== Fixing console proxy target to point at port 8081 =="
sed -i "s|target: 'http://localhost:8080'|target: 'http://localhost:8081'|g" "$REPO_DIR/artifacts/console/vite.config.ts"

echo "== Applying evidence_images table to the bheka database =="
PGPASSWORD=bheka psql -h localhost -U bheka -d bheka <<'SQL'
ALTER TYPE agent_platform ADD VALUE IF NOT EXISTS 'android';
ALTER TYPE agent_platform ADD VALUE IF NOT EXISTS 'ios';
CREATE TABLE IF NOT EXISTS evidence_images (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  subject_user_id uuid NOT NULL REFERENCES users(id),
  source_agent_id uuid NOT NULL REFERENCES agents(id),
  source_event_id uuid REFERENCES activity_events(id) ON DELETE SET NULL,
  session_id text,
  content_type text NOT NULL DEFAULT 'image/jpeg',
  width integer,
  height integer,
  ocr_text text,
  storage_key text NOT NULL,
  iv_base64 text NOT NULL,
  auth_tag_base64 text NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  content_hash_sha256 text NOT NULL,
  byte_size integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
SQL

echo "== Starting API server on port 8081 =="
cd "$REPO_DIR"
export DATABASE_URL="postgres://bheka:bheka@localhost:5432/bheka"
export REDIS_URL="redis://localhost:6379"
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export AGENT_INGEST_TOKEN="4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac"
nohup env DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" PORT=8081 \
  SESSION_SECRET="$SESSION_SECRET" AGENT_INGEST_TOKEN="$AGENT_INGEST_TOKEN" \
  WEBAUTHN_RP_ID=localhost WEBAUTHN_RP_ORIGIN="http://localhost:8081" \
  ALLOWED_ORIGINS="http://localhost:5173" NODE_ENV=development \
  pnpm --filter @workspace/api-server run start > /tmp/api.log 2>&1 &

echo "== Waiting for API server health check =="
for i in $(seq 1 30); do
  if curl -s http://localhost:8081/api/v1/healthz 2>/dev/null | grep -q '"status":"ok"'; then
    echo "API server is healthy."
    break
  fi
  sleep 1
done

echo "== Starting console on port 5173 =="
cd "$REPO_DIR/artifacts/console"
nohup env PORT=5173 BASE_PATH="/" pnpm run dev > /tmp/console.log 2>&1 &

sleep 5
echo ""
echo "Done. Open http://localhost:5173 in your browser and log in."
echo "Look for Evidence in the left nav."
echo "Logs: tail -f /tmp/api.log   or   tail -f /tmp/console.log"
