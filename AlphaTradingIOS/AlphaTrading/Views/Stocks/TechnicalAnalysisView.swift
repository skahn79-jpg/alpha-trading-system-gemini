import SwiftUI

struct TechnicalAnalysisView: View {
    let analysis: CandleAnalysis?
    let quote: FullQuote?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let badge = analysis?.signalBadge {
                HStack {
                    SignalBadgeView(label: badge)
                    if let grade = analysis?.grade {
                        Text("등급 \(grade)")
                            .font(.paperlogy(13, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    if let score = analysis?.score {
                        Text("\(score)점")
                            .font(.paperlogy(14, weight: .bold))
                            .foregroundStyle(AppTheme.accent)
                    }
                    Spacer()
                }
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                KPICard(title: "RSI(14)", value: formatNum(analysis?.rsi), subtitle: rsiHint(analysis?.rsi))
                KPICard(title: "MA20", value: formatInt(analysis?.movingAverages?.ma20), subtitle: distText(analysis?.distance?.ma20))
                KPICard(title: "MA60", value: formatInt(analysis?.movingAverages?.ma60), subtitle: distText(analysis?.distance?.ma60))
                KPICard(title: "MA120", value: formatInt(analysis?.movingAverages?.ma120), subtitle: nil)
                KPICard(title: "볼린저 중심", value: formatInt(analysis?.bollinger?.mid.map(Double.init)), subtitle: bbPosition(analysis?.bollinger?.position))
                KPICard(title: "거래량비", value: volRatioText(analysis?.volume?.ratio), subtitle: "20일 평균 대비")
                KPICard(title: "52주 고가", value: formatInt(quote?.w52High.map(Double.init)), subtitle: nil)
                KPICard(title: "52주 저가", value: formatInt(quote?.w52Low.map(Double.init)), subtitle: w52Pos(analysis?.week52?.position))
            }

            if let signals = analysis?.signals, !signals.isEmpty {
                Text("시그널")
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                FlowTagView(tags: signals)
            }

            if let summary = analysis?.summary {
                Text(summary)
                    .font(.paperlogy(13))
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineSpacing(4)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func formatNum(_ v: Double?) -> String {
        guard let v else { return "-" }
        return String(format: "%.1f", v)
    }

    private func formatInt(_ v: Double?) -> String {
        guard let v else { return "-" }
        return Int(v).formatted(.number.grouping(.automatic))
    }

    private func distText(_ v: Double?) -> String? {
        guard let v else { return nil }
        return String(format: "이격 %.1f%%", v)
    }

    private func bbPosition(_ v: Double?) -> String? {
        guard let v else { return nil }
        return String(format: "밴드내 %.0f%%", v)
    }

    private func volRatioText(_ v: Double?) -> String {
        guard let v else { return "-" }
        return String(format: "%.1fx", v)
    }

    private func w52Pos(_ v: Double?) -> String? {
        guard let v else { return nil }
        return String(format: "위치 %.0f%%", v)
    }

    private func rsiHint(_ rsi: Double?) -> String? {
        guard let rsi else { return nil }
        if rsi >= 70 { return "과매수" }
        if rsi <= 30 { return "과매도" }
        return "중립"
    }
}

struct SignalBadgeView: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.paperlogy(13, weight: .bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var color: Color {
        switch label {
        case "매수": return AppTheme.up
        case "매도": return AppTheme.down
        default: return AppTheme.accent
        }
    }
}

struct KPICard: View {
    let title: String
    let value: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.paperlogy(11, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.paperlogy(16, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            if let subtitle {
                Text(subtitle)
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct FlowTagView: View {
    let tags: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                Text("• \(tag)")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textPrimary)
            }
        }
    }
}
