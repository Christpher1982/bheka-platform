//
//  QRScanner.swift
//  BhekaAgent
//
//  AVFoundation-based QR code scanner used for device enrollment. Scans a QR code
//  containing the same JSON config payload format used by the Android agent:
//    { "apiUrl": "...", "token": "...", "tenantSlug": "...", "siteId": "...",
//      "subjectUserId": "...", "agentId": "..." }
//
import AVFoundation
import SwiftUI
import UIKit

/// SwiftUI wrapper around an AVFoundation capture session that watches for QR codes.
/// Presented as a full-screen sheet from ContentView.
struct QRScannerView: UIViewControllerRepresentable {
    var onCodeScanned: (String) -> Void
    var onCancel: () -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onCodeScanned = onCodeScanned
        controller.onCancel = onCancel
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

/// UIKit view controller that owns the AVCaptureSession, preview layer, and metadata
/// output delegate for QR recognition.
final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {

    var onCodeScanned: ((String) -> Void)?
    var onCancel: (() -> Void)?

    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasScanned = false

    override func viewDidLoad() {
        super.viewDidLoad()
        // Deep charcoal grey, matching the rest of the app's background instead of
        // plain black -- only visible briefly before the camera preview layer covers
        // it, but keeps the whole app consistent with the approved visual direction.
        view.backgroundColor = UIColor(red: 0.065, green: 0.068, blue: 0.075, alpha: 1.0)
        configureSessionIfAuthorized()
        addCancelButton()
        addHintLabel()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if captureSession.isRunning {
            captureSession.stopRunning()
        }
    }

    // MARK: - Setup

    private func configureSessionIfAuthorized() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.setupSession()
                    } else {
                        self?.showPermissionDeniedAlert()
                    }
                }
            }
        default:
            showPermissionDeniedAlert()
        }
    }

    private func setupSession() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else {
            showAlert(title: "Camera Unavailable", message: "No camera input could be created on this device.")
            return
        }

        guard captureSession.canAddInput(input) else { return }
        captureSession.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else { return }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: captureSession)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.startRunning()
        }
    }

    // MARK: - AVCaptureMetadataOutputObjectsDelegate

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasScanned else { return }
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr,
              let value = object.stringValue else { return }

        hasScanned = true
        captureSession.stopRunning()
        onCodeScanned?(value)
    }

    // MARK: - UI chrome

    // VISUAL REDESIGN NOTE: restyled to the frosted-glass + light-green-accent language
    // used across the main app target (see Theme.swift). This is UIKit chrome (not
    // SwiftUI), so it uses UIVisualEffectView for the same translucent blur effect as
    // .ultraThinMaterial elsewhere -- purely presentational, no behavior changes.
    private func addCancelButton() {
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        blur.layer.cornerRadius = 18
        blur.layer.masksToBounds = true
        blur.layer.borderWidth = 1
        blur.layer.borderColor = UIColor.white.withAlphaComponent(0.14).cgColor
        blur.translatesAutoresizingMaskIntoConstraints = false

        let button = UIButton(type: .system)
        button.setTitle("Cancel", for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 18, bottom: 8, right: 18)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        view.addSubview(blur)
        blur.contentView.addSubview(button)
        NSLayoutConstraint.activate([
            blur.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            blur.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            button.topAnchor.constraint(equalTo: blur.topAnchor),
            button.bottomAnchor.constraint(equalTo: blur.bottomAnchor),
            button.leadingAnchor.constraint(equalTo: blur.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: blur.trailingAnchor)
        ])
    }

    private func addHintLabel() {
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        blur.layer.cornerRadius = 14
        blur.layer.masksToBounds = true
        blur.layer.borderWidth = 1
        blur.layer.borderColor = UIColor.white.withAlphaComponent(0.14).cgColor
        blur.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.text = "Point the camera at the Bheka enrollment QR code"
        label.textColor = .white
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(blur)
        blur.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            blur.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            blur.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            blur.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -32),
            label.topAnchor.constraint(equalTo: blur.topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: blur.bottomAnchor, constant: -12),
            label.leadingAnchor.constraint(equalTo: blur.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: blur.trailingAnchor, constant: -16)
        ])
    }

    @objc private func cancelTapped() {
        onCancel?()
    }

    private func showPermissionDeniedAlert() {
        showAlert(
            title: "Camera Access Needed",
            message: "Enable camera access for BhekaAgent in Settings to scan enrollment QR codes.",
            actionTitle: "Open Settings"
        ) {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        }
    }

    private func showAlert(title: String, message: String, actionTitle: String = "OK", action: (() -> Void)? = nil) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: actionTitle, style: .default) { _ in action?() })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.onCancel?() })
        present(alert, animated: true)
    }
}

/// Parses a scanned QR string into a `QRConfigPayload`. Returns nil if the payload isn't
/// valid JSON or is missing required fields.
enum QRConfigParser {
    static func parse(_ raw: String) -> QRConfigPayload? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(QRConfigPayload.self, from: data)
    }
}
