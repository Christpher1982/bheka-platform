---
Document: 015_TENANCY_AND_ISOLATION
Version: 1.0
Status: Locked
Owner: Head of Platform Engineering
Last reviewed: 2026-07-31
Depends on: 004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md, 007_RBAC_AND_IDENTITY.md
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

## 0. Purpose

Bheka is a multi-tenant system holding some of the most sensitive data an employer can
have about its people, sold in part to banks and insurers (Tier B customers,
`004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 1) who will ask, specifically, "what stops
another one of your customers, or a bug affecting another customer, from reaching my
data or my capacity?" This document answers that question at three levels: data isolation
(row level security and per-tenant keys), resource isolation (the noisy-neighbour
problem), and deployment isolation (the on-prem single-tenant option). It also defines how
tenant isolation is actually tested, because an isolation claim that has never been
adversarially tested is a hope, not a control.

## 1. Row Level Security enforcement

Per `CANON.md` section 8, every tenant-scoped table carries `tenant_id uuid not null` and
enforces PostgreSQL Row Level Security (RLS), with no exceptions. RLS policies restrict
which rows a given database role can see or modify to those matching the session's current
tenant context, evaluated by PostgreSQL itself as part of query planning
([PostgreSQL Row Security Policies documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)),
not by application code remembering to add a `WHERE tenant_id = ?` clause on every query.
This matters because it changes the failure mode of a missing-filter bug: without RLS, a
developer who forgets a tenant filter in one query path leaks cross-tenant data; with RLS
correctly configured, the same missing filter returns zero rows for any tenant other than
the current session's, because the database enforces the boundary independent of the
query text.

### 1.1 How tenant context is set

Every database connection used to serve a request sets the current tenant context (via
`SET LOCAL` on a session variable referenced by the RLS policy predicate) at the start of
the transaction, derived from the authenticated caller's `tenant_id` — for humans, from
the OIDC-authenticated session's tenant claim (`007_RBAC_AND_IDENTITY.md` section 3); for
agents, from the mTLS certificate's tenant binding (`004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md`
section 4.3). No request path constructs a database connection without first establishing
tenant context, and connection pooling is configured so a pooled connection cannot be
handed to a new request while a stale tenant context from a previous request remains set.

### 1.2 What RLS does not cover

RLS protects PostgreSQL 16 tables. It does not, by itself, protect ClickHouse (telemetry
datastore, `CANON.md` section 2), object storage, or Redis. Each of those has its own
tenant-scoping mechanism:

- **ClickHouse**: every telemetry table (`events_raw`, `events_app_usage`, etc., per
  `CANON.md` section 8) carries `tenant_id` as a leading column in its ORDER BY/partition
  key, and query access is mediated exclusively through `bheka-ingest` and `bheka-policy`,
  which inject the tenant filter server-side; there is no direct customer or frontend query
  path to ClickHouse that could omit it. ClickHouse's native row-policy feature is used as
  a defence-in-depth second layer restricting query users to their tenant's partition,
  not relied upon as the sole control.
- **Object storage**: bucket/prefix layout is per-tenant (a tenant's objects live under a
  tenant-specific prefix or a tenant-specific bucket for Tier B/C), and IAM policies scope
  which service roles can read which prefixes. Cross-tenant object access additionally
  fails at the cryptographic layer regardless of any storage-level misconfiguration,
  because each tenant's DEKs are wrapped under that tenant's own root key
  (`004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 2) — a storage-layer isolation failure
  alone does not yield readable plaintext across tenants.
- **Redis**: keys are namespaced by tenant ID prefix; short-lived tokens and rate-limit
  counters are never stored under a bare, non-tenant-scoped key.

## 2. Per-tenant keys as a second, independent isolation layer

