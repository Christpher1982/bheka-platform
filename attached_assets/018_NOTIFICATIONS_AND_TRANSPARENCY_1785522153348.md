---
Document: 018_NOTIFICATIONS_AND_TRANSPARENCY
Version: 1.0
Status: Provisional (notice wording pending attorney-drafted monitoring policy template pack)
Owner: Head of Product, Bheka Compliance
Last reviewed: 2026-07-31
Depends on: 006_VISIBILITY_TIERS.md, 007_RBAC_AND_IDENTITY.md, 005_EVIDENCE_LIFECYCLE.md
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

## 0. Purpose and why this is the differentiator

Every competitor named in `CANON.md` section 0 — Teramind, Veriato, Syteca, DTEX InTrust,
ActivTrak, Microsoft Purview Insider Risk Management — builds its transparency layer, if
it has one at all, around the administrator: the security team sees what was captured, the
monitored employee does not. Bheka inverts this. The permanent refusal against silent
Tier 3 activation (`CANON.md` section 5 item 8) is not satisfied by a clause in a
monitoring policy PDF that employees signed once at onboarding and never see again; it is
satisfied by the surveilled person and the tenant's POPIA Information Officer both being
able to see, on an ongoing basis, that Tier 3 access happened, who did it, and why — not
only the admin who requested it. This document specifies that transparency layer:
multilingual notices, data subject access requests, and the WhatsApp Business API channel
used for admin-side alerting given South Africa's WhatsApp-first operational reality
(`CANON.md` section 16).

Table structures for `transparency_notices`, `data_subject_requests`, and
`consent_records` are Locked in `schemas/database/100_transparency.sql` and are not
restated here per `CANON.md` section 14; this document explains what triggers each
notice, who receives it, in what language, and through what channel, and what the data
subject can do about what they see.

## 1. The core differentiator: dual visibility into Tier 3 access

### 1.1 What the admin sees versus what the data subject sees

An admin (Security Administrator, Investigator, per `007_RBAC_AND_IDENTITY.md`) sees the
full case workflow: the detection, the reason for escalation, the evidence itself once
approved. The data subject — the monitored employee — does not see the evidence content
(that would defeat the purpose of an active investigation and is not what POPIA or RICA
require), but per `transparency_notices` (kind `tier3_activation_notice`, schema in
`schemas/database/100_transparency.sql`) they do see, as a matter of product design and
not case-by-case discretion: that Tier 3 was activated, the stated reason category, the
time window, and — at case conclusion — a `tier3_conclusion_disclosure` notice confirming
the investigation's tier history. This mirrors the case record's dual-authorisation
requirement (`006_VISIBILITY_TIERS.md` section 4.3): if two humans had to approve turning
Tier 3 on, the person Tier 3 was turned on for gets a durable record of that fact, not
merely a promise it happened somewhere in a system they cannot query.

### 1.2 The Information Officer sees what the admin sees, independently

The Information Officer role (`007_RBAC_AND_IDENTITY.md` section 1) receives the same
`tier3_activation_notice` events the data subject does, plus full audit visibility
(`audit_log`, `approvals`, `evidence_access_grants` per the Auditor-equivalent read scope
extended to the Information Officer role in the permission matrix). This is deliberate:
the Information Officer is not merely one of the two required approvers at activation time
(`006_VISIBILITY_TIERS.md` section 5) — they are a standing, independent oversight
recipient of every Tier 3 event for the life of the tenant, so oversight does not depend on
the Information Officer being personally involved in every single case. A tenant's
Security Administrator cannot activate, view, or export Tier 3 material in a way that is
invisible to the Information Officer, and the Information Officer cannot be removed from
this oversight distribution list by any role other than the Tenant Owner, and removing
them requires its own audit trail entry.

### 1.3 Why this only works if delivery is independently verifiable

