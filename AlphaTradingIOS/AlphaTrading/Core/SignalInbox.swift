import Foundation
import Combine

/// Watchlist-only personal signals with cooldown. Device-local, analysis only.
enum SignalInbox {
    static let storageKey = "alpha.personal.signals"
    static let firedKey = "alpha.personal.signals.fired"

    static func load() -> [PersonalSignal] {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let rows = try? JSONDecoder().decode([PersonalSignal].self, from: data) else { return [] }
        return rows.sorted { $0.createdAt > $1.createdAt }
    }

    static func save(_ rows: [PersonalSignal]) {
        let trimmed = Array(rows.sorted { $0.createdAt > $1.createdAt }.prefix(80))
        if let data = try? JSONEncoder().encode(trimmed) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    static func ingest(_ incoming: [PersonalSignal], now: TimeInterval = Date().timeIntervalSince1970) -> [PersonalSignal] {
        var store = load()
        var fired = (try? JSONDecoder().decode([String: TimeInterval].self, from: UserDefaults.standard.data(forKey: firedKey) ?? Data())) ?? [:]
        var accepted: [PersonalSignal] = []
        for signal in incoming {
            if let last = fired[signal.cooldownKey],
               now - last < MarketSignalEngine.cooldownSeconds {
                continue
            }
            fired[signal.cooldownKey] = now
            store.insert(signal, at: 0)
            accepted.append(signal)
        }
        save(store)
        if let data = try? JSONEncoder().encode(fired) {
            UserDefaults.standard.set(data, forKey: firedKey)
        }
        return accepted
    }

    static func watchlistCodes() -> [Stock] {
        guard let data = UserDefaults.standard.data(forKey: "alpha.favorites"),
              let stocks = try? JSONDecoder().decode([Stock].self, from: data) else { return [] }
        return stocks
    }

    static func resetForTests() {
        UserDefaults.standard.removeObject(forKey: storageKey)
        UserDefaults.standard.removeObject(forKey: firedKey)
        SignalInboxStore.shared.reload()
    }
}

/// UI-facing inbox so dashboard / alert list refresh after a scan.
final class SignalInboxStore: ObservableObject {
    static let shared = SignalInboxStore()

    @Published private(set) var signals: [PersonalSignal] = []

    private init() {
        reload()
    }

    func reload() {
        let rows = SignalInbox.load()
        if Thread.isMainThread {
            signals = rows
        } else {
            DispatchQueue.main.async { self.signals = rows }
        }
    }

    @discardableResult
    func ingest(_ incoming: [PersonalSignal], now: TimeInterval = Date().timeIntervalSince1970) -> [PersonalSignal] {
        let accepted = SignalInbox.ingest(incoming, now: now)
        reload()
        return accepted
    }
}
