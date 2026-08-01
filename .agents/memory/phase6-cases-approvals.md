---
name: Phase 6 — Cases, Participants, Approvals API
description: Durable lessons from implementing 009_API_SURFACE §9 (Cases, Participants, Tier Escalations, Approvals).
---

## Routes added in Phase 6

Cases + Participants + Tier Escalations (cases.ts):
- GET /v1/cases — cursor-paginated, optional status filter
- POST /v1/cases — requireRole(security_administrator, investigator), audited
- GET /v1/cases/:caseId
- PATCH /v1/cases/:caseId — requireRole(security_administrator, investigator), audited; sets closedAt/closedByUserId when status → closed
- GET /v1/cases/:caseId/participants
- POST /v1/cases/:caseId/participants — requireRole(security_administrator, investigator), audited
- POST /v1/cases/:caseId/tier-escalations — requireRole + requireStepUp, audited; creates approval rows

Approvals (approvals.ts):
- GET /v1/approvals/:approvalId
- POST /v1/approvals/:approvalId/grant — requireStepUp, audited; only designated approver can act
- POST /v1/approvals/:approvalId/deny — requireSession only (NO step-up), audited; only designated approver

## Tier 3 dual-auth logic in tier-escalations endpoint

- Exactly 2 approvers required, exactly 1 with isInformationOfficer = true
- IO approver is verified to hold popia_information_officer role via roleAssignmentsTable lookup
- Requester cannot be any of the approvers (API layer check mirrors DB CHECK)
- targetTier must be strictly greater than case.currentTier
- expiresAt defaults to 48h, max 168h (1 week)
- Creates one approvals row per approver
- Does NOT update case.currentTier — bheka-case handles that after all grants (NATS TODO)

## Approval grant/deny: only the designated approver can act

Both grant and deny check: approval.approverUserId === req.session.userId
Returns 403 forbidden if the authenticated user is not the designated approver.
This is an API-layer check; the DB CHECK only prevents self-approval at creation time.

## bheka-gateway does NOT emit bheka.case.tier_escalated.v1

This event is produced by bheka-case (separate service) after it observes all
approvals for the tier_escalation subject are granted via bheka.approval.granted.v1.
The gateway must never update case.current_tier directly from the grant endpoint.
**Why:** 009_API_SURFACE §9 AI constraint §4 — tier escalation must remain request-then-approve.
**How to apply:** Any future code touching tier escalation must route through the approval workflow.

## Approval status transitions

- pending → granted: POST /approvals/:id/grant (step-up required)
- pending → denied: POST /approvals/:id/deny (no step-up)
- Expired approvals (expiresAt < now) cannot be granted — return 400
- Already-decided approvals (status != "pending") cannot be acted on — return 400
- No event emitted on denial (bheka.approval.denied.v1 does not exist in 010_EVENT_BUS_AND_TOPICS)

## Event schemas added in Phase 6

bheka.case.opened.v1.json — CASE stream, bheka-case producer.
bheka.case.tier_escalated.v1.json — CASE stream, bheka-case producer; only after ALL grants.
bheka.approval.requested.v1.json — CASE stream, bheka-case producer; one per approval row.
bheka.approval.granted.v1.json — CASE stream, bheka-case producer; on each grant.

## Role names confirmed (from roleNameEnum in users.ts schema)

tenant_owner, security_administrator, investigator, case_approver, popia_information_officer,
hr_partner, auditor, employee, eride_support_engineer.
"case_manager" does NOT exist — use "investigator" for case management operations.