A transparency notice that the surveilled employee's manager can quietly mark as "sent" in
the admin console without it actually reaching the employee would make the entire
differentiator theatre. `transparency_notices.delivery_status` (per
`100_transparency.sql`) tracks `pending`, `sent`, `delivered`, `acknowledged`,
`delivery_failed`, and `exception_recorded` as distinct states, and delivery failure is
itself surfaced to the Information Officer as an exception requiring follow-up, not
silently dropped. A notice that fails to deliver (bounced email, invalid WhatsApp number)
does not count as having satisfied the transparency obligation; it triggers a
`data_subject_requests`-adjacent workflow to establish an alternate delivery channel.

## 2. Notice types and triggers

Per `transparency_notice_kind` (Locked enum in `100_transparency.sql`):

- **`deployment_notice`**: issued once, at agent enrolment, informing the employee that
  monitoring software has been installed on their managed device, at what baseline tier,
  and where to find the full monitoring policy. This is the RICA section 6 "reasonable
  efforts to inform in advance" mechanism referenced in `000_PROJECT_CONSTITUTION.md`.
- **`tier2_activation_notice`**: issued when a policy rule activates Tier 2 for a bounded
  window (`006_VISIBILITY_TIERS.md` section 2), stating that elevated monitoring is
  active, for how long, and the general category of trigger (not necessarily the specific
  rule internals, which may be sensitive detection logic) — the specific disclosure
  granularity here is Provisional pending legal review of how much rule detail can be
  disclosed without defeating the rule's future effectiveness.
