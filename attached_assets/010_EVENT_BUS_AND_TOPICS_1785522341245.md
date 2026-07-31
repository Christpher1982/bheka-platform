---
Document: 010_EVENT_BUS_AND_TOPICS
Version: 1.0
Status: Locked
Owner: Engineering lead
Last reviewed: 2026-07-31
Depends on: 002_SYSTEM_ARCHITECTURE, 008_DATA_MODEL
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# Event bus and topics

Bheka uses NATS JetStream as its event bus (CANON section 2). This document
describes every topic in CANON section 10: its producer, its consumers,
delivery and ordering guarantees, retention, replay strategy, and
poison-message handling. Payload shapes are not restated here; each topic has
an authoritative JSON Schema file under `schemas/events/` named after the
topic (CANON section 14) — for example `bheka.case.opened.v1.json` for
`bheka.case.opened.v1`.

## 1. Stream and subject design

All 17 topics share the naming convention `bheka.<domain>.<event>.v<n>`
(CANON section 10). They map to NATS JetStream subjects one-to-one, grouped
into streams by domain so that retention and replay policy can be set per
domain rather than per topic:

| Stream | Subjects (topics) | Rationale for grouping |
|---|---|---|
| `AGENT` | `bheka.agent.enrolled.v1`, `bheka.agent.heartbeat.v1`, `bheka.agent.update_ring_advanced.v1` | Endpoint fleet lifecycle; heartbeat volume is high and short-lived, enrolment and ring-advance are low-volume and long-lived — kept in one stream for operational simplicity, differentiated by per-subject retention (section 4). |
| `TELEMETRY` | `bheka.telemetry.batch.v1` | Highest-volume stream, isolated so its retention and consumer load never affects lower-volume domains. |
| `DETECTION` | `bheka.detection.raised.v1`, `bheka.risk.recalculated.v1` | Output of `bheka-policy`, consumed by the same downstream set (`bheka-case`, `bheka-notify`, `bheka-console`). |
| `CASE` | `bheka.case.opened.v1`, `bheka.case.tier_escalated.v1`, `bheka.approval.requested.v1`, `bheka.approval.granted.v1` | Investigation workflow state machine; ordering across these subjects matters within a single case. |
| `EVIDENCE` | `bheka.evidence.sealed.v1`, `bheka.evidence.viewed.v1`, `bheka.evidence.exported.v1` | Evidence lifecycle; longest retention of any stream given evidentiary and legal-hold requirements. |
| `NOTICE` | `bheka.notice.issued.v1` | Transparency and compliance record; long retention for regulator-facing reporting. |
| `KEY` | `bheka.key.rotated.v1`, `bheka.key.shredded.v1` | Internal-only, never eligible for external webhook delivery, produced exclusively by `eride-vault`. |
| `TENANT` | `bheka.tenant.provisioned.v1` | Low-volume, long-lived tenant lifecycle record. |

## 2. Topic reference table

