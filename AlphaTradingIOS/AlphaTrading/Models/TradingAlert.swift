import Foundation

enum AlertType: String, Codable, CaseIterable, Identifiable {
    case priceAbove
    case priceBelow
    case ma20Touch

    var id: String { rawValue }

    var label: String {
        switch self {
        case .priceAbove: return "목표가 이상"
        case .priceBelow: return "손절가 이하"
        case .ma20Touch: return "20일선 터치"
        }
    }
}

struct TradingAlert: Identifiable, Codable {
    let id: String
    let code: String
    let name: String
    let type: AlertType
    var target: Double
    var message: String
    var active: Bool
    var createdAt: String

    init(
        id: String = UUID().uuidString,
        code: String,
        name: String,
        type: AlertType,
        target: Double,
        message: String = "",
        active: Bool = true,
        createdAt: String = ""
    ) {
        self.id = id
        self.code = code
        self.name = name
        self.type = type
        self.target = target
        self.message = message
        self.active = active
        self.createdAt = createdAt.isEmpty
            ? Date().formatted(date: .abbreviated, time: .shortened)
            : createdAt
    }
}

struct AlertListResponse: Decodable {
    let ok: Bool
    let count: Int?
    let alerts: [ServerAlert]?
}

struct ServerAlert: Decodable {
    let id: String?
    let code: String?
    let name: String?
    let type: String?
    let target: Double?
    let active: Bool?
    let message: String?
    let createdAt: String?
}

struct AlertCreateRequest: Encodable {
    let id: String
    let code: String
    let name: String
    let type: String
    let target: Double
    let message: String
    let source: String
    let active: Bool
}

struct AlertCreateResponse: Decodable {
    let ok: Bool
    let exists: Bool?
    let count: Int?
    let error: String?
}

struct AlertDeleteResponse: Decodable {
    let ok: Bool
    let deleted: Int?
    let count: Int?
}