- **`tier3_activation_notice`**: issued at Tier 3 activation per section 1.1, mandatory,
  never suppressed, and — per break-glass handling in
  `004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 7.2 — queued at the moment of break-glass
  invocation, not after retroactive second approval.
- **`tier3_conclusion_disclosure`**: issued at case closure, confirming the investigation
  concluded, its outcome category (substantiated, unsubstantiated, referred to legal —
  mirroring `cases.status` in `schemas/database/070_cases.sql`), and the tier history for
  the case. Full evidentiary detail is not included in this notice; a data subject seeking
  more detail exercises the data subject access request path in section 4.
- **`policy_change_notice`**: issued when the tenant's monitoring policy document
  (referenced by `consent_records.policy_document_version`) changes materially, so
  ongoing consent/acknowledgement remains meaningful rather than static.
- **`breach_notice`**: the POPIA section 22 security compromise notification mechanism.
  POPIA section 22 requires notification to the Information Regulator and affected data
  subjects "as soon as reasonably possible" once there are reasonable grounds to believe
  personal information was accessed or acquired by an unauthorised person, with no
  materiality threshold — even a single affected person must be reported
  ([POPIA section 22](https://popia.co.za/section-22-notification-of-security-compromises/);
  [Information Regulator SCN1 guidelines](https://inforegulator.org.za/wp-content/uploads/2020/07/Guidelines-on-completing-a-Security-Compromise-Notification-ito-Section-22-POPIA.pdf)).
  Bheka's `breach_notice` kind is the tenant-facing half of this obligation (notifying the
  tenant's own employees as data subjects); the tenant's Information Officer remains
  responsible for the separate obligation to notify the Information Regulator itself using
  the Regulator's own SCN1 form, which is outside Bheka's product surface. Because POPIA
  guidance treats 72 hours as the practical benchmark for promptness even though the
  statute itself does not fix a number, Bheka's incident response tooling should default
  to flagging any undispatched `breach_notice` past 72 hours as overdue for Information
  Officer attention; this default is Provisional pending confirmation against
  `019_LEGAL_AND_REGULATORY_FRAMEWORK.md`.

Exception handling: `transparency_notices.is_exception` (per `100_transparency.sql`)
covers the narrow legally-recognised cases where immediate disclosure to the data subject
would be inappropriate (e.g. an active criminal investigation where disclosure would tip
off a suspect before law enforcement can act, echoing the Cybercrimes Act disclosure
prohibitions referenced in `CANON.md` section 7). An exception is never silent: it requires
`exception_reason` and is flagged for Information Officer review, and — critically — an
exception delays disclosure, it does not cancel it; the notice is issued once the
exception condition lapses.

## 3. Multilingual notices

Per `CANON.md` section 16 and the `transparency_notices.locale` check constraint in
`100_transparency.sql`, notices are available in five languages: English (`en-ZA`),
isiZulu (`zu-ZA`), Afrikaans (`af-ZA`), Sesotho (`st-ZA`), and isiXhosa (`xh-ZA`). A
data subject's preferred locale is set at enrolment (defaulting to the tenant's configured
default, typically `en-ZA`) and can be changed by the employee at any time through the
transparency portal referenced in section 5. Every notice references
`wording_version` (per `100_transparency.sql`), pointing to a specific version of the
attorney-drafted notice template pack, so a historical notice remains reproducible in its
original wording even after templates are later revised — this matters for evidentiary
reproducibility in the same way the hash-chained audit log in
`005_EVIDENCE_LIFECYCLE.md` section 5.2 matters: a notice a CCMA commissioner is shown
later must be provably the notice that was actually sent, not a reconstruction from
current templates.

Translation quality and legal accuracy across all five languages, particularly for
POPIA-specific and RICA-specific legal terms that may not have settled equivalents in
Sesotho or isiXhosa legal usage, is Open pending professional legal translation review;
machine translation is not acceptable for a notice whose content may matter in a labour
dispute.

## 4. Data subject access requests

`data_subject_requests` (per `100_transparency.sql`) implements the POPIA-granted rights
of access, correction, deletion/objection, and processing objection. Each request type:

- **`access`**: the data subject requests to know what personal information Bheka holds
  about them for their employer's tenant. Fulfilment surfaces Tier 1/2 metadata summaries
  and the case/notice history (section 1), but not raw Tier 3 evidentiary content of an
  open investigation, consistent with the same disclosure boundary drawn for the
  `tier3_conclusion_disclosure` notice in section 2 — an open investigation's evidence is
  not handed to its subject mid-investigation, though the fact of the investigation and
  its tier history is.
- **`correction`**: the data subject disputes the accuracy of held personal information
  (e.g. an incorrect account attribution). Handled by the Information Officer per
  `007_RBAC_AND_IDENTITY.md` section 2's permission matrix, which restricts the deciding
  role to Information Officer, with HR Partner able to support but not decide.
- **`deletion_objection` / `processing_objection`**: the data subject objects to
  continued processing or requests deletion. Given `CANON.md` section 6's crypto-shredding
  is tenant-root-key-scoped (all-or-nothing per tenant, per
  `004_KEY_CUSTODY_AND_CRYPTOGRAPHY.md` section 6), an individual deletion request is
  fulfilled, where upheld, through the item-level retention-driven deletion path described
  in `005_EVIDENCE_LIFECYCLE.md` section 11, not a full tenant key shred — the distinction
  between these two strengths of "deletion" must be explained to the requesting employee
  in plain language as part of the request response, not left implicit.

`statutory_due_at` (per `100_transparency.sql`) is computed at intake against the
applicable POPIA response window and surfaced on the Information Officer's dashboard for
SLA tracking, so an overdue data subject request is a visible operational failure, not a
silently missed deadline.

## 5. Employee-facing transparency portal

The data subject role (`007_RBAC_AND_IDENTITY.md` section 1) accesses a scoped
self-service portal, distinct from `bheka-console`'s administrative interface, where an
employee can: view their own notice history (section 1 and 2), change their notice
language preference (section 3), submit a data subject access request (section 4), and
review the current monitoring policy document version they have acknowledged
(`consent_records`). This portal is the concrete surface where "the surveilled person...
sees records of Tier 3 access" is not a compliance-document claim but an actual feature a
non-technical employee can log into and use. Portal authentication is scoped to the
employee's own records only — there is no view in this portal, at any permission level,
that exposes another employee's notice history, enforced by the same RLS and tenant
isolation principles as the rest of the platform (`015_TENANCY_AND_ISOLATION.md`).

## 6. WhatsApp Business API admin alerting

Per `CANON.md` section 16, WhatsApp Business API alerting for admins reflects South
African operational reality: WhatsApp is frequently the fastest, most reliable channel to
reach an on-call Security Administrator or Information Officer, more so than email in many
operational contexts. Bheka integrates against the WhatsApp Business Platform
([Meta's WhatsApp Business Platform documentation](https://developers.facebook.com/docs/whatsapp/))
via `bheka-notify` (per `CANON.md` section 3), using the Cloud API (Meta's hosted option,
documented as the preferred integration path over the On-Premises API) to send admin-side
alerts: Tier 3 activation confirmations to approvers, break-glass invocation alerts,
overdue data subject request SLA warnings, and detection alerts above a configured
severity threshold.

WhatsApp Business Platform messaging outside a user-initiated conversation window requires
pre-approved message templates ([WhatsApp Business Platform template requirements](https://developers.facebook.com/docs/whatsapp/)),
so Bheka's admin alert content is designed against Meta's template approval categories
(Utility category for operational alerts, not Marketing) and kept factual and free of
promotional framing, consistent with the tone requirement in `CANON.md` section 17
regardless of the audience being internal admins rather than customers.

WhatsApp alerting is admin-facing only in this document's scope; it is not used as a
transparency-notice delivery channel to the data subject by default, though
`transparency_notices.channel` (per `100_transparency.sql`) does permit `whatsapp` as an
option where a tenant configures it and the employee has opted in, alongside `email`,
`console_portal`, and `printed` (relevant for a workforce segment without reliable email
access — another South African operational reality this schema already anticipates).

## 7. What this document does not cover

- Tier definitions and the escalation state machine that trigger these notices are in
  `006_VISIBILITY_TIERS.md`.
- Role definitions for the Information Officer and other recipients are in
  `007_RBAC_AND_IDENTITY.md`.
- The evidence viewing/export mechanics referenced when explaining what a data subject
  does and does not see are in `005_EVIDENCE_LIFECYCLE.md`.
- `transparency_notices`, `data_subject_requests`, `consent_records` table structures are
  in `schemas/database/100_transparency.sql`.
- The attorney-drafted notice template pack itself (actual wording in all five languages)
  is a legal deliverable tracked outside this engineering document; this document defines
  triggers, recipients, channels, and delivery guarantees, not final notice copy.
- POPIA section 22 Regulator-facing breach notification mechanics (the SCN1 form process)
  are a compliance/legal workstream referenced in `019_LEGAL_AND_REGULATORY_FRAMEWORK.md`,
  not implemented as a Bheka product feature.

## AI implementation constraints

- Do not implement any code path that allows a Tier 3 activation to proceed without a
  corresponding `transparency_notices` row being created in the same transaction or
  workflow step, per `006_VISIBILITY_TIERS.md` section 4.3.
- Do not allow the Information Officer to be removed from the Tier 3 oversight
  distribution for a tenant by any role other than Tenant Owner, and log the removal
  itself to `audit_log`.
- Do not mark a `transparency_notices` row as `sent` without an actual delivery attempt;
  do not implement a "mark as sent" admin override that bypasses the real channel.
- Do not use machine translation as the production source for notice wording in any of
  the five required languages; flag missing professional translations as blocking for
  that language's launch readiness, per section 3.
- Do not send WhatsApp Business Platform messages outside an approved message template
  category for any alert type; unapproved freeform outbound messages outside a
  user-initiated window will be rejected by the platform and must not be silently retried
  in a way that violates Meta's policies.
- Do not implement `deletion_objection` fulfilment as a full tenant key crypto-shred; use
  the item-level retention-driven deletion path and disclose the distinction to the
  requester in the response.

## Required inputs

- Attorney-drafted monitoring policy and notice template pack in all five required
  languages (referenced in front matter as the reason this document is Provisional).
- Professional legal translation review for Sesotho and isiXhosa POPIA/RICA terminology
  (section 3), currently Open.
- Confirmed disclosure granularity for `tier2_activation_notice` rule-trigger detail
  (section 2), currently Provisional pending legal review.
- WhatsApp Business Platform message template approval from Meta for the admin alert
  categories in section 6.
- Confirmation from `019_LEGAL_AND_REGULATORY_FRAMEWORK.md` on the 72-hour breach
  notification operational default (section 2).

## Expected outputs

- `bheka-notify` service implementing notice generation, multilingual template rendering,
  and multi-channel delivery (email, WhatsApp, console portal, printed export).
- Employee-facing transparency portal (section 5) as a distinct, narrowly-scoped
  interface separate from `bheka-console`.
- WhatsApp Business Platform Cloud API integration in `bheka-notify` for admin alerting,
  using approved Utility-category templates.
- Information Officer dashboard surfacing overdue `data_subject_requests` against
  `statutory_due_at` and all Tier 3 activation/break-glass events tenant-wide.
- Data subject access request intake and fulfilment workflow covering all four
  `dsr_type` values.

## Dependencies

- `006_VISIBILITY_TIERS.md` for tier activation events that trigger notices.
- `007_RBAC_AND_IDENTITY.md` for the Information Officer role and portal access scoping.
- `005_EVIDENCE_LIFECYCLE.md` for the evidence-disclosure boundary referenced in section 4.
- `015_TENANCY_AND_ISOLATION.md` for portal tenant/user isolation.
- `schemas/database/100_transparency.sql` for all referenced table structures.
- `019_LEGAL_AND_REGULATORY_FRAMEWORK.md` for POPIA section 22 breach notification
  timing confirmation.

## Acceptance criteria

- Given a Tier 3 activation, when the activation transaction completes, then a
  `tier3_activation_notice` row exists for the data subject and the Information Officer
  receives independent visibility of the same event.
- Given a transparency notice delivery attempt that fails, when the failure is detected,
  then `delivery_status` is set to `delivery_failed` or `exception_recorded`, not silently
  left `pending` indefinitely, and the Information Officer is alerted.
- Given an employee changes their notice language preference in the transparency portal,
  when the next notice is generated, then it is rendered in the newly selected locale.
- Given a data subject access request, when fulfilled, then the response discloses the
  fact and tier history of any investigation involving the requester without disclosing
  open-investigation evidentiary content.
- Given an attempt to remove the Information Officer from Tier 3 oversight distribution
  by a Security Administrator, when attempted, then the system rejects it and only a
  Tenant Owner action succeeds, logged to `audit_log`.
- Given an admin alert is due for a Tier 3 activation, when sent via WhatsApp, then it
  uses an approved Utility-category message template.

## Test checklist

- [ ] End-to-end test confirms Tier 3 activation cannot complete without a corresponding
      transparency notice row in the same workflow.
- [ ] Delivery failure simulation (bounced email, invalid WhatsApp number) confirms
      correct `delivery_status` transition and Information Officer alerting.
- [ ] Locale switching test confirms subsequent notices render in the newly selected
      language for all five supported locales.
- [ ] Data subject access request fulfilment test confirms open-investigation evidentiary
      content is withheld while tier history and case existence are disclosed.
- [ ] Information Officer removal-attempt test confirms only Tenant Owner action succeeds
      and is logged.
- [ ] WhatsApp Business Platform integration test confirms only approved template
      categories are used for outbound admin alerts.
- [ ] Reproducibility test confirms a historical notice renders using its recorded
      `wording_version`, not the current template, after a template revision.
- [ ] Portal isolation test confirms no employee can view another employee's notice
      history or request status.
- [ ] SLA dashboard test confirms `data_subject_requests` past `statutory_due_at` are
      flagged and visible to the Information Officer.
