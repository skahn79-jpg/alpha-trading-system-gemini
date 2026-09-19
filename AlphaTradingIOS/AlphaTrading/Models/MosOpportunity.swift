import Foundation

/// GET /api/alerts/mos/board — MOS A′ opportunity strip for Dashboard
struct MosBoardResponse: Decodable {
    let ok: Bool?
    let paperLive: Bool?
    let version: String?
    let generatedAt: String?
    let count: Int?
    let enterCount: Int?
    let items: [MosBoardItem]?
    let disclaimer: String?
    let cached: Bool?
}

struct MosBoardItem: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let name: String
    let sectorId: String?
    let d: Double?
    let r20: Double?
    let Enter: Bool?
    let f: Double?
    let severity: String?
    let S_F_mkt: Int?
    let deltaStar: Double?
    let blockReasons: [String]?
    let researchNotes: [String]?

    var enterLabel: String { (Enter == true) ? "진입 후보" : "관찰" }
    var discountText: String {
        guard let d else { return "-" }
        return String(format: "낙폭 %.0f%%", d * 100)
    }
    var sizeText: String {
        guard let f else { return "-" }
        return String(format: "비중 %.1f%%", f * 100)
    }

    var asStock: Stock {
        Stock(code: code, name: name, tag: sectorId, sector: sectorId)
    }
}
