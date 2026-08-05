//
//  ContentView.swift
//  BhekaAgent
//
//  Enrollment + status UI. Lets an IT admin (or the MDM-managed configuration) fill in
//  the Bheka connection details, start/stop monitoring, and scan a QR enrollment code.
//
//  Starting monitoring does two things:
//   1. Persists the current config (UserDefaults + shared App Group defaults).
//   2. Presents RPSystemBroadcastPickerView so the user can start the
//      BhekaBroadcastExtension, which is what keeps capturing frames even while this
//      app is backgrounded/suspended. In-app capture (ScreenCaptureManager) is used as
//      a secondary path while this app itself is in the foreground.
//
import SwiftUI
import ReplayKit

struct ContentView: View {
    @StateObject private var viewModel = EnrollmentViewModel()
    @State private var showingQRScanner = false

    var body: some View {
        NavigationView {
            Form {
                statusSection
                configSection
                actionsSection
                aboutSection
            }
            .navigationTitle("Bheka Agent")
            .onAppear { viewModel.loadConfig() }
            .sheet(isPresented: $showingQRScanner) {
                QRScannerView(
                    onCodeScanned: { code in
                        showingQRScanner = false
                        viewModel.applyQRCode(code)
                    },
                    onCancel: { showingQRScanner = false }
                )
            }
        }
    }

    // MARK: - Sections

    private var statusSection: some View {
        Section("Status") {
            HStack {
                Circle()
                    .fill(viewModel.isMonitoringActive ? Color.green : Color.gray)
                    .frame(width: 12, height: 12)
                Text(viewModel.isMonitoringActive ? "Monitoring active" : "Monitoring inactive")
                    .font(.headline)
            }
            if let lastScreenshot = viewModel.lastScreenshotAt {
                Text("Last screenshot: \(lastScreenshot.formatted(date: .abbreviated, time: .standard))")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            if let error = viewModel.captureManager.lastError {
                Text(error)
                    .font(.footnote)
                    .foregroundColor(.red)
            }
        }
    }

    private var configSection: some View {
        Section("Configuration") {
            TextField("API URL", text: $viewModel.config.apiUrl)
                .keyboardType(.URL)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            SecureField("Agent Token", text: $viewModel.config.agentToken)
            TextField("Tenant Slug", text: $viewModel.config.tenantSlug)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            TextField("Site ID", text: $viewModel.config.siteId)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            TextField("Subject User ID", text: $viewModel.config.subjectUserId)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            TextField("Source Agent ID", text: $viewModel.config.sourceAgentId)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if viewModel.isConfigFromMDM {
                Label("Loaded from MDM Managed App Configuration", systemImage: "checkmark.shield")
                    .font(.footnote)
                    .foregroundColor(.blue)
            }

            Button {
                viewModel.saveConfig()
            } label: {
                Text("Save Configuration")
            }
        }
    }

    private var actionsSection: some View {
        Section("Actions") {
            Button {
                showingQRScanner = true
            } label: {
                Label("Scan QR Code", systemImage: "qrcode.viewfinder")
            }

            if viewModel.isMonitoringActive {
                Button(role: .destructive) {
                    viewModel.stopMonitoring()
                } label: {
                    Label("Stop Monitoring", systemImage: "stop.circle")
                }
            } else {
                Button {
                    viewModel.startMonitoringRequested = true
                } label: {
                    Label("Start Monitoring", systemImage: "record.circle")
                }
                .disabled(!viewModel.config.isComplete)
            }

            // RPSystemBroadcastPickerView must be presented via its own UIViewRepresentable
            // wrapper — there's no way to trigger the system broadcast picker purely in
            // code. We overlay a hidden picker and programmatically tap it once the user
            // confirms "Start Monitoring" above.
            if viewModel.startMonitoringRequested {
                BroadcastPickerView(preferredExtension: BroadcastConstants.extensionBundleId)
                    .frame(width: 1, height: 1)
                    .onAppear {
                        viewModel.saveConfig()
                        viewModel.captureManager.startCapture()
                    }
            }

            if !viewModel.config.isComplete {
                Text("Fill in all configuration fields (or scan a QR code) before starting monitoring.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var aboutSection: some View {
        Section("About") {
            Text("This device is monitored by your organization using the Bheka agent, as permitted by your company's device management (MDM) policy. Screen content, extracted text (OCR), and app usage timing are periodically sent to your organization's Bheka server.")
                .font(.footnote)
                .foregroundColor(.secondary)
        }
    }
}

/// Constants describing the Broadcast Upload Extension, used to hint the system picker
/// to preselect the Bheka extension instead of showing every installed broadcaster.
enum BroadcastConstants {
    /// Must match the bundle identifier of the BhekaBroadcastExtension target.
    static let extensionBundleId = "io.bheka.agent.BhekaBroadcastExtension"
}

/// UIViewRepresentable wrapper around RPSystemBroadcastPickerView, since SwiftUI has no
/// native equivalent. Presenting this view shows the system's "Start Broadcast" UI,
/// which the user must tap to actually begin the extension-based capture session.
struct BroadcastPickerView: UIViewRepresentable {
    let preferredExtension: String

    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: .zero)
        picker.preferredExtension = preferredExtension
        picker.showsMicrophoneButton = false
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}

/// Owns all enrollment/config/monitoring state for ContentView.
@MainActor
final class EnrollmentViewModel: ObservableObject {
    @Published var config: BhekaConfig = .empty
    @Published var isConfigFromMDM = false
    @Published var isMonitoringActive = false
    @Published var lastScreenshotAt: Date?
    @Published var startMonitoringRequested = false

    let captureManager = ScreenCaptureManager()
    private let appUsageTracker = AppUsageTracker.shared

    func loadConfig() {
        config = ConfigStore.load()
        isMonitoringActive = ConfigStore.isMonitoringActive()
        lastScreenshotAt = ConfigStore.lastScreenshotAt()
        appUsageTracker.start()
        refreshMDMFlag()
    }

    func saveConfig() {
        ConfigStore.save(config)
    }

    func applyQRCode(_ raw: String) {
        guard let payload = QRConfigParser.parse(raw) else {
            print("[EnrollmentViewModel] Failed to parse QR payload — not valid Bheka enrollment JSON.")
            return
        }
        config = ConfigStore.apply(qr: payload)
    }

    func stopMonitoring() {
        captureManager.stopCapture()
        isMonitoringActive = false
        startMonitoringRequested = false
    }

    private func refreshMDMFlag() {
        let managedDefaults = UserDefaults(suiteName: "ManagedAppConfiguration")
        let managed = managedDefaults?.dictionary(forKey: "com.apple.configuration.managed")
        isConfigFromMDM = managed != nil && !(managed?.isEmpty ?? true)
    }
}

#Preview {
    ContentView()
}