| Topic | Producer | Consumers | Ordering | Delivery guarantee | Schema |
|---|---|---|---|---|---|
| `bheka.agent.enrolled.v1` | `bheka-gateway` | `bheka-policy` (seed default Tier 1 policy binding), `bheka-console` (fleet view) | Per-agent-id ordering not required; each enrolment is independent | At-least-once | `schemas/events/bheka.agent.enrolled.v1.json` |
| `bheka.agent.heartbeat.v1` | `bheka-ingest` | `bheka-policy` (offline/tamper detection), `bheka-console` (fleet status) | Per-agent-id ordering preferred but not guaranteed across NATS JetStream redeliveries; consumers must tolerate out-of-order heartbeats and key on `occurred_at` | At-least-once | `schemas/events/bheka.agent.heartbeat.v1.json` |
| `bheka.telemetry.batch.v1` | `bheka-ingest` | `bheka-policy` (rule evaluation trigger) | Per-agent-id ordering not required; each batch is independently evaluable since it carries only pointers into ClickHouse | At-least-once | `schemas/events/bheka.telemetry.batch.v1.json` |
| `bheka.detection.raised.v1` | `bheka-policy` | `bheka-case` (case linkage suggestion), `bheka-notify` (admin alerting), `bheka-console` (real-time feed) | Per-subject-user-id ordering not guaranteed; each detection is self-contained | At-least-once | `schemas/events/bheka.detection.raised.v1.json` |
| `bheka.risk.recalculated.v1` | `bheka-policy` | `bheka-console` (dashboards), `bheka-notify` (threshold-crossing alerts) | Per-subject-user-id ordering preferred (score deltas are meaningful only relative to the immediately prior score); consumers should defensively re-derive ordering from `occurred_at` rather than assume delivery order | At-least-once | `schemas/events/bheka.risk.recalculated.v1.json` |
| `bheka.case.opened.v1` | `bheka-case` | `bheka-notify` (participant notification), `bheka-console` | Not applicable, one event per case creation | At-least-once | `schemas/events/bheka.case.opened.v1.json` |
| `bheka.case.tier_escalated.v1` | `bheka-case` | `bheka-ingest` (instruct affected agents to raise collection tier), `bheka-notify` (transparency notice dispatch), `eride-vault` (policy enforcement point awareness) | Must be consumed only after both `bheka.approval.granted.v1` events for the same escalation have been observed by `bheka-case` itself; `bheka-case` is the sole producer and enforces this ordering before publishing, so downstream consumers never see a premature escalation | At-least-once | `schemas/events/bheka.case.tier_escalated.v1.json` |
| `bheka.approval.requested.v1` | `bheka-case` | `bheka-notify` (alert eligible approver pool, including ensuring an Information Officer is notified for Tier 3 case escalations) | Not applicable, one event per approval request | At-least-once | `schemas/events/bheka.approval.requested.v1.json` |
| `bheka.approval.granted.v1` | `bheka-case` | `bheka-case` itself (internal state check for multi-approver subjects), `bheka-notify` | Per-approval-subject ordering matters for multi-approver subjects (Tier 3 escalation requires two); consumers other than `bheka-case` should not infer completion from a single grant event | At-least-once | `schemas/events/bheka.approval.granted.v1.json` |
| `bheka.evidence.sealed.v1` | `bheka-case` | `bheka-console` (case evidence list), retention scheduler (internal to `bheka-case`) | Not applicable, one event per evidence row | At-least-once | `schemas/events/bheka.evidence.sealed.v1.json` |
| `bheka.evidence.viewed.v1` | `bheka-case` | Audit/compliance reporting pipeline, `bheka-notify` (high-sensitivity view alerting) | Not applicable, one event per view | At-least-once | `schemas/events/bheka.evidence.viewed.v1.json` |
| `bheka.evidence.exported.v1` | `bheka-case` | `bheka-notify` (deliver signed download link), audit/compliance reporting pipeline | Not applicable, one event per export | At-least-once | `schemas/events/bheka.evidence.exported.v1.json` |
| `bheka.notice.issued.v1` | `bheka-notify` | Compliance reporting pipeline, `bheka-console` (Information Officer dashboard) | Not applicable, one event per notice | At-least-once | `schemas/events/bheka.notice.issued.v1.json` |
| `bheka.key.rotated.v1` | `eride-vault` | Security/audit reporting pipeline | Not applicable, one event per rotation | At-least-once | `schemas/events/bheka.key.rotated.v1.json` |
| `bheka.key.shredded.v1` | `eride-vault` | `bheka-case` (mark dependent evidence rows `crypto_shredded`), compliance reporting pipeline | Not applicable, one event per shred, and by definition never repeated for the same `tenant_key_id` | At-least-once | `schemas/events/bheka.key.shredded.v1.json` |
| `bheka.tenant.provisioned.v1` | `bheka-gateway` | `bheka-notify` (welcome sequence), billing pipeline | Not applicable, one event per tenant | At-least-once | `schemas/events/bheka.tenant.provisioned.v1.json` |
| `bheka.agent.update_ring_advanced.v1` | `bheka-updater` | `bheka-console` (release dashboard) | Per-`agent_version_id` ordering matters (ring only ever advances forward); `bheka-updater` is the sole producer and only advances rings sequentially, so this is guaranteed by the producer, not the bus | At-least-once | `schemas/events/bheka.agent.update_ring_advanced.v1.json` |

## 3. Delivery guarantee and idempotency

NATS JetStream is configured for at-least-once delivery on every consumer
(explicit acknowledgement, `ack_policy: explicit`). No topic in this system
relies on exactly-once semantics, because JetStream does not provide it across
redelivery and consumer-restart scenarios. Every consumer is required to be
idempotent with respect to `event_id` (UUIDv7, present on every event envelope
per every schema in `schemas/events/`): a consumer must de-duplicate on
`event_id` before applying side effects, typically via an upsert keyed on
`event_id` in whatever table or cache records "already processed" state for
that consumer. This is the same idempotency discipline the REST API requires
via `Idempotency-Key` (`docs/009_API_SURFACE.md` section 1), applied to the
event bus.

