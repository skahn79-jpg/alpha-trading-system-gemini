import SwiftUI
import Charts

/// 실시간 청산 모니터 — 가격/청산 실시간 피드 + 가격대별 청산 히트맵
/// CoinAI 청산 히트맵 벤치마킹 (탭 진입 시 연결 · 이탈 시 해제)
struct LiveLiquidationView: View {
    @StateObject private var viewModel = LiveCryptoViewModel()

    /// 히트맵에 표시할 최대 버킷 수 (가격 순서 유지)
    private let maxRows = 16

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerCard
                liquidationMapCard
                sessionSummaryCard
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

    // MARK: - Derived values

    /// 화면에 표시할 버킷 (가격 내림차순 유지)
    private var displayBuckets: [LiquidationBucket] {
        Array(viewModel.buckets.prefix(maxRows))
    }

    /// 좌/우 바 정규화용 최대 한쪽 금액
    private var maxSideUsd: Double {
        displayBuckets.map { max($0.longUsd, $0.shortUsd) }.max() ?? 0
    }

    /// 현재가를 포함하는 버킷의 priceLow (없으면 nil)
    private var currentBucketLow: Double? {
        let p = viewModel.price
        guard p > 0 else { return nil }
        return displayBuckets.first(where: { p >= $0.priceLow && p < $0.priceHigh })?.priceLow
    }

    private var longShortTotal: Double { viewModel.longTotalUsd + viewModel.shortTotalUsd }

