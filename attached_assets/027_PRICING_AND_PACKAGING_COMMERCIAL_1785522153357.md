---
Document: 027_PRICING_AND_PACKAGING_COMMERCIAL
Version: 1.0
Status: Provisional
Owner: Founder / CEO
Last reviewed: 2026-07-31
Depends on: 001_PRODUCT_VISION, 019_LEGAL_AND_REGULATORY_FRAMEWORK
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# Pricing, packaging and commercial model

Status note: the tier prices below are Locked as a starting point per `CANON.md` section
15, but the unit-economics figures are Provisional until validated against real
infrastructure cost at production scale with a first cohort of paying tenants.

## 1. Tiering

| Tier | Price (ZAR/user/month) | Target buyer | Included |
|---|---|---|---|
| Essential | R180 | SME, price-sensitive BPO seats | Tier 1 baseline telemetry, basic anomaly detection, standard reporting |
| Professional | R280 | Mid-market, financial services entry point | Essential plus Tier 2 elevated capture, risk scoring, investigation workspace |
| Enterprise | R350 | Regulated financial services, larger BPO estates | Professional plus Tier 3 investigation tooling, dual-authorisation workflow, court-admissible evidence export, compliance module |
| Government | Custom, on-prem | Public sector, SOEs | Enterprise feature set delivered via `.ova`/on-prem, subject to SITA OEM certification (`001_PRODUCT_VISION.md` section 3) |

This structure mirrors the packaging already defined in
`Eride_security_product_feature_spec_2026-07-31.md`. It is priced and billed in ZAR by
default, consistent with the Locked Africa module commitment in `CANON.md` section 16 and
`021_AFRICA_MODULE.md` section 1 — no forced USD billing.

## 2. Competitor price comparison

