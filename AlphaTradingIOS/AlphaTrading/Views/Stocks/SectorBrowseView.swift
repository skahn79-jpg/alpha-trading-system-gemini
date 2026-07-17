import SwiftUI

struct SectorBrowseView: View {
    @StateObject private var viewModel = SectorViewModel()
    @ObservedObject private var favorites = FavoritesStore.shared
    @State private var quoteCache: [String: Quote] = [:]
    @State private var heatmap: SectorHeatmapResponse?
    @State private var heatmapExpanded = true

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
                heatmapSection
                sectorList
            } else {
                sectorStockList
            }
        }
        .background(AppTheme.background)
        .task {
            heatmap = try? await APIClient.shared.get("/api/sector/heatmap") as SectorHeatmapResponse
        }
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

    @ViewBuilder
    private var heatmapSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation { heatmapExpanded.toggle() }
            } label: {
                HStack {
                    Image(systemName: "square.grid.3x3.fill")
                        .foregroundStyle(AppTheme.accent)
                    Text("섹터 히트맵")
                        .font(.paperlogy(15, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                    Image(systemName: heatmapExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }

            if heatmapExpanded {
                if heatmap?.building == true {
                    Text("집계 중 — 잠시 후 다시 확인해주세요.")
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                } else if let sectors = heatmap?.sectors, !sectors.isEmpty {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        ForEach(sectors) { s in
                            VStack(spacing: 3) {
                                Text(s.sector)
                                    .font(.paperlogy(11, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                                Text(String(format: "%+.2f%%", s.changeRate))
                                    .font(.paperlogy(12, weight: .bold))
                                    .foregroundStyle(s.changeRate >= 0 ? AppTheme.up : AppTheme.down)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(heatColor(s.changeRate))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                } else {
                    Text("히트맵 데이터를 불러오는 중...")
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }

    private func heatColor(_ rate: Double) -> Color {
        let magnitude = min(abs(rate), 3) / 3 // 0~1
        let opacity = 0.15 + magnitude * 0.35 // 0.15~0.5
        return (rate >= 0 ? AppTheme.up : AppTheme.down).opacity(opacity)
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
