# Bheka iOS Monitoring Agent

A production-quality iOS monitoring agent for company-owned, MDM-managed devices
(Jamf Pro, Microsoft Intune, or any MDM that supports Managed App Configuration and
supervised-device profiles). It captures periodic screenshots with on-device OCR via
Apple Vision, tracks best-effort app usage sessions, and posts both to the Bheka API —
using the same event envelope as the Android agent.

This app is intended for **supervised, corporately owned devices only**, deployed and
consented to under an internal acceptable-use / monitoring policy. It must never be
side-loaded onto a personal device without the device owner's explicit knowledge and
consent — screen recording on iOS always shows a system-level red status-bar indicator
and cannot be hidden, by Apple's design.

## Why the architecture looks the way it does

iOS's sandboxing model is much stricter than Android's:

- **No keystroke capture from other apps.** There is no iOS equivalent of Android's
  Accessibility Service or InputMethodService that can observe keystrokes typed into
  other apps. Instead, the agent relies on **on-screen OCR text** (via Apple Vision) as
  the closest legal equivalent, sent as `screenshot_capture` events with `ocrText`
  populated. See `OCRProcessor.swift`.
- **No reading another app's process name / bundle ID.** Apple does not expose any
  public API for a third-party app to enumerate what's running in the foreground. This
  is why every `app_usage_session` event uses the constant `processName = "ios-device"`
  and `isBrowser = false` — there is no legitimate way to do better on stock iOS.
- **Screen capture requires either RPScreenRecorder (in-app) or a Broadcast Upload
  Extension (background-capable).** In-app capture (`ScreenCaptureManager.swift`) only
  runs while BhekaAgent is in the foreground. For continuous, background-tolerant
  monitoring, the Broadcast Upload Extension (`BhekaBroadcastExtension/SampleHandler.swift`)
  is the correct architecture — the OS keeps the extension process alive for the
  duration of the broadcast session, independent of whether the host app is
  foregrounded, backgrounded, or not running.

## Project layout

```
mobile/ios/
  README.md                                 This file
  generate_pbxproj.py                       Script that generated project.pbxproj (kept for auditability/regeneration)
  Info.plist                                 Main app Info.plist
  BhekaBroadcastExtension-Info.plist         Extension Info.plist
  BhekaAgent.xcodeproj/
    project.pbxproj                         Xcode project (two targets: BhekaAgent, BhekaBroadcastExtension)
  BhekaAgent/                                Main app target sources
    BhekaAgentApp.swift                     SwiftUI @main entry point + background URLSession delegate bridge
    ContentView.swift                       Enrollment + status UI, RPSystemBroadcastPickerView integration
    Config.swift                            Config read/write, MDM Managed App Config fallback chain
    ApiClient.swift                         Background URLSession API client (main app)
    ScreenCaptureManager.swift              RPScreenRecorder in-app capture coordination
    AppUsageTracker.swift                   UIApplication lifecycle + frame-diff best-effort session tracking
    OCRProcessor.swift                      VNRecognizeTextRequest wrapper
    ImageProcessor.swift                    CMSampleBuffer -> UIImage -> scaled JPEG pipeline
    QRScanner.swift                         AVFoundation QR code enrollment scanner
    BhekaAgent.entitlements                 App Groups entitlement (main app)
    Assets.xcassets/                        App icon + accent color catalogs
    Preview Content/                        SwiftUI preview assets
  BhekaBroadcastExtension/                   Broadcast Upload Extension target sources
    SampleHandler.swift                     RPBroadcastSampleHandler subclass — the background capture engine
    ExtensionApiClient.swift                Minimal, extension-local URLSession client + shared config reader
    BhekaBroadcastExtension.entitlements    App Groups entitlement (extension)
```

## API contract

`POST {BHEKA_API_URL}/api/v1/agent/events`, header `X-Agent-Token: {token}`, JSON body:

