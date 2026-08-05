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
//  VISUAL REDESIGN NOTE: this file was restyled to the grey-glass + green-accent visual
//  direction (deep charcoal background, frosted glassmorphism cards, single light-green
//  accent, bottom docked action bar). All state, bindings, and behavior are unchanged --
//  every button/field still calls exactly the same EnrollmentViewModel methods it did
//  before. Shared visual building blocks live in Theme.swift.
//
import SwiftUI
import ReplayKit

struct ContentView: View {
    @StateObject private var viewModel = EnrollmentViewModel()
    @State private var showingQRScanner = false

    var body: some View {
        NavigationView {
            ZStack(alignment: .bottom) {
                BhekaTheme.backgroundGradient

                ScrollView {
                    VStack(spacing: 20) {
                        header

                        statusCard
                        configCard
                        actionsCard
                        aboutCard

                        // Reserve space so content can scroll clear of the docked
                        // bottom action bar instead of being covered by it.
                        Color.clear.frame(height: 96)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                }

                // Bottom docked action bar: pill-shaped frosted glass bar containing the
                // primary start/stop control. The RPSystemBroadcastPickerView itself
                // still lives outside the ScrollView/Form content (see the long-standing
                // comment below) -- it is now docked inside this bar's frame instead of
                // floating loosely over the content, but its own hit-testing path is
                // unchanged.
                bottomActionBar
            }
            .navigationBarHidden(true)
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
        .navigationViewStyle(.stack)
        .preferredColorScheme(.dark)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            AppHeaderTitle(title: "Bheka Agent")
            Spacer()
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    // MARK: - Bottom docked broadcast action bar
    //
    // IMPORTANT: RPSystemBroadcastPickerView must live OUTSIDE the ScrollView content
    // (previously: outside the Form). Confirmed by on-device testing: when embedded as
    // a Form/Section row, the button is fully visible but taps on it are silently
    // swallowed -- Form/List-backed containers render as a UITableView under the hood,
    // and cell touch handling does not forward touches to arbitrary embedded UIKit
    // controls (only to native SwiftUI Buttons, which is why every *other* button in
    // this screen works fine while this one alone did nothing). Presenting it as a
    // sibling overlay anchored to the bottom of the ZStack, outside any List/Section/
    // ScrollView, gives it a real, unshadowed touch path. This redesign keeps that same
    // structural placement -- it is now visually docked inside a pill-shaped glass bar
    // instead of floating loosely, but it remains a ZStack sibling of the scrollable
    // content, not a descendant of it.
    private var bottomActionBar: some View {
        VStack(spacing: 10) {
            if viewModel.startMonitoringRequested {
                instructionalCallout
            }

            HStack {
                Spacer()
                ZStack {
                    if viewModel.isMonitoringActive {
                        // Already broadcasting: show a plain "Stop Monitoring" control
                        // docked in the same bar position so the bar's layout doesn't
                        // jump between states.
                        dockedStopButton
                    } else if viewModel.startMonitoringRequested {
                        dockedBroadcastPicker
                    } else {
                        dockedStartButton
                    }
                }
                Spacer()
            }
            .frame(height: 76)

            Text(primaryActionCaption)
                .font(.system(.footnote, design: .rounded).weight(.medium))
                .foregroundColor(BhekaTheme.textSecondary)
                .padding(.bottom, 4)
        }
        .padding(.top, 14)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .background(
            Capsule(style: .continuous)
                .fill(Color.black.opacity(0.22))
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(BhekaTheme.cardBorder, lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.bottom, 20)
        .disabled(!viewModel.config.isComplete && !viewModel.isMonitoringActive)
        .opacity((!viewModel.config.isComplete && !viewModel.isMonitoringActive) ? 0.55 : 1.0)
    }

    private var primaryActionCaption: String {
        if viewModel.isMonitoringActive {
            return "Monitoring is active -- tap to stop"
        } else if viewModel.startMonitoringRequested {
            return "Tap the button to confirm \u{201C}Bheka Monitoring\u{201D}"
        } else if !viewModel.config.isComplete {
            return "Fill in all configuration fields to enable monitoring"
        } else {
            return "Tap to start monitoring"
        }
    }

    /// Large circular start button shown before monitoring has been requested. Tapping
    /// it reveals the real RPSystemBroadcastPickerView (dockedBroadcastPicker) in the
    /// same spot, matching the reference image's single docked circular control.
    private var dockedStartButton: some View {
        Button {
            viewModel.startMonitoringRequested = true
        } label: {
            ZStack {
                Circle()
                    .fill(BhekaTheme.accentDim)
                    .frame(width: 84, height: 84)
                    .blur(radius: 12)
                Circle()
                    .fill(Color.white.opacity(0.14))
                    .frame(width: 64, height: 64)
                Circle()
                    .stroke(BhekaTheme.accent, lineWidth: 2)
                    .frame(width: 64, height: 64)
                    .shadow(color: BhekaTheme.accent.opacity(0.8), radius: 10)
                Image(systemName: "chevron.right.2")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(BhekaTheme.accent)
            }
        }
        .buttonStyle(.plain)
        .disabled(!viewModel.config.isComplete)
    }

    private var dockedStopButton: some View {
        Button(role: .destructive) {
            viewModel.stopMonitoring()
        } label: {
            ZStack {
                Circle()
                    .fill(BhekaTheme.accentDim)
                    .frame(width: 84, height: 84)
                    .blur(radius: 12)
                Circle()
                    .fill(Color.white.opacity(0.14))
                    .frame(width: 64, height: 64)
                Circle()
                    .stroke(BhekaTheme.accent, lineWidth: 2)
                    .frame(width: 64, height: 64)
                    .shadow(color: BhekaTheme.accent.opacity(0.8), radius: 10)
                Image(systemName: "stop.fill")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(BhekaTheme.accent)
            }
        }
        .buttonStyle(.plain)
    }

    /// Docked container for the real RPSystemBroadcastPickerView. This restyles only the
    /// surrounding chrome (glow ring, translucent disc behind it) -- the picker view
    /// itself is unchanged from broadcastPickerView below and keeps its exact working
    /// sizing fix from commit dec2a09.
    private var dockedBroadcastPicker: some View {
        ZStack {
            Circle()
                .fill(BhekaTheme.accentDim)
                .frame(width: 84, height: 84)
                .blur(radius: 14)
            Circle()
                .fill(Color.white.opacity(0.16))
                .frame(width: 64, height: 64)
                .allowsHitTesting(false)
            Circle()
                .stroke(BhekaTheme.accent, lineWidth: 2)
                .frame(width: 64, height: 64)
                .shadow(color: BhekaTheme.accent.opacity(0.9), radius: 12)
                // ROOT CAUSE FIX (preserved from the original implementation): this ring
                // used to be an ordinary sibling in the ZStack with no hit-testing
                // opinion of its own. That is *not* what was swallowing the tap
                // (SwiftUI ZStack hit-tests top-most-drawn view first, and the picker is
                // drawn after/above this ring), but we explicitly disable hit-testing on
                // it anyway so it can never be implicated again and so the picker is
                // unambiguously the only interactive element in this stack.
                .allowsHitTesting(false)
            broadcastPickerView
                .frame(width: 56, height: 56)
        }
        .onAppear {
            viewModel.saveConfig()
        }
    }

    /// Builds the actual `BroadcastPickerView`. Split out from `dockedBroadcastPicker`
    /// so the `#if DEBUG` branch can wrap two complete, independently valid
    /// initializer calls rather than a bare trailing-argument fragment -- splitting a
    /// single call's argument list across a `#if`/`#endif` (as an earlier version of
    /// this file did) does not parse: Swift's conditional compilation directives must
    /// wrap whole statements/declarations, not a mid-argument-list comma continuation,
    /// and doing so is a straight compiler error ("expected ')' in expression list").
    private var broadcastPickerView: some View {
#if DEBUG
        return BroadcastPickerView(
            preferredExtension: BroadcastConstants.extensionBundleId,
            onTouchDetected: { viewModel.pickerTouchProbeCount += 1 }
        )
#else
        return BroadcastPickerView(
            preferredExtension: BroadcastConstants.extensionBundleId
        )
#endif
    }

    /// Polished instructional callout shown above the action bar once "Start
    /// Monitoring" has been tapped, replacing the previous ad-hoc floating banner with
    /// a small pill that matches the rest of the glass/green visual language.
    private var instructionalCallout: some View {
        HStack(spacing: 10) {
            Image(systemName: "hand.tap.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(BhekaTheme.accent)
            Text("Tap the glowing button below and choose \u{201C}Bheka Monitoring\u{201D} to start background monitoring.")
                .font(.system(.footnote, design: .rounded).weight(.medium))
                .foregroundColor(BhekaTheme.textPrimary)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            Capsule(style: .continuous)
                .fill(Color.black.opacity(0.35))
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(BhekaTheme.accentDim, lineWidth: 1)
        )
        .padding(.horizontal, 20)
#if DEBUG
        .overlay(alignment: .top) {
            Text("Picker frame touches: \(viewModel.pickerTouchProbeCount)")
                .font(.caption2.monospacedDigit())
                .foregroundColor(BhekaTheme.accent)
                .padding(.top, -16)
        }
#endif
    }

    // MARK: - Status card

    private var statusCard: some View {
        GlassCard {
            GlassSectionLabel(title: "Status")

            HStack(spacing: 14) {
                StatusRing(isActive: viewModel.isMonitoringActive, diameter: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.isMonitoringActive ? "Monitoring Active" : "Monitoring Inactive")
                        .font(.system(.headline, design: .rounded).weight(.bold))
                        .foregroundColor(BhekaTheme.textPrimary)
                    if let lastScreenshot = viewModel.lastScreenshotAt {
                        Text("Last frame: \(lastScreenshot.formatted(date: .abbreviated, time: .standard))")
                            .font(.caption)
                            .foregroundColor(BhekaTheme.textSecondary)
                    } else {
                        Text("No frame captured yet")
                            .font(.caption)
                            .foregroundColor(BhekaTheme.textTertiary)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            GlassHairline()

            // This is the truthful signal: it only updates when the server actually
            // returned a 2xx for an uploaded event. "Captured on device" above can look
            // fine even when every single upload is silently failing (wrong network,
            // Tailscale not connected, bad token, etc.) -- this line cannot lie the
            // same way.
            HStack(spacing: 10) {
                StatusDot(state: uploadDotState)
                Group {
                    if let error = viewModel.lastUploadError {
                        Text("Upload failing: \(error)")
                            .foregroundColor(BhekaTheme.danger)
                    } else if let okAt = viewModel.lastUploadOkAt {
                        Text("Last confirmed upload: \(okAt.formatted(date: .abbreviated, time: .standard))")
                            .foregroundColor(BhekaTheme.textSecondary)
                    } else {
                        Text("No confirmed server upload yet")
                            .foregroundColor(BhekaTheme.textTertiary)
                    }
                }
                .font(.system(.footnote, design: .rounded))
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            if let error = viewModel.captureManager.lastError {
                GlassHairline()
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(BhekaTheme.danger)
                        .font(.caption)
                    Text(error)
                        .font(.footnote)
                        .foregroundColor(BhekaTheme.danger)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }

            // Diagnostic-only: surfaces the Broadcast Extension's own heartbeat (see
            // ExtensionConfigStore.markExtensionAlive / SampleHandler) so the next
            // physical-device test can immediately tell whether the extension process
            // ever launched at all, and if so exactly which pipeline stage it last
            // checked in from before going quiet -- there was previously no way to
            // distinguish "never launched", "launched then died quickly", and "still
            // alive but stuck" from the host app's side. Display only -- the underlying
            // heartbeat-writing logic in ExtensionConfigStore is unchanged.
            if let aliveAt = viewModel.extensionLastAliveAt, let stage = viewModel.extensionLastStage {
                GlassHairline()
                HStack(spacing: 10) {
                    Image(systemName: "waveform.path.ecg")
                        .foregroundColor(BhekaTheme.iconGrey)
                        .font(.caption)
                    Text("Extension last checked in: \(aliveAt.formatted(date: .omitted, time: .standard)) (\(stage))")
                        .font(.caption2)
                        .foregroundColor(BhekaTheme.textTertiary)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
        }
    }

    private var uploadDotState: StatusDot.State {
        if viewModel.lastUploadError != nil { return .bad }
        if viewModel.lastUploadOkAt != nil { return .good }
        return .neutral
    }

    // MARK: - Configuration card

    private var configCard: some View {
        GlassCard {
            GlassSectionLabel(title: "Configuration")

            // Grouped explicitly to stay comfortably under SwiftUI's per-block
            // ViewBuilder child limit now that this card holds six input rows plus
            // their hairline separators.
            Group {
                GlassTextRow(label: "API URL", text: $viewModel.config.apiUrl, keyboardType: .URL)
                GlassHairline()
                GlassSecureRow(label: "Agent Token", text: $viewModel.config.agentToken)
                GlassHairline()
                GlassTextRow(label: "Tenant Slug", text: $viewModel.config.tenantSlug)
                GlassHairline()
            }
            Group {
                GlassTextRow(label: "Site ID", text: $viewModel.config.siteId)
                GlassHairline()
                GlassTextRow(label: "Subject User ID", text: $viewModel.config.subjectUserId)
                GlassHairline()
                GlassTextRow(label: "Source Agent ID", text: $viewModel.config.sourceAgentId)
            }

            if viewModel.isConfigFromMDM {
                GlassHairline()
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.shield.fill")
                        .foregroundColor(BhekaTheme.accent)
                        .font(.caption)
                    Text("Loaded from MDM Managed App Configuration")
                        .font(.footnote)
                        .foregroundColor(BhekaTheme.textSecondary)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }

            VStack {
                Button {
                    viewModel.saveConfig()
                } label: {
                    Text("Save Configuration")
                }
                .buttonStyle(GlassButtonStyle(tint: BhekaTheme.textPrimary))
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 18)
        }
    }

    // MARK: - Actions card

    private var actionsCard: some View {
        GlassCard {
            GlassSectionLabel(title: "Actions")

            VStack(spacing: 10) {
                Button {
                    showingQRScanner = true
                } label: {
                    Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                }
                .buttonStyle(GlassButtonStyle(tint: BhekaTheme.textPrimary))

                Button {
                    viewModel.testConnection()
                } label: {
                    Label("Test Server Connection", systemImage: "network")
                }
                .buttonStyle(GlassButtonStyle(tint: BhekaTheme.textPrimary))

                if viewModel.isTestingConnection {
                    HStack(spacing: 8) {
                        ProgressView()
                            .tint(BhekaTheme.accent)
                        Text("Contacting \(viewModel.config.apiUrl)\u{2026}")
                            .font(.footnote)
                            .foregroundColor(BhekaTheme.textSecondary)
                        Spacer()
                    }
                } else if let result = viewModel.connectionTestResult {
                    HStack(spacing: 8) {
                        StatusDot(state: result.success ? .good : .bad)
                        Text(result.message)
                            .font(.footnote)
                            .foregroundColor(result.success ? BhekaTheme.textSecondary : BhekaTheme.danger)
                        Spacer()
                    }
                }

                if !viewModel.config.isComplete {
                    Text("Fill in all configuration fields (or scan a QR code) before starting monitoring.")
                        .font(.footnote)
                        .foregroundColor(BhekaTheme.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
    }

    // MARK: - About card

    private var aboutCard: some View {
        GlassCard {
            GlassSectionLabel(title: "About")

            VStack(alignment: .leading, spacing: 10) {
                Text("This device is monitored by your organization using the Bheka agent, as permitted by your company's device management (MDM) policy. Screen content, extracted text (OCR), and app usage timing are periodically sent to your organization's Bheka server.")
                    .font(.footnote)
                    .foregroundColor(BhekaTheme.textSecondary)
                // CFBundleVersion is set to the short git SHA at build time (see
                // build-ios.yml). Surfacing it here means a single screenshot can
                // always prove exactly which build/commit is installed on a device --
                // this has repeatedly been the real cause of "the fix didn't work"
                // reports that were actually just a stale binary that hadn't been
                // reinstalled yet.
                Text("Build: \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown")")
                    .font(.caption2)
                    .foregroundColor(BhekaTheme.textTertiary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
    }
}

// MARK: - Configuration row building blocks

/// Clean input row matching the reference image's separated-row configuration list:
/// a small grey caption label above a plain-styled text field, with hairlines added
/// between rows by the caller (GlassHairline). Purely presentational -- the binding
/// passed in is the same `viewModel.config.*` binding used before this redesign.
struct GlassTextRow: View {
    let label: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(.caption2, design: .rounded).weight(.semibold))
                .foregroundColor(BhekaTheme.textTertiary)
            TextField("", text: $text)
                .font(.system(.body, design: .rounded))
                .foregroundColor(BhekaTheme.textPrimary)
                .keyboardType(keyboardType)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}

/// Same row treatment as GlassTextRow but for the secret agent token field.
struct GlassSecureRow: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(.caption2, design: .rounded).weight(.semibold))
                .foregroundColor(BhekaTheme.textTertiary)
            SecureField("", text: $text)
                .font(.system(.body, design: .rounded))
                .foregroundColor(BhekaTheme.textPrimary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
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
///
/// VISUAL REDESIGN NOTE: this type is UNCHANGED from before the redesign. Only its
/// container/surroundings (dockedBroadcastPicker above) were restyled -- the picker's
/// own construction, sizing, and tinting below are untouched so the working
/// tap-registration fix from commit dec2a09 cannot regress.
struct BroadcastPickerView: UIViewRepresentable {
    let preferredExtension: String
#if DEBUG
    var onTouchDetected: (() -> Void)? = nil
#endif

    // ROOT CAUSE of the tap-not-working bug: RPSystemBroadcastPickerView does NOT
    // resize its internal UIButton subview in response to later Auto Layout / frame
    // changes -- this is a long-documented ReplayKit quirk (see e.g.
    // https://stackoverflow.com/questions/66190741/why-is-rpbroadcastpickerview-rendering-a-blank-white-screen
    // and the Apple Developer Forums ReplayKit threads: "changing the frame property
    // doesn't resize RPSystemBroadcastPickerView... Autolayout doesn't resize the view
    // as well... calling initWithFrame with a real size is the only correct solution").
    // The previous code did `RPSystemBroadcastPickerView(frame: .zero)` and relied
    // entirely on the SwiftUI `.frame(width: 56, height: 56)` modifier applied to the
    // wrapper further up the view tree. That modifier resizes the *outer*
    // UIHostingView-managed container via Auto Layout, but never reaches into the
    // picker's own internal button subview, which stays permanently sized to whatever
    // was passed at init time -- i.e. zero. A zero-sized internal UIButton cannot
    // receive touchUpInside, so every tap in the visually-56x56-looking button area
    // hit the (correctly sized) outer container view and went nowhere: no gesture
    // recognizer or button target ever fired. This is exactly consistent with what was
    // observed -- a fully visible, correctly laid-out button that never responds to any
    // tap, on every one of the 3 previous fix attempts, none of which touched this line.
    //
    // Fix: construct the picker with its real, final on-screen size up front so its
    // internal button is laid out correctly from the start.
    static let pickerSize = CGSize(width: 56, height: 56)

    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(
            frame: CGRect(origin: .zero, size: Self.pickerSize)
        )
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
        // Belt-and-suspenders: some iOS versions have been observed leaving
        // isUserInteractionEnabled at its default (true) but with a stray disabled
        // ancestor; asserting it explicitly here means a regression would be caught by
        // just reading this file rather than needing a device to notice taps stopped
        // working again.
        picker.isUserInteractionEnabled = true

#if DEBUG
        // Non-consuming touch probe: a UITapGestureRecognizer with
        // cancelsTouchesInView = false observes every touch that lands in the picker's
        // bounds WITHOUT intercepting or consuming it, so the picker's own internal
        // button still receives the touch normally afterward. This is what lets
        // on-device testing tell apart "tap never reaches this view" (counter stays at
        // 0) from "view gets the tap but the picker itself doesn't launch the sheet"
        // (counter increments, no sheet).
        let probe = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleProbeTap)
        )
        probe.cancelsTouchesInView = false
        probe.delegate = context.coordinator
        picker.addGestureRecognizer(probe)
#endif
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}

#if DEBUG
    func makeCoordinator() -> Coordinator {
        Coordinator(onTouchDetected: onTouchDetected)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let onTouchDetected: (() -> Void)?

        init(onTouchDetected: (() -> Void)?) {
            self.onTouchDetected = onTouchDetected
        }

        @objc func handleProbeTap() {
            onTouchDetected?()
        }

        // Required so this recognizer runs alongside whatever internal gesture
        // recognizer(s) RPSystemBroadcastPickerView's own UIButton uses -- without this,
        // UIKit's default "one gesture wins" behavior could make the probe itself the
        // thing swallowing the tap, which would defeat its entire purpose as a
        // non-invasive diagnostic.
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
#endif
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
    @Published var extensionLastAliveAt: Date?
    @Published var extensionLastStage: String?
#if DEBUG
    /// Diagnostic-only counter incremented by BroadcastPickerView's non-consuming touch
    /// probe. See the comment on BroadcastPickerView for how this is used to tell apart
    /// "tap not reaching the view" from "view receiving tap but picker not launching".
    @Published var pickerTouchProbeCount = 0
#endif

    let captureManager = ScreenCaptureManager()
    private let appUsageTracker = AppUsageTracker.shared

    private var statusRefreshTimer: Timer?

    func loadConfig() {
        config = ConfigStore.load()
        isMonitoringActive = ConfigStore.isMonitoringActive()
        lastScreenshotAt = ConfigStore.lastScreenshotAt()
        lastUploadOkAt = ConfigStore.lastUploadOkAt()
        lastUploadError = ConfigStore.lastUploadError()
        extensionLastAliveAt = ConfigStore.extensionLastAliveAt()
        extensionLastStage = ConfigStore.extensionLastStage()
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
                self.extensionLastAliveAt = ConfigStore.extensionLastAliveAt()
                self.extensionLastStage = ConfigStore.extensionLastStage()

                // UI BUG FIX: startMonitoringRequested was never cleared once the user
                // actually picked "Bheka Monitoring" and the broadcast genuinely started
                // -- it was ONLY reset inside stopMonitoring(). That left the floating
                // picker overlay permanently covering the bottom of the screen for the
                // rest of the session: after backgrounding/foregrounding or navigating
                // to the QR scanner sheet and back, the user would land back on a screen
                // that still visually says "tap the button below to start" even though
                // monitoring is genuinely active underneath, which reads exactly like
                // "the broadcast stopped" even when ReplayKit itself never stopped
                // anything. Once the poll confirms real capture is underway, dismiss the
                // overlay so the UI reflects reality.
                if self.isMonitoringActive && self.startMonitoringRequested {
                    self.startMonitoringRequested = false
                }
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
