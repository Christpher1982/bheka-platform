---
Document: ADR-002
Status: Locked
Owner: Engineering lead
Last reviewed: 2026-07-31
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# ADR-002: Vault Client Stub Approach

## Context

CANON section 2 and section 6 specify that Eride Vault is:
- A Rust service (not TypeScript)
- Exposed via gRPC over mTLS only
- Responsible for: DEK unwrap, tenant public key issuance, key rotation, and
  crypto-shred (the POPIA s14 retention mechanism)

GUIDE-02-Vault (the implementation guide for Eride Vault) was not available when
Phase 2 gateway-side work began. The kickoff brief prohibits inventing encryption
flows. This ADR records the decisions made in the absence of that guide.

## Decisions

### 1. VaultClient TypeScript interface is derived from CANON only

The `VaultClient` interface in `lib/vault-client` defines exactly four operations:
- `getTenantPublicKey` — agent needs this at enrolment to seal DEKs (CANON §2)
- `unwrapDek` — gateway needs this when a user views evidence (CANON §6, ADR-011)
- `rotateTenantKey` — per CANON §10 `bheka.key.rotated.v1`; triggered internally by Vault
- `shredTenantKey` — irreversible crypto-shred per CANON §6 and 009_API_SURFACE §3

No operations beyond these four are defined. Any additional Vault operations
required by GUIDE-02 must be added to this interface via a follow-up ADR.

### 2. VaultGrpcClient is a complete stub that fails loudly

The implementation class `VaultGrpcClient` reads three required environment
variables: `VAULT_ENDPOINT`, `VAULT_TLS_CERT_PATH`, `VAULT_TLS_KEY_PATH`,
`VAULT_TLS_CA_PATH`. If any is absent, every method throws `VaultNotDeployedError`
immediately. This is not a silent fallback — callers receive a typed error and
the request fails with HTTP 503.

When all four vars are present, the implementation will connect via gRPC/mTLS.
The actual method body is marked with a structured comment that the GUIDE-02
implementer must replace with real gRPC calls against `schemas/grpc/vault.proto`.

### 3. No mTLS client certificate generation in Phase 2

mTLS certificates for bheka-gateway ↔ Vault are provisioned out-of-band
(per CANON §2 "Runs in a separate cloud account"). Phase 2 only reads cert paths
from environment variables. Certificate issuance and rotation infrastructure is
deferred to Phase 5 (infrastructure).

### 4. Proto file is a spec artefact at schemas/grpc/vault.proto

Per CANON §14 (anti-drift rule), the authoritative gRPC contract lives at
`schemas/grpc/vault.proto`. Prose in this ADR and in comments does not restate
service or message definitions. The proto file is not loaded at runtime in Phase 2.

### 5. Key rotation is not a gateway API endpoint in v1

`009_API_SURFACE` section 3 lists `POST /tenants/{tenantId}/keys/{keyId}/shred`
explicitly but does not list a rotation endpoint. Per `010_EVENT_BUS_AND_TOPICS`
section 2, `bheka.key.rotated.v1` is produced exclusively by `eride-vault` itself
(not by bheka-gateway), implying rotation is Vault-internal or Vault-admin-only.
No rotation gateway endpoint is added. If GUIDE-02 specifies one, it must be
added via a follow-up, with a corresponding update to `009_API_SURFACE`.

## Consequences

- All Vault-dependent routes return 503 VaultNotDeployed until Eride Vault is
  deployed and `VAULT_ENDPOINT` et al. are configured.
- The crypto-shred route (`POST /tenants/:tenantId/keys/:keyId/shred`) is wired
  with full RBAC, step-up, and audit enforcement — the Vault call itself is the
  only missing piece.
- GUIDE-02, when available, must be reconciled against this ADR. Any contradiction
  is resolved in favour of GUIDE-02 with an update to this document.

## Superseded by

Nothing yet. GUIDE-02 will supersede sections 1 and 2 of this ADR.

## AI implementation constraints

- Do not add Vault operations not listed in Decision 1 without a new ADR.
- Do not add a gateway key-rotation endpoint without updating `009_API_SURFACE`.
- VaultGrpcClient must never return fake/stub data. Every method must either
  succeed via a real gRPC call or throw a typed VaultError.
