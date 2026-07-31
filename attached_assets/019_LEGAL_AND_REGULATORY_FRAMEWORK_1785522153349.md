---
Document: 019_LEGAL_AND_REGULATORY_FRAMEWORK
Version: 1.0
Status: Provisional
Owner: External attorney (retained) and Information Officer jointly
Last reviewed: 2026-07-31
Depends on: none
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# Legal and regulatory framework

Status note: this entire document is Provisional pending sign-off by a retained South
African labour and privacy attorney, per `CANON.md` section 7 and the open question
recorded in `Eride_security_product_feature_spec_2026-07-31.md` section 7 item 4. Every
statute below is cited to its official or best-available source text. Sections marked
Open within this document are gaps this repository deliberately has not resolved.

## 1. Scope

This document treats, in order: POPIA, RICA section 21 decryption directions, the ECT Act
Chapter V cryptography provider registration, the Cybercrimes Act, Joint Standard 2 of
2024, the DPSA data residency directive, and CCMA/Labour Court admissibility of monitoring
evidence. It is the legal foundation `020_POPIA_CONTROL_MAP.md` maps specific product
controls against.

## 2. POPIA — Protection of Personal Information Act 4 of 2013

Full text: [gov.za, Act 4 of 2013](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf).
POPIA's substantive provisions (sections 2–38, 55–109, 111, 114(1)–(3)) commenced 1 July
2020, with sections 110 and 114(4) commencing 30 June 2021
([Karoo Hoogland Municipality's commencement summary](https://www.karoohoogland.gov.za/wp-content/uploads/2025/06/PAIA-and-POPIA.pdf)).

**The eight conditions for lawful processing (sections 8–25).** Accountability (s8);
processing limitation, including lawfulness and minimality (ss9–12); purpose
specification (ss13–14); further processing limitation (s15); information quality (s16);
openness (ss17–18); security safeguards (s19); and data subject participation (ss23–25).
`020_POPIA_CONTROL_MAP.md` maps each condition to a specific Bheka control.

**Section 10 minimality.** Processing must be adequate, relevant, and not excessive —
collect only what is necessary for the stated purpose. Bheka's tiered visibility model
(`CANON.md` section 4) exists specifically to operationalise this: Tier 1 collects
metadata only, and content-level collection (Tiers 2 and 3) is trigger-bound and
time-boxed rather than continuous.

**Section 11 justification for processing.** Processing is lawful where, among other
grounds, the data subject has consented, it is necessary to conclude or perform a
contract, it is necessary to comply with a legal obligation, it protects a legitimate
interest of the data subject, or it is necessary for the legitimate interests of the
responsible party or a third party
([Department of Labour training materials summarising section 11](https://www.labour.gov.za/DocumentCenter/Publications/Occupational%20Health%20and%20Safety/OHS%20Conference%202023%20-Presentations/POPI%20Act%20Presentation%20Part%202%20%20DAY%203.pdf)).
For workplace monitoring, the employment contract plus a documented legitimate-interest
assessment is the expected basis rather than bare consent, since consent from an employee
is often treated as inherently less voluntary than consent from an independent data
subject. Open: the precise legal basis Bheka should recommend customers rely on
(contract vs. legitimate interest vs. legal obligation) depends on the customer's sector
and is properly an attorney-drafted position in the monitoring policy template pack, not
a product-level decision.

**Section 14 retention limits.** Personal information must not be retained longer than
necessary for the purpose it was collected for, subject to exceptions. Bheka's
crypto-shredding mechanism (`CANON.md` section 6) — destroying a tenant's root key
renders that tenant's evidence permanently unrecoverable, including in backups — is the
technical enforcement mechanism for this condition. Retention schedules are configured
per tenant and per evidence type in the `retention_schedules` table
(see `schemas/database/*.sql`; not restated here per the anti-drift rule).

**Section 19 security safeguards.** The responsible party must secure the integrity and
confidentiality of personal information through appropriate technical and organisational
measures, and must identify reasonably foreseeable internal and external risks. This is
the section the Department of Justice and Constitutional Development was fined for
failing to meet — it had allowed antivirus, SIEM, and intrusion-detection licences to
lapse, and was fined R5 million in 2023 after ignoring the Information Regulator's
enforcement notice
([Deneys Reitz summary](https://www.deneys.co.za/thinking/news/information-regulator-issues-first-fine-department-justice-after-ransomware-attack)).
Bheka's own security posture (encryption at rest and in transit, per-tenant key custody,
Row Level Security, audit logging — see `CANON.md` sections 2, 6, 8, 9) is itself a
section 19 control, since Eride is a responsible party (and, for tenant telemetry, an
operator) under POPIA for the data it processes.

**Section 22 breach notification.** Where there are reasonable grounds to believe
personal information has been accessed or acquired by an unauthorised person, the
responsible party must notify the Information Regulator and affected data subjects as
soon as reasonably possible. Since 1 April 2025, breach notifications, Information
Officer registrations, and related submissions must go through the Information
Regulator's eServices Portal — email submissions are no longer accepted
([RecordingLaw's 2026 POPIA guide](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/south-africa-data-privacy-laws/)).
Bheka's compliance module (feature specification Module F) generates breach notification
drafts pre-populated to this portal format as a product output, not a manual compliance
task.

**Section 55(2) — Information Officer registration.** Information Officers and Deputy
Information Officers must register with the Information Regulator before taking up their
duties
([Information Regulator guidance note](https://inforegulator.org.za/wp-content/uploads/2020/07/InfoRegSA-GuidanceNote-IO-DIO-20210401.pdf)).
This is a compulsory prerequisite, not a best practice, and it is the responsible party's
duty to ensure it happens. Open, tracked in `000_PROJECT_CONSTITUTION.md` section 3:
Eride's own Information Officer must be named and registered before Bheka processes any
live customer telemetry.

**Section 71 — automated decision making.** Treated in full in
`017_AI_AND_ANALYTICS.md` section 7. In summary: a data subject may not be subject to a
decision with legal or substantial effect based solely on automated profiling of
performance, reliability, conduct, or similar attributes
([popia.co.za](https://popia.co.za/section-71-automated-decision-making/)), and where an
exemption applies, the responsible party must provide sufficient information about the
underlying logic to enable representations
([De Rebus](https://www.derebus.org.za/has-popia-adequately-prepared-people-to-exercise-their-right-not-to-be-subject-to-automated-decision-making/)).
Bheka's hard constraint that no model output alone triggers an adverse employment
decision (`017_AI_AND_ANALYTICS.md` section 1) is designed around this section, but the
specific legal conclusion that Bheka's architecture falls outside the "solely automated"
prohibition is Provisional pending attorney confirmation.

**Section 72 — cross-border transfers.** A responsible party may not transfer personal
information to a third party in a foreign country unless the recipient is subject to a
law, binding corporate rules, or agreement providing substantially similar protection to
POPIA, or another listed condition is met
([TenetAI summary of section 72](https://tenetai.dev/blog/south-africa-popia-ai-compliance)).
Bheka's af-south-1 (Cape Town) primary hosting and "data never leaves the continent unless
the customer opts in" commitment (`CANON.md` sections 2, 16) is designed to avoid
triggering section 72 analysis for the default deployment.

**Enforcement record, current as of this document's review date.** The Information
Regulator has issued R5 million infringement notices against the Department of Justice
and Constitutional Development (2023, ransomware-related security-safeguards failure,
under court challenge) and the Department of Basic Education (2024, later set aside by a
full bench on 12 December 2025, with leave to appeal refused 3 June 2026), R500,000
against Blouberg Municipality, and R100,000 each against FT Rams Consulting and Lancet
Laboratories
([Werksmans summary of the Regulator's 2025/26 Annual Performance Plan](https://werksmans.com/south-africas-information-regulator-what-the-2025-26-annual-performance-plan-means-for-business-as-presented-to-the-portfolio-committee-on-5-may-2026/)).
The maximum administrative fine under an infringement notice is R10 million
([Bowmans](https://bowmanslaw.com/insights/south-africa-beware-information-regulator-issues-first-fine-of-zar-5-million-under-popia/)),
and serious offences under section 107(1)(a) — including obstructing the Regulator and
failing to comply with an enforcement notice — carry a fine or imprisonment of up to 10
years, or both
([RecordingLaw](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/south-africa-data-privacy-laws/)).
Note: an earlier version of research consulted for this blueprint flagged an unresolved
conflict — Mordor Intelligence figures cited elsewhere claim 18 enforcement notices
totalling R12 million in 2025, which does not reconcile with the Information Regulator's
own published register. This document relies on the Regulator's own published notices and
established law-firm summaries, not the Mordor figure.

## 3. RICA — Regulation of Interception of Communications and Provision of
Communication-Related Information Act 70 of 2002

**Section 6 — business-purpose interception.** Permits an employer to intercept
communications on its own systems for business purposes only where "the system
controller has made all reasonable efforts to inform in advance" the persons who use the
system that their communications may be intercepted
([PPM Attorneys](https://www.ppmattorneys.co.za/can-employers-monitor-employees-activities/)).
This is the statutory basis for the permanent refusal on hidden agents in `CANON.md`
section 5 and `000_PROJECT_CONSTITUTION.md` section 2 — a covert agent cannot satisfy
"reasonable efforts to inform in advance" by definition.

**Section 21 — decryption directions.** An applicant who has made, or is entitled to
make, an interception-direction application under section 16(1) may apply to a designated
judge for a decryption direction, addressed to a named "decryption key holder"
([SAFLII consolidated RICA text](https://www.saflii.org/za/legis/consol_act/roiocapocia2002943/);
[full RICA text with section 21 and 29 detail](https://www.datanamix.com/wp-content/uploads/2019/08/RICA-Act-70-of-2002.pdf)).
The application must identify the applicant and the decryption key holder, and specify
the decryption key (if known) or the decryption assistance required. A decryption key
holder is "any person who is in possession of a decryption key for purposes of subsequent
decryption of encrypted information relating to indirect communications." Section 21(4)
requires a designated judge to be satisfied that the purpose of the interception direction
would be defeated without the decryption direction, and that it is not reasonably
practicable to obtain the information in intelligible form without one — a meaningful
judicial gate, not an administrative rubber stamp
([RICA Regulations, decryption direction criteria](https://ictpolicyafrica.org/en/document/9mgx1y1zanr?page=31&raw=true&searchTerm=right)).
Section 29 sets out the decryption key holder's compliance obligations once served with a
direction: disclose the key or provide the decryption assistance specified, but disclose
"only such decryption key or decryption assistance which is necessary," to the authorised
person executing the direction, and no other information relating to the customer
([datanamix.com, section 29 text](https://www.datanamix.com/wp-content/uploads/2019/08/RICA-Act-70-of-2002.pdf)).

**Why this drives Bheka's key custody model.** `CANON.md` section 6 defines three key
custody tiers: Eride-managed (Tier A), customer-managed keys (Tier B), and fully
customer-hosted Vault (Tier C), with no global master key. If Eride is ever the
"decryption key holder" for a Tier A tenant, RICA section 21 could in principle compel
Eride to disclose a decryption key or provide decryption assistance for that tenant's
data — never any other tenant's, because per-tenant root keys have no common ancestor.
For customers who cannot accept even that exposure (banks, insurers, government), Tier B
and Tier C exist specifically so that Eride never holds the key at all and cannot be the
addressee of a decryption direction for that tenant's data.

**Open, per CANON section 7:** parts of RICA were declared unconstitutional by the
Constitutional Court in 2021 (in *AmaBhungane Centre for Investigative Journalism v
Minister of Justice*) and the Act has since been the subject of amendment processes. This
document has not independently verified the current consolidated text against those
amendments beyond the SAFLII consolidated version cited above, which is dated 2024. This
is marked Open and requires attorney confirmation of the current operative text before
any customer-facing legal claim about RICA is finalised.

## 4. ECT Act — Electronic Communications and Transactions Act 25 of 2002, Chapter V

Full text: [gov.za, Act 25 of 2002](https://www.gov.za/sites/default/files/gcis_document/201409/a25-02.pdf).
Chapter V requires that "no person may provide cryptography services or cryptography
products in the Republic until the particulars referred to in section 29 in respect of
that person have been recorded in the register." Contravention makes a person "guilty of
an offence and liable on conviction to a fine or to imprisonment for a period not
exceeding two years"
([ECT Act, cited via the build/distribution research](https://www.gov.za/sites/default/files/gcis_document/201409/a25-02.pdf)).
The duty falls on the supplier of the cryptography product, not the end user
([Michalsons](https://www.michalsons.com/blog/cryptography-laws-in-south-africa/3266)).
Registration is maintained by the Department of Communications and Digital Technologies
(DCDT); a 2016 legal commentary notes the Department had licensed approximately 16
cryptography service providers by June 2007
([GoLegal](https://www.golegal.co.za/decrypting-legality-encryption-south-africa/)), and
the same commentary explains the underlying policy rationale: registration lets
investigative authorities identify which organisation supplied encryption technology they
have intercepted, so they can approach that supplier for decryption assistance under
RICA — directly linking Chapter V registration to RICA section 21 decryption directions
described above.

**Bheka's agent is a cryptography product.** It performs hybrid encryption (per-blob DEK
sealed to a tenant public key via HPKE, per `CANON.md` section 2) before any telemetry
leaves the endpoint. This means Eride, as supplier, must register under Chapter V before
supplying the product in South Africa. This is a criminal-offence-avoidance item, not a
discretionary compliance nicety, and it is why it is filed in week 1–2 of the build
timeline (`CANON.md` section 15).

**Open:** the current registration fee and turnaround time could not be confirmed from
any public source consulted for this blueprint. `Eride_build_and_distribution_plan_2026-07-31.md`
Part 9 records the same gap and recommends calling the DCDT directly in week 1. This
remains Open until that call is made and documented.

## 5. Cybercrimes Act 19 of 2020

Full text: [gov.za, Government Gazette 44651](https://www.gov.za/sites/default/files/gcis_document/202106/44651gon324.pdf).

**Section 29 — search warrants.** A police official may only search for, access, or
seize an article (including a computer data storage medium or computer system) under a
warrant issued by a magistrate or High Court judge on written application, based on
reasonable grounds to believe the article is connected to an offence
([Cybercrimes Act, Chapter 4 powers](https://www.gov.za/sites/default/files/gcis_document/202106/44651gon324.pdf)).
This is the statutory basis a law enforcement request for Bheka evidence (rather than a
RICA decryption direction) would most likely proceed under, since Bheka's sealed evidence
is stored data, not intercepted communications in transit.

**Section 39 — prohibition on disclosure.** No person, investigator, police official,
electronic communications service provider, financial institution, or their employee may
disclose information obtained under Chapter 4 or 5 of the Act except in specifically
listed circumstances (necessity for statutory functions, legal requirement, evidence in
court, or information-sharing between listed entities)
([Cybercrimes Act, section 39 text](https://www.gov.za/sites/default/files/gcis_document/202106/44651gon324.pdf)).
This constrains how Eride (and any customer) may handle information received in
connection with a law-enforcement request.

**Section 54's 72-hour incident-reporting duty is currently suspended.** Per
`Eride_security_product_feature_spec_2026-07-31.md` Module F, Bheka's Cybercrimes Act
reporting workflow is built and dormant, ready to activate if and when the relevant
provision commences. This document has not independently re-verified the commencement
status of section 54 beyond that prior research; it is treated as Open pending a fresh
check at build time.

## 6. Joint Standard 2 of 2024 (cybersecurity and cyber resilience)

Issued jointly by the Financial Sector Conduct Authority and Prudential Authority under
the Financial Sector Regulation Act, 2017. The Joint Standard was published on 15–16 May
2024 ([Joint Communication 2 of 2024](https://www.resbank.co.za/content/dam/sarb/publications/prudential-authority/pa-public-awareness/covid-19-response/2024/joint-comms-2-of-2024/Joint%20Communication%202%20of%202024%20-%20Publication%20of%20the%20Joint%20Standard%20-%20Cybersecurity%20and%20cyber%20resilience.pdf))
and its effective date was formally determined as 1 June 2025 by Joint Notice 1 of 2024,
published 26 June 2024
([Joint Notice 1 of 2024](https://www.resbank.co.za/content/dam/sarb/publications/prudential-authority/pa-public-awareness/covid-19-response/2024/joint-comms-5-of-2024/Joint%20Notice%201%20of%202024%20-%20Commencement%20-%20Cybersecurity%20Joint%20Standard.pdf)).
It applies to financial institutions specified in the Standard — in practice, banks,
insurers, financial services providers, and pension funds — and sets requirements for
sound cybersecurity and cyber resilience practices and processes. Bheka's compliance
module maps controls to Joint Standard 2 of 2024 requirements for FSCA and Prudential
Authority reporting (feature specification Module F); the specific control-by-control
mapping is Open pending a documented reading of the Joint Standard's full text against
Bheka's control set, to be completed with counsel before any Joint Standard compliance
claim is made to a financial-services prospect.

## 7. DPSA directive and government data residency

The Department of Public Service and Administration's cloud computing directive states
that government data must reside within South Africa, and where this is not practically
possible, cloud service providers must comply with POPIA section 72 transfer safeguards
([Michalsons summary](https://www.michalsons.com/blog/directive-on-cloud-computing-in-the-public-service-dpsa/55782)).
The 2024 National Policy on Data and Cloud goes further for national-security-related
government data, requiring storage "only in digital infrastructure located within the
borders of South Africa," with penalties reaching 10% of global turnover for
non-compliance
([ITIF](https://itif.org/publications/2025/06/09/south-africa-localization-regulation/)).
Bheka's af-south-1 (Cape Town) primary hosting and on-premise/air-gap deployment option
(`CANON.md` sections 2, 11) are designed to satisfy this directive by default for
government and SOE customers, without requiring section 72 cross-border transfer analysis
for the standard deployment.

## 8. CCMA and Labour Court admissibility of monitoring evidence

**The evidentiary standard is fairness, not strict rules of evidence.** CCMA arbitrations
and internal disciplinary hearings are deliberately less formal than court proceedings.
The Labour Relations Act section 138 gives a commissioner discretion over the manner and
form of proceedings, but the Labour Appeal Court has held that it remains prudent to apply
section 3 of the Law of Evidence Amendment Act 66 of 1995 (governing hearsay) to ensure a
fair process, and failing to make a timeous ruling on admissibility can itself constitute
a gross irregularity (*NUMSA obo Mokase v Nissan and Others*, discussed in
[Werksmans' case summary](https://werksmans.com/evidential-crossroads-navigating-hearsay-evidence-in-ccma-proceedings/)).

**Video, audio, and digital evidence are routinely admitted, but conditionally.**
Practitioner guidance distils the recurring conditions courts and commissioners look for:
the recording must be clear (sharp visuals and audio), authenticated as untampered, shown
to accurately reflect the incident in question, not contradicted by other evidence or
rendered inadmissible hearsay, and not obtained through illegal entrapment
([LabourGuide South Africa](https://labourguide.co.za/general/video-a-audio-surveillance-in-the-workplace)).
Case law is mixed on outcome but consistent on method: video evidence was found relevant
and wrongly excluded in *Afrox Ltd v Laka and Others* (1999); accepted in *Satawu obo
Assagai v Autopax* (2002) despite the employee's lack of awareness of taping, on the basis
the interaction was not confidential; but excluded on review in *Moloko v Commissioner
Diale and Others* (2004) for poor quality; and rejected in *Numsa obo Mbeki and others v
Shatterprufe* (2009) because a supporting witness's testimony was hearsay and contradicted
the tape
([LabourGuide's case summary](https://labourguide.co.za/general/video-a-audio-surveillance-in-the-workplace)).

**Secretly obtained recordings can be admitted, but the bar is fairness and the interests
of justice, not a right to record covertly.** Broader labour-law commentary confirms
secret recordings, including covert audio or video, "may also be admitted if doing so does
not render the proceedings unfair and if it is in the interests of justice," consistent
with Constitutional jurisprudence and the Law of Evidence Amendment Act
([LabourNet](https://www.labournet.com/the-admissibility-of-evidence-in-disciplinary-hearings/)).
This is a narrower and more contingent path to admissibility than Bheka's own design
target: rather than relying on a court's post-hoc fairness balancing of covert evidence,
Bheka's transparent, disclosed, dual-authorised Tier 3 evidence (`CANON.md` section 4) is
built to be admissible on the stronger and more predictable ground of a lawfully obtained,
authenticated, chain-of-custody record.

**Why Bheka's evidence design targets the admissibility conditions directly.** The
feature specification's "court-admissible export pack" (Module E) — a hash-chained
evidence bundle with chain of custody, authorisation records, and integrity attestation —
is built to satisfy the authenticity and non-tampering conditions courts and commissioners
look for, and the transparent, disclosed nature of Tier 3 activation (a stated case
record, two named approvers, a bounded window, and a transparency notice per `CANON.md`
section 4) is built to avoid the fairness objections that have sunk covert evidence in
other cases.

**Onus.** It is worth noting explicitly for product design: the employer bears the full
onus of proving a dismissal was fair
([LabourGuide](https://labourguide.co.za/general/video-a-audio-surveillance-in-the-workplace)).
Bheka's evidence architecture exists to help a customer discharge that onus, not to
create leverage against an employee outside a fair process.

## 9. Summary control table

| Statute / instrument | Key provision | Bheka design response | Status |
|---|---|---|---|
| POPIA | s10 minimality | Tiered visibility model | Locked (product), Provisional (legal sign-off) |
| POPIA | s14 retention | Crypto-shredding, retention schedules | Locked (product), Provisional (legal sign-off) |
| POPIA | s19 security safeguards | Encryption, RLS, audit logging, per-tenant key custody | Locked (product), Provisional (legal sign-off) |
| POPIA | s22 breach notification | Pre-populated eServices Portal drafts | Provisional |
| POPIA | s55(2) Information Officer registration | Eride's own IO to be named and registered | Open |
| POPIA | s71 automated decision making | Hard constraint: no model output alone decides | Provisional, see `017_AI_AND_ANALYTICS.md` |
| POPIA | s72 cross-border transfer | af-south-1 primary, continent-resident default | Locked (product), Provisional (legal sign-off) |
| RICA | s6 business-purpose interception | No hidden agent, transparency notices | Locked (product), Open (current RICA text post-2021 amendment) |
| RICA | s21 decryption directions | Tiered key custody (A/B/C), no global master key | Locked (product), Open (current RICA text) |
| ECT Act | Chapter V cryptography registration | DCDT registration filed week 1–2 | Open (fee/timeline unconfirmed) |
| Cybercrimes Act | s29 search warrants, s39 disclosure | Evidence handling and disclosure procedures | Open (not yet drafted into product policy) |
| Cybercrimes Act | s54 72-hour reporting | Workflow built, dormant pending commencement | Open (commencement status to re-verify) |
| Joint Standard 2 of 2024 | Cybersecurity and cyber resilience | Compliance module control mapping | Open (control-by-control mapping not yet drafted) |
| DPSA directive | Government data residency | af-south-1 primary, on-prem/air-gap option | Locked (product) |
| LRA / CCMA practice | Admissibility of monitoring evidence | Hash-chained evidence export, transparent Tier 3 | Locked (product), Provisional (legal sign-off) |

## AI implementation constraints

- No document in this repository may state a legal conclusion from this document as
  settled fact in customer-facing material until the Provisional or Open marker is
  resolved by the retained attorney.
- Any AI-assisted contract, monitoring policy, or compliance artefact generated by the
  product must be reviewed by the attorney before first customer use; this document does
  not itself constitute legal advice.

## Required inputs

- Attorney engagement letter and completed review of every Provisional and Open item in
  section 9.
- Confirmation of the current RICA text following the 2021 Constitutional Court ruling
  and subsequent amendments.
- DCDT confirmation of ECT Act Chapter V registration fee and turnaround.
- Full-text control mapping against Joint Standard 2 of 2024 before any compliance claim
  is made to a financial-services prospect.

## Expected outputs

- A signed attorney memo covering each Open item in section 9, to be filed alongside this
  document and referenced by an updated Status field once received.
- A named, Information-Regulator-registered Information Officer for Eride Technologies.

## Dependencies

- `017_AI_AND_ANALYTICS.md` for the POPIA section 71 product-level treatment.
- `020_POPIA_CONTROL_MAP.md` for the condition-by-condition control mapping.
- `021_AFRICA_MODULE.md` for the continental regulatory expansion (Nigeria, Kenya, Ghana).

## Acceptance criteria

- Given any statute is cited in this document, when the citation is reviewed, then it
  must link to an official government source, a consolidated legislation database, or a
  named law firm's published legal analysis — never an invented or unverified URL.
- Given an item is marked Open in section 9, when the item is resolved (attorney opinion
  received, registration confirmed, control mapping drafted), then this document's Status
  field must be updated to reflect the reduced number of open items.
- Given a customer asks whether Bheka is "POPIA compliant" or "RICA compliant" in absolute
  terms, when that question is answered, then the answer must reference this document's
  Provisional status and avoid an unqualified compliance claim.

## Test checklist

- [ ] Confirm attorney sign-off obtained and filed for the POPIA section 71 analysis.
- [ ] Confirm the current, amendment-inclusive RICA text has been independently verified
      with counsel before any RICA compliance claim is made.
- [ ] Confirm ECT Act Chapter V registration has been filed and, ideally, confirmed
      before first commercial sale of the agent in South Africa.
- [ ] Confirm a named, registered Information Officer exists for Eride Technologies.
- [ ] Confirm the Joint Standard 2 of 2024 control-by-control mapping is drafted before
      any financial-services sales conversation references it as complete.
- [ ] Confirm this document is re-reviewed at least annually or on any material statutory
      amendment, whichever comes first.
