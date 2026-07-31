---
Document: 016_DETECTION_AND_POLICY_ENGINE
Version: 1.0
Status: Provisional (rule library composition pending 15 discovery interviews with SA financial-services security teams)
Owner: Head of Detection Engineering
Last reviewed: 2026-07-31
Depends on: 006_VISIBILITY_TIERS.md, 007_RBAC_AND_IDENTITY.md, 015_TENANCY_AND_ISOLATION.md
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

## 0. Purpose

`bheka-policy` (per `CANON.md` section 3) is the service that turns raw telemetry into
detections, risk scores, and tier escalation decisions. This document defines the rule
DSL design, the risk scoring model, the triggers that move an endpoint between the tiers
defined in `006_VISIBILITY_TIERS.md`, how false positives are managed operationally, and a
starter library of named detections. Table structures for `policies`, `policy_rules`,
`detections`, and `risk_scores` are Locked in `schemas/database/050_policies.sql` and
`schemas/database/060_detections_and_risk.sql`; this document does not restate their
columns, per the anti-drift rule in `CANON.md` section 14. The rule condition/action JSON
grammar is defined formally in `schemas/policies/rule-dsl.schema.json`, referenced
throughout this document by path, not restated in prose.

This document is Provisional as a whole: the specific starter rule library in section 5 is
Eride's best current judgement about what South African financial-services security teams
need, informed by the competitor landscape named in `CANON.md` section 0, but has not yet
been validated against real customer requirements. It should be revised after the
discovery interviews referenced in `CANON.md` section 1's Provisional-status guidance.

## 1. Rule DSL design

### 1.1 Design goals

- **No restated schema.** The rule DSL's JSON Schema lives at
  `schemas/policies/rule-dsl.schema.json`. A `policy_rules.condition` and
  `policy_rules.action` column (schema in `schemas/database/050_policies.sql`) stores a
  document validated against that schema. Application code, not this document, is the
  source of truth for the grammar's evolution, consistent with the comment already in
  `050_policies.sql`: "condition and action are evaluated by bheka-policy; their JSON
  grammar is versioned in application code... not this schema."
- **One grammar, nine rule types.** `policy_rules.rule_type` (enum, Locked in
  `050_policies.sql`) discriminates which evaluator inside `bheka-policy` interprets a
  given rule's `condition`. The nine types are: `dlp_keyword_regex`,
  `dlp_sa_identifier`, `dlp_structured_fingerprint`, `dlp_document_fingerprint`,
  `behavioural_anomaly`, `sequence_kill_chain`, `usb_device_control`,
  `tier_escalation_trigger`, `tamper_detection`. Each has its own condition shape, unified
  under a single `oneOf` in the JSON Schema keyed on `rule_type`.
- **Declarative, not procedural.** Rules describe what to match and what to do, not how to
  scan; `bheka-policy` compiles declarative conditions into the appropriate matcher (a
  regex engine for `dlp_keyword_regex`, a Luhn/checksum validator for South African ID
  numbers under `dlp_sa_identifier`, a statistical baseline comparator for
  `behavioural_anomaly`, a finite-state matcher for `sequence_kill_chain`). This keeps the
  stored rule portable, auditable by a non-engineer reviewer, and safe to version without
  touching evaluator code.
