---
Document: 013_PACKAGING_AND_DISTRIBUTION
Version: 1.0
Status: Locked
Owner: Endpoint engineering lead
Last reviewed: 2026-07-31
Depends on: 011_ENDPOINT_AGENT_DESIGN, 012_AGENT_PLATFORM_MATRIX
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

Status note: the packaging shape (one generic signed installer per platform, tenant config
at install time, MSIX prohibited, update rings) is Locked per CANON section 11. Specific
third-party prices and turnaround times quoted below are current as of the research date and
should be re-verified before budgeting a new fiscal year, since certificate authorities and
Apple change pricing and policy without much notice.

## 1. Scope

This document is the full packaging and distribution specification referenced by CANON
section 11. It reuses facts and source URLs from the packaging research report
(`agent_packaging_distribution.md`) rather than re-deriving them.

## 2. Artifact matrix (Locked, CANON section 11)

| Target | Artifact | Signing |
|---|---|---|
| Windows | `.msi` canonical, thin `.exe` bootstrapper | EV code signing cert on FIPS hardware token |
| Intune | `.intunewin` | inherits MSI signature |
| macOS | `.pkg` | Developer ID Installer, notarized, stapled |
| macOS MDM | signed `.mobileconfig` | pre-approves extensions silently |
| Linux | `.deb` / `.rpm` from private GPG-signed aptly / createrepo repos | GPG |
| On-prem | `.ova` + Docker Compose + Helm chart | GPG-signed checksums |

## 3. Windows: MSI, WiX v7, and why not MSIX

### 3.1 MSI is the canonical artifact

