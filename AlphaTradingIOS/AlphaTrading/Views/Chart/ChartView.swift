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

    // AI 예측 (kr 전용) — 예측 칩을 켤 때 1회 로드
    @State private var prediction: PredictResponse?
    @State private var predictionLoadFailed = false

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
        .chartXScale(domain: xDomain)
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

    /// 카테고리 X축 도메인 — 예측 모드가 켜지면 합성 미래 카테고리("→1"...)를 뒤에 붙임
    private var xDomain: [String] {
        var dates = displayCandles.map(\.date)
        if learnModes.contains(.predict), !forecastPoints.isEmpty {
            dates += futureDates
        }
        return dates
    }

    /// 캔들 저가~고가 + 볼린저밴드 + (켜진 경우) 일목구름·예측 콘 범위를 모두 포함하는 y축 스케일
    private var yDomain: ClosedRange<Double> {
        var lows = displayCandles.map { Double($0.low) } + bollingerSeries.map(\.lower)
        var highs = displayCandles.map { Double($0.high) } + bollingerSeries.map(\.upper)
        if learnModes.contains(.ichimoku) {
            let cloud = ichimokuSeries
            lows += cloud.map { min($0.spanA, $0.spanB) }
            highs += cloud.map { max($0.spanA, $0.spanB) }
        }
        if learnModes.contains(.predict) {
            let cone = forecastPoints
            lows += cone.map(\.lower)
            highs += cone.map(\.upper)
        }
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
        case fib = "피보나치"
        case ichimoku = "일목구름"
        case predict = "예측"
    }

    /// 예측 칩은 국내주식(kr)만 노출 — 서버 예측 API가 국내 종목 코드 기준
    private var availableLearnModes: [LearnMode] {
        LearnMode.allCases.filter { $0 != .predict || kind == .kr }
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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
            ForEach(availableLearnModes, id: \.self) { mode in
                let isOn = learnModes.contains(mode)
                Button {
                    if isOn {
                        learnModes.remove(mode)
                    } else {
                        learnModes.insert(mode)
                        if mode == .predict { loadPredictionIfNeeded() }
                    }
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
            }
            .padding(.horizontal, 12)
        }
    }

    // MARK: 차트 오버레이

    @ChartContentBuilder
    private var learnOverlays: some ChartContent {
        if learnModes.contains(.wave) { waveOverlay }
        if learnModes.contains(.sr) { srOverlay }
        if learnModes.contains(.trend) { trendOverlay }
        if learnModes.contains(.fib) { fibOverlay }
        if learnModes.contains(.ichimoku) { ichimokuOverlay }
        if learnModes.contains(.predict) { predictOverlay }
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

    @ChartContentBuilder
    private var fibOverlay: some ChartContent {
        ForEach(fibLevels) { level in
            RuleMark(y: .value("Fib", level.price))
                .foregroundStyle(Color.orange.opacity(0.7))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .annotation(position: .top, alignment: .trailing, spacing: 1) {
                    Text("\(level.ratioText) · \(Self.priceLabel(level.price))")
                        .font(.paperlogy(8))
                        .foregroundStyle(Color.orange)
                }
        }
    }

    @ChartContentBuilder
    private var ichimokuOverlay: some ChartContent {
        // 구름: 스팬A≥B 양운(up), 반대 음운(down) — 색이 바뀌는 지점마다 별도 세그먼트로 분리
        ForEach(cloudSegments) { segment in
            ForEach(segment.points, id: \.date) { p in
                AreaMark(
                    x: .value("Date", p.date),
                    yStart: .value("CloudLow", min(p.spanA, p.spanB)),
                    yEnd: .value("CloudHigh", max(p.spanA, p.spanB)),
                    series: .value("Learn", "Cloud\(segment.id)")
                )
                .foregroundStyle((segment.bullish ? AppTheme.up : AppTheme.down).opacity(0.15))
            }
        }
        ForEach(ichimokuSeries, id: \.date) { p in
            LineMark(x: .value("Date", p.date), y: .value("Tenkan", p.tenkan), series: .value("Learn", "Tenkan"))
                .foregroundStyle(Color.cyan)
                .lineStyle(StrokeStyle(lineWidth: 1))
        }
        ForEach(ichimokuSeries, id: \.date) { p in
            LineMark(x: .value("Date", p.date), y: .value("Kijun", p.kijun), series: .value("Learn", "Kijun"))
                .foregroundStyle(Color.orange)
                .lineStyle(StrokeStyle(lineWidth: 1.2))
        }
    }

    @ChartContentBuilder
    private var predictOverlay: some ChartContent {
        // 불확실성 콘: 중심 ± ATR% × √일차
        ForEach(forecastPoints) { p in
            AreaMark(
                x: .value("Date", p.date),
                yStart: .value("ConeLow", p.lower),
                yEnd: .value("ConeHigh", p.upper),
                series: .value("Learn", "Cone")
            )
            .foregroundStyle(Color.gray.opacity(0.12))
        }
        // 중심 경로: 마지막 종가에서 확률 편향 드리프트 누적
        ForEach(forecastPoints) { p in
            LineMark(x: .value("Date", p.date), y: .value("Forecast", p.center), series: .value("Learn", "Forecast"))
                .foregroundStyle(AppTheme.accent)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        }
        if forecastPoints.count > 1, let end = forecastPoints.last, let probUp = prediction?.probUp {
            PointMark(x: .value("Date", end.date), y: .value("ForecastEnd", end.center))
                .foregroundStyle(AppTheme.accent)
                .symbolSize(22)
                .annotation(position: .top, spacing: 2) {
                    Text(probUp >= 50
                         ? "AI 상승 \(Int(probUp.rounded()))%"
                         : "AI 하락 \(Int((prediction?.probDown ?? (100 - probUp)).rounded()))%")
                        .font(.paperlogy(9, weight: .semibold))
                        .foregroundStyle(AppTheme.accent)
                }
        }
    }

    // MARK: 피보나치 계산

    struct FibLevel: Identifiable {
        let ratio: Double
        let price: Double
        var id: Double { ratio }
        var ratioText: String { String(ratio) }
    }

    /// 표시 구간 최고가~최저가 기준 되돌림 레벨 (ratio 오름차순 = 가격 내림차순)
    private var fibLevels: [FibLevel] {
        let candles = displayCandles
        guard let hi = candles.map(\.high).max(), let lo = candles.map(\.low).min(), hi > lo else { return [] }
        return [0.236, 0.382, 0.5, 0.618, 0.786].map { FibLevel(ratio: $0, price: hi - (hi - lo) * $0) }
    }

    // MARK: 일목구름 계산

    struct IchimokuPoint {
        let date: String
        let tenkan: Double
        let kijun: Double
        let spanA: Double
        let spanB: Double
    }

    struct CloudSegment: Identifiable {
        let id: Int
        let bullish: Bool
        let points: [IchimokuPoint]
    }

    /// 전체 캔들로 전환선(9)/기준선(26)/선행스팬A/B 계산 후 표시 구간만 반환
    /// (학습용 단순화 — 스팬의 26봉 선행 이동은 생략)
    private var ichimokuSeries: [IchimokuPoint] {
        let candles = viewModel.candles
        guard candles.count >= 52 else { return [] }
        var out: [IchimokuPoint] = []
        for i in 51..<candles.count {
            func mid(_ n: Int) -> Double {
                let window = candles[(i - n + 1)...i]
                let high = window.map(\.high).max() ?? 0
                let low = window.map(\.low).min() ?? 0
                return (high + low) / 2
            }
            let tenkan = mid(9)
            let kijun = mid(26)
            out.append(IchimokuPoint(
                date: candles[i].date,
                tenkan: tenkan,
                kijun: kijun,
                spanA: (tenkan + kijun) / 2,
                spanB: mid(52)
            ))
        }
        let visible = displayDateSet
        return out.filter { visible.contains($0.date) }
    }

    /// 양운/음운이 바뀌는 지점에서 구름을 세그먼트로 분리 (한 AreaMark 시리즈로 이으면 교차 구간이 뒤엉킴)
    private var cloudSegments: [CloudSegment] {
        var segments: [CloudSegment] = []
        var current: [IchimokuPoint] = []
        var bullish = true
        for p in ichimokuSeries {
            let b = p.spanA >= p.spanB
            if current.isEmpty {
                bullish = b
                current = [p]
            } else if b == bullish {
                current.append(p)
            } else {
                segments.append(CloudSegment(id: segments.count, bullish: bullish, points: current))
                current = [p]
                bullish = b
            }
        }
        if !current.isEmpty {
            segments.append(CloudSegment(id: segments.count, bullish: bullish, points: current))
        }
        return segments
    }

    // MARK: AI 예측 계산

    struct PredictResponse: Decodable {
        struct Factor: Decodable {
            let key: String?
            let label: String?
            let impact: Double?
        }
        struct ModelInfo: Decodable {
            let trained: Int?
            let accuracy: Double?
            let resolved: Int?
        }
        let code: String?
        let probUp: Double?      // 퍼센트 단위 (예: 70.5)
        let probDown: Double?
        let direction: String?
        let confidence: String?
        let horizonDays: Int?
        let topFactors: [Factor]?
        let technicalScore: Double?
        let technicalGrade: String?
        let conflictNote: String?
        let model: ModelInfo?
    }

    struct ForecastPoint: Identifiable {
        let date: String
        let center: Double
        let lower: Double
        let upper: Double
        var id: String { date }
    }

    /// 표시 구간 최근 14봉 TR 평균 / 마지막 종가 (ATR%)
    private var atrPct: Double {
        let candles = displayCandles
        guard candles.count >= 2, let last = candles.last, last.close > 0 else { return 0 }
        let window = Array(candles.suffix(15))
        var trs: [Double] = []
        for i in 1..<window.count {
            let prevClose = window[i - 1].close
            let c = window[i]
            trs.append(max(c.high - c.low, abs(c.high - prevClose), abs(c.low - prevClose)))
        }
        guard !trs.isEmpty else { return 0 }
        return (trs.reduce(0, +) / Double(trs.count)) / last.close
    }

    private var predictionDays: Int {
        min(max(prediction?.horizonDays ?? 7, 1), 7)
    }

    private var futureDates: [String] {
        (1...predictionDays).map { "→\($0)" }
    }

    /// 미래 투영 — 첫 점은 마지막 실제 캔들(연속성), 이후 일별 확률 드리프트 누적 + √t 불확실성 콘
    private var forecastPoints: [ForecastPoint] {
        guard kind == .kr,
              learnModes.contains(.predict),
              let probUp = prediction?.probUp,
              let last = displayCandles.last, last.close > 0 else { return [] }
        let atr = atrPct
        guard atr > 0 else { return [] }
        let dailyDrift = (probUp / 100 - 0.5) * 2 * atr
        var out = [ForecastPoint(date: last.date, center: last.close, lower: last.close, upper: last.close)]
        for d in 1...predictionDays {
            let center = last.close * (1 + dailyDrift * Double(d))
            let band = last.close * atr * Double(d).squareRoot()
            out.append(ForecastPoint(date: "→\(d)", center: center, lower: center - band, upper: center + band))
        }
        return out
    }

    private func loadPredictionIfNeeded() {
        guard kind == .kr, prediction == nil else { return }
        predictionLoadFailed = false
        Task {
            do {
                let p: PredictResponse = try await APIClient.shared.get("/api/predict/\(code)")
                await MainActor.run { prediction = p }
            } catch {
                await MainActor.run { predictionLoadFailed = true }
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
            if learnModes.contains(.fib) {
                learnRow(title: "피보나치 되돌림", text: fibExplanation)
            }
            if learnModes.contains(.ichimoku) {
                learnRow(title: "일목구름", text: ichimokuExplanation)
            }
            if learnModes.contains(.predict) {
                learnRow(title: "AI 예측", text: predictExplanation)
                learnRow(title: "AI 학습 현황", text: predictModelStatus)
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

    private var fibExplanation: String {
        let levels = fibLevels
        guard levels.count == 5, let last = displayCandles.last,
              let hi = displayCandles.map(\.high).max(),
              let lo = displayCandles.map(\.low).min() else {
            return "되돌림 레벨을 계산할 데이터가 부족합니다. 고점에서 저점까지의 하락(또는 반대) 폭을 0.236~0.786 비율로 나눈 선이 피보나치 되돌림입니다."
        }
        let close = last.close
        let closeLabel = Self.priceLabel(close)
        let position: String
        if close >= levels[0].price {
            position = "현재가 \(closeLabel)는 0.236 레벨(\(Self.priceLabel(levels[0].price))) 위 — 되돌림이 얕아 기존 추세가 강하게 유지되는 구간으로 학습합니다."
        } else if close < levels[4].price {
            position = "현재가 \(closeLabel)는 0.786 레벨(\(Self.priceLabel(levels[4].price))) 아래 — 되돌림이 깊어 추세 반전 가능성까지 열어두고 학습하는 구간입니다."
        } else {
            var upper = levels[0]
            var lower = levels[1]
            for i in 0..<4 where close < levels[i].price && close >= levels[i + 1].price {
                upper = levels[i]
                lower = levels[i + 1]
            }
            position = "현재가 \(closeLabel)는 \(lower.ratioText) 레벨(\(Self.priceLabel(lower.price)))과 \(upper.ratioText) 레벨(\(Self.priceLabel(upper.price))) 사이에 있습니다."
        }
        return "표시 구간 최고가 \(Self.priceLabel(hi)) ~ 최저가 \(Self.priceLabel(lo)) 기준 피보나치 되돌림입니다. \(position) 0.382·0.5·0.618 부근은 눌림목 매수 후보로 자주 학습하는 자리입니다."
    }

    private var ichimokuExplanation: String {
        guard let cloud = ichimokuSeries.last, let last = displayCandles.last else {
            return "일목구름을 계산하려면 최소 52봉이 필요합니다. (주봉·월봉은 제공 데이터가 짧아 표시되지 않을 수 있습니다)"
        }
        let top = max(cloud.spanA, cloud.spanB)
        let bottom = min(cloud.spanA, cloud.spanB)
        let close = last.close
        let cloudType = cloud.spanA >= cloud.spanB ? "양운(스팬A ≥ 스팬B)" : "음운(스팬A < 스팬B)"
        let position: String
        if close > top {
            position = "구름 위(상단 \(Self.priceLabel(top)))에 있어 상승 우위 — 구름 상단이 지지로 작동하는지 관찰하며 학습합니다."
        } else if close < bottom {
            position = "구름 아래(하단 \(Self.priceLabel(bottom)))에 있어 하락 우위 — 구름 하단이 저항으로 작동하는지 관찰하며 학습합니다."
        } else {
            position = "구름 내부(\(Self.priceLabel(bottom))~\(Self.priceLabel(top)))에 있어 방향성 탐색 구간 — 구름 돌파 방향을 기다리며 학습합니다."
        }
        return "전환선(9)·기준선(26)과 선행스팬 A·B가 만든 구름입니다. 현재 \(cloudType)이며, 현재가 \(Self.priceLabel(close))는 \(position) ※ 학습용 단순화로 스팬의 26봉 선행 이동은 생략했습니다."
    }

    private var predictExplanation: String {
        if predictionLoadFailed {
            return "예측 데이터를 불러오지 못했습니다. 예측 칩을 껐다 켜면 다시 시도합니다."
        }
        guard let p = prediction, let probUp = p.probUp else {
            return "AI 예측을 불러오는 중입니다..."
        }
        let probDown = p.probDown ?? (100 - probUp)
        let days = predictionDays
        let confidenceText: String
        switch p.confidence?.lowercased() {
        case "high": confidenceText = "높음"
        case "medium", "mid": confidenceText = "중간"
        case "low": confidenceText = "낮음"
        default: confidenceText = p.confidence ?? "-"
        }
        let directionText = probUp >= 50
            ? "상승 확률 \(String(format: "%.1f", probUp))%"
            : "하락 확률 \(String(format: "%.1f", probDown))%"
        var text = "AI 모델이 \(days)일 뒤 \(directionText)로 봅니다 (신뢰도 \(confidenceText)). 점선은 확률 편향을 일별 누적한 중심 경로, 회색 영역은 변동성(ATR) 기반 불확실성 콘 — 멀어질수록 예측 범위가 넓어집니다."
        if let factor = p.topFactors?.first, let label = factor.label {
            text += " 판단에 가장 큰 영향을 준 요인은 '\(label)'입니다."
        }
        if let note = p.conflictNote, !note.isEmpty {
            text += "\n\n⚠️ \(note)"
        }
        return text
    }

    private var predictModelStatus: String {
        guard let model = prediction?.model, let trained = model.trained, trained > 0, let accuracy = model.accuracy else {
            return "학습 준비 중"
        }
        return "모델 누적 학습 \(trained)회 · 백테스트 적중률 \(String(format: "%.1f", accuracy))% — 6시간마다 자동 재학습하며 발전합니다."
    }

    /// 55000 → "55,000", 3.1478 → "3.15"
    private static func priceLabel(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = value < 100 ? 2 : 0
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    }
}
