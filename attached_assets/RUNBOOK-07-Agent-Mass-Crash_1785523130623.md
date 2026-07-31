---
Document: 207_RUNBOOK_07_AGENT_MASS_CRASH
Version: 1.0
Status: Locked
Owner: Site Reliability Lead
Last reviewed: 2026-07-31
Depends on: build-guides/GUIDE-09-Agent-Update-Rings.md, build-guides/GUIDE-03-Endpoint-Agent.md
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# RUNBOOK-07: Agent Mass Crash

Purpose: respond to a sudden spike in `bheka-agent` crash rate following a
version rollout, whether caught automatically by the ring-advancement
service (`build-guides/GUIDE-09-Agent-Update-Rings.md`) or discovered
manually. Modeled in spirit on the industry's collective lesson from the
2024 CrowdStrike Falcon content-update incident — see [CrowdStrike's own
remediation and guidance
hub](https://www.crowdstrike.com/en-us/blog/falcon-content-update-remediation-and-guidance-hub/).

## Detection

### Automatic (preferred path)

`build-guides/GUIDE-09-Agent-Update-Rings.md`'s ring advancement service
polls crash rate per ring every 15 minutes and compares it against
`CRASH_RATE_REGRESSION_MULTIPLIER = 2.0` relative to the pre-rollout
baseline. If breached, it automatically halts advancement and marks the
current ring `status = 'halted'` — it does not automatically roll back,
only stops forward progress, since rollback is a more disruptive action
this runbook gates behind human judgement.

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/agent-versions/$VERSION_ID/rollout-status" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq '{ring, status, crash_rate, baseline_crash_rate}'
```

### Manual detection

If crash telemetry is ambiguous or the automatic halt has not yet triggered
but on-call is seeing elevated support volume or alerting from
`bheka-notify`, check directly:

```sql
-- Reference query, actual implementation in
-- build-guides/GUIDE-09-Agent-Update-Rings.md section 3, getCrashRateForRing
select
  toStartOfInterval(observed_at, interval 15 minute) as bucket,
  ring,
  countIf(event_type = 'crash') as crashes,
  countIf(event_type = 'clean_shutdown') as clean_shutdowns,
  countIf(event_type = 'crash') / nullif(count(*), 0) as crash_rate
from events_process
where agent_version_id = {version_id:String}
  and observed_at > now() - interval 6 hour
group by bucket, ring
order by bucket desc;
```

## Procedure

### Step 1 — Confirm the halt (or halt manually if not yet automatic)

```bash
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/agent-versions/$VERSION_ID/rollout-status" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq '.status'
```

If still `advancing` despite clear crash-rate evidence (e.g. the automatic
check has not yet run in its 15-minute cycle), halt manually without
waiting:

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/admin/agent-versions/$VERSION_ID/halt" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"reason": "manual halt - elevated support tickets reporting agent crash loop on Windows 11 23H2", "triggered_by": "oncall-sre-patel"}'
```

Halting stops the ring from advancing to the next percentage tier and stops
issuing this version to any device not already on it — it does not affect
devices that have already updated.

### Step 2 — Assess blast radius

```sql
select ring, count(*) as affected_devices
from agent_ring_assignments
where agent_version_id = {version_id:String}
group by ring;
```

(Table `agent_ring_assignments` is a flagged blocking-dependency schema per
`build-guides/GUIDE-09-Agent-Update-Rings.md` section 6 — until migrated,
derive counts from `events_process` distinct `endpoint_id` per ring instead.)

Cross-reference with the crash-rate query above to determine whether the
issue is universal (all platforms, all device classes) or scoped (e.g. one
Windows build, one hardware vendor, one geographic site with a specific
network profile relevant to CANON section 16's load-shedding/offline
behaviour).

### Step 3 — Triage root cause

Pull crash diagnostics from the affected ring. The agent's clean-shutdown
marker file mechanism (`build-guides/GUIDE-09-Agent-Update-Rings.md`
section 4) distinguishes crashes from expected shutdowns, but does not by
itself explain the cause — check:

```bash
# Aggregate crash signatures if the agent's crash reporter captured a
# panic message or Windows Event Log entry (agent-side crash reporting is
# a section not yet detailed in GUIDE-03 beyond the liveness marker file;
# flagged as an open item for a future GUIDE-03 revision covering
# structured crash-dump capture).
curl -s -X GET "https://gateway.bheka.eride.tech/v1/admin/agent-versions/$VERSION_ID/crash-samples?limit=50" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" | jq '.data[] | {endpoint_id, os, os_version, panic_message}' | sort | uniq -c | sort -rn
```

Common root-cause categories to check first, given the agent's design
(`build-guides/GUIDE-03-Endpoint-Agent.md`):
1. ETW provider registration failure on a specific Windows build.
2. SQLCipher local buffer corruption or disk-full condition on constrained
   devices.
3. A panic in the HPKE sealing path following a key rotation
   (`runbooks/RUNBOOK-02-Key-Rotation.md`) that shipped concurrently with
   the agent version — check whether a rotation and this rollout overlapped
   in time.
4. Resource exhaustion under the zstd level 9 compression path on
   low-spec devices, particularly relevant to the Africa module's
   low-bandwidth/constrained-device profile (CANON section 16).

### Step 4 — Decide: fix-forward or rollback

- If root cause is identified and a fix is fast (same business day) to
  build, test, and re-stage through Canary, prefer fix-forward: build a new
  patch version and re-enter the ring pipeline from Canary, never
  skipping ring stages even for a hotfix.
- If root cause is not quickly identified, or the affected device population
  is significant, or the crash is severe enough to leave endpoints
  unmonitored (a compliance-relevant gap, not just an inconvenience), roll
  back.

### Step 5 — Rollback

```bash
curl -s -X POST "https://gateway.bheka.eride.tech/v1/admin/agent-versions/$VERSION_ID/rollback" \
  -H "Authorization: Bearer $OPS_ADMIN_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "target_version_id": "'"$LAST_KNOWN_GOOD_VERSION_ID"'",
    "scope": "all_affected_rings",
    "reason": "confirmed crash-rate regression, root cause not yet isolated, rolling back to last known good"
  }'
```

This is the `build-guides/GUIDE-09-Agent-Update-Rings.md` manual override
path, but pointed at a lower version than currently active rather than a
resume — same endpoint, different semantics. It requires the
`root_cause_summary` field (minimum 20 characters) per that guide's design,
even when the root cause is not yet fully understood (a working hypothesis
is acceptable; an empty or placeholder string is rejected by the API).

Rollback pushes the last-known-good installer to affected devices through
the same signed-installer channel (`build-guides/GUIDE-03-Endpoint-Agent.md`,
CANON section 11), respecting platform-specific update mechanisms (MSI
reinstall on Windows, package downgrade on Linux/macOS).

### Step 6 — Verify recovery

```sql
select
  toStartOfInterval(observed_at, interval 15 minute) as bucket,
  countIf(event_type = 'crash') / nullif(count(*), 0) as crash_rate
from events_process
where agent_version_id = {rollback_target_version_id:String}
  and observed_at > now() - interval 2 hour
group by bucket
order by bucket desc;
```

Confirm crash rate returns to baseline before considering the incident
contained. Also confirm the 30-day offline-buffer devices
(`build-guides/GUIDE-03-Endpoint-Agent.md` section 4) that missed the
rollback while offline will correctly receive it on next contact rather
than silently staying on the bad version indefinitely — this should be the
default behaviour since rollback republishes the ring assignment, but
verify explicitly with a spot check.

### Step 7 — Customer communication

For any customer whose fleet experienced material crash impact:
1. Notify via the customer's registered channel (email, and for South
   African customers per CANON section 16, WhatsApp Business API for urgent
   operational alerts if configured).
