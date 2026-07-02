import Foundation

/// /api/signals/featured — 상승 전환·바닥 신호 특징 종목
struct FeaturedSignalsResponse: Decodable {
    let ok: Bool
    let building: Bool?
    let refreshing: Bool?
    let scanned: Int?
    let count: Int?
    let updatedAt: String?
    let message: String?
    let results: [FeaturedStock]
    let disclaimer: String?
}

struct FeaturedStock: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let name: String
    let sector: String?
    let price: Double?
    let kind: String?
    let score: Int?
    let signalBadge: String?
    let reasons: [String]

    var kindLabel: String {
        switch kind {
        case "turn": return "상승 전환"
        case "bottom": return "바닥 신호"
        default: return "신호"
        }
    }

    var asStock: Stock {
        Stock(code: code, name: name, tag: sector, sector: sector)
    }
}

/// /api/trade/picks — 수출입 연계 저평가 후보
struct TradePicksResponse: Decodable {
    let ok: Bool
    let building: Bool?
    let exportTrend: String?
    let basis: String?
    let message: String?
    let results: [TradePick]
    let disclaimer: String?
}

struct TradePick: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let name: String
    let sector: String?
    let category: String?
    let categoryNote: String?
    let price: Double?
    let changeRate: Double?
    let per: Double?
    let pbr: Double?
    let w52Pos: Int?
    let valueScore: Int?

    var asStock: Stock {
        Stock(code: code, name: name, tag: category, sector: sector)
    }
}
