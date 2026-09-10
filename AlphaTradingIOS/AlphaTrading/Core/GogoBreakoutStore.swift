import Foundation

/// Scan candidate with a dashboard market bucket.
struct GogoScanCandidate: Equatable {
    var stock: Stock
    var group: GogoMarketGroup
}

/// Build the 고고저 돌파 universe from existing market lists (not watchlist-only).
enum GogoBreakoutUniverse {
    static let kospiScanLimit = 50
    static let kosdaqScanLimit = 50
    static let overseasScanLimit = 16
    static let featuredBonusLimit = 15
    static let watchlistBonusLimit = 12
    static let fetchConcurrency = 5
    static let candleCount = 160

    /// trading-platform KOSPI200_SCREEN_UNIVERSE (API 실패 시)
    static let fallbackKospi: [Stock] = [
        Stock(code: "005930", name: "삼성전자", tag: "반도체", sector: "반도체"),
        Stock(code: "000660", name: "SK하이닉스", tag: "반도체", sector: "반도체"),
        Stock(code: "005380", name: "현대차", tag: "자동차", sector: "자동차"),
        Stock(code: "000270", name: "기아", tag: "자동차", sector: "자동차"),
        Stock(code: "012330", name: "현대모비스", tag: "자동차부품", sector: "자동차"),
        Stock(code: "005490", name: "POSCO홀딩스", tag: "철강/2차전지", sector: "철강"),
        Stock(code: "051910", name: "LG화학", tag: "화학/2차전지", sector: "2차전지"),
        Stock(code: "006400", name: "삼성SDI", tag: "2차전지", sector: "2차전지"),
        Stock(code: "373220", name: "LG에너지솔루션", tag: "2차전지", sector: "2차전지"),
        Stock(code: "207940", name: "삼성바이오로직스", tag: "바이오", sector: "바이오"),
        Stock(code: "068270", name: "셀트리온", tag: "바이오", sector: "바이오"),
        Stock(code: "035420", name: "NAVER", tag: "플랫폼", sector: "인터넷"),
        Stock(code: "035720", name: "카카오", tag: "플랫폼", sector: "인터넷"),
        Stock(code: "105560", name: "KB금융", tag: "금융", sector: "금융"),
        Stock(code: "055550", name: "신한지주", tag: "금융", sector: "금융"),
        Stock(code: "086790", name: "하나금융지주", tag: "금융", sector: "금융"),
        Stock(code: "316140", name: "우리금융지주", tag: "금융", sector: "금융"),
        Stock(code: "000810", name: "삼성화재", tag: "보험", sector: "금융"),
        Stock(code: "032830", name: "삼성생명", tag: "보험", sector: "금융"),
        Stock(code: "033780", name: "KT&G", tag: "소비재", sector: "소비재"),
        Stock(code: "034730", name: "SK", tag: "지주", sector: "지주"),
        Stock(code: "017670", name: "SK텔레콤", tag: "통신", sector: "통신"),
        Stock(code: "030200", name: "KT", tag: "통신", sector: "통신"),
        Stock(code: "015760", name: "한국전력", tag: "전력", sector: "유틸리티"),
        Stock(code: "011200", name: "HMM", tag: "해운", sector: "운송"),
        Stock(code: "010130", name: "고려아연", tag: "비철금속", sector: "소재"),
        Stock(code: "028260", name: "삼성물산", tag: "지주/건설", sector: "지주"),
        Stock(code: "018260", name: "삼성에스디에스", tag: "IT서비스", sector: "IT"),
        Stock(code: "096770", name: "SK이노베이션", tag: "정유/배터리", sector: "에너지"),
        Stock(code: "011070", name: "LG이노텍", tag: "전자부품", sector: "전기전자"),
        Stock(code: "009150", name: "삼성전기", tag: "전자부품", sector: "전기전자"),
        Stock(code: "066570", name: "LG전자", tag: "전기전자", sector: "전기전자"),
        Stock(code: "003670", name: "포스코퓨처엠", tag: "2차전지", sector: "2차전지"),
        Stock(code: "009540", name: "HD한국조선해양", tag: "조선", sector: "조선"),
        Stock(code: "329180", name: "HD현대중공업", tag: "조선", sector: "조선"),
        Stock(code: "047810", name: "한국항공우주", tag: "방산", sector: "방산"),
        Stock(code: "012450", name: "한화에어로스페이스", tag: "방산", sector: "방산"),
        Stock(code: "042700", name: "한미반도체", tag: "반도체", sector: "반도체"),
        Stock(code: "259960", name: "크래프톤", tag: "게임", sector: "게임"),
        Stock(code: "352820", name: "하이브", tag: "엔터", sector: "엔터"),
    ]