2. State plainly: what happened, which devices/versions were affected,
   what was done (halt, rollback), current status, and whether any
   monitoring coverage gap occurred (directly relevant to the customer's own
   compliance posture if Bheka coverage was down).
3. Do not understate a monitoring coverage gap — if agents were crash-looping
   and therefore not capturing Tier 1 baseline telemetry, that is a
   materially relevant fact for a customer relying on continuous coverage.

### Step 8 — Post-incident review

Within 3 business days: root-cause writeup using
`templates/INCIDENT_REPORT_TEMPLATE.md`, and if the root cause reveals a gap
in pre-rollout testing, update the Canary-stage test matrix in
`build-guides/GUIDE-09-Agent-Update-Rings.md`'s process before the next
release.

---

## AI implementation constraints
- Never resume or advance a halted ring without a `root_cause_summary` of at
  least 20 characters, matching the enforcement already built into
  `build-guides/GUIDE-09-Agent-Update-Rings.md`.
- Never skip ring stages when re-releasing a fix-forward patch — it must
  re-enter at Canary, not resume mid-ring.
- Never assume offline devices are safe from a bad rollout; always verify
  they receive the corrected version on next contact rather than being
  silently excluded from remediation tracking.

## Required inputs
- The affected `agent_version_id` and ring rollout status.
- Crash telemetry from `events_process` for the affected version and time
  window.
- The last-known-good version ID for rollback.

## Expected outputs
- A halted or rolled-back rollout with crash rate confirmed returned to
  baseline.
- A documented root cause (or working hypothesis) recorded on the halt or
  rollback action.
- Customer communication issued for any customer with material impact.

## Dependencies
- `build-guides/GUIDE-09-Agent-Update-Rings.md` (ring mechanics, halt/resume
  API).
- `build-guides/GUIDE-03-Endpoint-Agent.md` (agent internals relevant to
  triage).
- `templates/INCIDENT_REPORT_TEMPLATE.md`.

## Acceptance criteria
- Given a crash-rate regression exceeding 2x baseline in an active ring,
  when the automatic check runs, then the ring halts within one 15-minute
  polling cycle without human intervention.
- Given a halted ring, when a resume or rollback is attempted without a
  root cause summary, then the API rejects the request.
- Given a rollback executed for an active ring, when an offline device
  reconnects after the rollback, then it receives the last-known-good
  version, not the faulty one.

## Test checklist
- [ ] Simulated crash-rate spike in a staging ring to confirm automatic
      halt fires within the expected polling interval.
- [ ] Rollback tested end to end against a staging fleet including at least
      one simulated long-offline device reconnecting post-rollback.
- [ ] Confirm halt/rollback API rejects a missing or too-short
      `root_cause_summary` in a staging call.
- [ ] Customer communication template reviewed by a non-engineering
      stakeholder for clarity before this runbook is relied on live.
