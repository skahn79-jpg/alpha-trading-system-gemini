import Foundation

/// /api/chartlab/:code — 차트 랩 (매물대·유사 패턴 전망·자동 해설)
struct ChartLabResponse: Decodable {
    let ok: Bool
    let code: String?
    let close: Double?
    let candleCount: Int?
    let analysis: CandleAnalysis?
    let volumeProfile: VolumeProfileData?
    let outlook: OutlookData?
    let commentary: [String]?
}

struct VolumeProfileData: Decodable {
    let bins: [VPBin]?
    let poc: VPLevel?
    let abovePct: Int?
    let belowPct: Int?
    let hvn: [VPLevel]?
    let pocPosition: String?

    var positionLabel: String {
        switch pocPosition {
        case "above_poc": return "최대 매물대 위 (하방 지지)"
        case "below_poc": return "최대 매물대 아래 (상방 부담)"
        default: return "최대 매물대 내부 (방향 결정 구간)"
        }
    }
}

struct VPBin: Decodable, Identifiable {
    var id: Double { Double(priceLow) }
    let priceLow: Double
    let priceHigh: Double
    let volume: Double
    let sharePct: Double

    var midPrice: Double { (priceLow + priceHigh) / 2 }
}

struct VPLevel: Decodable {
    let priceLow: Double
    let priceHigh: Double
    let sharePct: Double?
}

struct OutlookData: Decodable {
    let window: Int?
    let horizon: Int?
    let samples: [OutlookSample]?
    let avgReturn: Double?
    let upProbability: Int?
    let note: String?
}

struct OutlookSample: Decodable, Identifiable {
    var id: Double { corr * 1000 + fwdReturn }
    let corr: Double
    let fwdReturn: Double
}