    /// trading-platform KOSDAQ200_SCREEN_UNIVERSE (API 실패 시)
    static let fallbackKosdaq: [Stock] = [
        Stock(code: "247540", name: "에코프로비엠", tag: "2차전지", sector: "2차전지"),
        Stock(code: "086520", name: "에코프로", tag: "2차전지", sector: "2차전지"),
        Stock(code: "028300", name: "HLB", tag: "바이오", sector: "바이오"),
        Stock(code: "196170", name: "알테오젠", tag: "바이오", sector: "바이오"),
        Stock(code: "068760", name: "셀트리온제약", tag: "바이오", sector: "바이오"),
        Stock(code: "141080", name: "리가켐바이오", tag: "바이오", sector: "바이오"),
        Stock(code: "000250", name: "삼천당제약", tag: "제약", sector: "바이오"),
        Stock(code: "145020", name: "휴젤", tag: "바이오", sector: "바이오"),
        Stock(code: "214450", name: "파마리서치", tag: "바이오/미용", sector: "바이오"),
        Stock(code: "214150", name: "클래시스", tag: "미용의료기기", sector: "의료기기"),
        Stock(code: "058470", name: "리노공업", tag: "반도체", sector: "반도체"),
        Stock(code: "039030", name: "이오테크닉스", tag: "반도체장비", sector: "반도체"),
        Stock(code: "036930", name: "주성엔지니어링", tag: "반도체장비", sector: "반도체"),
        Stock(code: "240810", name: "원익IPS", tag: "반도체장비", sector: "반도체"),
        Stock(code: "064760", name: "티씨케이", tag: "반도체소재", sector: "반도체"),
        Stock(code: "095340", name: "ISC", tag: "반도체부품", sector: "반도체"),
        Stock(code: "089030", name: "테크윙", tag: "반도체장비", sector: "반도체"),
        Stock(code: "067310", name: "하나마이크론", tag: "반도체후공정", sector: "반도체"),
        Stock(code: "222800", name: "심텍", tag: "PCB", sector: "전자부품"),
        Stock(code: "101490", name: "에스앤에스텍", tag: "반도체소재", sector: "반도체"),
        Stock(code: "319660", name: "피에스케이", tag: "반도체장비", sector: "반도체"),
        Stock(code: "277810", name: "레인보우로보틱스", tag: "로봇", sector: "로봇"),
        Stock(code: "067160", name: "SOOP", tag: "플랫폼", sector: "인터넷"),
        Stock(code: "293490", name: "카카오게임즈", tag: "게임", sector: "게임"),
        Stock(code: "041510", name: "에스엠", tag: "엔터", sector: "엔터"),
        Stock(code: "035900", name: "JYP Ent.", tag: "엔터", sector: "엔터"),
        Stock(code: "263750", name: "펄어비스", tag: "게임", sector: "게임"),
        Stock(code: "112040", name: "위메이드", tag: "게임", sector: "게임"),
        Stock(code: "086900", name: "메디톡스", tag: "바이오", sector: "바이오"),
        Stock(code: "215200", name: "메가스터디교육", tag: "교육", sector: "교육"),
    ]

    /// /api/global/search 카탈로그 + NASDAQ 대표 (미국 주식)
    static let fallbackOverseas: [Stock] = [
        Stock(code: "NVDA", name: "NVIDIA", assetType: "us"),
        Stock(code: "AAPL", name: "Apple", assetType: "us"),
        Stock(code: "MSFT", name: "Microsoft", assetType: "us"),
        Stock(code: "GOOGL", name: "Alphabet", assetType: "us"),
        Stock(code: "META", name: "Meta Platforms", assetType: "us"),
        Stock(code: "AMZN", name: "Amazon", assetType: "us"),
        Stock(code: "TSLA", name: "Tesla", assetType: "us"),
        Stock(code: "AMD", name: "AMD", assetType: "us"),
        Stock(code: "AVGO", name: "Broadcom", assetType: "us"),
        Stock(code: "SMCI", name: "Super Micro Computer", assetType: "us"),
        Stock(code: "NFLX", name: "Netflix", assetType: "us"),
        Stock(code: "COST", name: "Costco", assetType: "us"),
        Stock(code: "INTC", name: "Intel", assetType: "us"),
        Stock(code: "QCOM", name: "Qualcomm", assetType: "us"),
        Stock(code: "AMAT", name: "Applied Materials", assetType: "us"),
        Stock(code: "MU", name: "Micron", assetType: "us"),
    ]

