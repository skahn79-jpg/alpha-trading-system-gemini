import SwiftUI

struct TechnicalAnalysisView: View {
    let analysis: CandleAnalysis?
    let quote: FullQuote?
    var prediction: AIPrediction? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // 1. 종합 게이지 카드 (점수 + 등급 + 시그널 배지)
            if let analysis, analysis.score != nil {
                ScoreGaugeCard(analysis: analysis)
            }

            if let prediction {
                AIPredictionCard(prediction: prediction)
            }

            // 2. 모멘텀 미터 (RSI · 스토캐스틱 · MFI)
            if analysis?.rsi != nil || analysis?.stochastic?.k != nil || analysis?.mfi?.value != nil {
                VStack(alignment: .leading, spacing: 12) {
                    Text("모멘텀")
                        .font(.paperlogy(15, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    if let rsi = analysis?.rsi {
                        MeterBar(title: "RSI(14)", value: rsi, hint: rsiHint(rsi))
                    }
                    if let k = analysis?.stochastic?.k {
                        MeterBar(title: "스토캐스틱 %K", value: k, hint: stochHint)
                    }
                    if let mfi = analysis?.mfi?.value {
                        MeterBar(title: "MFI(14)", value: mfi, hint: mfiHint)
                    }
                }
                .padding(12)
                .background(Color.black.opacity(0.2))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // 3. 인간지표 — 고점 대비 낙폭 구간 바
            if let dd = analysis?.drawdown {
                DrawdownZoneBar(drawdown: dd)
            }

            // 4. 골든크로스 상태 필
            if let gc = analysis?.goldenCross {
                GoldenCrossPill(data: gc)
            }

            // 5. 시그널 칩 클라우드
            if let signals = analysis?.signals, !signals.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("시그널")
                        .font(.paperlogy(15, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    SignalChipCloud(signals: signals)
                }
            }

            // 6. 나머지 지표 카드 그리드 (RSI·스토캐 %K·MFI는 미터 바로 대체)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                KPICard(title: "MA20", value: formatInt(analysis?.movingAverages?.ma20), subtitle: distText(analysis?.distance?.ma20))
                KPICard(title: "MA60", value: formatInt(analysis?.movingAverages?.ma60), subtitle: distText(analysis?.distance?.ma60))
                KPICard(title: "MA120", value: formatInt(analysis?.movingAverages?.ma120), subtitle: nil)
                KPICard(title: "볼린저 중심", value: formatInt(analysis?.bollinger?.mid), subtitle: bbPosition(analysis?.bollinger?.position))
                KPICard(title: "거래량비", value: volRatioText(analysis?.volume?.ratio), subtitle: "20일 평균 대비")
                KPICard(title: "MACD", value: macdValue, subtitle: macdHint)
                KPICard(title: "지지선", value: formatInt(analysis?.supportResistance?.support), subtitle: srDist(analysis?.supportResistance?.supportDist, prefix: "이격"))
                KPICard(title: "저항선", value: formatInt(analysis?.supportResistance?.resistance), subtitle: srDist(analysis?.supportResistance?.resistanceDist, prefix: "여력"))
                KPICard(title: "일목균형", value: analysis?.ichimoku?.statusLabel ?? "-", subtitle: ichimokuHint)
                KPICard(title: "ADX 추세강도", value: formatNum(analysis?.adx?.adx), subtitle: adxHint)
                KPICard(title: "OBV 자금흐름", value: analysis?.obv?.trendLabel ?? "-", subtitle: obvHint)
                KPICard(title: "ATR 변동성", value: atrValue, subtitle: atrHint)
                KPICard(title: "피보나치", value: fibValue, subtitle: fibHint)
                KPICard(title: "SuperTrend", value: supertrendValue, subtitle: supertrendHint)
                KPICard(title: "스토캐스틱 슬로우", value: formatNum(analysis?.stochasticSlow?.k), subtitle: stochSlowHint)
                KPICard(title: "Mayer 배율", value: mayerValue, subtitle: analysis?.mayer?.zoneLabel)
                KPICard(title: "VixFix 공포", value: formatNum(analysis?.vixFix?.value), subtitle: vixFixHint)
                KPICard(title: "EWO 모멘텀", value: ewoValue, subtitle: ewoHint)
                KPICard(title: "20일선 기울기", value: slopeValue, subtitle: slopeHint)
                KPICard(title: "미너비니", value: minerviniValue, subtitle: analysis?.minervini?.verdictLabel)
                KPICard(title: "다이버전스", value: divergenceValue, subtitle: divergenceHint)
                KPICard(title: "스토캐스틱 히트맵", value: heatmapValue, subtitle: analysis?.stochHeatmap?.zoneLabel)
                KPICard(title: "고통지수", value: painValue, subtitle: painHint)
                KPICard(title: "Bull&Bear 파동", value: bbpValue, subtitle: analysis?.bullBearPower?.zoneLabel)
                KPICard(title: "52주 고가", value: formatInt(quote?.w52High), subtitle: nil)
                KPICard(title: "52주 저가", value: formatInt(quote?.w52Low), subtitle: w52Pos(analysis?.week52?.position))
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

    private var ichimokuHint: String? {
        switch analysis?.ichimoku?.tkCross {
        case "bullish": return "전환>기준"
        case "bearish": return "전환<기준"
        default: return nil
        }
    }

    private var adxHint: String? {
        guard let adx = analysis?.adx else { return nil }
        let dir = adx.direction == "up" ? "상승" : adx.direction == "down" ? "하락" : "중립"
        return "\(adx.strengthLabel) · \(dir)"
    }

    private var obvHint: String? {
        guard let lookback = analysis?.obv?.lookback else { return nil }
        return "\(lookback)일 기준"
    }

    private var atrValue: String {
        guard let pct = analysis?.atr?.pct else { return "-" }
        return String(format: "%.1f%%", pct)
    }

    private var atrHint: String? {
        guard let pct = analysis?.atr?.pct else { return nil }
        if pct >= 5 { return "변동성 높음" }
        if pct >= 3 { return "변동성 중간" }
        return "변동성 낮음"
    }

    private var fibValue: String {
        guard let n = analysis?.fibonacci?.nearest else { return "-" }
        return String(format: "%.1f%%", n.ratio * 100)
    }

    private var fibHint: String? {
        guard let n = analysis?.fibonacci?.nearest else { return nil }
        return String(format: "레벨 %@ (이격 %.1f%%)", Int(n.price).formatted(.number.grouping(.automatic)), n.dist)
    }

    private var supertrendValue: String {
        switch analysis?.supertrend?.direction {
        case "up": return "상승"
        case "down": return "하락"
        default: return "-"
        }
    }

    private var supertrendHint: String? {
        guard let st = analysis?.supertrend else { return nil }
        if st.flipped == true { return "추세 전환!" }
        guard let line = st.line else { return nil }
        return "기준선 \(Int(line).formatted(.number.grouping(.automatic)))"
    }

    private var stochSlowHint: String? {
        guard let s = analysis?.stochasticSlow else { return nil }
        if s.inWell == true { return "우물 진입 (바닥권)" }
        switch s.status {
        case "overbought": return "과매수"
        case "oversold": return "과매도"
        default: return "20/12/6 설정"
        }
    }

    private var mayerValue: String {
        guard let m = analysis?.mayer?.multiple else { return "-" }
        return String(format: "%.2f", m)
    }

    private var vixFixHint: String? {
        guard let v = analysis?.vixFix else { return nil }
        return v.spike == true ? "공포 스파이크 (기회 후보)" : "정상 범위"
    }

    private var mfiHint: String? {
        switch analysis?.mfi?.status {
        case "oversold": return "과매도 (유입 대기)"
        case "overbought": return "과매수"
        default: return "자금 흐름 중립"
        }
    }

    private var ewoValue: String {
        guard let pct = analysis?.ewo?.pct else { return "-" }
        return String(format: "%+.1f%%", pct)
    }

    private var ewoHint: String? {
        switch analysis?.ewo?.trend {
        case "bullish": return "상승 모멘텀"
        case "bearish": return "하락 모멘텀"
        default: return nil
        }
    }

    private var slopeValue: String {
        guard let angle = analysis?.maSlope?.angle else { return "-" }
        return String(format: "%+.0f°", angle)
    }

    private var slopeHint: String? {
        switch analysis?.maSlope?.trend {
        case "rising": return "우상향"
        case "falling": return "우하향"
        default: return "횡보"
        }
    }

    private var minerviniValue: String {
        guard let m = analysis?.minervini, let p = m.passed, let t = m.total else { return "-" }
        return "\(p)/\(t)"
    }

    private var divergenceValue: String {
        if analysis?.divergence?.bullish != nil { return "강세" }
        if analysis?.divergence?.bearish != nil { return "약세" }
        return "없음"
    }

    private var divergenceHint: String? {
        if let bull = analysis?.divergence?.bullish {
            return "\(bull.indicators.joined(separator: "·")) · \(bull.barsAgo)봉 전"
        }
        if let bear = analysis?.divergence?.bearish {
            return "\(bear.indicators.joined(separator: "·")) · \(bear.barsAgo)봉 전"
        }
        return "가격·지표 불일치 미검출"
    }

    private var heatmapValue: String {
        guard let h = analysis?.stochHeatmap, let b = h.bullCount, let t = h.total else { return "-" }
        return "\(b)/\(t)"
    }

    private var painValue: String {
        guard let loss = analysis?.painMeter?.loss else { return "-" }
        return String(format: "%.1f%%", loss)
    }

    private var painHint: String? {
        guard let p = analysis?.painMeter else { return nil }
        return p.bullDiv == true ? "바닥 다이버전스!" : "50봉 고점 대비 하락폭"
    }

    private var bbpValue: String {
        guard let v = analysis?.bullBearPower?.value else { return "-" }
        return String(format: "%.1f", v)
    }
}

// MARK: - 점수/등급별 색상 헬퍼

private func scoreColor(_ score: Int) -> Color {
    if score >= 65 { return AppTheme.up }
    if score >= 50 { return Color(red: 1.0, green: 0.82, blue: 0.25) }
    return AppTheme.down
}

// MARK: - 1. 종합 원형 게이지 카드

private struct ScoreGaugeCard: View {
    let analysis: CandleAnalysis
    @State private var progress: CGFloat = 0

    private var score: Int { analysis.score ?? 0 }
    private var color: Color { scoreColor(score) }

    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.08), style: StrokeStyle(lineWidth: 10, lineCap: .round))
                Circle()
                    .trim(from: 0, to: progress * CGFloat(min(max(score, 0), 100)) / 100)
                    .stroke(
                        AngularGradient(
                            colors: [color.opacity(0.5), color],
                            center: .center,
                            startAngle: .degrees(0),
                            endAngle: .degrees(360.0 * Double(score) / 100)
                        ),
                        style: StrokeStyle(lineWidth: 10, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("\(score)")
                        .font(.paperlogy(30, weight: .bold))
                        .foregroundStyle(color)
                    Text("점")
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .frame(width: 96, height: 96)

            VStack(alignment: .leading, spacing: 8) {
                if let badge = analysis.signalBadge {
                    SignalBadgeView(label: badge)
                }
                HStack(spacing: 6) {
                    if let grade = analysis.grade {
                        Text(grade)
                            .font(.paperlogy(18, weight: .bold))
                            .foregroundStyle(color)
                            .frame(width: 34, height: 34)
                            .background(color.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Text("종합 등급")
                            .font(.paperlogy(12))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                Text(scoreCaption)
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.black.opacity(0.2))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(color.opacity(0.25), lineWidth: 1)
        )
        .onAppear {
            withAnimation(.easeOut(duration: 0.9)) {
                progress = 1
            }
        }
    }

    private var scoreCaption: String {
        if score >= 65 { return "기술적 흐름 우호적" }
        if score >= 50 { return "기술적 흐름 중립" }
        return "기술적 흐름 약세"
    }
}

// MARK: - 2. 모멘텀 미터 바 (0~100 게이지 + 과매도/중립/과매수 음영)

private struct MeterBar: View {
    let title: String
    let value: Double
    let hint: String?

    private var clamped: Double { min(max(value, 0), 100) }

    private var markerColor: Color {
        if clamped <= 30 { return AppTheme.up }
        if clamped >= 70 { return AppTheme.down }
        return AppTheme.textPrimary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title)
                    .font(.paperlogy(12, weight: .medium))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                if let hint {
                    Text(hint)
                        .font(.paperlogy(11))
                        .foregroundStyle(markerColor.opacity(0.9))
                }
                Text(String(format: "%.1f", value))
                    .font(.paperlogy(13, weight: .bold))
                    .foregroundStyle(markerColor)
            }

            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    // 구간 음영: 과매도(0~30) 초록 · 중립(30~70) 회색 · 과매수(70~100) 빨강
                    HStack(spacing: 0) {
                        AppTheme.up.opacity(0.28)
                            .frame(width: w * 0.3)
                        Color.white.opacity(0.10)
                            .frame(width: w * 0.4)
                        AppTheme.down.opacity(0.28)
                            .frame(width: w * 0.3)
                    }
                    .clipShape(Capsule())

                    // 현재값 노브
                    Circle()
                        .fill(markerColor)
                        .frame(width: 14, height: 14)
                        .overlay(Circle().stroke(Color.black.opacity(0.35), lineWidth: 2))
                        .offset(x: w * CGFloat(clamped / 100) - 7)
                }
            }
            .frame(height: 14)

            HStack {
                Text("과매도")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.up.opacity(0.7))
                Spacer()
                Text("중립")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.textSecondary.opacity(0.6))
                Spacer()
                Text("과매수")
                    .font(.paperlogy(9))
                    .foregroundStyle(AppTheme.down.opacity(0.7))
            }
        }
    }
}

