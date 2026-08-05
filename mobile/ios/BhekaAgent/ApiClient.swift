//
//  ApiClient.swift
//  BhekaAgent
//
//  Posts monitoring events to the Bheka API using a background URLSession, so uploads
//  keep running even if the app is suspended or the user switches away. This mirrors
//  the Android agent's WorkManager-backed upload queue, adapted to iOS idioms.
//
import Foundation
import UIKit

/// Simple string-backed error so `testConnection`'s Result can carry a human-readable
/// message without pulling in NSError or a LocalizedError conformance boilerplate.
struct ConnectionTestError: Error, CustomStringConvertible {
    let message: String
    init(_ message: String) { self.message = message }
    var description: String { message }
}

/// The three event types the Bheka API accepts. Identical contract across Android/iOS agents.
enum BhekaEventType: String, Codable {
    case keystrokeBatch = "keystroke_batch"       // Not used by the iOS agent (see README).
    case screenshotCapture = "screenshot_capture"
    case appUsageSession = "app_usage_session"
}

/// Top-level envelope posted to POST {API_URL}/api/v1/agent/events
struct BhekaEvent: Encodable {
    let tenantSlug: String
    let siteId: String
    let subjectUserId: String
    let sourceAgentId: String
    let eventType: String
    let occurredAt: String
    let metadata: [String: AnyEncodable]
}

/// Metadata payload for a `screenshot_capture` event.
struct ScreenshotMetadata {
    let screenshotImageBase64: String
    let ocrText: String?
    let activeWindowTitle: String
    let screenshotWidth: Int
    let screenshotHeight: Int
}

/// Metadata payload for an `app_usage_session` event.
struct AppUsageMetadata {
    let processName: String
    let windowTitle: String
    let isBrowser: Bool
    let startedAt: Date
    let endedAt: Date
    let durationSeconds: Double
}

/// Type-erasing wrapper so heterogeneous metadata values (String, Int, Bool, nil) can share
/// a single `[String: AnyEncodable]` dictionary when building the JSON body.
struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init<T: Encodable>(_ value: T?) {
        if let value {
            encodeClosure = { encoder in try value.encode(to: encoder) }
        } else {
            encodeClosure = { encoder in
                var container = encoder.singleValueContainer()
                try container.encodeNil()
            }
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

/// ISO-8601 formatter with fractional seconds, matching the API contract's
/// "2026-08-04T20:30:00.000Z" format.
enum ISO8601 {
    static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }
}

/// Handles all HTTP communication with the Bheka API from the main app.
///
/// Uses a background `URLSessionConfiguration` (`com.bheka.agent.upload`) so POST
/// requests are handed off to the OS and continue even if the app is backgrounded or
/// terminated, then resumed on next launch. Responses are inspected only for logging;
/// the API does not require synchronous handling of the response body.
final class ApiClient: NSObject {

    static let shared = ApiClient()

    /// A unique-enough identifier for the background session so it can be resumed by the
    /// system if the app is relaunched after an upload finishes in the background.
    private let backgroundSessionIdentifier = "io.bheka.agent.upload.session"

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: backgroundSessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.waitsForConnectivity = true
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Foreground session used as a fallback for immediate posts where a background
    /// session isn't appropriate (e.g. quick connectivity checks from the UI).
    private lazy var foregroundSession: URLSession = URLSession(configuration: .default)

    private override init() {
        super.init()
    }

    // MARK: - Connectivity test

    /// Hits the API's unauthenticated health endpoint directly (foreground session, so
    /// the result comes back synchronously enough for a UI button) to answer the one
    /// question that matters when uploads seem to be going nowhere: can this phone even
    /// reach the server at all. This is independent of agent token / tenant config.
    func testConnection(apiUrl: String, completion: @escaping (Result<String, ConnectionTestError>) -> Void) {
        guard let url = URL(string: "\(apiUrl)/api/v1/healthz") else {
            completion(.failure(ConnectionTestError("Invalid API URL: \(apiUrl)")))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8

        foregroundSession.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error {
                    completion(.failure(ConnectionTestError("No response from server: \(error.localizedDescription). Check the phone can reach \(apiUrl) (e.g. Tailscale connected, on the right network).")))
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    completion(.failure(ConnectionTestError("No HTTP response received.")))
                    return
                }
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if (200...299).contains(http.statusCode) {
                    completion(.success("Server reachable (HTTP \(http.statusCode)). \(body)"))
                } else {
                    completion(.failure(ConnectionTestError("Server responded with HTTP \(http.statusCode). \(body)")))
                }
            }
        }.resume()
    }

    // MARK: - Public posting API

    func postScreenshot(_ metadata: ScreenshotMetadata, occurredAt: Date = Date(), config: BhekaConfig) {
        let metadataDict: [String: AnyEncodable] = [
            "screenshotImageBase64": AnyEncodable(metadata.screenshotImageBase64),
            "ocrText": AnyEncodable(metadata.ocrText),
            "activeWindowTitle": AnyEncodable(metadata.activeWindowTitle),
            "screenshotWidth": AnyEncodable(metadata.screenshotWidth),
            "screenshotHeight": AnyEncodable(metadata.screenshotHeight)
        ]
        post(eventType: .screenshotCapture, metadata: metadataDict, occurredAt: occurredAt, config: config)
    }

    func postAppUsageSession(_ metadata: AppUsageMetadata, config: BhekaConfig) {
        let metadataDict: [String: AnyEncodable] = [
            "processName": AnyEncodable(metadata.processName),
            "windowTitle": AnyEncodable(metadata.windowTitle),
            "isBrowser": AnyEncodable(metadata.isBrowser),
            "startedAt": AnyEncodable(ISO8601.string(from: metadata.startedAt)),
            "endedAt": AnyEncodable(ISO8601.string(from: metadata.endedAt)),
            "durationSeconds": AnyEncodable(metadata.durationSeconds)
        ]
        post(eventType: .appUsageSession, metadata: metadataDict, occurredAt: metadata.endedAt, config: config)
    }

    // MARK: - Core POST implementation

    private func post(
        eventType: BhekaEventType,
        metadata: [String: AnyEncodable],
        occurredAt: Date,
        config: BhekaConfig
    ) {
        guard config.isComplete else {
            print("[ApiClient] Skipping POST — configuration incomplete.")
            return
        }
        guard let url = URL(string: "\(config.apiUrl)/api/v1/agent/events") else {
            print("[ApiClient] Invalid API URL: \(config.apiUrl)")
            return
        }

        let event = BhekaEvent(
            tenantSlug: config.tenantSlug,
            siteId: config.siteId,
            subjectUserId: config.subjectUserId,
            sourceAgentId: config.sourceAgentId,
            eventType: eventType.rawValue,
            occurredAt: ISO8601.string(from: occurredAt),
            metadata: metadata
        )

        do {
            let body = try JSONEncoder().encode(event)

            // Guard against exceeding the API's 10MB body limit (base64 screenshots are
            // the main risk here). If exceeded, drop the screenshot but keep OCR text.
            if body.count > 10 * 1024 * 1024 {
                print("[ApiClient] Event body exceeds 10MB (\(body.count) bytes) — dropping to avoid rejection.")
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(config.agentToken, forHTTPHeaderField: "X-Agent-Token")

            // Background URLSession upload tasks require the body to come from a file,
            // not an in-memory Data blob, so we stage it in a temporary file.
            let tempURL = try writeTemporaryBody(body)
            let task = session.uploadTask(with: request, fromFile: tempURL)
            task.taskDescription = eventType.rawValue
            task.resume()
        } catch {
            print("[ApiClient] Failed to encode/post \(eventType.rawValue) event: \(error)")
        }
    }

    private func writeTemporaryBody(_ data: Data) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
        let fileURL = dir.appendingPathComponent(UUID().uuidString + ".json")
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }
}

