import Foundation
import UserNotifications

/// Payload shown after the user taps a local or remote notification.
struct NotificationOpenPayload: Identifiable, Equatable {
    var id: String
    var code: String?
    var name: String?
    var kind: String?
    var title: String
    var body: String
    var detail: String
    var assetType: String?

    var tickerLabel: String? {
        switch (name, code) {
        case let (name?, code?) where !name.isEmpty && !code.isEmpty && name != code:
            return "\(name) (\(code))"
        case let (name?, _) where !name.isEmpty:
            return name
        case let (_, code?) where !code.isEmpty:
            return code
        default:
            return nil
        }
    }

    var kindLabel: String? {
        guard let kind, !kind.isEmpty else { return nil }
        if let personal = PersonalAlertKind(rawValue: kind) {
            return personal.label
        }
        switch kind {
        case "price": return "가격 알림"
        case "priceAbove": return AlertType.priceAbove.label
        case "priceBelow": return AlertType.priceBelow.label
        case "ma20Touch": return AlertType.ma20Touch.label
        case "remote": return "원격 알림"
        default: return kind
        }
    }

    var stock: Stock? {
        guard let code, !code.isEmpty else { return nil }
        let resolvedName = (name?.isEmpty == false) ? name! : code
        return Stock(code: code, name: resolvedName, assetType: assetType)
    }

    /// Rebuilds a readable payload from UNNotification content, custom userInfo, nested APNs `aps.alert`, and SignalInbox.
    static func resolve(
        requestId: String,
        title: String,
        body: String,
        userInfo: [AnyHashable: Any]
    ) -> NotificationOpenPayload {
        let infoTitle = string(from: userInfo, keys: ["title"])
        let infoBody = string(from: userInfo, keys: ["body", "detail", "message"])
        var id = string(from: userInfo, keys: ["id"]) ?? idFromRequest(requestId)
        var code = string(from: userInfo, keys: ["code", "ticker", "symbol"])
        var name = string(from: userInfo, keys: ["name"])
        var kind = string(from: userInfo, keys: ["kind", "type"])
        var resolvedTitle = firstNonEmpty(infoTitle, title)
        var resolvedBody = firstNonEmpty(infoBody, body)
        var detail = string(from: userInfo, keys: ["detail", "body", "message"]) ?? resolvedBody
        let assetType = string(from: userInfo, keys: ["assetType", "asset_type"])

        if let stored = SignalInbox.find(id: id, code: code, kind: kind) {
            if id == nil { id = stored.id }
            if code == nil { code = stored.code }
            if name == nil { name = stored.name }
            if kind == nil { kind = stored.kind.rawValue }
            if resolvedTitle.isEmpty { resolvedTitle = stored.title }
            if resolvedBody.isEmpty { resolvedBody = stored.detail }
            if detail.isEmpty { detail = stored.detail }
        }

        if resolvedTitle.isEmpty {
            resolvedTitle = firstNonEmpty(name, code, "알림")
        }
        if resolvedBody.isEmpty {
            resolvedBody = detail
        }
        if resolvedBody.isEmpty {
            resolvedBody = "알림 본문을 불러오지 못했습니다."
        }
        if detail.isEmpty {
            detail = resolvedBody
        }

        return NotificationOpenPayload(
            id: id ?? requestId,
            code: code,
            name: name,
            kind: kind,
            title: resolvedTitle,
            body: resolvedBody,
            detail: detail,
            assetType: assetType
        )
    }

    static func fromSignal(_ signal: PersonalSignal) -> NotificationOpenPayload {
        NotificationOpenPayload(
            id: signal.id,
            code: signal.code,
            name: signal.name,
            kind: signal.kind.rawValue,
            title: signal.title.isEmpty ? "\(signal.kind.label) · \(signal.name)" : signal.title,
            body: signal.detail,
            detail: signal.detail,
            assetType: nil
        )
    }

    private static func idFromRequest(_ requestId: String) -> String? {
        if requestId.hasPrefix("signal-") {
            let value = String(requestId.dropFirst("signal-".count))
            return value.isEmpty ? nil : value
        }
        if requestId.hasPrefix("trigger-") {
            let rest = requestId.dropFirst("trigger-".count)
            if let cut = rest.lastIndex(of: "-") {
                let value = String(rest[..<cut])
                return value.isEmpty ? nil : value
            }
        }
        return nil
    }

    private static func firstNonEmpty(_ values: String?...) -> String {
        for value in values {
            if let value {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
        }
        return ""
    }

    static func string(from userInfo: [AnyHashable: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = stringValue(userInfo[key]) { return value }
        }
        if let aps = userInfo["aps"] as? [AnyHashable: Any] {
            if let alert = aps["alert"] as? [AnyHashable: Any] {
                for key in keys {
                    if let value = stringValue(alert[key]) { return value }
                }
            }
            if keys.contains(where: { $0 == "body" || $0 == "title" }),
               let alert = stringValue(aps["alert"]) {
                return alert
            }
        }
        return nil
    }

    private static func stringValue(_ raw: Any?) -> String? {
        if let value = raw as? String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let number = raw as? NSNumber {
            return number.stringValue
        }
        return nil
    }
}

/// Delivers a tapped notification to SwiftUI. Cold-start and foreground taps both land here.
final class NotificationRouter: ObservableObject {
    static let shared = NotificationRouter()

    @Published var pending: NotificationOpenPayload?

    func open(_ notification: UNNotification) {
        let content = notification.request.content
        setPending(
            NotificationOpenPayload.resolve(
                requestId: notification.request.identifier,
                title: content.title,
                body: content.body,
                userInfo: content.userInfo
            )
        )
    }

    func open(userInfo: [AnyHashable: Any], title: String?, body: String?, requestId: String) {
        setPending(
            NotificationOpenPayload.resolve(
                requestId: requestId,
                title: title ?? "",
                body: body ?? "",
                userInfo: userInfo
            )
        )
    }

    func openSignal(_ signal: PersonalSignal) {
        setPending(.fromSignal(signal))
    }

    func dismiss() {
        setPending(nil)
    }

    private func setPending(_ payload: NotificationOpenPayload?) {
        if Thread.isMainThread {
            pending = payload
        } else {
            DispatchQueue.main.async { self.pending = payload }
        }
    }
}
