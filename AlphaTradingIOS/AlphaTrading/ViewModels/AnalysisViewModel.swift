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

    func load(code: String, sector: String?, market: String?) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let analyzeTask: StockAnalysisResponse = APIClient.shared.get("/api/analyze/\(code)")
            async let quoteTask: FullQuote = APIClient.shared.get("/api/quote/\(code)", query: [
                URLQueryItem(name: "lite", value: "0"),
            ])
            let (analyze, q) = try await (analyzeTask, quoteTask)
            analysis = analyze.analysis ?? q.analysis
            quote = q
            // AI 예측은 부가 정보 — 실패해도 화면을 막지 않음
            prediction = try? await APIClient.shared.get("/api/ai/predict/\(code)") as AIPrediction
            if let sector, !sector.isEmpty {
                await loadSectorPeers(sector: sector, market: market)
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
                aiError = response.error ?? "AI 분석 실패"
            }
        } catch {
            aiError = error.localizedDescription
        }
    }
}
