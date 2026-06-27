import Foundation

struct Stock: Identifiable, Codable, Hashable {
    var id: String { code }
    let code: String
    let name: String
    var tag: String?
    var sector: String?
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
