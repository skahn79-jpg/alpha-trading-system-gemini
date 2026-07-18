import SwiftUI
import Charts

struct ChartView: View {
    let code: String
    var kind: AssetKind = .kr
    @StateObject private var viewModel = ChartViewModel()
    // 주봉/월봉 = 시트의 사이클 판단 타임프레임 (커뮤니티 앱에서는 구독 기능)
    @State private var period = "D"

    // 표시 구간: 최근 60봉 (MA/볼린저 계산은 전체 데이터 사용)
    private let displayCount = 60

    // 학습 모드: 켜진 오버레이 집합 (비어 있으면 기존 차트와 동일)
    @State private var learnModes: Set<LearnMode> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("기간", selection: $period) {
                Text("일봉").tag("D")
                Text("주봉").tag("W")
                Text("월봉").tag("M")
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.top, 10)

            learnChipRow

            if viewModel.isLoading && viewModel.candles.isEmpty {
                LoadingView(message: "차트 로딩...")
                    .frame(height: 300)
            } else if let error = viewModel.errorMessage {
                Text(error)
                    .font(.paperlogy(14))
                    .foregroundStyle(AppTheme.down)
                    .padding()
            } else if viewModel.candles.isEmpty {
                Text("차트 데이터가 없습니다.")
                    .font(.paperlogy(14))
                    .foregroundStyle(AppTheme.textSecondary)
                    .padding()
            } else {
                priceChart
                legend
                volumeChart
                if !learnModes.isEmpty {
                    learnCard
                }
            }
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .task(id: "\(code)-\(period)-\(kind.rawValue)") { await viewModel.load(code: code, period: period, kind: kind) }
    }

    // MARK: - 가격 차트 (캔들 + MA + 볼린저밴드)

    private var priceChart: some View {
        Chart {
            // 볼린저밴드 음영
            ForEach(bollingerSeries, id: \.date) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("BBLower", point.lower),
                    yEnd: .value("BBUpper", point.upper)
                )
                .foregroundStyle(AppTheme.accent.opacity(0.08))
            }

            // 캔들
            ForEach(displayCandles) { candle in
                RectangleMark(
                    x: .value("Date", candle.date),
                    yStart: .value("Low", candle.low),
                    yEnd: .value("High", candle.high),
                    width: 1.5
                )
                .foregroundStyle(candle.isUp ? AppTheme.up : AppTheme.down)

                RectangleMark(
                    x: .value("Date", candle.date),
                    yStart: .value("BodyLow", min(candle.open, candle.close)),
                    yEnd: .value("BodyHigh", max(candle.open, candle.close)),
                    width: 5
                )
                .foregroundStyle(candle.isUp ? AppTheme.up : AppTheme.down)
            }

            // 이동평균선
            ForEach(maSeries(5), id: \.date) { p in
                LineMark(x: .value("Date", p.date), y: .value("MA5", p.value), series: .value("MA", "MA5"))
                    .foregroundStyle(.yellow)
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
            ForEach(maSeries(20), id: \.date) { p in
                LineMark(x: .value("Date", p.date), y: .value("MA20", p.value), series: .value("MA", "MA20"))
                    .foregroundStyle(AppTheme.accent)
                    .lineStyle(StrokeStyle(lineWidth: 1.2))
            }
            ForEach(maSeries(60), id: \.date) { p in
                LineMark(x: .value("Date", p.date), y: .value("MA60", p.value), series: .value("MA", "MA60"))
                    .foregroundStyle(.purple)
                    .lineStyle(StrokeStyle(lineWidth: 1.2))
            }

            // 학습 오버레이 (켜진 모드만 그림)
            learnOverlays
        }
        .chartYScale(domain: yDomain)
        // 카테고리 x축 순서를 명시적으로 고정 — 볼린저 음영이 캔들보다 먼저 그려지면
        // 등장 순서 기준으로 뒤쪽 날짜가 앞에 등록되어 주봉/월봉 차트가 뒤엉킴
        .chartXScale(domain: displayCandles.map(\.date))
        .chartXAxis {
            AxisMarks(values: xAxisDates) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let raw = value.as(String.self) {
                        Text(Self.shortDateLabel(raw))
                            .font(.paperlogy(10))
                    }
                }
            }
        }
        .frame(height: 260)
        .padding(.horizontal, 8)
        .padding(.top, 8)
    }

    private var legend: some View {
        HStack(spacing: 10) {
            legendItem(color: .yellow, label: "MA5")
            legendItem(color: AppTheme.accent, label: "MA20")
            legendItem(color: .purple, label: "MA60")
            legendItem(color: AppTheme.accent.opacity(0.3), label: "볼린저")
            Spacer()
        }
        .padding(.horizontal, 12)
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 3) {
            RoundedRectangle(cornerRadius: 1).fill(color).frame(width: 10, height: 3)
            Text(label).font(.paperlogy(10)).foregroundStyle(AppTheme.textSecondary)
        }
    }

    // MARK: - 거래량 차트

    private var volumeChart: some View {
        Chart(displayCandles) { candle in
            BarMark(
                x: .value("Date", candle.date),
                y: .value("Volume", candle.volume),
                width: 4
            )
            .foregroundStyle((candle.isUp ? AppTheme.up : AppTheme.down).opacity(0.6))
        }
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 2))
        }
        .frame(height: 56)
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
    }

    // MARK: - 계산 (candles는 과거→현재 순)

    private var displayCandles: [ChartCandle] {
        Array(viewModel.candles.suffix(displayCount))
    }

    private var displayDateSet: Set<String> {
        Set(displayCandles.map(\.date))
    }

    struct MAPoint {
        let date: String
        let value: Double
    }

    private func maSeries(_ period: Int) -> [MAPoint] {
        let candles = viewModel.candles
        guard candles.count >= period else { return [] }
        var out: [MAPoint] = []
        var sum = 0.0
        for i in 0..<candles.count {
            sum += Double(candles[i].close)
            if i >= period { sum -= Double(candles[i - period].close) }
            if i >= period - 1 {
                out.append(MAPoint(date: candles[i].date, value: sum / Double(period)))
            }
        }
        let visible = displayDateSet
        return out.filter { visible.contains($0.date) }
    }

    struct BBPoint {
        let date: String
        let upper: Double
        let lower: Double
    }

    private var bollingerSeries: [BBPoint] {
        let period = 20
        let candles = viewModel.candles
        guard candles.count >= period else { return [] }
        var out: [BBPoint] = []
        for i in (period - 1)..<candles.count {
            let window = candles[(i - period + 1)...i].map { Double($0.close) }
            let mean = window.reduce(0, +) / Double(period)
            let variance = window.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(period)
            let std = variance.squareRoot()
            out.append(BBPoint(date: candles[i].date, upper: mean + 2 * std, lower: mean - 2 * std))
        }
        let visible = displayDateSet
        return out.filter { visible.contains($0.date) }
    }

    /// 캔들 저가~고가 + 볼린저밴드 범위를 모두 포함하는 y축 스케일
    private var yDomain: ClosedRange<Double> {
        let lows = displayCandles.map { Double($0.low) } + bollingerSeries.map(\.lower)
        let highs = displayCandles.map { Double($0.high) } + bollingerSeries.map(\.upper)
        guard let minLow = lows.min(), let maxHigh = highs.max(), minLow < maxHigh else {
            return 0...1
        }
        let padding = max(1, (maxHigh - minLow) / 50)
        return (minLow - padding)...(maxHigh + padding)
    }

    /// 카테고리 X축에 전체 날짜 라벨이 겹쳐 그려지지 않도록 4개만 고르게 표시
    private var xAxisDates: [String] {
        let dates = displayCandles.map(\.date)
        guard dates.count > 4 else { return dates }
        let step = max(1, dates.count / 4)
        return Swift.stride(from: 0, to: dates.count, by: step).map { dates[$0] }
    }

    /// "20260702" → "7/2"
    private static func shortDateLabel(_ raw: String) -> String {
        guard raw.count == 8, let month = Int(raw.dropFirst(4).prefix(2)), let day = Int(raw.suffix(2)) else {
            return raw
        }
        return "\(month)/\(day)"
    }

    // MARK: - 학습 모드 (기술적 분석 시각화)

    enum LearnMode: String, CaseIterable {
        case wave = "N자 파동"
        case sr = "지지·저항"
        case trend = "추세선"
    }

    /// 지그재그 스윙 피벗 (종가 기준)
    struct Pivot: Identifiable {
        let index: Int      // displayCandles 내 인덱스
        let date: String
        let price: Double
        let isHigh: Bool
        var id: Int { index }
    }

    /// 지지·저항 수평선
    struct SRLevel: Identifiable {
        let price: Double
        let touches: Int
        let isSupport: Bool
        var id: String { "\(isSupport ? "S" : "R")-\(price)" }
    }

    /// N자 파동 (마지막 3개 피벗 A→B→C)
    struct NWave {
        let a: Pivot
        let b: Pivot
        let c: Pivot
        let rising: Bool
    }

    struct TrendLineInfo {
        let points: [MAPoint]
        let rising: Bool
    }

    // MARK: 학습 토글 칩

    private var learnChipRow: some View {
        HStack(spacing: 8) {
            ForEach(LearnMode.allCases, id: \.self) { mode in
                let isOn = learnModes.contains(mode)
                Button {
                    if isOn { learnModes.remove(mode) } else { learnModes.insert(mode) }
                } label: {
                    Text(mode.rawValue)
                        .font(.paperlogy(11, weight: .medium))
                        .foregroundStyle(isOn ? AppTheme.background : AppTheme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(isOn ? AppTheme.accent : Color.white.opacity(0.06)))
                        .overlay(Capsule().stroke(isOn ? Color.clear : AppTheme.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
    }

    // MARK: 차트 오버레이

    @ChartContentBuilder
    private var learnOverlays: some ChartContent {
        if learnModes.contains(.wave) { waveOverlay }
        if learnModes.contains(.sr) { srOverlay }
        if learnModes.contains(.trend) { trendOverlay }
    }

    @ChartContentBuilder
    private var waveOverlay: some ChartContent {
        // 피벗 연결 지그재그
        ForEach(pivots) { p in
            LineMark(x: .value("Date", p.date), y: .value("ZigZag", p.price), series: .value("Learn", "ZigZag"))
                .foregroundStyle(AppTheme.accent)
                .lineStyle(StrokeStyle(lineWidth: 2))
        }
        // 피벗 점 + 고점/저점 라벨
        ForEach(pivots) { p in
            PointMark(x: .value("Date", p.date), y: .value("Pivot", p.price))
                .foregroundStyle(p.isHigh ? AppTheme.down : AppTheme.up)
                .symbolSize(28)
                .annotation(position: p.isHigh ? .top : .bottom, spacing: 2) {
                    Text(p.isHigh ? "고점" : "저점")
                        .font(.paperlogy(8))
                        .foregroundStyle(p.isHigh ? AppTheme.down : AppTheme.up)
                }
        }
        // 마지막 3개 피벗이 N자 패턴이면 강조
        if let wave = nWave {
            ForEach([wave.a, wave.b, wave.c]) { p in
                LineMark(x: .value("Date", p.date), y: .value("NWave", p.price), series: .value("Learn", "NWave"))
                    .foregroundStyle(Color.orange)
                    .lineStyle(StrokeStyle(lineWidth: 3))
            }
        }
    }

    @ChartContentBuilder
    private var srOverlay: some ChartContent {
        ForEach(srLevels) { level in
            RuleMark(y: .value("SR", level.price))
                .foregroundStyle((level.isSupport ? AppTheme.up : AppTheme.down).opacity(0.8))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .annotation(position: .top, alignment: level.isSupport ? .leading : .trailing, spacing: 1) {
                    Text("\(level.isSupport ? "지지" : "저항") \(Self.priceLabel(level.price))")
                        .font(.paperlogy(9))
                        .foregroundStyle(level.isSupport ? AppTheme.up : AppTheme.down)
                }
        }
    }

    @ChartContentBuilder
    private var trendOverlay: some ChartContent {
        if let line = trendLineInfo {
            ForEach(line.points, id: \.date) { p in
                LineMark(x: .value("Date", p.date), y: .value("Trend", p.value), series: .value("Learn", "Trend"))
                    .foregroundStyle(line.rising ? AppTheme.up : AppTheme.down)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [6, 3]))
            }
        }
    }

    // MARK: 분석 계산

    /// 종가 기준 지그재그 피벗 — 반전 임계값(고저폭의 5%→2%)을 낮춰가며 피벗 4개 이상 확보
    private var pivots: [Pivot] {
        let candles = displayCandles
        guard candles.count >= 10 else { return [] }
        let closes = candles.map(\.close)
        guard let maxP = closes.max(), let minP = closes.min(), maxP > minP else { return [] }
        let range = maxP - minP
        var best: [Pivot] = []
        for pct in [0.05, 0.04, 0.03, 0.02] {
            best = zigzagPivots(candles: candles, closes: closes, threshold: range * pct)
            if best.count >= 4 { break }
        }
        return best
    }

    private func zigzagPivots(candles: [ChartCandle], closes: [Double], threshold: Double) -> [Pivot] {
        guard threshold > 0, closes.count > 2 else { return [] }
        func make(_ idx: Int, _ isHigh: Bool) -> Pivot {
            Pivot(index: idx, date: candles[idx].date, price: closes[idx], isHigh: isHigh)
        }
        var result: [Pivot] = []
        var direction = 0   // 0 미정 / 1 상승 레그 / -1 하락 레그
        var extremeIdx = 0
        var hiIdx = 0
        var loIdx = 0
        for i in 1..<closes.count {
            let price = closes[i]
            if direction == 0 {
                if price > closes[hiIdx] { hiIdx = i }
                if price < closes[loIdx] { loIdx = i }
                if price - closes[loIdx] >= threshold {
                    result.append(make(loIdx, false))
                    direction = 1
                    extremeIdx = i
                } else if closes[hiIdx] - price >= threshold {
                    result.append(make(hiIdx, true))
                    direction = -1
                    extremeIdx = i
                }
            } else if direction == 1 {
                if price > closes[extremeIdx] {
                    extremeIdx = i
                } else if closes[extremeIdx] - price >= threshold {
                    result.append(make(extremeIdx, true))
                    direction = -1
                    extremeIdx = i
                }
            } else {
                if price < closes[extremeIdx] {
                    extremeIdx = i
                } else if price - closes[extremeIdx] >= threshold {
                    result.append(make(extremeIdx, false))
                    direction = 1
                    extremeIdx = i
                }
            }
        }
        // 진행 중 레그의 극값을 잠정 피벗으로 포함 (마지막 스윙 시각화)
        if direction != 0, extremeIdx != (result.last?.index ?? -1) {
            result.append(make(extremeIdx, direction == 1))
        }
        return result
    }

    /// 마지막 3개 피벗의 N자 패턴 판정
    private var nWave: NWave? {
        let ps = pivots
        guard ps.count >= 3 else { return nil }
        let a = ps[ps.count - 3]
        let b = ps[ps.count - 2]
        let c = ps[ps.count - 1]
        // 상승 N: 저점 A → 고점 B → A보다 높은 눌림 저점 C
        if !a.isHigh && b.isHigh && !c.isHigh && b.price > a.price && c.price > a.price {
            return NWave(a: a, b: b, c: c, rising: true)
        }
        // 하락 N: 고점 A → 저점 B → A보다 낮은 반등 고점 C
        if a.isHigh && !b.isHigh && c.isHigh && b.price < a.price && c.price < a.price {
            return NWave(a: a, b: b, c: c, rising: false)
        }
        return nil
    }

    /// 피벗 저점/고점 근접 군집(±1.5%) → 지지·저항 대표선 각 1~2개
    private var srLevels: [SRLevel] {
        let ps = pivots
        func cluster(_ values: [Double], isSupport: Bool) -> [SRLevel] {
            guard !values.isEmpty else { return [] }
            var groups: [[Double]] = []
            for v in values.sorted() {
                if let ref = groups.last?.first, ref > 0, abs(v - ref) / ref <= 0.015 {
                    groups[groups.count - 1].append(v)
                } else {
                    groups.append([v])
                }
            }
            let levels = groups.map { g in
                SRLevel(price: g.reduce(0, +) / Double(g.count), touches: g.count, isSupport: isSupport)
            }
            let clustered = levels.filter { $0.touches >= 2 }.sorted { $0.touches > $1.touches }.prefix(2)
            if !clustered.isEmpty { return Array(clustered) }
            // 군집이 없으면 극값 1개만 표시
            if isSupport, let lvl = levels.min(by: { $0.price < $1.price }) { return [lvl] }
            if !isSupport, let lvl = levels.max(by: { $0.price < $1.price }) { return [lvl] }
            return []
        }
        let supports = cluster(ps.filter { !$0.isHigh }.map(\.price), isSupport: true)
        let resistances = cluster(ps.filter(\.isHigh).map(\.price), isSupport: false)
        return supports + resistances
    }

    /// 최근 피벗 저점 2개(상승) 또는 고점 2개(하락)를 이어 마지막 캔들까지 연장한 추세선
    private var trendLineInfo: TrendLineInfo? {
        let candles = displayCandles
        guard candles.count > 1 else { return nil }
        let ps = pivots
        let lows = Array(ps.filter { !$0.isHigh }.suffix(2))
        let highs = Array(ps.filter(\.isHigh).suffix(2))
        var pair: (Pivot, Pivot)?
        var rising = true
        if lows.count == 2, lows[1].price > lows[0].price {
            pair = (lows[0], lows[1]); rising = true
        } else if highs.count == 2, highs[1].price < highs[0].price {
            pair = (highs[0], highs[1]); rising = false
        } else if lows.count == 2 {
            pair = (lows[0], lows[1]); rising = lows[1].price >= lows[0].price
        }
        guard let (p1, p2) = pair, p2.index > p1.index else { return nil }
        let slope = (p2.price - p1.price) / Double(p2.index - p1.index)
        let domain = yDomain
        var points: [MAPoint] = []
        for i in p1.index...(candles.count - 1) {
            let y = p1.price + slope * Double(i - p1.index)
            // y축 범위를 벗어나는 연장 구간은 잘라냄
            if domain.contains(y) {
                points.append(MAPoint(date: candles[i].date, value: y))
            }
        }
        guard points.count >= 2 else { return nil }
        return TrendLineInfo(points: points, rising: rising)
    }

    // MARK: 학습 해설 카드

    private var learnCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("📚 차트 학습")
                    .font(.paperlogy(13, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text("교육용 참고 자료")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if learnModes.contains(.wave) {
                learnRow(title: "N자 파동", text: waveExplanation)
            }
            if learnModes.contains(.sr) {
                learnRow(title: "지지·저항", text: srExplanation)
            }
            if learnModes.contains(.trend) {
                learnRow(title: "추세선", text: trendExplanation)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.04)))
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }

    private func learnRow(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.paperlogy(11, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
            Text(text)
                .font(.paperlogy(11))
                .foregroundStyle(AppTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var waveExplanation: String {
        if let w = nWave {
            if w.rising {
                return "🔼 상승 N자 파동 진행 중 — 저점 A \(Self.priceLabel(w.a.price)) → 고점 B \(Self.priceLabel(w.b.price)) → 눌림 C \(Self.priceLabel(w.c.price))가 A보다 높습니다. C가 B(\(Self.priceLabel(w.b.price)))를 돌파하면 파동이 한 단계 연장되는 신호로 배우는 패턴입니다."
            } else {
                return "🔽 하락 N자 파동 진행 중 — 고점 A \(Self.priceLabel(w.a.price)) → 저점 B \(Self.priceLabel(w.b.price)) → 반등 C \(Self.priceLabel(w.c.price))가 A보다 낮습니다. C 이후 B(\(Self.priceLabel(w.b.price)))를 이탈하면 하락 파동이 이어지는 신호로 학습합니다."
            }
        }
        return "스윙 고점·저점을 이은 지그재그입니다. 저점 → 고점 → 더 높은 저점 순서면 상승 N자 파동, 고점 → 저점 → 더 낮은 고점 순서면 하락 N자 파동으로 부릅니다. 현재 구간에서는 뚜렷한 N자 패턴이 감지되지 않았습니다."
    }

    private var srExplanation: String {
        let sup = srLevels.filter(\.isSupport)
        let res = srLevels.filter { !$0.isSupport }
        var parts: [String] = []
        if let s = sup.first {
            if s.touches >= 2 {
                parts.append("가격이 \(s.touches)번 반등한 지지선 \(Self.priceLabel(s.price)) — 이탈 시 손절 기준으로 활용하는 자리입니다.")
            } else {
                parts.append("표시 구간의 주요 저점 \(Self.priceLabel(s.price))이 잠재 지지선입니다.")
            }
        }
        if let r = res.first {
            if r.touches >= 2 {
                parts.append("상승이 \(r.touches)번 막힌 저항선 \(Self.priceLabel(r.price)) — 거래량을 동반해 돌파하면 추세 강화 신호로 학습합니다.")
            } else {
                parts.append("표시 구간의 주요 고점 \(Self.priceLabel(r.price))이 잠재 저항선입니다.")
            }
        }
        if parts.isEmpty {
            return "표시 구간에서 뚜렷한 지지·저항 군집이 감지되지 않았습니다. 같은 가격대에서 여러 번 반등/하락이 막히면 지지·저항선이 만들어집니다."
        }
        return parts.joined(separator: " ")
    }

    private var trendExplanation: String {
        guard let line = trendLineInfo, let first = line.points.first, let last = line.points.last, first.value > 0 else {
            return "추세선을 그릴 피벗이 부족합니다. 저점 2개를 이으면 상승 추세선, 고점 2개를 이으면 하락 추세선이 됩니다."
        }
        let changePct = (last.value - first.value) / first.value * 100
        if line.rising {
            return "최근 피벗 저점 2개를 이은 상승 추세선(구간 기울기 약 \(String(format: "%+.1f", changePct))%)입니다. 가격이 이 선 위에서 유지되면 상승 추세, 종가로 이탈하면 추세 훼손 신호로 학습합니다."
        }
        return "최근 피벗 고점 2개를 이은 하락 추세선(구간 기울기 약 \(String(format: "%+.1f", changePct))%)입니다. 가격이 이 선 아래에 머물면 하락 추세, 돌파하면 추세 전환 가능성으로 학습합니다."
    }

    /// 55000 → "55,000", 3.1478 → "3.15"
    private static func priceLabel(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = value < 100 ? 2 : 0
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }
}
