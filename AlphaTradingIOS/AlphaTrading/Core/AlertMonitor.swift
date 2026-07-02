import Foundation
import UserNotifications
import BackgroundTasks

/// 알림 조건 감시 — 앱 활성화 시 + 백그라운드 새로고침 시 시세를 확인해
/// 조건 충족 종목을 로컬 푸시로 알립니다. (서버 푸시 없이 동작)
enum AlertMonitor {
    static let backgroundTaskID = "com.alpha.trading.ios.alertcheck"
    private static let alertsKey = "alpha.alerts"
    private static let firedKeyPrefix = "alpha.alerts.fired."

    // MARK: - 백그라운드 등록/예약

    static func registerBackgroundTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundTaskID, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else { return }
            scheduleNextRefresh()
            let work = Task {
                await checkNow()
                refreshTask.setTaskCompleted(success: true)
            }
            refreshTask.expirationHandler = { work.cancel() }
        }
    }

    static func scheduleNextRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: backgroundTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60) // 최소 30분 후 (iOS가 기회에 따라 실행)
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - 조건 검사

    static func checkNow() async {
        guard let data = UserDefaults.standard.data(forKey: alertsKey),
              let alerts = try? JSONDecoder().decode([TradingAlert].self, from: data) else { return }
        let active = alerts.filter(\.active)
        guard !active.isEmpty else { return }

        let codes = Array(Set(active.map(\.code))).prefix(10)
        guard let batch: [BatchQuoteItem] = try? await APIClient.shared.get(
            "/api/quotes",
            query: [
                URLQueryItem(name: "codes", value: codes.joined(separator: ",")),
                URLQueryItem(name: "analyze", value: "1"),
            ]
        ) else { return }

        let byCode = Dictionary(uniqueKeysWithValues: batch.map { ($0.code, $0) })
        for alert in active {
            guard let quote = byCode[alert.code], let price = quote.price, price > 0 else { continue }
            let triggered: Bool
            var detail = ""
            switch alert.type {
            case .priceAbove:
                triggered = Double(price) >= alert.target
                detail = "현재가 \(price.formatted()) ≥ 목표 \(Int(alert.target).formatted())"
            case .priceBelow:
                triggered = Double(price) <= alert.target
                detail = "현재가 \(price.formatted()) ≤ 기준 \(Int(alert.target).formatted())"
            case .ma20Touch:
                if let ma20 = quote.analysis?.movingAverages?.ma20, ma20 > 0 {
                    let dist = abs(Double(price) - ma20) / ma20
                    triggered = dist <= 0.01 // 1% 이내 접근 = 터치
                    detail = String(format: "20일선 %@ 대비 %.1f%%", Int(ma20).formatted(), dist * 100)
                } else {
                    triggered = false
                }
            }
            if triggered && !alreadyFiredToday(alert.id) {
                fireNotification(alert: alert, detail: detail)
                markFired(alert.id)
            }
        }
    }

    // MARK: - 로컬 푸시 (하루 1회 중복 방지)

    private static func todayKey() -> String {
        firedKeyPrefix + ISO8601DateFormatter().string(from: Date()).prefix(10)
    }

    private static func alreadyFiredToday(_ id: String) -> Bool {
        (UserDefaults.standard.stringArray(forKey: todayKey()) ?? []).contains(id)
    }

    private static func markFired(_ id: String) {
        var fired = UserDefaults.standard.stringArray(forKey: todayKey()) ?? []
        fired.append(id)
        UserDefaults.standard.set(fired, forKey: todayKey())
    }

    private static func fireNotification(alert: TradingAlert, detail: String) {
        let content = UNMutableNotificationContent()
        content.title = "📈 \(alert.name) — \(alert.type.label)"
        content.body = alert.message.isEmpty ? detail : "\(alert.message)\n\(detail)"
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "trigger-\(alert.id)-\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil // 즉시
        )
        UNUserNotificationCenter.current().add(request)
    }
}
