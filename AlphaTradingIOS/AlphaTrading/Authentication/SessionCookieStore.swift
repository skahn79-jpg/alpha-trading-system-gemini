import Foundation

enum SessionCookieStore {
    private static let sessionCookieNames: Set<String> = [
        "__Host-alpha_session",
        "alpha_session",
    ]

    static func clearSessionCookies() {
        let storage = HTTPCookieStorage.shared
        let fromBase = storage.cookies(for: APIConfig.baseURL) ?? []
        let fromAll = storage.cookies ?? []
        var unique: [HTTPCookie] = []
        var seen = Set<ObjectIdentifier>()
        for cookie in fromBase + fromAll {
            let id = ObjectIdentifier(cookie)
            guard seen.insert(id).inserted else { continue }
            unique.append(cookie)
        }
        let host = APIConfig.baseURL.host?.lowercased()
        for cookie in unique {
            guard sessionCookieNames.contains(cookie.name) else { continue }
            if let host {
                let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                let hostMatches = domain == host || host.hasSuffix(domain) || domain.hasSuffix(host)
                if !hostMatches { continue }
            }
            storage.deleteCookie(cookie)
        }
    }
}
