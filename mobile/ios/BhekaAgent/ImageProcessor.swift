//
//  ImageProcessor.swift
//  BhekaAgent
//
//  Utilities to convert raw ReplayKit frames into API-ready JPEG payloads: scale down to
//  a max width of 1280px (matching the Android agent's screenshot pipeline) and compress
//  as JPEG at quality 0.55.
//
import UIKit
import CoreImage
import CoreMedia
import VideoToolbox

enum ImageProcessor {

    /// Maximum width, in points/pixels, for outgoing screenshots. Height is scaled
    /// proportionally. Keeps upload payloads small and consistent with the Android agent.
    static let maxWidth: CGFloat = 1280

    /// JPEG compression quality used for all outgoing screenshots.
    static let jpegQuality: CGFloat = 0.55

    /// Converts a `CMSampleBuffer` (as delivered by ReplayKit's `startCapture` handler or
    /// the Broadcast Upload Extension's `processSampleBuffer`) into a `UIImage`.
    static func image(from sampleBuffer: CMSampleBuffer) -> UIImage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }

        var cgImage: CGImage?
        VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cgImage)
        guard let cgImage else { return nil }
        return UIImage(cgImage: cgImage)
    }

    /// Scales `image` down so its width does not exceed `maxWidth`, preserving aspect
    /// ratio. Images already narrower than `maxWidth` are returned unchanged.
    static func scaledDown(_ image: UIImage, maxWidth: CGFloat = ImageProcessor.maxWidth) -> UIImage {
        let size = image.size
        guard size.width > maxWidth else { return image }

        let scale = maxWidth / size.width
        let newSize = CGSize(width: maxWidth, height: size.height * scale)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1 // we want actual pixel dimensions, not device-scale multiples
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    /// Full pipeline: scale to max width, then JPEG-compress at the standard quality.
    /// Returns both the JPEG `Data` and the final pixel dimensions for the API payload.
    static func processForUpload(_ image: UIImage) -> (jpegData: Data, width: Int, height: Int)? {
        let scaled = scaledDown(image)
        guard let jpegData = scaled.jpegData(compressionQuality: jpegQuality) else { return nil }
        return (jpegData, Int(scaled.size.width), Int(scaled.size.height))
    }

    /// Base64-encodes JPEG data for the `screenshotImageBase64` field.
    static func base64(_ data: Data) -> String {
        data.base64EncodedString()
    }
}
