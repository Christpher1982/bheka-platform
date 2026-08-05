//
//  Theme.swift
//  BhekaAgent
//
//  Shared visual design system for the main app target: deep charcoal background,
//  frosted glassmorphism cards, and a single light-green accent used sparingly for
//  active/success states. Introduced as part of the grey-glass + green-accent
//  redesign -- see PR description for the approved reference direction.
//
//  This file is purely additive/visual: it defines reusable colors, view modifiers,
//  and small building-block views (glass card, section header, hairline divider,
//  status dot/ring) that the screens in this target compose. It does not touch any
//  business logic, ConfigStore, ExtensionConfigStore, or the broadcast extension.
//
import SwiftUI

enum BhekaTheme {
    // MARK: - Palette

    /// Deep charcoal grey background -- intentionally not pure black and not navy,
    /// to read as a restrained, professional "enterprise security tool" surface.
    static let backgroundTop = Color(red: 0.11, green: 0.115, blue: 0.125)
    static let backgroundBottom = Color(red: 0.065, green: 0.068, blue: 0.075)

    /// Single accent color: soft mint/light green. Used sparingly for active/success
    /// states, glow rings, and the primary action button -- never for neutral chrome.
    static let accent = Color(red: 0.55, green: 0.95, blue: 0.75)
    static let accentDim = Color(red: 0.55, green: 0.95, blue: 0.75).opacity(0.35)

    /// Reserved for genuine failure states (kept separate from the single accent so the
    /// accent's meaning -- "good / active / verified" -- never gets diluted).
    static let danger = Color(red: 0.95, green: 0.45, blue: 0.45)

    /// Text
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.6)
    static let textTertiary = Color.white.opacity(0.4)
    static let iconGrey = Color.white.opacity(0.55)

    /// Hairline separators inside glass cards.
    static let hairline = Color.white.opacity(0.08)
    static let cardBorder = Color.white.opacity(0.14)

    // MARK: - Background

    /// The full-screen deep charcoal backdrop used behind every screen in the app.
    static var backgroundGradient: some View {
        LinearGradient(
            colors: [backgroundTop, backgroundBottom],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

// MARK: - Glass card container

/// Frosted glassmorphism card: `.ultraThinMaterial` over the charcoal background with a
/// soft translucent blur and a thin light border. Used for every content grouping
/// (status, configuration, about) so the whole app reads as one consistent surface
/// language instead of the previous plain Form/Section look.
struct GlassCard<Content: View>: View {
    var cornerRadius: CGFloat = 22
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .background(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .background(
            // Faint charcoal tint under the material so it doesn't read as too light
            // against very bright system backgrounds, keeping the "deep grey glass"
            // feel from the reference direction rather than a generic frosted look.
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color.black.opacity(0.18))
        )
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(BhekaTheme.cardBorder, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// Small caps section label placed above a glass card, matching the reference image's
/// bold sans-serif header treatment (used at a smaller scale for in-card section titles).
struct GlassSectionLabel: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.system(.caption, design: .rounded).weight(.bold))
            .tracking(1.1)
            .foregroundColor(BhekaTheme.textSecondary)
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 4)
    }
}

/// Thin hairline divider used between rows inside a glass card (configuration fields,
/// status rows) matching the clean separated-row look in the reference image.
struct GlassHairline: View {
    var body: some View {
        Rectangle()
            .fill(BhekaTheme.hairline)
            .frame(height: 1)
            .padding(.leading, 20)
    }
}

// MARK: - Status indicators

/// Glowing ring indicator (used for the primary "monitoring active" state), matching
/// the reference image's ring-style status icon. Green + glow when active, muted grey
/// when inactive -- no other color is introduced.
struct StatusRing: View {
    var isActive: Bool
    var diameter: CGFloat = 40

    var body: some View {
        ZStack {
            if isActive {
                Circle()
                    .fill(BhekaTheme.accent.opacity(0.25))
                    .frame(width: diameter * 1.6, height: diameter * 1.6)
                    .blur(radius: 10)
            }
            Circle()
                .stroke(isActive ? BhekaTheme.accent : BhekaTheme.iconGrey, lineWidth: 3)
                .frame(width: diameter, height: diameter)
                .shadow(color: isActive ? BhekaTheme.accent.opacity(0.7) : .clear, radius: 8)
        }
        .animation(.easeInOut(duration: 0.3), value: isActive)
    }
}

/// Small solid status dot used for secondary status lines (upload confirmation, error
/// states) -- deliberately reuses only the single accent green / danger red / neutral
/// grey trio already defined above.
struct StatusDot: View {
    enum State { case good, bad, neutral }
    var state: State
    var diameter: CGFloat = 8

    private var color: Color {
        switch state {
        case .good: return BhekaTheme.accent
        case .bad: return BhekaTheme.danger
        case .neutral: return BhekaTheme.iconGrey
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: diameter, height: diameter)
            .shadow(color: state == .good ? color.opacity(0.8) : .clear, radius: 4)
    }
}

// MARK: - Buttons

/// Secondary "glass" button style used for non-primary actions (Save Configuration,
/// Test Server Connection, Scan QR Code) -- a subtler frosted pill so the single green
/// accent stays reserved for the primary start/stop action and status states.
struct GlassButtonStyle: ButtonStyle {
    var tint: Color = .white

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .rounded).weight(.semibold))
            .foregroundColor(tint)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}

/// Bold sans-serif app title/header used at the top of the main screen, matching the
/// reference image's "PREMIUM SECURITY" style treatment adapted to "BHEKA AGENT".
struct AppHeaderTitle: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.system(.largeTitle, design: .rounded).weight(.heavy))
            .tracking(0.5)
            .foregroundColor(BhekaTheme.textPrimary)
    }
}
