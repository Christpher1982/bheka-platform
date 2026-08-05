//
//  OCRProcessor.swift
//  BhekaAgent
//
//  Wraps Apple Vision's VNRecognizeTextRequest to extract on-screen text from captured
//  frames. This OCR text is what the iOS agent sends in place of the keystroke stream
//  that the Android agent captures directly — iOS does not permit any app to observe
//  keystrokes typed into other apps, so on-screen text is the closest legal equivalent.
//
import Vision
import UIKit
import CoreImage

enum OCRProcessor {

    /// Runs Vision text recognition on `cgImage` and returns the concatenated recognized
    /// text, or nil if recognition fails or Vision is unavailable. This is a synchronous
    /// wrapper around Vision's async request, intended for use from a background queue
    /// (never call from the main thread for large images).
    static func recognizeText(in cgImage: CGImage) -> String? {
        let semaphore = DispatchSemaphore(value: 0)
        var resultText: String?

        let request = VNRecognizeTextRequest { request, error in
            defer { semaphore.signal() }
            if let error {
                print("[OCRProcessor] Vision request failed: \(error.localizedDescription)")
                return
            }
            guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
            let lines = observations.compactMap { $0.topCandidates(1).first?.string }
            resultText = lines.joined(separator: "\n")
        }

        // .accurate trades latency for higher-quality recognition, which matters for
        // small UI text in screenshots (menu bars, dialog text, etc.).
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            print("[OCRProcessor] Failed to perform Vision request: \(error.localizedDescription)")
            return nil
        }

        // Bound the wait so a pathological image can't hang the capture pipeline forever.
        _ = semaphore.wait(timeout: .now() + 10)
        return resultText
    }

    /// Convenience overload for `UIImage` inputs.
    static func recognizeText(in image: UIImage) -> String? {
        guard let cgImage = image.cgImage else { return nil }
        return recognizeText(in: cgImage)
    }

    /// Best-effort extraction of just the top status-bar / title-bar strip of a screenshot,
    /// used by AppUsageTracker to populate `windowTitle` when no better signal exists.
    /// Crops the top ~6% of the image (where iOS status bars and app title bars usually sit)
    /// before running recognition, which is faster and less noisy than OCR-ing the whole frame.
    static func recognizeTopBarText(in image: UIImage) -> String? {
        guard let cgImage = image.cgImage else { return nil }
        let height = CGFloat(cgImage.height)
        let width = CGFloat(cgImage.width)
        let cropRect = CGRect(x: 0, y: 0, width: width, height: max(height * 0.06, 40))
        guard let cropped = cgImage.cropping(to: cropRect) else { return recognizeText(in: cgImage) }
        return recognizeText(in: cropped)
    }
}