| Vendor | Published price | Source | Currency/billing note |
|---|---|---|---|
| Teramind | Not published on Teramind's own site; third-party trackers list roughly $15 (Starter), $30 (UAM), $35 (DLP) per seat/month | [teramind.co pricing page](https://www.teramind.co/services/price/); [G2 pricing summary](https://www.g2.com/products/teramind/pricing) | USD only, no published ZAR option |
| Veriato | $15/user/month, published, 5-seat minimum | [Veriato pricing](https://veriato.com/pricing/) | USD only |
| Syteca | Not published | n.a. — quote-only per prior research in `Teramind_assessment_and_build_thesis_2026-07-31.md` | n.a. |
| DTEX InTERCEPT | Not published | n.a. — quote-only per prior research | n.a. |
| ActivTrak | $10–$17/user/month published range | [ActivTrak pricing](https://www.activtrak.com/pricing/) | USD only |
| Microsoft Purview IRM (bundled in M365 E5 Compliance) | Approximately $144/user/year standalone E5 Compliance add-on (roughly $12/user/month equivalent); Teramind DLP comparably priced around $420/user/year in the same analysis | [Microsoft Purview IRM licensing analysis](https://microsoftnegotiations.com/blog/purview-insider-risk-management-licensing) | USD, enterprise agreement billing |
| Bheka | R180–R350/user/month (approximately $10–$19/user/month at indicative exchange rates, not a currency peg) | This document | ZAR native, local payment rails |

Two things follow from this table. First, Bheka's rand pricing is broadly competitive in
USD-equivalent terms with the Essential and Professional tiers against Teramind, Veriato,
and ActivTrak — the pricing gap is not the primary risk. Second, Microsoft Purview IRM's
bundled economics inside an E5 agreement a large enterprise has often already purchased
means Bheka cannot win a deal on price against Microsoft for a customer already on E5;
the wedge there is data residency, SITA eligibility, and compliance-artefact generation,
as set out in `001_PRODUCT_VISION.md` section 5, not price.

## 3. Unit economics

Provisional — the figures below are estimates built from the infrastructure and salary
research already gathered for this project, not audited financials.

**Cost to serve per seat, primary cost drivers:**

- **Cloud infrastructure (af-south-1 primary).** AWS's Cape Town region carries an
  estimated 19.9% premium over the cheapest available AWS region for comparable compute
  and storage, per the figure already established in `CANON.md` section 15 and
  `Eride_build_and_distribution_plan_2026-07-31.md`. This premium is treated as the cost
  of data residency and is passed through to the customer rather than absorbed, since it
  is a direct, attributable, and defensible cost — not a margin-reducing inefficiency to
  hide.
- **ClickHouse and PostgreSQL storage for telemetry and case evidence**, scaling with
  seat count and, more significantly, with the visibility tier active for each seat
  (Tier 3 investigation-window content capture is materially larger than Tier 1
  metadata-only telemetry).
- **NATS JetStream and Redis/Valkey for the event bus and caching layer**, a comparatively
  small and largely fixed cost that does not scale linearly per seat.
- **S3-compatible storage with Object Lock in COMPLIANCE mode** for sealed evidence,
  which is deliberately immutable and therefore accumulates rather than being
  garbage-collected, making retention-schedule design (`020_POPIA_CONTROL_MAP.md` section
  4) a direct cost lever, not just a compliance one — the sooner data can be lawfully and
  contractually destroyed, the lower the long-run storage cost.
- **Certificate and code-signing costs**, a small fixed cost amortised across the whole
  customer base rather than a per-seat cost: an EV code-signing certificate on a FIPS
  token from SSL.com runs approximately $349 for the certificate plus $379 for a
  compliant token (figures already sourced in
  `Eride_build_and_distribution_plan_2026-07-31.md`), a one-time or infrequent cost, not
  recurring per seat.
- **Support and account management headcount**, allocated per seat based on the 5-person
  v1 team structure in `029_HIRING_AND_TEAM.md`.

**What is not yet known and must be treated as Open until measured:** actual ClickHouse
storage growth rate per seat per visibility tier, actual egress costs for evidence export
and offline-buffer catch-up after connectivity restoration (relevant given
`021_AFRICA_MODULE.md` section 1's load-shedding and low-bandwidth design), and actual
support-ticket volume per seat at scale. Modelling a specific rand cost-per-seat figure
before these are measured against a real cohort would be inventing false precision, which
CANON section 17 and this task's brief both explicitly instruct against.

**Gross margin implication.** At R180–R350 per seat per month with an af-south-1 premium
absorbed into cost but not fully passed through at the Essential tier, the Essential tier
is deliberately a lower-margin, volume/beachhead tier (BPO seats, high count, price
sensitivity per `001_PRODUCT_VISION.md` section 4), while Enterprise and Government tiers
carry the compliance-module and Tier 3 investigation tooling that justifies materially
higher effective margin per seat. This is a hypothesis for the pricing committee to
revisit once real cohort data exists, not a modelled certainty.

## 4. Billing mechanics

- **ZAR native billing**, no currency conversion presented to the customer, consistent
  with `CANON.md` section 16.
- **Local payment rails** in addition to card payment, to avoid excluding South African
  SME buyers who may not hold a corporate card suitable for recurring international
  billing (even though billing is ZAR, the payment processor and rail selection still
  matters for SME accessibility).
- **Annual and monthly billing options**, with the specific discount structure for annual
  commitment left to the pricing committee and not fixed in this document.
- **No per-tenant custom pricing below Enterprise tier**, to keep the sales motion
  simple for the BPO and mid-market beachhead segments, consistent with the
  self-service-leaning motion implied by publishing prices openly (a point of contrast
  with Teramind, Syteca, and DTEX, none of which publish enterprise pricing).

## 5. Open pricing questions

- Whether a per-site or per-endpoint volume discount structure is needed for large BPO
  deployments (hundreds to thousands of seats at a single site) — Open, pending the first
  BPO design-partner conversation.
- Whether Government tier custom pricing should be published as a reference range once a
  SITA OEM-certified price list becomes a procurement requirement — Open.
- Whether af-south-1's specific premium percentage should be re-verified against current
  AWS pricing before being used in any customer-facing unit-economics conversation, since
  cloud pricing changes over time — Open, and the 19.9% figure should be treated as
  time-bound to when it was originally sourced, not a permanent constant.

## AI implementation constraints

- Do not present the unit-economics figures in section 3 as audited or precise; they are
  modelling inputs pending real cohort data.
- Do not quote a specific rand cost-per-seat figure externally (to investors or
  customers) without first flagging it as Provisional per this document's status.

## Required inputs

- Actual infrastructure billing data from the first production cohort (target: after 90
  days of live tenant operation) to replace the Provisional unit-economics estimates.
- Confirmed AWS af-south-1 pricing premium at time of any external unit-economics
  presentation, re-verified rather than reused from this document indefinitely.

## Expected outputs

- A refreshed version of section 3 with measured (not estimated) cost-to-serve figures
  after the first production cohort.
- A pricing committee decision on the open questions in section 5 before the Enterprise
  or Government tier is sold to a first customer.

## Dependencies

- `001_PRODUCT_VISION.md` for the competitive positioning this pricing responds to.
- `029_HIRING_AND_TEAM.md` for the support headcount cost allocated per seat.
- `019_LEGAL_AND_REGULATORY_FRAMEWORK.md` for the data-residency requirement driving the
  af-south-1 premium.

## Acceptance criteria

- Given a competitor's price is cited in section 2, when the citation is reviewed, then
  it must link to that competitor's own published pricing page or a specific third-party
  pricing tracker, not a recalled figure.
- Given the unit-economics section is used in an investor or board conversation, when it
  is presented, then it must be presented as Provisional pending real cohort data, not as
  an audited figure.
- Given a customer is billed, when the invoice is generated, then it must be denominated
  in ZAR with no forced USD conversion.

## Test checklist

- [ ] Confirm ZAR billing is enforced end-to-end in the billing system with no USD
      fallback for South African tenants.
- [ ] Confirm at least one local payment rail is integrated and tested before first
      commercial invoice.
- [ ] Confirm the af-south-1 cost premium figure is re-verified against current AWS
      pricing before any external unit-economics presentation.
- [ ] Confirm real cohort cost-to-serve data is captured starting from the first
      production tenant, to replace the Provisional estimates in section 3 within 90
      days of go-live.
- [ ] Confirm the pricing committee has explicitly decided the open questions in section
      5 before any Enterprise or Government tier sale closes.
