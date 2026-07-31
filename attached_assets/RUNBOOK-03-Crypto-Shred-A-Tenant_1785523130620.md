---
Document: 203_RUNBOOK_03_CRYPTO_SHRED_A_TENANT
Version: 1.0
Status: Locked
Owner: Information Officer (Eride)
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-02-Eride-Vault.md, schemas/database/010_tenants.sql
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-03: Crypto-Shred a Tenant

Purpose: permanently and irrecoverably destroy a tenant's ability to have
its data decrypted, including in backups, by destroying its root key. This
is the POPIA section 14 retention-limit deletion mechanism per CANON section
6. This operation is irreversible. There is no undo.

## When to use this runbook

- Contractual offboarding at the end of a customer relationship, after the
  contractual data-retention/export window has closed.
- A POPIA section 14 retention-limit obligation requires deletion once the
  original purpose for processing has been fulfilled and no further lawful
  basis exists.
- A data subject access/deletion request that legally requires full
  destruction rather than pseudonymisation (cross-reference
  `runbooks/RUNBOOK-09-Data-Subject-Access-Request.md` — most DSARs do not
  require a full tenant-level shred; this runbook is for tenant-level, not
  individual-subject, deletion. Individual-level deletion within an
  otherwise-active tenant is a separate, not-yet-built capability — see the
  open item in section 6).

## Preconditions (mandatory, verify all before proceeding)

1. Written confirmation from the customer's authorised signatory (or a
   binding legal/regulatory order) that deletion should proceed.
2. Confirmation that the contractual data export window has passed, or the
   customer has explicitly waived it in writing.
3. Sign-off from Eride's own Information Officer — this runbook requires
   that specific role, not merely a platform admin.
4. Confirmation that no active legal hold applies (cross-reference
   `runbooks/RUNBOOK-06-Legal-Request-Received.md`; a RICA or Cybercrimes
   Act direction, or pending litigation, can require data to be preserved
   even past its normal retention period — crypto-shredding under an active
   hold could itself be a criminal offence or spoliation).

## Procedure

### Step 1 — Freeze the tenant

Prevent new writes before destroying the key that protects existing ones.

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/admin/tenants/$TENANT_ID/freeze" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"reason": "scheduled crypto-shred per contract offboarding CR-4471"}'
```

This sets `tenants.status` toward `offboarding`, which the agent enrolment
and ingest paths (`build-guides/GUIDE-01-Authentication.md`,
`build-guides/GUIDE-04-Ingest-Pipeline.md`) must check and reject new writes
against per their respective validation logic.

### Step 2 — Final export offer (if not already exercised)

Per the contractual export window, confirm the customer has had the
opportunity to export their data before it becomes permanently
unrecoverable. Do not skip this even under time pressure unless the
precondition in section "Preconditions" item 2 has been explicitly waived in
writing.

### Step 3 — Propose the crypto-shred (quorum required, higher bar than routine rotation)

```bash
grpcurl -cacert vault-ca.pem -cert ops.pem -key ops.key \
  -d '{
    "tenant_id": "'"$TENANT_ID"'",
    "proposal_type": "crypto_shred",
    "proposed_by": "information-officer-nkosi",
    "payload": {
      "reason": "Contract termination, retention window CR-4471 expired 2026-07-15, customer confirmed no legal hold",
      "ticket_reference": "CR-4471"
    },
    "required_approvals": 2
  }' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ProposePolicyChange
```

Crypto-shred proposals should default to a stricter `required_approvals`
(2 is the platform floor; consider requiring 3 for this destructive,
irreversible category, configurable per deployment per
`build-guides/GUIDE-02-Eride-Vault.md` section 5 — this is an operational
choice this runbook recommends, not a CANON-Locked number).

### Step 4 — Approvals

```bash
grpcurl -cacert vault-ca.pem -cert approver1.pem -key approver1.key \
  -d '{"proposal_id": "'"$PROPOSAL_ID"'", "approver_identity": "ops-lead-dlamini"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ApprovePolicyChange

grpcurl -cacert vault-ca.pem -cert approver2.pem -key approver2.key \
  -d '{"proposal_id": "'"$PROPOSAL_ID"'", "approver_identity": "ciso-botha"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ApprovePolicyChange
```

### Step 5 — Execute the shred

`eride-vault` schedules KMS key deletion (respecting AWS KMS's mandatory
7-30 day pending window, per [AWS's ScheduleKeyDeletion
documentation](https://docs.aws.amazon.com/kms/latest/APIReference/API_ScheduleKeyDeletion.html))
and marks the `tenant_keys` root row as `shredded`.

```rust
// Executed by eride-vault's shred handler on quorum approval — shown here
// for operator understanding, not run manually.
pub async fn execute_crypto_shred(&self, tenant_id: &str, approver_ids: &[String]) -> anyhow::Result<()> {
    let root_key = self.get_active_key(tenant_id, "root").await?;

    // AWS enforces a minimum 7-day pending window; we use the maximum 30 days
    // to allow a final emergency-abort check, per section 6 below.
    self.kms.schedule_key_deletion(&root_key.kms_key_reference, 30).await?;

    sqlx::query!(
        "update tenant_keys set status = 'shredded', shredded_at = now(), shredded_by_user_id = $1
         where tenant_id = $2::uuid and key_purpose = 'root' and status = 'active'",
        approver_ids[0], tenant_id,
    ).execute(&self.pool).await?;

    sqlx::query!(
        "update tenants set status = 'crypto_shredded' where id = $1::uuid",
        tenant_id,
    ).execute(&self.pool).await?;

    self.audit.append(tenant_id, "tenant.crypto_shredded", serde_json::json!({
        "approvers": approver_ids,
    })).await?;

    Ok(())
}
```

### Step 6 — 30-day KMS pending window: emergency abort check only

During the AWS KMS pending-deletion window (up to 30 days), the key
technically still exists but is no longer usable for new encrypt operations
and the deletion cannot be casually cancelled without another quorum action.
This window exists as a safety margin against a fat-fingered or fraudulently
obtained shred approval, not as a "final data recovery" opportunity for the
customer — from the moment `execute_crypto_shred` completes, Eride treats
the tenant's data as inaccessible for all normal operational purposes.

If an abort is genuinely warranted (e.g. discovery that the shred approval
was obtained fraudulently, or a legal hold was missed), it requires the same
quorum discipline as the original shred:

```bash
grpcurl -cacert vault-ca.pem -cert ops.pem -key ops.key \
  -d '{"tenant_id": "'"$TENANT_ID"'", "proposal_type": "abort_crypto_shred", "proposed_by": "ciso-botha", "payload": {"reason": "shred approval obtained under investigation for fraud, see INC-0091"}, "required_approvals": 2}' \
  vault.internal.eride.tech:8443 eride.vault.v1.QuorumService/ProposePolicyChange
