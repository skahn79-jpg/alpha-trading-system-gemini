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
        }
        .chartYScale(domain: yDomain)
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
}