// MARK: - 3. 인간지표 (고점 대비 낙폭) 구간 바

private struct DrawdownZoneBar: View {
    let drawdown: DrawdownData

    /// 낙폭 0% → 0.0, -50% 이상 → 1.0
    private var fraction: CGFloat {
        CGFloat(min(abs(drawdown.pct) / 50.0, 1.0))
    }

    private var markerColor: Color {
        switch drawdown.zone {
        case "bottom", "capitulation": return AppTheme.up
        case "near_bottom": return Color(red: 1.0, green: 0.82, blue: 0.25)
        default: return AppTheme.textPrimary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("인간지표 (고점 대비)")
                    .font(.paperlogy(12, weight: .medium))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                Text(String(format: "%.1f%%", drawdown.pct))
                    .font(.paperlogy(14, weight: .bold))
                    .foregroundStyle(markerColor)
            }

            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.25),
                            Color(red: 1.0, green: 0.82, blue: 0.25).opacity(0.45),
                            AppTheme.down.opacity(0.55),
                            AppTheme.up.opacity(0.6)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .clipShape(Capsule())

                    // 구간 눈금
                    HStack(spacing: 0) {
                        ForEach(1..<5) { _ in
                            Spacer()
                            Rectangle()
                                .fill(Color.black.opacity(0.35))
                                .frame(width: 1)
                        }
                        Spacer()
                    }

