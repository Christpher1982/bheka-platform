//
//  BhekaAgentApp.swift
//  BhekaAgent
//
//  SwiftUI App entry point. Registers a UIApplicationDelegateAdaptor so we can hook
//  application(_:handleEventsForBackgroundURLSession:completionHandler:) — required for
//  the background URLSession in ApiClient.swift to correctly wake the app and flush
//  completion handlers when uploads finish while the app was suspended.
//
import SwiftUI

@main
struct BhekaAgentApp: App {
    @UIApplicationDelegateAdaptor(BhekaAppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// Minimal UIApplicationDelegate whose sole job is to bridge the background URLSession
/// completion callback into ApiClient/BackgroundSessionCompletionRegistry. SwiftUI's
/// App protocol doesn't expose this delegate method directly, hence the adaptor.
final class BhekaAppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Warm the shared ApiClient session so background transfers already in flight
        // (e.g. posted by the Broadcast Extension before the main app relaunched) get
        // picked back up.
        _ = ApiClient.shared
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        // Register the completion handler; ApiClient calls back into this registry from
        // urlSessionDidFinishEvents(forBackgroundURLSession:) once all background tasks
        // for this session have delivered their delegate callbacks.
        BackgroundSessionCompletionRegistry.shared.register(identifier: identifier) {
            completionHandler()
        }
    }
}
