//
//  SampleHandler.swift
//  BhekaBroadcastExtension
//
//  This is the correct iOS architecture for continuous/background monitoring: a
//  Broadcast Upload Extension keeps running (in its own process, up to the OS's
//  extension memory limit) for as long as the user has an active system broadcast
//  session, even while BhekaAgent itself is backgrounded or not running at all.
//
//  RPBroadcastSampleHandler delivers CMSampleBuffer frames via
//  `processSampleBuffer(_:with:)`. We apply the same 60-second sampling gate, image
//  processing, and OCR pipeline used by the in-app ScreenCaptureManager, then post
//  directly via ExtensionApiClient (a lightweight, extension-local API client — see
//  that file for why we don't share the main app's background URLSession).
//
//  Lifecycle notes:
//   - broadcastStarted(withSetupInfo:) fires when the user taps "Start Broadcast" in
//     the RPSystemBroadcastPickerView flow from ContentView.
//   - processSampleBuffer(_:with:) fires continuously while broadcasting (video +
//     audio + audioApp sample types); we only act on .video samples.
//   - broadcastPaused/broadcastResumed fire when the user locks the screen or
//     switches to Control Center, etc.
//   - broadcastFinished fires when the user stops the broadcast, either from this
//     extension's UI or the system's broadcast bar.
//
import ReplayKit
import Vision
import UIKit
import CoreImage
import VideoToolbox

final class SampleHandler: RPBroadcastSampleHandler {

    /// Minimum spacing between processed frames, in seconds. Matches the main app's
    /// 60-second sampling interval so behavior is identical whether capture happens via
    /// this extension or the in-app ScreenCaptureManager.
    private let sampleInterval: TimeInterval = 60
    private var lastSampleTime: Date = .distantPast
    private var currentWindowStart: Date = Date()

    /// Serial queue for image processing/OCR so we never process two frames concurrently
    /// (keeps the extension's tight memory budget predictable).
    private let processingQueue = DispatchQueue(label: "io.bheka.agent.extension.processing", qos: .utility)

