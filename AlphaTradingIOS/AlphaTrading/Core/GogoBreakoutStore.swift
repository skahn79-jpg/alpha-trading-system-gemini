import Foundation

/// Watchlist scan for 고고저 high/low-zone breakouts (chart-parity with GogoZoneDetector).
enum GogoBreakoutScanner {
    static func scanWatchlist() async -> [GogoBreakoutItem] {
        let watchlist = Array(SignalInbox.watchlistCodes().prefix(10))
        guard !watchlist.isEmpty else { return [] }
        return await withTaskGroup(of: GogoBreakoutItem?.self, returning: [GogoBreakoutItem].self) { group in
            for stock in watchlist {
                group.addTask {
                    await scan(stock)
                }
            }
            var found: [GogoBreakoutItem] = []
            for await item in group {
                if let item { found.append(item) }
            }
            return found.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        }
    }

    static func scan(_ stock: Stock) async -> GogoBreakoutItem? {
        guard let candles = await fetchCandles(stock) else { return nil }
        return MarketSignalEngine.gogoBreakout(
            code: stock.code,
            name: stock.name,
            candles: candles,
            assetType: stock.assetType
        )
    }

    static func fetchCandles(_ stock: Stock) async -> [ChartCandle]? {
        do {
            if stock.kind == .kr {
                let chart: ChartResponse = try await APIClient.shared.get(
                    "/api/chart/\(stock.code)",
                    query: [
                        URLQueryItem(name: "period", value: "D"),
                        URLQueryItem(name: "count", value: "80"),
                        URLQueryItem(name: "analyze", value: "0"),
                    ]
                )
                return Array(chart.candles.reversed())
            }
            let chart: ChartResponse = try await APIClient.shared.get(
                "/api/global/chart/\(stock.code)",
                query: [
                    URLQueryItem(name: "type", value: stock.kind.rawValue),
                    URLQueryItem(name: "period", value: "D"),
                    URLQueryItem(name: "range", value: "1Y"),
                    URLQueryItem(name: "count", value: "80"),
                ]
            )
            return chart.candles
        } catch {
            return nil
        }
    }
}

@MainActor
final class GogoBreakoutStore: ObservableObject {
    static let shared = GogoBreakoutStore()

    @Published private(set) var items: [GogoBreakoutItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var didLoad = false

    private init() {}

    func refresh() async {
        isLoading = true
        let scanned = await GogoBreakoutScanner.scanWatchlist()
        items = scanned
        didLoad = true
        isLoading = false
    }
}
