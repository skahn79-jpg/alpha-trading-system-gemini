import Foundation

/// 개인 전용 위험/기회 알림 4종 — 급락 · 돌파 · 공포탐욕 · 뉴스
enum PersonalAlertKind: String, Codable, CaseIterable, Identifiable {
    case crash
    case breakout
    case fearGreed
    case news

    var id: String { rawValue }

    var label: String {
        switch self {
        case .crash: return "급락"
        case .breakout: return "돌파"
        case .fearGreed: return "공포탐욕"
        case .news: return "뉴스"
        }
    }

    var isOpportunity: Bool {
        self == .breakout
    }
}

enum AlertSeverity: String, Codable, Comparable {
    case low, medium, high

    static func < (lhs: AlertSeverity, rhs: AlertSeverity) -> Bool {
        lhs.rank < rhs.rank
    }

    var rank: Int {
        switch self {
        case .low: return 0
        case .medium: return 1
        case .high: return 2
        }
    }

    var label: String {
        switch self {
        case .low: return "낮음"
        case .medium: return "보통"
        case .high: return "높음"
        }
    }
}

struct PersonalSignal: Identifiable, Codable, Equatable {
    var id: String
    var code: String
    var name: String
    var kind: PersonalAlertKind
    var severity: AlertSeverity
    var title: String
    var detail: String
    var createdAt: TimeInterval
    var opportunity: Bool

    init(
        id: String = UUID().uuidString,
        code: String,
        name: String,
        kind: PersonalAlertKind,
        severity: AlertSeverity,
        title: String,
        detail: String,
        createdAt: TimeInterval = Date().timeIntervalSince1970,
        opportunity: Bool
    ) {
        self.id = id
        self.code = code
        self.name = name
        self.kind = kind
        self.severity = severity
        self.title = title
        self.detail = detail
        self.createdAt = createdAt
        self.opportunity = opportunity
    }

    var cooldownKey: String { "\(code)|\(kind.rawValue)" }
}

enum MarketSignalEngine {
    static let crashMediumPct = -3.0
    static let crashHighPct = -5.0
    static let breakoutBuffer = 0.002
    static let cooldownSeconds: TimeInterval = 4 * 60 * 60

    static func evaluate(
        code: String,
        name: String,
        changeRate: Double?,
        analysis: CandleAnalysis?,
        candles: [ChartCandle] = [],
        lastPrice: Double? = nil,
        newsTitles: [String] = [],
        fearGreedValue: Int? = nil
    ) -> [PersonalSignal] {
        var out: [PersonalSignal] = []
        if let crash = crashSignal(code: code, name: name, changeRate: changeRate, analysis: analysis, candles: candles) {
            out.append(crash)
        }
        if let brk = breakoutSignal(code: code, name: name, analysis: analysis, candles: candles, lastPrice: lastPrice) {
            out.append(brk)
        }
        if let fg = fearGreedSignal(code: code, name: name, analysis: analysis, fearGreedValue: fearGreedValue) {
            out.append(fg)
        }
        if let news = newsSignal(code: code, name: name, titles: newsTitles) {
            out.append(news)
        }
        if let div = divergenceSignal(code: code, name: name, analysis: analysis) {
            out.append(div)
        }
        return out
    }

    static func crashSignal(
        code: String,
        name: String,
        changeRate: Double?,
        analysis: CandleAnalysis?,
        candles: [ChartCandle]
    ) -> PersonalSignal? {
        let rate = changeRate ?? 0
        let atrPct = analysis?.atr?.pct ?? atrPercent(candles)
        let drawdown = analysis?.drawdown?.pct ?? 0
        let pctB = analysis?.bollinger?.position ?? percentB(
            close: candles.last?.close ?? 0,
            upper: analysis?.bollinger?.upper,
            lower: analysis?.bollinger?.lower
        )
        var severity: AlertSeverity?
        if rate <= crashHighPct || (atrPct > 0 && rate <= -(atrPct * 2)) || drawdown >= 12 {
            severity = .high
        } else if rate <= crashMediumPct || drawdown >= 8 {
            severity = .medium
        }
        if severity != nil, let pctB, pctB <= 0 {
            severity = .high
        }
        guard let severity else { return nil }
        var extra = ""
        if atrPct > 0 { extra += String(format: " · ATR %.1f%%", atrPct) }
        if drawdown > 0 { extra += String(format: " · 고점대비 -%.1f%%", drawdown) }
        if let pctB { extra += String(format: " · %%B %.2f", pctB) }
        return PersonalSignal(
            code: code,
            name: name,
            kind: .crash,
            severity: severity,
            title: "\(name) 급락",
            detail: String(format: "등락률 %.1f%%%@", rate, extra),
            opportunity: false
        )
    }

