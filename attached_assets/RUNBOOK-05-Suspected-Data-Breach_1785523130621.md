---
Document: 205_RUNBOOK_05_SUSPECTED_DATA_BREACH
Version: 1.0
Status: Provisional
Owner: CISO (Eride)
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-02-Eride-Vault.md, build-guides/GUIDE-07-Audit-Log.md
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-05: Suspected Data Breach

Status note: this runbook is Provisional. POPIA section 22's exact breach
notification timelines and the Information Regulator's current reporting
mechanism require attorney confirmation before this runbook is treated as
legally sufficient. The technical containment steps are current best
practice; the legal notification steps are best-effort pending that review.

Purpose: contain, investigate, and report a suspected breach of Bheka
platform data — customer telemetry, evidence, or key material — whether the
suspected cause is external attack, insider misuse of Eride's own access, or
a vulnerability in the platform itself.

## Severity triage (do this first, within minutes)

| Signal | Likely severity |
|---|---|
| Suspected compromise of a Vault operator credential | Critical — proceed to Step 1 immediately |
| Suspected unauthorised access to sealed evidence (ciphertext only, no key exposure) | High — ciphertext alone is not a breach of confidentiality per CANON's crypto design, but investigate why access controls were bypassed |
| Suspected unauthorised access to Tier 1 ClickHouse metadata (unsealed) | High — this is plaintext exposure, treat as a live breach |
| Anomalous `eride-vault` `UnwrapDek` volume for one tenant | Critical — could indicate active bulk decryption abuse |
| A customer reports their own credentials or agent certificate leaked | Medium — contain that specific credential, assess blast radius |

## Procedure

### Step 1 — Contain

Depending on the vector:

```bash
# Revoke a suspected-compromised human session immediately.
curl -s -X POST "https://gateway.bheka.eride.tech/v1/admin/sessions/$SESSION_ID/revoke" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN"

# Revoke a suspected-compromised agent certificate.
curl -s -X POST "https://gateway.bheka.eride.tech/v1/admin/agents/$AGENT_ID/revoke-certificate" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN"

# Revoke a suspected-compromised Vault operator certificate (requires quorum,
# see build-guides/GUIDE-02-Eride-Vault.md section 5 — this is itself a
# policy change).
```

If the suspected compromise is a Vault operator credential specifically,
consider whether the situation meets the bar for
`runbooks/RUNBOOK-04-Vault-Break-Glass.md` to accelerate containment while
the retrospective review captures full accountability afterward.

### Step 2 — Preserve evidence before further action

Do not delete logs, do not restart services that hold relevant in-memory
state, and do not rotate keys yet if key material is itself the suspected
compromise vector — rotating too early can destroy the forensic trail of how
the compromise happened, though it may still be necessary to stop ongoing
harm. Balance these judgement calls with the CISO, not unilaterally.

```bash
# Snapshot the relevant audit_log window for the affected tenant(s) before
# any further system changes.
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/tenants/$TENANT_ID/audit-log?since=$INCIDENT_WINDOW_START" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" > "incident-$INCIDENT_ID-audit-snapshot.json"

# Verify the snapshot against the hash chain independently, per
# build-guides/GUIDE-07-Audit-Log.md section 6.
bheka-audit-verify "incident-$INCIDENT_ID-audit-snapshot.json"
```

### Step 3 — Scope the blast radius

Determine, as precisely as possible:
1. Which tenant(s) are affected.
2. Whether the exposure was ciphertext-only (contained by the encryption
   design per CANON section 6) or included key material or plaintext.
3. The time window of exposure.
4. Whether Tier 3 (full content) evidence was involved — this materially
   changes the sensitivity of the exposed data and the notification
   obligations.

```bash
grpcurl -cacert vault-ca.pem -cert ops.pem -key ops.key \
  -d '{"tenant_id": "'"$TENANT_ID"'"}' \
  vault.internal.eride.tech:8443 eride.vault.v1.VaultService/GetUnwrapAuditHistory
```