    static func classify(
        stock: Stock,
        kospiCodes: Set<String>,
        kosdaqCodes: Set<String>
    ) -> GogoMarketGroup {
        if stock.kind != .kr { return .overseas }
        if kosdaqCodes.contains(stock.code) { return .kosdaq }
        if kospiCodes.contains(stock.code) { return .kospi }
        return .kospi
    }

    static func mergeCandidates(
        kospi: [Stock],
        kosdaq: [Stock],
        overseas: [Stock],
        featured: [Stock] = [],
        watchlist: [Stock] = [],
        kospiCodes: Set<String> = [],
        kosdaqCodes: Set<String> = []
    ) -> [GogoScanCandidate] {
        var seen = Set<String>()
        var out: [GogoScanCandidate] = []

        func add(_ stock: Stock, preferred: GogoMarketGroup?) {
            let code = stock.code.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !code.isEmpty, !seen.contains(code) else { return }
            seen.insert(code)
            let group = preferred ?? classify(stock: stock, kospiCodes: kospiCodes, kosdaqCodes: kosdaqCodes)
            out.append(GogoScanCandidate(stock: stock, group: group))
        }

        for stock in kospi.prefix(kospiScanLimit) { add(stock, preferred: .kospi) }
        for stock in kosdaq.prefix(kosdaqScanLimit) { add(stock, preferred: .kosdaq) }
        for stock in overseas.prefix(overseasScanLimit) { add(stock, preferred: .overseas) }
        for stock in featured.prefix(featuredBonusLimit) { add(stock, preferred: nil) }
        for stock in watchlist.prefix(watchlistBonusLimit) { add(stock, preferred: nil) }
        return out
    }

    static func counts(in candidates: [GogoScanCandidate]) -> [GogoMarketGroup: Int] {
        var map: [GogoMarketGroup: Int] = [:]
        for item in candidates {
            map[item.group, default: 0] += 1
        }
        return map
    }
}

/// Market-universe scan for 고고저 breakouts (chart-parity with GogoZoneDetector).
enum GogoBreakoutScanner {
    static func loadScanPlan() async -> [GogoScanCandidate] {
        async let kospi200Task = loadUniverse("kospi200")
        async let kospiTask = loadUniverse("kospi")
        async let kosdaq200Task = loadUniverse("kosdaq200")
        async let kosdaqTask = loadUniverse("kosdaq")
        async let featuredTask = loadFeatured()
        async let overseasTask = loadOverseas()

        let kospi200 = await kospi200Task
        let kospiAll = await kospiTask
        let kosdaq200 = await kosdaq200Task
        let kosdaqAll = await kosdaqTask
        let featured = await featuredTask
        var overseas = await overseasTask

        let kospiCodes = Set((kospiAll + kospi200).map(\.code))
        let kosdaqCodes = Set((kosdaqAll + kosdaq200).map(\.code))

        let kospiScan = kospi200.count >= 20 ? kospi200 : (kospiAll.isEmpty ? GogoBreakoutUniverse.fallbackKospi : kospiAll)
        let kosdaqScan = kosdaq200.count >= 20 ? kosdaq200 : (kosdaqAll.isEmpty ? GogoBreakoutUniverse.fallbackKosdaq : kosdaqAll)
        if overseas.isEmpty {
            overseas = GogoBreakoutUniverse.fallbackOverseas
        }

        return GogoBreakoutUniverse.mergeCandidates(
            kospi: kospiScan,
            kosdaq: kosdaqScan,
            overseas: overseas,
            featured: featured,
            watchlist: SignalInbox.watchlistCodes(),
            kospiCodes: kospiCodes.union(Set(GogoBreakoutUniverse.fallbackKospi.map(\.code))),
            kosdaqCodes: kosdaqCodes.union(Set(GogoBreakoutUniverse.fallbackKosdaq.map(\.code)))
        )
    }

