---
Document: 204_RUNBOOK_04_VAULT_BREAK_GLASS
Version: 1.0
Status: Locked
Owner: CISO (Eride)
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-02-Eride-Vault.md
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-04: Vault Break-Glass

Purpose: the emergency procedure for invoking `eride-vault`'s break-glass
mechanism (`build-guides/GUIDE-02-Eride-Vault.md` section 7) when standard
M-of-N quorum cannot be assembled in time to prevent harm. Break-glass
trades a slower, safer approval process for speed, in exchange for mandatory
heavy logging and forced retrospective review. It is not a way to avoid
oversight — it delays oversight by at most 24 hours.

## When to use this runbook

Genuine emergencies only, for example:
- Active, observed data exfiltration where waiting for a second quorum
  approver would allow material harm to continue.
- A confirmed key-custody emergency (e.g. credible evidence an operator
  credential is compromised and being used against the Vault right now).
- A RICA or Cybercrimes Act direction with an immediate compliance deadline
  that cannot practically wait for standard quorum turnaround (cross-check
  `runbooks/RUNBOOK-06-Legal-Request-Received.md` first — most legal
  requests do not require break-glass, only extremely time-constrained ones
  do).

Do not use this runbook for: convenience, an approver being merely slow to
respond within a normal business day, or routine operations that were simply
not planned for in advance. Every break-glass invocation is treated as a
security event in its own right and reviewed as such.

## Preconditions

1. A stated reason (mandatory, enforced by `eride-vault` — see
   `build-guides/GUIDE-02-Eride-Vault.md` section 7, `BreakGlassEngine::initiate`
   rejects an empty reason).
2. An incident ticket reference (mandatory, same enforcement).
3. The initiator is a named, certificate-authenticated Vault operator, never
   a shared account.

## Procedure

### Step 1 — Open an incident ticket first

Break-glass without a ticket reference is rejected by the Vault itself, so
this step is not optional even under extreme time pressure.

```bash
# Using the incident template as the source of truth for the ticket body.
# See templates/INCIDENT_REPORT_TEMPLATE.md
INCIDENT_ID=$(create-incident-ticket.sh --severity critical --title "Active exfiltration - tenant $TENANT_ID")
echo "Incident ticket: $INCIDENT_ID"
```

### Step 2 — Initiate break-glass

```bash
grpcurl -cacert vault-ca.pem -cert oncall-operator.pem -key oncall-operator.key \
  -d '{
    "tenant_id": "'"$TENANT_ID"'",
    "initiator_identity": "oncall-operator-mahlangu",
    "reason": "Active exfiltration observed via detection DR-3390; second approver (Information Officer) unreachable for 40 minutes despite escalation calls; exfiltration appears ongoing.",
    "ticket_reference": "'"$INCIDENT_ID"'"
  }' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/InitiateBreakGlass
```

This immediately:
- Records a `policy_change_proposals` row with `status = 'approved'` and a
  synthetic self-approval marker (`build-guides/GUIDE-02-Eride-Vault.md`
  section 7).
- Writes an `audit_log` entry.
– Fires an immediate high-priority alert to every registered security
  contact for the tenant and to Eride's own security on-call (via
  `bheka-notify`, WhatsApp/email per CANON section 16).

### Step 3 — Perform the emergency action

With the break-glass proposal now in `approved` status, proceed with the
actual gated operation (e.g. an emergency key rotation, an emergency Tier 3
activation request approval override at the Vault-policy layer, or a
break-glass-scoped `UnwrapDek` for incident-response evidence review).
Reference the specific runbook for the operation itself
(`runbooks/RUNBOOK-02-Key-Rotation.md`,
`runbooks/RUNBOOK-01-Tier-3-Investigation-Activation.md`) — this runbook
covers only the break-glass authorisation step, not the substantive
operation's own mechanics.

### Step 4 — Notify affected parties

