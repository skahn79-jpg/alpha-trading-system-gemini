import Foundation

@MainActor
final class SectorViewModel: ObservableObject {
    @Published var market: MarketFilter = .all
    @Published var sectors: [SectorItem] = []
    @Published var stocks: [MasterStock] = []
    @Published var selectedSector: SectorItem?
    @Published var query = ""
    @Published var isLoadingSectors = false
    @Published var isLoadingStocks = false
    @Published var errorMessage: String?

    func loadSectors() async {
        isLoadingSectors = true
        errorMessage = nil
        defer { isLoadingSectors = false }
        do {
            let response: SectorsResponse = try await APIClient.shared.get(
                "/api/master/sectors",
                query: [
                    URLQueryItem(name: "market", value: market.rawValue),
                    URLQueryItem(name: "type", value: "sector"),
                ]
            )
            sectors = response.sectors
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadStocks(for sector: SectorItem) async {
        selectedSector = sector
        isLoadingStocks = true
        errorMessage = nil
        defer { isLoadingStocks = false }
        do {
            var queryItems = [
                URLQueryItem(name: "sector", value: sector.name),
                URLQueryItem(name: "market", value: market.rawValue),
                URLQueryItem(name: "sort", value: "name"),
                URLQueryItem(name: "limit", value: "200"),
            ]
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if !q.isEmpty {
                queryItems.append(URLQueryItem(name: "q", value: q))
            }
            let response: SectorStocksResponse = try await APIClient.shared.get(
                "/api/master/by-sector",
                query: queryItems
            )
            stocks = response.results
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshStocks() async {
        guard let sector = selectedSector else { return }
        await loadStocks(for: sector)
    }
}
