import SwiftUI

struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @State private var tradeReport: TradeReport?
    @State private var featured: FeaturedSignalsResponse?
    @State private var axiosNews: AxiosNewsResponse?
    @State private var trumpNews: TrumpNewsResponse?
    @State private var fx: FxResponse?
    @State private var sectorTrends: SectorTrendsResponse?
    @State private var macro: MacroReport?
    @ObservedObject private var inbox = SignalInboxStore.shared
    @ObservedObject private var gogoBreakouts = GogoBreakoutStore.shared
    @State private var gogoListMode: GogoBreakoutListMode = .today
    private let gogoPreviewLimit = 3
    // 환율 실시간 갱신 (30초)
    private let fxTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("시장 요약")
                        .font(.paperlogy(22, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)

                    SignalBannerPair(signals: inbox.signals, showEmptySections: true) { signal in
                        NotificationRouter.shared.openSignal(signal)
                    }

                    gogoBreakoutSection

                    if viewModel.isLoading && viewModel.indices.isEmpty {
                        LoadingView()
                            .frame(height: 180)
                    } else if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.paperlogy(14))
                            .foregroundStyle(AppTheme.down)
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(viewModel.indices) { index in
                                IndexCardView(index: index)
                            }
                        }
                    }

                    fxSection
                    tradeSummarySection
                    macroSummarySection
                    featuredSection
                    sectorTrendsSection
                    axiosNewsSection
                    trumpNewsSection
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("대시보드")
            .navigationDestination(for: Stock.self) { stock in
                StockDetailView(stock: stock)
            }
            .refreshable { await loadAll() }
            .task { await loadAll() }
            .onReceive(fxTimer) { _ in
                Task { fx = try? await APIClient.shared.get("/api/fx") as FxResponse }
            }
        }
    }

    private func loadAll() async {
        async let indexTask: Void = viewModel.load()
        // 부가 섹션은 실패해도 대시보드를 막지 않음
        async let tradeTask = try? APIClient.shared.get("/api/trade/report") as TradeReport
        async let featuredTask = try? APIClient.shared.get("/api/signals/featured") as FeaturedSignalsResponse
        async let newsTask = try? APIClient.shared.get("/api/news/axios") as AxiosNewsResponse
        async let trumpTask = try? APIClient.shared.get("/api/news/trump") as TrumpNewsResponse
        async let fxTask = try? APIClient.shared.get("/api/fx") as FxResponse
        async let sectorTask = try? APIClient.shared.get("/api/sector/trends") as SectorTrendsResponse
        async let macroTask = try? APIClient.shared.get("/api/macro/indicators") as MacroReport
        async let gogoTask: Void = gogoBreakouts.refresh()
        await AlertMonitor.checkWatchlistSignals()
        await gogoTask
        _ = await indexTask
        tradeReport = await tradeTask
        featured = await featuredTask
        axiosNews = await newsTask
        trumpNews = await trumpTask
        fx = await fxTask
        sectorTrends = await sectorTask
        macro = await macroTask
    }

    // MARK: - 고고저 돌파 (코스피 / 코스닥 / 해외)

    @ViewBuilder
    private var gogoBreakoutSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                Image(systemName: "triangle.fill")
                    .foregroundStyle(AppTheme.up)
                VStack(alignment: .leading, spacing: 2) {
                    Text("고고저 돌파")
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(gogoBreakouts.scanSummary)
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(gogoListMode.subtitle + " · 거래량·양봉 · 급경사 제외")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Spacer()
                if gogoBreakouts.isLoading {
                    ProgressView()
                        .scaleEffect(0.8)
                }
                NavigationLink {
                    GogoBreakoutFullListView(initialMode: gogoListMode)
                } label: {
                    HStack(spacing: 4) {
                        Text("전체")
                            .font(.paperlogy(11, weight: .semibold))
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                    }
                    .foregroundStyle(AppTheme.accent)
                }
            }

            Picker("고고저 목록", selection: $gogoListMode) {
                ForEach(GogoBreakoutListMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if gogoBreakouts.isLoading && !gogoBreakouts.didLoad {
                Text("코스피·코스닥·해외 차트를 확인하는 중…")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(GogoMarketGroup.allCases) { group in
                    gogoMarketGroup(group)
                }
                if gogoBreakouts.items(mode: gogoListMode).count > gogoPreviewLimit * GogoMarketGroup.allCases.count {
                    NavigationLink {
                        GogoBreakoutFullListView(initialMode: gogoListMode)
                    } label: {
                        Text("전체 \(gogoBreakouts.items(mode: gogoListMode).count)종목 보기")
                            .font(.paperlogy(12, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 4)
                    }
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func gogoMarketGroup(_ group: GogoMarketGroup) -> some View {
        let rows = gogoBreakouts.items(in: group, mode: gogoListMode)
        let preview = Array(rows.prefix(gogoPreviewLimit))
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(group.title)
                    .font(.paperlogy(13, weight: .semibold))
                    .foregroundStyle(AppTheme.accent)
                Text("\(rows.count)")
                    .font(.paperlogy(11, weight: .bold))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                if rows.count > gogoPreviewLimit {
                    NavigationLink {
                        GogoBreakoutFullListView(initialMode: gogoListMode, focusGroup: group)
                    } label: {
                        Text("더보기")
                            .font(.paperlogy(11, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                    }
                }
            }
            if rows.isEmpty {
                Text(gogoListMode == .today ? "오늘 신규 돌파 없음" : "최근 \(GogoZoneDetector.recentBreakoutLookbackTradingDays)거래일 돌파 없음")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
                    .padding(.vertical, 2)
            } else {
                ForEach(preview) { item in
                    NavigationLink(value: item.asStock) {
                        gogoBreakoutRow(item)
                    }
                }
            }
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private func gogoBreakoutRow(_ item: GogoBreakoutItem) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(item.ageBadge)
                .font(.paperlogy(10, weight: .bold))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(AppTheme.up.opacity(0.2))
                .foregroundStyle(AppTheme.up)
                .clipShape(Capsule())
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text("\(item.code) · \(item.detail)")
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(2)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.vertical, 4)
    }

    // MARK: - 실시간 환율

    @ViewBuilder
    private var fxSection: some View {
        if let fx {
            HStack(spacing: 12) {
                fxCard(title: "원/달러", rate: fx.usdKrw)
                fxCard(title: "원/엔 (100엔)", rate: fx.jpy100Krw)
            }
        }
    }

    @ViewBuilder
    private func fxCard(title: String, rate: FxRate?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.paperlogy(11))
                .foregroundStyle(AppTheme.textSecondary)
            Text(rate.map { String(format: "%.2f", $0.price) } ?? "-")
                .font(.paperlogy(20, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
                .contentTransition(.numericText())
                .animation(.default, value: rate?.price ?? 0)
            if let changeRate = rate?.changeRate {
                // 환율 상승 = 원화 약세 → 빨강 (국내 관례)
                Text(String(format: "%+.2f%%", changeRate))
                    .font(.paperlogy(11, weight: .semibold))
                    .foregroundStyle(changeRate >= 0 ? AppTheme.down : AppTheme.up)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - 악시오스 뉴스

    @ViewBuilder
    private var axiosNewsSection: some View {
        if let news = axiosNews, let items = news.items, !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "newspaper.fill")
                        .foregroundStyle(AppTheme.accent)
                    Text("Axios 뉴스")
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                }
                ForEach(items.prefix(5)) { item in
                    if let url = URL(string: item.link) {
                        Link(destination: url) {
                            HStack(alignment: .top, spacing: 8) {
                                Text("·")
                                    .foregroundStyle(AppTheme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(.paperlogy(13))
                                        .foregroundStyle(AppTheme.textPrimary)
                                        .multilineTextAlignment(.leading)
                                        .lineLimit(2)
                                    Text(item.timeAgoText)
                                        .font(.paperlogy(10))
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                                Spacer()
                                Image(systemName: "arrow.up.right")
                                    .font(.caption2)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: - 트럼프 정책·미디어 관찰

    @ViewBuilder
    private var trumpNewsSection: some View {
        if let news = trumpNews, let topics = news.topics, !topics.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "megaphone.fill")
                        .foregroundStyle(AppTheme.accent)
                    Text("트럼프 정책·미디어 관찰")
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                }
                ForEach(topics) { topic in
                    if !topic.items.isEmpty {
                        Text(topic.topic)
                            .font(.paperlogy(13, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                            .padding(.top, 2)
                        ForEach(topic.items.prefix(4)) { item in
                            if let url = URL(string: item.link) {
                                Link(destination: url) {
                                    HStack(alignment: .top, spacing: 8) {
                                        Text("·")
                                            .foregroundStyle(AppTheme.accent)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.title)
                                                .font(.paperlogy(13))
                                                .foregroundStyle(AppTheme.textPrimary)
                                                .multilineTextAlignment(.leading)
                                                .lineLimit(2)
                                            HStack(spacing: 6) {
                                                if let source = item.source {
                                                    Text(source)
                                                        .font(.paperlogy(10))
                                                        .foregroundStyle(AppTheme.textSecondary)
                                                }
                                                Text(item.timeAgoText)
                                                    .font(.paperlogy(10))
                                                    .foregroundStyle(AppTheme.textSecondary)
                                            }
                                        }
                                        Spacer()
                                        Image(systemName: "arrow.up.right")
                                            .font(.caption2)
                                            .foregroundStyle(AppTheme.textSecondary)
                                    }
                                    .padding(.vertical, 3)
                                }
                            }
                        }
                    }
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: - 수출입 요약

    @ViewBuilder
    private var tradeSummarySection: some View {
        if let report = tradeReport, let latest = report.latest {
            NavigationLink {
                TradeReportView()
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "shippingbox.fill")
                            .foregroundStyle(AppTheme.accent)
                        Text("한국 수출입")
                            .font(.paperlogy(16, weight: .semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                        Text(report.trendLabel)
                            .font(.paperlogy(11, weight: .bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(trendColor(report.trend).opacity(0.2))
                            .foregroundStyle(trendColor(report.trend))
                            .clipShape(Capsule())
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    HStack(spacing: 16) {
                        dashboardStat("수출(\(latest.month))", latest.exportsBillionText, latest.exportsYoY)
                        dashboardStat("무역수지", latest.balanceBillionText, nil)
                        if let yoy = latest.importsYoY {
                            dashboardStat("수입 전년比", String(format: "%+.1f%%", yoy), nil)
                        }
                    }
                }
                .padding(16)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    // MARK: - 거시지표 요약

    @ViewBuilder
    private var macroSummarySection: some View {
        if let macro, macro.ok, !macro.dashboardHeadlines.isEmpty {
            NavigationLink {
                MacroView()
            } label: {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: "globe.americas.fill")
                            .foregroundStyle(AppTheme.accent)
                        Text("거시지표 요약")
                            .font(.paperlogy(16, weight: .semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                        Text(macro.moodLabel ?? "혼조")
                            .font(.paperlogy(11, weight: .bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(macroMoodColor(macro.mood).opacity(0.2))
                            .foregroundStyle(macroMoodColor(macro.mood))
                            .clipShape(Capsule())
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    HStack(spacing: 10) {
                        Text("우호 \(macro.supportive ?? 0)")
                            .font(.paperlogy(11, weight: .semibold))
                            .foregroundStyle(AppTheme.up)
                        Text("부담 \(macro.headwind ?? 0)")
                            .font(.paperlogy(11, weight: .semibold))
                            .foregroundStyle(AppTheme.down)
                    }
                    ForEach(macro.dashboardHeadlines) { item in
                        HStack(spacing: 8) {
                            Text(item.name)
                                .font(.paperlogy(13, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            if let change = item.changeText {
                                Text(change)
                                    .font(.paperlogy(10, weight: .semibold))
                                    .foregroundStyle((item.change ?? 0) >= 0 ? AppTheme.up : AppTheme.down)
                            }
                            Text(item.valueText)
                                .font(.paperlogy(13, weight: .bold))
                                .foregroundStyle(AppTheme.textPrimary)
                            Text(item.stanceLabel)
                                .font(.paperlogy(10, weight: .bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(macroStanceColor(item.stance).opacity(0.2))
                                .foregroundStyle(macroStanceColor(item.stance))
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(16)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private func macroMoodColor(_ mood: String?) -> Color {
        switch mood {
        case "risk_on": return AppTheme.up
        case "risk_off": return AppTheme.down
        default: return AppTheme.accent
        }
    }

    private func macroStanceColor(_ stance: String?) -> Color {
        switch stance {
        case "supportive": return AppTheme.up
        case "headwind": return AppTheme.down
        default: return AppTheme.accent
        }
    }

    private func dashboardStat(_ title: String, _ value: String, _ yoy: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.paperlogy(10))
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.paperlogy(14, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            if let yoy {
                Text(String(format: "전년比 %+.1f%%", yoy))
                    .font(.paperlogy(9))
                    .foregroundStyle(yoy >= 0 ? AppTheme.up : AppTheme.down)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func trendColor(_ trend: String?) -> Color {
        switch trend {
        case "increase": return AppTheme.up
        case "decrease": return AppTheme.down
        default: return AppTheme.accent
        }
    }

    // MARK: - 특징 종목 (바닥·상승 전환 신호)

    @ViewBuilder
    private var featuredSection: some View {
        if let featured, !featured.results.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "sparkle.magnifyingglass")
                        .foregroundStyle(AppTheme.accent)
                    Text("특징 종목")
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                    NavigationLink {
                        FeaturedSignalsView()
                    } label: {
                        Text("전체 보기")
                            .font(.paperlogy(12, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    }
                }
                ForEach(featured.results.prefix(3)) { stock in
                    NavigationLink(value: stock.asStock) {
                        HStack(spacing: 8) {
                            Text(stock.kindLabel)
                                .font(.paperlogy(10, weight: .bold))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background((stock.kind == "turn" ? AppTheme.up : AppTheme.accent).opacity(0.2))
                                .foregroundStyle(stock.kind == "turn" ? AppTheme.up : AppTheme.accent)
                                .clipShape(Capsule())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(stock.name)
                                    .font(.paperlogy(14, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                Text(stock.reasons.prefix(2).joined(separator: " · "))
                                    .font(.paperlogy(10))
                                    .foregroundStyle(AppTheme.textSecondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if let score = stock.score {
                                Text("\(score)점")
                                    .font(.paperlogy(12, weight: .bold))
                                    .foregroundStyle(AppTheme.accent)
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: - 유망 업종 TOP5

    @ViewBuilder
    private var sectorTrendsSection: some View {
        if let trends = sectorTrends {
            let top = trends.top ?? []
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("🔥 유망 업종 TOP5")
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                }
                if (trends.building ?? false) || top.isEmpty {
                    Text("집계 중")
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(top.prefix(5), id: \.rank) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(item.rank)")
                                .font(.paperlogy(13, weight: .bold))
                                .foregroundStyle(AppTheme.accent)
                                .frame(width: 20, alignment: .center)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.sector)
                                    .font(.paperlogy(14, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                if let reason = item.reason, !reason.isEmpty {
                                    Text(reason)
                                        .font(.paperlogy(10))
                                        .foregroundStyle(AppTheme.textSecondary)
                                        .lineLimit(2)
                                }
                            }
                            Spacer()
                            if let ret1m = item.ret1m {
                                // 국내 관례: 상승 빨강(up), 하락 파랑(down)
                                Text(String(format: "%+.1f%%", ret1m))
                                    .font(.paperlogy(13, weight: .bold))
                                    .foregroundStyle(ret1m >= 0 ? AppTheme.up : AppTheme.down)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

// MARK: - 유망 업종 응답 모델

struct SectorTrendsResponse: Decodable {
    let ok: Bool?
    let top: [SectorTrend]?
    let note: String?
    let building: Bool?
}

struct SectorTrend: Decodable {
    let rank: Int
    let sector: String
    let ret1w: Double?
    let ret1m: Double?
    let ret3m: Double?
    let reason: String?
    let exportNote: String?
    let leaders: [SectorLeader]?
}

struct SectorLeader: Decodable {
    let code: String
    let name: String
}

// MARK: - 고고저 전체 목록

struct GogoBreakoutFullListView: View {
    @ObservedObject private var store = GogoBreakoutStore.shared
    @State private var mode: GogoBreakoutListMode
    var focusGroup: GogoMarketGroup?

    init(initialMode: GogoBreakoutListMode = .today, focusGroup: GogoMarketGroup? = nil) {
        _mode = State(initialValue: initialMode)
        self.focusGroup = focusGroup
    }

    private var groups: [GogoMarketGroup] {
        if let focusGroup { return [focusGroup] }
        return GogoMarketGroup.allCases
    }

    var body: some View {
        List {
            Section {
                Picker("고고저 목록", selection: $mode) {
                    ForEach(GogoBreakoutListMode.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                Text(mode.subtitle + " · 거래량·양봉 확인 · 급경사 제외")
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            ForEach(groups) { group in
                gogoFullSection(group)
            }
        }
        .navigationTitle("고고저 돌파")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Stock.self) { stock in
            StockDetailView(stock: stock)
        }
    }

    @ViewBuilder
    private func gogoFullSection(_ group: GogoMarketGroup) -> some View {
        let rows = store.items(in: group, mode: mode)
        Section(group.title + " (\(rows.count))") {
            if rows.isEmpty {
                Text(mode == .today ? "오늘 신규 돌파 없음" : "최근 돌파 없음")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(rows) { item in
                    NavigationLink(value: item.asStock) {
                        HStack(alignment: .top, spacing: 8) {
                            Text(item.ageBadge)
                                .font(.paperlogy(10, weight: .bold))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(AppTheme.up.opacity(0.2))
                                .foregroundStyle(AppTheme.up)
                                .clipShape(Capsule())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name)
                                    .font(.paperlogy(14, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                Text("\(item.code) · \(item.detail)")
                                    .font(.paperlogy(11))
                                    .foregroundStyle(AppTheme.textSecondary)
                                    .lineLimit(3)
                            }
                        }
                    }
                }
            }
        }
    }
}
