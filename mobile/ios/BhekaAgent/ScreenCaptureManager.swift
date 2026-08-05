//
//  ScreenCaptureManager.swift
//  BhekaAgent
//
//  Coordinates in-app screen recording via RPScreenRecorder for the case where the app
//  itself drives capture (e.g. while the app is foregrounded, or on devices where the
//  user starts capture from within BhekaAgent directly rather than via the system
//  broadcast picker). For true background/continuous monitoring, see
//  BhekaBroadcastExtension/SampleHandler.swift — that extension keeps capturing even
//  when this app is suspended, using the RPSystemBroadcastPickerView flow started from
//  ContentView.
//
//  Both paths funnel frames through the same processing pipeline (ImageProcessor +
//  OCRProcessor) and both post through ApiClient, so screenshot semantics are identical
//  regardless of which capture path is active.
//
import ReplayKit
import UIKit
import Combine

@MainActor
final class ScreenCaptureManager: ObservableObject {

    @Published private(set) var isCapturing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastScreenshotAt: Date?

    private let recorder = RPScreenRecorder.shared()

    /// We only want to process one frame every N seconds, even though ReplayKit delivers
    /// frames continuously (often 30-60fps). Track the last time we actually processed a
    /// frame and skip everything else — this is the "sample one frame every 60 seconds"
    /// requirement from the spec.
    private var lastSampleTime: Date = .distantPast
    private let sampleInterval: TimeInterval = 60

    /// Tracks the current 60-second window so we can emit one `app_usage_session` event
    /// per window, per spec ("one app_usage_session per 60-second recording window").
    private var currentWindowStart: Date?

    private let processingQueue = DispatchQueue(label: "io.bheka.agent.capture.processing", qos: .utility)

    func startCapture() {
        guard recorder.isAvailable else {
            lastError = "Screen recording is not available on this device (it may be disabled by an MDM restriction)."
            return
        }
        guard !isCapturing else { return }

        recorder.startCapture(handler: { [weak self] sampleBuffer, bufferType, error in
            guard let self else { return }
            if let error {
                Task { @MainActor in self.lastError = error.localizedDescription }
                return
            }
            // We only care about video frames for screenshot + OCR purposes.
            guard bufferType == .video else { return }
            self.handleSampleBuffer(sampleBuffer)
        }, completionHandler: { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.lastError = "Failed to start screen capture: \(error.localizedDescription)"
                    self.isCapturing = false
                } else {
                    self.isCapturing = true
                    self.lastError = nil
                    self.currentWindowStart = Date()
                    ConfigStore.setMonitoringActive(true)
                }
            }
        })
    }

    func stopCapture() {
        guard isCapturing else { return }
        recorder.stopCapture { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.lastError = "Failed to stop screen capture: \(error.localizedDescription)"
                }
                self.isCapturing = false
                ConfigStore.setMonitoringActive(false)
            }
        }
    }

    /// Called from the ReplayKit delivery callback (a background thread). Applies the
    /// 60-second sampling gate, then hands off to the processing queue so image scaling,
    /// JPEG compression, and Vision OCR never block the capture callback thread.
    nonisolated private func handleSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        let now = Date()

        Task { @MainActor in
            guard now.timeIntervalSince(self.lastSampleTime) >= self.sampleInterval else { return }
            self.lastSampleTime = now
            self.processFrame(sampleBuffer, capturedAt: now)
        }
    }

    @MainActor
    private func processFrame(_ sampleBuffer: CMSampleBuffer, capturedAt: Date) {
        let windowStart = currentWindowStart ?? capturedAt
        processingQueue.async { [weak self] in
            guard let self else { return }
            guard let uiImage = ImageProcessor.image(from: sampleBuffer) else { return }
            self.processAndUpload(uiImage: uiImage, capturedAt: capturedAt, windowStart: windowStart)
        }
    }

    /// Runs the full pipeline off the main thread: scale, JPEG-compress, OCR, then post
    /// both a `screenshot_capture` event and the corresponding `app_usage_session` event
    /// for the 60-second window that just elapsed.
    private func processAndUpload(uiImage: UIImage, capturedAt: Date, windowStart: Date) {
        let config = ConfigStore.load()
        guard config.isComplete else {
            print("[ScreenCaptureManager] Configuration incomplete — dropping frame.")
            return
        }

        guard let processed = ImageProcessor.processForUpload(uiImage) else {
            print("[ScreenCaptureManager] Failed to process frame for upload.")
            return
        }

        // OCR failures should not block the screenshot upload — ocrText is nullable per spec.
        let ocrText = OCRProcessor.recognizeText(in: uiImage)
        let windowTitle = OCRProcessor.recognizeTopBarText(in: uiImage) ?? "unknown"

        let base64 = ImageProcessor.base64(processed.jpegData)
        let metadata = ScreenshotMetadata(
            screenshotImageBase64: base64,
            ocrText: ocrText,
            activeWindowTitle: windowTitle,
            screenshotWidth: processed.width,
            screenshotHeight: processed.height
        )

        ApiClient.shared.postScreenshot(metadata, occurredAt: capturedAt, config: config)

        // Emit the app_usage_session for the window that just elapsed. iOS cannot identify
        // other apps' process names from within an app extension's sandbox, so we use the
        // constant "ios-device" placeholder mandated by the API contract for this platform.
        let usage = AppUsageMetadata(
            processName: "ios-device",
            windowTitle: windowTitle,
            isBrowser: false,
            startedAt: windowStart,
            endedAt: capturedAt,
            durationSeconds: capturedAt.timeIntervalSince(windowStart)
        )
        ApiClient.shared.postAppUsageSession(usage, config: config)

        Task { @MainActor in
            self.lastScreenshotAt = capturedAt
            self.currentWindowStart = capturedAt
            ConfigStore.setLastScreenshotAt(capturedAt)
        }
    }
}