    // MARK: - 1. 헤더 카드 (심볼 선택 + 가격 + 연결 상태 + 스파크라인)

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                symbolChip("BTC")
                symbolChip("ETH")
                Spacer()
                connectionCluster
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("$\(viewModel.price.formatted(.number.precision(.fractionLength(viewModel.symbol == "BTC" ? 1 : 2))))")
                    .font(.paperlogy(30, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .contentTransition(.numericText())
                    .animation(.default, value: viewModel.price)
                Text(String(format: "%+.2f%%", viewModel.changePct))
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(viewModel.changePct >= 0 ? AppTheme.up : AppTheme.down)
                Spacer()
                Text("최근 1시간")
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            if viewModel.minuteCloses.count > 2 {
                sparkline
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var sparkline: some View {
        Chart(Array(viewModel.minuteCloses.enumerated()), id: \.offset) { item in
            LineMark(x: .value("t", item.offset), y: .value("가격", item.element))
                .foregroundStyle(viewModel.changePct >= 0 ? AppTheme.up : AppTheme.down)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
        }
        .chartXAxis(.hidden)
        .chartYScale(domain: (viewModel.minuteCloses.min() ?? 0)...(viewModel.minuteCloses.max() ?? 1))
        .frame(height: 64)
    }

    private var connectionCluster: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                PulsingDot(active: viewModel.connected)
                Text(viewModel.connected ? "실시간" : "대기")
                    .font(.paperlogy(10, weight: .medium))
                    .foregroundStyle(viewModel.connected ? AppTheme.up : AppTheme.textSecondary)
            }
            HStack(spacing: 4) {
                Circle()
                    .fill(viewModel.liqConnected ? AppTheme.accent : Color.orange)
                    .frame(width: 5, height: 5)
                Text("청산")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private func symbolChip(_ sym: String) -> some View {
        let selected = viewModel.symbol == sym
        return Text(sym)
            .font(.paperlogy(13, weight: .bold))
            .foregroundStyle(selected ? AppTheme.background : AppTheme.textSecondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(selected ? AppTheme.accent : Color.white.opacity(0.06))
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Color.white.opacity(0.12), lineWidth: 1))
            .onTapGesture {
                guard !selected else { return }
                Task { await viewModel.switchSymbol(sym) }
            }
    }

    // MARK: - 2. 청산 히트맵 (중앙 대칭 막대)

    private var liquidationMapCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("가격대별 청산 히트맵")
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                mapLegend
            }

            if displayBuckets.isEmpty {
                liquidationPlaceholder
            } else {
                VStack(spacing: 3) {
                    ForEach(displayBuckets) { bucket in
                        LiquidationMapRow(
                            bucket: bucket,
                            maxSideUsd: maxSideUsd,
                            isCurrent: bucket.priceLow == currentBucketLow,
                            currentPrice: viewModel.price
                        )
                    }
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var mapLegend: some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 2).fill(AppTheme.down.opacity(0.85)).frame(width: 12, height: 8)
                Text("롱 청산").font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
            }
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 2).fill(AppTheme.up.opacity(0.85)).frame(width: 12, height: 8)
                Text("숏 청산").font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private var liquidationPlaceholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 26))
                .foregroundStyle(AppTheme.accent.opacity(0.7))
            Text("청산 대기 중 — 실시간 수신 중입니다")
                .font(.paperlogy(12))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 120)
    }

    // MARK: - 3. 세션 요약

    private var sessionSummaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("세션 누적 청산")
                .font(.paperlogy(14, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)

            HStack(spacing: 10) {
                SessionSummaryTile(title: "롱 청산 (하락 압력)", value: abbrevUsd(viewModel.longTotalUsd), tint: AppTheme.down)
                SessionSummaryTile(title: "숏 청산 (상승 연료)", value: abbrevUsd(viewModel.shortTotalUsd), tint: AppTheme.up)
                SessionSummaryTile(title: "최근 수신", value: "\(viewModel.events.count)건", tint: AppTheme.accent)
            }

            longShortRatioBar
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var longShortRatioBar: some View {
        let total = longShortTotal
        let longFrac = total > 0 ? viewModel.longTotalUsd / total : 0.5
        return VStack(spacing: 5) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(total > 0 ? AppTheme.down : Color.white.opacity(0.18))
                        .frame(width: geo.size.width * longFrac)
                    Rectangle()
                        .fill(total > 0 ? AppTheme.up : Color.white.opacity(0.18))
                }
            }
            .frame(height: 8)
            .clipShape(Capsule())

            HStack {
                Text(String(format: "롱 %.0f%%", longFrac * 100))
                    .font(.paperlogy(10, weight: .medium))
                    .foregroundStyle(AppTheme.down)
                Spacer()
                Text(String(format: "숏 %.0f%%", (1 - longFrac) * 100))
                    .font(.paperlogy(10, weight: .medium))
                    .foregroundStyle(AppTheme.up)
            }
        }
    }

    // MARK: - 4. 실시간 청산 피드

    private var feedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle()
                    .fill(viewModel.liqConnected ? AppTheme.up : Color.orange)
                    .frame(width: 7, height: 7)
                Text("실시간 청산 피드")
                    .font(.paperlogy(14, weight: .semibold))
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
                VStack(spacing: 6) {
                    ForEach(viewModel.events.prefix(30)) { event in
                        FeedRow(event: event)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
                .animation(.easeOut(duration: 0.25), value: viewModel.events.first?.id)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - 금액 축약 헬퍼

private func abbrevUsd(_ value: Double) -> String {
    if value >= 1_000_000 { return String(format: "$%.1fM", value / 1_000_000) }
    if value >= 1_000 { return String(format: "$%.0fK", value / 1_000) }
    return String(format: "$%.0f", value)
}

// MARK: - 연결 상태 펄스 도트

private struct PulsingDot: View {
    let active: Bool
    @State private var animate = false

    var body: some View {
        ZStack {
            if active {
                Circle()
                    .fill(AppTheme.up.opacity(0.45))
                    .frame(width: 16, height: 16)
                    .scaleEffect(animate ? 1.7 : 0.7)
                    .opacity(animate ? 0 : 0.7)
            }
            Circle()
                .fill(active ? AppTheme.up : AppTheme.down)
                .frame(width: 8, height: 8)
        }
        .frame(width: 16, height: 16)
        .onAppear {
            withAnimation(.easeOut(duration: 1.2).repeatForever(autoreverses: false)) {
                animate = true
            }
        }
    }
}

// MARK: - 히트맵 행 (중앙 가격 · 좌 롱 / 우 숏)

private struct LiquidationMapRow: View {
    let bucket: LiquidationBucket
    let maxSideUsd: Double
    let isCurrent: Bool
    let currentPrice: Double

    private let centerWidth: CGFloat = 84
    private let rowHeight: CGFloat = 22

    private var longFrac: CGFloat { maxSideUsd > 0 ? CGFloat(bucket.longUsd / maxSideUsd) : 0 }
    private var shortFrac: CGFloat { maxSideUsd > 0 ? CGFloat(bucket.shortUsd / maxSideUsd) : 0 }

    var body: some View {
        GeometryReader { geo in
            let half = max((geo.size.width - centerWidth) / 2, 1)
            HStack(spacing: 0) {
                leftSide(half: half)
                priceLabel
                rightSide(half: half)
            }
            .overlay(alignment: .center) {
                if isCurrent {
                    Rectangle()
                        .fill(AppTheme.accent.opacity(0.5))
                        .frame(height: 1)
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(height: rowHeight)
    }

    private func leftSide(half: CGFloat) -> some View {
        HStack(spacing: 4) {
            Spacer(minLength: 0)
            if bucket.longUsd > 0 {
                Text(abbrevUsd(bucket.longUsd))
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.down.opacity(0.9))
                    .lineLimit(1)
            }
            RoundedRectangle(cornerRadius: 2)
                .fill(AppTheme.down.opacity(0.85))
                .frame(width: bucket.longUsd > 0 ? max(longFrac * half, 3) : 0, height: 12)
        }
        .frame(width: half)
    }

    private func rightSide(half: CGFloat) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(AppTheme.up.opacity(0.85))
                .frame(width: bucket.shortUsd > 0 ? max(shortFrac * half, 3) : 0, height: 12)
            if bucket.shortUsd > 0 {
                Text(abbrevUsd(bucket.shortUsd))
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.up.opacity(0.9))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(width: half)
    }

    private var priceLabel: some View {
        Text("\(Int(bucket.priceLow).formatted())")
            .font(.paperlogy(10, weight: isCurrent ? .bold : .medium))
            .foregroundStyle(isCurrent ? AppTheme.accent : AppTheme.textSecondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: centerWidth)
    }
}

// MARK: - 세션 요약 타일

private struct SessionSummaryTile: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.paperlogy(9))
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.paperlogy(16, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - 피드 행 (금액 등급별 강조)

private struct FeedRow: View {
    let event: LiquidationEvent

    private var sideColor: Color { event.isLongLiquidation ? AppTheme.down : AppTheme.up }
    private var isWhale: Bool { event.usdValue >= 1_000_000 }
    private var isBig: Bool { event.usdValue >= 100_000 }

    private var amountColor: Color {
        if isWhale { return sideColor }
        if isBig { return .orange }
        return AppTheme.textSecondary
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(event.isLongLiquidation ? "롱청산" : "숏청산")
                .font(.paperlogy(10, weight: .bold))
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(sideColor.opacity(0.2))
                .foregroundStyle(sideColor)
                .clipShape(Capsule())

            Text("$\(Int(event.price).formatted())")
                .font(.paperlogy(12))
                .foregroundStyle(AppTheme.textPrimary)

            Spacer(minLength: 4)

            Text((isWhale ? "💥 " : "") + abbrevUsd(event.usdValue))
                .font(.paperlogy(12, weight: isBig ? .bold : .regular))
                .foregroundStyle(amountColor)

            Text(event.time.formatted(date: .omitted, time: .standard))
                .font(.paperlogy(10))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.horizontal, isWhale ? 8 : 0)
        .padding(.vertical, isWhale ? 5 : 0)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isWhale ? sideColor.opacity(0.14) : Color.clear)
        )
    }
}
