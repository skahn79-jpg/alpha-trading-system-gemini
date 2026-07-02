import SwiftUI

struct SectorBrowseView: View {
    @StateObject private var viewModel = SectorViewModel()
    @ObservedObject private var favorites = FavoritesStore.shared
    @State private var quoteCache: [String: Quote] = [:]

    var body: some View {
        VStack(spacing: 12) {
            Picker("시장", selection: $viewModel.market) {
                ForEach(MarketFilter.allCases) { m in
                    Text(m.label).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .onChange(of: viewModel.market) { _ in
                Task { await viewModel.loadSectors() }
            }

            if viewModel.selectedSector == nil {
                sectorList
            } else {
                sectorStockList
            }
        }
        .background(AppTheme.background)
        .navigationTitle(viewModel.selectedSector?.name ?? "업종 검색")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if viewModel.selectedSector != nil {
                ToolbarItem(placement: .topBarLeading) {
                    Button("업종 목록") {
                        viewModel.selectedSector = nil
                        viewModel.stocks = []
                        viewModel.query = ""
                    }
                }
            }
        }
        .task { await viewModel.loadSectors() }
        .refreshable {
            if let sector = viewModel.selectedSector {
                await viewModel.loadStocks(for: sector)
            } else {
                await viewModel.loadSectors()
            }
        }
    }

    private var sectorList: some View {
        Group {
            if viewModel.isLoadingSectors {
                LoadingView().frame(maxHeight: 200)
            } else if let error = viewModel.errorMessage {
                Text(error).foregroundStyle(AppTheme.down).padding()
            } else {
                List {
                    ForEach(viewModel.sectors) { sector in
                        Button {
                            Task { await viewModel.loadStocks(for: sector) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(sector.name)
                                        .font(.paperlogy(15, weight: .semibold))
                                        .foregroundStyle(AppTheme.textPrimary)
                                    Text("코스피 \(sector.kospi ?? 0) · 코스닥 \(sector.kosdaq ?? 0)")
                                        .font(.paperlogy(11))
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                                Spacer()
                                Text("\(sector.count)")
                                    .font(.paperlogy(16, weight: .bold))
                                    .foregroundStyle(AppTheme.accent)
                            }
                        }
                        .listRowBackground(AppTheme.background)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var sectorStockList: some View {
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AppTheme.textSecondary)
                TextField("업종 내 검색", text: $viewModel.query)
                    .font(.paperlogy(15))
                    .submitLabel(.search)
                    .onSubmit {
                        guard let sector = viewModel.selectedSector else { return }
                        Task { await viewModel.loadStocks(for: sector) }
                    }
            }
            .padding(12)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)

            if viewModel.isLoadingStocks {
                LoadingView().frame(maxHeight: 200)
            } else {
                List {
                    ForEach(viewModel.stocks) { item in
                        NavigationLink(value: item.asStock()) {
                            StockRowView(
                                stock: item.asStock(),
                                quote: quoteCache[item.code],
                                showFavorite: true,
                                isFavorite: favorites.isFavorite(item.code),
                                onFavoriteToggle: { favorites.toggle(item.asStock()) }
                            )
                        }
                        .listRowBackground(AppTheme.background)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .task(id: viewModel.stocks.map(\.code).joined()) {
            for item in viewModel.stocks {
                do {
                    let q: Quote = try await APIClient.shared.get("/api/quote/\(item.code)", query: [
                        URLQueryItem(name: "lite", value: "1"),
                    ])
                    quoteCache[item.code] = q
                } catch { continue }
            }
        }
    }
}
