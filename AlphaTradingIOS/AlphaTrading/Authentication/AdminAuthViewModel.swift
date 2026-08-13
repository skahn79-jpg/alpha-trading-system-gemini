import Combine
import Foundation

@MainActor
final class AdminAuthViewModel: ObservableObject {
    @Published private(set) var state: AdminAuthState = .checking
    @Published var loginId = ""
    @Published var password = ""
    @Published var isSubmitting = false
    @Published var loginError: String?
    @Published var logoutNotice: String?

    private let service: AdminAuthService
    private var cancellables = Set<AnyCancellable>()

    var displayName: String {
        if case .authenticated(let user) = state {
            let trimmed = user.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "관리자" : trimmed
        }
        return "관리자"
    }

    init(
        service: AdminAuthService? = nil,
        startAutomatically: Bool = true,
        sessionTimeout: TimeInterval = 12
    ) {
        self.service = service ?? AdminAuthService(client: .shared, sessionTimeout: sessionTimeout)
        NotificationCenter.default.publisher(for: .alphaAdminSessionUnauthorized)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.handleSessionUnauthorized()
                }
            }
            .store(in: &cancellables)
        if startAutomatically {
            Task { await self.refreshSession(reason: .launch) }
        }
    }

    func refreshSession(reason: SessionRefreshReason) async {
        if reason == .launch || state == .checking || state == .unavailable {
            state = .checking
        }
        do {
            let response = try await service.session()
            if let user = response.resolvedUser() {
                state = .authenticated(user)
            } else {
                state = .unauthenticated
            }
        } catch is CancellationError {
            return
        } catch let error as APIError {
            switch error {
            case .unauthorized:
                state = .unauthenticated
            case .timeout, .transport, .serverUnavailable:
                state = .unavailable
            default:
                state = .unavailable
            }
        } catch {
            state = .unavailable
        }
    }

    func login() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        loginError = nil
        logoutNotice = nil
        defer { isSubmitting = false }
        do {
            let response = try await service.login(loginId: loginId, password: password)
            if let user = response.resolvedUser() {
                loginId = ""
                password = ""
                state = .authenticated(user)
            } else {
                password = ""
                state = .unauthenticated
                loginError = "로그인 정보가 올바르지 않습니다."
            }
        } catch let error as APIError {
            state = .unauthenticated
            switch error {
            case .unauthorized:
                password = ""
                loginError = "로그인 정보가 올바르지 않습니다."
            case .rateLimited:
                loginError = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."
            case .serverUnavailable:
                loginError = APIError.serverUnavailable.localizedDescription
            default:
                loginError = error.localizedDescription
            }
        } catch {
            state = .unauthenticated
            loginError = error.localizedDescription
        }
    }

    func logout() async {
        logoutNotice = nil
        do {
            _ = try await service.logout()
        } catch {
            logoutNotice = "서버 로그아웃이 완료되지 않았습니다. 로컬 화면은 잠갔습니다."
        }
        SessionCookieStore.clearSessionCookies()
        password = ""
        state = .unauthenticated
    }

    private func handleSessionUnauthorized() {
        SessionCookieStore.clearSessionCookies()
        password = ""
        state = .unauthenticated
    }
}