MSI is chosen because it is the only format Windows enterprise deployment tooling
universally accepts: Group Policy Software Installation explicitly cannot install `.exe`
files ("Windows Installer can't install `.exe` files" —
[Microsoft Learn](https://learn.microsoft.com/en-us/training/modules/deploy-applications/6-deploy-applications-group-policy)),
and Intune detection rules are most reliable as "MSI product code + version," removing the
need for a custom detection script
([agent_packaging_distribution.md Topic 4.1](https://learn.microsoft.com/en-us/intune/intune-service/apps/apps-win32-add)).
A thin, signed `.exe` bootstrapper wraps the same MSI for one-line RMM/self-service
installs, mirroring the pattern SentinelOne ships (`SentinelInstaller.msi` plus
`SentinelInstaller-x64....exe`,
[Secure-ISS deployment wiki](https://wiki.secure-iss.com/Public/General/Sentinel-One-Deployment)).

### 3.2 Build tooling: WiX Toolset v7

- WiX v7 uses the Open Source Maintenance Fee (OSMF) EULA v1.1: the fee is owed "only until
  you make at least US$10,000 a year from your projects that use WiX"
  ([WiX docs](https://wixtoolset.org/docs/fourthree/), [FireGiant](https://www.firegiant.com/wixtoolset/)).
  Sponsor tiers reported: **$10/month** under 20 people, **$40/month** for 20–100, **$60/month**
  above 100 ([FOSSED library entry](https://dariusz-wozniak.github.io/fossed/library/wix-toolset)).
  Eride budgets the $10/month tier at v1 team size (CANON section 15: 5-person v1 team).
- v3/v4/v5 are out of community support; only v6+ receives fixes, which is why v7 is
  specified rather than an older major version.
- WiX's own .NET runtime requirement was not confirmed from a fetched source and is marked
  n.a. in the research report; the separate Intune packaging tool (Win32 Content Prep Tool)
  does require **.NET Framework 4.7.2**
  ([GitHub — microsoft-win32-content-prep-tool](https://github.com/microsoft/microsoft-win32-content-prep-tool)).
  Build agents must have this installed regardless of the WiX runtime question.

### 3.3 Tenant configuration: public MSI properties in SecureCustomProperties

CANON is explicit: **one generic signed installer per platform**, with tenant identity
injected at install time via UPPERCASE MSI properties listed in `SecureCustomProperties`:
`TENANT_ID`, `ENROLMENT_TOKEN`, `SERVER_URL`, `TIER`.

- MSI properties must be UPPERCASE to be public and settable from the command line; they
  can be enumerated from the MSI Property table in Orca
  ([PSAppDeployToolkit discussion](https://discourse.psappdeploytoolkit.com/t/trying-to-package-an-msi-file-that-requires-an-additional-customer-code-before-starting/7472)).
- They must additionally be listed in `SecureCustomProperties` so their values survive the
  elevation boundary between the user-mode `msiexec` invocation and the elevated
  installation sequence — otherwise a property set on the command line is silently dropped
  once the installer elevates
  ([Microsoft MSI docs source — SecureCustomProperties](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/Msi/securecustomproperties.md)).
- Real production precedent for this exact pattern: a comparable endpoint agent installed
  via SCCM with `msiexec /i "stepsecurity-dev-machine-guard-<version>-x64.msi" /qn
  CUSTOMERID="acme-corp" APIENDPOINT=... APIKEY=... /l*v`
  ([StepSecurity SCCM docs](https://docs.stepsecurity.io/developer-machines/installation/script/mdm-deployment/windows/microsoft-configuration-manager-sccm)).
- Bheka's install command follows the same shape:

```bat
msiexec /i BhekaAgentSetup.msi /qn /norestart TENANT_ID="<uuid>" ENROLMENT_TOKEN="<token>" SERVER_URL="https://ingest.bheka.example" TIER="baseline" /l*v %TEMP%\bheka-install.log
```

- MSI transforms (`TRANSFORMS="acme.mst"`) are an alternative pattern for customers whose
  tooling prefers an unmodified command line
  ([r/Intune thread](https://www.reddit.com/r/Intune/comments/hlpjqv/win32_msi_deployment_using_transforms_the/))
  but are not the default distribution mechanism; public properties are.

### 3.4 Why MSIX is prohibited

CANON states MSIX is prohibited because "it cannot contain drivers and forecloses v2." The
research report confirms this precisely: "If you have an application that contains a
driver, this cannot be repackaged to MSIX as it is not supported"; even services are
supported only from Windows 10 2004 onward with restrictions and admin elevation
([Advanced Installer — MSIX limitations](https://www.advancedinstaller.com/msix-migration-limitations-and-solutions.html)).
MSIX also installs payload under a fixed
`C:\Program Files\WindowsApps\<package_full_name>` path
([Microsoft Learn — desktop-to-UWP behind the scenes](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)),
which is a poor fit for a service-based endpoint agent that will eventually ship a
minifilter driver in v2. Choosing MSIX now would require a second migration later; MSI is
chosen once and is driver-compatible from day one.

### 3.5 Code signing: the HSM rule

CA/Browser Forum Code Signing Baseline Requirements mandate hardware protection of the
subscriber private key: "Effective June 1, 2023, Subscriber Private Keys … SHALL be
protected … in a Hardware Crypto Module … at least FIPS 140-2 Level 2 or Common Criteria
EAL 4+." Certificates issued before 1 March 2026 may run up to 39 months; from 1 March 2026
the maximum lifetime is 460 days
([CA/B Forum code signing requirements](https://cabforum.org/working-groups/code-signing/requirements/)).
Practical consequence: Eride cannot hold a `.pfx` on a build server; it must use a physical
FIPS token, a cloud HSM, or a signing service.

### 3.6 EV certificate procurement

CANON specifies an EV code signing certificate on a FIPS hardware token, costed at
approximately USD 349 for the certificate plus USD 379 for the token. This matches
SSL.com's published EV pricing: **$349 (1 yr)**, declining to **$149/yr at a 5-year term**,
with a YubiKey FIPS token at **+$379**
([SSL.com EV code signing](https://www.ssl.com/products/software-integrity/code-signing/ev/)).
SSL.com also states plainly that "Microsoft requires an EV code signing certificate for
Windows 10 kernel-mode drivers. No other certificate type qualifies" — relevant once v2
minifilter work begins. Note that since 2024, EV no longer grants instant SmartScreen
reputation (section 3.8).

Alternative CAs for comparison: Sectigo at **$536.25/year** on a five-year term, with a
maximum lifecycle of 459 days from 23 February 2026
([Sectigo](https://www.sectigo.com/ssl-certificates-tls/code-signing)); GlobalSign at
**£245 (OV) / £307 (EV)** for one year via a reseller, noting GlobalSign moved to
one-year-only issuance after 26 December 2025
([TBS reseller price list](https://globalsign.tbs-certificates.co.uk/tarifs_globalsign.html.en),
[GlobalSign](https://www.globalsign.com/en/code-signing-certificate)).

**Can a South African company get an EV certificate?** Yes — EV is issued to Business/
Private Organization entities, and the only geographic restriction in the Baseline
Requirements is a prohibited-country bar on the CA itself, not the subscriber
([CA/B Forum](https://cabforum.org/working-groups/code-signing/requirements/)). Sectigo's
evidence requirements are legal existence, a domain-owned email, and a verified phone
callback ([Sectigo](https://www.sectigo.com/ssl-certificates-tls/code-signing)). Practical
playbook: register a domain mailbox, have CIPC registration documents and a D-U-N-S number
ready (the same D-U-N-S also serves the Apple Developer Program, section 5), and budget
roughly USD 150–350/year for the certificate plus USD 379 for the token, with 3–5 business
days validation including an international phone callback
([SSL.com](https://www.ssl.com/products/software-integrity/code-signing/ev/)).

A locally rooted alternative exists in principle: LAWtrust operates a signing CA under a
published Certification Practice Statement
([LAWtrust CPS PDF](https://www.lawtrust.co.za/wp-content/uploads/2023/11/LT_ISP_SigningCA01_CEN-SSCD_CPS_V007-01-09-2023.pdf)),
but whether LAWtrust certificates chain into the Microsoft Trusted Root Program for
Authenticode is n.a. — not confirmed from any fetched source. Do not plan around LAWtrust
for Authenticode signing until this is verified directly with Microsoft or LAWtrust.

Azure Trusted Signing (rebranded Azure Artifact Signing) is explicitly not viable for
Eride: it requires "a verifiable history of three years or more" for organizations based in
the USA and Canada, it does not cover kernel-mode signing, and "South Africa does not
appear on any eligibility list found" in the research
([Microsoft Learn — Azure Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq),
[quickstart source](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/trusted-signing/quickstart.md)).

### 3.7 Kernel driver signing (v2, forward-looking)

Not required for v1 (CANON: no minifilter in v1), but the chain is documented now so v2
planning is not a surprise:

1. EV certificate (section 3.6) associated with a Windows Partner Center hardware account —
   Microsoft requires this association explicitly
   ([Microsoft Learn — dashboard](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/)).
2. Partner Center company registration fee for South Africa: **700 ZAR**
   ([Account types, locations and fees](https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/apps/publish/partner-center/account-types-locations-and-fees.md)).
3. Attestation signing submissions are typically processed within minutes to five business
   days ("Typically 10 minutes later, the driver is signed by Microsoft" —
   [billauer.se](https://billauer.se/blog/2021/05/windows-drivers-attestation-signing/);
   formal turnaround "processed within five business days" —
   [Create a hardware submission](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/hardware-submission-create)).
4. Attestation signing does not cover Windows Server, which requires full HLK certification
   ("Windows Server 2016 and greater doesn't accept attested device and filter driver
   signing submissions" —
   [Driver signing offerings](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/driver-signing-offerings)).
5. Microsoft is removing trust for cross-signed kernel drivers from **April 2026** — legacy
   cross-signing will no longer be a viable shortcut, so v2 kernel code must go through
   Partner Center regardless
   ([Windows IT Pro blog](https://techcommunity.microsoft.com/blog/windows-itpro-blog/advancing-windows-driver-security-removing-trust-for-the-cross-signed-driver-pro/4504818)).

### 3.8 SmartScreen reputation

EV certificates no longer bypass SmartScreen: "Microsoft removed this behavior in 2024"
([ToDesktop](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore)),
and Microsoft's own documentation states there is "no exact threshold … it can take several
weeks and hundreds of clean installs from a wide audience"
([Microsoft Learn — SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
Unofficial community measurement puts this around 18 days / roughly 430 installs
([koscielniak.pro](https://koscielniak.pro/knowledge/others/Microsoft%20SmartScreen.html)).
This matters little for enterprise sales, since Intune/SCCM/Jamf-pushed installs bypass the
interactive SmartScreen prompt path, but it matters for self-service trial downloads.
Keeping the publisher identity (and certificate subject) stable across renewals preserves
whatever reputation has accrued.

## 4. Intune: `.intunewin`

- Packaged with the Microsoft Win32 Content Prep Tool:
  `IntuneWinAppUtil -c <setup_folder> -s <source_setup_file> -o <output_folder>`, requiring
  .NET Framework 4.7.2 on the build agent
  ([GitHub — microsoft-win32-content-prep-tool](https://github.com/microsoft/microsoft-win32-content-prep-tool)).
- Limits: app size capped at **30 GB** (raised from 8 GB in February 2024), PowerShell
  script upload capped at 50 KB, max 100 dependencies, max 10 updated/replaced apps
  ([Add and assign Win32 apps](https://learn.microsoft.com/en-us/intune/intune-service/apps/apps-win32-add),
  [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1663945/incorrect-win32-max-size-listed-as-8gb-outdated-as)).
  None of these limits are binding for an agent-sized MSI.
- Intune "does not support interactive application installations" at all — every deployed
  application must install silently
  ([Win32 app management](https://learn.microsoft.com/en-us/intune/intune-service/apps/apps-win32-app-management)).
  Bheka's MSI already installs silently via the property-driven command in section 3.3, so
  this constraint requires no special handling.
- Detection rule: MSI product code + version, the least fragile option, avoiding a custom
  detection script per CANON's "one generic installer" philosophy.
- The `.intunewin` artifact inherits the MSI's Authenticode signature; it does not require a
  separate signing step (CANON section 11).

## 5. macOS: `.pkg`, notarization, stapling, and `.mobileconfig`

### 5.1 Build and sign

```bash
# component/distribution package, signed with Developer ID Installer
pkgbuild --root ./payload --identifier com.eride.bheka.agent --version 1.0.0 \
         --sign "Developer ID Installer: Eride Technologies (Pty) Ltd (TEAMID)" BhekaAgent.pkg
# binaries inside are signed with Developer ID Application + hardened runtime

# store credentials once, then notarize
xcrun notarytool store-credentials "AC_PASSWORD" --apple-id ... --team-id ... --password ...
xcrun notarytool submit BhekaAgent.pkg --keychain-profile "AC_PASSWORD" --wait
xcrun notarytool log <submission-id> --keychain-profile "AC_PASSWORD"

# staple and verify
xcrun stapler staple BhekaAgent.pkg
spctl --assess -vv --type install BhekaAgent.pkg
```

Sources for this exact command sequence:
[scriptingosx — notarize a command line tool with notarytool](https://scriptingosx.com/2021/07/notarize-a-command-line-tool-with-notarytool/)
and
[Apple — Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

### 5.2 Notarization turnaround and the 75/day cap

Apple states most submissions complete in "less than an hour," "most software within 5
minutes," and "98 percent within 15 minutes." Critically, there is a hard limit of **75
notarizations per day**, and a ZIP or standalone binary cannot be stapled — only an
installer package or app bundle
([Apple — Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).

This cap is the direct technical justification for CANON's "never per-tenant builds" rule
on macOS specifically: if Bheka built and notarized a unique `.pkg` per tenant, more than 75
new-tenant onboardings (or re-signed updates) in a single day would queue or fail. One
generic signed and notarized installer, with `TENANT_ID`/`ENROLMENT_TOKEN` supplied at
install time via a `.mobileconfig` payload or an enrol script argument, uses exactly one
notarization submission per *release*, not per *customer*.

### 5.3 `.mobileconfig` for MDM pre-approval

CANON: a signed `.mobileconfig` "pre-approves extensions silently." In practice this is a
`systemExtensions.mobileconfig` combining:

- A `SystemExtensions` payload allow-listing Eride's Team ID and the agent's system
  extension bundle IDs, so the Network Extension (v1) and, once granted, Endpoint Security
  (v1.5) extensions load "without user interaction"
  ([Apple — System Extensions payload](https://support.apple.com/guide/deployment/system-extensions-payload-settings-dep5d1584ca4/web),
  [FortiDLP agent deployment guide](https://docs.fortinet.com/document/fortidlp-agent/12.0.0/fortidlp-agent-deployment-guide/813767/bulk-installing-system-extensions-on-macos)).
- A PPPC (`com.apple.TCC.configuration-profile-policy`) payload granting Full Disk Access to
  both the extension and the GUI/status app, on supervised devices
  ([Apple — PPPC payload](https://support.apple.com/guide/deployment/privacy-preferences-policy-control-payload-dep38df53c2a/web)).
- `NonRemovableSystemExtensions` (Jamf Pro 11.9.1+) for tamper resistance on Sequoia and
  later ([Jamf blog](https://www.jamf.com/blog/system-extension-changes-in-sequoia/)).

The profile must itself be signed:
`plutil -lint BhekaAgent.mobileconfig` then
`security cms -S -N "<CertificateName>" -i BhekaAgent.mobileconfig -o BhekaAgent.signed.mobileconfig`
before upload to the customer's MDM
([Defender for Endpoint — manage system extensions using Jamf](https://learn.microsoft.com/en-us/defender-endpoint/manage-sys-extensions-using-jamf)).

Screen Recording is the one permission that cannot be pre-approved this way: the PPPC
payload can only deny it, never grant it silently
([Apple — PPPC payload](https://support.apple.com/guide/deployment/privacy-preferences-policy-control-payload-dep38df53c2a/web),
[ActivTrak](https://support.activtrak.com/hc/en-us/articles/30043256082715-Deploy-the-Agent-on-macOS-Sequoia-and-higher)).
This is disclosed in `012_AGENT_PLATFORM_MATRIX.md` rather than glossed over.

### 5.4 Apple Developer Program and D-U-N-S from South Africa

- Organization membership: **99 USD/year**, requiring a free D-U-N-S number registered to
  the legal entity ([Apple — compare memberships](https://developer.apple.com/support/compare-memberships/)).
- D-U-N-S timing: Apple advises up to 5 business days for D&B plus up to 2 business days for
  Apple to receive it ([Apple — D-U-N-S help](https://developer.apple.com/help/account/membership/D-U-N-S/)).
- South African route: D&B Africa issues a number "within two working days, but it takes
  7-14 days to reflect across the global database"
  ([D&B South Africa](https://southafrica.dnbafrica.org/)). This D-U-N-S filing is on the
  week 1–2 critical path per CANON section 15, alongside the ES entitlement request.

### 5.5 Why platform order is Windows → Linux → macOS

CANON section 11 fixes this order because "Apple ESF entitlement waits are reported at
8–13 months with no status visibility," matching the research report's evidence in
`012_AGENT_PLATFORM_MATRIX.md` section 3 and `011_ENDPOINT_AGENT_DESIGN.md` section 7.2.
Shipping Windows first, Linux second (no comparable third-party approval gate), and macOS
third (starting with the no-approval Network Extension path) lets Eride generate revenue
while the ESF request sits in Apple's queue.

## 6. Linux: `.deb` / `.rpm` from private GPG-signed repositories

### 6.1 Package formats

Both `.deb` and `.rpm` are content-agnostic; neither requires source disclosure, so a
closed-source agent ships normally in either format, each carrying a systemd unit and a
config file seeded from install-time arguments.

### 6.2 APT via aptly

`aptly publish` publishes a snapshot or local repo as a Debian repository servable over
HTTP/FTP/rsync; "GPG key is required to sign any published repository," generated before the
first publish; the public key is exported with `gpg --export --armor`
([aptly publish docs](https://www.aptly.info/doc/aptly/publish/)). A reprepro-based
alternative is documented at
[oneuptime](https://oneuptime.com/blog/post/2026-03-02-setup-private-apt-repository-reprepro-ubuntu/view)
if aptly's operational model proves unsuitable.

### 6.3 YUM/DNF via createrepo

Set `%_gpg_name` in `~/.rpmmacros` to select the signing key, sign the RPMs, generate
metadata with `createrepo`, and produce a detached signature for `repodata/repomd.xml`
(`repomd.xml.asc`). Client repo files must set `gpgcheck=1` and `repo_gpgcheck=1`, with
`gpgkey` pointing at the published public key URL; on older RHEL/CentOS, `pygpgme` must be
present or `yum` silently skips verification
([packagecloud — GPG sign and verify RPM packages and yum repositories](https://blog.packagecloud.io/how-to-gpg-sign-and-verify-rpm-packages-and-yum-repositories/)).
Equivalent DEB verification guidance:
[packagecloud — deb packages and apt repositories](https://blog.packagecloud.io/how-to-gpg-sign-and-verify-deb-packages-and-apt-repositories/).

### 6.4 Per-tenant repository access control

The confirmed mechanism is HTTPS with per-tenant basic-auth credentials embedded in the
client's `.list`/`.repo` file; a vendor-documented implementation of exactly this mechanism
was not found during the research and is marked n.a. Do not present this as a verified
third-party pattern; it is Eride's own design choice pending implementation.

### 6.5 No Secure Boot / MOK enrolment concern

Because CANON rules out an out-of-tree kernel module on Linux, there is no kernel module
signing chain to operate, and no MOK enrolment step is needed at install time (see
`011_ENDPOINT_AGENT_DESIGN.md` section 6 for the eBPF CO-RE rationale and
[Red Hat's documented MOK process](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/managing_monitoring_and_updating_the_kernel/signing-a-kernel-and-modules-for-secure-boot_managing-monitoring-and-updating-the-kernel)
for contrast on what is being avoided).

### 6.6 Ansible/shell as an install channel

Enterprise Linux fleets commonly install security agents via Ansible (`apt_key` →
`apt_repository` → `apt install`), the same pattern published for other agents
([Ansible Forum](https://forum.ansible.com/t/install-wazuh-agent-deb-file-for-linux-target-hosts/38101)).
Bheka publishes an equivalent playbook alongside the repo documentation.

## 7. On-prem / air-gapped: `.ova`, Docker Compose, Helm

- `.ova` is still the expected format for security appliances delivered to banks and
  government; a comparable vendor ships "virtual machine images in OVA file format" with a
  pre-boot checklist covering disk sizing, VM hardware compatibility version, guest OS
  setting, and required outbound network access (DNS, NTP, SMTP)
  ([Holm Security — on-prem installation prerequisites](https://support.holmsecurity.com/knowledge/what-do-i-need-to-prepare-for-the-first-installation-of-onprem)).
- Docker Compose and Helm chart form the second axis: containerized delivery running "in
  AWS, Azure, GCP or your own data center," deployable via Helm for customers already
  running Kubernetes
  ([Curity deployment options](https://curity.io/product/deployment/)), with Docker/Podman
  plus Compose on RHEL/Ubuntu as a documented enterprise-security on-prem baseline
  ([IBM — deploying on-premises components](https://www.ibm.com/docs/en/security-verify?topic=agent-deploying-premises-components)).
- Signing for this artifact class is GPG-signed checksums (CANON section 11), matching the
  same GPG trust chain used for the Linux repositories rather than introducing a fourth
  signing mechanism.
- This is the delivery vehicle for Tier C customer-hosted Eride Vault deployments — see
  `014_DEPLOYMENT_TOPOLOGIES.md`.

## 8. Silent install reference (all platforms)

```bat
:: Windows MSI, per-tenant properties
msiexec /i BhekaAgentSetup.msi /qn /norestart TENANT_ID="acme" ENROLMENT_TOKEN="xxxx" SERVER_URL="https://ingest.bheka.example" TIER="baseline" /l*v %TEMP%\bheka-install.log
:: Windows MSI with a transform
msiexec.exe /i BhekaAgentSetup.msi /qn TRANSFORMS="acme.mst"
```
```bash
# macOS — profiles pushed by MDM beforehand (section 5.3)
sudo installer -pkg BhekaAgent.pkg -target /
# Linux
sudo apt-get install -y bheka-agent && sudo bhekactl enrol --tenant-id=<uuid> --token=<enrolment-token> --server-url=<url>
```

Every platform must install silently by design: Intune "does not support interactive
application installations" at all
([Microsoft Learn](https://learn.microsoft.com/en-us/intune/intune-service/apps/apps-win32-app-management)),
GPSI offers no control over reboot or prompt behaviour
([Microsoft Learn](https://learn.microsoft.com/en-us/training/modules/deploy-applications/6-deploy-applications-group-policy)),
and macOS MDM profiles exist specifically so extensions load "without user interaction"
([FortiDLP](https://docs.fortinet.com/document/fortidlp-agent/12.0.0/fortidlp-agent-deployment-guide/813767/bulk-installing-system-extensions-on-macos)).
Any interactive prompt in Bheka's installer breaks deployment at enterprise scale.

## 9. The tenant-config-at-install-time rule

Restated precisely because it governs every artifact above: Eride builds and signs **one**
installer per platform per release. Tenant identity, enrolment credentials, the ingest
server URL, and the initial visibility tier are never compiled into the binary. They are
supplied at install time as:

- Windows: public MSI properties in `SecureCustomProperties` (section 3.3).
- macOS: values embedded in the `.mobileconfig` payload delivered by the customer's MDM, or
  passed as arguments to a post-install enrol script invoked by `installer`/Jamf/Kandji/
  Mosyle/Workspace ONE policy.
- Linux: arguments to the post-install `bhekactl enrol` invocation (section 8), or
  equivalent Ansible variables.
- On-prem `.ova`: first-boot configuration wizard or a mounted cloud-init/answer file, since
  there is no MDM layer in an air-gapped deployment.

The single technical reason this rule exists, stated once here rather than per platform:
per-tenant binaries would each require an independent code-signing operation, and on macOS
specifically this collides directly with Apple's 75-notarizations-per-day ceiling
([Apple](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).
Windows and Linux have no equivalent hard daily cap, but per-tenant signing on those
platforms would still multiply signing-service cost and audit surface for no benefit, so the
same rule applies uniformly across all three platforms rather than only where forced.

## 10. Update rings (summary; full detail in 023)

CANON section 11 locks an N-1/N-2 ring model modelled on the CrowdStrike Channel File 291
root-cause analysis: Canary (Eride internal) → Ring 0 (1%) → Ring 1 (10%) → Ring 2 (50%) →
Ring 3 (100%), minimum 24-hour soak per ring, automatic halt on crash-rate regression. Full
mechanics, the Channel File 291 lessons, and rollback design are in
`023_RELEASE_AND_UPDATE_STRATEGY.md`; this document only records that `bheka-updater`
consumes the same signed artifacts described above — it does not re-sign or repackage them.

## 11. Cloud marketplace listing (for context, not a v1 blocker)

Not part of the core packaging pipeline, but relevant to how customers discover and procure
signed artifacts: Microsoft Marketplace has no listing cost and a flat 3% transaction fee
([Publisher FAQ](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/marketplace-faq-publisher-guide));
AWS Marketplace charges 3% for a SaaS listing but 20% for a Server/AMI listing
([AWS — listing fees](https://docs.aws.amazon.com/marketplace/latest/userguide/listing-fees.html)).
If Bheka lists on AWS Marketplace, it must list as SaaS, never as an AMI/container product,
to avoid the 20% fee tier.

## 12. What this document does not cover

- Agent internal module structure — `011_ENDPOINT_AGENT_DESIGN.md`.
- Per-platform capability availability — `012_AGENT_PLATFORM_MATRIX.md`.
- Ring rollout mechanics, soak times, halt conditions — `023_RELEASE_AND_UPDATE_STRATEGY.md`.
- Deployment topology and infrastructure — `014_DEPLOYMENT_TOPOLOGIES.md`.

## AI implementation constraints
- Do not implement per-tenant binary builds on any platform; tenant identity is always an
  install-time value, never compiled in.
- Do not implement or propose MSIX packaging; it is prohibited per CANON section 11 and
  section 3.4 of this document.
- Do not sign with a `.pfx` file stored on a build server; signing must go through a FIPS
  hardware token or an equivalent HSM-backed service per section 3.5.
- Do not schedule more than 75 macOS notarization submissions in a rolling 24-hour window
  across all release and hotfix activity combined.

## Required inputs
- Finalized Eride Technologies CIPC registration documents and D-U-N-S number (feeds both
  the EV certificate application and the Apple Developer Program application).
- Choice of EV certificate authority (SSL.com vs Sectigo vs GlobalSign) and confirmation of
  the FIPS token vendor.
- Apple Developer Program Organization enrollment confirmation.
- `bheka-gateway` enrolment token issuance API (referenced in section 3.3 and section 9).

## Expected outputs
- WiX v7 project producing a signed `BhekaAgentSetup.msi` and signed bootstrapper `.exe`.
- Signed and notarized `BhekaAgent.pkg` plus a signed `systemExtensions.mobileconfig`.
- `.deb` and `.rpm` artifacts published to GPG-signed aptly/createrepo repositories.
- `.intunewin` build step producing an artifact from the same signed MSI.
- `.ova` appliance build with Docker Compose and Helm chart for on-prem/air-gapped delivery.

## Dependencies
- CANON section 11 (packaging and distribution, Locked).
- `agent_packaging_distribution.md` research report for all third-party facts cited above.
- Apple Developer Program entitlement process (external, tracked in
  `012_AGENT_PLATFORM_MATRIX.md`).

## Acceptance criteria
- Given a new tenant is onboarded, when their endpoint runs the generic signed MSI/pkg/deb,
  then the correct tenant identity and enrolment token are supplied entirely via install-time
  properties/arguments, with no per-tenant rebuild or re-signing required.
- Given a release is cut, when the macOS `.pkg` is submitted for notarization, then it
  completes as one submission per release artifact, never one per tenant, keeping Eride
  comfortably under the 75/day cap even during a hotfix day.
- Given a customer's Group Policy or Intune tooling deploys the Windows artifact, when the
  install command runs silently with the documented properties, then no interactive prompt
  appears and the MSI product code + version is what Intune's detection rule reports.
- Given a Linux fleet adds Eride's apt/yum repository, when `gpgcheck=1` and
  `repo_gpgcheck=1` are set, then package and repository metadata signatures both verify
  against Eride's published GPG key.

## Test checklist
- [ ] WiX v7 build produces an MSI whose Property table shows `TENANT_ID`,
      `ENROLMENT_TOKEN`, `SERVER_URL`, `TIER` as UPPERCASE public properties present in
      `SecureCustomProperties`.
- [ ] Signed MSI and bootstrapper EXE both verify with `signtool verify /pa` against the EV
      certificate chain.
- [ ] `pkgbuild` output signed with Developer ID Installer passes
      `spctl --assess -vv --type install` after `xcrun stapler staple`.
- [ ] `systemExtensions.mobileconfig` passes `plutil -lint` and validates as signed via
      `security cms -S`.
- [ ] aptly-published repo and createrepo-published repo both fail `apt-get update` /
      `dnf makecache` when the GPG key is swapped for an untrusted one (negative test).
- [ ] `.intunewin` produced by the Win32 Content Prep Tool installs successfully via a test
      Intune tenant with MSI-based detection.
- [ ] `.ova` boots on at least two hypervisors documented as supported and completes
      first-boot tenant configuration without network access.
- [ ] CI enforces a hard fail if a pipeline attempts to build more than 75 macOS
      notarization submissions in a 24-hour window.
