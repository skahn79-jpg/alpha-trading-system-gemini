import Foundation

struct StockAnalysisResponse: Decodable {
    let code: String
    let candleCount: Int?
    let lastDate: String?
    let analysis: CandleAnalysis?
}

struct CandleAnalysis: Decodable {
    let grade: String?
    let score: Int?
    let action: String?
    let signalBadge: String?
    let summary: String?
    let signals: [String]?
    let confluence: Int?
    let baseLine: String?
    let movingAverages: MovingAverages?
    let distance: MADistance?
    let rsi: Double?
    let bollinger: BollingerBands?
    let week52: Week52Range?
    let volume: VolumeAnalysis?
    let macd: MACDData?
    let stochastic: StochasticData?
    let patterns: [CandlePattern]?
    let supportResistance: SupportResistance?
    let ichimoku: IchimokuData?
    let adx: ADXData?
    let obv: OBVData?
    let atr: ATRData?
    let fibonacci: FibonacciData?
}

struct IchimokuData: Decodable {
    let tenkan: Double?
    let kijun: Double?
    let spanA: Double?
    let spanB: Double?
    let status: String?
    let tkCross: String?

    var statusLabel: String {
        switch status {
        case "above_cloud": return "구름대 상단"
        case "below_cloud": return "구름대 하단"
        case "in_cloud": return "구름대 내부"
        default: return "-"
        }
    }
}

struct ADXData: Decodable {
    let adx: Double?
    let plusDI: Double?
    let minusDI: Double?
    let strength: String?
    let direction: String?

    var strengthLabel: String {
        switch strength {
        case "very_strong": return "매우 강한 추세"
        case "strong": return "강한 추세"
        case "moderate": return "보통 추세"
        default: return "약한 추세"
        }
    }
}

struct OBVData: Decodable {
    let value: Double?
    let changeOverPeriod: Double?
    let lookback: Int?
    let trend: String?

    var trendLabel: String {
        switch trend {
        case "rising": return "자금 유입"
        case "falling": return "자금 유출"
        default: return "중립"
        }
    }
}

struct ATRData: Decodable {
    let value: Double?
    let pct: Double?
}

struct FibonacciData: Decodable {
    let high: Double?
    let low: Double?
    let levels: [FibLevel]?
    let nearest: FibNearest?
}

struct FibLevel: Decodable, Identifiable {
    var id: Double { ratio }
    let ratio: Double
    let price: Double
}

struct FibNearest: Decodable {
    let ratio: Double
    let price: Double
    let dist: Double
}

struct MACDData: Decodable {
    let macd: Double?
    let signal: Double?
    let histogram: Double?
    let cross: String?
    let trend: String?
}

struct StochasticData: Decodable {
    let k: Double?
    let d: Double?
    let status: String?
}

struct CandlePattern: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let type: String?
    let note: String?
}

struct SupportResistance: Decodable {
    let support: Double?
    let resistance: Double?
    let supportDist: Double?
    let resistanceDist: Double?
}

struct MovingAverages: Decodable {
    let ma5: Double?
    let ma20: Double?
    let ma60: Double?
    let ma120: Double?
}

struct MADistance: Decodable {
    let ma20: Double?
    let ma60: Double?
}

struct BollingerBands: Decodable {
    let upper: Int?
    let mid: Int?
    let lower: Int?
    let bandwidth: Double?
    let position: Double?
}

struct Week52Range: Decodable {
    let high: Int?
    let low: Int?
    let position: Double?
}

struct VolumeAnalysis: Decodable {
    let latest: Int?
    let avg20: Double?
    let ratio: Double?
}

struct FullQuote: Decodable {
    let code: String
    // 서버 응답에 name이 없으므로 옵셔널 (필수로 두면 전체 시세 디코딩이 실패함)
    let name: String?
    let price: Int?
    let change: Int?
    let changeRate: Double?
    let changeStr: String?
    let volume: Int?
    let per: Double?
    let pbr: Double?
    let eps: Double?
    let w52High: Int?
    let w52Low: Int?
    let up: Bool?
    let analysis: CandleAnalysis?

    var displayPrice: String {
        guard let price else { return "-" }
        return price.formatted(.number.grouping(.automatic))
    }

    var displayChange: String {
        changeStr ?? "-"
    }

    var isUp: Bool {
        up ?? ((changeRate ?? 0) >= 0)
    }
}

struct ChartWithAnalysisResponse: Decodable {
    let code: String
    let period: String
    let candles: [ChartCandle]
    let analysis: CandleAnalysis?
}
