import Foundation

struct EmptyJSON: Encodable {}

final class AdminAuthService {
    private let client: APIClient
    private let sessionTimeout: TimeInterval

    init(client: APIClient, sessionTimeout: TimeInterval = 12) {
        self.client = client
        self.sessionTimeout = sessionTimeout
    }

    func session() async throws -> SessionResponse {
        try await withTimeout(sessionTimeout) {
            try await self.client.get("/api/auth/session")
        }
    }

    func login(loginId: String, password: String) async throws -> SessionResponse {
        try await client.post("/api/auth/login", body: LoginRequest(loginId: loginId, password: password))
    }

    func logout() async throws -> SessionResponse {
        try await client.post("/api/auth/logout", body: EmptyJSON())
    }

    func brokerStatus() async throws -> BrokerStatus {
        try await client.get("/api/broker/status")
    }

    private func withTimeout<T>(
        _ seconds: TimeInterval,
        operation: @escaping () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                let nanos = UInt64(max(0, seconds) * 1_000_000_000)
                try await Task.sleep(nanoseconds: nanos)
                throw APIError.timeout
            }
            defer { group.cancelAll() }
            guard let value = try await group.next() else {
                throw APIError.timeout
            }
            return value
        }
    }
}
