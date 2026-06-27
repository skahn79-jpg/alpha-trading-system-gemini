import SwiftUI

struct ScreenerView: View {
    @StateObject private var viewModel = ScreenerViewModel()

    var body: some View {
        List {
            Section {
                Picker("시장", selection: $viewModel.market) {
                    ForEach(viewModel.markets, id: \.self) { m in
                        Text(m).tag(m)
                    }
                }
                .pickerStyle(.segmented)

                Button {
                    Task { await viewModel.scan() }
                } label: {
                    HStack {
                        Spacer()
                        Text(viewModel.isLoading ? viewModel.progress : "전체 스캔 실행")
                            .font(.paperlogy(15, weight: .semibold))
                        Spacer()
                    }
                }
                .disabled(viewModel.isLoading)
            }

            if let error = viewModel.errorMessage {
                Text(error).foregroundStyle(AppTheme.down).font(.paperlogy(13))
            }

            Section("AI 점수 랭킹") {
                if viewModel.isLoading && viewModel.rows.isEmpty {
                    LoadingView(message: "종목 분석 중...")
                } else if viewModel.rows.isEmpty {
                    Text("스캔 버튼을 눌러 \(viewModel.market) 종목을 분석하세요.")
                        .font(.paperlogy(13))
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(viewModel.rows) { row in
                        NavigationLink {
                            StockDetailView(stock: Stock(
                                code: row.code,
                                name: row.name ?? row.code,
                                tag: row.signalBadge,
                                sector: nil
                            ))
                        } label: {
                            ScreenerRowView(item: row)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("스크리너")
        .refreshable { await viewModel.scan() }
    }
}

private struct ScreenerRowView: View {
    let item: BatchQuoteItem

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name ?? item.code)
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(item.code)
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(item.signalBadge)
                    .font(.paperlogy(12, weight: .bold))
                    .foregroundStyle(badgeColor)
                if let score = item.analysis?.score {
                    Text("점수 \(score)")
                        .font(.paperlogy(11))
                        .foregroundStyle(AppTheme.accent)
                }
                Text(item.changeStr ?? "-")
                    .font(.paperlogy(12))
                    .foregroundStyle((item.up ?? false) ? AppTheme.up : AppTheme.down)
            }
        }
        .padding(.vertical, 4)
    }

    private var badgeColor: Color {
        let badge = item.signalBadge
        if badge.contains("매수") { return AppTheme.up }
        if badge.contains("매도") { return AppTheme.down }
        return AppTheme.textSecondary
    }
}