- **Explainability is mandatory, not optional.** Every rule's `action` may include a risk
  contribution (section 2) that must be traceable, per detection, back to the specific
  rule and the specific signal that fired — this is what makes `risk_scores`'
  `contributing_signals` column (per `060_detections_and_risk.sql`'s comment: "every score
  decomposes into the signals that produced it, no black box") possible, and is a direct
  consequence of the refusal in `CANON.md` section 5 item 6 against opaque scoring.
- **Structurally enforced Tier 3 dual-auth.** `050_policies.sql` already encodes this at
  the database level: `policy_rules_tier3_requires_dual_auth` rejects any row where
  `target_tier = 'tier_3'` and `requires_dual_authorisation` is not true. The DSL's
  `action.tier_change` field, when set to `tier_3`, is therefore only ever a
  recommendation to open a case and request escalation — per
  `006_VISIBILITY_TIERS.md` section 4.1, no rule can cause Tier 3 collection to begin
  without the human dual-authorisation step. The DSL schema encodes this by making
  `action.tier_change = "tier_3"` always pair with `action.requires_case = true` and
  never with an `auto_apply: true` flag, which the schema disallows for Tier 3 targets.

### 1.2 Rule anatomy

A rule (see `schemas/policies/rule-dsl.schema.json` for the authoritative shape) is
composed of: a `rule_type`, a `condition` (type-specific matcher configuration, e.g. a
regex list, an SA ID checksum flag, a peer-group deviation threshold), a `severity` (1-5,
matching `policy_rules.severity`'s range constraint), a `target_tier` (which visibility
tier the rule's match relates to or would escalate toward), and an `action` (what happens
on match: raise a detection, activate Tier 2 for a bounded window, recommend Tier 3 case
opening, contribute to risk score, or a combination).

### 1.3 Example rule types explained

- **`dlp_keyword_regex`**: matches file names, clipboard metadata (Tier 2) or clipboard/
  keystroke content (Tier 3, only if already authorised) against keyword lists and
  regular expressions — e.g. "client list", "resign", competitor names.
- **`dlp_sa_identifier`**: matches South African-specific structured identifiers: 13-digit
  SA ID numbers (with Luhn-style checksum validation to reduce false positives from random
  13-digit strings), South African bank account number patterns, tax reference numbers.
- **`dlp_structured_fingerprint`**: matches structured data exports (e.g. a CSV with
  columns resembling a customer database schema) via column-header and row-count
  heuristics, without needing a pre-registered fingerprint of the exact file.
- **`dlp_document_fingerprint`**: matches against a registered fingerprint (hash or
  near-duplicate signature) of a specific sensitive document a tenant has flagged, so
  copies or renamed variants of that exact document trigger a match.
- **`behavioural_anomaly`**: compares a user's current activity against their own rolling
  baseline and/or a peer group baseline (e.g. `risk_scores.peer_group` per
  `060_detections_and_risk.sql`) — volume of file access, after-hours activity, unusual
  destination for uploads.
- **`sequence_kill_chain`**: matches an ordered or time-windowed sequence of lower-severity
  signals that together indicate a higher-severity pattern (e.g. mass file access followed
  by USB attach followed by resignation-related keyword in clipboard metadata within 48
  hours) — a finite-state pattern across multiple underlying signals, not a single-event
  rule.
- **`usb_device_control`**: matches specific USB vendor/product ID combinations or device
  classes (mass storage) for logging, alerting, or block-list purposes (blocking itself is
  a v2 capability pending the minifilter/kernel work noted in `CANON.md` section 2; v1 can
  detect and alert but not block).
- **`tier_escalation_trigger`**: a rule whose entire purpose is triggering a Tier 1 to
  Tier 2 bounded-window escalation (per `006_VISIBILITY_TIERS.md` section 4.1) rather than
  raising a standalone detection; it may reference another rule's match as its trigger
  condition.
- **`tamper_detection`**: matches attempts to stop, uninstall, or interfere with
  `bheka-agent` itself (process termination attempts, service stop commands, attempts to
  clear the local SQLCipher buffer) — always high severity, because tamper attempts are
  themselves a strong insider-risk signal independent of whatever else is happening.

## 2. Risk scoring model

### 2.1 Model shape

`risk_scores` (per `060_detections_and_risk.sql`) stores an immutable, append-only,
per-user rolling score in the range 0-100, computed against a configurable baseline period
(default 30 days) and, where configured, a peer group. Each snapshot carries a
`contributing_signals` array, the authoritative shape of which is defined in
`schemas/events/bheka.risk.recalculated.v1.json`, not restated here. Conceptually, each
contributing signal has: the detection or rule that produced it, a weight, and its
computed contribution to the total score, so the total score is always the sum (or a
documented function) of named, inspectable parts.

### 2.2 What the model explicitly excludes

Per `CANON.md` section 5 item 6 and the Locked framing in `060_detections_and_risk.sql`'s
own comment ("this is not sentiment or emotion scoring... signals are behavioural and
activity-based only, never inferred emotional state"), the risk model:

- Never takes typing sentiment, tone, or any NLP-derived emotional signal as an input.
- Never outputs or stores a "loyalty" or "flight risk" label framed as a psychological
  state; it scores observed activity risk (e.g. volume of sensitive-file access outside
  normal pattern), not inferred internal state.
- Never feeds into an automated action against a person (per `CANON.md` section 5 item 7);
  a risk score is an investigator triage input, never a trigger with only machine actors in
  the loop for anything beyond a bounded, reversible Tier 2 monitoring-scope change.

### 2.3 Score decay and rehabilitation

A score computed from a rolling baseline naturally decays as the triggering activity ages
out of the baseline window; there is no punitive floor that keeps a score elevated after
the underlying signals have stopped recurring. The specific decay function (linear versus
exponential rolling window) is Provisional pending back-testing against synthetic and, once
available, real customer data.

## 3. Tier escalation triggers

The mapping from a rule match to a tier state-machine transition (formally defined in
`006_VISIBILITY_TIERS.md` section 4) works as follows:

- A `tier_escalation_trigger` rule, or any rule whose `action.tier_change` field is set to
  `tier_2`, causes `bheka-policy` to open (or extend, subject to the maximum-renewal
  configuration referenced in `006_VISIBILITY_TIERS.md` section 4.2) a bounded Tier 2
  window for the specific endpoint(s) or user(s) the match concerns, and emits
  `bheka.detection.raised.v1` and, if the tier actually changes, a tier-change event.
  This is the only automated transition permitted in the state machine.
- A rule whose severity or pattern (typically a `sequence_kill_chain` match, or a
  high-severity `dlp_document_fingerprint`/`dlp_sa_identifier` match) meets a
  tenant-configured threshold additionally triggers automatic case opening
  (`bheka.case.opened.v1`) with a recommendation to request Tier 3, but never activates
  Tier 3 collection itself — that step is always the human dual-authorisation workflow in
  `006_VISIBILITY_TIERS.md` section 4.1 and `007_RBAC_AND_IDENTITY.md`.
- Every escalation, whether automatic (Tier 1 to Tier 2) or human-approved (to Tier 3),
  records which `policy_rules` row and which `detections` row triggered the case, so a
  case's tier history is always traceable to specific rule logic, not an opaque "the
  system decided" statement.

## 4. False positive management

A DLP and behavioural detection product that is not actively managed for false positives
degrades into alert fatigue and, worse, unjust suspicion of employees whose behaviour was
benign. Bheka's false-positive management has three layers:

1. **Structured disposition on every detection.** `detections.status` (per
   `060_detections_and_risk.sql`) includes `false_positive` as a first-class status, not a
   free-text note bolted onto a closed case. Marking a detection `false_positive` requires
   a `triaged_by_user_id` and is itself an auditable action.
2. **Feedback loop into rule tuning.** A rule with a false-positive rate above a
   configurable threshold within a rolling window is surfaced to the Security
   Administrator role (`007_RBAC_AND_IDENTITY.md` section 1) as a candidate for tuning
   (narrowing a regex, raising a threshold, adding an exclusion list) or disabling. This
   feedback surface is a `bheka-console` reporting view over `detections` grouped by
   `policy_rule_id` and `status`, not a separate schema.
3. **Peer-group and personal baselining reduces the false-positive surface structurally.**
   `behavioural_anomaly` rules compare against a rolling personal and/or peer baseline
   (section 2.1) specifically so that, for example, a role that legitimately handles large
   client exports every month-end does not perpetually trigger a "mass export" rule tuned
   for a role that does not. Baseline-relative rules require a minimum baseline period
   (default 30 days, configurable) before they begin firing, to avoid false positives from
   an insufficiently observed baseline.

The specific default false-positive-rate threshold that triggers a tuning recommendation
is Provisional pending real detection-volume data from early customers; do not hardcode an
arbitrary numeric default without flagging it as provisional in configuration.

## 5. Starter rule library

The following 25 named detections form the v1 starter library, expressed as example
policy documents at `schemas/policies/examples/`. Each references the `rule_type` enum
values from `050_policies.sql` and validates against
`schemas/policies/rule-dsl.schema.json`. Severity is on the 1 (low) to 5 (critical) scale
per `policy_rules.severity`.

| # | Name | `rule_type` | Target tier | Severity | Summary |
|---|---|---|---|---|---|
| 1 | Mass file access outside baseline | `behavioural_anomaly` | tier_1 | 3 | File operation count for a user exceeds their personal 30-day baseline by a configured multiple. |
| 2 | After-hours bulk file access | `behavioural_anomaly` | tier_1 | 3 | File operation volume concentrated outside the user's typical working-hours pattern. |
| 3 | Resignation-adjacent activity spike | `sequence_kill_chain` | tier_2 | 4 | Elevated file/USB activity within a configurable window of an HR-flagged resignation or notice period, where an HRIS integration is configured. |
| 4 | SA ID number in outbound transfer | `dlp_sa_identifier` | tier_2 | 4 | Checksum-validated SA 13-digit ID numbers detected in a file name, upload destination metadata, or (Tier 3 only, if authorised) content. |
| 5 | Bank account number pattern in export | `dlp_sa_identifier` | tier_2 | 4 | South African bank account number patterns detected in a structured export. |
| 6 | Client list fingerprint match | `dlp_document_fingerprint` | tier_2 | 5 | A tenant-registered client list or customer database document, or a near-duplicate, is copied, renamed, or exported. |
| 7 | Large USB mass storage write before departure | `usb_device_control` | tier_2 | 5 | USB mass storage device write volume exceeds threshold within a configurable window of a known or predicted departure date. |
| 8 | Unregistered USB device attached | `usb_device_control` | tier_1 | 2 | A USB device with a vendor/product ID not on the tenant's approved list is attached. |
| 9 | Personal cloud storage upload spike | `behavioural_anomaly` | tier_2 | 3 | Elevated upload volume to consumer cloud storage domains (categorised at Tier 1, full URL confirmed at Tier 2). |
| 10 | Personal webmail large attachment | `behavioural_anomaly` | tier_2 | 3 | Large attachment upload activity to personal webmail domains. |
| 11 | Competitor domain contact | `dlp_keyword_regex` | tier_1 | 3 | Browser activity or clipboard metadata referencing a tenant-configured list of competitor domains. |
| 12 | Source code / IP repository bulk clone | `behavioural_anomaly` | tier_2 | 4 | Abnormal volume of repository clone/download activity relative to baseline for the user's role. |
| 13 | Screen capture tool installation | `dlp_keyword_regex` | tier_1 | 2 | Installation or execution of known unauthorised screen-recording or remote-access tools. |
| 14 | Agent tamper attempt | `tamper_detection` | tier_1 | 5 | Attempt to stop, uninstall, or interfere with `bheka-agent`, or to clear its local buffer. |
| 15 | Clipboard mass-paste to external destination | `behavioural_anomaly` | tier_2 | 3 | Large clipboard payload pasted into a browser session on an external, uncategorised, or high-risk domain. |
| 16 | Structured financial dataset export | `dlp_structured_fingerprint` | tier_2 | 4 | Export of a file whose column headers and row-count pattern match a registered financial dataset shape (e.g. account ledgers, transaction exports). |
| 17 | Off-hours privileged application access | `behavioural_anomaly` | tier_1 | 3 | Access to a tenant-flagged privileged/sensitive application outside the user's typical hours. |
| 18 | Print volume spike for sensitive document category | `behavioural_anomaly` | tier_2 | 3 | Abnormal print job volume for documents matching a sensitive-category fingerprint. |
| 19 | VPN/remote access from anomalous pattern combined with file access | `sequence_kill_chain` | tier_2 | 4 | Elevated file access following an access-pattern anomaly, sequenced within a configurable window (network-layer signal sourced from existing security tooling via `integrations`, not from the agent itself). |
| 20 | Trading system data export outside change window | `dlp_structured_fingerprint` | tier_2 | 4 | Export of trading or position data structures during a period not associated with an approved change/reporting window — targeted at Joint Standard 2 of 2024 (`CANON.md` section 7) IT-governance-relevant activity for financial-services tenants. |
| 21 | Repeated failed access to restricted file share | `behavioural_anomaly` | tier_1 | 2 | Repeated access-denied events against a tenant-flagged restricted share, indicating possible boundary probing. |
| 22 | Encrypted archive creation before external transfer | `dlp_keyword_regex` | tier_2 | 3 | Creation of a password-protected or encrypted archive file immediately followed by an upload or USB write event. |
| 23 | Insider tip-off keyword pattern | `dlp_keyword_regex` | tier_3 | 4 | Tenant-configured keyword/phrase patterns associated with market-sensitive information leakage, evaluated only under an active, dual-authorised Tier 3 window. |
| 24 | Cross-border data transfer to unapproved jurisdiction | `dlp_structured_fingerprint` | tier_2 | 4 | Structured data export to a network destination categorised outside the tenant's approved jurisdiction list, relevant to POPIA cross-border transfer conditions (`CANON.md` section 7). |
| 25 | Shared/generic account usage pattern | `behavioural_anomaly` | tier_1 | 2 | Activity pattern on a shared or generic account inconsistent with expected multi-user usage, flagging possible credential sharing that weakens attribution for all other detections. |

Rules 1, 3, 8, and 23 are provided as full worked example policy documents in
`schemas/policies/examples/` (see section 6 below); the remaining 21 follow the same
structural pattern and are intended to be authored by Eride's detection engineering team
before general availability, informed by the discovery interviews noted in the front
matter. This library is a starting point, not a claim of completeness, and specific
threshold values (multiples, window durations) are Provisional throughout pending
real-world tuning.

## 6. Example policy documents

Three fully worked example policy documents, each validating against
`schemas/policies/rule-dsl.schema.json`, are provided at:

- `schemas/policies/examples/mass-file-access-baseline.json` (rule 1 from section 5,
  `behavioural_anomaly`, Tier 1 detection with no tier change).
- `schemas/policies/examples/usb-mass-storage-elevate.json` (rule 8/`tier_escalation_trigger`
  combination pattern, demonstrating a Tier 1 to Tier 2 automated, bounded-window
  escalation).
- `schemas/policies/examples/sa-id-dlp-tier3-recommend.json` (rule 4 pattern, a
  `dlp_sa_identifier` match at Tier 2 that recommends Tier 3 case opening without
  auto-applying it, demonstrating the dual-authorisation boundary from section 1.1).

## 7. What this document does not cover

- The tier definitions that rules escalate between are in `006_VISIBILITY_TIERS.md`.
- The dual-authorisation mechanics for Tier 3 are in `007_RBAC_AND_IDENTITY.md` and
  `006_VISIBILITY_TIERS.md` section 5.
- `policies`, `policy_rules`, `detections`, `risk_scores` table structures are in
  `schemas/database/050_policies.sql` and `schemas/database/060_detections_and_risk.sql`.
- The rule DSL's formal JSON Schema and example policy documents are in
  `schemas/policies/`.
- Event payload shapes for `bheka.detection.raised.v1` and `bheka.risk.recalculated.v1`
  are in `schemas/events/`.

## AI implementation constraints

- Do not implement any rule action that activates Tier 3 collection directly; every path
  from a rule match to Tier 3 must pass through case creation and the dual-authorisation
  workflow in `007_RBAC_AND_IDENTITY.md`.
- Do not implement a risk scoring feature that ingests NLP sentiment, tone, or any
  emotion-adjacent signal, even as an experimental or internal-only feature.
- Do not implement `risk_scores` as a mutable, in-place-updated row; every recomputation
  must insert a new row, preserving history for evidence-pack reproducibility.
- Do not hardcode false-positive-rate thresholds or behavioural baseline multiples without
  marking them Provisional in configuration and tracking them for post-launch tuning.
- Validate every `policy_rules.condition` and `.action` document against
  `schemas/policies/rule-dsl.schema.json` at write time in `bheka-policy` and reject
  non-conforming documents; do not rely on UI-side validation alone.

## Required inputs

- Discovery interviews with South African financial-services security teams to validate
  and refine the starter rule library in section 5 (referenced in front matter as the
  reason this document is Provisional).
- Confirmed default false-positive-rate threshold and baseline decay function (sections 2.3
  and 4), currently Provisional pending real detection-volume data.
- Confirmed integration approach for network/VPN-layer signals referenced in rule 19,
  since the endpoint agent alone does not observe network access-pattern anomalies of that
  kind — likely sourced via the `integrations` table (per `CANON.md` section 8) from
  existing customer security tooling, to be scoped separately.

## Expected outputs

- `bheka-policy` rule evaluators for all nine `rule_type` values.
- `schemas/policies/rule-dsl.schema.json` JSON Schema, validated in CI against all
  example and seeded production rule documents.
- Seed data implementing the 25 named detections in section 5, at minimum the four fully
  worked examples in section 6.
- False-positive tuning report view in `bheka-console` grouping `detections` by
  `policy_rule_id` and `status`.

## Dependencies

- `006_VISIBILITY_TIERS.md` for tier definitions and the escalation state machine.
- `007_RBAC_AND_IDENTITY.md` for the dual-authorisation workflow gating Tier 3.
- `015_TENANCY_AND_ISOLATION.md` for per-tenant scoping of policies and rules.
- `schemas/database/050_policies.sql` and `060_detections_and_risk.sql` for table
  structures.
- `schemas/policies/rule-dsl.schema.json` and `schemas/policies/examples/` for the rule
  grammar and worked examples.

## Acceptance criteria

- Given a rule with `target_tier = tier_3`, when it is saved, then the database rejects it
  unless `requires_dual_authorisation = true`, and the application layer never exposes an
  `auto_apply` path for it.
- Given a `behavioural_anomaly` rule with an insufficient baseline period observed for a
  user, when telemetry is evaluated, then the rule does not fire for that user until the
  minimum baseline period has elapsed.
- Given a detection marked `false_positive`, when the tuning report is generated, then
  that detection contributes to the false-positive rate calculation for its originating
  rule.
- Given a risk score recalculation, when the new snapshot is written, then the previous
  snapshot remains queryable unchanged and the new snapshot's `contributing_signals`
  reference specific `detections` rows.
- Given the four worked example policy documents in section 6, when validated against
  `schemas/policies/rule-dsl.schema.json`, then all four pass validation.

## Test checklist

- [ ] JSON Schema validation test suite covers all nine `rule_type` condition shapes with
      both valid and invalid example documents.
- [ ] Tier 3 auto-apply prevention test confirms no code path can set a case's tier to 3
      without a passing dual-authorisation check.
- [ ] Baseline warm-up test confirms `behavioural_anomaly` rules are silent until the
      minimum baseline period has been observed for a given user.
- [ ] False-positive tuning report tested against seeded detection data with known
      false-positive rates.
- [ ] SA ID checksum validation tested against known-valid and known-invalid 13-digit
      strings to confirm `dlp_sa_identifier` reduces false positives from random digit
      strings.
- [ ] Risk score history immutability test confirms no update path exists for a previously
      written `risk_scores` row.
- [ ] End-to-end test for rule 8 (USB mass storage) confirms Tier 1 to Tier 2 automated
      escalation with correct bounded window and automatic de-escalation at expiry.
- [ ] End-to-end test for rule 4 (SA ID DLP) confirms a Tier 3 recommendation opens a case
      but does not activate Tier 3 collection absent dual authorisation.
