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
