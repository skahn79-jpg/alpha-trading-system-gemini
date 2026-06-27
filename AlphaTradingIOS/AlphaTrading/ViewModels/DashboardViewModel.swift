import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var indices: [MarketIndex] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            indices = try await APIClient.shared.get("/api/index")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
