---
Document: 028_ROADMAP_AND_MILESTONES
Version: 1.0
Status: Provisional
Owner: Founder / CEO
Last reviewed: 2026-07-31
Depends on: 019_LEGAL_AND_REGULATORY_FRAMEWORK, 029_HIRING_AND_TEAM
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# Roadmap and milestones

Status note: this roadmap is Provisional. It is a planning hypothesis built from the
research already gathered in this project (in particular
`Eride_build_and_distribution_plan_2026-07-31.md`'s week-by-week plan), not a committed
delivery schedule. Every date is gated on named dependencies, several of which (the Apple
ESF entitlement above all) are outside Eride's control and have historically taken 8–13
months to resolve.

## 1. Weeks 1–2 — regulatory filings before production code exists

Per `CANON.md` section 15, every regulatory application that has a long, externally-
controlled lead time is filed in weeks 1–2, before meaningful product engineering begins,
specifically because these are the items most likely to gate the launch date if started
late.

| Filing | Why it must start immediately | Expected lead time | Source |
|---|---|---|---|
| ECT Act Chapter V cryptography provider registration | Criminal offence to supply a cryptography product in South Africa without it (`019_LEGAL_AND_REGULATORY_FRAMEWORK.md` section 4) | Unconfirmed — Open, must call DCDT directly in week 1 | [Michalsons on ECT Act cryptography registration](https://www.michalsons.com/blog/cryptography-laws-in-south-africa/3266) |
| Apple Developer Program enrolment | Prerequisite for every subsequent Apple step, including the ESF entitlement below | Days to a few weeks typically, but must be the first Apple-related action taken | `Eride_build_and_distribution_plan_2026-07-31.md` |
| Apple Endpoint Security Framework (ESF) entitlement application | Historically the single longest lead-time item in the entire plan | 8–13 months, per prior research already incorporated into this project's build plan | `Eride_build_and_distribution_plan_2026-07-31.md` |
| EV code-signing certificate on FIPS hardware token (SSL.com) | Required for a trusted Windows installer; procurement and identity verification takes real time | Days to a few weeks | `Eride_build_and_distribution_plan_2026-07-31.md` (cost: approximately $349 certificate + $379 token) |
| Microsoft Partner Center enrolment | Required for Intune packaging and any Microsoft marketplace listing | Days to a few weeks | `Eride_build_and_distribution_plan_2026-07-31.md` |
| Eride Information Officer nomination and registration with the Information Regulator | Required under POPIA section 55(2) before any live tenant processing (`019_LEGAL_AND_REGULATORY_FRAMEWORK.md` section 2) | Registration itself is fast; naming and preparing the person is the real lead time | [Information Regulator IO/DIO guidance note](https://inforegulator.org.za/wp-content/uploads/2020/07/InfoRegSA-GuidanceNote-IO-DIO-20210401.pdf) |

The Apple ESF entitlement is the critical-path item for the entire roadmap. Because of
it, macOS is deliberately sequenced last in the platform rollout (`CANON.md` section 11:
Windows → Linux → macOS), and v1 general availability should not be presented externally
as including full macOS Endpoint Security Framework capability unless the entitlement has
already been granted by the time v1 ships.

## 2. Quarter-by-quarter plan to v1 (months 1–6 to 9)

This plan assumes the 5-person team described in `029_HIRING_AND_TEAM.md` is in place by
the start of month 1, which is itself Open pending the Rust hiring constraint discussed
in that document.

**Quarter 1 (months 1–3): foundation and Windows agent.**
- Regulatory filings from section 1 in flight.
- `bheka-agent` Windows ETW user-mode telemetry collection (Tier 1 baseline only), local
  SQLCipher buffer, hybrid X25519+HPKE encryption.
- `bheka-gateway`, `bheka-ingest` backend services accepting encrypted telemetry batches.
- Core data model live: `tenants`, `sites`, `users`, `roles`, `endpoints`, `agents` tables
  (see `schemas/database/*.sql`, referenced not restated).
- Gate to exit Q1: a single internal test tenant (Eride's own environment) running the
  Windows agent end-to-end with Tier 1 telemetry visible in a minimal console.

**Quarter 2 (months 4–6): detection, policy, first design partner.**
- `bheka-policy` risk scoring and anomaly detection (Tier 1 signals only initially).
- `bheka-case` investigation workspace, Tier 2 elevated capture (trigger-based, off by
  default per `CANON.md` section 4).
- Linux eBPF CO-RE agent via libbpf/aya, second platform per the Locked platform order.
- First design partner onboarded — target profile per `001_PRODUCT_VISION.md` section 4:
  a BPO or contact centre operator.
- Gate to exit Q2: first design partner running Tier 1 and Tier 2 in production on
  Windows and Linux endpoints, with a signed monitoring policy and issued transparency
  notices.

**Quarter 3 (months 7–9): compliance module, Tier 3, v1 general availability.**
- `bheka-notify` and the compliance module: breach notification drafting, POPIA control
  map operationalised (`020_POPIA_CONTROL_MAP.md`) against the design partner's real
  tenant, not just in the abstract.
- Tier 3 investigation tooling: dual-authorisation workflow, WebAuthn step-up, hash-
  chained evidence export.
- Second and third design partners onboarded (target: three total before v1 GA, per the
  feature specification's success metrics).
- Windows and Linux agents hardened and ring-deployed (Canary → Ring0 → Ring1 → Ring2 →
  Ring3, per `CANON.md` section 11).
- v1 general availability: Windows and Linux only. macOS availability depends entirely on
  ESF entitlement status (section 1) and is not committed for the v1 GA date if the
  entitlement has not yet been granted.

**Gate discipline.** No quarter's exit gate is a date; it is a named, testable condition
(a design partner running in production, a specific workflow operating end-to-end). If a
gate is not met, the roadmap slips rather than shipping an unfinished gate as done. This
is consistent with `000_PROJECT_CONSTITUTION.md`'s definition of done.

## 3. Path to v2 (months 10–18, indicative)

Provisional and lower-confidence than the v1 plan above, since it depends on v1 outcomes
not yet known.

- **macOS agent**, gated entirely on the Apple ESF entitlement (section 1). If the
  entitlement has not arrived by month 9, this becomes the first item of v2 rather than
  part of v1.
- **DLP module**: structured data fingerprinting with South African identifier
  recognisers (SA ID number, bank and branch codes, SARS tax reference numbers), an area
  where the competitive research in `Teramind_assessment_and_build_thesis_2026-07-31.md`
  found every major competitor except Microsoft Purview weak or absent.
- **SITA OEM certification process**, begun once the product has a stable v1 track record
  to certify, targeting the public-sector tertiary segment in `001_PRODUCT_VISION.md`
  section 4.
- **Nigeria compliance module**, gated on a confirmed design partner or pipeline
  opportunity per `021_AFRICA_MODULE.md` section 6 — not started speculatively.
- **SOC 2 Type II and/or ISO 27001 certification**, targeting the regulated financial-
  services segment's procurement requirements, cost estimated at $25,000–$80,000 for SOC
  2 and $15,000–$50,000 for ISO 27001 per the certification cost research in
  `Teramind_assessment_and_build_thesis_2026-07-31.md`.
- **Customer-managed key (Tier B) and customer-hosted Vault (Tier C) general
  availability**, gated on at least one design partner in the bank/insurer/listed-company
  segment requiring it (`CANON.md` section 6).

## 4. Named dependencies and gates (consolidated)

| Milestone | Gated on | Risk if not resolved |
|---|---|---|
| Any live tenant processing real employee data | ECT Act Chapter V registration confirmed, Eride Information Officer registered | Criminal offence exposure and POPIA non-compliance; see `030_RISK_REGISTER.md` |
| macOS agent availability (v1 or v2) | Apple ESF entitlement granted | Platform gap versus competitors who already support macOS; see `030_RISK_REGISTER.md` |
| v1 general availability | Three design partners running in production, Tier 1–3 workflows operating end-to-end | Premature GA claim damages credibility with compliance-literate buyers |
| Financial services segment sales | Joint Standard 2 of 2024 control mapping completed with counsel (`019_LEGAL_AND_REGULATORY_FRAMEWORK.md` section 6) | Cannot credibly claim Joint Standard readiness without it |
| Government/SOE segment sales | SITA OEM certification | Structurally excluded from public-sector procurement without it |
| Nigeria/Kenya/Ghana expansion | Confirmed design partner or pipeline opportunity in that country | Wasted engineering effort on speculative compliance modules |
| Team fully staffed for v1 | Rust hiring constraint resolved (`029_HIRING_AND_TEAM.md`) | Slips the entire Q1–Q3 plan; agent development is the critical path |

## AI implementation constraints

- Do not present any quarter's exit gate as met unless the named, testable condition
  (not just a date passing) has actually occurred.
- Do not present v1 general availability as including macOS Endpoint Security Framework
  capability unless the Apple entitlement has been confirmed granted at that point.

## Required inputs

- Confirmed team composition per `029_HIRING_AND_TEAM.md` before month 1 begins.
- Design partner commitments (target: three before v1 GA).
- Apple ESF entitlement status, checked monthly from the date of application.

## Expected outputs

- A quarterly roadmap review that updates this document's gates based on actual, not
  planned, progress.
- An explicit go/no-go decision on macOS inclusion in v1 GA no later than month 8.

## Dependencies

- `029_HIRING_AND_TEAM.md` for the team composition this plan assumes.
- `019_LEGAL_AND_REGULATORY_FRAMEWORK.md` for the regulatory filings in section 1.
- `030_RISK_REGISTER.md` for the risk scoring of each named dependency.

## Acceptance criteria

- Given a quarter's exit gate, when it is reviewed, then it must be assessed against the
  named testable condition, not the calendar date alone.
- Given the Apple ESF entitlement has not been granted by month 8, when v1 GA scope is
  finalised, then macOS must be explicitly excluded from the v1 GA announcement.
- Given a design partner has not been onboarded by the end of a quarter's target, when
  the roadmap is reviewed, then the subsequent quarter's plan must be explicitly revised,
  not silently assumed to still be on track.

## Test checklist

- [ ] Confirm ECT Act Chapter V registration status is checked and documented at the end
      of week 2.
- [ ] Confirm Apple ESF entitlement application is submitted in week 1–2 and its status
      is reviewed monthly thereafter.
- [ ] Confirm each quarter's exit gate is assessed against its named testable condition
      before the next quarter's plan is finalised.
- [ ] Confirm no country-specific compliance module work begins without a named design
      partner or pipeline opportunity, per `021_AFRICA_MODULE.md` section 6.
- [ ] Confirm the v1 GA announcement explicitly states macOS availability status rather
      than implying full three-platform parity if the ESF entitlement is still pending.