## 4. Retention

Retention is set per stream, not globally, reflecting the differing legal and
operational weight of each domain:

| Stream | Retention policy | Rationale |
|---|---|---|
| `AGENT` | 30 days for `bheka.agent.heartbeat.v1`; 1 year for `bheka.agent.enrolled.v1` and `bheka.agent.update_ring_advanced.v1` | Heartbeats are operational noise past a short window; enrolment and ring-advance are fleet-history records worth keeping longer for incident review. |
| `TELEMETRY` | 7 days | `bheka.telemetry.batch.v1` is a trigger signal pointing at ClickHouse data that has its own, longer retention (`schemas/database/clickhouse/*.sql` TTLs, ranging 90 to 180 days per table); the event itself need not outlive the rule-evaluation window it exists to trigger. |
| `DETECTION` | 1 year | Matches typical case investigation and audit lookback needs; underlying `detections`/`risk_scores` rows in PostgreSQL are the durable record (`schemas/database/060_detections_and_risk.sql`), this is a operational replay window, not the system of record. |
| `CASE` | 3 years | Aligned with plausible CCMA/Labour Court proceeding timelines (CANON section 7); the durable record is `cases`/`approvals` in PostgreSQL, this retention is for operational replay and downstream reprocessing, not primary evidentiary storage. |
| `EVIDENCE` | 3 years, or until the governing `retention_schedules` disposition for the underlying evidence, whichever is longer, capped at the tenant's crypto-shred event if one occurs first | Evidence lifecycle events must remain replayable for as long as the evidence itself is legally relevant; a crypto-shred (`bheka.key.shredded.v1`) supersedes this by rendering the underlying evidence unrecoverable regardless of the event log's retention. |
| `NOTICE` | 5 years | Transparency notices are the primary artefact demonstrating POPIA and RICA section 6-adjacent notification compliance (CANON section 7); retained longer to support regulator inquiries well after the underlying case has closed. |
| `KEY` | 7 years | Key lifecycle events are the audit trail for the platform's core security control; retained conservatively given their low volume and high forensic value. |
| `TENANT` | Indefinite (tenant lifetime plus 1 year) | Low volume, high reference value for account history. |

These are the event-stream retention windows, distinct from and generally
shorter than the underlying PostgreSQL/ClickHouse/S3 retention governed by
`retention_schedules` (`schemas/database/110_retention.sql`) and the
ClickHouse table-level TTLs. The event bus is a replay and integration
mechanism, not the system of record for any of these domains — PostgreSQL,
ClickHouse, and S3 are.

## 5. Replay strategy

Because every topic uses at-least-once delivery with idempotent consumers
(section 3), replay is safe by construction: a new consumer, or an existing
consumer recovering from a bug, can request redelivery from any retained
point in a stream (by sequence number or timestamp) without risking duplicate
side effects, provided the consumer's de-duplication key (`event_id`) is
honoured. Two replay scenarios are anticipated:

1. **New consumer backfill.** A newly introduced consumer (for example, a
   future analytics service subscribing to `DETECTION`) can create a new
   JetStream consumer with `deliver_policy: all` to process the full retained
   history of a stream rather than only new events from creation time forward.
2. **Incident recovery.** If a consumer's side effects are found to be
   incorrect after a bug fix (for example, `bheka-notify` mishandling
   `bheka.notice.issued.v1` payloads for a period), operations can reset that
   consumer's durable name and redeliver from a chosen sequence number,
   re-running the corrected logic against historical events.

Replay must never re-trigger `eride-vault` key material operations from the
`KEY` stream as if they were new requests; `bheka.key.rotated.v1` and
`bheka.key.shredded.v1` consumers must treat replay purely as a reporting/audit
reconciliation exercise, never as an instruction to re-execute a rotation or
shred.

## 6. Poison-message and dead-letter handling

Every JetStream consumer sets `max_deliver` (recommended default: 5 attempts)
with an increasing backoff between redeliveries. A message that exhausts
`max_deliver` without successful acknowledgement is routed to a dead-letter
subject following the convention `bheka.dlq.<original-subject>`, for example
`bheka.dlq.bheka.detection.raised.v1`. Dead-lettered messages are:

