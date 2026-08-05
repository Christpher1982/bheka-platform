//
//  ExtensionApiClient.swift
//  BhekaBroadcastExtension
//
//  A minimal, self-contained URLSession client for the Broadcast Upload Extension.
//  App extensions run in a tightly memory-constrained, short-lived process, so this
//  intentionally avoids pulling in the full main-app ApiClient (which uses a
//  `URLSessionConfiguration.background` session — background sessions are designed for
//  the *host app*, not extensions, and behave unreliably when created inside one).
//
//  Instead, this client posts with a lightweight, ephemeral URLSession configuration and
//  relies on the extension process being kept alive by RPBroadcastSampleHandler for the
//  duration of the broadcast (which is exactly as long as we need for near-real-time
//  posting of each sampled frame's event).
//
//  Configuration is read from the same App Group shared UserDefaults that the main app
//  writes to (see ConfigStore in the main app / duplicated minimal reader below), since
//  app extensions cannot import the main app's module directly.
//
import Foundation
import UIKit

/// Duplicated (intentionally minimal) config reader for the extension process. Extensions
/// cannot import the main app target, so this mirrors just the pieces ConfigStore needs
/// from the shared App Group container.
enum ExtensionConfigStore {
    static let appGroupId = "group.io.bheka.agent"

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
    }

    struct Config {
        let apiUrl: String
        let agentToken: String
        let tenantSlug: String
        let siteId: String
        let subjectUserId: String
        let sourceAgentId: String

        var isComplete: Bool {
            !apiUrl.isEmpty && !agentToken.isEmpty && !tenantSlug.isEmpty &&
            !siteId.isEmpty && !subjectUserId.isEmpty && !sourceAgentId.isEmpty
        }
    }

    static func load() -> Config? {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return nil }
        return Config(
            apiUrl: defaults.string(forKey: Key.apiUrl) ?? "",
            agentToken: defaults.string(forKey: Key.agentToken) ?? "",
            tenantSlug: defaults.string(forKey: Key.tenantSlug) ?? "",
            siteId: defaults.string(forKey: Key.siteId) ?? "",
            subjectUserId: defaults.string(forKey: Key.subjectUserId) ?? "",
            sourceAgentId: defaults.string(forKey: Key.sourceAgentId) ?? ""
        )
    }

    static func setMonitoringActive(_ active: Bool) {
        UserDefaults(suiteName: appGroupId)?.set(active, forKey: Key.monitoringActive)
    }

    static func setLastScreenshotAt(_ date: Date) {
        UserDefaults(suiteName: appGroupId)?.set(date.timeIntervalSince1970, forKey: Key.lastScreenshotAt)
    }

    static func setLastUploadOk(_ date: Date) {
        let defaults = UserDefaults(suiteName: appGroupId)
        defaults?.set(date.timeIntervalSince1970, forKey: Key.lastUploadOkAt)
        defaults?.removeObject(forKey: Key.lastUploadError)
    }

    static func setLastUploadError(_ message: String) {
        UserDefaults(suiteName: appGroupId)?.set(message, forKey: Key.lastUploadError)
    }
}

/// Lightweight ISO-8601 helper (extension-local copy, same format as the main app).
enum ExtensionISO8601 {
    static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }
}

/// Posts `screenshot_capture` and `app_usage_session` events from inside the Broadcast
/// Upload Extension process.
final class ExtensionApiClient {

    static let shared = ExtensionApiClient()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    func postScreenshot(
        imageBase64: String,
        ocrText: String?,
        activeWindowTitle: String,
        width: Int,
        height: Int,
        occurredAt: Date
    ) {
        guard let config = ExtensionConfigStore.load(), config.isComplete else {
            print("[ExtensionApiClient] Missing configuration — dropping screenshot event.")
            return
        }

        var metadata: [String: Any] = [
            "screenshotImageBase64": imageBase64,
            "activeWindowTitle": activeWindowTitle,
            "screenshotWidth": width,
            "screenshotHeight": height
        ]
        metadata["ocrText"] = ocrText as Any? ?? NSNull()

        postEvent(
            eventType: "screenshot_capture",
            metadata: metadata,
            occurredAt: occurredAt,
            config: config
        )
    }

    func postAppUsageSession(
        windowTitle: String,
        startedAt: Date,
        endedAt: Date,
        occurredAt: Date
    ) {
        guard let config = ExtensionConfigStore.load(), config.isComplete else {
            print("[ExtensionApiClient] Missing configuration — dropping app_usage_session event.")
            return
        }

        let metadata: [String: Any] = [
            "processName": "ios-device",
            "windowTitle": windowTitle,
            "isBrowser": false,
            "startedAt": ExtensionISO8601.string(from: startedAt),
            "endedAt": ExtensionISO8601.string(from: endedAt),
            "durationSeconds": endedAt.timeIntervalSince(startedAt)
        ]

        postEvent(
            eventType: "app_usage_session",
            metadata: metadata,
            occurredAt: occurredAt,
            config: config
        )
    }

    private func postEvent(
        eventType: String,
        metadata: [String: Any],
        occurredAt: Date,
        config: ExtensionConfigStore.Config
    ) {
        guard let url = URL(string: "\(config.apiUrl)/api/v1/agent/events") else {
            print("[ExtensionApiClient] Invalid API URL.")
            return
        }

        let envelope: [String: Any] = [
            "tenantSlug": config.tenantSlug,
            "siteId": config.siteId,
            "subjectUserId": config.subjectUserId,
            "sourceAgentId": config.sourceAgentId,
            "eventType": eventType,
            "occurredAt": ExtensionISO8601.string(from: occurredAt),
            "metadata": metadata
        ]

        guard JSONSerialization.isValidJSONObject(envelope),
              let body = try? JSONSerialization.data(withJSONObject: envelope) else {
            print("[ExtensionApiClient] Failed to serialize event body.")
            return
        }

        // Enforce the 10MB body ceiling shared with the main app's ApiClient.
        guard body.count <= 10 * 1024 * 1024 else {
            print("[ExtensionApiClient] Event body exceeds 10MB — dropping.")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(config.agentToken, forHTTPHeaderField: "X-Agent-Token")
        request.httpBody = body

        // Use a synchronous-style wait bounded to a few seconds — the extension's
        // `processSampleBuffer` callback is on a dedicated queue and can tolerate a short
        // blocking wait, but we cap it so a slow network never stalls frame delivery
        // indefinitely (RPBroadcastSampleHandler will be killed by the OS if it stalls
        // too long).
        let semaphore = DispatchSemaphore(value: 0)
        let task = session.dataTask(with: request) { _, response, error in
            if let error {
                print("[ExtensionApiClient] POST \(eventType) failed: \(error.localizedDescription)")
                ExtensionConfigStore.setLastUploadError("Upload failed: \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse {
                print("[ExtensionApiClient] POST \(eventType) -> \(http.statusCode)")
                if (200...299).contains(http.statusCode) {
                    ExtensionConfigStore.setLastUploadOk(Date())
                } else {
                    ExtensionConfigStore.setLastUploadError("Server rejected upload (HTTP \(http.statusCode)) for '\(eventType)'.")
                }
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 20)
    }
}
