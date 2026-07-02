import Foundation

@MainActor
final class StockListViewModel: ObservableObject {
    @Published var query = ""
    @Published var results: [MasterStock] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    // 관심종목은 전역 저장소로 이동 (FavoritesStore.shared) — 뷰 호환용 패스스루
    var favorites: [Stock] { FavoritesStore.shared.favorites }

    func toggleFavorite(_ stock: Stock) {
        FavoritesStore.shared.toggle(stock)
    }

    func isFavorite(_ code: String) -> Bool {
        FavoritesStore.shared.isFavorite(code)
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
