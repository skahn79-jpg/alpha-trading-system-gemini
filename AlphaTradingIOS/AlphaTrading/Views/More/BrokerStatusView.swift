import SwiftUI

struct BrokerStatusView: View {
    @StateObject private var viewModel = BrokerStatusViewModel(
        service: AdminAuthService(client: .shared)
    )

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if viewModel.isLoading && viewModel.status == nil {
                    LoadingView(message: "KB 상태를 불러오는 중...")
                        .frame(maxWidth: .infinity, minHeight: 180)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.down)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }

                if let status = viewModel.status {
                    statusCard(status)
                    inquiryCard
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("KB증권")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }

    private func statusCard(_ status: BrokerStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(BrokerStatusCopy.configurationTitle(configured: status.configured))
                .font(.paperlogy(16, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            if let detail = BrokerStatusCopy.configurationDetail(configured: status.configured) {
                Text(detail)
                    .font(.paperlogy(13))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Divider().background(AppTheme.line)

            Text(BrokerStatusCopy.connectionTitle(status.connection))
                .font(.paperlogy(15, weight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
            if let detail = BrokerStatusCopy.connectionDetail(status.connection) {
                Text(detail)
                    .font(.paperlogy(13))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Divider().background(AppTheme.line)

            Text(BrokerStatusCopy.tradingLabel(enabled: status.tradingEnabled))
                .font(.paperlogy(14))
                .foregroundStyle(AppTheme.textSecondary)
            Text(BrokerStatusCopy.autoTradingLabel(enabled: status.autoTradingEnabled))
                .font(.paperlogy(14))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var inquiryCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(BrokerStatusCopy.inquiryRows.enumerated()), id: \.offset) { index, title in
                HStack {
                    Text(title)
                        .font(.paperlogy(15, weight: .medium))
                        .foregroundStyle(AppTheme.textSecondary)
                    Spacer()
                    Text(BrokerStatusCopy.inquiryPending)
                        .font(.paperlogy(13))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                .padding(.vertical, 12)
                .disabled(true)
                if index < BrokerStatusCopy.inquiryRows.count - 1 {
                    Divider().background(AppTheme.line)
                }
            }
        }
        .padding(.horizontal, 16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .allowsHitTesting(false)
    }
}
