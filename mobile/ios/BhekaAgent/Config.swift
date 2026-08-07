//
//  Config.swift
//  BhekaAgent
//
//  Centralized configuration for the Bheka monitoring agent.
//
//  Configuration resolution order (highest priority first):
//    1. MDM Managed App Configuration — pushed by Jamf Pro / Microsoft Intune (or any
//       MDM) via the `AppConfig` dictionary in a device configuration profile. iOS
//       surfaces this to the app through `UserDefaults(suiteName: "ManagedAppConfiguration")`
//       under the key "com.apple.configuration.managed".
//    2. Regular `UserDefaults.standard` — values entered manually in the app UI or
//       imported via QR code enrollment.
//    3. Hard-coded fallback defaults (useful for first-run / development).
//
//  All values are also mirrored into the shared App Group container
//  (`group.io.bheka.agent`) so the Broadcast Upload Extension — which runs as a
//  separate process/sandbox — can read the same configuration.
//
import Foundation

/// Strongly-typed snapshot of everything the agent needs to talk to the Bheka API.
struct BhekaConfig: Codable, Equatable {
    var apiUrl: String
    var agentToken: String
    var tenantSlug: String
    var siteId: String
    var subjectUserId: String
    var sourceAgentId: String

    var isComplete: Bool {
        !apiUrl.isEmpty && !agentToken.isEmpty && !tenantSlug.isEmpty &&
        !siteId.isEmpty && !subjectUserId.isEmpty && !sourceAgentId.isEmpty
    }

    static let empty = BhekaConfig(
        apiUrl: "", agentToken: "", tenantSlug: "", siteId: "", subjectUserId: "", sourceAgentId: ""
    )
}

/// QR-code enrollment payload. Decodes the same JSON contract the Android agent's QR
/// generator produces ("agentToken" / "sourceAgentId"), mapped onto shorter Swift-side
/// property names via CodingKeys so both agents can share one QR payload format.
struct QRConfigPayload: Codable {
    let apiUrl: String
    let token: String
    let tenantSlug: String
    let siteId: String
    let subjectUserId: String
    let agentId: String

    enum CodingKeys: String, CodingKey {
        case apiUrl
        case token = "agentToken"
        case tenantSlug
        case siteId
        case subjectUserId
        case agentId = "sourceAgentId"
    }
}

enum ConfigStore {

    // MARK: - Keys

    /// Must match the App Group configured in both target entitlements files.
    static let appGroupId = "group.io.bheka.agent"

    /// The suite name iOS uses to surface MDM Managed App Configuration to the app.
    /// This is a fixed, Apple-defined suite name — do not change it.
    private static let managedConfigSuite = "ManagedAppConfiguration"
    private static let managedConfigKey = "com.apple.configuration.managed"

    private enum Key {
        static let apiUrl = "BHEKA_API_URL"
        static let agentToken = "BHEKA_AGENT_TOKEN"
        static let tenantSlug = "BHEKA_TENANT_SLUG"
        static let siteId = "BHEKA_SITE_ID"
        static let subjectUserId = "BHEKA_SUBJECT_USER_ID"
        static let sourceAgentId = "BHEKA_SOURCE_AGENT_ID"
        static let monitoringActive = "BHEKA_MONITORING_ACTIVE"
        static let lastScreenshotAt = "BHEKA_LAST_SCREENSHOT_AT"
        static let lastUploadOkAt = "BHEKA_LAST_UPLOAD_OK_AT"
        static let lastUploadError = "BHEKA_LAST_UPLOAD_ERROR"
        static let extensionLastAliveAt = "BHEKA_EXTENSION_LAST_ALIVE_AT"
        static let extensionLastStage = "BHEKA_EXTENSION_LAST_STAGE"
    }

    // MARK: - Hard-coded fallback defaults
    //
    // These mirror the defaults distributed with the Android agent. In production these
    // should always be overridden by MDM Managed App Config per-device/per-user.

    private static let fallback = BhekaConfig(
        apiUrl: "http://100.87.148.94:8081",
        agentToken: "4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac",
        tenantSlug: "eride-technologies",
        siteId: "",
        subjectUserId: "",
        sourceAgentId: ""
    )

    // MARK: - Shared App Group defaults

    /// UserDefaults backed by the shared App Group container. Both the main app and the
    /// Broadcast Upload Extension read/write here so configuration and status stay in sync.
    static var shared: UserDefaults {
        guard let defaults = UserDefaults(suiteName: appGroupId) else {
            // Falling back to .standard keeps the app functional in the simulator or
            // if the App Group entitlement hasn't been provisioned yet, but the
            // extension will NOT be able to see these values in that case.
            assertionFailure("App Group '\(appGroupId)' is not configured. Add the App Groups capability to both targets.")
            return .standard
        }
        return defaults
    }

    /// Reads the MDM-managed app configuration dictionary, if present.
    /// Returns nil if no MDM profile has pushed configuration yet.
    private static func managedConfigDictionary() -> [String: Any]? {
        guard let managedDefaults = UserDefaults(suiteName: managedConfigSuite) else { return nil }
        return managedDefaults.dictionary(forKey: managedConfigKey)
    }

    // MARK: - Public API

