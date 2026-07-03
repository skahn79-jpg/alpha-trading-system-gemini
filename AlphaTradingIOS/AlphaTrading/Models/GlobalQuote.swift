import Foundation

struct GlobalQuote: Decodable, Identifiable {
    var id: String { symbol }
    let symbol: String
    let price: Double?
    let change: Double?
    let changeRate: Double?
    let changeStr: String?
    let currency: String?
    let marketState: String?
    let source: String?

    var displayPrice: String {
        guard let price else { return "-" }
        if (currency ?? "USD") == "USD" {
            return String(format: "$%.2f", price)
        }
        return price.formatted(.number.precision(.fractionLength(2)))
    }

    var isUp: Bool {
        (changeRate ?? 0) >= 0
    }
}

struct GlobalSearchItem: Decodable, Identifiable {
    var id: String { symbol }
    let symbol: String
    let name: String
    let type: String?
    let sector: String?
}

struct UniverseResponse: Decodable {
    let ok: Bool
    let kind: String?
    let count: Int?
    let results: [MasterStock]
}

struct BatchQuoteItem: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let name: String?
    let price: Double?
    let changeRate: Double?
    let changeStr: String?
    let up: Bool?
    let volume: Double?
    let analysis: CandleAnalysis?
    let error: Bool?

    var score: Int {
        analysis?.score ?? 0
    }

    var signalBadge: String {
        analysis?.signalBadge ?? analysis?.action ?? "—"
    }
}