                    Circle()
                        .fill(markerColor)
                        .frame(width: 14, height: 14)
                        .overlay(Circle().stroke(Color.black.opacity(0.35), lineWidth: 2))
                        .offset(x: w * fraction - 7)
                }
            }
            .frame(height: 14)

            HStack(spacing: 0) {
                ForEach(["고점권", "조정", "저점접근", "저점", "투매"], id: \.self) { zone in
                    Text(zone)
                        .font(.paperlogy(9))
                        .foregroundStyle(AppTheme.textSecondary.opacity(0.7))
                        .frame(maxWidth: .infinity)
                }
            }

            Text(drawdown.label)
                .font(.paperlogy(11))
                .foregroundStyle(markerColor.opacity(0.9))
        }
        .padding(12)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - 4. 골든크로스 상태 필

private struct GoldenCrossPill: View {
    let data: GoldenCrossData

    private var isStrong: Bool { data.recentCross == "golden" || data.recentCross == "dead" }

    private var color: Color {
        if data.recentCross == "golden" { return AppTheme.up }
        if data.recentCross == "dead" { return AppTheme.down }
        return data.state == "above" ? AppTheme.up : AppTheme.down
    }

    private var titleText: String {
        if data.recentCross == "golden" { return "🌟 골든크로스 발생" }
        if data.recentCross == "dead" { return "⚠️ 데드크로스 발생" }
        return data.state == "above" ? "장기 상승 구조 (50일선 > 200일선)" : "장기 하락 구조 (50일선 < 200일선)"
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: data.state == "above" ? "arrow.up.right.circle.fill" : "arrow.down.right.circle.fill")
                .font(.system(size: 20))
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 2) {
                Text(titleText)
                    .font(.paperlogy(13, weight: isStrong ? .bold : .semibold))
                    .foregroundStyle(isStrong ? color : AppTheme.textPrimary)
                Text(String(format: "50일선 %@ · 200일선 %@",
                            Int(data.ma50).formatted(.number.grouping(.automatic)),
                            Int(data.ma200).formatted(.number.grouping(.automatic))))
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(color.opacity(isStrong ? 0.18 : 0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(color.opacity(isStrong ? 0.5 : 0.2), lineWidth: 1)
        )
    }
}

