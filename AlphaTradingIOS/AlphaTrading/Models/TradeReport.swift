import Foundation

/// /api/trade/report 응답 — 한국 수출입 리포트
struct TradeReport: Decodable {
    let ok: Bool
    let source: String?
    let unit: String?
    let trend: String?
    let summary: String?
    let latest: TradeMonth?
    let months: [TradeMonth]?
    let years: [TradeYear]?
    let categories: [TradeCategory]?
    let categoriesNote: String?
    let sectorHints: [TradeSectorHint]?
    let disclaimer: String?

    var trendLabel: String {
        switch trend {
        case "increase": return "수출 증가"
        case "decrease": return "수출 감소"
        case "flat": return "보합"
        default: return "-"
        }
    }
}

struct TradeMonth: Decodable, Identifiable {
    var id: String { month }
    let month: String
    let exports: Double
    let imports: Double
    let balance: Double
    let exportsYoY: Double?
    let importsYoY: Double?
    let exportsMoM: Double?

    /// 백만 달러 → 억 달러 표기
    var exportsBillionText: String { String(format: "%.1f억$", exports / 100) }
    var balanceBillionText: String { String(format: "%@%.1f억$", balance >= 0 ? "+" : "", balance / 100) }
}

struct TradeYear: Decodable, Identifiable {
    var id: String { year }
    let year: String
    let exports: Double
    let imports: Double
    let balance: Double
    let monthsCounted: Int?
    let partial: Bool?
    let exportsYoY: Double?

    var exportsBillionText: String { String(format: "%.0f억$", exports / 100) }
    var balanceBillionText: String { String(format: "%@%.0f억$", balance >= 0 ? "+" : "", balance / 100) }
}

struct TradeCategory: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let latestMonth: String?
    let exports: Double?
    let imports: Double?
    let exportsMoM: Double?
    let exportsYoY: Double?
    let importsYoY: Double?
    let trend: String?
    let momentumNote: String?
    let monthly: [CategoryMonth]?
    let quarters: [CategoryQuarter]?

    var trendLabel: String {
        switch trend {
        case "increase": return "증가"
        case "decrease": return "감소"
        case "flat": return "보합"
        default: return "-"
        }
    }
}

struct CategoryMonth: Decodable, Identifiable {
    var id: String { month }
    let month: String
    let exports: Double
    let imports: Double
    let exportsMoM: Double?
    let exportsYoY: Double?
    let importsYoY: Double?
}

struct CategoryQuarter: Decodable, Identifiable {
    var id: String { quarter }
    let quarter: String
    let exports: Double
    let imports: Double
    let partial: Bool?
    let exportsQoQ: Double?
}

struct TradeSectorHint: Decodable, Identifiable {
    var id: String { category }
    let category: String
    let sector: String?
    let note: String?
    let codes: [String]?
}
