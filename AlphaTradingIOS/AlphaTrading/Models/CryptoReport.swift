import Foundation

/// /api/crypto/report — 암호화폐 관찰 리포트
struct CryptoReportResponse: Decodable {
    let ok: Bool
    let updatedAt: String?
    let markets: [CryptoMarket]?
    let sentiment: CryptoSentiment?
    let global: GlobalCryptoData?
    let regulation: [RegulationTopic]?
    let btcCycle: BtcCycle?
    let disclaimer: String?
}

/// BTC 사이클 진단 (CoinAI 벤치마킹 — 생산비용·멱법칙·Pi Cycle·200주·반감기·BTI)
struct BtcCycle: Decodable {
    let price: Double?
    let productionCost: BtcProductionCost?
    let powerLaw: BtcPowerLaw?
    let piCycle: BtcPiCycle?
    let ma200w: BtcMa200w?
    let bubble: BtcBubble?
    let margin: BtcMargin?
    let halving: BtcHalving?
    let bti: BtcBti?
}

/// 거품지수 — 20주선 대비 이격률 (Bubble Risk Indicator)
struct BtcBubble: Decodable {
    let dev: Double
    let zone: String
    let note: String?

    var zoneLabel: String {
        switch zone {
        case "bubble": return "거품 구간"
        case "hot": return "과열 주의"
        case "normal": return "정상"
        default: return "저평가"
        }
    }
}

/// Bitfinex 마진 롱/숏 (공개 데이터)
struct BtcMargin: Decodable {
    let longBtc: Double
    let shortBtc: Double
    let longShortRatio: Double
    let note: String?
}

struct BtcProductionCost: Decodable {
    let cost: Double
    let price: Double
    let aboveCost: Bool
    let premiumPct: Double
    let note: String?
}

struct BtcPowerLaw: Decodable {
    let positionPct: Int
    let support: Double
    let center: Double
    let top: Double
}

struct BtcPiCycle: Decodable {
    let topRatio: Double
    let topSignal: Bool
    let topNote: String?
    let bottomZone: Bool
}

struct BtcMa200w: Decodable {
    let ma: Double
    let multiple: Double
    let zone: String
    let note: String?

    var zoneLabel: String {
        switch zone {
        case "opportunity": return "기회 구간"
        case "normal": return "정상"
        case "warm": return "상단 주의"
        default: return "과열"
        }
    }
}

struct BtcHalving: Decodable {
    let weeksSinceHalving: Int
    let phase: String
    let label: String
    let guide: String
}

struct BtcBti: Decodable {
    let count: Int
    let total: Int
    let riskPct: Int
    let verdict: String
    let subs: [BtcBtiSub]?
}

struct BtcBtiSub: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let prox: Double
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
