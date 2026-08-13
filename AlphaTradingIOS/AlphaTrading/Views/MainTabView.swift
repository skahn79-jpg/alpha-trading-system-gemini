import SwiftUI

/// Extra bottom clearance so scroll content sits above the floating tab bar.
/// Home-indicator safe area is left to the system; this is only the bar itself.
enum MainTabBarLayout {
    static let contentClearance: CGFloat = 56
}

extension View {
    func floatingTabBarContentInset() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear
                .frame(height: MainTabBarLayout.contentClearance)
                .accessibilityHidden(true)
        }
    }
}

struct MainTabView: View {
    @StateObject private var stockListVM = StockListViewModel()

    var body: some View {
        TabView {
            FavoritesView(viewModel: stockListVM)
                .tabItem { Label("관심", systemImage: "star.fill") }

            StockListView(viewModel: stockListVM)
                .tabItem { Label("종목", systemImage: "list.bullet") }

            DashboardView()
                .tabItem { Label("대시보드", systemImage: "chart.line.uptrend.xyaxis") }

            PortfolioView()
                .tabItem { Label("포트폴리오", systemImage: "briefcase.fill") }

            MoreView()
                .tabItem { Label("더보기", systemImage: "ellipsis.circle") }
        }
        .tint(AppTheme.accent)
    }
}