    static func breakoutSignal(
        code: String,
        name: String,
        analysis: CandleAnalysis?,
        candles: [ChartCandle],
        lastPrice: Double? = nil
    ) -> PersonalSignal? {
        let close = lastPrice ?? candles.last?.close
        guard let close, close > 0 else { return nil }
        let lookback = Array(candles.suffix(21).dropLast())
        let recentHigh = lookback.map(\.high).max() ?? analysis?.supportResistance?.resistance ?? analysis?.week52?.high
        guard let recentHigh, recentHigh > 0, close >= recentHigh * (1 + breakoutBuffer) else { return nil }
        let avgVol = lookback.map(\.volume).reduce(0, +) / Double(max(1, lookback.count))
        let lastVol = candles.last?.volume ?? 0
        let volOk = lastVol <= 0 || avgVol <= 0 || lastVol >= avgVol * 1.2
        return PersonalSignal(
            code: code,
            name: name,
            kind: .breakout,
            severity: volOk ? .high : .medium,
            title: "\(name) 돌파",
            detail: String(format: "종가 %@가 최근 고점 %@를 상향 돌파", formatPrice(close), formatPrice(recentHigh)),
            opportunity: true
        )
    }

    static func fearGreedSignal(
        code: String,
        name: String,
        analysis: CandleAnalysis?,
        fearGreedValue: Int?
    ) -> PersonalSignal? {
        if let rsi = analysis?.rsi {
            if rsi <= 30 {
                return PersonalSignal(code: code, name: name, kind: .fearGreed, severity: rsi <= 25 ? .high : .medium, title: "\(name) 공포(RSI)", detail: String(format: "RSI %.1f 과매도 — 기회 관찰", rsi), opportunity: true)
            }
            if rsi >= 70 {
                return PersonalSignal(code: code, name: name, kind: .fearGreed, severity: rsi >= 80 ? .high : .medium, title: "\(name) 탐욕(RSI)", detail: String(format: "RSI %.1f 과매수 — 위험 관찰", rsi), opportunity: false)
            }
        }
        if analysis?.vixFix?.spike == true {
            return PersonalSignal(code: code, name: name, kind: .fearGreed, severity: .high, title: "\(name) 공포 스파이크", detail: "VixFix 스파이크 — 역발상 관찰", opportunity: true)
        }
        if let fg = fearGreedValue {
            if fg <= 20 {
                return PersonalSignal(code: code, name: name, kind: .fearGreed, severity: .high, title: "시장 극단적 공포", detail: "공포탐욕 \(fg) — 분할 관찰", opportunity: true)
            }
            if fg >= 80 {
                return PersonalSignal(code: code, name: name, kind: .fearGreed, severity: .high, title: "시장 극단적 탐욕", detail: "공포탐욕 \(fg) — 과열 위험", opportunity: false)
            }
        }
        return nil
    }

    static func newsSignal(code: String, name: String, titles: [String]) -> PersonalSignal? {
        let riskWords = ["급락", "적자", "수사", "리콜", "제재", "감소", "하향", "위험"]
        let oppWords = ["수주", "실적", "돌파", "승인", "계약", "흑자", "상향", "급등"]
        let hits = titles.filter { title in
            title.localizedCaseInsensitiveContains(name) || title.contains(code)
        }
        guard !hits.isEmpty else { return nil }
        let risk = hits.contains { t in riskWords.contains { t.contains($0) } }
        let opp = hits.contains { t in oppWords.contains { t.contains($0) } }
        if !risk && !opp { return nil }
        return PersonalSignal(
            code: code,
            name: name,
            kind: .news,
            severity: risk ? .high : .medium,
            title: "\(name) 뉴스",
            detail: hits[0],
            opportunity: opp && !risk
        )
    }

