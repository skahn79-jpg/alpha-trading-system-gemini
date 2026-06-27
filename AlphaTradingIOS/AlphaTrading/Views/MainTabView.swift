import SwiftUI

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
