import Foundation

@MainActor
final class PortfolioViewModel: ObservableObject {
    @Published var holdings: [PortfolioHolding] = []
    @Published var quotes: [String: Quote] = [:]
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let storageKey = "alpha.portfolio"

    init() {
        load()
    }

    func load() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([PortfolioHolding].self, from: data) else {
            holdings = []
            return
        }
        holdings = decoded
    }

    func save() {
        if let data = try? JSONEncoder().encode(holdings) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    func addHolding(code: String, name: String, quantity: Double, avgPrice: Double) {
        if let idx = holdings.firstIndex(where: { $0.code == code }) {
            holdings[idx].quantity += quantity
            holdings[idx].avgPrice = avgPrice
        } else {
            holdings.append(PortfolioHolding(code: code, name: name, quantity: quantity, avgPrice: avgPrice))
        }
        save()
    }

    func remove(at offsets: IndexSet) {
        holdings.remove(atOffsets: offsets)
        save()
    }

    var totalCost: Double {
        holdings.reduce(0) { $0 + $1.costBasis }
    }

    var totalValue: Double {
        holdings.reduce(0) { sum, h in
            let price = Double(quotes[h.code]?.price ?? 0)
            return sum + price * h.quantity
        }
    }

    var totalPnL: Double { totalValue - totalCost }

    func refreshQuotes() async {
        guard !holdings.isEmpty else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        var map: [String: Quote] = [:]
        for h in holdings {
            do {
                let q: Quote = try await APIClient.shared.get("/api/quote/\(h.code)", query: [
                    URLQueryItem(name: "lite", value: "1"),
                ])
                map[h.code] = q
            } catch {
                errorMessage = error.localizedDescription
            }
        }
        quotes = map
    }
}
