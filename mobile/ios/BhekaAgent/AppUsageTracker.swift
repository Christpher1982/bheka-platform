//
//  AppUsageTracker.swift
//  BhekaAgent
//
//  Best-effort foreground/session tracking, as described in the spec:
//
//  a) UIApplication notifications — only meaningful while BhekaAgent itself is the
//     foreground app (or briefly backgrounded). This tells us when the OPERATOR'S
//     device switches away from BhekaAgent, which is a weak proxy for "user switched
//     to another app" but carries no information about *which* app.
//
//  b) ReplayKit frame-change analysis — while the broadcast extension or in-app
//     capture is active, we can diff consecutive frames to detect a probable app
//     switch (a large visual delta), without ever learning the other app's identity.
//     iOS's app sandboxing model makes it impossible for a monitoring app to read
//     another app's process name or bundle ID — the App Store review guidelines and
//     the OS itself block this by design (unlike Android's UsageStatsManager /
//     Accessibility APIs). See README for a full explanation of this platform gap.
//
//  Per spec, every "session" posted for iOS uses `processName = "ios-device"` and
//  `isBrowser = false`, since real process names are unavailable. The primary source
//  of `app_usage_session` events is actually ScreenCaptureManager, which emits one
//  session per 60-second recording window. This tracker supplements that with
//  foreground/background transition sessions captured while BhekaAgent is active,
//  which are useful for detecting when the *operator's own device* is actively being
//  used versus locked/idle.
//
import UIKit
import Combine

@MainActor
final class AppUsageTracker: ObservableObject {

    static let shared = AppUsageTracker()

    @Published private(set) var isTrackingForegroundState = false

    private var sessionStart: Date?
    private var cancellables = Set<AnyCancellable>()

    /// Frame-diff state for ReplayKit-based switch detection (best-effort, no app identity).
    private var lastFrameHash: Int?
    private var lastFrameChangeAt: Date?

    private init() {}

    // MARK: - UIApplication lifecycle tracking

    func start() {
        guard !isTrackingForegroundState else { return }
        isTrackingForegroundState = true
        sessionStart = Date()

        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in self?.handleBecameActive() }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)
            .sink { [weak self] _ in self?.handleWillResign() }
            .store(in: &cancellables)
    }

    func stop() {
        cancellables.removeAll()
        isTrackingForegroundState = false
        // Flush any open session before stopping.
        if let start = sessionStart {
            emitSession(start: start, end: Date(), windowTitle: "BhekaAgent (foreground)")
        }
        sessionStart = nil
    }

    private func handleBecameActive() {
        sessionStart = Date()
    }

    private func handleWillResign() {
        guard let start = sessionStart else { return }
        emitSession(start: start, end: Date(), windowTitle: "BhekaAgent (foreground)")
        sessionStart = nil
    }

    private func emitSession(start: Date, end: Date, windowTitle: String) {
        let duration = end.timeIntervalSince(start)
        // Ignore negligible sessions (e.g. instantaneous notification-center pulls).
        guard duration >= 1 else { return }

        let config = ConfigStore.load()
        guard config.isComplete else { return }

        let usage = AppUsageMetadata(
            processName: "ios-device",
            windowTitle: windowTitle,
            isBrowser: false,
            startedAt: start,
            endedAt: end,
            durationSeconds: duration
        )
        ApiClient.shared.postAppUsageSession(usage, config: config)
    }

    // MARK: - ReplayKit frame-diff based switch detection (best-effort)

    /// Called by ScreenCaptureManager (or the broadcast extension, via the shared
    /// container) with a lightweight hash of each sampled frame. If the hash changes
    /// significantly from the previous sample, we treat that as a likely foreground
    /// app switch and record the transition timestamp. No app identity is available —
    /// this only helps establish *that* a switch happened, for analytics/debugging.
    func recordFrameSample(hash: Int, at date: Date) {
        defer {
            lastFrameHash = hash
            lastFrameChangeAt = date
        }
        guard let previousHash = lastFrameHash else { return }
        if previousHash != hash {
            print("[AppUsageTracker] Detected likely foreground switch at \(date) (frame hash changed).")
        }
    }
}
