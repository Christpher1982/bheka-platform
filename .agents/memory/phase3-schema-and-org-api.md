---
name: Phase 3 — Remaining Schema + Sites/Users/Roles API
description: Durable lessons from completing the 27-table schema and building organizational management routes.
---

## All 27 canonical tables are now in PostgreSQL

Phase 3 added 19 tables across 8 new schema files in lib/db/src/schema/:
- endpoints.ts → agent_versions, endpoints, agents
- policies.ts → policies, policy_rules
- detections.ts → detections, risk_scores
- cases.ts → cases, case_participants, approvals
- evidence.ts → evidence, evidence_access_grants, evidence_views
- transparency.ts → transparency_notices, data_subject_requests, consent_records
- retention.ts → retention_schedules
- integrations.ts → integrations, webhooks

## key structural constraints baked into schema (not just application logic)

- `endpoints`: CHECK `is_corporate_owned = true` — BYOD refusal is structural (CANON §5, refusal 4)
- `policy_rules`: CHECK `target_tier != 3 OR requires_dual_authorisation = true` — Tier 3 dual-auth is structural
- `approvals`: CHECK `approver_user_id != requested_by_user_id` — no self-approval at DB layer
- `retention_schedules`: CHECK `retention_days > 0`
- `webhooks`: CHECK `url LIKE 'https://%'`
- `evidence`: no updated_at (sealed once, immutable) — no deletedAt
- `evidence_views`: insert-only (documented in schema, enforced via RLS policies SQL)
- `risk_scores`: no updated_at (append-only, each row is a scored moment in time)

## detections.ts requires sql import from drizzle-orm (not drizzle-orm/pg-core)

Using `sql` in a column default (e.g. `default(sql`ARRAY[]::text[]`)`) requires
`import { sql } from "drizzle-orm"` — not from `drizzle-orm/pg-core`.
Missed this on first pass; caused a build error.
**Why:** `sql` template tag is from the core drizzle-orm package; pg-core has column types only.
**How to apply:** Any schema file using sql`` in defaults or check constraints needs both imports.

## agent_versions is NOT tenant-scoped

`agent_versions` is a system-wide table (no tenant_id). It's shared across all tenants.
Agents reference it via agent_version_id.
**Why:** Agent binaries are shared artifacts; per-tenant versioning would create an impractical matrix.

## Information Officer singleton constraint surfaces as "information_officer_singleton" in error message

The DB trigger from rls-policies.sql raises an error containing "information_officer_singleton"
when a second IO assignment is attempted. The POST /users/:userId/role-assignments route catches
this string and returns a 409 Problem (rather than a 500).
**How to apply:** Any future route inserting role_assignments must handle this error string.

## Routes added in Phase 3

Sites (009_API_SURFACE §4):
- GET /v1/sites (cursor-paginated)
- POST /v1/sites (audited, tenant_owner or security_administrator)
- GET /v1/sites/:siteId
- PATCH /v1/sites/:siteId (audited)

Users/Roles (009_API_SURFACE §5):
- GET /v1/roles (system-wide, no RLS context)
- GET /v1/users (cursor-paginated)
- POST /v1/users (audited, tenant_owner or security_administrator)
- GET /v1/users/:userId
- POST /v1/users/:userId/reidentify (audited + step-up, popia_information_officer role)
- GET /v1/users/:userId/role-assignments
- POST /v1/users/:userId/role-assignments (audited, idempotent upsert on conflict)
