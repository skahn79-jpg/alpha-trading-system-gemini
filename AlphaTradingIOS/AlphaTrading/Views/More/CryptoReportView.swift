import SwiftUI
import Charts

/// 암호화폐 관찰 리포트 — BTC/ETH 차트 분석 + 업황 + 규제(CLARITY 법안 등) 지속 관찰
struct CryptoReportView: View {
    @State private var report: CryptoReportResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if isLoading {
                    LoadingView(message: "암호화폐 업황 분석 중...")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.down)
                        .padding()
                } else if let report {
                    marketMoodCard(report)
                    ForEach(report.markets ?? []) { market in
                        marketCard(market)
                    }
                    regulationCard(report)
                    if let disclaimer = report.disclaimer {
                        Text(disclaimer)
                            .font(.paperlogy(10))
                            .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
                            .padding(.horizontal, 4)
                    }
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("크립토 리포트")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        isLoading = report == nil
        errorMessage = nil
        do {
            report = try await APIClient.shared.get("/api/crypto/report") as CryptoReportResponse
        } catch {
            errorMessage = "리포트를 불러오지 못했습니다: \(error.localizedDescription)"
        }
        isLoading = false
    }

    // MARK: - 업황 (공포탐욕 + 도미넌스)

    private func marketMoodCard(_ report: CryptoReportResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("업황")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)

            if let sentiment = report.sentiment {
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("공포·탐욕 지수")
                            .font(.paperlogy(11))
                            .foregroundStyle(AppTheme.textSecondary)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(sentiment.value)")
                                .font(.paperlogy(26, weight: .bold))
                                .foregroundStyle(fngColor(sentiment.value))
                            Text(sentiment.labelKo ?? "-")
                                .font(.paperlogy(13, weight: .semibold))
                                .foregroundStyle(fngColor(sentiment.value))
                        }
                    }
                    Spacer()
                    if let history = sentiment.history, history.count > 2 {
                        Chart(Array(history.enumerated()), id: \.offset) { item in
                            LineMark(x: .value("i", item.offset), y: .value("v", item.element))
                                .foregroundStyle(fngColor(sentiment.value))
                        }
                        .chartXAxis(.hidden)
                        .chartYAxis(.hidden)
                        .chartYScale(domain: 0...100)
                        .frame(width: 100, height: 36)
                    }
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(
                            LinearGradient(colors: [AppTheme.down, .yellow, AppTheme.up], startPoint: .leading, endPoint: .trailing)
                        ).opacity(0.35)
                        Circle()
                            .fill(fngColor(sentiment.value))
                            .frame(width: 10, height: 10)
                            .offset(x: geo.size.width * CGFloat(sentiment.value) / 100 - 5)
                    }
                }
                .frame(height: 10)
                Text("극단적 공포 구간은 역사적으로 분할 매집 검토 구간으로 해석되어 왔습니다 (시트 규칙 참고).")
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            if let global = report.global {
                HStack(spacing: 16) {
                    moodStat("전체 시총", String(format: "%.2f조$", global.totalMarketCapT ?? 0), global.mcapChange24h)
                    moodStat("BTC 도미넌스", String(format: "%.1f%%", global.btcDominance ?? 0), nil)
                    moodStat("ETH 도미넌스", String(format: "%.1f%%", global.ethDominance ?? 0), nil)
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func moodStat(_ title: String, _ value: String, _ change: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.paperlogy(10))
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.paperlogy(14, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            if let change {
                Text(String(format: "24h %+.1f%%", change))
                    .font(.paperlogy(9))
                    .foregroundStyle(change >= 0 ? AppTheme.up : AppTheme.down)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func fngColor(_ value: Int) -> Color {
        if value <= 25 { return AppTheme.down }
        if value <= 45 { return .orange }
        if value <= 55 { return .yellow }
        return AppTheme.up
    }

    // MARK: - 코인별 차트 분석

    private func marketCard(_ market: CryptoMarket) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(market.symbol)
                    .font(.paperlogy(18, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                if let badge = market.signalBadge {
                    SignalBadgeView(label: badge)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text("$\((market.price ?? 0).formatted(.number.precision(.fractionLength(0))))")
                        .font(.paperlogy(16, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)
                    if let change = market.changeRate {
                        Text(String(format: "%+.1f%%", change))
                            .font(.paperlogy(11, weight: .semibold))
                            .foregroundStyle(change >= 0 ? AppTheme.up : AppTheme.down)
                    }
                }
            }

            HStack(spacing: 8) {
                if let score = market.score {
                    chipText("점수 \(score)")
                }
                if let ichi = market.ichimoku {
                    chipText("일목 \(ichi.statusLabel)")
                }
                if let st = market.supertrend {
                    chipText("ST \(st.direction == "up" ? "상승" : "하락")")
                }
                if let mayer = market.mayer, let m = mayer.multiple {
                    chipText(String(format: "Mayer %.2f", m))
                }
            }

            if let signals = market.signals, !signals.isEmpty {
                ForEach(signals.prefix(4), id: \.self) { signal in
                    Text("• \(signal)")
                        .font(.paperlogy(11))
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func chipText(_ text: String) -> some View {
        Text(text)
            .font(.paperlogy(10, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.25))
            .foregroundStyle(AppTheme.accent)
            .clipShape(Capsule())
    }

    // MARK: - 규제/법안 지속 관찰

    private func regulationCard(_ report: CryptoReportResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "building.columns")
                    .foregroundStyle(AppTheme.accent)
                Text("규제·법안 관찰 (CLARITY 등)")
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
            ForEach(report.regulation ?? []) { topic in
                VStack(alignment: .leading, spacing: 6) {
                    Text(topic.topic)
                        .font(.paperlogy(12, weight: .bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(AppTheme.accent.opacity(0.15))
                        .foregroundStyle(AppTheme.accent)
                        .clipShape(Capsule())
                    ForEach(topic.items.prefix(3)) { item in
                        if let url = URL(string: item.link) {
                            Link(destination: url) {
                                HStack(alignment: .top, spacing: 6) {
                                    Text("·")
                                        .foregroundStyle(AppTheme.textSecondary)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.title)
                                            .font(.paperlogy(12))
                                            .foregroundStyle(AppTheme.textPrimary)
                                            .multilineTextAlignment(.leading)
                                            .lineLimit(2)
                                        Text(item.timeAgoText)
                                            .font(.paperlogy(9))
                                            .foregroundStyle(AppTheme.textSecondary)
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.up.right")
                                        .font(.caption2)
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                            }
                        }
                    }
                }
                .padding(.bottom, 4)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
