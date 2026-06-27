import SwiftUI

struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("시장 요약")
                        .font(.paperlogy(22, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)

                    if viewModel.isLoading && viewModel.indices.isEmpty {
                        LoadingView()
                            .frame(height: 180)
                    } else if let error = viewModel.errorMessage {
                        Text(error)
                            .font(.paperlogy(14))
                            .foregroundStyle(AppTheme.down)
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(viewModel.indices) { index in
                                IndexCardView(index: index)
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("대시보드")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
        }
    }
}
