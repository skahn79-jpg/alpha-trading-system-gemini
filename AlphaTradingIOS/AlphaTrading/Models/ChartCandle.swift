import Foundation

struct ChartCandle: Identifiable, Decodable {
    var id: String { date }
    let date: String
    // 미국주식·코인은 소수점 가격 (국내 주식 정수도 그대로 디코딩됨)
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double

    var isUp: Bool { close >= open }
}

struct ChartResponse: Decodable {
    let code: String?
    let symbol: String?
    let period: String?
    let candles: [ChartCandle]
}
