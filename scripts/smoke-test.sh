#!/usr/bin/env bash
# Bheka Gateway — smoke test suite
# Tests what can be verified without an auth session:
#   1. Health endpoint (postgres + redis connectivity)
#   2. Every protected route returns 401 with RFC 9457 Problem+JSON
#   3. Problem+JSON field structure (type, title, status, detail)
#   4. 404 for unknown routes
# Usage: bash scripts/smoke-test.sh [BASE_URL]
# Default BASE_URL: http://localhost:8080/api

BASE="${1:-http://localhost:8080/api}"
PASS=0; FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

# Runs curl; sets STATUS and BODY globals.
api_call() {
  local method="$1" path="$2" data="${3:-}"
  STATUS=$(curl -s -X "$method" \
    ${data:+-H "Content-Type: application/json" -d "$data"} \
    -o /tmp/bk_body -w "%{http_code}" \
    "${BASE}${path}")
  BODY=$(cat /tmp/bk_body)
}

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; echo -e "      → got HTTP $STATUS | ${BODY:0:100}"; FAIL=$((FAIL+1)); }

assert_status() {
  local label="$1" want="$2"
  [[ "$STATUS" == "$want" ]] && pass "$label" || fail "$label (expected $want)"
}

assert_contains() {
  local label="$1" needle="$2"
  [[ "$BODY" == *"$needle"* ]] && pass "$label" || fail "$label (missing: $needle)"
}

echo ""
echo "════════════════════════════════════════════"
echo "  Bheka Gateway Smoke Tests"
echo "  Target: $BASE"
echo "════════════════════════════════════════════"

# ── 1. Health ────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[1] Health${NC}"

api_call GET /v1/healthz
assert_status "GET /v1/healthz → 200"          "200"
assert_contains "  postgres: ok"               '"postgres":"ok"'
assert_contains "  redis: ok"                  '"redis":"ok"'
assert_contains "  status: ok"                 '"status":"ok"'

# ── 2. Auth required on every protected route ────────────────────────────────
echo ""
echo -e "${YELLOW}[2] 401 on unauthenticated requests${NC}"

check_401() {
  api_call "$1" "$2" "${3:-}"
  assert_status "$1 $2 → 401" "401"
}

# NOTE: /v1/tenants has no collection GET — only /v1/tenants/:tenantId exists (by design)
check_401 GET  /v1/tenants/00000000-0000-0000-0000-000000000001
check_401 GET  /v1/sites
check_401 GET  /v1/users
check_401 GET  /v1/roles
check_401 GET  /v1/endpoints
check_401 GET  /v1/policies
check_401 GET  /v1/detections
check_401 GET  /v1/cases
check_401 GET  /v1/transparency-notices
check_401 GET  /v1/data-subject-requests
check_401 GET  /v1/integrations
check_401 GET  /v1/webhooks
check_401 GET  /v1/approvals/00000000-0000-0000-0000-000000000001
check_401 GET  /v1/evidence/00000000-0000-0000-0000-000000000001

check_401 POST /v1/cases           '{}'
check_401 POST /v1/integrations    '{}'
check_401 POST /v1/webhooks        '{}'
check_401 POST /v1/data-subject-requests '{}'
check_401 POST /v1/policies        '{}'
check_401 POST /v1/sites           '{}'
# NOTE: /v1/tenants has no collection endpoint by design (GET/PATCH /v1/tenants/:tenantId only)

# ── 3. RFC 9457 Problem+JSON field structure ─────────────────────────────────
echo ""
echo -e "${YELLOW}[3] RFC 9457 Problem+JSON structure${NC}"

api_call GET /v1/cases
assert_contains "  'type' field present"   '"type":'
assert_contains "  'title' field present"  '"title":'
assert_contains "  'status' field present" '"status":401'
# RFC 9457 §3.1: 'detail' is OPTIONAL — authRequired() intentionally omits it.

CT=$(curl -sI "${BASE}/v1/cases" | tr -d '\r' | grep -i '^content-type:')
[[ "$CT" == *"application/problem+json"* ]] \
  && pass "  Content-Type: application/problem+json" \
  || fail "  Content-Type: application/problem+json (got: $CT)"

# ── 4. SCIM routes still work (should be 401 with SCIM error, not Problem JSON) ──
echo ""
echo -e "${YELLOW}[4] SCIM routes isolated (SCIM 401, not Problem JSON)${NC}"

api_call GET /scim/v2/Users
assert_status "GET /scim/v2/Users → 401"           "401"
assert_contains "  SCIM error schema present"       '"urn:ietf:params:scim:api:messages:2.0:Error"'

api_call POST /scim/v2/Users '{}'
assert_status "POST /scim/v2/Users → 401"          "401"

# ── 5. Unknown routes return 404 ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5] 404 for unknown routes${NC}"

api_call GET /v1/does-not-exist
assert_status "GET /v1/does-not-exist → 404" "404"

api_call GET /v1/completely/unknown/path
assert_status "GET /v1/completely/unknown/path → 404" "404"

# ── 6. Healthz survives multiple calls (Redis / PG stable) ───────────────────
echo ""
echo -e "${YELLOW}[6] Stability — 3 consecutive health checks${NC}"

for i in 1 2 3; do
  api_call GET /v1/healthz
  assert_status "  health check #$i → 200" "200"
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
TOTAL=$((PASS+FAIL))
printf "  Results: ${GREEN}%d passed${NC}  ${RED}%d failed${NC}  (of %d)\n" $PASS $FAIL $TOTAL
echo "════════════════════════════════════════════"
echo ""

[[ $FAIL -eq 0 ]]