`004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 2 establishes that every tenant has its own
root key with no shared ancestor. This document's contribution is naming why this matters
for tenancy specifically, beyond the cryptographic argument already made: RLS is a
software control that can be misconfigured, bypassed by a bug, or defeated by a
sufficiently privileged database role (e.g. a superuser connection that ignores RLS by
default in PostgreSQL unless the table owner also has `FORCE ROW LEVEL SECURITY` set).
Per-tenant keys are a second, independent control that does not rely on the database
access-control layer being correct: even a complete RLS bypass exposes ciphertext and
metadata, not plaintext, for any tenant whose data is protected by content-bearing
encryption (Tier 2/3 evidence, per `006_VISIBILITY_TIERS.md`). Tenancy isolation at Bheka
is therefore defence in depth across two layers that fail independently of each other:
database-level RLS and per-tenant cryptographic sealing.

`FORCE ROW LEVEL SECURITY` is enabled on every tenant-scoped table so that RLS applies
even to the table owner role, and all application services connect using a non-superuser,
non-table-owner role specifically so that RLS cannot be silently bypassed by an
application connection inheriting owner or superuser privilege.

## 3. Noisy-neighbour management

A shared PostgreSQL instance, shared ClickHouse cluster, and shared NATS JetStream deploy
mean one tenant's workload can, without any security boundary being crossed, degrade
service for other tenants purely through resource contention — a large tenant's complex
investigation query or a burst of endpoint telemetry monopolising CPU, memory, or I/O and
causing latency or failures for smaller tenants sharing the same infrastructure
([Neon: The Noisy Neighbor Problem in Multitenant Architectures](https://neon.com/blog/noisy-neighbor-multitenant)).
This is a reliability and fairness problem, not a confidentiality problem, but it is
material to a customer's trust in the platform and is addressed with the following
controls:

- **Per-tenant resource quotas.** `bheka-ingest` and `bheka-policy` enforce per-tenant
  rate limits on telemetry ingestion volume and query concurrency, surfaced via the
  `RateLimit-*` headers already standard per `CANON.md` section 9, so a single tenant's
  burst is throttled rather than allowed to consume shared capacity unbounded.
  Rate-limit configuration itself is stored per tenant, not global.
  Ingestion rate limiting for telemetry additionally interacts with the offline buffering
  described in `CANON.md` section 16: an agent fleet returning from a 30-day offline period
  produces a large backlog burst, which must be smoothed rather than throttled in a way
  that causes permanent data loss, so ingestion quotas apply backpressure to the agent's
  own upload pacing rather than dropping data.
- **ClickHouse resource groups / query complexity limits** scoped per tenant partition, so
  a single tenant's expensive analytical query cannot starve another tenant's dashboard
  queries of CPU or I/O.
- **Postgres connection pool partitioning.** Connection pool slots are allocated with
  per-tenant caps so a single tenant cannot exhaust the pool and starve other tenants of
  database connections.
- **Largest tenants get dedicated capacity.** Tier B customers large enough to justify it,
  and by definition all Tier C customers (fully separate deployment, section 4), are moved
  off shared compute entirely rather than relying on quotas alone; quotas are the control
  for the shared Tier A fleet.
- **Monitoring and alerting.** OpenTelemetry metrics (per `CANON.md` section 2) are tagged
  with `tenant_id` so a resource-contention incident can be attributed to a specific
  tenant's workload during triage, not just observed as an undifferentiated platform
  slowdown.

The exact quota defaults (requests per second per tenant tier, ClickHouse query complexity
ceilings) are Provisional pending load testing at representative customer scale; do not
hardcode specific numeric limits into service configuration without a load test backing
the chosen value.

## 4. On-prem single-tenant (Tier C)

Tier C customers (`004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 1 — government,
air-gapped, SITA-adjacent) run the entire stack, including `eride-vault`, inside their own
estate via the `.ova` appliance, Docker Compose, or Helm chart packaging described in
`CANON.md` section 2 and section 11. For these deployments, the multi-tenancy question
this document otherwise addresses does not arise in the same way: there is exactly one
tenant per deployment, running on infrastructure Eride never operates or has network
reachability to. Noisy-neighbour concerns (section 3) are eliminated by construction, not
managed by quota, because no other tenant's workload shares the same infrastructure.

This does not mean Tier C is exempt from the controls in this document — RLS remains
enabled (a single-tenant deployment with RLS turned off is still a latent risk if the
deployment is later federated or migrated, and disabling a Locked control per `CANON.md`
section 8 for convenience is not permitted), and the same schema and table structure
(`schemas/database/`) is used unmodified so that Tier C deployments are not a fork of the
codebase, only a different deployment topology. Support and upgrade tooling for Tier C is
covered in the packaging and distribution material referenced in `CANON.md` section 11,
not in this document.

## 5. Testing tenant isolation

An isolation guarantee is only as credible as the adversarial test behind it. Bheka's
isolation testing programme covers:

1. **Automated cross-tenant query fuzzing.** A test suite that, for every tenant-scoped
   table, attempts queries under tenant A's session context that could return tenant B's
   rows through common bug patterns (missing WHERE clause equivalent, ORM
   query-builder misuse, unparameterised raw SQL). This runs in CI against every change
   touching `schemas/database/` or any service's data-access layer, per the CI/CD pipeline
   in `CANON.md` section 2.
2. **RLS policy regression tests.** Every table's RLS policy is exercised directly at the
   database level (not only through application code) to confirm `FORCE ROW LEVEL
   SECURITY` is set and the policy predicate is correct, independent of whether the
   application layer happens to also filter correctly.
