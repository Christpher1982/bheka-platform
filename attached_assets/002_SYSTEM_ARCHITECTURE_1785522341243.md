---
Document: 002_SYSTEM_ARCHITECTURE
Version: 1.0
Status: Locked
Owner: Engineering lead
Last reviewed: 2026-07-31
Depends on: none
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

## 1. Purpose and scope

This document is the C4 context and container view of Bheka: the nine services of
CANON section 3, their trust boundaries, and which interactions are synchronous
(request/response) versus asynchronous (event bus). It does not restate database
columns or API request/response shapes; those live in `schemas/database/*.sql`
and `schemas/api/openapi.yaml` respectively (CANON section 14).

## 2. C4 level 1 — system context

Bheka sits between three human actor groups (tenant admins/security leads,
monitored employees, and Eride operations staff) and a small set of external
systems: the customer's identity provider, HRIS, SIEM, ticketing system,
WhatsApp Business API, and — only for custody Tier B/C tenants — the customer's
own KMS or self-hosted Vault.

```mermaid
C4Context
  title Bheka — System Context

  Person(admin, "Security lead / Information Officer", "Configures policy, investigates cases, approves Tier 3")
  Person(employee, "Monitored employee", "Corporate endpoint user, transparency portal user")
  Person(eride_ops, "Eride operations staff", "Support, break-glass, agent release management")

  System(bheka, "Bheka platform", "Insider risk monitoring, POPIA compliance, workforce analytics")

  System_Ext(idp, "Customer IdP", "Entra ID / Okta / Google Workspace, OIDC/SAML/SCIM")
  System_Ext(hris, "Customer HRIS", "Sage, SimplePay, PaySpace, BambooHR")
  System_Ext(siem, "Customer SIEM", "Sentinel, Splunk, QRadar, Elastic, syslog CEF")
  System_Ext(whatsapp, "WhatsApp Business API", "Admin/on-call alerting, CANON section 16")
  System_Ext(customer_kms, "Customer KMS / self-hosted Vault", "Custody tier B/C only, CANON section 6")
  System_Ext(regulator, "Information Regulator eServices", "POPIA s22 breach notification target format")

  Rel(admin, bheka, "Configures policy, investigates, approves", "HTTPS/OIDC + WebAuthn")
  Rel(employee, bheka, "Views transparency portal, receives notices", "HTTPS + WhatsApp/email")
  Rel(eride_ops, bheka, "Support and release operations", "HTTPS/OIDC, break-glass logged")
  Rel(bheka, idp, "SSO, SCIM provisioning", "OIDC/SAML, SCIM")
  Rel(bheka, hris, "Joiner-mover-leaver sync", "REST, v2")
  Rel(bheka, siem, "Security event export", "syslog CEF / HEC")
  Rel(bheka, whatsapp, "Alert delivery", "WhatsApp Business API")
  Rel(bheka, customer_kms, "Envelope key operations only, never bulk payload", "gRPC/mTLS or customer-hosted equivalent")
  Rel(bheka, regulator, "Breach notification drafts (human-submitted, not auto-filed)", "n.a. — manual submission")
```

## 3. C4 level 2 — container view

All nine services from CANON section 3 are shown below with their primary
datastore and their sync (solid) vs async (dashed, via NATS JetStream)
relationships.

