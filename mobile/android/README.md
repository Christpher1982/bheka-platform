# Bheka Android Monitoring Agent

A Kotlin Android app for company-owned devices enrolled via MDM (Device
Owner mode) that continuously reports keystroke activity, periodic
screenshots (with on-device OCR), and app-usage sessions to the Bheka API.

## Project layout

```
mobile/android/
  build.gradle.kts                     # root Gradle config
  settings.gradle.kts
  gradle/wrapper/gradle-wrapper.properties
  app/
    build.gradle.kts                   # module config, dependencies
    proguard-rules.pro
    src/main/
      AndroidManifest.xml
      kotlin/io/bheka/agent/
        BhekaApplication.kt            # app entry point, MDM config refresh
        MainActivity.kt                # enrollment UI + permission flow
        BhekaAccessibilityService.kt   # keystroke/text capture
        BhekaMonitoringService.kt      # foreground service orchestrator
        ScreenshotManager.kt           # MediaProjection capture + OCR
        AppUsageTracker.kt             # foreground-app polling
        BootReceiver.kt                # restart after reboot
        ApiClient.kt                   # OkHttp POST to Bheka API
        Config.kt                      # SharedPreferences + MDM config
        Utils.kt                       # shared constants/helpers
      res/
        layout/activity_main.xml
        values/{strings,colors,themes}.xml
        xml/accessibility_service_config.xml
        drawable/{ic_notification,ic_launcher_foreground}.xml
        mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml
```

## Build instructions

Requirements: JDK 17, Android SDK (compileSdk 34 / build-tools 34.x), and
network access to Google's Maven repo for ML Kit / AndroidX / OkHttp / zxing.

```bash
cd mobile/android

# Debug build (unsigned, installable via adb):
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk

# Release build (requires a signing config for distribution):
./gradlew assembleRelease

# Install directly to a connected/enrolled device:
./gradlew installDebug
```

The Gradle wrapper JAR itself (`gradle/wrapper/gradle-wrapper.jar`) is not
checked in here — generate it locally with `gradle wrapper --gradle-version 8.7`
if it's missing, or open the project in Android Studio, which bootstraps it
automatically.

`minSdk` is 26 (Android 8.0) and `targetSdk` is 34.

## Permissions to grant manually after install

Some permissions cannot be granted silently even by a Device Owner app and
require either a one-time user tap or an EMM policy that pre-grants them:

| Permission | Why it's needed | How to grant |
|---|---|---|
| Accessibility Service | Captures keystroke/text-field activity | Settings → Accessibility → Bheka Monitoring Agent → On (or push via Device Owner's `setPermittedAccessibilityServices` + silent enable where the EMM supports it) |
| Usage Access (`PACKAGE_USAGE_STATS`) | Detects the foreground app for `app_usage_session` events | Settings → Apps → Special access → Usage access → Bheka Monitoring Agent → Allow (Device Owners can grant this silently via `DevicePolicyManager` on Android 10+, package `io.bheka.agent`) |
| Screen capture (MediaProjection) | Enables periodic screenshots | One-time system consent dialog per boot session — the app prompts automatically via `MediaProjectionRequestActivity`; Device Owner apps on Android 12+ can pre-approve their own MediaProjection requests via `DevicePolicyManager.setUserControlDisabledPackages` combined with the projection consent being requested from a foreground app they control |
| Notifications (`POST_NOTIFICATIONS`) | Shows the persistent "Bheka is active" status notification (Android 13+) | Requested automatically on first launch; can be pre-granted by MDM as a runtime-granted permission in the enterprise policy |
| Camera | Only needed if using QR-code enrollment | Requested automatically when tapping "Scan Enrollment QR Code" |

All other permissions (`INTERNET`, `FOREGROUND_SERVICE`,
`RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`) are normal/install-time permissions
and require no user action.

## MDM AppConfig schema

The app reads configuration from SharedPreferences keys that map 1:1 to an
EMM "Managed App Configuration" (Android `RestrictionsManager`) bundle. Push
the following key/value pairs from your MDM console for `io.bheka.agent`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<managed-configurations>
    <restriction
        android:key="BHEKA_API_URL"
        android:restrictionType="string"
        android:title="Bheka API URL"
        android:defaultValue="http://100.87.148.94:8081" />

    <restriction
        android:key="BHEKA_AGENT_TOKEN"
        android:restrictionType="string"
        android:title="Bheka Agent Token"
        android:defaultValue="" />

    <restriction
        android:key="BHEKA_TENANT_SLUG"
        android:restrictionType="string"
        android:title="Bheka Tenant Slug"
        android:defaultValue="eride-technologies" />

    <restriction
        android:key="BHEKA_SITE_ID"
        android:restrictionType="string"
        android:title="Bheka Site ID (UUID)"
        android:defaultValue="" />

    <restriction
        android:key="BHEKA_SUBJECT_USER_ID"
        android:restrictionType="string"
        android:title="Bheka Subject User ID (UUID)"
        android:defaultValue="" />

    <restriction
        android:key="BHEKA_SOURCE_AGENT_ID"
        android:restrictionType="string"
        android:title="Bheka Source Agent ID (UUID, per-device)"
        android:defaultValue="" />
</managed-configurations>
```

Most EMM consoles (Google Admin console, Microsoft Intune, VMware Workspace
ONE, etc.) let you supply this as a JSON payload instead — the equivalent
JSON is:

```json
{
  "BHEKA_API_URL": "http://100.87.148.94:8081",
  "BHEKA_AGENT_TOKEN": "4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac",
  "BHEKA_TENANT_SLUG": "eride-technologies",
  "BHEKA_SITE_ID": "<uuid>",
  "BHEKA_SUBJECT_USER_ID": "<uuid>",
  "BHEKA_SOURCE_AGENT_ID": "<uuid>"
}
```

`BhekaApplication` listens for `ACTION_APPLICATION_RESTRICTIONS_CHANGED` and
calls `Config.refreshFromManagedConfig()` to pick up pushed values
immediately and restart the monitoring service with the new config — no
device reboot or manual re-enrollment required.

If `BHEKA_SOURCE_AGENT_ID` is left blank, the app generates a random UUIDv4
on first run and persists it, so each physical device gets a stable,
unique source agent ID even without MDM pushing one explicitly.

### Alternative: QR-code enrollment

For devices without full MDM AppConfig support, open the app and tap
**Scan Enrollment QR Code**. The QR code should encode a JSON payload:

```json
{
  "apiUrl": "http://100.87.148.94:8081",
  "agentToken": "4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac",
  "tenantSlug": "eride-technologies",
  "siteId": "<uuid>",
  "subjectUserId": "<uuid>",
  "sourceAgentId": "<uuid-optional>"
}
```

Fields are loaded into the enrollment form for review; tap **Start
Monitoring** to save and launch the foreground service.

## How it connects to the Bheka API

All three monitoring components share a single HTTP endpoint via
`ApiClient.postEvent()`:

```
POST {BHEKA_API_URL}/api/v1/agent/events
X-Agent-Token: {BHEKA_AGENT_TOKEN}
Content-Type: application/json

{
  "tenantSlug": "eride-technologies",
  "siteId": "<uuid>",
  "subjectUserId": "<uuid>",
  "sourceAgentId": "<uuid>",
  "eventType": "keystroke_batch" | "screenshot_capture" | "app_usage_session",
  "occurredAt": "2026-08-01T20:30:00Z",
  "metadata": { ... }
}
```

- **`keystroke_batch`** — emitted by `BhekaAccessibilityService` every 10
  seconds, or immediately once 50+ characters have been buffered.
  `metadata`: `{ keystrokeCount, activeWindowTitle, capturedText }`.
- **`screenshot_capture`** — emitted by `BhekaMonitoringService` (via
  `ScreenshotManager`) every 60 seconds. Screenshots are scaled to a max
  width of 1280px, JPEG-compressed at quality 55, and Base64-encoded; ML
  Kit's on-device Text Recognition extracts `ocrText`. `metadata`:
  `{ screenshotImageBase64, ocrText, activeWindowTitle, screenshotWidth, screenshotHeight }`.
- **`app_usage_session`** — emitted by `AppUsageTracker`, which polls
  `UsageStatsManager` every 5 seconds and posts a session as soon as the
  foreground app changes (sessions under 2 seconds are discarded as noise).
  `metadata`: `{ processName, windowTitle, isBrowser, startedAt, endedAt, durationSeconds }`.

Network calls run on `Dispatchers.IO` via Kotlin coroutines using a shared
`OkHttpClient`; failures are logged and swallowed so a transient network
issue never crashes the foreground service. The JSON body is capped well
under the API's 10MB limit (screenshots are separately capped at 8MB of raw
JPEG before Base64 inflation).

## Resilience / auto-restart

- `BhekaMonitoringService.onStartCommand()` returns `START_STICKY`, so
  Android recreates the service if it's killed for memory.
- `BootReceiver` listens for `BOOT_COMPLETED` and restarts the service after
  every reboot, provided the device is already enrolled.
- The MediaProjection (screenshot) grant does **not** survive process death
  or reboot (this is an OS-level restriction, not something the app can
  bypass) — the service detects the missing/invalid token and automatically
  re-launches `MediaProjectionRequestActivity` to prompt for it again, while
  keystroke and app-usage monitoring continue uninterrupted.