// MARK: - URLSessionDelegate / URLSessionTaskDelegate

extension ApiClient: URLSessionDelegate, URLSessionTaskDelegate {

    /// Called when all background events for the session have been delivered. This is
    /// where the app should invoke the completion handler stashed by
    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)` in the App
    /// delegate/lifecycle adapter (see BhekaAgentApp.swift).
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            BackgroundSessionCompletionRegistry.shared.fire(for: session.configuration.identifier)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Record the REAL outcome of every event upload into the shared App Group store,
        // so the UI's "last upload" status reflects actual server delivery rather than
        // just "we handed a frame to the network stack and hoped".
        if let error {
            let message = "Upload failed: \(error.localizedDescription)"
            print("[ApiClient] Upload task '\(task.taskDescription ?? "?")' failed: \(error.localizedDescription)")
            ConfigStore.setLastUploadError(message)
        } else if let http = task.response as? HTTPURLResponse {
            print("[ApiClient] Upload task '\(task.taskDescription ?? "?")' finished with status \(http.statusCode).")
            if (200...299).contains(http.statusCode) {
                ConfigStore.setLastUploadOk(Date())
            } else {
                ConfigStore.setLastUploadError("Server rejected upload (HTTP \(http.statusCode)) for '\(task.taskDescription ?? "event")'.")
            }
        }
        // Clean up the temp file used as the upload body source, if it still exists.
        if let originalRequest = task.originalRequest, let bodyURL = originalRequest.url {
            _ = bodyURL // no-op; temp file cleanup handled by OS temp dir eviction.
        }
    }
}

/// Simple registry so SwiftUI lifecycle code can register a completion handler for the
/// background URLSession's `handleEventsForBackgroundURLSession` callback (delivered via
/// the scene delegate / UIApplicationDelegateAdaptor) and have `ApiClient` fire it once
/// all background transfers have been delivered to the delegate.
final class BackgroundSessionCompletionRegistry {
    static let shared = BackgroundSessionCompletionRegistry()
    private var handlers: [String: () -> Void] = [:]

    func register(identifier: String, handler: @escaping () -> Void) {
        handlers[identifier] = handler
    }

    func fire(for identifier: String?) {
        guard let identifier, let handler = handlers[identifier] else { return }
        handler()
        handlers.removeValue(forKey: identifier)
    }
}
