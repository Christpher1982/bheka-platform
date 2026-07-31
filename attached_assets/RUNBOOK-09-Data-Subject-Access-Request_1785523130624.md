---
Document: 209_RUNBOOK_09_DATA_SUBJECT_ACCESS_REQUEST
Version: 1.0
Status: Provisional
Owner: Information Officer (customer, supported by Eride)
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-05-Evidence-Viewer.md, schemas/database/010_tenants.sql
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-09: Data Subject Access Request

Status note: Provisional. The precise procedural mechanics of the
Information Regulator's Form 2 (request for access to a data subject's own
information) and the interaction between POPIA sections 23 and 24 and the
Promotion of Access to Information Act (PAIA) request path require attorney
confirmation for the specific customer's Information Officer to rely on
operationally. The technical steps (what Bheka can extract and how) are
current; the legal-procedural framing should be checked against [the
Information Regulator's official
guidance](https://inforegulator.org.za/) before this runbook is promoted to
Locked.

Purpose: handle a request from a monitored employee (the data subject)
exercising their POPIA section 23 right of access to their own personal
information, or section 24 right to request correction or deletion, in
relation to data Bheka has collected about them.

## Roles

The customer (the employer deploying Bheka) is ordinarily the "responsible
party" under POPIA and therefore the correct recipient and responder to a
data subject's request — not Eride directly. Eride's role is to provide the
technical means for the customer's own Information Officer to fulfil the
request. If a data subject contacts Eride directly, redirect them to their
employer's Information Officer while still logging the contact, since
ignoring it entirely is not appropriate even where Eride is not the primary
responder.

## Procedure

### Step 1 — Receive and log the request

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/data-subject-requests" \
  -H "Cookie: bheka_sid=$CUSTOMER_IO_SESSION" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "tenant_id": "'"$TENANT_ID"'",
    "subject_user_id": "'"$SUBJECT_USER_ID"'",
    "request_type": "access",
    "received_via": "email",
    "received_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }'
```

This writes a `data_subject_requests` row (CANON section 8 canonical table)
which independently timestamps the request for the statutory response
window, regardless of how quickly the substantive work below proceeds.

### Step 2 — Verify identity

Confirm the requester is genuinely the data subject named, using the
customer's own existing employee-identity verification process (e.g.
corporate SSO login, HR-verified employee number plus a shared-secret
challenge) — Bheka does not independently verify employee identity, since it
is not the identity system of record; it relies on the customer's HR/IT
identity processes for this step.

### Step 3 — Determine scope: what must, and must not, be disclosed

What must be disclosed on a valid access request:
- Tier 1 baseline metadata pertaining to the requester (application usage
  categories, file operation metadata, web category metadata) for the
  period covered by the applicable retention schedule.
- Any Tier 2 or Tier 3 evidence collected about the requester, including
  the fact that Tier 3 was activated, the stated reason recorded at
  activation time, and the transparency notice issued to them at the time
  (per CANON section 4 — they should already have seen this notice, so
  disclosure here is confirmatory, not a first notification).
- The categories of data processed, the purpose, and the retention period,
  per POPIA section 23's "confirmation and description" limb.

What must not be disclosed, or requires care:
- Other individuals' personal information incidentally captured alongside
  the requester's own data (e.g. a Slack conversation captured for the
  requester that also names a colleague) — this typically requires
  redaction of third-party content before disclosure, since the third
  party has their own POPIA rights that the requester's access right does
  not override.
- Detection rule internals, risk-scoring model weights, or policy
  configuration details that reveal how the monitoring system works
  internally — POPIA's access right covers the requester's own personal
  information, not Eride's or the customer's proprietary detection
  methodology. Disclose the fact that a detection triggered and what
  category of behaviour it concerned, not the rule's exact matching logic.
- Data related to an active, not-yet-concluded investigation where
  disclosure would prejudice that investigation — POPIA and equivalent
  frameworks generally recognise this as a lawful basis for a limited,
  temporary refusal or deferral, but this determination should be made by
  the customer's Information Officer with legal input, not unilaterally by
  an engineer fulfilling the request.
- Anything currently under an active legal hold per
  `runbooks/RUNBOOK-06-Legal-Request-Received.md` where disclosure to the
  data subject is itself prohibited by a non-disclosure obligation attached
  to that legal process — this is a rare but real conflict between two
  legal obligations and must be resolved with legal counsel, not by default
  disclosure.

### Step 4 — Extract the responsive data

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/data-subject-requests/$REQUEST_ID/extract" \
  -H "Cookie: bheka_sid=$CUSTOMER_IO_SESSION" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"redact_third_parties": true, "exclude_active_investigation_data": true}'
```

`bheka-case` performs the extraction using the same decrypt-in-memory
pattern as the evidence viewer (`build-guides/GUIDE-05-Evidence-Viewer.md`
section 3) — decrypted content is assembled into the response package and
the in-memory DEK is zeroed immediately after, never persisted to disk in
decrypted form outside the final delivered package itself.

### Step 5 — Review before release

The customer's Information Officer (not an Eride engineer, and not the
investigator who may have opened any related case) reviews the extraction
package before it is sent to the data subject, checking specifically for:
1. Correct redaction of third-party content.
2. No inadvertent inclusion of active-investigation material that should be
   deferred.
