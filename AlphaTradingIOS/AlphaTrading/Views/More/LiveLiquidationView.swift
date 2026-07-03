import SwiftUI
import Charts

/// 실시간 청산 모니터 — Binance 선물 청산(forceOrder) 실시간 피드 + 가격대별 분포
/// CoinAI 청산 히트맵 벤치마킹 (탭 진입 시 연결 · 이탈 시 해제)
struct LiveLiquidationView: View {
    @StateObject private var viewModel = LiveCryptoViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                symbolPicker
                priceCard
                totalsCard
                bucketsCard
                feedCard
                Text("가격: Binance 현물 · 청산: OKX 선물 공개 스트림 실시간 수신. 화면을 벗어나면 연결이 종료됩니다. 투자 참고용 정보이며 투자 권유가 아닙니다.")
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("실시간 청산 모니터")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.start() }
        .onDisappear { viewModel.stop() }
    }

    private var symbolPicker: some View {
        Picker("심볼", selection: Binding(
            get: { viewModel.symbol },
            set: { newValue in Task { await viewModel.switchSymbol(newValue) } }
        )) {
            Text("BTC").tag("BTC")
            Text("ETH").tag("ETH")
        }
        .pickerStyle(.segmented)
    }

    // MARK: - 실시간 가격

    private var priceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(viewModel.connected ? AppTheme.up : AppTheme.down)
                    .frame(width: 8, height: 8)
                Text(viewModel.connected ? "실시간 연결됨" : "연결 대기...")
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                Text("최근 1시간")
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("$\(viewModel.price.formatted(.number.precision(.fractionLength(viewModel.symbol == "BTC" ? 1 : 2))))")
                    .font(.paperlogy(28, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .contentTransition(.numericText())
                    .animation(.default, value: viewModel.price)
                Text(String(format: "%+.2f%%", viewModel.changePct))
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(viewModel.changePct >= 0 ? AppTheme.up : AppTheme.down)
            }
            if viewModel.minuteCloses.count > 2 {
                Chart(Array(viewModel.minuteCloses.enumerated()), id: \.offset) { item in
                    LineMark(x: .value("t", item.offset), y: .value("가격", item.element))
                        .foregroundStyle(viewModel.changePct >= 0 ? AppTheme.up : AppTheme.down)
                        .lineStyle(StrokeStyle(lineWidth: 1.5))
                }
                .chartXAxis(.hidden)
                .chartYScale(domain: (viewModel.minuteCloses.min() ?? 0)...(viewModel.minuteCloses.max() ?? 1))
                .frame(height: 70)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - 롱/숏 청산 누적

    private var totalsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("세션 누적 청산")
                .font(.paperlogy(13, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("롱 청산 (하락 압력)")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(usdText(viewModel.longTotalUsd))
                        .font(.paperlogy(16, weight: .bold))
                        .foregroundStyle(AppTheme.down)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("숏 청산 (상승 연료)")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(usdText(viewModel.shortTotalUsd))
                        .font(.paperlogy(16, weight: .bold))
                        .foregroundStyle(AppTheme.up)
                }
                Spacer()
            }
            let total = viewModel.longTotalUsd + viewModel.shortTotalUsd
            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        Rectangle().fill(AppTheme.down)
                            .frame(width: geo.size.width * viewModel.longTotalUsd / total)
                        Rectangle().fill(AppTheme.up)
                    }
                }
                .frame(height: 6)
                .clipShape(Capsule())
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - 가격대별 청산 분포

    @ViewBuilder
    private var bucketsCard: some View {
        if !viewModel.buckets.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("가격대별 청산 분포 (세션)")
                    .font(.paperlogy(13, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Chart(viewModel.buckets.prefix(14)) { bucket in
                    BarMark(
                        x: .value("롱", bucket.longUsd),
                        y: .value("가격", String(Int(bucket.midPrice)))
                    )
                    .foregroundStyle(AppTheme.down.opacity(0.75))
                    BarMark(
                        x: .value("숏", bucket.shortUsd),
                        y: .value("가격", String(Int(bucket.midPrice)))
                    )
                    .foregroundStyle(AppTheme.up.opacity(0.75))
                }
                .chartXAxis(.hidden)
                .frame(height: max(60, CGFloat(min(viewModel.buckets.count, 14)) * 22))
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Circle().fill(AppTheme.down.opacity(0.75)).frame(width: 8, height: 8)
                        Text("롱 청산").font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(AppTheme.up.opacity(0.75)).frame(width: 8, height: 8)
                        Text("숏 청산").font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
                    }
                    Spacer()
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: - 실시간 청산 피드

    private var feedCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle()
                    .fill(viewModel.liqConnected ? AppTheme.up : .orange)
                    .frame(width: 7, height: 7)
                Text("실시간 청산 피드 (OKX 선물)")
                    .font(.paperlogy(13, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text("\(viewModel.events.count)건")
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if viewModel.events.isEmpty {
                Text("청산 이벤트 대기 중... (변동성이 낮으면 뜸할 수 있습니다)")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
                    .padding(.vertical, 12)
            } else {
                ForEach(viewModel.events.prefix(25)) { event in
                    HStack(spacing: 8) {
                        Text(event.isLongLiquidation ? "롱 청산" : "숏 청산")
                            .font(.paperlogy(10, weight: .bold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background((event.isLongLiquidation ? AppTheme.down : AppTheme.up).opacity(0.2))
                            .foregroundStyle(event.isLongLiquidation ? AppTheme.down : AppTheme.up)
                            .clipShape(Capsule())
                        Text("$\(Int(event.price).formatted())")
                            .font(.paperlogy(12))
                            .foregroundStyle(AppTheme.textPrimary)
                        Spacer()
                        Text(usdText(event.usdValue))
                            .font(.paperlogy(12, weight: .semibold))
                            .foregroundStyle(event.usdValue >= 100_000 ? .orange : AppTheme.textSecondary)
                        Text(event.time.formatted(date: .omitted, time: .standard))
                            .font(.paperlogy(10))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func usdText(_ value: Double) -> String {
        if value >= 1_000_000 { return String(format: "$%.2fM", value / 1_000_000) }
        if value >= 1_000 { return String(format: "$%.1fK", value / 1_000) }
        return String(format: "$%.0f", value)
    }
}
