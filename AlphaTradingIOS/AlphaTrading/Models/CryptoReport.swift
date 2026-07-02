import Foundation

/// /api/crypto/report — 암호화폐 관찰 리포트
struct CryptoReportResponse: Decodable {
    let ok: Bool
    let updatedAt: String?
    let markets: [CryptoMarket]?
    let sentiment: CryptoSentiment?
    let global: GlobalCryptoData?
    let regulation: [RegulationTopic]?
    let disclaimer: String?
}

struct CryptoMarket: Decodable, Identifiable {
    var id: String { symbol }
    let symbol: String
    let price: Double?
    let changeRate: Double?
    let score: Int?
    let grade: String?
    let signalBadge: String?
    let signals: [String]?
    let ichimoku: CryptoIchimoku?
    let supertrend: SupertrendData?
    let mayer: MayerData?
    let summary: String?
}

struct CryptoIchimoku: Decodable {
    let status: String?
    let tkCross: String?

    var statusLabel: String {
        switch status {
        case "above_cloud": return "구름대 상단"
        case "below_cloud": return "구름대 하단"
        default: return "구름대 내부"
        }
    }
}

struct CryptoSentiment: Decodable {
    let value: Int
    let label: String?
    let labelKo: String?
    let history: [Int]?
}

struct GlobalCryptoData: Decodable {
    let totalMarketCapT: Double?
    let btcDominance: Double?
    let ethDominance: Double?
    let mcapChange24h: Double?
}

struct RegulationTopic: Decodable, Identifiable {
    var id: String { topic }
    let topic: String
    let items: [NewsItem]
}

/// 뉴스 공통 (규제 뉴스 · 악시오스)
struct NewsItem: Decodable, Identifiable {
    var id: String { link }
    let title: String
    let link: String
    let source: String?
    let publishedAt: String?

    var timeAgoText: String {
        guard let publishedAt,
              let date = ISO8601DateFormatter().date(from: publishedAt) else { return "" }
        let hours = Int(Date().timeIntervalSince(date) / 3600)
        if hours < 1 { return "방금" }
        if hours < 24 { return "\(hours)시간 전" }
        return "\(hours / 24)일 전"
    }
}

/// /api/news/axios
struct AxiosNewsResponse: Decodable {
    let ok: Bool
    let source: String?
    let items: [NewsItem]?
    let updatedAt: String?
}
