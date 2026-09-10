import Foundation

@MainActor
final class ChartViewModel: ObservableObject {
    @Published var candles: [ChartCandle] = []
    @Published var quote: Quote?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var outlookLine: String?
    @Published var weeklyCandles: [ChartCandle] = []

    func load(code: String, period: String = "D", kind: AssetKind = .kr) async {
        isLoading = true
        errorMessage = nil
        outlookLine = nil
        weeklyCandles = []
        defer { isLoading = false }
        do {
            if kind == .kr {
                async let chartTask: ChartResponse = APIClient.shared.get(
                    "/api/chart/\(code)",
                    query: [
                        URLQueryItem(name: "period", value: period),
                        // MA60·볼린저를 표시 구간(60봉) 전체에 그리려면 여유 데이터 필요 (주/월봉은 KIS가 ~30봉 제공)
                        URLQueryItem(name: "count", value: period == "D" ? "300" : "80"),
                        URLQueryItem(name: "analyze", value: "0"),
                    ]
                )
                async let quoteTask: Quote = APIClient.shared.get("/api/quote/\(code)", query: [
                    URLQueryItem(name: "lite", value: "1"),
                ])
                let (chart, q) = try await (chartTask, quoteTask)
                candles = chart.candles.reversed()
                quote = q
                if period == "D" {
                    let extraCode = code
                    let extraKind = kind
                    Task { await self.loadDailyExtras(code: extraCode, kind: extraKind) }
                }
            } else {
                // 미국주식/코인 — Yahoo 캔들 (주봉/월봉은 period=W/M 그대로 지원)
                async let chartTask: ChartResponse = APIClient.shared.get(
                    "/api/global/chart/\(code)",
                    query: [
                        URLQueryItem(name: "type", value: kind.rawValue),
                        URLQueryItem(name: "period", value: period),
                        URLQueryItem(name: "range", value: period == "D" ? "2Y" : "10Y"),
                        URLQueryItem(name: "count", value: "300"),
                    ]
                )
                async let quoteTask: GlobalQuote = APIClient.shared.get(
                    kind == .us ? "/api/us/quote/\(code)" : "/api/crypto/quote/\(code)"
                )
                let (chart, gq) = try await (chartTask, quoteTask)
                candles = chart.candles // Yahoo는 과거→현재 순
                if period == "D" {
                    let extraCode = code
                    let extraKind = kind
                    Task { await self.loadDailyExtras(code: extraCode, kind: extraKind) }
                }
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

    private func loadDailyExtras(code: String, kind: AssetKind) async {
        async let outlook: Void = loadOutlook(code: code, kind: kind)
        async let weekly: Void = loadWeekly(code: code, kind: kind)
        _ = await (outlook, weekly)
    }

    private func loadWeekly(code: String, kind: AssetKind) async {
        do {
            if kind == .kr {
                let chart: ChartResponse = try await APIClient.shared.get(
                    "/api/chart/\(code)",
                    query: [
                        URLQueryItem(name: "period", value: "W"),
                        URLQueryItem(name: "count", value: "80"),
                        URLQueryItem(name: "analyze", value: "0"),
                    ]
                )
                weeklyCandles = chart.candles.reversed()
            } else {
                let chart: ChartResponse = try await APIClient.shared.get(
                    "/api/global/chart/\(code)",
                    query: [
                        URLQueryItem(name: "type", value: kind.rawValue),
                        URLQueryItem(name: "period", value: "W"),
                        URLQueryItem(name: "range", value: "10Y"),
                        URLQueryItem(name: "count", value: "80"),
                    ]
                )
                weeklyCandles = chart.candles
            }
        } catch {
            weeklyCandles = []
        }
    }

    /// 차트 랩 유사패턴 전망 한 줄 — 실패해도 메인 차트는 유지
    private func loadOutlook(code: String, kind: AssetKind) async {
        do {
            let query: [URLQueryItem] = kind == .kr ? [] : [URLQueryItem(name: "type", value: kind.rawValue)]
            let lab: ChartLabResponse = try await APIClient.shared.get("/api/chartlab/\(code)", query: query)
            guard let outlook = lab.outlook, let avg = outlook.avgReturn else { return }
            let horizon = outlook.horizon ?? 10
            let up = outlook.upProbability ?? 0
            outlookLine = String(format: "유사패턴 이후 %d일 평균 %+.1f%% · 상승확률 %d%%", horizon, avg, up)
        } catch {
            outlookLine = nil
        }
    }
}
