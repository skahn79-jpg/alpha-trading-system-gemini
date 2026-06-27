import Foundation

struct MarketIndex: Identifiable, Decodable {
    var id: String { name }
    let name: String
    let val: String
    let ch: String
    let up: Bool
    let sub: String?
}
