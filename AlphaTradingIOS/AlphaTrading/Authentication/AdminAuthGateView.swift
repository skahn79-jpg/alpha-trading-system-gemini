import SwiftUI

struct AdminAuthGateView: View {
    @ObservedObject var auth: AdminAuthViewModel
    @State private var sessionEpoch = 0
    @State private var wasAuthenticated = false

    var body: some View {
        Group {
            switch auth.state {
            case .checking:
                AdminSessionCheckingView()
            case .authenticated:
                MainTabView()
                    .id(sessionEpoch)
                    .environmentObject(auth)
            case .unauthenticated:
                AdminLoginView()
                    .environmentObject(auth)
            case .unavailable:
                AdminSessionUnavailableView()
                    .environmentObject(auth)
            }
        }
        .onAppear {
            wasAuthenticated = auth.state.allowsMainInterface
        }
        .onChange(of: auth.state) { newValue in
            let isAuthenticated = newValue.allowsMainInterface
            if wasAuthenticated && !isAuthenticated {
                sessionEpoch += 1
            }
            wasAuthenticated = isAuthenticated
        }
    }
}
