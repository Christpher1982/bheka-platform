---
Document: 202_RUNBOOK_02_KEY_ROTATION
Version: 1.0
Status: Locked
Owner: Security Engineering Lead
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-02-Eride-Vault.md, schemas/database/010_tenants.sql
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-02: Key Rotation

Purpose: rotate a tenant's active cryptographic key (root, evidence
encryption, telemetry encryption, or agent transport per
`tenant_key_purpose` in `schemas/database/010_tenants.sql`) on schedule or in
response to a suspected compromise, without breaking decryptability of data
already sealed under the previous key version.

## When to use this runbook

- Scheduled rotation per `key_custody_config.rotation_period_days` (default
  90 days).
- Suspected key compromise (in which case also open a security incident and
  cross-reference `runbooks/RUNBOOK-05-Suspected-Data-Breach.md`).
- Customer-requested rotation (contractual right for tier B customers who
  control their own CMK).

## Key rotation principle

Rotating a key never re-encrypts historical evidence. Historical blobs
remain sealed under the DEK that was itself sealed under the key version
active at the time of capture (`build-guides/GUIDE-03-Endpoint-Agent.md`
section 2). Rotation only changes which key version new captures use going
forward, and which key version the Vault uses as the current wrapping
target. Old key versions remain available for unwrap (`status = 'rotated'`,
not `'shredded'`) until an explicit crypto-shred decision is made
(`runbooks/RUNBOOK-03-Crypto-Shred-A-Tenant.md`).

## Procedure

### Step 1 — Propose the rotation (quorum required)

Per `build-guides/GUIDE-02-Eride-Vault.md` section 5, a key rotation is a
policy change requiring M-of-N quorum.

```bash
grpcurl -cacert vault-ca.pem -cert ops.pem -key ops.key \
  -d '{
    "tenant_id": "'"$TENANT_ID"'",
    "proposal_type": "key_rotation",
    "proposed_by": "ops-operator-jsmith",
    "payload": {"key_purpose": "evidence_encryption", "reason": "scheduled 90-day rotation"},
    "required_approvals": 2
  }' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ProposePolicyChange
```

### Step 2 — Approvals

Two distinct operators approve (never the proposer):

```bash
grpcurl -cacert vault-ca.pem -cert approver1.pem -key approver1.key \
  -d '{"proposal_id": "'"$PROPOSAL_ID"'", "approver_identity": "ops-operator-mkhumalo"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ApprovePolicyChange

grpcurl -cacert vault-ca.pem -cert approver2.pem -key approver2.key \
  -d '{"proposal_id": "'"$PROPOSAL_ID"'", "approver_identity": "ops-operator-vandermerwe"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ApprovePolicyChange
```

### Step 3 — Generate the new key version

Once approved, `eride-vault` executes the rotation:

```sql
-- Executed by eride-vault's rotation handler, not run manually against
-- Postgres directly. Shown here for operator understanding of the effect.
-- See schemas/database/010_tenants.sql for the tenant_keys table.
insert into tenant_keys (tenant_id, key_custody_config_id, key_purpose, status, kms_key_reference, public_key_x25519, version)
values ($1, $2, 'evidence_encryption', 'pending', $3, $4, (select coalesce(max(version), 0) + 1 from tenant_keys where tenant_id = $1 and key_purpose = 'evidence_encryption'));

-- Activation is atomic: the old active row flips to 'rotated' in the same
-- transaction that flips the new row to 'active', preserving the
-- tenant_keys_active_purpose_uidx unique-active-per-purpose constraint.
update tenant_keys set status = 'rotated', rotated_at = now()
  where tenant_id = $1 and key_purpose = 'evidence_encryption' and status = 'active';

update tenant_keys set status = 'active', activated_at = now()
  where id = $5; -- the newly inserted row
```

For AWS KMS-backed tier A tenants, this triggers the equivalent of a new KMS
data key generation cycle keyed to the same customer master key (rotation
here means rotating the tenant's X25519 public/private pair used for HPKE
sealing, not necessarily the underlying AWS KMS CMK, which AWS can
additionally auto-rotate on its own annual schedule — the two rotation
mechanisms are independent and both matter).

### Step 4 — Distribute the new public key to agents