// MARK: - 5. 시그널 칩 클라우드

private struct SignalChipCloud: View {
    let signals: [String]

    var body: some View {
        ChipFlowLayout(spacing: 7) {
            ForEach(signals, id: \.self) { signal in
                SignalChip(text: signal)
            }
        }
    }
}

private struct SignalChip: View {
    let text: String

    private static let negativeKeywords = ["하락", "이탈", "과열", "주의", "데드", "약세", "투매", "매도", "과매수"]
    private static let positiveKeywords = ["상승", "골든", "지지", "증가", "강세", "바닥", "과매도", "매수", "돌파", "유입"]

    private var color: Color {
        if Self.negativeKeywords.contains(where: { text.contains($0) }) { return AppTheme.down }
        if Self.positiveKeywords.contains(where: { text.contains($0) }) { return AppTheme.up }
        return AppTheme.textSecondary
    }

    var body: some View {
        Text(text)
            .font(.paperlogy(11, weight: .medium))
            .foregroundStyle(color == AppTheme.textSecondary ? AppTheme.textPrimary.opacity(0.85) : color)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.14))
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 0.5))
    }
}

/// iOS 16 Layout 프로토콜 기반의 간단한 줄바꿈(wrap) 레이아웃
private struct ChipFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            totalWidth = max(totalWidth, x - spacing)
        }
        return CGSize(width: maxWidth.isFinite ? maxWidth : totalWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
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

            if let note = prediction.conflictNote, !note.isEmpty {
                Text("⚠️ \(note)")
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.accent)
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
