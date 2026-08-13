import Foundation

enum AdminAuthState: Equatable {
    case checking
    case authenticated(AdminUser)
    case unauthenticated
    case unavailable

    var allowsMainInterface: Bool {
        if case .authenticated = self { return true }
        return false
    }
}

struct AdminUser: Equatable {
    let name: String
    let expiresAt: Date?
}

struct SessionResponse: Decodable {
    let authenticated: Bool
    let user: SessionUserPayload?
    let expiresAt: Date?

    struct SessionUserPayload: Decodable {
        let name: String?
    }

    enum CodingKeys: String, CodingKey {
        case authenticated
        case user
        case expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        authenticated = try container.decodeIfPresent(Bool.self, forKey: .authenticated) ?? false
        user = try container.decodeIfPresent(SessionUserPayload.self, forKey: .user)
        if let raw = try? container.decode(String.self, forKey: .expiresAt) {
            expiresAt = Self.parseExpiresAt(raw)
        } else {
            expiresAt = nil
        }
    }

    func resolvedUser() -> AdminUser? {
        guard authenticated else { return nil }
        let trimmed = user?.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return AdminUser(name: trimmed.isEmpty ? "관리자" : trimmed, expiresAt: expiresAt)
    }

    static func parseExpiresAt(_ raw: String) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) {
            return date
        }
        let withoutFraction = ISO8601DateFormatter()
        withoutFraction.formatOptions = [.withInternetDateTime]
        return withoutFraction.date(from: trimmed)
    }
}

struct LoginRequest: Encodable {
    let loginId: String
    let password: String
}

struct BrokerStatus: Decodable, Equatable {
    let configured: Bool
    let connection: String
    let tradingEnabled: Bool
    let autoTradingEnabled: Bool
}

enum KBInquiryPolicy {
    static let networkEnabled = false
    static let orderControlsEnabled = false
}

enum BrokerStatusCopy {
    static let configuredNeededTitle = "KB API 설정 필요"
    static let configuredNeededDetail = "앱키가 아직 등록되지 않았습니다."
    static let connectionUnverifiedTitle = "연결 미검증"
    static let connectionUnverifiedDetail = "실서버 조회 검증이 완료되지 않았습니다."
    static let tradingDisabled = "직접 주문: 비활성"
    static let autoTradingDisabled = "자동매매: 비활성"
    static let inquiryPending = "준비 중"
    static let inquiryRows = [
        "현재가 조회",
        "계좌 요약",
        "보유 종목",
        "주문 가능 금액",
        "주문·체결 조회",
    ]

    static func configurationTitle(configured: Bool) -> String {
        configured ? "KB API 설정됨" : configuredNeededTitle
    }

    static func configurationDetail(configured: Bool) -> String? {
        configured ? nil : configuredNeededDetail
    }

    static func connectionTitle(_ connection: String) -> String {
        connection == "unverified" ? connectionUnverifiedTitle : connection
    }

    static func connectionDetail(_ connection: String) -> String? {
        connection == "unverified" ? connectionUnverifiedDetail : nil
    }

    static func tradingLabel(enabled: Bool) -> String {
        enabled ? "직접 주문: 활성" : tradingDisabled
    }

    static func autoTradingLabel(enabled: Bool) -> String {
        enabled ? "자동매매: 활성" : autoTradingDisabled
    }
}

enum SessionRefreshReason {
    case launch
    case foreground
    case manual
}
