import Foundation

@MainActor
final class ChartViewModel: ObservableObject {
    @Published var candles: [ChartCandle] = []
    @Published var quote: Quote?
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load(code: String, period: String = "D", kind: AssetKind = .kr) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            if kind == .kr {
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
            } else {
                // 미국주식/코인 — Yahoo 캔들 (주봉/월봉은 period=W/M 그대로 지원)
                async let chartTask: ChartResponse = APIClient.shared.get(
                    "/api/global/chart/\(code)",
                    query: [
                        URLQueryItem(name: "type", value: kind.rawValue),
                        URLQueryItem(name: "period", value: period),
                        URLQueryItem(name: "range", value: period == "D" ? "1Y" : "5Y"),
                        URLQueryItem(name: "count", value: "120"),
                    ]
                )
                async let quoteTask: GlobalQuote = APIClient.shared.get(
                    kind == .us ? "/api/us/quote/\(code)" : "/api/crypto/quote/\(code)"
                )
                let (chart, gq) = try await (chartTask, quoteTask)
                candles = chart.candles // Yahoo는 과거→현재 순
                quote = Quote(
                    code: code, name: nil,
                    price: gq.price, change: gq.change, changeRate: gq.changeRate,
                    changeStr: gq.changeStr, open: nil, high: nil, low: nil,
                    volume: nil, up: gq.isUp
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
