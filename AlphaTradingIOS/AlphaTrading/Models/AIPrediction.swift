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
    /// 점수와 예측 방향이 반대일 때 그 이유를 설명하는 문장 (구버전 응답에는 없음)
    let context: String?
    /// 점수·예측을 결합한 요약 뱃지 (구버전 응답에는 없음)
    let combined: CombinedSignal?

    var confidenceLabel: String {
        switch confidence {
        case "high": return "높음"
        case "medium": return "보통"
        default: return "낮음"
        }
    }

    var isUp: Bool { direction == "UP" }
}

/// 점수·예측을 결합한 요약 뱃지 — 예: badge="반등 매수 후보", tone="up"|"down"
struct CombinedSignal: Decodable {
    let badge: String
    let tone: String
    let note: String

    var isUp: Bool { tone == "up" }
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
