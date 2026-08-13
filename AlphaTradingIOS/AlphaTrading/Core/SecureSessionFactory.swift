import Foundation

enum SecureSessionFactory {
    static func makePinnedSession() -> URLSession {
        let host = APIConfig.baseURL.host?.lowercased() ?? ""
        let isLocal = host == "localhost" || host == "127.0.0.1" || host.hasPrefix("192.168.")
        if isLocal {
            return URLSession(configuration: defaultConfig())
        }
        let config = defaultConfig()
        return URLSession(
            configuration: config,
            delegate: CertificatePinningDelegate.shared,
            delegateQueue: nil
        )
    }

    private static func defaultConfig() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 90
        config.waitsForConnectivity = true
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.httpCookieStorage = .shared
        return config
    }
}
