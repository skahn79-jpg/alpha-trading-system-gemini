import SwiftUI

@main
struct AlphaTradingApp: App {
    @AppStorage("hasAcceptedDisclaimer") private var hasAcceptedDisclaimer = false

    init() {
        APIConfig.bootstrapSecrets()
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
    }
}
