import Foundation
import WatchConnectivity
import Combine

/// Receives High-severity personal alerts from the paired iPhone.
final class WatchSignalInbox: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSignalInbox()

    @Published private(set) var signals: [WatchPersonalSignal] = []
    @Published private(set) var updatedAt: Date?

    private override init() {
        super.init()
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        if session.activationState != .activated { session.activate() }
        apply(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        apply(session.receivedApplicationContext)
    }

    // Required when this target is compiled against the iOS SDK (Xcode
    // simulator CI builds the Watch companion as an iPhone-simulator dependency).
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        apply(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        apply(userInfo)
    }

    private func apply(_ payload: [String: Any]) {
        guard let encoded = payload["signals"] as? String,
              let data = Data(base64Encoded: encoded),
              let rows = try? JSONDecoder().decode([WatchPersonalSignal].self, from: data) else {
            return
        }
        let high = rows.filter { $0.severity == .high }
        let stamp = (payload["updatedAt"] as? TimeInterval).map { Date(timeIntervalSince1970: $0) }
        DispatchQueue.main.async {
            self.signals = high.sorted { $0.createdAt > $1.createdAt }
            self.updatedAt = stamp
        }
    }
}
