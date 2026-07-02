import SwiftUI

enum StockDetailTab: String, CaseIterable, Identifiable {
    case chart = "차트"
    case technical = "기술분석"
    case summary = "종합"
    var id: String { rawValue }
}

struct StockDetailView: View {
    let stock: Stock
    @StateObject private var chartVM = ChartViewModel()
    @StateObject private var analysisVM = AnalysisViewModel()
    @State private var tab: StockDetailTab = .chart

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                priceHeader

                Picker("탭", selection: $tab) {
                    ForEach(StockDetailTab.allCases) { t in
                        Text(t.rawValue).tag(t)
                    }
                }
                .pickerStyle(.segmented)

                switch tab {
                case .chart:
                    chartSection
                case .technical:
                    if analysisVM.isLoading {
                        LoadingView().frame(height: 120)
                    } else {
                        TechnicalAnalysisView(
                            analysis: analysisVM.analysis,
                            quote: analysisVM.quote,
                            prediction: analysisVM.prediction
                        )
                    }
                case .summary:
                    if analysisVM.isLoading {
                        LoadingView().frame(height: 120)
                    } else {
                        AnalysisSummaryView(stock: stock, viewModel: analysisVM)
                    }
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle(stock.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await chartVM.load(code: stock.code)
            await analysisVM.load(code: stock.code, sector: stock.sector, market: nil)
        }
        .task {
            await chartVM.load(code: stock.code)
            await analysisVM.load(code: stock.code, sector: stock.sector, market: nil)
        }
    }

    private var priceHeader: some View {
        Group {
            if let quote = chartVM.quote {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(quote.displayPrice)
                            .font(.paperlogy(32, weight: .bold))
                            .foregroundStyle(AppTheme.textPrimary)
                        if let badge = analysisVM.analysis?.signalBadge {
                            SignalBadgeView(label: badge)
                        }
                    }
                    Text(quote.displayChange)
                        .font(.paperlogy(18, weight: .semibold))
                        .foregroundStyle(quote.isUp ? AppTheme.up : AppTheme.down)
                    if let sector = stock.sector {
                        Text(sector)
                            .font(.paperlogy(12, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private var chartSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("일봉 차트")
                .font(.paperlogy(16, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            ChartView(code: stock.code)
        }
    }
}

struct StockListView: View {
    @ObservedObject var viewModel: StockListViewModel
    @State private var quoteCache: [String: Quote] = [:]

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(AppTheme.textSecondary)
                    TextField("종목명 또는 코드 검색", text: $viewModel.query)
                        .font(.paperlogy(15))
                        .foregroundStyle(AppTheme.textPrimary)
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.search() } }
                }
                .padding(12)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16)
                .padding(.top, 8)

                NavigationLink {
                    SectorBrowseView()
                } label: {
                    HStack {
                        Image(systemName: "square.grid.2x2")
                        Text("업종별 종목 검색")
                            .font(.paperlogy(14, weight: .semibold))
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .foregroundStyle(AppTheme.accent)
                    .padding(12)
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 16)

                if viewModel.isLoading {
                    LoadingView().frame(maxHeight: 200)
                } else if let error = viewModel.errorMessage {
                    Text(error).foregroundStyle(AppTheme.down).padding()
                } else {
                    List {
                        ForEach(displayItems) { item in
                            NavigationLink(value: item.asStock()) {
                                StockRowView(
                                    stock: item.asStock(),
                                    quote: quoteCache[item.code]
                                )
                            }
                            .listRowBackground(AppTheme.background)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(AppTheme.background)
            .navigationTitle("종목")
            .navigationDestination(for: Stock.self) { stock in
                StockDetailView(stock: stock)
            }
            .task(id: displayCodes) { await loadQuotes(for: displayCodes) }
        }
    }

    private var displayItems: [MasterStock] {
        if viewModel.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return viewModel.favorites.map { MasterStock(code: $0.code, name: $0.name, market: nil, tag: $0.tag, sector: $0.sector) }
        }
        return viewModel.results
    }

    private var displayCodes: String {
        displayItems.map(\.code).joined(separator: ",")
    }

    private func loadQuotes(for codesKey: String) async {
        let codes = codesKey.split(separator: ",").map(String.init)
        for code in codes {
            do {
                let q: Quote = try await APIClient.shared.get("/api/quote/\(code)", query: [
                    URLQueryItem(name: "lite", value: "1"),
                ])
                quoteCache[code] = q
            } catch {
                continue
            }
        }
    }
}

struct FavoritesView: View {
    @ObservedObject var viewModel: StockListViewModel
    @State private var quoteCache: [String: Quote] = [:]

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.favorites) { stock in
                    NavigationLink(value: stock) {
                        StockRowView(
                            stock: stock,
                            quote: quoteCache[stock.code],
                            showFavorite: true,
                            isFavorite: true,
                            onFavoriteToggle: { viewModel.toggleFavorite(stock) }
                        )
                    }
                    .listRowBackground(AppTheme.background)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationTitle("관심")
            .navigationDestination(for: Stock.self) { stock in
                StockDetailView(stock: stock)
            }
            .task(id: viewModel.favorites.map(\.code).joined()) {
                for stock in viewModel.favorites {
                    do {
                        let q: Quote = try await APIClient.shared.get("/api/quote/\(stock.code)", query: [
                            URLQueryItem(name: "lite", value: "1"),
                        ])
                        quoteCache[stock.code] = q
                    } catch { continue }
                }
            }
        }
    }
}
