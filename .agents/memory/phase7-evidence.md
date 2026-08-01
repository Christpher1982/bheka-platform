---
name: Phase 7 — Evidence API
description: Durable lessons from implementing 009_API_SURFACE §10 (Evidence list, view, export).
---

## Routes added in Phase 7

evidence.ts:
- GET /v1/cases/:caseId/evidence — metadata list, cursor-paginated; s3Bucket/s3Key/sealedDekB64 omitted
- GET /v1/evidence/:evidenceId — single metadata; same omissions
- POST /v1/evidence/:evidenceId/view — requireStepUp, audited; creates evidence_views row; calls vaultClient.unwrapDek; returns plaintextDekB64 + s3 location
- POST /v1/evidence/:evidenceId/export — requireStepUp, audited; vault liveness check; returns 202 { exportId, status: "processing", downloadUrl: null }

## Key design rules enforced

### Metadata never exposes storage/DEK fields
s3Bucket, s3Key, sealedDekB64 are intentionally omitted from both GET responses.
Only POST /view returns plaintextDekB64 (in-memory via TLS, never persisted).

### Crypto-shredded evidence: 410 Gone
Problems.cryptoShredded() returns HTTP 410.
Both view and export check evidence.cryptoShredded before calling vault.

### Access check tiers
- Tier 1/2: case participant row OR active evidenceAccessGrant satisfies access.
- Tier 3: ONLY an active non-expired non-revoked evidenceAccessGrant satisfies access.
**Why:** Tier 3 data is dual-auth gated; participant membership alone is insufficient.
**How to apply:** checkEvidenceAccess() helper in evidence.ts encodes this logic; any new evidence access path must use it.

### evidence_views is insert-only
The POST /view route inserts but never updates the evidence_views table.
This is enforced at DB layer (RLS) and at the route layer (no update calls).

### Export is async (202 Accepted)
POST /export returns { exportId, status: "processing", downloadUrl: null }.
bheka-notify delivers the signed URL by consuming bheka.evidence.exported.v1.
The gateway verifies vault is reachable before accepting the export (to avoid silent failures).

### Vault unavailability → 503
VaultNotDeployedError and VaultUnavailableError both map to Problems.vaultUnavailable().
In dev (vault not deployed), view and export always return 503. That is correct per ADR-002.

## New Problem types added in Phase 7

Problems.cryptoShredded() — HTTP 410, evidence permanently unrecoverable.
Problems.evidenceAccessDenied() — HTTP 403, no valid access grant.

## Event schemas added in Phase 7

bheka.evidence.sealed.v1.json — EVIDENCE stream, bheka-case producer; on evidence row creation.
bheka.evidence.viewed.v1.json — EVIDENCE stream, bheka-case producer; per view call.
bheka.evidence.exported.v1.json — EVIDENCE stream, bheka-case producer; on export initiation.
bheka.telemetry.batch.v1.json — TELEMETRY stream, bheka-ingest producer; carries ClickHouse row IDs only (no event content per tier-boundary rule).

## Remaining event schemas after Phase 7

Still needed: bheka.notice.issued.v1.json (Phase 8, NOTICE stream, bheka-case producer).
All other event schemas are now written (17 total; 16 done, 1 remaining).
