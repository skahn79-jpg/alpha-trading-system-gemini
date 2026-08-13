import Foundation

enum APIAuthScope: Equatable {
    case adminLogin
    case adminSession
    case appKey
    case market

    static func classify(_ path: String) -> APIAuthScope {
        let trimmed = path.split(separator: "?").first.map(String.init) ?? path
        let p = trimmed.hasPrefix("/") ? trimmed : "/" + trimmed
        if p == "/api/auth/login" || p.hasPrefix("/api/auth/login/") {
            return .adminLogin
        }
        if p == "/api/auth" || p.hasPrefix("/api/auth/") {
            return .adminSession
        }
        if p.hasPrefix("/api/broker") || p.hasPrefix("/api/trading") {
            return .adminSession
        }
        if p.hasPrefix("/api/ai") || p.hasPrefix("/api/alerts") || p.hasPrefix("/api/sim") {
            return .appKey
        }
        return .market
    }
}

enum APIError: LocalizedError, Equatable {
    case invalidURL
    case transport
    case timeout
    case unauthorized
    case appKeyRejected
    case rateLimited
    case forbidden
    case serverUnavailable
    case invalidResponse
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "잘못된 API URL입니다."
        case .transport:
            return "네트워크 연결에 실패했습니다."
        case .timeout:
            return "요청 시간이 초과되었습니다."
        case .unauthorized:
            return "로그인이 필요합니다."
        case .appKeyRejected:
            return "앱 인증에 실패했습니다."
        case .rateLimited:
            return "요청이 너무 많습니다. 잠시 후 다시 시도하세요."
        case .forbidden:
            return "이 작업을 수행할 권한이 없습니다."
        case .serverUnavailable:
            return "서버를 사용할 수 없습니다. 잠시 후 다시 시도하세요."
        case .invalidResponse:
            return "서버 응답을 처리할 수 없습니다."
        case .decoding:
            return "서버 응답을 처리할 수 없습니다."
        }
    }
}

extension Notification.Name {
    static let alphaAdminSessionUnauthorized = Notification.Name("alphaAdminSessionUnauthorized")
}

final class APIClient {
    static let shared = APIClient()
    private let session: URLSession

    init(session: URLSession = SecureSessionFactory.makePinnedSession()) {
        self.session = session
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await request(path, method: "GET", query: query, body: Optional<Data>.none)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let data = try JSONEncoder().encode(body)
        return try await request(path, method: "POST", query: [], body: data)
    }

    func delete<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: "DELETE", query: [], body: Optional<Data>.none)
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String,
        query: [URLQueryItem],
        body: Data?
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: APIConfig.baseURL)?.absoluteURL else {
            throw APIError.invalidURL
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if !query.isEmpty {
            components?.queryItems = query
        }
        guard let finalURL = components?.url else { throw APIError.invalidURL }

        var request = URLRequest(url: finalURL)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !APIConfig.appAPIKey.isEmpty {
            request.setValue(APIConfig.appAPIKey, forHTTPHeaderField: "X-App-Key")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            if urlError.code == .timedOut {
                throw APIError.timeout
            }
            throw APIError.transport
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw APIError.transport
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw mapHTTPError(status: http.statusCode, path: path)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    private func mapHTTPError(status: Int, path: String) -> APIError {
        let scope = APIAuthScope.classify(path)
        switch status {
        case 401:
            switch scope {
            case .adminLogin:
                return .unauthorized
            case .adminSession:
                NotificationCenter.default.post(name: .alphaAdminSessionUnauthorized, object: nil)
                return .unauthorized
            case .appKey:
                return .appKeyRejected
            case .market:
                return .invalidResponse
            }
        case 403:
            return scope == .appKey ? .appKeyRejected : .forbidden
        case 429:
            return .rateLimited
        default:
            if (500...599).contains(status) {
                return .serverUnavailable
            }
            return .invalidResponse
        }
    }
}
