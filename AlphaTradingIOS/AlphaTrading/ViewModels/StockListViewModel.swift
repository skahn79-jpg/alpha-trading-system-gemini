import Foundation

@MainActor
final class StockListViewModel: ObservableObject {
    @Published var query = ""
    @Published var results: [MasterStock] = []
    @Published var favorites: [Stock] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let favoritesKey = "alpha.favorites"

    init() {
        loadFavorites()
    }

    func loadFavorites() {
        guard let data = UserDefaults.standard.data(forKey: favoritesKey),
              let decoded = try? JSONDecoder().decode([Stock].self, from: data) else {
            favorites = defaultFavorites
            saveFavorites()
            return
        }
        favorites = decoded
    }

    func saveFavorites() {
        if let data = try? JSONEncoder().encode(favorites) {
            UserDefaults.standard.set(data, forKey: favoritesKey)
        }
    }

    func toggleFavorite(_ stock: Stock) {
        if let idx = favorites.firstIndex(where: { $0.code == stock.code }) {
            favorites.remove(at: idx)
        } else {
            favorites.insert(stock, at: 0)
        }
        saveFavorites()
    }

    func isFavorite(_ code: String) -> Bool {
        favorites.contains { $0.code == code }
    }

    func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            results = []
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response: MasterSearchResponse = try await APIClient.shared.get(
                "/api/master/search",
                query: [
                    URLQueryItem(name: "q", value: q),
                    URLQueryItem(name: "limit", value: "30"),
                ]
            )
            results = response.results
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var defaultFavorites: [Stock] {
        [
            Stock(code: "005930", name: "삼성전자", tag: "반도체", sector: "반도체"),
            Stock(code: "000660", name: "SK하이닉스", tag: "반도체", sector: "반도체"),
            Stock(code: "035420", name: "NAVER", tag: "플랫폼", sector: "인터넷"),
        ]
    }
}
