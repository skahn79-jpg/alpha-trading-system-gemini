import Foundation

enum APIConfig {
    private static let keychainAccount = "app_api_key"

    private static let fallbackBaseURL = URL(string: "https://alpha-trading-server.onrender.com")!

    static var baseURL: URL {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // xcconfig 주석 처리로 값이 "https:" 처럼 잘리면 host가 비므로 프로덕션 URL로 폴백
        guard let url = URL(string: raw), url.host?.isEmpty == false else {
            return fallbackBaseURL
        }
        return url
    }

    /// Keychain 우선, 없으면 xcconfig/Info.plist 값을 Keychain에 저장.
    static var appAPIKey: String {
        if let stored = KeychainService.load(key: keychainAccount), !stored.isEmpty {
            return stored
        }
        let bundled = (Bundle.main.object(forInfoDictionaryKey: "APP_API_KEY") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !bundled.isEmpty {
            KeychainService.save(key: keychainAccount, value: bundled)
        }
        return bundled
    }

    static func bootstrapSecrets() {
        _ = appAPIKey
    }
}