```mermaid
C4Container
  title Bheka — Container View

  Person(admin, "Security lead / IO")
  Person(employee, "Monitored employee")

  System_Boundary(bheka_platform, "Bheka platform (Eride cloud account)") {
    Container(agent, "bheka-agent", "Rust", "Endpoint collector: ETW (Windows), eBPF/CO-RE (Linux), Network Extension/ESF (macOS)")
    Container(gateway, "bheka-gateway", "TypeScript/Fastify", "Public REST API, OIDC auth, rate limiting, WebAuthn step-up")
    Container(ingest, "bheka-ingest", "TypeScript/Fastify", "Agent telemetry intake, envelope decrypt routing, ClickHouse writer")
    Container(policy, "bheka-policy", "TypeScript", "Detection rules, risk scoring, tier escalation decisioning")
    Container(case, "bheka-case", "TypeScript", "Investigations, approvals, evidence lifecycle")
    Container(notify, "bheka-notify", "TypeScript", "Transparency notices, admin alerts, WhatsApp/email, webhook fan-out")
    Container(console, "bheka-console", "TypeScript/Next.js 15", "Web UI, Server Components for reads only")
    Container(updater, "bheka-updater", "Rust", "Agent update orchestration, N-1/N-2 ring rollout")

    ContainerDb(pg, "PostgreSQL 16", "Tenant metadata, RBAC, cases, policy, audit_log")
    ContainerDb(ch, "ClickHouse 24.x", "High-volume endpoint telemetry (events_*)")
    ContainerDb(redis, "Redis 7 / Valkey", "Cache, rate limits, short-lived tokens")
    ContainerQueue(nats, "NATS JetStream", "bheka.* event bus, at-least-once, replayable")
    ContainerDb(s3, "S3 (af-south-1)", "Sealed evidence, Object Lock COMPLIANCE mode")
  }

  System_Boundary(vault_boundary, "Eride Vault (separate cloud account/subscription)") {
    Container(vault, "eride-vault", "Rust/gRPC over mTLS", "Key custody, envelope DEK unwrap, policy enforcement point, audit sealing")
    ContainerDb(kms, "AWS KMS / Azure Key Vault", "Per-tenant root keys, no shared master")
  }

  Rel(agent, ingest, "Encrypted telemetry batches", "mTLS + per-agent cert, HTTPS, sync")
  Rel(agent, updater, "Update manifest poll, artifact download", "HTTPS, sync")
  Rel(admin, console, "Console UI", "HTTPS/OIDC")
  Rel(employee, console, "Transparency portal", "HTTPS/OIDC")
  Rel(console, gateway, "All privileged operations (no Server Actions)", "HTTPS/OIDC, sync")
  Rel(gateway, pg, "Tenant/RBAC/case reads and writes", "SQL, sync")
  Rel(gateway, redis, "Rate limiting, session cache", "sync")
  Rel(ingest, ch, "Typed event writes", "SQL, sync")
  Rel(ingest, nats, "Publishes bheka.telemetry.batch.v1, bheka.agent.heartbeat.v1", "async, at-least-once")
  Rel(policy, nats, "Subscribes telemetry/heartbeat; publishes detection.raised, risk.recalculated", "async")
  Rel(policy, pg, "policy_rules, detections, risk_scores", "SQL, sync")
  Rel(policy, ch, "Rule evaluation queries", "SQL, sync")
  Rel(case, nats, "Subscribes detection.raised, approval.granted; publishes case.*, evidence.*", "async")
  Rel(case, pg, "cases, approvals, evidence*", "SQL, sync")
  Rel(case, s3, "Evidence payload read/write (ciphertext only)", "sync")
  Rel(case, vault, "DEK wrap/unwrap requests only, never bulk payload", "gRPC/mTLS, sync")
  Rel(notify, nats, "Subscribes case.*, approval.*, evidence.*, notice.issued", "async")
  Rel(notify, pg, "transparency_notices, webhooks, audit_log reads", "SQL, sync")
  Rel(updater, pg, "agent_versions", "SQL, sync")
  Rel(updater, nats, "Publishes agent.update_ring_advanced.v1", "async")
  Rel(vault, kms, "Wrapped key material operations", "provider SDK, sync")
  Rel(gateway, vault, "Tenant provisioning key generation, key rotation/shred requests", "gRPC/mTLS, sync")
  Rel_Back(vault, nats, "Publishes key.rotated.v1, key.shredded.v1 (internal-only topics)", "async")
```

## 4. Sync vs async boundaries

