import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case httpStatus(Int, String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "잘못된 API URL입니다."
        case .httpStatus(let code, let body):
            return "HTTP \(code): \(body.prefix(200))"
        case .decoding(let err):
            return "응답 파싱 실패: \(err.localizedDescription)"
        }
    }
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

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.httpStatus(-1, "No response")
        }
        guard (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw APIError.httpStatus(http.statusCode, text)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