```

### Step 7 — Confirm irrecoverability after the pending window

Once AWS KMS completes deletion (after the 30-day window), verify no code
path can still unwrap data for this tenant:

```bash
grpcurl -cacert vault-ca.pem -cert ops.pem -key ops.key \
  -d '{"tenant_id": "'"$TENANT_ID"'", "hpke_sealed_dek": "'"$ANY_HISTORICAL_WRAPPED_DEK_B64"'", "key_purpose": "evidence_encryption", "requesting_service": "bheka-case", "request_id": "shred-verification"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.VaultService/UnwrapDek
```

Expected: failure (`KeyNotFound` or equivalent from KMS), confirming
irrecoverability. Record this verification in the tenant's offboarding file.

### Step 8 — Downstream cleanup

- S3 objects containing the tenant's sealed ciphertext are now permanently
  unreadable cryptographic garbage; per POPIA section 14 the retention
  obligation is satisfied by this unreadability, but Eride's own storage
  lifecycle policy should still eventually purge the ciphertext objects
  themselves (they carry storage cost with zero recoverable value).
- ClickHouse Tier 1 metadata rows for the tenant (which were written in the
  clear for query purposes, per `build-guides/GUIDE-04-Ingest-Pipeline.md`
  section 6) are NOT protected by crypto-shredding — they must be explicitly
  deleted via a separate purge job, since metadata-only Tier 1 data was never
  sealed to the tenant key in the first place. Do not assume crypto-shred
  alone satisfies POPIA section 14 for this category of data.
- Confirm the `audit_log` hash chain itself is never crypto-shredded — audit
  records about the tenant's history (including the shred event itself)
  are retained per the audit log's own retention policy
  (`build-guides/GUIDE-07-Audit-Log.md`), since deleting evidence of what
  happened would defeat the purpose of an immutable audit trail. This is a
  deliberate exception: audit metadata about a shredded tenant survives the
  shred; the tenant's substantive evidence content does not.

## Rollback

There is no rollback once Step 5 executes and the KMS pending-deletion
window completes. Within the pending window, only the quorum-gated abort in
Step 6 is available, and only for the KMS deletion itself — no rollback
exists for the `tenants.status = 'crypto_shredded'` application-level
state change once the underlying key is gone.

---

## AI implementation constraints
- Never execute a crypto-shred without written confirmation and Information
  Officer sign-off per the preconditions.
- Never crypto-shred a tenant with a known active legal hold. Check
  `runbooks/RUNBOOK-06-Legal-Request-Received.md` status first, every time.
- Never treat ClickHouse Tier 1 metadata as covered by crypto-shredding; it
  requires a separate explicit purge, per Step 8.
- Never delete or crypto-shred the `audit_log` entries about a tenant, even
  after the tenant itself is shredded.

## Required inputs
- Written deletion authorisation and Information Officer sign-off.
- Confirmation of no active legal hold.
- Two (recommended three) quorum approvers.

## Expected outputs
- `tenant_keys` root key `status = 'shredded'`, `tenants.status =
  'crypto_shredded'`.
- Verified `UnwrapDek` failure for the tenant after the KMS pending window
  completes.
- A completed ClickHouse Tier 1 metadata purge job for the tenant.

## Dependencies
- `build-guides/GUIDE-02-Eride-Vault.md` (quorum and KMS mechanics).
- `runbooks/RUNBOOK-06-Legal-Request-Received.md` (legal hold cross-check).

## Acceptance criteria
- Given a crypto-shred proposal without Information Officer sign-off, when
  submitted, then execution does not proceed regardless of other approvals
  obtained.
- Given a completed shred and expired KMS pending window, when `UnwrapDek`
  is attempted for that tenant, then it fails.
- Given a shredded tenant, when `audit_log` is queried, then the historical
  entries about that tenant, including the shred event, remain present and
  verifiable.

## Test checklist
- [ ] Full dry run against a disposable test tenant, including the KMS
      pending-deletion window verification (use AWS's minimum 7-day window
      in test environments to keep cycle time reasonable).
- [ ] Confirm freeze (Step 1) actually blocks new agent uploads for the
      tenant before proceeding further in the test run.
- [ ] Confirm the abort path (Step 6) works within the pending window in a
      test scenario.
- [ ] Confirm ClickHouse Tier 1 purge job runs and removes rows for the
      shredded test tenant.
- [ ] Confirm audit log entries survive the shred for the test tenant.
