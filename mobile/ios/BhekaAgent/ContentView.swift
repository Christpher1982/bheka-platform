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
            ZStack(alignment: .bottom) {
                Form {
                    statusSection
                    configSection
                    actionsSection
                    aboutSection
                }

                // IMPORTANT: RPSystemBroadcastPickerView must live OUTSIDE the Form/List.
                // Confirmed by on-device testing: when embedded as a Form/Section row, the
                // button is fully visible but taps on it are silently swallowed -- Form
                // renders as a UITableView under the hood, and its cell touch handling does
                // not forward touches to arbitrary embedded UIKit controls (only to native
                // SwiftUI Buttons, which is why every *other* button in this screen works
                // fine while this one alone did nothing). Presenting it as a floating
                // overlay above the Form, outside any List/Section, gives it a real,
                // unshadowed touch path.
                if viewModel.startMonitoringRequested {
                    broadcastPickerOverlay
                }
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

    private var broadcastPickerOverlay: some View {
        VStack(spacing: 10) {
            Text("Tap the blue button below to choose \"Bheka Monitoring\" and start background monitoring.")
                .font(.footnote)
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            ZStack {
                Circle()
                    .fill(Color.blue)
                    .frame(width: 64, height: 64)
                BroadcastPickerView(preferredExtension: BroadcastConstants.extensionBundleId)
                    .frame(width: 56, height: 56)
            }
        }
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
        .onAppear {
            viewModel.saveConfig()
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
                Text("Last frame captured on device: \(lastScreenshot.formatted(date: .abbreviated, time: .standard))")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }

            // This is the truthful signal: it only updates when the server actually
            // returned a 2xx for an uploaded event. "Captured on device" above can look
            // fine even when every single upload is silently failing (wrong network,
            // Tailscale not connected, bad token, etc.) — this line cannot lie the same way.
            HStack {
                Circle()
                    .fill(viewModel.lastUploadOkAt != nil && viewModel.lastUploadError == nil ? Color.green : (viewModel.lastUploadError != nil ? Color.red : Color.gray))
                    .frame(width: 8, height: 8)
                if let error = viewModel.lastUploadError {
                    Text("Upload failing: \(error)")
                        .font(.footnote)
                        .foregroundColor(.red)
                } else if let okAt = viewModel.lastUploadOkAt {
                    Text("Last confirmed server upload: \(okAt.formatted(date: .abbreviated, time: .standard))")
                        .font(.footnote)
                        .foregroundColor(.green)
                } else {
                    Text("No confirmed server upload yet")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
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

            // The actual RPSystemBroadcastPickerView button is rendered as a floating
            // overlay outside this Form -- see broadcastPickerOverlay / body. Embedding it
            // directly in this Section silently ate all taps on-device (see the comment on
            // broadcastPickerOverlay for the full explanation); this row only shows a hint
            // once Start Monitoring has been tapped.
            if viewModel.startMonitoringRequested {
                Text("Look for the floating blue button at the bottom of the screen and tap it to continue.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }

            if !viewModel.config.isComplete {
                Text("Fill in all configuration fields (or scan a QR code) before starting monitoring.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }

            Button {
                viewModel.testConnection()
            } label: {
                Label("Test Server Connection", systemImage: "network")
            }
            if viewModel.isTestingConnection {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Contacting \(viewModel.config.apiUrl)\u{2026}")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
            } else if let result = viewModel.connectionTestResult {
                Text(result.message)
                    .font(.footnote)
                    .foregroundColor(result.success ? .green : .red)
            }
        }
    }

    private var aboutSection: some View {
        Section("About") {
            Text("This device is monitored by your organization using the Bheka agent, as permitted by your company's device management (MDM) policy. Screen content, extracted text (OCR), and app usage timing are periodically sent to your organization's Bheka server.")
                .font(.footnote)
                .foregroundColor(.secondary)
            // CFBundleVersion is set to the short git SHA at build time (see build-ios.yml).
            // Surfacing it here means a single screenshot can always prove exactly which
            // build/commit is installed on a device -- this has repeatedly been the real
            // cause of "the fix didn't work" reports that were actually just a stale binary
            // that hadn't been reinstalled yet.
            Text("Build: \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown")")
                .font(.caption2)
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
        // Without an explicit tint, this control renders using the extension's icon
        // asset (if any) and can end up nearly invisible on a dark background --
        // exactly what happened in testing (the instructional text showed but the
        // button next to it was practically impossible to see/tap). Force a bright,
        // unmistakable tint so there's always something visible to tap regardless of
        // whether the extension bundle has its own icon set up.
        picker.tintColor = .white
        picker.backgroundColor = .clear
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
    @Published var lastUploadOkAt: Date?
    @Published var lastUploadError: String?
    @Published var isTestingConnection = false
    @Published var connectionTestResult: (success: Bool, message: String)?

    let captureManager = ScreenCaptureManager()
    private let appUsageTracker = AppUsageTracker.shared

    private var statusRefreshTimer: Timer?

    func loadConfig() {
        config = ConfigStore.load()
        isMonitoringActive = ConfigStore.isMonitoringActive()
        lastScreenshotAt = ConfigStore.lastScreenshotAt()
        lastUploadOkAt = ConfigStore.lastUploadOkAt()
        lastUploadError = ConfigStore.lastUploadError()
        appUsageTracker.start()
        refreshMDMFlag()
        startStatusPolling()
    }

    func testConnection() {
        isTestingConnection = true
        connectionTestResult = nil
        ApiClient.shared.testConnection(apiUrl: config.apiUrl) { [weak self] (result: Result<String, ConnectionTestError>) in
            guard let self else { return }
            self.isTestingConnection = false
            switch result {
            case .success(let message):
                self.connectionTestResult = (true, message)
            case .failure(let error):
                self.connectionTestResult = (false, error.message)
            }
        }
    }

    /// The actual capture engine — either the in-app RPScreenRecorder path
    /// (ScreenCaptureManager) or the BhekaBroadcastExtension — writes
    /// `BHEKA_MONITORING_ACTIVE` into the shared App Group defaults from a different
    /// process/thread than this view model. SwiftUI has no way to observe that shared
    /// storage directly, so we poll it on a short timer while the app is active and
    /// mirror it into the `@Published` property the UI actually reads.
    private func startStatusPolling() {
        statusRefreshTimer?.invalidate()
        statusRefreshTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.isMonitoringActive = ConfigStore.isMonitoringActive()
                self.lastScreenshotAt = ConfigStore.lastScreenshotAt()
                self.lastUploadOkAt = ConfigStore.lastUploadOkAt()
                self.lastUploadError = ConfigStore.lastUploadError()
            }
        }
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
        // This must be persisted to the shared App Group store, not just the local
        // @Published property -- the 2s status-polling timer below reads straight from
        // ConfigStore.isMonitoringActive() and will silently stomp the local value back
        // to true within a couple seconds otherwise, which is exactly why "Stop Monitoring"
        // appeared to do nothing in testing (confirmed: screenshots always showed it
        // snapping back to "Monitoring active").
        ConfigStore.setMonitoringActive(false)
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