    static func scan(_ candidates: [GogoScanCandidate]) async -> [GogoBreakoutItem] {
        guard !candidates.isEmpty else { return [] }
        let chunkSize = GogoBreakoutUniverse.fetchConcurrency
        var found: [GogoBreakoutItem] = []
        var start = 0
        while start < candidates.count {
            let end = min(start + chunkSize, candidates.count)
            let chunk = Array(candidates[start..<end])
            let batch = await withTaskGroup(of: GogoBreakoutItem?.self, returning: [GogoBreakoutItem].self) { group in
                for candidate in chunk {
                    group.addTask {
                        await scan(candidate)
                    }
                }
                var rows: [GogoBreakoutItem] = []
                for await item in group {
                    if let item { rows.append(item) }
                }
                return rows
            }
            found.append(contentsOf: batch)
            start = end
        }
        return found.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    static func scan(_ candidate: GogoScanCandidate) async -> GogoBreakoutItem? {
        guard let candles = await fetchCandles(candidate.stock) else { return nil }
        return MarketSignalEngine.gogoBreakout(
            code: candidate.stock.code,
            name: candidate.stock.name,
            candles: candles,
            assetType: candidate.stock.assetType,
            marketGroup: candidate.group
        )
    }

    static func fetchCandles(_ stock: Stock) async -> [ChartCandle]? {
        let count = String(GogoBreakoutUniverse.candleCount)
        do {
            if stock.kind == .kr {
                let chart: ChartResponse = try await APIClient.shared.get(
                    "/api/chart/\(stock.code)",
                    query: [
                        URLQueryItem(name: "period", value: "D"),
                        URLQueryItem(name: "count", value: count),
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
                    URLQueryItem(name: "count", value: count),
                ]
            )
            return chart.candles
        } catch {
            return nil
        }
    }

    private static func loadUniverse(_ kind: String) async -> [Stock] {
        let response: UniverseResponse? = try? await APIClient.shared.get("/api/master/universe/\(kind)")
        return (response?.results ?? []).map { $0.asStock() }
    }

    private static func loadFeatured() async -> [Stock] {
        let response: FeaturedSignalsResponse? = try? await APIClient.shared.get("/api/signals/featured")
        return Array((response?.results ?? []).prefix(GogoBreakoutUniverse.featuredBonusLimit)).map(\.asStock)
    }

    private static func loadOverseas() async -> [Stock] {
        let items: [GlobalSearchItem]? = try? await APIClient.shared.get(
            "/api/global/search",
            query: [URLQueryItem(name: "q", value: "")]
        )
        let us = (items ?? []).filter { ($0.type ?? "us").lowercased() != "crypto" }
        if us.isEmpty { return GogoBreakoutUniverse.fallbackOverseas }
        return us.map {
            Stock(code: $0.symbol, name: $0.name, tag: $0.sector, sector: $0.sector, assetType: "us")
        }
    }
}

@MainActor
final class GogoBreakoutStore: ObservableObject {
    static let shared = GogoBreakoutStore()

    @Published private(set) var items: [GogoBreakoutItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var didLoad = false
    @Published private(set) var scannedCounts: [GogoMarketGroup: Int] = [:]

    private init() {}

    func items(in group: GogoMarketGroup) -> [GogoBreakoutItem] {
        items.filter { $0.marketGroup == group }
    }

    var scanSummary: String {
        let k = scannedCounts[.kospi, default: 0]
        let q = scannedCounts[.kosdaq, default: 0]
        let o = scannedCounts[.overseas, default: 0]
        let total = k + q + o
        if total == 0 { return "시장 유니버스 스캔" }
        return "코스피 \(k) · 코스닥 \(q) · 해외 \(o)종목 스캔"
    }

    func refresh() async {
        isLoading = true
        let plan = await GogoBreakoutScanner.loadScanPlan()
        scannedCounts = GogoBreakoutUniverse.counts(in: plan)
        var collected: [GogoBreakoutItem] = []
        for group in GogoMarketGroup.allCases {
            let slice = plan.filter { $0.group == group }
            let found = await GogoBreakoutScanner.scan(slice)
            collected.append(contentsOf: found)
            items = Self.sorted(collected)
            didLoad = true
        }
        items = Self.sorted(collected)
        didLoad = true
        isLoading = false
    }

    private static func sorted(_ rows: [GogoBreakoutItem]) -> [GogoBreakoutItem] {
        rows.sorted { lhs, rhs in
            if lhs.marketGroup != rhs.marketGroup {
                return (GogoMarketGroup.allCases.firstIndex(of: lhs.marketGroup) ?? 0)
                    < (GogoMarketGroup.allCases.firstIndex(of: rhs.marketGroup) ?? 0)
            }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }
}
