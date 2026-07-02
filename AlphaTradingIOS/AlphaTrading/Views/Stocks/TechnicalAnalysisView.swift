import SwiftUI

struct TechnicalAnalysisView: View {
    let analysis: CandleAnalysis?
    let quote: FullQuote?
    var prediction: AIPrediction? = nil

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

            if let prediction {
                AIPredictionCard(prediction: prediction)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                KPICard(title: "RSI(14)", value: formatNum(analysis?.rsi), subtitle: rsiHint(analysis?.rsi))
                KPICard(title: "MA20", value: formatInt(analysis?.movingAverages?.ma20), subtitle: distText(analysis?.distance?.ma20))
                KPICard(title: "MA60", value: formatInt(analysis?.movingAverages?.ma60), subtitle: distText(analysis?.distance?.ma60))
                KPICard(title: "MA120", value: formatInt(analysis?.movingAverages?.ma120), subtitle: nil)
                KPICard(title: "볼린저 중심", value: formatInt(analysis?.bollinger?.mid.map(Double.init)), subtitle: bbPosition(analysis?.bollinger?.position))
                KPICard(title: "거래량비", value: volRatioText(analysis?.volume?.ratio), subtitle: "20일 평균 대비")
                KPICard(title: "MACD", value: macdValue, subtitle: macdHint)
                KPICard(title: "스토캐스틱 %K", value: formatNum(analysis?.stochastic?.k), subtitle: stochHint)
                KPICard(title: "지지선", value: formatInt(analysis?.supportResistance?.support), subtitle: srDist(analysis?.supportResistance?.supportDist, prefix: "이격"))
                KPICard(title: "저항선", value: formatInt(analysis?.supportResistance?.resistance), subtitle: srDist(analysis?.supportResistance?.resistanceDist, prefix: "여력"))
                KPICard(title: "52주 고가", value: formatInt(quote?.w52High.map(Double.init)), subtitle: nil)
                KPICard(title: "52주 저가", value: formatInt(quote?.w52Low.map(Double.init)), subtitle: w52Pos(analysis?.week52?.position))
            }

            if let patterns = analysis?.patterns, !patterns.isEmpty {
                Text("캔들 패턴")
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                ForEach(patterns) { pattern in
                    HStack(spacing: 8) {
                        Text(pattern.name)
                            .font(.paperlogy(12, weight: .bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(patternColor(pattern.type).opacity(0.2))
                            .foregroundStyle(patternColor(pattern.type))
                            .clipShape(Capsule())
                        if let note = pattern.note {
                            Text(note)
                                .font(.paperlogy(11))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        Spacer()
                    }
                }
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

    private var macdValue: String {
        guard let h = analysis?.macd?.histogram else { return "-" }
        return String(format: "%+.1f", h)
    }

    private var macdHint: String? {
        switch analysis?.macd?.cross {
        case "golden": return "골든크로스"
        case "dead": return "데드크로스"
        default:
            switch analysis?.macd?.trend {
            case "bullish": return "상승 흐름"
            case "bearish": return "하락 흐름"
            default: return nil
            }
        }
    }

    private var stochHint: String? {
        switch analysis?.stochastic?.status {
        case "oversold": return "과매도"
        case "overbought": return "과매수"
        case "neutral": return "중립"
        default: return nil
        }
    }

    private func srDist(_ v: Double?, prefix: String) -> String? {
        guard let v else { return nil }
        return String(format: "%@ %.1f%%", prefix, v)
    }

    private func patternColor(_ type: String?) -> Color {
        switch type {
        case "bullish": return AppTheme.up
        case "bearish": return AppTheme.down
        default: return AppTheme.accent
        }
    }
}

/// AI 온라인 학습 예측 카드 — 상승/하락 확률 + 판단 근거
struct AIPredictionCard: View {
    let prediction: AIPrediction

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "brain.head.profile")
                    .foregroundStyle(AppTheme.accent)
                Text("AI 예측 (\(prediction.horizonDays ?? 7)일)")
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text("신뢰도 \(prediction.confidenceLabel)")
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(prediction.isUp ? "상승" : "하락")
                    .font(.paperlogy(20, weight: .bold))
                    .foregroundStyle(prediction.isUp ? AppTheme.up : AppTheme.down)
                Text(String(format: "%.1f%%", prediction.isUp ? prediction.probUp : (prediction.probDown ?? 100 - prediction.probUp)))
                    .font(.paperlogy(20, weight: .bold))
                    .foregroundStyle(prediction.isUp ? AppTheme.up : AppTheme.down)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.down.opacity(0.3))
                    Capsule()
                        .fill(AppTheme.up)
                        .frame(width: geo.size.width * prediction.probUp / 100)
                }
            }
            .frame(height: 6)

            if let factors = prediction.topFactors, !factors.isEmpty {
                Text("주요 요인: " + factors.prefix(3).map { "\($0.label)\($0.impact >= 0 ? "↑" : "↓")" }.joined(separator: " · "))
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            HStack {
                if let model = prediction.model, let trained = model.trained, trained > 0 {
                    Text("학습 \(trained)회\(model.accuracy.map { String(format: " · 적중률 %.0f%%", $0) } ?? "")")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    Text("학습 초기 단계 — 사용할수록 정확도가 개선됩니다")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Spacer()
            }

            Text("참고용 통계 모델 예측이며 투자 권유가 아닙니다.")
                .font(.paperlogy(9))
                .foregroundStyle(AppTheme.textSecondary.opacity(0.7))
        }
        .padding(12)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 10))
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
