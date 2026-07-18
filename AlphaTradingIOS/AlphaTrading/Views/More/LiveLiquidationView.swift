import SwiftUI
import Charts

// MARK: - 서버 예상 청산 분포 응답 모델 (뷰 전용)

private struct LiqMapResponse: Decodable {
    let ok: Bool
    let symbol: String
    let price: Double
    let buckets: [LiqMapBucket]
    let summary: LiqMapSummary
    let method: String
    let updatedAt: String?
}

private struct LiqMapBucket: Decodable, Identifiable {
    var id: Double { priceLow }
    let priceLow: Double
    let priceHigh: Double
    let longUsd: Double
    let shortUsd: Double
    let intensity: Double
}

private struct LiqMapSummary: Decodable {
    let totalLongUsd: Double
    let totalShortUsd: Double
    let magnetUp: LiqMagnet?
    let magnetDown: LiqMagnet?
    let bias: Double
}

private struct LiqMagnet: Decodable {
    let price: Double
    let usd: Double
}

/// 실시간 청산 모니터 — 서버 예상 청산 분포 + 실시간 체결 청산 피드
/// CoinAI 청산 히트맵 벤치마킹 (탭 진입 시 연결 · 이탈 시 해제)
struct LiveLiquidationView: View {
    @StateObject private var viewModel = LiveCryptoViewModel()

    @State private var liqMap: LiqMapResponse?
    @State private var liqMapLoading = false
    @State private var liqMapFailed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerCard
                if let map = liqMap {
                    LiqPredictionSummaryCard(map: map, currentPrice: effectiveCurrentPrice)
                }
                predictedMapCard
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
        .task(id: viewModel.symbol) {
            liqMap = nil
            liqMapFailed = false
            while !Task.isCancelled {
                await fetchLiqMap()
                try? await Task.sleep(nanoseconds: 300_000_000_000) // 5분 주기 갱신
                if Task.isCancelled { break }
            }
        }
        .onDisappear { viewModel.stop() }
    }

    // MARK: - 예상 분포 로드

    private func fetchLiqMap() async {
        if liqMap == nil { liqMapLoading = true }
        do {
            let resp: LiqMapResponse = try await APIClient.shared.get("/api/crypto/liqmap/\(viewModel.symbol)")
            liqMap = resp
            liqMapFailed = false
        } catch {
            // 실패 시 조용히 표시만 하고 다음 주기에 재시도
            liqMapFailed = true
        }
        liqMapLoading = false
    }

    // MARK: - Derived values

    /// 서버 버킷은 가격 오름차순 → 높은 가격이 위로 오도록 뒤집기
    private var serverBucketsDesc: [LiqMapBucket] {
        (liqMap?.buckets ?? []).reversed()
    }

    /// 좌/우 바 정규화용 최대 한쪽 금액
    private var serverMaxSideUsd: Double {
        serverBucketsDesc.map { max($0.longUsd, $0.shortUsd) }.max() ?? 0
    }

    /// 현재가: 실시간 가격 우선, 없으면 서버 응답 가격
    private var effectiveCurrentPrice: Double {
        viewModel.price > 0 ? viewModel.price : (liqMap?.price ?? 0)
    }

    /// 현재가를 포함하는 서버 버킷의 priceLow (없으면 nil)
    private var serverCurrentBucketLow: Double? {
        let p = effectiveCurrentPrice
        guard p > 0 else { return nil }
        return serverBucketsDesc.first(where: { p >= $0.priceLow && p < $0.priceHigh })?.priceLow
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

    // MARK: - 2. 예상 청산 분포 (서버 추정 · 중앙 대칭 막대)

    private var predictedMapCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("예상 청산 분포")
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                mapLegend
            }

            if serverBucketsDesc.isEmpty {
                predictedMapPlaceholder
            } else {
                VStack(spacing: 3) {
                    ForEach(serverBucketsDesc) { bucket in
                        LiquidationMapRow(
                            priceLow: bucket.priceLow,
                            longUsd: bucket.longUsd,
                            shortUsd: bucket.shortUsd,
                            intensity: bucket.intensity,
                            maxSideUsd: serverMaxSideUsd,
                            isCurrent: bucket.priceLow == serverCurrentBucketLow,
                            currentPrice: effectiveCurrentPrice
                        )
                    }
                }
                if liqMapFailed {
                    Text("갱신 실패 — 잠시 후 자동 재시도합니다")
                        .font(.paperlogy(10))
                        .foregroundStyle(Color.orange.opacity(0.9))
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private var predictedMapPlaceholder: some View {
        VStack(spacing: 8) {
            if liqMapFailed {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 26))
                    .foregroundStyle(Color.orange.opacity(0.8))
                Text("예상 분포를 불러오지 못했습니다 — 잠시 후 자동 재시도합니다")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 26))
                    .foregroundStyle(AppTheme.accent.opacity(0.7))
                Text("예상 분포 불러오는 중...")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 120)
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

    // MARK: - 3. 세션 요약 (실제 체결)

    private var sessionSummaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("세션 누적 청산 (실제 체결)")
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

    // MARK: - 4. 실제 체결된 청산 피드 (실시간)

    private var feedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle()
                    .fill(viewModel.liqConnected ? AppTheme.up : Color.orange)
                    .frame(width: 7, height: 7)
                Text("실제 체결된 청산 (실시간)")
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

// MARK: - 예측 요약 카드 (자석 가격 + 편향)

