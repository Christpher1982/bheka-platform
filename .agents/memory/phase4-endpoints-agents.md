---
name: Phase 4 — Endpoints and Agents API
description: Durable lessons from implementing the Endpoint/Agent surface (009_API_SURFACE §6).
---

## Routes added in Phase 4

Fleet views (oidcBearer, no step-up):
- GET /v1/endpoints — cursor-paginated, withTenantContext
- GET /v1/endpoints/:endpointId
- GET /v1/agents/:agentId — withTenantContext

Agent-facing (special auth schemes):
- POST /v1/agents/enrol — enrolmentToken (single-use Redis key), audited, requires Vault
- POST /v1/agents/:agentId/heartbeat — agentMutualTLS (X-Agent-Cert-Fingerprint header), NOT audited

System-wide (no tenant context):
- GET /v1/agent-versions — agent_versions is not tenant-scoped
- POST /v1/agent-versions/:agentVersionId/advance-ring — audited, security_administrator

## requireAgentMTLS middleware pattern

Reads `X-Agent-Cert-Fingerprint` header (set by TLS-terminating proxy after mTLS handshake).
Looks up agent by fingerprint, attaches `req.agent` to the request.
This header MUST be stripped by the proxy before accepting from the internet — network invariant,
not enforceable in middleware.

## Single-use enrolment token pattern (Redis)

Token stored at `bheka:enrol_token:{token}` → JSON `{tenantId, ...}`.
Consumed atomically with `redis.getdel()` — single-use, no TOCTOU.
On enrolment: token hash (SHA-256) stored in agents.enrolment_token_hash for audit trail.
Raw token never persisted.

## Enrolment requires Vault — not a dev-time operation

POST /agents/enrol calls vaultClient.issueAgentCert() before writing any DB rows.
In dev (Vault not deployed): returns 503 vaultUnavailable.
Also calls vaultClient.getTenantPublicKey() before returning.
Both throw VaultNotDeployedError / VaultUnavailableError if VAULT_ENDPOINT is unset.
**Why:** ADR-002 — never issue self-signed stub certs or return fake public keys.

## req.params destructuring gives string | string[] in Express 5

Always use `const foo = req.params.foo as string` pattern, not destructuring `const { foo } = req.params`.
Destructuring gives `string | string[]` which is incompatible with Drizzle `eq()` overloads.
**How to apply:** Every route param extraction in Express route handlers must use `as string`.

## Ring progression for advance-ring

Defined as: canary → ring_0 → ring_1 → ring_2 → ring_3 (fully released).
Calling advance-ring when already at ring_3 returns 409 ringAlreadyFinal.
Logic in nextRing() helper, not inline, for testability.

## Vault client additions

IssueAgentCertRequest / IssueAgentCertResponse types added to lib/vault-client/src/types.ts.
IssueAgentCert RPC added to schemas/grpc/vault.proto.
issueAgentCert() stub added to VaultGrpcClient — throws VaultUnavailableError awaiting GUIDE-02.

## Event schemas added

bheka.agent.enrolled.v1.json — emitted by bheka-gateway on successful enrolment.
bheka.agent.heartbeat.v1.json — emitted on each heartbeat (not audited to audit_log).
Both NATS publish calls are TODO stubs awaiting bheka-nats client (010_EVENT_BUS_AND_TOPICS §2).
