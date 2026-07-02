import Foundation

struct Quote: Decodable {
    let code: String
    // 서버 응답에 name이 없으므로 옵셔널 (필수로 두면 모든 시세 디코딩이 실패함)
    let name: String?
    let price: Int?
    let change: Int?
    let changeRate: Double?
    let changeStr: String?
    let open: Int?
    let high: Int?
    let low: Int?
    let volume: Int?
    let up: Bool?

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