    /// RSI/가격 다이버전스 — 4종 분류상 공포탐욕(국면)으로 노출.
    static func divergenceSignal(code: String, name: String, analysis: CandleAnalysis?) -> PersonalSignal? {
        if let bull = analysis?.divergence?.bullish {
            let indicators = bull.indicators.joined(separator: "/")
            return PersonalSignal(
                code: code,
                name: name,
                kind: .fearGreed,
                severity: .high,
                title: "\(name) 강세 다이버전스",
                detail: "\(indicators) \(bull.barsAgo)봉 전 — 하락 속 지표 회복, 기회 관찰",
                opportunity: true
            )
        }
        if let bear = analysis?.divergence?.bearish {
            let indicators = bear.indicators.joined(separator: "/")
            return PersonalSignal(
                code: code,
                name: name,
                kind: .fearGreed,
                severity: .high,
                title: "\(name) 약세 다이버전스",
                detail: "\(indicators) \(bear.barsAgo)봉 전 — 상승 속 지표 약화, 위험 관찰",
                opportunity: false
            )
        }
        return nil
    }

    static func multiTimeframeSummary(candles: [ChartCandle]) -> String? {
        guard candles.count >= 20, let last = candles.last else { return nil }
        func sma(_ period: Int) -> Double? {
            guard candles.count >= period else { return nil }
            let window = candles.suffix(period)
            return window.map(\.close).reduce(0, +) / Double(period)
        }
        var parts: [String] = []
        if let ma20 = sma(20) {
            parts.append(last.close >= ma20 ? "일봉 MA20 위" : "일봉 MA20 아래")
        }
        if let ma60 = sma(60) {
            parts.append(last.close >= ma60 ? "중기 MA60 위" : "중기 MA60 아래")
        } else if candles.count >= 40, let ma40 = sma(40) {
            parts.append(last.close >= ma40 ? "중기선 위" : "중기선 아래")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func atrPercent(_ candles: [ChartCandle]) -> Double {
        guard candles.count >= 2, let last = candles.last, last.close > 0 else { return 0 }
        let window = Array(candles.suffix(15))
        var trs: [Double] = []
        for i in 1..<window.count {
            let prev = window[i - 1].close
            let c = window[i]
            trs.append(max(c.high - c.low, abs(c.high - prev), abs(c.low - prev)))
        }
        guard !trs.isEmpty else { return 0 }
        return ((trs.reduce(0, +) / Double(trs.count)) / last.close) * 100
    }

    static func percentB(close: Double, upper: Double?, lower: Double?) -> Double? {
        guard let upper, let lower, upper > lower else { return nil }
        return (close - lower) / (upper - lower)
    }

    static func volumePOC(candles: [ChartCandle], bins: Int = 16) -> Double? {
        guard candles.count >= 8 else { return nil }
        let lo = candles.map(\.low).min() ?? 0
        let hi = candles.map(\.high).max() ?? 0
        guard hi > lo else { return nil }
        let step = (hi - lo) / Double(bins)
        var vols = Array(repeating: 0.0, count: bins)
        for c in candles {
            let tp = (c.high + c.low + c.close) / 3
            var idx = Int((tp - lo) / step)
            if idx >= bins { idx = bins - 1 }
            if idx < 0 { idx = 0 }
            vols[idx] += c.volume
        }
        guard let best = vols.enumerated().max(by: { $0.element < $1.element }) else { return nil }
        return lo + (Double(best.offset) + 0.5) * step
    }

    static func openingGap(candles: [ChartCandle]) -> (prevClose: Double, open: Double, pct: Double)? {
        guard candles.count >= 2 else { return nil }
        let prev = candles[candles.count - 2].close
        let open = candles[candles.count - 1].open
        guard prev > 0 else { return nil }
        let pct = ((open - prev) / prev) * 100
        guard abs(pct) >= 1 else { return nil }
        return (prev, open, pct)
    }

    static func formatPrice(_ value: Double) -> String {
        if value >= 100 { return String(Int(value.rounded())) }
        return String(format: "%.2f", value)
    }
}

struct GogoPivot: Equatable, Identifiable {
    var index: Int
    var price: Double
    var date: String
    var id: String { "\(index)-\(date)-\(price)" }
}

struct GogoZoneResult: Equatable {
    var highLow: Double
    var highHigh: Double
    var lowLow: Double
    var lowHigh: Double
    var highDates: [String]
    var lowDates: [String]
    var comment: String
    var swingHighs: [GogoPivot]
    var swingLows: [GogoPivot]
    var trendHigh1: GogoPivot?
    var trendHigh2: GogoPivot?
    var trendLinePrice: Double?
    var isBreakout: Bool

    var highBand: ClosedRange<Double> { min(highLow, highHigh)...max(highLow, highHigh) }
    var lowBand: ClosedRange<Double> { min(lowLow, lowHigh)...max(lowLow, lowHigh) }
}

enum GogoZoneDetector {
    static func detect(candles: [ChartCandle]) -> GogoZoneResult? {
        guard candles.count >= 12 else { return nil }
        var highs: [GogoPivot] = []
        var lows: [GogoPivot] = []
        for i in 2..<(candles.count - 2) {
            let c = candles[i]
            if c.high >= candles[i - 1].high && c.high >= candles[i - 2].high &&
                c.high >= candles[i + 1].high && c.high >= candles[i + 2].high {
                highs.append(GogoPivot(index: i, price: c.high, date: c.date))
            }
            if c.low <= candles[i - 1].low && c.low <= candles[i - 2].low &&
                c.low <= candles[i + 1].low && c.low <= candles[i + 2].low {
                lows.append(GogoPivot(index: i, price: c.low, date: c.date))
            }
        }
        let recentHighs = Array(highs.suffix(3))
        let recentLows = Array(lows.suffix(3))
        guard let hiPrices = nonEmpty(recentHighs.map(\.price)), let loPrices = nonEmpty(recentLows.map(\.price)) else { return nil }
        let highLo = hiPrices.min()!
        let highHi = hiPrices.max()!
        let lowLo = loPrices.min()!
        let lowHi = loPrices.max()!
        let declining = recentHighs.count >= 2 && recentHighs[recentHighs.count - 1].price < recentHighs[0].price
        let risingLows = recentLows.count >= 2 && recentLows[recentLows.count - 1].price > recentLows[0].price
        let pair = decliningPair(highs: highs, minGaps: [10, 5, 3])
        var trendPrice: Double?
        var isBreakout = false
        if let pair {
            let span = Double(pair.1.index - pair.0.index)
            if span > 0, let last = candles.last {
                let slope = (pair.1.price - pair.0.price) / span
                trendPrice = pair.0.price + slope * Double(candles.count - 1 - pair.0.index)
                isBreakout = last.close > trendPrice!
            }
        }
        var comment = "고점대 \(MarketSignalEngine.formatPrice(highLo))~\(MarketSignalEngine.formatPrice(highHi)), 저점대 \(MarketSignalEngine.formatPrice(lowLo))~\(MarketSignalEngine.formatPrice(lowHi))."
        if declining && risingLows { comment += " 고점은 낮아지고 저점은 높아지는 고고저 수렴." }
        else if declining { comment += " 하락 고점 구조 — 추세선 아래 압력." }
        else if risingLows { comment += " 상승 저점 구조 — 지지가 우상향." }
        if let trendPrice {
            comment += isBreakout
                ? " 종가가 고고저 추세선(\(MarketSignalEngine.formatPrice(trendPrice))) 위 — 돌파."
                : " 종가가 고고저 추세선(\(MarketSignalEngine.formatPrice(trendPrice))) 아래 — 감시."
        }
        return GogoZoneResult(
            highLow: highLo,
            highHigh: highHi,
            lowLow: lowLo,
            lowHigh: lowHi,
            highDates: recentHighs.map(\.date),
            lowDates: recentLows.map(\.date),
            comment: comment,
            swingHighs: recentHighs,
            swingLows: recentLows,
            trendHigh1: pair?.0,
            trendHigh2: pair?.1,
            trendLinePrice: trendPrice,
            isBreakout: isBreakout
        )
    }

    private static func nonEmpty(_ values: [Double]) -> [Double]? {
        values.isEmpty ? nil : values
    }

    /// 높은 고점①과 이후 낮은 고점② (참고 차트 고고저 추세선)
    private static func decliningPair(highs: [GogoPivot], minGaps: [Int]) -> (GogoPivot, GogoPivot)? {
        guard highs.count >= 2 else { return nil }
        for gap in minGaps {
            for i in stride(from: highs.count - 2, through: 0, by: -1) {
                for j in stride(from: highs.count - 1, to: i, by: -1) {
                    let h1 = highs[i]
                    let h2 = highs[j]
                    if h1.price > h2.price && h2.index - h1.index >= gap {
                        return (h1, h2)
                    }
                }
            }
        }
        return nil
    }
}