3. Plain-language framing of technical categories (a data subject should
   not need to understand ClickHouse table names to understand what was
   collected about them — translate `events_file_ops` into "file transfer
   activity," for example, following the anti-drift principle that internal
   schema names stay internal, referenced only by path in engineering docs,
   never surfaced verbatim to a data subject).

### Step 6 — Deliver

Deliver via a secure channel appropriate to the sensitivity of the content
(encrypted email, or an in-portal secure download requiring the same
identity verification as Step 2, depending on what the customer's existing
process supports). Record delivery:

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/data-subject-requests/$REQUEST_ID/mark-fulfilled" \
  -H "Cookie: bheka_sid=$CUSTOMER_IO_SESSION" \
  -d '{"fulfilled_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'", "delivery_method": "encrypted_email"}'
```

### Step 7 — Correction and deletion requests (section 24 variant)

For a correction request: identify the specific record(s) claimed to be
inaccurate. Bheka's evidence and telemetry records are largely factual
system-observed events (a file was copied, a website category was visited)
rather than subjective assertions about the person, so most "correction"
requests in practice concern metadata like the employee's own name or
department in `users`, not the observed-event records themselves, which
represent what the system captured, not an editorializing claim that could
be "wrong" in the same sense.

For a deletion request specifically: full deletion of an individual data
subject's records within an otherwise-active tenant (as opposed to
tenant-wide crypto-shredding, `runbooks/RUNBOOK-03-Crypto-Shred-A-Tenant.md`)
is not yet a built capability — flagged as an open item below. Where a
retention period has genuinely expired, deletion should already have
happened automatically via the tenant's `retention_schedules` configuration
rather than needing a manual per-subject request; where the retention
period has not expired and no override right exists (POPIA's right to
deletion is not absolute where a legitimate ongoing purpose, such as
retained evidence in an active or recently-closed investigation, still
applies), the correct response is a reasoned refusal, not silent
non-action.

### Step 8 — Timeliness

Track the request against the customer's own POPIA-driven internal SLA (this
runbook does not assert a specific number of days as a hard legal deadline
given the Provisional status above; South African practice commonly targets
responding "as soon as reasonably possible," similar in spirit to the
section 22 breach-notification language) and confirm the `data_subject_requests`
row's `received_at` timestamp anchors this tracking accurately from Step 1,
regardless of how long internal review in Steps 3-5 takes.

## Open items

- Per-data-subject deletion within an otherwise-active tenant is not a built
  capability; only tenant-wide crypto-shredding exists today
  (`runbooks/RUNBOOK-03-Crypto-Shred-A-Tenant.md`). This is a gap for
  section 24 deletion requests where the customer determines deletion is
  legally required for one individual while the tenant otherwise remains
  active, and should be scoped as a product requirement.
- The exact statutory response timeline and Form 2 procedural details need
  attorney confirmation referencing current Information Regulator guidance
  before this runbook is promoted from Provisional to Locked.

---

## AI implementation constraints
- Never disclose third-party personal information incidentally captured
  alongside a requester's own data without redaction.
- Never disclose detection rule internals or risk-scoring methodology as
  part of fulfilling an access request; disclose the fact and category of
  what was detected, not the underlying rule logic.
- Never let an engineer release an extraction package without Information
  Officer review per Step 5.
- Never perform an individual-subject hard deletion by any means other than
  the not-yet-built, properly scoped capability referenced in Open items;
  do not attempt to hand-delete rows directly against production as a
  workaround, since this would bypass audit logging and RLS-protected access
  patterns.

## Required inputs
- A logged, identity-verified data subject request.
- The customer's Information Officer availability for scope determination
  and pre-release review.
- Confirmation of whether any related investigation is active or any legal
  hold applies.

## Expected outputs
- A `data_subject_requests` record spanning receipt through fulfilment.
- A reviewed, redacted extraction package delivered securely to the
  verified data subject.
- A documented, reasoned response for any portion of the request that is
  deferred or refused.

## Dependencies
- `build-guides/GUIDE-05-Evidence-Viewer.md` (decrypt-in-memory extraction
  pattern).
- `runbooks/RUNBOOK-06-Legal-Request-Received.md` (legal hold conflict
  check).
- `runbooks/RUNBOOK-03-Crypto-Shred-A-Tenant.md` (tenant-wide deletion,
  distinct from individual-subject deletion).

## Acceptance criteria
- Given a data subject access request, when the extraction package is
  prepared, then any third-party personal information incidentally
  captured is redacted before Information Officer review.
- Given an active investigation involving the requester, when scoping the
  response, then investigation-related material is excluded pending
  Information Officer and legal determination, not disclosed by default.
- Given a request logged in `data_subject_requests`, when tracked, then its
  `received_at` timestamp — not the eventual extraction completion time —
  anchors the response-timeliness measurement.

## Test checklist
- [ ] A test request run end to end in a staging tenant including a
      simulated third-party mention requiring redaction.
- [ ] A test request run against a subject with an active case to confirm
      investigation material is correctly excluded pending review.
- [ ] Confirm `data_subject_requests` timestamps correctly anchor SLA
      tracking independent of extraction processing time.
- [ ] Attorney confirmation obtained on the Form 2 / statutory timeline
      framing before promoting this runbook to Locked.
