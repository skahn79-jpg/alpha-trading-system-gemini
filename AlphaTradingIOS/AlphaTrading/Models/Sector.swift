import Foundation

struct SectorItem: Identifiable, Decodable, Hashable {
    var id: String { name }
    let name: String
    let count: Int
    let kospi: Int?
    let kosdaq: Int?
}

struct SectorsResponse: Decodable {
    let ok: Bool
    let market: String?
    let type: String?
    let count: Int?
    let totalSymbols: Int?
    let sectors: [SectorItem]
}

struct SectorStocksResponse: Decodable {
    let ok: Bool
    let sector: String?
    let market: String?
    let count: Int?
    let results: [MasterStock]
}

enum MarketFilter: String, CaseIterable, Identifiable {
    case all = "ALL"
    case kospi = "KOSPI"
    case kosdaq = "KOSDAQ"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "전체"
        case .kospi: return "코스피"
        case .kosdaq: return "코스닥"
        }
    }
}