The new `public_key_x25519` must reach every enrolled agent so future
captures seal to the current key. This happens automatically via the
agent's periodic policy sync (piggybacking on the heartbeat channel built in
`build-guides/GUIDE-03-Endpoint-Agent.md`), not a separate manual push.
Confirm propagation:

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/tenants/$TENANT_ID/agents/key-sync-status" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq '{total_agents, synced_to_current_key, pending}'
```

Wait until `pending` reaches zero (or an acceptable floor accounting for
long-offline agents per the 30-day buffer in
`build-guides/GUIDE-03-Endpoint-Agent.md`) before considering rotation
operationally complete. An agent still offline beyond that window will sync
on next contact automatically; no manual intervention is required for it.

### Step 5 — Verify old key remains available for historical decryption

```bash
grpcurl -cacert vault-ca.pem -cert ops.pem -key ops.key \
  -d '{
    "tenant_id": "'"$TENANT_ID"'",
    "hpke_sealed_dek": "'"$SAMPLE_OLD_WRAPPED_DEK_B64"'",
    "key_purpose": "evidence_encryption",
    "requesting_service": "bheka-case",
    "request_id": "rotation-verification-'"$(date +%s)"'"
  }' \
  vault.internal.eride.tech:8443 eride.vault.v1.VaultService/UnwrapDek
```

Expected: a successful unwrap of a DEK that was sealed before rotation,
proving old evidence remains readable. `eride-vault` selects the correct key
version to attempt based on which version the wrapped DEK's KMS ciphertext
metadata indicates, not merely "the current active key" — this is why
rotated keys are retained (`status = 'rotated'`), not deleted, until an
explicit crypto-shred.

### Step 6 — Record and close

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/tenants/$TENANT_ID/audit-log?action=key.rotated" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq '.data[0]'
```

Confirm a `bheka.key.rotated.v1` event (CANON section 10) was published and
an `audit_log` row exists. Update the customer-facing rotation record if
this is a tier B customer with contractual rotation reporting requirements.

## Suspected-compromise variant

If this rotation is triggered by suspected compromise rather than schedule:

1. Follow Steps 1-6 above, but mark `payload.reason` as
   `"suspected_compromise"` so the audit trail distinguishes routine from
   incident-driven rotations.
2. Immediately open an incident using
   `templates/INCIDENT_REPORT_TEMPLATE.md` and cross-reference
   `runbooks/RUNBOOK-05-Suspected-Data-Breach.md` — a compromised key may
   mean data was already exposed before rotation, which rotation alone does
   not remediate.
3. Do not wait for standard 24-hour quorum turnaround in a live compromise;
   use `runbooks/RUNBOOK-04-Vault-Break-Glass.md` if quorum cannot be
   assembled fast enough, understanding this triggers mandatory retrospective
   review.

---

## AI implementation constraints
- Never delete or shred an old key version as part of a routine rotation.
  Rotation and crypto-shredding are different operations with different
  runbooks and different irreversibility guarantees.
- Never allow a rotation proposal to execute without the quorum approvals
  recorded in `policy_change_approvals`.
- Never assume agent key-sync is instantaneous; always check
  `key-sync-status` before declaring rotation complete.

## Required inputs
- Tenant ID and key purpose to rotate.
- Two named Vault operator approvers with valid client certificates.
- A sample previously-wrapped DEK for the post-rotation decryptability check
  (Step 5).

## Expected outputs
- A new `active` `tenant_keys` row and the previous row transitioned to
  `rotated`.
- Confirmed agent key-sync completion.
- Confirmed continued decryptability of pre-rotation evidence.

## Dependencies
- `build-guides/GUIDE-02-Eride-Vault.md` (quorum mechanics, KMS integration).
- `build-guides/GUIDE-03-Endpoint-Agent.md` (agent key-sync behaviour).

## Acceptance criteria
- Given a rotation approved by quorum, when it executes, then exactly one
  `tenant_keys` row per key purpose has `status = 'active'` at any time.
- Given evidence sealed before rotation, when `UnwrapDek` is called for it
  after rotation, then it still succeeds.
- Given a rotation proposed by an operator, when that same operator attempts
  to approve it, then the approval is rejected.

## Test checklist
- [ ] Rotation executed against a test tenant with pre-existing sealed
      evidence; post-rotation decrypt of the old evidence verified.
- [ ] Agent key-sync status confirmed to reach zero pending within an
      expected time window in a staging fleet.
- [ ] Quorum self-approval rejection re-verified in the context of a
      rotation proposal specifically (not just a generic quorum test).
- [ ] `bheka.key.rotated.v1` event and audit log entry confirmed present
      after a real rotation run.
