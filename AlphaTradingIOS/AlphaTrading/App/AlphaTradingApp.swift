import SwiftUI
import UIKit
import UserNotifications

/// APNs 원격 푸시 등록 — 디바이스 토큰을 서버에 전달해 서버발 알림 수신
/// (iPhone 잠금 시 페어링된 Apple Watch로 자동 미러링됨)
final class PushRegistrar: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        Task { @MainActor in
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task {
            struct RegisterResponse: Decodable { let ok: Bool? }
            struct Body: Encodable { let token: String; let platform: String }
            _ = try? await APIClient.shared.post(
                "/api/push/register",
                body: Body(token: token, platform: "ios")
            ) as RegisterResponse
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[push] register failed: \(error.localizedDescription)")
    }
}

@main
struct AlphaTradingApp: App {
    @AppStorage("hasAcceptedDisclaimer") private var hasAcceptedDisclaimer = false
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(PushRegistrar.self) private var pushRegistrar

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
