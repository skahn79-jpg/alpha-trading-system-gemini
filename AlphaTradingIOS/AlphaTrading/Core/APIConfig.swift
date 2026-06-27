import Foundation

enum APIConfig {
    private static let keychainAccount = "app_api_key"

    static var baseURL: URL {
        let raw = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
            ?? "https://alpha-trading-server.onrender.com"
        return URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))!
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
