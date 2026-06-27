import Foundation

@MainActor
final class GlobalMarketViewModel: ObservableObject {
    @Published var segment: GlobalSegment = .us
    @Published var query = ""
    @Published var catalog: [GlobalSearchItem] = []
    @Published var quotes: [String: GlobalQuote] = [:]
    @Published var isLoading = false
    @Published var errorMessage: String?

    enum GlobalSegment: String, CaseIterable, Identifiable {
        case us = "US"
        case crypto = "CRYPTO"
        var id: String { rawValue }
        var title: String {
            switch self {
            case .us: return "미국주식"
            case .crypto: return "암호화폐"
            }
        }
    }

    private let defaultUS = ["NVDA", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "TSLA", "AMD"]
    private let defaultCrypto = ["BTC", "ETH", "SOL", "XRP"]

    func loadCatalog() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let items: [GlobalSearchItem] = try await APIClient.shared.get(
                "/api/global/search",
                query: [URLQueryItem(name: "q", value: query)]
            )
            catalog = items
            if catalog.isEmpty {
                catalog = (segment == .us ? defaultUS : defaultCrypto).map {
                    GlobalSearchItem(symbol: $0, name: $0, type: segment == .us ? "us" : "crypto", sector: nil)
                }
            }
            await refreshQuotes()
        } catch {
            errorMessage = error.localizedDescription
            catalog = (segment == .us ? defaultUS : defaultCrypto).map {
                GlobalSearchItem(symbol: $0, name: $0, type: segment == .us ? "us" : "crypto", sector: nil)
            }
            await refreshQuotes()
        }
    }

    func refreshQuotes() async {
        for item in catalog.prefix(12) {
            await fetchQuote(symbol: item.symbol)
        }
    }

    func fetchQuote(symbol: String) async {
        let path = segment == .us ? "/api/us/quote/\(symbol)" : "/api/crypto/quote/\(symbol)"
        do {
            let quote: GlobalQuote = try await APIClient.shared.get(path)
            quotes[symbol] = quote
        } catch {
            // 개별 실패는 무시
        }
    }
}