```json
{
  "tenantSlug": "eride-technologies",
  "siteId": "<uuid>",
  "subjectUserId": "<uuid>",
  "sourceAgentId": "<uuid>",
  "eventType": "screenshot_capture" | "app_usage_session",
  "occurredAt": "2026-08-04T20:30:00.000Z",
  "metadata": { ... }
}
```

The iOS agent never sends `keystroke_batch` — see the architecture note above.

- `screenshot_capture.metadata`: `{ screenshotImageBase64, ocrText, activeWindowTitle, screenshotWidth, screenshotHeight }`
- `app_usage_session.metadata`: `{ processName: "ios-device", windowTitle, isBrowser: false, startedAt, endedAt, durationSeconds }`

Screenshots are JPEG quality 0.55, max width 1280px, base64-encoded, one frame sampled
every 60 seconds; each 60-second window also produces one `app_usage_session` event.

## Building in Xcode

1. Open `BhekaAgent.xcodeproj` in Xcode 15.2+ (targets iOS 16.0+, Swift 5.9+).
2. **Set the Development Team** on both targets (`BhekaAgent` and
   `BhekaBroadcastExtension`): select each target → *Signing & Capabilities* → set
   *Team* to your Apple Developer account/organization. The generated project file
   ships with an empty `DevelopmentTeam` placeholder — Xcode will prompt you, or you can
   set it via `xcodebuild -allowProvisioningUpdates DEVELOPMENT_TEAM=<TEAMID>`.
3. **Verify/enable App Groups** on both targets under *Signing & Capabilities → + Capability
   → App Groups*. The entitlements files already declare `group.io.bheka.agent`; Xcode
   needs your Team ID to register this App Group ID with Apple (automatic signing
   normally does this for you, but check it explicitly the first time).
4. **Verify Background Modes** on the `BhekaAgent` target: *Signing & Capabilities → +
   Capability → Background Modes* → enable **Background fetch** and **Background
   processing** (already declared in `Info.plist` under `UIBackgroundModes`, but the
   capability toggle in Xcode should also be checked so the entitlement is signed
   correctly).
5. Confirm the **Broadcast Upload Extension** target's *General* settings show
   "Embed in Application: BhekaAgent" — this is wired via the `Embed Foundation
   Extensions` copy-files build phase already present in `project.pbxproj`.
6. Build and run `BhekaAgent` on a real device (ReplayKit's screen recorder and the
   Broadcast Upload Extension **do not work in the iOS Simulator** — you must test on
   physical hardware).
