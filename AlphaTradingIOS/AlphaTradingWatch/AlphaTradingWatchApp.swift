import SwiftUI

@main
struct AlphaTradingWatchApp: App {
    init() {
        WatchSignalInbox.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
