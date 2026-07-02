import SwiftUI
import Charts

struct ChartView: View {
    let code: String
    @StateObject private var viewModel = ChartViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if viewModel.isLoading && viewModel.candles.isEmpty {
                LoadingView(message: "차트 로딩...")
                    .frame(height: 260)
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
                Chart(viewModel.candles) { candle in
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
                        width: 6
                    )
                    .foregroundStyle(candle.isUp ? AppTheme.up : AppTheme.down)
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
            }
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .task(id: code) { await viewModel.load(code: code) }
    }

    /// 기본 숫자 축은 0을 포함해 캔들이 압축되므로 저가~고가 범위(±2% 여유)로 스케일 고정
    private var yDomain: ClosedRange<Int> {
        let lows = viewModel.candles.map(\.low)
        let highs = viewModel.candles.map(\.high)
        guard let minLow = lows.min(), let maxHigh = highs.max(), minLow < maxHigh else {
            return 0...1
        }
        let padding = max(1, (maxHigh - minLow) / 50)
        return (minLow - padding)...(maxHigh + padding)
    }

    /// 카테고리 X축에 전체 날짜 라벨이 겹쳐 그려지지 않도록 4개만 고르게 표시
    private var xAxisDates: [String] {
        let dates = viewModel.candles.map(\.date)
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
