import SwiftUI

struct SignalBannerView: View {
    let signals: [PersonalSignal]
    var onSelect: ((PersonalSignal) -> Void)?

    var body: some View {
        if signals.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(AppTheme.accent)
                    Text("위험 · 기회 알림")
                        .font(.paperlogy(14, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                    Text("관심종목 · 분석 전용")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                ForEach(signals.prefix(4)) { signal in
                    Button {
                        onSelect?(signal)
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Text(signal.kind.label)
                                .font(.paperlogy(11, weight: .bold))
                                .foregroundStyle(signal.opportunity ? AppTheme.up : AppTheme.down)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background((signal.opportunity ? AppTheme.up : AppTheme.down).opacity(0.15))
                                .clipShape(Capsule())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(signal.title)
                                    .font(.paperlogy(13, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                    .multilineTextAlignment(.leading)
                                Text(signal.detail)
                                    .font(.paperlogy(11))
                                    .foregroundStyle(AppTheme.textSecondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                            Text(signal.severity.label)
                                .font(.paperlogy(10, weight: .medium))
                                .foregroundStyle(signal.severity == .high ? AppTheme.down : AppTheme.textSecondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(14)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}
