import Foundation

/// Slim copy of iPhone PersonalSignal so Watch stays a single-target companion
/// without a shared framework. JSON keys must stay in sync with iOS.
enum WatchAlertKind: String, Codable {
    case crash, breakout, fearGreed, news

    var label: String {
        switch self {
        case .crash: return "급락"
        case .breakout: return "돌파"
        case .fearGreed: return "공포탐욕"
        case .news: return "뉴스"
        }
    }
}

enum WatchAlertSeverity: String, Codable {
    case low, medium, high
}

struct WatchPersonalSignal: Identifiable, Codable, Equatable {
    var id: String
    var code: String
    var name: String
    var kind: WatchAlertKind
    var severity: WatchAlertSeverity
    var title: String
    var detail: String
    var createdAt: TimeInterval
    var opportunity: Bool
}

/// WidgetKit Complication 훅 — 별도 위젯 타깃 없이 문구만 준비 (CI 부담 없이).
enum WatchComplicationSnapshot {
    static func headline(_ signals: [WatchPersonalSignal]) -> String {
        guard let first = signals.first else { return "관심종목 대기" }
        return "\(first.kind.label) \(first.name)"
    }

    static func detail(_ signals: [WatchPersonalSignal]) -> String {
        guard let first = signals.first else { return "아이폰 관심종목 High 알림" }
        return first.detail
    }
}
