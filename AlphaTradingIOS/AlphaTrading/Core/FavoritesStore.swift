import Foundation

/// 관심종목 전역 저장소 — 관심 탭·검색·업종·종목 상세 어디서든 추가/제거 가능
/// iCloud 키-값 저장소로 같은 Apple ID의 다른 기기와 자동 동기화됩니다.
@MainActor
final class FavoritesStore: ObservableObject {
    static let shared = FavoritesStore()

    @Published private(set) var favorites: [Stock] = []

    private let key = "alpha.favorites"
    private let stampKey = "alpha.favorites.stamp"
    private let cloud = NSUbiquitousKeyValueStore.default

    private init() {
        load()
        // 다른 기기에서 변경이 도착하면 병합 (최신 저장본 우선)
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: cloud,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.mergeFromCloud() }
        }
        cloud.synchronize()
    }

    func load() {
        // 로컬 우선 로드 후 클라우드와 병합
        if let data = UserDefaults.standard.data(forKey: key),
           let decoded = try? JSONDecoder().decode([Stock].self, from: data) {
            favorites = decoded
        } else {
            favorites = defaultFavorites
            save()
        }
        mergeFromCloud()
    }

    /// 클라우드 저장본이 더 최신이면 교체 (last-writer-wins)
    private func mergeFromCloud() {
        guard let data = cloud.data(forKey: key),
              let decoded = try? JSONDecoder().decode([Stock].self, from: data) else { return }
        let cloudStamp = cloud.double(forKey: stampKey)
        let localStamp = UserDefaults.standard.double(forKey: stampKey)
        if cloudStamp > localStamp {
            favorites = decoded
            UserDefaults.standard.set(data, forKey: key)
            UserDefaults.standard.set(cloudStamp, forKey: stampKey)
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(favorites) else { return }
        let stamp = Date().timeIntervalSince1970
        UserDefaults.standard.set(data, forKey: key)
        UserDefaults.standard.set(stamp, forKey: stampKey)
        cloud.set(data, forKey: key)
        cloud.set(stamp, forKey: stampKey)
        cloud.synchronize()

        // 국내(kr) 관심종목 코드를 서버 워치리스트로 fire-and-forget 등록 (실패해도 무시)
        let krCodes = favorites.filter { $0.kind == .kr }.map { $0.code }
        Task {
            struct B: Encodable { let codes: [String] }
            struct R: Decodable { let ok: Bool? }
            let _: R? = try? await APIClient.shared.post("/api/watchlist", body: B(codes: krCodes))
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
