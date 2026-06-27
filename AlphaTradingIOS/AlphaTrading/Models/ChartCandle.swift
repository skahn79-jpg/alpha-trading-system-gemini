import Foundation

struct ChartCandle: Identifiable, Decodable {
    var id: String { date }
    let date: String
    let open: Int
    let high: Int
    let low: Int
    let close: Int
    let volume: Int

    var isUp: Bool { close >= open }
}

struct ChartResponse: Decodable {
    let code: String
    let period: String
    let candles: [ChartCandle]
}