| Interaction | Mode | Rationale |
|---|---|---|
| Console → bheka-gateway | Sync HTTPS | Server Actions are prohibited for privileged operations (CANON section 2); every write must be an auditable REST call. |
| Agent → bheka-ingest | Sync HTTPS over mTLS | Agent needs a delivery acknowledgement to clear its local SQLite/SQLCipher buffer; store-and-forward semantics live in the agent, not the transport. |
| bheka-ingest → ClickHouse | Sync | Write path needs to know success/failure before acking the agent batch. |
| bheka-ingest → NATS JetStream | Async, fire-and-forget from the ingest request path | Downstream rule evaluation and notification must never block telemetry acknowledgement to the agent, especially on a degraded link (CANON section 16). |
| bheka-policy → NATS JetStream (publish) | Async | Detection and risk-score consumers (bheka-case, bheka-notify, bheka-console) are decoupled from the rule engine's execution time. |
| bheka-case ↔ eride-vault | Sync gRPC/mTLS | Key unwrap is on the critical path of an evidence view; the Vault has a hard round-trip SLO and never handles bulk payload (ADR-011), so the call is small and fast enough to stay synchronous. |
| bheka-case → S3 | Sync | Evidence read/write correctness (Object Lock retention, hash-chain verification) must be confirmed before returning to the caller. |
| bheka-notify → WhatsApp/email/webhooks | Async, consumed off NATS JetStream | Notification delivery to third parties (WhatsApp Business API, customer email, customer webhook endpoints) has unpredictable latency and must not block the domain event producers. |
| bheka-updater ↔ bheka-agent | Sync HTTPS poll | Agents pull the update manifest on their own schedule (ring-aware); there is no server-push channel to endpoints, consistent with "no remote control of an employee machine" (CANON section 5). |

## 5. Trust boundaries

```mermaid
flowchart TB
    subgraph TB1["Trust boundary 1: Employee endpoint (untrusted network, trusted-but-unprivileged agent)"]
        AGENT["bheka-agent\n(holds tenant PUBLIC key only)"]
    end

    subgraph TB2["Trust boundary 2: Eride platform cloud account"]
        GW[bheka-gateway]
        ING[bheka-ingest]
        POL[bheka-policy]
        CASE[bheka-case]
        NOT[bheka-notify]
        CON[bheka-console]
        UPD[bheka-updater]
        PG[(PostgreSQL 16\nRLS per tenant)]
        CH[(ClickHouse\nrow policy per tenant)]
        NATS[[NATS JetStream]]
        S3[(S3 ciphertext only)]
    end

    subgraph TB3["Trust boundary 3: Eride Vault — separate cloud account/subscription"]
        VAULT["eride-vault\n(holds PRIVATE keys, gRPC/mTLS only)"]
        KMS[(AWS KMS / Azure Key Vault)]
    end

    subgraph TB4["Trust boundary 4: Customer-controlled (Tier B/C custody only)"]
        CKMS[(Customer KMS / self-hosted Vault)]
    end

    AGENT -- "mTLS, encrypted envelope\n(agent can never decrypt)" --> ING
    ING -- SQL --> CH
    ING -. "async publish" .-> NATS
    POL -- SQL --> PG
    POL -- SQL --> CH
    NATS -. subscribe/publish .-> POL
    NATS -. subscribe/publish .-> CASE
    NATS -. subscribe/publish .-> NOT
    NATS -. subscribe/publish .-> UPD
    CASE -- SQL --> PG
    CASE -- "ciphertext read/write" --> S3
    CASE == "gRPC/mTLS: DEK unwrap only,\nnever bulk payload" ==> VAULT
    GW == "gRPC/mTLS: provisioning,\nrotation, shred" ==> VAULT
    VAULT -- provider SDK --> KMS
    VAULT -. "Tier B/C only" .-> CKMS
    CON -- HTTPS/OIDC --> GW
    GW -- SQL --> PG

    style TB1 fill:#fff3e0,stroke:#e65100
    style TB2 fill:#e3f2fd,stroke:#0d47a1
    style TB3 fill:#fce4ec,stroke:#880e4f
    style TB4 fill:#f1f8e9,stroke:#33691e
```

Boundary-crossing rules that the architecture enforces structurally, not just
by convention:

