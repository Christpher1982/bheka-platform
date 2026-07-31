---
Document: 201_RUNBOOK_01_TIER_3_INVESTIGATION_ACTIVATION
Version: 1.0
Status: Locked
Owner: Head of Investigations
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-01-Authentication.md, build-guides/GUIDE-06-Policy-Engine.md, schemas/database/010_tenants.sql
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-01: Tier 3 Investigation Activation

Purpose: the step-by-step procedure to legitimately activate Tier 3 (full
content capture) monitoring on a specific user, per CANON section 4. This is
an operator/investigator runbook, not a code guide — it assumes the platform
built in `build-guides/GUIDE-01`, `GUIDE-02`, and `GUIDE-06` is running.

## When to use this runbook

- A `detections` record or a manual investigator observation gives
  reasonable, documented grounds to believe a specific individual is
  actively engaged in conduct warranting full content capture (e.g.
  suspected data exfiltration in progress, suspected fraud with an
  identified suspect).
- Do not use this runbook for fishing expeditions. Tier 3 requires a stated
  reason tied to an open case, not a general suspicion about a department or
  team.

## Preconditions (all required, per CANON section 4)

1. An open `cases` record exists naming the subject user.
2. Two distinct human approvers are available, one of whom holds the
   Information Officer role for the tenant.
3. A stated reason exists in writing.
4. A bounded time window for the activation has been decided (not indefinite).
5. The subject's jurisdiction's transparency requirement is understood — per
   CANON section 5 refusal 8, silent Tier 3 activation is never permitted;
   the data subject will see a record of this activation.

## Procedure

### Step 1 — Confirm or open the case

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/cases?subject_user_id=$SUBJECT_USER_ID&status=open" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" | jq '.data'
```

If no open case exists, open one before proceeding — `bheka-policy` will
refuse to emit or accept a Tier 3 approval request without one, by design
(`build-guides/GUIDE-06-Policy-Engine.md` section 5).

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/cases" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_user_id": "'"$SUBJECT_USER_ID"'",
    "title": "Suspected exfiltration of client contract data",
    "opened_reason": "Detection rule DR-2201 matched three times in 48 hours; investigator review confirms pattern consistent with staged exfiltration."
  }'
```

### Step 2 — Submit the Tier 3 activation request

This can originate from a `bheka-policy` automatic detection (see
`build-guides/GUIDE-06-Policy-Engine.md` section 5,
`emitTier3ApprovalRequest`) or be raised manually by an investigator via the
console. Manual submission:

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/cases/$CASE_ID/approvals" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "request_type": "tier_3_activation",
    "reason": "Manual investigator request: employee observed transferring client files to a personal USB device outside policy.",
    "requested_window_hours": 72
  }'
```

Response includes `approval_id`. Two distinct human approvers, one holding
the Information Officer role, must now approve — see
`build-guides/GUIDE-02-Eride-Vault.md` section 5 for the underlying quorum
mechanics this maps to at the policy layer (note: the `approvals` table
quorum for case/tier decisions is a `bheka-case` concern using the same
M-of-N discipline as the Vault's own quorum engine, not the Vault itself,
since Tier 3 activation is a monitoring-scope decision, not a key-custody
decision).

### Step 3 — First approval (must not be the requester)

The approver completes a WebAuthn step-up (per
`build-guides/GUIDE-01-Authentication.md` section 5) before approving.

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/approvals/$APPROVAL_ID/approve" \
  -H "Cookie: bheka_sid=$APPROVER_1_SESSION" \
  -H "X-Stepup-Token: $APPROVER_1_STEPUP_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)"
```

### Step 4 — Second approval, Information Officer

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/approvals/$APPROVAL_ID/approve" \
  -H "Cookie: bheka_sid=$IO_SESSION" \
  -H "X-Stepup-Token: $IO_STEPUP_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)"
```

`bheka-case` verifies the second approver's role includes `information_officer`
before accepting; if the only two available approvers are both non-IO staff,
the activation cannot proceed — escalate to secure IO availability rather
than substituting a different approver, since this is a Locked CANON section
4 requirement, not a preference.

### Step 5 — Confirm activation and transparency notice

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/approvals/$APPROVAL_ID" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" | jq '{status, tier_activated, window_expires_at}'
```

