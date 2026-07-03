import Foundation

/// /api/macro/indicators 응답 — FRED 거시경제 지표
struct MacroReport: Decodable {
    let ok: Bool
    let source: String?
    let mood: String?
    let moodLabel: String?
    let supportive: Int?
    let headwind: Int?
    let indicators: [MacroIndicator]?
    let disclaimer: String?
}

/// /api/fx — 실시간 환율 (원/달러 · 원/엔 100엔 기준)
struct FxResponse: Decodable {
    let ok: Bool
    let updatedAt: String?
    let usdKrw: FxRate?
    let jpy100Krw: FxRate?
}

struct FxRate: Decodable {
    let price: Double
    let changeRate: Double?
    let changeStr: String?
}

struct MacroIndicator: Decodable, Identifiable {
    let id: String
    let name: String
    let unit: String?
    let value: Double
    let change: Double?
    let date: String?
    let note: String?
    let stance: String?
    let spark: [Double]?

    var stanceLabel: String {
        switch stance {
        case "supportive": return "우호"
        case "headwind": return "부담"
        default: return "중립"
        }
    }
}
