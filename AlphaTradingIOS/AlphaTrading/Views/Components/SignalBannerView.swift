import SwiftUI

/// 대시보드·차트에서 쓰는 단일 알림 섹션 (`위험` 또는 `기회`).
struct SignalBannerView: View {
    let title: String
    let signals: [PersonalSignal]
    var tint: Color
    var emptyText: String
    var showsWhenEmpty: Bool = true
    /// Preview row cap on the dashboard card.
    var previewLimit: Int = 6
    var showsSeeAll: Bool = true
    var onSelect: ((PersonalSignal) -> Void)?

    private var preview: [PersonalSignal] { Array(signals.prefix(previewLimit)) }
    private var hasMore: Bool { showsSeeAll && signals.count > previewLimit }

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
                    if showsSeeAll && !signals.isEmpty {
                        NavigationLink {
                            SignalCategoryListView(
                                title: title,
                                signals: signals,
                                tint: tint,
                                onSelect: onSelect
                            )
                        } label: {
                            HStack(spacing: 4) {
                                Text(hasMore ? "더보기" : "전체")
                                    .font(.paperlogy(11, weight: .semibold))
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                            }
                            .foregroundStyle(AppTheme.accent)
                        }
                    } else {
                        Text("관심종목 · 분석 전용")
                            .font(.paperlogy(10))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                if signals.isEmpty {
                    Text(emptyText)
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(preview) { signal in
                        Button {
                            onSelect?(signal)
                        } label: {
                            signalRow(signal)
                        }
                        .buttonStyle(.plain)
                    }
                    if hasMore {
                        NavigationLink {
                            SignalCategoryListView(
                                title: title,
                                signals: signals,
                                tint: tint,
                                onSelect: onSelect
                            )
                        } label: {
                            Text("전체 \(signals.count)건 보기")
                                .font(.paperlogy(12, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 4)
                        }
                    }
                }
            }
            .padding(14)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    @ViewBuilder
    private func signalRow(_ signal: PersonalSignal) -> some View {
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
}

/// 위험 / 기회 전체 목록.
struct SignalCategoryListView: View {
    let title: String
    let signals: [PersonalSignal]
    var tint: Color
    var onSelect: ((PersonalSignal) -> Void)?

    var body: some View {
        List {
            if signals.isEmpty {
                Text("표시할 항목이 없습니다.")
                    .font(.paperlogy(13))
                    .foregroundStyle(AppTheme.textSecondary)
            } else {
                ForEach(signals) { signal in
                    Button {
                        onSelect?(signal)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Text(signal.kind.label)
                                .font(.paperlogy(11, weight: .bold))
                                .foregroundStyle(tint)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(tint.opacity(0.15))
                                .clipShape(Capsule())
                            VStack(alignment: .leading, spacing: 4) {
                                Text(signal.title)
                                    .font(.paperlogy(14, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                Text(signal.detail)
                                    .font(.paperlogy(12))
                                    .foregroundStyle(AppTheme.textSecondary)
                                Text("\(signal.code) · \(signal.severity.label)")
                                    .font(.paperlogy(10))
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .background(AppTheme.background)
    }
}

/// 위험 / 기회를 서로 다른 카드로 나란히 표시한다. 대시보드는 빈 섹션도 유지한다.
struct SignalBannerPair: View {
    let signals: [PersonalSignal]
    var showEmptySections: Bool = true
    var previewLimit: Int = 6
    var showsSeeAll: Bool = true
    var onSelect: ((PersonalSignal) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SignalBannerView(
                title: "위험",
                signals: PersonalSignal.riskSignals(in: signals),
                tint: AppTheme.down,
                emptyText: "급락·탐욕·위험 뉴스가 있으면 여기에 표시됩니다.",
                showsWhenEmpty: showEmptySections,
                previewLimit: previewLimit,
                showsSeeAll: showsSeeAll,
                onSelect: onSelect
            )
            SignalBannerView(
                title: "기회",
                signals: PersonalSignal.opportunitySignals(in: signals),
                tint: AppTheme.up,
                emptyText: "돌파·공포 역발상·기회 뉴스가 있으면 여기에 표시됩니다.",
                showsWhenEmpty: showEmptySections,
                previewLimit: previewLimit,
                showsSeeAll: showsSeeAll,
                onSelect: onSelect
            )
        }
    }
}
