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
    let stochasticSlow: StochasticSlowData?
    let mayer: MayerData?
    let vixFix: VixFixData?
    let supertrend: SupertrendData?
    let ewo: EWOData?
    let mfi: MFIData?
    let maSlope: MASlopeData?
    let minervini: MinerviniData?
    let divergence: DivergenceData?
    let stochHeatmap: StochHeatmapData?
    let painMeter: PainMeterData?
    let bullBearPower: BBPData?
}

struct DivergenceData: Decodable {
    let bullish: DivergenceSignal?
    let bearish: DivergenceSignal?
}

struct DivergenceSignal: Decodable {
    let indicators: [String]
    let barsAgo: Int
}

struct StochHeatmapData: Decodable {
    let bullCount: Int?
    let total: Int?
    let pct: Int?
    let zone: String?

    var zoneLabel: String {
        switch zone {
        case "bottom_paint": return "바닥 도배"
        case "top_paint": return "고점 도배"
        default: return "혼조"
        }
    }
}

struct PainMeterData: Decodable {
    let loss: Double?
    let bullDiv: Bool?
}

struct BBPData: Decodable {
    let value: Double?
    let percentile: Int?
    let zone: String?

    var zoneLabel: String {
        switch zone {
        case "wave_top": return "파동 고점권"
        case "wave_bottom": return "파동 바닥권"
        default: return "중간"
        }
    }
}

struct StochasticSlowData: Decodable {
    let k: Double?
    let d: Double?
    let inWell: Bool?
    let status: String?
}

struct MayerData: Decodable {
    let multiple: Double?
    let ma200: Double?
    let zone: String?

    var zoneLabel: String {
        switch zone {
        case "deep_value": return "깊은 저평가"
        case "below_ma": return "200일선 하단"
        case "normal": return "정상 범위"
        case "hot": return "과열 주의"
        case "extreme": return "극단 과열"
        default: return "-"
        }
    }
}

struct VixFixData: Decodable {
    let value: Double?
    let upperBand: Double?
    let spike: Bool?
}

struct SupertrendData: Decodable {
    let direction: String?
    let line: Double?
    let flipped: Bool?
}

struct EWOData: Decodable {
    let value: Double?
    let pct: Double?
    let trend: String?
}

struct MFIData: Decodable {
    let value: Double?
    let status: String?
}

struct MASlopeData: Decodable {
    let angle: Double?
    let trend: String?
}

struct MinerviniData: Decodable {
    let passed: Int?
    let total: Int?
    let verdict: String?

    var verdictLabel: String {
        switch verdict {
        case "strong_uptrend": return "강한 상승 구조"
        case "uptrend": return "상승 구조"
        case "mixed": return "혼조"
        default: return "하락 구조"
        }
    }
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