1. **TB1 → TB2**: the agent physically cannot decrypt its own uploads (CANON
   section 2), so a full compromise of TB2's ingest path still cannot expose
   plaintext telemetry beyond what that ingest path is already processing in
   memory. See `docs/003_THREAT_MODEL.md` T-ENDPOINT-01.
2. **TB2 → TB3**: only `bheka-case` and `bheka-gateway` may call `eride-vault`,
   over gRPC/mTLS, and the Vault is never reachable from the public internet
   (CANON section 2). The Vault accepts DEK-unwrap requests only — routing a
   400 MB screen recording through it is prohibited by ADR-011 and is enforced
   by a hard request-size ceiling at the Vault's gRPC layer.
3. **TB3 → TB4**: exists only for custody Tier B (customer-managed CMK) and
   Tier C (customer-hosted Vault) tenants (CANON section 6). For Tier A
   tenants, TB4 does not exist; TB3 is the terminus.
4. Every cross-boundary call in TB2/TB3 writes to `audit_log` before returning
   for privileged operations (CANON section 9); see
   `schemas/database/090_audit_log.sql`.

## 6. Service inventory cross-reference

See CANON section 3 for the canonical table (service, language, purpose). This
document does not repeat it; refer to `../../CANON.md` directly.

## 7. Data residency

Primary object storage and databases run in AWS `af-south-1` (Cape Town) for
all tenants by default (CANON section 2). Government/DPSA-bound tenants are
contractually and technically pinned to `af-south-1`; see
`schemas/database/010_tenants.sql` column `tenants.data_residency_region`.
Eride Vault (TB3) runs in a separate cloud account/subscription from the rest
of the platform, also in `af-south-1` for Tier A, or inside the customer's own
account/estate for Tier B/C.

## AI implementation constraints

- Do not introduce a tenth service or rename any of the nine services in CANON
  section 3. If a new capability is needed, place it inside an existing
  service's boundary and justify the placement in an ADR.
- Do not route bulk evidence payloads through `eride-vault`. Any code path that
  sends more than a DEK-sized payload (target: under 4 KiB) to the Vault's gRPC
  interface is a defect against ADR-011.
- Do not add a synchronous call from `bheka-ingest`'s agent-facing write path
  to `bheka-policy`, `bheka-case`, or `bheka-notify`. All fan-out from ingest is
  via NATS JetStream publish only.
- Console (`bheka-console`) Server Components may perform reads directly
  against `bheka-gateway`'s read endpoints; Server Actions must not perform
  writes. All writes go through the versioned REST API.

## Required inputs

- CANON.md (this repository), section 3 service inventory, section 2 stack.
- Confirmed AWS account/subscription boundary between the main platform and
  Eride Vault before Terraform is written.

## Expected outputs

- This document, kept in sync with `schemas/database/*.sql`,
  `schemas/api/openapi.yaml` and `schemas/events/*.json` whenever a service
  boundary or data flow changes.
- Terraform modules that provision two distinct cloud accounts/subscriptions
  matching trust boundaries TB2 and TB3.

## Dependencies

- None (this is a level-0 architecture document; other docs depend on it).

## Acceptance criteria

- Given a new engineer reading only CANON.md and this document, when they are
  asked to name the nine services and state which trust boundary each runs in,
  then they can do so without consulting any other document.
- Given the Mermaid diagrams in this file, when rendered on GitHub, then they
  render without syntax errors.
- Given any proposed architecture change, when it would move a service across
  a trust boundary or change a sync/async boundary, then it requires an ADR
  before implementation.

## Test checklist

- [ ] Both C4 diagrams render without Mermaid syntax errors on GitHub.
- [ ] The trust boundary diagram renders without Mermaid syntax errors on GitHub.
- [ ] All nine CANON section 3 services appear exactly once across the two C4 diagrams.
- [ ] No sync call is documented from bheka-ingest into bheka-policy, bheka-case, or bheka-notify.
- [ ] eride-vault has no inbound relationship originating from bheka-console, bheka-notify, bheka-ingest, bheka-policy, or bheka-updater.
- [ ] Every table name mentioned in this document exists in schemas/database/*.sql.