Confirm the automatic alert from Step 2 actually reached:
- Eride's security on-call (verify via the paging system's acknowledgement).
- The affected tenant's registered security contact, unless doing so would
  itself compromise an active investigation (e.g. tipping off an insider
  suspect) — in that narrow case, delay tenant notification but document the
  justification and timeline for later disclosure, and involve legal counsel
  given POPIA section 22 breach notification obligations may still apply on
  their own timeline regardless of operational secrecy needs.

### Step 5 — Mandatory retrospective review within 24 hours

Per `build-guides/GUIDE-02-Eride-Vault.md` section 7, a retrospective review
item is auto-created with a 24-hour deadline. Convene the review:

```bash
curl -s -X GET "https://vault-ops.internal.eride.tech/v1/break-glass/$PROPOSAL_ID/retrospective" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq
```

The review must independently confirm, with the full M-of-N quorum this
time (not the emergency single-approver path):
1. The emergency genuinely warranted bypassing standard quorum.
2. The action taken was proportionate and correctly scoped.
3. No abuse occurred.

```bash
grpcurl -cacert vault-ca.pem -cert reviewer1.pem -key reviewer1.key \
  -d '{"proposal_id": "'"$PROPOSAL_ID"'", "approver_identity": "security-lead-govender"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ApprovePolicyChange

grpcurl -cacert vault-ca.pem -cert reviewer2.pem -key reviewer2.key \
  -d '{"proposal_id": "'"$PROPOSAL_ID"'", "approver_identity": "ciso-botha"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ApprovePolicyChange
```

If the retrospective review does not complete within 24 hours,
`eride-vault` automatically suspends the tenant's (or the initiating
operator's, depending on deployment configuration) ability to issue further
break-glass requests until a human clears it — this is intentional friction
to force the review to actually happen, not an oversight to route around.

### Step 6 — Write the incident report

Complete `templates/INCIDENT_REPORT_TEMPLATE.md` for this event regardless
of retrospective outcome. Break-glass usage is inherently notable even when
it turns out to have been the right call.

## Escalation if retrospective review finds misuse

If the retrospective determines the break-glass was not warranted or was
abused:
1. Immediately review and, if necessary, revoke the initiating operator's
   Vault client certificate.
2. Treat this as a security incident against Eride's own systems and follow
   `runbooks/RUNBOOK-05-Suspected-Data-Breach.md` if any customer data
   exposure resulted.
3. Notify the affected tenant per contractual and POPIA obligations.

---

## AI implementation constraints
- Never invoke break-glass without a stated reason and ticket reference —
  this is enforced by the Vault itself and must never be worked around by
  fabricating a placeholder reason.
- Never skip the mandatory 24-hour retrospective review, and never let a
  break-glass initiator also serve as one of the two retrospective
  reviewers.
- Never treat break-glass as routine. If a particular operation needs
  break-glass more than rarely, that is a signal the standard quorum process
  itself is broken and needs fixing, not a signal to keep using break-glass.

## Required inputs
- An incident ticket reference.
- A named on-call operator with a valid Vault client certificate.
- Two independent reviewers (not the initiator) for the retrospective.

## Expected outputs
- An `audit_log` entry and immediate alert at initiation.
- A completed retrospective review within 24 hours, itself quorum-approved.
- A filled `templates/INCIDENT_REPORT_TEMPLATE.md` document.

## Dependencies
- `build-guides/GUIDE-02-Eride-Vault.md` section 7 (break-glass mechanism).
- `templates/INCIDENT_REPORT_TEMPLATE.md`.

## Acceptance criteria
- Given a break-glass initiation without a ticket reference, when attempted,
  then the Vault rejects it before any emergency action proceeds.
- Given a successful break-glass initiation, when 24 hours pass without a
  completed retrospective, then further break-glass requests from that
  initiator/tenant are automatically suspended.
- Given a completed retrospective, when reviewed, then the two reviewers are
  distinct from the original initiator.

## Test checklist
- [ ] Break-glass initiation tested in staging with a missing reason/ticket
      to confirm rejection.
- [ ] Successful break-glass tested end to end including alert delivery
      verification.
- [ ] 24-hour auto-suspend behaviour tested with an accelerated clock in a
      non-production environment.
- [ ] Retrospective review flow tested with two distinct reviewers.
