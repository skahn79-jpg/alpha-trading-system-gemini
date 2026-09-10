import Foundation
import WatchConnectivity

/// Pushes High-severity personal alerts to the paired Apple Watch.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()

    private override init() {
        super.init()
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        if session.activationState != .activated { session.activate() }
    }

    func pushHighSignals(_ signals: [PersonalSignal]) {
        activate()
        let high = signals.filter { $0.severity == .high }
        let payload: [String: Any] = [
            "updatedAt": Date().timeIntervalSince1970,
            "signals": (try? JSONEncoder().encode(high)).map { $0.base64EncodedString() } ?? "",
        ]
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        try? session.updateApplicationContext(payload)
        if session.isPaired && session.isWatchAppInstalled {
            session.transferUserInfo(payload)
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
    #endif
}
