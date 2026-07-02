import Foundation

/// /api/ai/predict/:code 응답 — 온라인 학습 상승/하락 확률 예측
struct AIPrediction: Decodable {
    let code: String?
    let probUp: Double
    let probDown: Double?
    let direction: String
    let confidence: String
    let horizonDays: Int?
    let topFactors: [PredictionFactor]?
    let model: PredictionModelInfo?

    var confidenceLabel: String {
        switch confidence {
        case "high": return "높음"
        case "medium": return "보통"
        default: return "낮음"
        }
    }

    var isUp: Bool { direction == "UP" }
}

struct PredictionFactor: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let impact: Double
}

struct PredictionModelInfo: Decodable {
    let trained: Int?
    let accuracy: Double?
    let resolved: Int?
}
