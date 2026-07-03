import Foundation

struct Quote: Decodable {
    let code: String
    // 서버 응답에 name이 없으므로 옵셔널 (필수로 두면 모든 시세 디코딩이 실패함)
    let name: String?
    // 미국주식·코인은 소수점 가격이므로 Double (국내 주식 정수도 그대로 디코딩됨)
    let price: Double?
    let change: Double?
    let changeRate: Double?
    let changeStr: String?
    let open: Double?
    let high: Double?
    let low: Double?
    let volume: Double?
    let up: Bool?

    var displayPrice: String {
        guard let price else { return "-" }
        if price == price.rounded() && price >= 100 {
            return Int(price).formatted(.number.grouping(.automatic))
        }
        return price.formatted(.number.precision(.fractionLength(2)))
    }

    var displayChange: String {
        changeStr ?? "-"
    }

    var isUp: Bool {
        up ?? ((changeRate ?? 0) >= 0)
    }
}
