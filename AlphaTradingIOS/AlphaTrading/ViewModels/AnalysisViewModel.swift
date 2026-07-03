import Foundation

@MainActor
final class AnalysisViewModel: ObservableObject {
    @Published var analysis: CandleAnalysis?
    @Published var quote: FullQuote?
    @Published var prediction: AIPrediction?
    @Published var sectorPeers: [MasterStock] = []
    @Published var aiSummary = ""
    @Published var isLoading = false
    @Published var isLoadingAI = false
    @Published var errorMessage: String?
    @Published var aiError: String?

    func load(code: String, sector: String?, market: String?, kind: AssetKind = .kr) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            if kind == .kr {
                async let analyzeTask: StockAnalysisResponse = APIClient.shared.get("/api/analyze/\(code)")
                async let quoteTask: FullQuote = APIClient.shared.get("/api/quote/\(code)", query: [
                    URLQueryItem(name: "lite", value: "0"),
                ])
                let (analyze, q) = try await (analyzeTask, quoteTask)
                analysis = analyze.analysis ?? q.analysis
                quote = q
                // AI 예측은 부가 정보 — 실패해도 화면을 막지 않음
                prediction = try? await APIClient.shared.get("/api/predict/\(code)") as AIPrediction
                if let sector, !sector.isEmpty {
                    await loadSectorPeers(sector: sector, market: market)
                }
            } else {
                // 미국주식/코인 — Yahoo 캔들 기반 동일 분석 엔진
                let analyze: StockAnalysisResponse = try await APIClient.shared.get(
                    "/api/global/analyze/\(code)",
                    query: [URLQueryItem(name: "type", value: kind.rawValue)]
                )
                analysis = analyze.analysis
                quote = nil
                prediction = nil
                sectorPeers = []
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadSectorPeers(sector: String, market: String?) async {
        do {
            var query = [
                URLQueryItem(name: "sector", value: sector),
                URLQueryItem(name: "limit", value: "8"),
            ]
            if let market, !market.isEmpty {
                query.append(URLQueryItem(name: "market", value: market))
            }
            let response: SectorStocksResponse = try await APIClient.shared.get(
                "/api/master/by-sector",
                query: query
            )
            sectorPeers = response.results
        } catch {
            sectorPeers = []
        }
    }

    func runAIAnalysis(stock: Stock) async {
        isLoadingAI = true
        aiError = nil
        defer { isLoadingAI = false }
        let priceText = quote?.displayPrice ?? "-"
        let changeText = quote?.displayChange ?? "-"
        let summary = analysis?.summary ?? "분석 데이터 없음"
        let prompt = """
        종목: \(stock.name) (\(stock.code))
        업종: \(stock.sector ?? "-")
        현재가: \(priceText) (\(changeText))
        기술분석: \(summary)
        RSI: \(analysis?.rsi.map { String(format: "%.1f", $0) } ?? "-")
        시그널: \(analysis?.signalBadge ?? "-")
        위 정보를 바탕으로 3~5문장의 전문가 스타일 빠른 분석을 작성해주세요. 투자 권유는 하지 마세요.
        """
        do {
            let body = AIAnalyzeRequest(
                prompt: prompt,
                systemPrompt: "한국 주식 애널리스트 톤으로 간결하게 답변하세요.",
                maxTokens: 600
            )
            let response: AIAnalyzeResponse = try await APIClient.shared.post("/api/ai/analyze", body: body)
            if response.ok, let text = response.text {
                aiSummary = text
            } else {
                aiSummary = fallbackSummary(stock: stock)
            }
        } catch {
            // Gemini 미설정(APP_API_KEY) 등 서버 AI 불가 시 — 이미 로드된 지표로 규칙 기반 요약 생성
            aiSummary = fallbackSummary(stock: stock)
        }
    }

    /// Gemini 없이 기술 지표·AI 예측만으로 구성하는 규칙 기반 빠른 요약
    private func fallbackSummary(stock: Stock) -> String {
        var lines: [String] = []

        if let a = analysis {
            if let score = a.score, let grade = a.grade {
                lines.append("\(stock.name)의 기술적 종합 점수는 \(score)점(\(grade)등급)으로, 현재 시그널은 '\(a.signalBadge ?? "중립")'입니다.")
            }
            var trendBits: [String] = []
            if let adx = a.adx, let val = adx.adx {
                let dir = adx.direction == "up" ? "상승" : adx.direction == "down" ? "하락" : "중립"
                trendBits.append("추세 강도(ADX)는 \(String(format: "%.1f", val))로 \(adx.strengthLabel), 방향은 \(dir)")
            }
            if let ichi = a.ichimoku {
                trendBits.append("일목균형표상 \(ichi.statusLabel)")
            }
            if let st = a.supertrend {
                trendBits.append("SuperTrend는 \(st.direction == "up" ? "상승" : "하락") 추세\(st.flipped == true ? " (직전 전환)" : "")")
            }
            if !trendBits.isEmpty {
                lines.append(trendBits.joined(separator: ", ") + "입니다.")
            }
            if let signals = a.signals, !signals.isEmpty {
                lines.append("주요 시그널: " + signals.prefix(4).joined(separator: " · "))
            }
        }

        if let p = prediction {
            let prob = p.isUp ? p.probUp : (p.probDown ?? 100 - p.probUp)
            lines.append(String(format: "AI 학습 모델은 %@ 확률을 %.1f%%로 추정합니다 (신뢰도 %@).", p.isUp ? "상승" : "하락", prob, p.confidenceLabel))
        }

        if lines.isEmpty {
            return "분석 데이터를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해주세요."
        }
        lines.append("\n※ Gemini 서버 미설정으로 규칙 기반 자동 요약으로 대체되었습니다. (Render에 APP_API_KEY·GEMINI_API_KEY 설정 시 AI 문장 분석 활성화) 투자 권유가 아닙니다.")
        return lines.joined(separator: "\n\n")
    }
}
