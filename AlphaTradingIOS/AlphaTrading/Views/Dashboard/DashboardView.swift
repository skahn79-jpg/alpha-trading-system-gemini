import SwiftUI

struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @State private var tradeReport: TradeReport?
    @State private var featured: FeaturedSignalsResponse?
    @State private var axiosNews: AxiosNewsResponse?
    @State private var fx: FxResponse?
    // 환율 실시간 갱신 (30초)
    private let fxTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("시장 요약")
                        .font(.paperlogy(22, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)

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
                    featuredSection
                    axiosNewsSection
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
        async let fxTask = try? APIClient.shared.get("/api/fx") as FxResponse
        _ = await indexTask
        tradeReport = await tradeTask
        featured = await featuredTask
        axiosNews = await newsTask
        fx = await fxTask
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
}
