import SwiftUI

@main
struct AlphaTradingApp: App {
    @AppStorage("hasAcceptedDisclaimer") private var hasAcceptedDisclaimer = false
    @Environment(\.scenePhase) private var scenePhase

    init() {
        APIConfig.bootstrapSecrets()
        AlertMonitor.registerBackgroundTask()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if hasAcceptedDisclaimer {
                    MainTabView()
                } else {
                    OnboardingView(hasAcceptedDisclaimer: $hasAcceptedDisclaimer)
                }
            }
            .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                Task { await AlertMonitor.checkNow() }
            case .background:
                AlertMonitor.scheduleNextRefresh()
            default:
                break
            }
        }
    }
}