- Retained for at least 30 days regardless of the originating stream's normal
  retention, to allow investigation.
- Alerted on via OpenTelemetry/Grafana (CANON section 2) as soon as a message
  is dead-lettered, since a poison message on `CASE`, `EVIDENCE`, or `KEY`
  subjects is a potential compliance or security incident, not merely an
  operational nuisance.
- Never silently dropped and never automatically replayed back onto the
  original subject without a human decision, since an operator must first
  determine whether the message is malformed (a producer bug) or the consumer
  logic is at fault (a consumer bug) before deciding whether replay is safe.

## 7. Schema evolution rules

Every topic name embeds its schema version (`.v1`, matching the
`schema_version` field asserted as a constant in each schema file under
`schemas/events/`). A breaking payload change is shipped as a new topic
(`.v2`), never as a mutation of an existing `.v1` schema file, mirroring the
REST API's "no breaking changes within a major version" rule
(`docs/009_API_SURFACE.md` section 1, CANON section 9). Non-breaking additions
(a new optional field) may be added to an existing `.v1` schema file provided
`additionalProperties: false` is relaxed only for that specific new optional
field, not removed wholesale — every schema file under `schemas/events/`
currently sets `additionalProperties: false` at both the envelope and `data`
levels, and that constraint must be deliberately and narrowly loosened, not
dropped, when evolving a schema.

When a `.v2` topic is introduced, both `.v1` and `.v2` must run in parallel
until every consumer has migrated, with the producer publishing to both
subjects during the transition window, consistent with the same
zero-downtime philosophy as the REST API's versioning approach.

## AI implementation constraints

- Do not add a topic without a corresponding JSON Schema file under
  `schemas/events/` named exactly after the topic.
- Do not implement exactly-once delivery assumptions anywhere in consumer
  code; every consumer must de-duplicate on `event_id`.
- Do not silently drop or auto-replay dead-lettered messages; require an
  explicit operator action for `CASE`, `EVIDENCE`, and `KEY` stream dead
  letters at minimum.
- Do not mutate an existing `.v1` schema file to make a breaking change; ship a
  new `.v2` topic and schema file instead.

## Required inputs

- `schemas/events/*.json` for topic-level payload definitions.
- `docs/002_SYSTEM_ARCHITECTURE.md` section 4 for the sync/async boundary
  rationale underlying this event bus's role.
- `docs/008_DATA_MODEL.md` for the PostgreSQL/ClickHouse tables each topic
  ultimately reflects or triggers processing against.

## Expected outputs

- This document, kept current with `schemas/events/*.json` as topics are added
  or evolved.
- NATS JetStream stream and consumer configuration (Terraform or equivalent
  infrastructure-as-code) implementing the stream grouping, retention, and
  dead-letter conventions described above.

## Dependencies

- `002_SYSTEM_ARCHITECTURE.md`.
- `008_DATA_MODEL.md`.
- `schemas/events/*.json`.

## Acceptance criteria

- Given the topic reference table in section 2, when compared against CANON
  section 10, then all 17 topics are present with no additions or omissions.
- Given any consumer implementation, when the same event is redelivered after
  a consumer restart, then no duplicate side effect occurs, verified by
  de-duplication on `event_id`.
- Given a message that fails processing `max_deliver` times, when it is
  dead-lettered, then an alert fires and the message is not silently dropped.
- Given a proposed breaking payload change to any `.v1` topic, when reviewed,
  then it is implemented as a new `.v2` topic rather than a mutation of the
  existing schema file.

## Test checklist

- [ ] All 17 topics from CANON section 10 appear in section 2's table, confirmed by direct comparison.
- [ ] Every topic in section 2 has a corresponding file in `schemas/events/` with a matching filename.
- [ ] Idempotent consumption is tested for at least one consumer per stream by redelivering a duplicate `event_id` and confirming no duplicate side effect.
- [ ] Dead-letter routing is tested by forcing a consumer to fail `max_deliver` times and confirming the message lands on the `bheka.dlq.<subject>` convention.
- [ ] Retention windows in section 4 are configured in the actual JetStream stream definitions, not left at NATS defaults.
- [ ] A `.v2` schema evolution drill (adding a deliberately breaking field to a test topic) is performed at least once before this pattern is relied upon in production.
