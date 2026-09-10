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

enum MainAppTab: Int, CaseIterable, Hashable, Identifiable {
    case dashboard
    case favorites
    case stocks
    case portfolio
    case more

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "대시보드"
        case .favorites: return "관심"
        case .stocks: return "종목"
        case .portfolio: return "포트폴리오"
        case .more: return "더보기"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "chart.line.uptrend.xyaxis"
        case .favorites: return "star.fill"
        case .stocks: return "list.bullet"
        case .portfolio: return "briefcase.fill"
        case .more: return "ellipsis.circle"
        }
    }
}

struct MainTabView: View {
    @StateObject private var stockListVM = StockListViewModel()
    @State private var selectedTab: MainAppTab = .dashboard

    var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView()
                .tabItem { Label(MainAppTab.dashboard.title, systemImage: MainAppTab.dashboard.systemImage) }
                .tag(MainAppTab.dashboard)

            FavoritesView(viewModel: stockListVM)
                .tabItem { Label(MainAppTab.favorites.title, systemImage: MainAppTab.favorites.systemImage) }
                .tag(MainAppTab.favorites)

            StockListView(viewModel: stockListVM)
                .tabItem { Label(MainAppTab.stocks.title, systemImage: MainAppTab.stocks.systemImage) }
                .tag(MainAppTab.stocks)

            PortfolioView()
                .tabItem { Label(MainAppTab.portfolio.title, systemImage: MainAppTab.portfolio.systemImage) }
                .tag(MainAppTab.portfolio)

            MoreView()
                .tabItem { Label(MainAppTab.more.title, systemImage: MainAppTab.more.systemImage) }
                .tag(MainAppTab.more)
        }
        .tint(AppTheme.accent)
    }
}