private struct LiqPredictionSummaryCard: View {
    let map: LiqMapResponse
    let currentPrice: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("청산 자석 예측")
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text("추정치")
                    .font(.paperlogy(9, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(AppTheme.accent.opacity(0.14))
                    .clipShape(Capsule())
            }

            if let up = map.summary.magnetUp {
                MagnetRow(
                    icon: "🧲",
                    title: "상방 자석 $\(Int(up.price).formatted())",
                    subtitle: "도달 시 약 \(abbrevUsd(up.usd)) 숏 청산 유발 추정",
                    distance: distanceText(to: up.price),
                    tint: AppTheme.up
                )
            }

            if let down = map.summary.magnetDown {
                MagnetRow(
                    icon: "⚠️",
                    title: "하방 리스크 $\(Int(down.price).formatted())",
                    subtitle: "이탈 시 약 \(abbrevUsd(down.usd)) 롱 청산 연쇄 위험",
                    distance: distanceText(to: down.price),
                    tint: AppTheme.down
                )
            }

            BiasCapsuleBar(bias: map.summary.bias)

            Text(map.method)
                .font(.paperlogy(9))
                .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func distanceText(to price: Double) -> String? {
        guard currentPrice > 0 else { return nil }
        let pct = (price - currentPrice) / currentPrice * 100
        return String(format: "%+.1f%%", pct)
    }
}

private struct MagnetRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let distance: String?
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(icon)
                .font(.system(size: 16))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.paperlogy(13, weight: .bold))
                    .foregroundStyle(tint)
                Text(subtitle)
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer(minLength: 4)
            if let distance {
                Text(distance)
                    .font(.paperlogy(12, weight: .bold))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(tint.opacity(0.14))
                    .clipShape(Capsule())
            }
        }
        .padding(10)
        .background(tint.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct BiasCapsuleBar: View {
    /// bias > 50 = 상방 청산 물량 우위
    let bias: Double

    private var upFrac: Double { min(max(bias / 100, 0), 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(String(format: "청산 물량 우위 — 상방 %.0f%% vs 하방 %.0f%%", upFrac * 100, (1 - upFrac) * 100))
                .font(.paperlogy(11, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)

            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(AppTheme.up)
                        .frame(width: geo.size.width * upFrac)
                    Rectangle()
                        .fill(AppTheme.down)
                }
            }
            .frame(height: 8)
            .clipShape(Capsule())

            HStack {
                Text("상방 (숏 청산)")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.up.opacity(0.8))
                Spacer()
                Text("하방 (롱 청산)")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.down.opacity(0.8))
            }
        }
    }
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

// MARK: - 히트맵 행 (중앙 가격 · 좌 롱 / 우 숏 · 밀집도 강조)

private struct LiquidationMapRow: View {
    let priceLow: Double
    let longUsd: Double
    let shortUsd: Double
    var intensity: Double = 0
    let maxSideUsd: Double
    let isCurrent: Bool
    let currentPrice: Double

    private let centerWidth: CGFloat = 84
    private let rowHeight: CGFloat = 22

    private var longFrac: CGFloat { maxSideUsd > 0 ? CGFloat(longUsd / maxSideUsd) : 0 }
    private var shortFrac: CGFloat { maxSideUsd > 0 ? CGFloat(shortUsd / maxSideUsd) : 0 }

    /// 밀집 구간(intensity >= 60)이면 우세한 쪽 색으로 은은한 배경
    private var denseBackground: Color {
        guard intensity >= 60 else { return .clear }
        let dominant = longUsd >= shortUsd ? AppTheme.down : AppTheme.up
        return dominant.opacity(0.08)
    }

    var body: some View {
        GeometryReader { geo in
            let half = max((geo.size.width - centerWidth) / 2, 1)
            HStack(spacing: 0) {
                leftSide(half: half)
                priceLabel
                rightSide(half: half)
            }
            .background(RoundedRectangle(cornerRadius: 4).fill(denseBackground))
            .overlay(alignment: .center) {
                if isCurrent {
                    currentPriceOverlay
                }
            }
        }
        .frame(height: rowHeight)
    }

    private var currentPriceOverlay: some View {
        ZStack(alignment: .trailing) {
            Rectangle()
                .fill(AppTheme.accent.opacity(0.5))
                .frame(height: 1)
            Text("현재가 $\(Int(currentPrice).formatted())")
                .font(.paperlogy(8, weight: .bold))
                .foregroundStyle(AppTheme.background)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(AppTheme.accent.opacity(0.9))
                .clipShape(Capsule())
        }
        .allowsHitTesting(false)
    }

    private func leftSide(half: CGFloat) -> some View {
        HStack(spacing: 4) {
            Spacer(minLength: 0)
            if longUsd > 0 {
                Text(abbrevUsd(longUsd))
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.down.opacity(0.9))
                    .lineLimit(1)
            }
            RoundedRectangle(cornerRadius: 2)
                .fill(AppTheme.down.opacity(0.85))
                .frame(width: longUsd > 0 ? max(longFrac * half, 3) : 0, height: 12)
        }
        .frame(width: half)
    }

    private func rightSide(half: CGFloat) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(AppTheme.up.opacity(0.85))
                .frame(width: shortUsd > 0 ? max(shortFrac * half, 3) : 0, height: 12)
            if shortUsd > 0 {
                Text(abbrevUsd(shortUsd))
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.up.opacity(0.9))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(width: half)
    }

    private var priceLabel: some View {
        Text("\(Int(priceLow).formatted())")
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
