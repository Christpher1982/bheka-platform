---
name: Phase 5 — Policies + Detections/Risk Scores API
description: Durable lessons from implementing 009_API_SURFACE §7 (Policies) and §8 (Detections/Risk Scores).
---

## Routes added in Phase 5

Policies (§7 — all writes audited, no step-up):
- GET /v1/policies — cursor-paginated, withTenantContext
- POST /v1/policies — requireRole(tenant_owner, security_administrator), audited
- GET /v1/policies/:policyId
- PATCH /v1/policies/:policyId — requireRole(tenant_owner, security_administrator), audited
- POST /v1/policies/:policyId/rules — requireRole(tenant_owner, security_administrator), audited

Detections/Risk Scores (§8 — no create via REST, one audited write):
- GET /v1/detections — cursor-paginated with optional filters (status, subjectUserId, tier)
- GET /v1/detections/:detectionId
- PATCH /v1/detections/:detectionId — triage state change, audited
- GET /v1/users/:userId/risk-scores — read-only, cursor-paginated

## Tier 3 dual-auth check is applied at both API and DB layers

POST /policies/:policyId/rules: if targetTier === 3 and requiresDualAuthorisation !== true,
returns 409 tierEscalationDenied (clearer message than a raw DB CHECK violation).
DB CHECK still exists as the structural backstop per 008_DATA_MODEL §4.
**How to apply:** Always add an explicit API check for the DB-level CHECK constraints that
have semantically meaningful error messages — surfacing them early gives better UX.

## Drizzle .set() cannot accept Record<string, unknown>

When building dynamic update objects for Drizzle .set(), spread fields explicitly
rather than casting a dynamic Record. TypeScript rejects the cast because
Record<string, unknown> doesn't overlap with Drizzle's typed update shape.
**How to apply:** Build typed spread objects like `{ status, ...triageFields }` — 
never `set(dynamicObj as Parameters<typeof tx.update>[0])`.

## detection.PATCH triage: set timestamp + actor fields by status transition

- status = "triaged" → set triagedAt + triagedBy
- status = "resolved" | "false_positive" → set resolvedAt + resolvedBy
- Detection rows have no deletedAt (they are never soft-deleted via the API)

## conditionJson is opaque to the gateway

policy_rules.conditionJson is stored as-is; bheka-policy evaluates it against
the rule DSL (schemas/policies/rule-dsl.schema.json). Gateway validates only
that it is a non-empty JSON object — never validate DSL structure at the API layer.

## Event schemas added in Phase 5

bheka.detection.raised.v1.json — DETECTION stream, bheka-policy producer.
bheka.risk.recalculated.v1.json — DETECTION stream, bheka-policy producer.
bheka.agent.update_ring_advanced.v1.json — AGENT stream, bheka-updater producer.
Note: bheka-gateway's advance-ring endpoint updates the DB; bheka-updater emits the event.
bheka-gateway does NOT emit bheka.agent.update_ring_advanced.v1.

## GET /v1/users/:userId/risk-scores tenant ownership check

Before paginating risk_scores, verify the userId belongs to the tenant (users table lookup).
Returns 404 if user not found or soft-deleted — does not leak cross-tenant user existence.
