import Foundation

@MainActor
final class ScreenerViewModel: ObservableObject {
    @Published var market: String = "KOSPI"
    @Published var rows: [BatchQuoteItem] = []
    @Published var isLoading = false
    @Published var progress = ""
    @Published var errorMessage: String?

    let markets = ["KOSPI", "KOSDAQ"]

    func scan() async {
        isLoading = true
        errorMessage = nil
        rows = []
        defer { isLoading = false; progress = "" }

        do {
            let kind = market == "KOSDAQ" ? "kosdaq" : "kospi"
            let universe: UniverseResponse = try await APIClient.shared.get("/api/master/universe/\(kind)")
            let codes = universe.results.prefix(30).map(\.code)
            guard !codes.isEmpty else {
                errorMessage = "스캔할 종목이 없습니다."
                return
            }

            var collected: [BatchQuoteItem] = []
            let chunks = stride(from: 0, to: codes.count, by: 10).map {
                Array(codes[$0..<min($0 + 10, codes.count)])
            }

            for (index, chunk) in chunks.enumerated() {
                progress = "스캔 중 \(index + 1)/\(chunks.count)..."
                let joined = chunk.joined(separator: ",")
                let batch: [BatchQuoteItem] = try await APIClient.shared.get(
                    "/api/quotes",
                    query: [
                        URLQueryItem(name: "codes", value: joined),
                        URLQueryItem(name: "analyze", value: "1"),
                    ]
                )
                collected.append(contentsOf: batch.filter { $0.error != true })
            }

            rows = collected
                .sorted { ($0.analysis?.score ?? 0) > ($1.analysis?.score ?? 0) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
