import SwiftUI

struct GlobalMarketView: View {
    @StateObject private var viewModel = GlobalMarketViewModel()

    var body: some View {
        VStack(spacing: 0) {
            Picker("세그먼트", selection: $viewModel.segment) {
                ForEach(GlobalMarketViewModel.GlobalSegment.allCases) { seg in
                    Text(seg.title).tag(seg)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            HStack {
                TextField("심볼 검색 (NVDA, BTC...)", text: $viewModel.query)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                Button("검색") {
                    Task { await viewModel.loadCatalog() }
                }
                .font(.paperlogy(14, weight: .semibold))
            }
            .padding(.horizontal)

            if viewModel.isLoading {
                LoadingView(message: "시세 불러오는 중...")
                    .frame(maxHeight: .infinity)
            } else {
                List(viewModel.catalog) { item in
                    GlobalQuoteRow(
                        item: item,
                        quote: viewModel.quotes[item.symbol]
                    )
                    .listRowBackground(AppTheme.card)
                    .task {
                        if viewModel.quotes[item.symbol] == nil {
                            await viewModel.fetchQuote(symbol: item.symbol)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .background(AppTheme.background)
        .navigationTitle("US / CRYPTO")
        .task { await viewModel.loadCatalog() }
        .onChange(of: viewModel.segment) { _ in
            Task { await viewModel.loadCatalog() }
        }
        .refreshable { await viewModel.loadCatalog() }
    }
}

private struct GlobalQuoteRow: View {
    let item: GlobalSearchItem
    let quote: GlobalQuote?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.symbol)
                    .font(.paperlogy(16, weight: .bold))
                Text(item.name)
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer()
            if let quote {
                VStack(alignment: .trailing, spacing: 4) {
                    Text(quote.displayPrice)
                        .font(.paperlogy(15, weight: .semibold))
                    Text(quote.changeStr ?? "-")
                        .font(.paperlogy(12))
                        .foregroundStyle(quote.isUp ? AppTheme.up : AppTheme.down)
                }
            } else {
                ProgressView().tint(AppTheme.accent)
            }
        }
        .padding(.vertical, 4)
    }
}
