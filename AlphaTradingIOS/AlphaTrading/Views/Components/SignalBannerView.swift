import SwiftUI

struct SignalBannerView: View {
    let signals: [PersonalSignal]
    var onSelect: ((PersonalSignal) -> Void)?

    private var riskSignals: [PersonalSignal] { signals.filter { !$0.opportunity } }
    private var opportunitySignals: [PersonalSignal] { signals.filter { $0.opportunity } }

    var body: some View {
        if signals.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
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
                signalGroup(title: "위험", tint: AppTheme.down, rows: riskSignals)
                signalGroup(title: "기회", tint: AppTheme.up, rows: opportunitySignals)
            }
            .padding(14)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    @ViewBuilder
    private func signalGroup(title: String, tint: Color, rows: [PersonalSignal]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.paperlogy(12, weight: .semibold))
                    .foregroundStyle(tint)
                Text("\(rows.count)")
                    .font(.paperlogy(11, weight: .bold))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
            }
            if rows.isEmpty {
                Text("해당 없음")
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(rows.prefix(4)) { signal in
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
        }
    }
}
