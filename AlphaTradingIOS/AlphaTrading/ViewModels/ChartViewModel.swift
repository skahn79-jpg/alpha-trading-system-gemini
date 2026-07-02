import Foundation

@MainActor
final class ChartViewModel: ObservableObject {
    @Published var candles: [ChartCandle] = []
    @Published var quote: Quote?
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load(code: String, period: String = "D") async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let chartTask: ChartResponse = APIClient.shared.get(
                "/api/chart/\(code)",
                query: [
                    URLQueryItem(name: "period", value: period),
                    // MA60·볼린저를 표시 구간(60봉) 전체에 그리려면 여유 데이터 필요 (주/월봉은 KIS가 ~30봉 제공)
                    URLQueryItem(name: "count", value: period == "D" ? "120" : "60"),
                    URLQueryItem(name: "analyze", value: "0"),
                ]
            )
            async let quoteTask: Quote = APIClient.shared.get("/api/quote/\(code)", query: [
                URLQueryItem(name: "lite", value: "1"),
            ])
            let (chart, q) = try await (chartTask, quoteTask)
            candles = chart.candles.reversed()
            quote = q
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