7. If bundle identifiers `io.bheka.agent` / `io.bheka.agent.BhekaBroadcastExtension`
   collide with an existing App ID in your Apple Developer account, change
   `PRODUCT_BUNDLE_IDENTIFIER` for both targets (keep the extension's ID nested under
   the app's ID, e.g. `<your-id>` and `<your-id>.BhekaBroadcastExtension`), and update
   `BroadcastConstants.extensionBundleId` in `ContentView.swift` to match.

### Required capabilities checklist

| Capability | Target(s) | Why |
|---|---|---|
| App Groups (`group.io.bheka.agent`) | BhekaAgent, BhekaBroadcastExtension | Shares config + monitoring status between the app and the extension via UserDefaults |
| Background Modes: Background fetch, Background processing | BhekaAgent | Lets the background `URLSession` (in `ApiClient.swift`) keep uploading after the app is suspended |
| Camera usage (`NSCameraUsageDescription`) | BhekaAgent | QR code enrollment scanner |
| Microphone usage (`NSMicrophoneUsageDescription`) | BhekaAgent | Required string for ReplayKit even though we don't record audio |
| Screen Recording (system, via `RPSystemBroadcastPickerView` / `RPScreenRecorder`) | BhekaAgent, BhekaBroadcastExtension | Core capture mechanism — no separate Xcode capability toggle exists for this; it's implicit in linking ReplayKit and having the Broadcast Upload Extension target |

## App Group setup (manual, one-time, per Apple Developer account)

1. Sign in to the [Apple Developer portal](https://developer.apple.com/account/resources/identifiers/list/applicationGroup).
2. Register an App Group with identifier `group.io.bheka.agent` (or your chosen ID —
   keep it consistent with `ConfigStore.appGroupId` in `Config.swift` and
   `ExtensionConfigStore.appGroupId` in `ExtensionApiClient.swift`).
3. Associate this App Group with both App IDs: `io.bheka.agent` and
   `io.bheka.agent.BhekaBroadcastExtension`.
4. With automatic signing enabled in Xcode, re-adding the App Groups capability in
   *Signing & Capabilities* will usually create/attach this for you — but if you use
   manual provisioning profiles, you must regenerate both profiles after adding the
   group and re-download them in Xcode.

## MDM deployment

### Distributing the app

1. Archive and export an `.ipa` (Product → Archive → Distribute App → "Ad Hoc" or
   "In-House/Enterprise" depending on your Apple Developer Program membership type,
   or upload to Apple Business Manager / your MDM's app catalog for supervised
   in-house distribution).
2. Upload the `.ipa` to your MDM (Jamf Pro: *Computers/Devices → Mobile Device Apps → In
   House App*; Intune: *Apps → iOS/iPadOS → Add → Line-of-business app*).
3. Assign the app to a supervised-device scope/group. Company-owned, supervised devices
   are required for `RPSystemBroadcastPickerView` broadcasts to reliably continue in the
   background without additional user gestures, and for MDM to be able to push Managed
   App Configuration.

### Managed App Configuration (AppConfig) — pushes config without user entry

Push a device configuration profile of type **Application configuration
(`com.apple.app.config` payload)**, or use your MDM's UI for "App Configuration" /
"Managed App Config", targeting bundle ID `io.bheka.agent`, with an `AppConfig`
dictionary matching the keys below. iOS surfaces this to the app via
`UserDefaults(suiteName: "ManagedAppConfiguration")`, which `Config.swift` reads with
priority over manually entered values.

**Raw configuration profile XML template** (for MDMs that accept a raw `.mobileconfig`,
or as a reference for Jamf Pro's/Intune's App Configuration JSON/plist editors):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.app.config</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadIdentifier</key>
            <string>io.bheka.agent.appconfig</string>
            <key>PayloadUUID</key>
            <string>REPLACE-WITH-A-FRESH-UUID</string>
            <key>PayloadDisplayName</key>
            <string>Bheka Agent Managed Configuration</string>
            <key>BundleId</key>
            <string>io.bheka.agent</string>
            <key>ManagedAppConfiguration</key>
            <dict>
                <key>apiUrl</key>
                <string>http://100.87.148.94:8081</string>
                <key>agentToken</key>
                <string>4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac</string>
                <key>tenantSlug</key>
                <string>eride-technologies</string>
                <key>siteId</key>
                <string>REPLACE-WITH-SITE-UUID</string>
                <key>subjectUserId</key>
                <string>REPLACE-WITH-SUBJECT-USER-UUID</string>
                <key>sourceAgentId</key>
                <string>REPLACE-WITH-SOURCE-AGENT-UUID</string>
            </dict>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Bheka Agent Configuration</string>
    <key>PayloadIdentifier</key>
    <string>io.bheka.agent.config.profile</string>
    <key>PayloadRemoveDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>REPLACE-WITH-ANOTHER-FRESH-UUID</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>
```

Generate fresh UUIDs for the two `PayloadUUID` placeholders (e.g. `uuidgen` on macOS/
Linux) — reusing UUIDs across profiles can cause MDMs to treat them as the same
profile and skip re-installation.

- **Jamf Pro**: *Computers/Mobile Devices → Configuration Profiles → App Configuration
  payload* (or upload the raw `.mobileconfig` under *Custom Settings* referencing the
  `io.bheka.agent` bundle ID) — paste the `ManagedAppConfiguration` dictionary keys/values.
- **Microsoft Intune**: *Apps → App configuration policies → Add → Managed devices* →
  target the Bheka Agent app → enter the same keys as JSON or via the property list
  editor.

### Enforcing continuous monitoring on supervised devices

For genuinely continuous, unattended monitoring, combine this app with your MDM's
supervised-device controls:

- Use **Single App Mode** or **Autonomous Single App Mode** sparingly if the
  organization wants to prevent the user from leaving BhekaAgent — note this actively
  conflicts with normal device usability and is rarely appropriate outside kiosk-style
  deployments.
- Rely primarily on the **Broadcast Upload Extension** path (Start Monitoring → system
  broadcast picker → user taps "Start Broadcast") since it tolerates the user leaving
  BhekaAgent and using other apps, unlike in-app-only `RPScreenRecorder` capture, which
  stops the moment BhekaAgent is backgrounded.
- Some MDMs can push a "Lock Screen Message" or use compliance policies to detect and
  alert if the app is not running / broadcast is not active, since iOS provides no API
  for an app to auto-restart a broadcast after a reboot or force-quit — the user (or a
  device compliance nudge) must tap **Start Monitoring** again after these events.

## QR code enrollment

Alternative to MDM AppConfig: scan a QR code encoding the same JSON shape used by the
Android agent:

```json
{
  "apiUrl": "http://100.87.148.94:8081",
  "token": "4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac",
  "tenantSlug": "eride-technologies",
  "siteId": "<uuid>",
  "subjectUserId": "<uuid>",
  "agentId": "<uuid>"
}
```

Tap **Scan QR Code** in the app, grant camera access when prompted, and point the
camera at a QR code encoding the JSON above. The values are written to both standard
`UserDefaults` and the shared App Group container immediately.

## Known iOS platform limitations (by design, not a bug)

- **Screen recording indicator cannot be hidden.** Whenever ReplayKit capture or the
  Broadcast Upload Extension is active, iOS shows a red/orange status bar indicator.
  This is intentional per Apple's privacy model and cannot be suppressed by any API.
- **No process names for `app_usage_session`.** `processName` is always `"ios-device"`
  on iOS — there is no public API to read another app's identity. Treat
  `app_usage_session` events on iOS as coarse-grained "device was actively used"
  signals, not per-app time tracking, and note this asymmetry with the Android agent
  when analyzing combined fleet data.
- **No always-on background capture without user interaction.** The user (or a Shortcut
  Automation triggered by device unlock, if you choose to build one separately) must
  tap "Start Broadcast" at least once per boot/force-quit; iOS does not allow any app to
  silently start screen recording without this explicit, system-owned consent gesture.
- **Simulator cannot test ReplayKit or Broadcast Upload Extensions.** Always test on a
  physical device.

## Canonical source location (there is only ONE copy of this app)

`mobile/ios/` inside this git repository (`bheka-platform`) is the single source of
truth for BhekaAgent and BhekaBroadcastExtension. `.github/workflows/build-ios.yml`
builds directly from this checked-out path via `actions/checkout` and nothing else.

A second, non-git-tracked copy of these same files previously existed on the shared
workspace filesystem at `~/workspace/mobile/ios` (outside any git repository, most
likely left over from unzipping a local snapshot for on-device iteration). Because it
wasn't tracked by git, edits made there silently diverged from this repo and never
reached CI or PR review — a real, repeated source of the "I fixed it but it still
doesn't work on device" confusion during the picker-tap investigation. That path has
been replaced with a symlink pointing at this directory
(`~/workspace/mobile -> bheka-platform/mobile`), so there is now only one real copy of
these files on disk; any tool or person that still navigates to the old path
transparently edits the exact same files tracked here. The stray original was preserved
as a timestamped backup rather than deleted, but should not be used as an editing
location going forward.