    /// Resolves the effective configuration using the priority order described above,
    /// and persists it into the shared App Group defaults so the extension can see it.
    @discardableResult
    static func load() -> BhekaConfig {
        let managed = managedConfigDictionary()
        let standard = UserDefaults.standard
        let group = shared

        func resolve(_ key: String, managedKey: String? = nil) -> String {
            // 1. MDM managed config takes precedence.
            if let managed, let value = managed[managedKey ?? key] as? String, !value.isEmpty {
                return value
            }
            // 2. Shared App Group defaults (previously resolved value, or QR-imported value).
            if let value = group.string(forKey: key), !value.isEmpty {
                return value
            }
            // 3. Standard UserDefaults (manually entered in UI, pre-App-Group-sync).
            if let value = standard.string(forKey: key), !value.isEmpty {
                return value
            }
            return ""
        }

        var config = BhekaConfig(
            apiUrl: resolve(Key.apiUrl, managedKey: "apiUrl"),
            agentToken: resolve(Key.agentToken, managedKey: "agentToken"),
            tenantSlug: resolve(Key.tenantSlug, managedKey: "tenantSlug"),
            siteId: resolve(Key.siteId, managedKey: "siteId"),
            subjectUserId: resolve(Key.subjectUserId, managedKey: "subjectUserId"),
            sourceAgentId: resolve(Key.sourceAgentId, managedKey: "sourceAgentId")
        )

        // Apply hard-coded fallbacks only for fields still empty after MDM + UserDefaults.
        if config.apiUrl.isEmpty { config.apiUrl = fallback.apiUrl }
        if config.agentToken.isEmpty { config.agentToken = fallback.agentToken }
        if config.tenantSlug.isEmpty { config.tenantSlug = fallback.tenantSlug }

        save(config)
        return config
    }

    /// Persists configuration into both the shared App Group defaults (for the extension)
    /// and standard UserDefaults (for consistency / debugging in the main app).
    static func save(_ config: BhekaConfig) {
        let group = shared
        group.set(config.apiUrl, forKey: Key.apiUrl)
        group.set(config.agentToken, forKey: Key.agentToken)
        group.set(config.tenantSlug, forKey: Key.tenantSlug)
        group.set(config.siteId, forKey: Key.siteId)
        group.set(config.subjectUserId, forKey: Key.subjectUserId)
        group.set(config.sourceAgentId, forKey: Key.sourceAgentId)

        let standard = UserDefaults.standard
        standard.set(config.apiUrl, forKey: Key.apiUrl)
        standard.set(config.agentToken, forKey: Key.agentToken)
        standard.set(config.tenantSlug, forKey: Key.tenantSlug)
        standard.set(config.siteId, forKey: Key.siteId)
        standard.set(config.subjectUserId, forKey: Key.subjectUserId)
        standard.set(config.sourceAgentId, forKey: Key.sourceAgentId)
    }

    /// Applies a QR-scanned enrollment payload on top of current configuration and persists it.
    static func apply(qr payload: QRConfigPayload) -> BhekaConfig {
        let config = BhekaConfig(
            apiUrl: payload.apiUrl,
            agentToken: payload.token,
            tenantSlug: payload.tenantSlug,
            siteId: payload.siteId,
            subjectUserId: payload.subjectUserId,
            sourceAgentId: payload.agentId
        )
        save(config)
        return config
    }

    // MARK: - Monitoring status flag (shared between app + extension)

    static func setMonitoringActive(_ active: Bool) {
        shared.set(active, forKey: Key.monitoringActive)
    }

    static func isMonitoringActive() -> Bool {
        shared.bool(forKey: Key.monitoringActive)
    }

    static func setLastScreenshotAt(_ date: Date) {
        shared.set(date.timeIntervalSince1970, forKey: Key.lastScreenshotAt)
    }

    static func lastScreenshotAt() -> Date? {
        let value = shared.double(forKey: Key.lastScreenshotAt)
        return value > 0 ? Date(timeIntervalSince1970: value) : nil
    }

    // MARK: - Upload delivery confirmation
    //
    // `lastScreenshotAt` above only means a frame was captured on-device and handed to
    // the network layer — it says nothing about whether the server actually received it.
    // These two track the real outcome of the most recent POST to /api/v1/agent/events,
    // so the UI can show a truthful "is this actually reaching the server" signal instead
    // of implying success just because a local frame was processed.

    static func setLastUploadOk(_ date: Date) {
        shared.set(date.timeIntervalSince1970, forKey: Key.lastUploadOkAt)
        shared.removeObject(forKey: Key.lastUploadError)
    }

    static func setLastUploadError(_ message: String) {
        shared.set(message, forKey: Key.lastUploadError)
    }

    static func lastUploadOkAt() -> Date? {
        let value = shared.double(forKey: Key.lastUploadOkAt)
        return value > 0 ? Date(timeIntervalSince1970: value) : nil
    }

    static func lastUploadError() -> String? {
        shared.string(forKey: Key.lastUploadError)
    }

    // MARK: - Extension diagnostics
    //
    // Mirrors ExtensionConfigStore.markExtensionAlive's heartbeat so the host app's UI
    // can show exactly how far the extension got before it stopped checking in --
    // needed for the next physical test to distinguish "never launched" from "launched
    // then died" from "still alive", none of which were distinguishable before.

    static func extensionLastAliveAt() -> Date? {
        let value = shared.double(forKey: Key.extensionLastAliveAt)
        return value > 0 ? Date(timeIntervalSince1970: value) : nil
    }

    static func extensionLastStage() -> String? {
        shared.string(forKey: Key.extensionLastStage)
    }
}
