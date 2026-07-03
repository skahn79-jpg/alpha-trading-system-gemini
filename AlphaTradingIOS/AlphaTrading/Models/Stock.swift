import Foundation

enum AssetKind: String {
    case kr, us, crypto
}

struct Stock: Identifiable, Codable, Hashable {
    var id: String { code }
    let code: String
    let name: String
    var tag: String?
    var sector: String?
    /// nil = 국내 주식(기존 저장 데이터 호환), "us" = 미국 주식, "crypto" = 암호화폐
    var assetType: String?

    var kind: AssetKind {
        switch assetType {
        case "us": return .us
        case "crypto": return .crypto
        default: return .kr
        }
    }
}

struct MasterSearchResponse: Decodable {
    let ok: Bool
    let q: String?
    let count: Int?
    let results: [MasterStock]
}

struct MasterStock: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let name: String
    let market: String?
    let tag: String?
    let sector: String?

    func asStock() -> Stock {
        Stock(code: code, name: name, tag: tag, sector: sector)
    }
}

struct AIAnalyzeRequest: Encodable {
    let prompt: String
    let systemPrompt: String?
    let maxTokens: Int?
}

struct AIAnalyzeResponse: Decodable {
    let ok: Bool
    let text: String?
    let error: String?
    let fallback: Bool?
}

struct PortfolioHolding: Identifiable, Codable {
    var id: String { code }
    let code: String
    let name: String
    var quantity: Double
    var avgPrice: Double

    var costBasis: Double { quantity * avgPrice }
}