Expected: `status: "approved"`, `tier_activated: 3`, and a
`transparency_notices` record created for the subject user. Verify the
notice was actually issued (not merely queued):

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/transparency-notices?case_id=$CASE_ID" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" | jq '.data[] | {issued_at, delivery_status, locale}'
```

If `delivery_status` is not `delivered`, follow up before relying on any
Tier 3 evidence gathered — evidence gathered without a delivered transparency
notice is a procedural-fairness risk under the LRA/BCEA context noted in
CANON section 7 and may be inadmissible in a CCMA proceeding.

### Step 6 — Monitor the bounded window

Tier 3 automatically reverts to the prior tier when `window_expires_at`
passes. Do not attempt to silently extend it by editing the record; instead,
submit a fresh approval request with its own two-approver quorum if
continued Tier 3 access is justified. This preserves an accurate audit trail
of exactly how long full-content capture was authorised and by whom, each
time.

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/cases/$CASE_ID/tier-history" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" | jq '.data'
```

### Step 7 — Evidence review

Use `build-guides/GUIDE-05-Evidence-Viewer.md`'s viewer to review captured
content. Every view requires its own WebAuthn step-up and is watermarked and
logged; there is no bulk export path that bypasses the viewer's audit and
watermark behaviour.

### Step 8 — Close out

When the investigation concludes (regardless of outcome), close the case:

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/cases/$CASE_ID/close" \
  -H "Cookie: bheka_sid=$INVESTIGATOR_SESSION" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"resolution": "substantiated", "summary": "..."}'
```

Closing the case immediately invalidates any outstanding evidence view
tokens for it (`build-guides/GUIDE-05-Evidence-Viewer.md` section 7) and ends
any still-active Tier 3 window early.

## Escalation paths

- If two-approver quorum cannot be assembled quickly enough to prevent
  ongoing harm (e.g. active exfiltration happening right now), do not
  attempt to bypass this runbook — escalate to
  `runbooks/RUNBOOK-04-Vault-Break-Glass.md` only if the emergency is a
  key-custody matter, not a monitoring-scope matter. There is no
  break-glass path for skipping Tier 3's dual-approval requirement itself;
  if a genuine emergency requires immediate full-content capture, involve
  the Information Officer and general counsel immediately by phone rather
  than proceeding without the required approvals.
- If the Information Officer is unavailable for an extended period, this is
  an organisational continuity gap the customer's admin team must resolve
  (e.g. designate a deputy Information Officer role assignment); Eride
  support cannot substitute a different approver on the customer's behalf.

---

## AI implementation constraints
- Never script around the two-approver-with-Information-Officer requirement,
  even for "trusted" internal testing against a production tenant.
- Never treat a missing transparency-notice delivery confirmation as
  acceptable to proceed past Step 5 in a real investigation.
- Never extend a Tier 3 window by editing its expiry directly; always create
  a new approval request.

## Required inputs
- An open case naming the subject user.
- Two named approvers, one holding the Information Officer role, both able
  to complete WebAuthn step-up.
- A stated reason and a bounded window duration.

## Expected outputs
- A `transparency_notices` record delivered to the subject.
- A time-bounded Tier 3 activation visible in `tier-history`.
- Evidence reviewable only through the watermarked, audited evidence viewer.

## Dependencies
- `build-guides/GUIDE-01-Authentication.md` (WebAuthn step-up).
- `build-guides/GUIDE-06-Policy-Engine.md` (approval emission mechanics).
- `build-guides/GUIDE-05-Evidence-Viewer.md` (evidence review).

## Acceptance criteria
- Given a Tier 3 approval request with only one approver, when 72 hours
  elapse, then the request expires unapproved and Tier 3 never activates.
- Given a Tier 3 approval request approved by two non-Information-Officer
  staff, when the second approval is submitted, then the API rejects it.
- Given a successful Tier 3 activation, when its window expires, then the
  tier automatically reverts without manual intervention.

## Test checklist
- [ ] Dry run in a staging tenant with two test approvers, one holding the
      Information Officer role.
- [ ] Confirm transparency notice delivery status reaches `delivered` in the
      test run before relying on the process for a real investigation.
- [ ] Confirm case closure invalidates outstanding evidence view tokens.
- [ ] Confirm window expiry automatically reverts tier without manual action.
