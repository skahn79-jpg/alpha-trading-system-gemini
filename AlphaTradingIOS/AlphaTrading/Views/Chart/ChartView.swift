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
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4))
                }
                .frame(height: 260)
                .padding(.horizontal, 8)
            }
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .task(id: code) { await viewModel.load(code: code) }
    }
}
