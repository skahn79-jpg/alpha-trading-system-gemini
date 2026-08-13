import Foundation

@MainActor
final class BrokerStatusViewModel: ObservableObject {
    @Published var status: BrokerStatus?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let service: AdminAuthService

    init(service: AdminAuthService) {
        self.service = service
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            status = try await service.brokerStatus()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