    // MARK: - RPBroadcastSampleHandler lifecycle

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        // Broadcast started — reset sampling state and mark monitoring active in the
        // shared App Group so the main app's status UI reflects reality even if it's
        // not currently foregrounded.
        lastSampleTime = .distantPast
        currentWindowStart = Date()
        ExtensionConfigStore.setMonitoringActive(true)
    }

    override func broadcastPaused() {
        // No-op: we simply stop receiving processSampleBuffer calls until resumed.
    }

    override func broadcastResumed() {
        // Treat resume as the start of a new 60s window so durations stay meaningful.
        currentWindowStart = Date()
    }

    override func broadcastFinished() {
        ExtensionConfigStore.setMonitoringActive(false)
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }

        let now = Date()
        guard now.timeIntervalSince(lastSampleTime) >= sampleInterval else { return }
        lastSampleTime = now

        let windowStart = currentWindowStart

        // CMSampleBuffer is not safe to retain past this callback without retaining the
        // underlying CVPixelBuffer explicitly, so convert to UIImage synchronously here
        // (cheap: VTCreateCGImageFromCVPixelBuffer is fast) before hopping queues.
        guard let uiImage = imageFromSampleBuffer(sampleBuffer) else { return }

        processingQueue.async { [weak self] in
            self?.processAndUpload(uiImage: uiImage, capturedAt: now, windowStart: windowStart)
            self?.currentWindowStart = now
        }
    }

    // MARK: - Frame processing

    private func imageFromSampleBuffer(_ sampleBuffer: CMSampleBuffer) -> UIImage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        var cgImage: CGImage?
        VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cgImage)
        guard let cgImage else { return nil }
        return UIImage(cgImage: cgImage)
    }

    /// Scales to max width 1280px, matching the main app's ImageProcessor exactly (kept
    /// as a local duplicate since extensions can't import the main app target).
    private func scaledDown(_ image: UIImage, maxWidth: CGFloat = 1280) -> UIImage {
        let size = image.size
        guard size.width > maxWidth else { return image }
        let scale = maxWidth / size.width
        let newSize = CGSize(width: maxWidth, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
    }

    private func recognizeText(in cgImage: CGImage) -> String? {
        let semaphore = DispatchSemaphore(value: 0)
        var resultText: String?
        let request = VNRecognizeTextRequest { request, error in
            defer { semaphore.signal() }
            guard error == nil, let observations = request.results as? [VNRecognizedTextObservation] else { return }
            resultText = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        }
        // BUG FIX: this used to run with .accurate on the FULL-RESOLUTION frame, called
        // TWICE per processed frame (once here for the whole-image OCR pass, once again
        // inside recognizeTopBarText's fallback path) inside a hard 50MB-memory-capped
        // extension process. Vision's .accurate recognizer allocates significant
        // internal working memory proportional to input image size, and doing that twice
        // on a full-resolution retina capture (which alone is already 10-25MB as a raw
        // decoded CGImage) reliably pushes total resident memory over the 50MB ceiling,
        // so iOS jetsam-kills the extension (EXC_RESOURCE / RESOURCE_TYPE_MEMORY) before
        // the pipeline ever reaches ExtensionConfigStore.setLastScreenshotAt or the
        // network POST -- which is exactly consistent with "Last frame captured on
        // device" never updating even though capture visibly starts. .fast trades some
        // recognition accuracy for a much smaller/faster pass and is the level Apple
        // explicitly recommends for memory/latency constrained contexts like this.
        request.recognitionLevel = .fast
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([request])
        _ = semaphore.wait(timeout: .now() + 10)
        return resultText
    }

    /// Crops the top ~6% of an already-scaled-down image and OCRs just that strip. Must
    /// only ever be called with the small (max-1280px-wide) image, never the raw capture
    /// -- see the memory-budget comment on processAndUpload.
    private func recognizeTopBarText(in scaledImage: UIImage) -> String? {
        guard let cgImage = scaledImage.cgImage else { return nil }
        let height = CGFloat(cgImage.height)
        let width = CGFloat(cgImage.width)
        let cropRect = CGRect(x: 0, y: 0, width: width, height: max(height * 0.06, 40))
        guard let cropped = cgImage.cropping(to: cropRect) else { return nil }
        return recognizeText(in: cropped)
    }

    private func processAndUpload(uiImage: UIImage, capturedAt: Date, windowStart: Date) {
        let scaled = scaledDown(uiImage)
        guard let jpegData = scaled.jpegData(compressionQuality: 0.55) else { return }
        let base64 = jpegData.base64EncodedString()

        // Record "captured on device" as soon as we have a usable encoded frame, BEFORE
        // the (slower, more memory-intensive) OCR passes and the network call. Previously
        // this was the very last line of the function, so any crash/jetsam-kill or stall
        // during OCR/upload meant this flag never got written at all, even though a frame
        // genuinely had been captured and encoded on-device -- this is the other half of
        // why "Last frame captured on device" appeared to never update.
        ExtensionConfigStore.setLastScreenshotAt(capturedAt)

        // MEMORY BUDGET: this extension process has a hard 50MB ceiling (see ReplayKit
        // docs / Apple developer forums re: EXC_RESOURCE RESOURCE_TYPE_MEMORY). Both OCR
        // passes below now run against `scaled` (max 1280px wide) instead of the raw,
        // full-resolution `uiImage` -- OCR-ing the original retina-resolution frame twice
        // per sample was the single largest avoidable memory/CPU cost in this pipeline and
        // the most likely reason the extension was being killed before it could report a
        // captured frame or complete an upload.
        let ocrText = scaled.cgImage.flatMap { recognizeText(in: $0) }
        let windowTitle = recognizeTopBarText(in: scaled) ?? "unknown"

        ExtensionApiClient.shared.postScreenshot(
            imageBase64: base64,
            ocrText: ocrText,
            activeWindowTitle: windowTitle,
            width: Int(scaled.size.width),
            height: Int(scaled.size.height),
            occurredAt: capturedAt
        )

        ExtensionApiClient.shared.postAppUsageSession(
            windowTitle: windowTitle,
            startedAt: windowStart,
            endedAt: capturedAt,
            occurredAt: capturedAt
        )
    }

    /// Called by the OS if the extension is about to be terminated (e.g. memory
    /// pressure). We surface a `finishBroadcastWithError` so the system broadcast bar
    /// correctly reflects that monitoring has stopped, prompting the user (or MDM
    /// compliance policy) to restart it.
    private func finishWithError(_ message: String) {
        let error = NSError(domain: "io.bheka.agent.broadcast", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        finishBroadcastWithError(error)
    }
}
