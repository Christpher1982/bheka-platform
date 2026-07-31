---
name: Phase 2 — Vault Stubs and Tenant Key Management
description: Durable lessons from building the gateway-side Vault client stubs and tenant API routes.
---

## VaultGrpcClient is a structured stub — 4 env vars gate it

`VaultGrpcClient` in `lib/vault-client` checks for `VAULT_ENDPOINT`, `VAULT_TLS_CERT_PATH`,
`VAULT_TLS_KEY_PATH`, `VAULT_TLS_CA_PATH` at construction. If any is absent, every method throws
`VaultNotDeployedError` immediately (HTTP 503). When all four are present, each method body has a
structured comment describing exactly what gRPC call to make.

**Why:** ADR-002 Decision 2 — never return fabricated data; fail loudly with a typed error.
**How to apply:** When GUIDE-02 arrives, replace the comment blocks in each method with real
@grpc/grpc-js calls against `schemas/grpc/vault.proto`.

## Key rotation is NOT a gateway API endpoint in v1

`009_API_SURFACE` lists only `POST /tenants/{tenantId}/keys/{keyId}/shred` for key operations.
`bheka.key.rotated.v1` is produced by `eride-vault` directly (per `010_EVENT_BUS_AND_TOPICS` section 2).
No gateway rotation endpoint was added. ADR-002 Decision 5 documents this.
**Why:** Adding endpoints not in the spec is prohibited by the kickoff brief.
**How to apply:** If rotation is later added to 009_API_SURFACE, add it to `routes/v1/tenants.ts`.

## lib/vault-client build order follows the same composite pattern as lib/db

Must run `tsc --build lib/vault-client/tsconfig.json` before typechecking `api-server`.
api-server tsconfig.json references both `lib/db` and `lib/vault-client` as composite projects.
**Why:** Same reason as lib/db — project references resolve from `dist/*.d.ts`.

## Event schema artefacts live in schemas/events/, gRPC proto in schemas/grpc/

Three new event schemas added: `bheka.key.rotated.v1.json`, `bheka.key.shredded.v1.json`,
`bheka.tenant.provisioned.v1.json`. gRPC contract at `schemas/grpc/vault.proto`.
Per CANON section 14: shapes are authoritative only in these files, never restated in prose.

## Required env vars added in Phase 2

None required at startup (Vault vars are checked lazily per-call). When deploying with a real Vault:
- `VAULT_ENDPOINT` — gRPC host:port for Eride Vault
- `VAULT_TLS_CERT_PATH` — path to gateway client PEM cert
- `VAULT_TLS_KEY_PATH` — path to gateway client private key PEM
- `VAULT_TLS_CA_PATH` — path to Vault CA cert PEM

## Shred route audit pattern: write intent BEFORE the irreversible Vault call

`POST /tenants/:tenantId/keys/:keyId/shred` writes `key.shred_requested` to audit_log before
calling `vaultClient.shredTenantKey(...)`. On success, writes `key.shredded` after.
If Vault fails, the intent audit record is still present.
**Why:** CANON section 9 — "writes to audit_log before returning" means the record of the attempt
must survive even if the operation fails.