(This RPC is not yet defined in `build-guides/GUIDE-02-Eride-Vault.md`'s
proto — flagged as an open item in section 6 below; today, unwrap history
must be reconstructed from `audit_log` entries with `action =
'vault.unwrap_dek'` for the tenant instead.)

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/tenants/$TENANT_ID/audit-log?action=vault.unwrap_dek&since=$INCIDENT_WINDOW_START" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq '.data | length'
```

### Step 4 — Remediate

- If key material may have been exposed: initiate
  `runbooks/RUNBOOK-02-Key-Rotation.md` with `reason:
  "suspected_compromise"`, and if the exposure is severe enough that even
  historical decryption capability under the old key must be foreclosed
  (rare — usually rotation suffices since it does not affect the past),
  consider `runbooks/RUNBOOK-03-Crypto-Shred-A-Tenant.md` only with
  Information Officer and customer sign-off.
- If a specific credential or certificate was the vector: confirm revocation
  from Step 1 propagated and no residual access remains.
- If a platform vulnerability was the root cause: patch it, and treat the
  patch itself with the same rigor as any change (code review, and if it
  touches `bheka-agent`, respect
  `build-guides/GUIDE-09-Agent-Update-Rings.md`'s ring rollout even under
  incident pressure — a rushed, untested fleet-wide agent patch is exactly
  the CrowdStrike-style risk that guide exists to prevent).

### Step 5 — Determine notification obligations (Provisional — confirm with counsel)

POPIA section 22 requires notification to the Information Regulator and
affected data subjects "as soon as reasonably possible" after discovery,
per the [Protection of Personal Information Act 4 of
2013](https://popia.co.za/section-22-notification-of-security-compromises/).
The exact operational SLA (a specific number of hours/days) is not fixed in
the Act's text in the way GDPR's 72-hour rule is, but "as soon as reasonably
possible" has been treated by South African practitioners as demanding
prompt action, not a leisurely internal process — this runbook treats "same
week, ideally within 72 hours of confirming the breach" as the working
target pending attorney confirmation.

Determine:
1. Whether Eride, the customer (as responsible party in most Bheka
   deployments), or both must notify the Information Regulator — this
   depends on the contractual responsible-party/operator allocation, which
   varies by custody tier (CANON section 6) and should be confirmed against
   the specific customer's Data Processing Agreement.
2. Whether affected employees (the ultimate data subjects of the monitoring
   data) must be individually notified, and coordinate with the customer's
   own Information Officer, since Bheka's transparency-by-design posture
   (CANON section 5) makes concealment inappropriate even where not legally
   mandated.
3. Draft notifications using `templates/INCIDENT_REPORT_TEMPLATE.md` as the
   internal record and produce a customer-facing and, if required,
   regulator-facing version with legal review before sending either.

### Step 6 — Post-incident review

Complete a full retrospective within 5 business days of containment,
independent of any break-glass-specific 24-hour review that may also apply.
Feed findings into:
- `templates/THREAT_MODEL_TEMPLATE.md` update if a new threat class was
  discovered.
- `build-guides/` updates if a specific guide's design was the root cause.
- Sprint backlog (`implementation/BACKLOG.md`) for any remediation work.

## Open items

- `eride-vault`'s proto does not yet define a dedicated
  `GetUnwrapAuditHistory` RPC for fast incident-response querying (Step 3
  currently falls back to the generic `audit_log` query). Consider adding
  this as a purpose-built, rate-limited, heavily-audited read RPC in a
  future revision of `build-guides/GUIDE-02-Eride-Vault.md`.
- The precise contractual allocation of POPIA "responsible party" vs
  "operator" roles between Eride and its customers is Provisional pending
  standard Data Processing Agreement language finalisation with counsel.

---

## AI implementation constraints
- Never rotate or shred keys as a reflexive first action before scoping the
  incident — this can destroy forensic value. Contain access first (Step
  1), scope second (Step 3), then remediate (Step 4).
- Never bypass the agent update ring rollout
  (`build-guides/GUIDE-09-Agent-Update-Rings.md`) for an incident patch
  without explicit CISO sign-off that the risk of a rushed fleet-wide push
  is smaller than the risk of leaving the vulnerability open during a
  staged rollout.
- Never send an external or regulator-facing breach notification without
  legal review, even under time pressure.

## Required inputs
- Confirmed or suspected breach signal (from monitoring, a customer report,
  or an internal discovery).
- Access to `audit_log` for the affected tenant(s).
- CISO and, for notification decisions, legal counsel availability.

## Expected outputs
- A preserved, independently-verified audit log snapshot of the incident
  window.
- A scoped understanding of blast radius (tenants, data categories, time
  window).
- A completed `templates/INCIDENT_REPORT_TEMPLATE.md`.
- A notification decision record, even if the decision is "no notification
  legally required," with the reasoning documented.

## Dependencies
- `build-guides/GUIDE-07-Audit-Log.md` (evidence preservation and
  verification tooling).
- `build-guides/GUIDE-02-Eride-Vault.md` (containment actions).
- `runbooks/RUNBOOK-02-Key-Rotation.md`, `runbooks/RUNBOOK-03-Crypto-Shred-A-Tenant.md`
  (remediation options).
- `templates/INCIDENT_REPORT_TEMPLATE.md`.

## Acceptance criteria
- Given a suspected breach, when Step 1 containment actions are taken, then
  the specific credential/certificate/session involved is verifiably revoked
  before any further remediation proceeds.
- Given an audit log snapshot taken during Step 2, when verified with
  `bheka-audit-verify`, then it passes chain and Merkle-root verification
  independent of live database access.
- Given a completed incident, when the post-incident review occurs, then it
  happens within 5 business days of containment regardless of notification
  timeline complexities.

## Test checklist
- [ ] Tabletop exercise run at least twice a year simulating each severity
      tier in the triage table.
- [ ] Session/certificate revocation actions tested to confirm they take
      effect within an acceptable time bound (session: immediate via Redis;
      certificate: immediate for new connections, existing mTLS connections
      may persist until natural expiry unless actively torn down — verify
      which applies in the current implementation).
- [ ] `bheka-audit-verify` exercised against a real incident-window snapshot
      in the tabletop exercise, not just a synthetic test file.
- [ ] Legal review confirmed for the POPIA section 22 timeline assumption in
      section 5 before this runbook is promoted from Provisional to Locked.
