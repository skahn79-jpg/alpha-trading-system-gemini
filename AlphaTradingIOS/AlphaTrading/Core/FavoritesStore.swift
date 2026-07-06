import Foundation

/// 관심종목 전역 저장소 — 관심 탭·검색·업종·종목 상세 어디서든 추가/제거 가능
@MainActor
final class FavoritesStore: ObservableObject {
    static let shared = FavoritesStore()

    @Published private(set) var favorites: [Stock] = []

    private let key = "alpha.favorites"

    private init() {
        load()
    }

    func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([Stock].self, from: data) else {
            favorites = defaultFavorites
            save()
            return
        }
        favorites = decoded
    }

    private func save() {
        if let data = try? JSONEncoder().encode(favorites) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func isFavorite(_ code: String) -> Bool {
        favorites.contains { $0.code == code }
    }

    func toggle(_ stock: Stock) {
        if let idx = favorites.firstIndex(where: { $0.code == stock.code }) {
            favorites.remove(at: idx)
        } else {
            favorites.insert(stock, at: 0)
        }
        save()
    }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        favorites.move(fromOffsets: source, toOffset: destination)
        save()
    }

    func remove(atOffsets offsets: IndexSet) {
        favorites.remove(atOffsets: offsets)
        save()
    }

    private var defaultFavorites: [Stock] {
        [
            Stock(code: "005930", name: "삼성전자", tag: "반도체", sector: "반도체"),
            Stock(code: "000660", name: "SK하이닉스", tag: "반도체", sector: "반도체"),
            Stock(code: "035420", name: "NAVER", tag: "플랫폼", sector: "인터넷"),
        ]
    }
}
