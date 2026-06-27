import Foundation

struct Quote: Decodable {
    let code: String
    let name: String
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
