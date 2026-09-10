import SwiftUI

/// 대시보드·차트에서 쓰는 단일 알림 섹션 (`위험` 또는 `기회`).
struct SignalBannerView: View {
    let title: String
    let signals: [PersonalSignal]
    var tint: Color
    var emptyText: String
    var showsWhenEmpty: Bool = true
    var onSelect: ((PersonalSignal) -> Void)?

    var body: some View {
        if signals.isEmpty && !showsWhenEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: title == "기회" ? "lightbulb.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(tint)
                    Text(title)
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text("\(signals.count)")
                        .font(.paperlogy(11, weight: .bold))
                        .foregroundStyle(AppTheme.textSecondary)
                    Spacer()
                    Text("관심종목 · 분석 전용")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                if signals.isEmpty {
                    Text(emptyText)
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(signals.prefix(6)) { signal in
                        Button {
                            onSelect?(signal)
                        } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Text(signal.kind.label)
                                    .font(.paperlogy(11, weight: .bold))
                                    .foregroundStyle(tint)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(tint.opacity(0.15))
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
            .padding(14)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

/// 위험 / 기회를 서로 다른 카드로 나란히 표시한다. 대시보드는 빈 섹션도 유지한다.
struct SignalBannerPair: View {
    let signals: [PersonalSignal]
    var showEmptySections: Bool = true
    var onSelect: ((PersonalSignal) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SignalBannerView(
                title: "위험",
                signals: PersonalSignal.riskSignals(in: signals),
                tint: AppTheme.down,
                emptyText: "급락·탐욕·위험 뉴스가 있으면 여기에 표시됩니다.",
                showsWhenEmpty: showEmptySections,
                onSelect: onSelect
            )
            SignalBannerView(
                title: "기회",
                signals: PersonalSignal.opportunitySignals(in: signals),
                tint: AppTheme.up,
                emptyText: "돌파·공포 역발상·기회 뉴스가 있으면 여기에 표시됩니다.",
                showsWhenEmpty: showEmptySections,
                onSelect: onSelect
            )
        }
    }
}
