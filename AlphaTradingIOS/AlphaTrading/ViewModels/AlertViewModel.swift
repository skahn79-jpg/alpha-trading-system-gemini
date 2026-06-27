import Foundation
import UserNotifications

@MainActor
final class AlertViewModel: ObservableObject {
    @Published var alerts: [TradingAlert] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var notificationGranted = false

    private let localKey = "alpha.alerts"

    init() {
        loadLocal()
    }

    func requestNotificationPermission() async {
        let center = UNUserNotificationCenter.current()
        let granted = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        notificationGranted = granted ?? false
    }

    func loadLocal() {
        guard let data = UserDefaults.standard.data(forKey: localKey),
              let decoded = try? JSONDecoder().decode([TradingAlert].self, from: data) else {
            alerts = []
            return
        }
        alerts = decoded
    }

    func saveLocal() {
        if let data = try? JSONEncoder().encode(alerts) {
            UserDefaults.standard.set(data, forKey: localKey)
        }
    }

    func syncFromServer() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response: AlertListResponse = try await APIClient.shared.get("/api/alerts")
            if let serverAlerts = response.alerts {
                alerts = serverAlerts.compactMap { sa in
                    guard let code = sa.code, let name = sa.name,
                          let typeRaw = sa.type, let type = AlertType(rawValue: typeRaw) else { return nil }
                    return TradingAlert(
                        id: sa.id ?? UUID().uuidString,
                        code: code,
                        name: name,
                        type: type,
                        target: sa.target ?? 0,
                        message: sa.message ?? "",
                        active: sa.active ?? true,
                        createdAt: sa.createdAt ?? ""
                    )
                }
                saveLocal()
            }
        } catch {
            errorMessage = error.localizedDescription
            loadLocal()
        }
    }

    func addAlert(code: String, name: String, type: AlertType, target: Double, message: String) async {
        let alert = TradingAlert(code: code, name: name, type: type, target: target, message: message)
        alerts.insert(alert, at: 0)
        saveLocal()
        await pushToServer(alert)
        scheduleLocalPreview(for: alert)
    }

    func removeAlert(_ alert: TradingAlert) async {
        alerts.removeAll { $0.id == alert.id }
        saveLocal()
        do {
            let _: AlertDeleteResponse = try await APIClient.shared.delete("/api/alerts/\(alert.id)")
        } catch {
            errorMessage = "서버 삭제 실패: \(error.localizedDescription)"
        }
    }

    private func pushToServer(_ alert: TradingAlert) async {
        do {
            let body = AlertCreateRequest(
                id: alert.id,
                code: alert.code,
                name: alert.name,
                type: alert.type.rawValue,
                target: alert.target,
                message: alert.message,
                source: "IOS",
                active: alert.active
            )
            let _: AlertCreateResponse = try await APIClient.shared.post("/api/alerts", body: body)
        } catch {
            errorMessage = "서버 동기화 실패: \(error.localizedDescription)"
        }
    }

    private func scheduleLocalPreview(for alert: TradingAlert) {
        guard notificationGranted else { return }
        let content = UNMutableNotificationContent()
        content.title = "알림 등록됨"
        content.body = "\(alert.name) — \(alert.type.label)"
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(identifier: alert.id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }
}
