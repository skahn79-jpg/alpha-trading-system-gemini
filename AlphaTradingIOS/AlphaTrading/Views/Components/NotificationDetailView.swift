import SwiftUI

/// Full-screen sheet for a tapped push / local notification. Alert text is primary; chart is optional.
struct NotificationDetailView: View {
    let payload: NotificationOpenPayload
    @Environment(\.dismiss) private var dismiss
    @State private var showChart = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        if let kind = payload.kindLabel {
                            Text(kind)
                                .font(.paperlogy(12, weight: .bold))
                                .foregroundStyle(AppTheme.accent)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(AppTheme.accent.opacity(0.18))
                                .clipShape(Capsule())
                        }
                        Spacer()
                    }

                    Text(payload.title)
                        .font(.paperlogy(22, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let ticker = payload.tickerLabel {
                        Text(ticker)
                            .font(.paperlogy(14, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)
                    }

                    Text(payload.body)
                        .font(.paperlogy(16))
                        .foregroundStyle(AppTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    if payload.detail != payload.body && !payload.detail.isEmpty {
                        Text(payload.detail)
                            .font(.paperlogy(14))
                            .foregroundStyle(AppTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if payload.stock != nil {
                        Button {
                            showChart = true
                        } label: {
                            HStack {
                                Image(systemName: "chart.xyaxis.line")
                                Text("차트 보기")
                                    .font(.paperlogy(15, weight: .semibold))
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                            }
                            .foregroundStyle(AppTheme.background)
                            .padding(14)
                            .background(AppTheme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(AppTheme.background)
            .navigationTitle("알림 내용")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
                }
            }
            .navigationDestination(isPresented: $showChart) {
                if let stock = payload.stock {
                    StockDetailView(stock: stock)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