3. **Cryptographic blast-radius test.** As specified in
   `004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 2, a standing penetration test scenario
   confirms that full compromise of one tenant's KMS grant or database row yields zero
   decrypt capability for another tenant.
4. **Noisy-neighbour load test.** A synthetic large-tenant workload is run alongside
   synthetic small-tenant workloads to confirm the quotas in section 3 hold latency and
   error rate for the small tenants within agreed bounds while the large tenant is
   throttled, not the other way around.
5. **Third-party penetration test before any Tier B contract with a bank or insurer.**
   Given the target buyer for Tier B (`004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 1) and
   the Joint Standard 2 of 2024 driver (`CANON.md` section 7), an independent penetration
   test specifically scoped to tenant isolation is expected as a sales/compliance gate,
   not merely an internal nice-to-have. The specific firm, cadence, and scope are Open;
   no vendor has been selected.

## 6. What this document does not cover

- The cryptographic mechanics of per-tenant keys are in
  `004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md`.
- Role-based access within a tenant (as opposed to isolation between tenants) is in
  `007_RBAC_AND_IDENTITY.md`.
- Table structures and RLS policy SQL are in `schemas/database/`, not restated here.
- Deployment packaging mechanics for on-prem/air-gap are in `CANON.md` section 11 and are
  not duplicated here.

## AI implementation constraints

- Do not create any tenant-scoped table without `tenant_id uuid not null` and an
  accompanying RLS policy with `FORCE ROW LEVEL SECURITY` enabled; this must be enforced
  by a migration lint check, not left to manual review discipline alone.
- Do not connect any application service to PostgreSQL using a superuser or table-owner
  role; use a dedicated least-privilege role subject to RLS.
- Do not hardcode noisy-neighbour quota values without a load test result backing the
  chosen number; mark defaults as Provisional in configuration comments until validated.
- Do not implement any direct frontend or customer-facing query path to ClickHouse that
  bypasses `bheka-ingest`/`bheka-policy`'s server-side tenant filtering.
- Do not fork the database schema for Tier C on-prem deployments; use the same
  `schemas/database/` definitions as the multi-tenant SaaS deployment.

## Required inputs

- Load test results establishing noisy-neighbour quota defaults (section 3), currently
  Provisional.
- Selection of a third-party penetration testing firm and cadence for Tier B/C isolation
  testing (section 5 item 5), currently Open.
- ClickHouse resource group / query complexity feature evaluation for the specific
  ClickHouse 24.x version pinned in `CANON.md` section 2.

## Expected outputs

- RLS policies and `FORCE ROW LEVEL SECURITY` migrations for every table in
  `schemas/database/`.
- Cross-tenant query fuzzing test suite wired into GitHub Actions CI per `CANON.md`
  section 2.
- Per-tenant rate limiting middleware in `bheka-gateway` and `bheka-ingest`.
- ClickHouse tenant-partitioned schema and resource group configuration.
- Tier C deployment validation checklist confirming schema parity with the SaaS
  deployment.

## Dependencies

- `004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` for per-tenant key isolation.
- `007_RBAC_AND_IDENTITY.md` for intra-tenant role enforcement.
- `schemas/database/` for all RLS policy definitions.
- `CANON.md` section 11 for on-prem/air-gap packaging.

## Acceptance criteria

- Given a database session with tenant A's context set, when a query attempts to read or
  write a row belonging to tenant B, then PostgreSQL RLS returns zero rows or rejects the
  write, independent of the application query's correctness.
- Given a superuser or table-owner database connection, when it queries a tenant-scoped
  table, then `FORCE ROW LEVEL SECURITY` still applies and cross-tenant rows are not
  returned.
- Given a synthetic large-tenant workload running concurrently with small-tenant
  workloads, when the load test executes, then small-tenant latency and error rate remain
  within agreed bounds.
- Given a Tier C on-prem deployment, when its schema is compared against the SaaS
  deployment's schema, then they are identical.
- Given a full compromise of tenant A's KMS grant, when tested against tenant B's data,
  then no decrypt capability is obtained.

## Test checklist

- [ ] Cross-tenant query fuzzing suite passes in CI for every table in
      `schemas/database/`.
- [ ] RLS policy regression tests confirm `FORCE ROW LEVEL SECURITY` is set and enforced
      against superuser/owner connections.
- [ ] Noisy-neighbour load test executed with synthetic large- and small-tenant workloads,
      results reviewed before setting production quota defaults.
- [ ] Cryptographic blast-radius penetration test scenario executed and passing (shared
      with `004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` test checklist).
- [ ] Tier C deployment schema-parity check automated as part of the `.ova`/Helm chart
      build pipeline.
- [ ] Third-party penetration test scoped to tenant isolation completed before first Tier
      B bank/insurer contract signature.
- [ ] Redis and object storage namespace/prefix isolation reviewed and confirmed free of
      any bare, non-tenant-scoped key or shared prefix.
