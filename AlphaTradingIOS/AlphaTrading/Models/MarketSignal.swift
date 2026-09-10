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

    static func riskSignals(in signals: [PersonalSignal]) -> [PersonalSignal] {
        signals.filter { !$0.opportunity }
    }

    static func opportunitySignals(in signals: [PersonalSignal]) -> [PersonalSignal] {
        signals.filter { $0.opportunity }
    }

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

    var notificationUserInfo: [String: Any] {
        [
            "id": id,
            "code": code,
            "name": name,
            "kind": kind.rawValue,
            "title": title,
            "detail": detail,
            "body": detail,
            "severity": severity.rawValue,
            "opportunity": opportunity ? "1" : "0",
        ]
    }
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
        } else if let local = localDivergenceSignal(code: code, name: name, candles: candles) {
            out.append(local)
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

    static func multiTimeframeSummary(candles: [ChartCandle], weekly: [ChartCandle] = []) -> String? {
        guard candles.count >= 20, let last = candles.last else { return nil }
        func sma(_ rows: [ChartCandle], _ period: Int) -> Double? {
            guard rows.count >= period else { return nil }
            let window = rows.suffix(period)
            return window.map(\.close).reduce(0, +) / Double(period)
        }
        var parts: [String] = []
        if let ma20 = sma(candles, 20) {
            parts.append(last.close >= ma20 ? "일봉 MA20 위" : "일봉 MA20 아래")
        }
        if let ma60 = sma(candles, 60) {
            parts.append(last.close >= ma60 ? "중기 MA60 위" : "중기 MA60 아래")
        } else if candles.count >= 40, let ma40 = sma(candles, 40) {
            parts.append(last.close >= ma40 ? "중기선 위" : "중기선 아래")
        }
        if let week = weeklyContext(candles: weekly) {
            parts.append(week)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func weeklyContext(candles: [ChartCandle]) -> String? {
        guard candles.count >= 20, let last = candles.last else { return nil }
        let ma20 = candles.suffix(20).map(\.close).reduce(0, +) / 20
        return last.close >= ma20 ? "주봉 MA20 위" : "주봉 MA20 아래"
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

    struct VolumeProfileResult: Equatable {
        var poc: Double
        var hvnMids: [Double]
        var abovePct: Int
        var belowPct: Int
        var comment: String
    }

    /// chartlab.js volumeProfile와 같은 구간 거래량 분포 (봉은 과거→현재)
    static func volumeProfile(candles: [ChartCandle], bins: Int = 24) -> VolumeProfileResult? {
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
        let total = vols.reduce(0, +)
        guard total > 0, let best = vols.enumerated().max(by: { $0.element < $1.element }) else { return nil }
        let close = candles.last?.close ?? 0
        var above = 0.0
        var below = 0.0
        var mids: [(Double, Double)] = []
        for (i, vol) in vols.enumerated() {
            let mid = lo + (Double(i) + 0.5) * step
            mids.append((mid, vol))
            if mid > close { above += vol } else { below += vol }
        }
        let poc = lo + (Double(best.offset) + 0.5) * step
        let hvn = mids.sorted { $0.1 > $1.1 }.prefix(3).map(\.0)
        let abovePct = Int((above / total * 100).rounded())
        let belowPct = Int((below / total * 100).rounded())
        let pos: String
        if close > poc { pos = "최대 매물대 위 (하방 지지)" }
        else if close < poc { pos = "최대 매물대 아래 (상방 부담)" }
        else { pos = "최대 매물대 내부" }
        return VolumeProfileResult(
            poc: poc,
            hvnMids: Array(hvn),
            abovePct: abovePct,
            belowPct: belowPct,
            comment: "매물대 POC \(formatPrice(poc)) · \(pos) · 상방 \(abovePct)% / 하방 \(belowPct)%"
        )
    }

    static func volumePOC(candles: [ChartCandle], bins: Int = 16) -> Double? {
        volumeProfile(candles: candles, bins: bins)?.poc
    }

    /// 분석 API가 없을 때 캔들로 RSI↔가격 다이버전스 추정
    static func localDivergenceSignal(code: String, name: String, candles: [ChartCandle]) -> PersonalSignal? {
        guard candles.count >= 24 else { return nil }
        let closes = candles.map(\.close)
        let rsi = rsiWilder(closes, period: 14)
        var lows: [(Int, Double, Double)] = []
        var highs: [(Int, Double, Double)] = []
        for i in 2..<(candles.count - 2) {
            guard let r = rsi[i] else { continue }
            let c = candles[i]
            if c.low <= candles[i - 1].low && c.low <= candles[i - 2].low &&
                c.low <= candles[i + 1].low && c.low <= candles[i + 2].low {
                lows.append((i, c.low, r))
            }
            if c.high >= candles[i - 1].high && c.high >= candles[i - 2].high &&
                c.high >= candles[i + 1].high && c.high >= candles[i + 2].high {
                highs.append((i, c.high, r))
            }
        }
        if lows.count >= 2 {
            let a = lows[lows.count - 2]
            let b = lows[lows.count - 1]
            if b.1 < a.1 && b.2 > a.2 {
                return PersonalSignal(
                    code: code, name: name, kind: .fearGreed, severity: .high,
                    title: "\(name) 강세 다이버전스",
                    detail: "RSI 저점은 높아지는데 가격 저점은 낮아짐 — 기회 관찰",
                    opportunity: true
                )
            }
        }
        if highs.count >= 2 {
            let a = highs[highs.count - 2]
            let b = highs[highs.count - 1]
            if b.1 > a.1 && b.2 < a.2 {
                return PersonalSignal(
                    code: code, name: name, kind: .fearGreed, severity: .high,
                    title: "\(name) 약세 다이버전스",
                    detail: "가격 고점은 높아지는데 RSI 고점은 낮아짐 — 위험 관찰",
                    opportunity: false
                )
            }
        }
        return nil
    }

    static func rsiWilder(_ closes: [Double], period: Int = 14) -> [Double?] {
        var out = Array<Double?>(repeating: nil, count: closes.count)
        guard closes.count > period else { return out }
        var gain = 0.0
        var loss = 0.0
        for i in 1...period {
            let delta = closes[i] - closes[i - 1]
            if delta >= 0 { gain += delta } else { loss -= delta }
        }
        gain /= Double(period)
        loss /= Double(period)
        func value(_ g: Double, _ l: Double) -> Double {
            if l == 0 { return 100 }
            let rs = g / l
            return 100 - (100 / (1 + rs))
        }
        out[period] = value(gain, loss)
        if period + 1 < closes.count {
            for i in (period + 1)..<closes.count {
                let delta = closes[i] - closes[i - 1]
                let g = max(delta, 0)
                let l = max(-delta, 0)
                gain = (gain * Double(period - 1) + g) / Double(period)
                loss = (loss * Double(period - 1) + l) / Double(period)
                out[i] = value(gain, loss)
            }
        }
        return out
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

    /// Dashboard 고고저 돌파: findGoGoJeoTrend + 급경사 제외 + 신규(fresh) + 거래량·양봉·0.3% 돌파.
    static func gogoBreakout(
        code: String,
        name: String,
        candles: [ChartCandle],
        assetType: String? = nil,
        marketGroup: GogoMarketGroup = .kospi
    ) -> GogoBreakoutItem? {
        guard let zones = GogoZoneDetector.detect(candles: candles),
              zones.isRealBreakout,
              let close = candles.last?.close, close > 0 else { return nil }
        var parts: [String] = []
        if !zones.phase.isEmpty { parts.append(zones.phase) }
        if let trend = zones.trendLinePrice {
            parts.append("종가 \(formatPrice(close)) / 추세선 \(formatPrice(trend))")
        }
        if zones.freshBreak { parts.append("신규 돌파") }
        if zones.isVolumeConfirm {
            parts.append(String(format: "거래량 %.1f배", zones.volumeRatio))
        }
        if zones.isBullishCandle { parts.append("양봉") }
        if zones.breakoutRate >= 0.3 {
            parts.append(String(format: "돌파 +%.1f%%", zones.breakoutRate))
        }
        if parts.isEmpty { parts.append(zones.comment) }
        return GogoBreakoutItem(
            code: code,
            name: name,
            assetType: assetType,
            marketGroup: marketGroup,
            close: close,
            highHigh: zones.highHigh,
            trendLinePrice: zones.trendLinePrice,
            detail: parts.joined(separator: " · "),
            brokeTrend: zones.isBreakout,
            freshBreak: zones.freshBreak,
            lowHold: zones.lowHold,
            phase: zones.phase
        )
    }
}

enum GogoMarketGroup: String, CaseIterable, Codable, Identifiable {
    case kospi
    case kosdaq
    case overseas

    var id: String { rawValue }

    var title: String {
        switch self {
        case .kospi: return "코스피"
        case .kosdaq: return "코스닥"
        case .overseas: return "해외"
        }
    }
}

struct GogoBreakoutItem: Identifiable, Equatable, Hashable {
    var id: String { "\(marketGroup.rawValue)-\(code)" }
    var code: String
    var name: String
    var assetType: String?
    var marketGroup: GogoMarketGroup
    var close: Double
    var highHigh: Double
    var trendLinePrice: Double?
    var detail: String
    var brokeTrend: Bool
    var freshBreak: Bool
    var lowHold: Bool
    var phase: String

    var badgeLabel: String {
        if phase == "고고저 신규 돌파" || phase == "돌파 후 유지" { return phase }
        return "돌파"
    }

    var asStock: Stock {
        let type: String?
        if let assetType {
            type = assetType
        } else if marketGroup == .overseas {
            type = "us"
        } else {
            type = nil
        }
        return Stock(code: code, name: name, assetType: type)
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
    var freshBreak: Bool
    var lowHold: Bool
    var isBreakoutFailure: Bool
    var volumeRatio: Double
    var phase: String
    var confirmedBreakout: Bool
    var lowStructure: String
    var lowComment: String
    var trendSlopePer20Bars: Double
    var isTrendTooSteep: Bool
    var breakoutRate: Double
    var isVolumeConfirm: Bool
    var isBullishCandle: Bool
    var isLineSane: Bool
    var isRealBreakout: Bool

    var highBand: ClosedRange<Double> { min(highLow, highHigh)...max(highLow, highHigh) }
    var lowBand: ClosedRange<Double> { min(lowLow, lowHigh)...max(lowLow, lowHigh) }
}

enum GogoZoneDetector {
    /// trading-platform `isTrendTooSteep`: drop% per bar × 20 >= 18 → 급경사 추세선 제외
    static let steepSlopeThreshold = 18.0
    /// calculateGogojeoSignal lookback 120, dashboard prefers 120–180
    static let lookbackBars = 160
    static let volumeConfirmRatio = 1.25
    static let minBreakoutRatePct = 0.3
    static let minTrendBars = 5
    static let lineVsRecentLowFloor = 0.5

    static func trendSlopePer20Bars(p1: GogoPivot, p2: GogoPivot) -> Double {
        guard p1.price > 0 else { return 0 }
        let trendDropRate = ((p1.price - p2.price) / p1.price) * 100
        let trendBars = Double(max(1, p2.index - p1.index))
        return (trendDropRate / trendBars) * 20
    }

    static func isTrendTooSteep(p1: GogoPivot, p2: GogoPivot) -> Bool {
        trendSlopePer20Bars(p1: p1, p2: p2) >= steepSlopeThreshold
    }

    /// Reject collapsed/negative projections (short p1→p2 span falling far below price).
    static func isLineSane(trendNow: Double, candles: [ChartCandle], p1: GogoPivot, p2: GogoPivot) -> Bool {
        guard trendNow > 0 else { return false }
        guard p2.index - p1.index >= minTrendBars else { return false }
        let minLow = candles.suffix(20).map(\.low).min() ?? 0
        guard minLow > 0 else { return true }
        return trendNow >= minLow * lineVsRecentLowFloor
    }

    static func detect(candles: [ChartCandle]) -> GogoZoneResult? {
        let rows = Array(candles.suffix(lookbackBars))
        guard rows.count >= 10 else { return nil }
        let highs = swingPivots(rows, kind: .high)
        let lows = swingPivots(rows, kind: .low)
        let recentHighs = Array(highs.suffix(3))
        let recentLows = Array(lows.suffix(3))
        let trend = findGoGoJeoTrend(rows)
        if recentHighs.isEmpty && trend == nil { return nil }

        let hiPrices = recentHighs.isEmpty ? highs.map(\.price) : recentHighs.map(\.price)
        let loSource: [GogoPivot]
        if recentLows.isEmpty {
            let start = max(0, rows.count - 10)
            loSource = (start..<rows.count).map {
                GogoPivot(index: $0, price: rows[$0].low, date: rows[$0].date)
            }
        } else {
            loSource = recentLows
        }
        guard let highLo = hiPrices.min(), let highHi = hiPrices.max(),
              let lowLo = loSource.map(\.price).min(), let lowHi = loSource.map(\.price).max()
        else { return nil }

        let declining = recentHighs.count >= 2 && recentHighs[recentHighs.count - 1].price < recentHighs[0].price
        let risingLows = recentLows.count >= 2 && recentLows[recentLows.count - 1].price > recentLows[0].price
        let p1 = trend?.0
        let p2 = trend?.1
        let signals: GogoChartSignals? = {
            guard let p1, let p2 else { return nil }
            return chartMethodSignals(candles: rows, p1: p1, p2: p2, swingLows: lows)
        }()
        let trendPrice = signals?.trendLineNow
        let isBreakout = signals?.closeBreak ?? false

        var comment = "고점대 \(MarketSignalEngine.formatPrice(highLo))~\(MarketSignalEngine.formatPrice(highHi)), 저점대 \(MarketSignalEngine.formatPrice(lowLo))~\(MarketSignalEngine.formatPrice(lowHi))."
        if let p1, let p2 {
            comment += " 고점① \(p1.date) → 고점② \(p2.date) (높은 고점 이후 낮은 고점)."
        }
        if declining && risingLows { comment += " 고점은 낮아지고 저점은 높아지는 고고저 수렴." }
        else if declining { comment += " 하락 고점 구조 — 추세선 아래 압력." }
        else if risingLows { comment += " 상승 저점 구조 — 지지가 우상향." }
        if let signals, let trendPrice {
            var extras: [String] = []
            if signals.freshBreak { extras.append("신규(전일 종가 아래→오늘 위)") }
            if signals.lowHold { extras.append("저가 추세선 위 유지") }
            if signals.isVolumeConfirm { extras.append(String(format: "거래량 %.1f배", signals.volumeRatio)) }
            let lastClose = rows.last?.close ?? 0
            comment += " \(signals.phase). 종가 \(MarketSignalEngine.formatPrice(lastClose)) / 추세선 \(MarketSignalEngine.formatPrice(trendPrice))."
            if !extras.isEmpty { comment += " \(extras.joined(separator: " · "))." }
            if !signals.lowComment.isEmpty { comment += " \(signals.lowComment)" }
            if signals.isTrendTooSteep { comment += " 급경사 추세선 제외." }
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
            trendHigh1: p1,
            trendHigh2: p2,
            trendLinePrice: trendPrice,
            isBreakout: isBreakout,
            freshBreak: signals?.freshBreak ?? false,
            lowHold: signals?.lowHold ?? false,
            isBreakoutFailure: signals?.isBreakoutFailure ?? false,
            volumeRatio: signals?.volumeRatio ?? 0,
            phase: signals?.phase ?? "",
            confirmedBreakout: signals?.confirmedBreakout ?? false,
            lowStructure: signals?.lowStructure ?? "",
            lowComment: signals?.lowComment ?? "",
            trendSlopePer20Bars: signals?.trendSlopePer20Bars ?? 0,
            isTrendTooSteep: signals?.isTrendTooSteep ?? false,
            breakoutRate: signals?.breakoutRate ?? 0,
            isVolumeConfirm: signals?.isVolumeConfirm ?? false,
            isBullishCandle: signals?.isBullishCandle ?? false,
            isLineSane: signals?.isLineSane ?? false,
            isRealBreakout: signals?.isRealBreakout ?? false
        )
    }

    /// 높은 고점①과 이후 낮은 고점② — trading-platform `findGoGoJeoTrend`
    static func findGoGoJeoTrend(_ candles: [ChartCandle]) -> (GogoPivot, GogoPivot)? {
        guard candles.count >= 10 else { return nil }
        var pivots = swingPivots(candles, kind: .high)
        if pivots.isEmpty, let maxIdx = candles.indices.max(by: { candles[$0].high < candles[$1].high }) {
            pivots.append(GogoPivot(index: maxIdx, price: candles[maxIdx].high, date: candles[maxIdx].date))
        }
        guard let highest = pivots.max(by: { $0.price < $1.price }) else { return nil }
        let after = pivots.filter { $0.index > highest.index + 3 }
        var second = after.first(where: { $0.price < highest.price })
        if second == nil { second = after.first }
        if second == nil {
            let tailStart = min(candles.count - 1, highest.index + max(5, (candles.count - highest.index) / 2))
            guard tailStart < candles.count else { return nil }
            var bestIdx = tailStart
            for i in tailStart..<candles.count {
                if candles[i].high > candles[bestIdx].high { bestIdx = i }
            }
            second = GogoPivot(index: bestIdx, price: candles[bestIdx].high, date: candles[bestIdx].date)
        }
        guard let p2 = second, p2.index > highest.index else { return nil }
        return (highest, p2)
    }

    private enum PivotKind { case high, low }

    private static func swingPivots(_ candles: [ChartCandle], kind: PivotKind) -> [GogoPivot] {
        guard candles.count >= 5 else { return [] }
        var out: [GogoPivot] = []
        for i in 2..<(candles.count - 2) {
            let c = candles[i]
            switch kind {
            case .high:
                if c.high >= candles[i - 1].high && c.high >= candles[i - 2].high &&
                    c.high >= candles[i + 1].high && c.high >= candles[i + 2].high {
                    out.append(GogoPivot(index: i, price: c.high, date: c.date))
                }
            case .low:
                if c.low <= candles[i - 1].low && c.low <= candles[i - 2].low &&
                    c.low <= candles[i + 1].low && c.low <= candles[i + 2].low {
                    out.append(GogoPivot(index: i, price: c.low, date: c.date))
                }
            }
        }
        return out
    }

    private static func projectTrend(p1: GogoPivot, p2: GogoPivot, targetIndex: Int) -> Double {
        let span = max(1.0, Double(p2.index - p1.index))
        let slope = (p2.price - p1.price) / span
        return p1.price + slope * Double(targetIndex - p1.index)
    }

    private static func smaLast(_ candles: [ChartCandle], period: Int) -> Double {
        guard candles.count >= period else { return 0 }
        return candles.suffix(period).map(\.close).reduce(0, +) / Double(period)
    }

    private static func avgVolume(_ candles: [ChartCandle], period: Int = 20) -> Double {
        guard !candles.isEmpty else { return 0 }
        let slice = candles.suffix(period)
        return slice.map(\.volume).reduce(0, +) / Double(max(1, slice.count))
    }

    private struct GogoChartSignals {
        var closeBreak: Bool
        var lowHold: Bool
        var freshBreak: Bool
        var volumeRatio: Double
        var trendLineNow: Double
        var phase: String
        var confirmedBreakout: Bool
        var isBreakoutFailure: Bool
        var lowStructure: String
        var lowComment: String
        var trendSlopePer20Bars: Double
        var isTrendTooSteep: Bool
        var breakoutRate: Double
        var isVolumeConfirm: Bool
        var isBullishCandle: Bool
        var isLineSane: Bool
        var isRealBreakout: Bool
    }

    private static func chartMethodSignals(
        candles: [ChartCandle],
        p1: GogoPivot,
        p2: GogoPivot,
        swingLows: [GogoPivot]
    ) -> GogoChartSignals? {
        guard let last = candles.last else { return nil }
        let prev = candles.count >= 2 ? candles[candles.count - 2] : last
        let trendNow = projectTrend(p1: p1, p2: p2, targetIndex: candles.count - 1)
        let trendPrev = projectTrend(p1: p1, p2: p2, targetIndex: max(0, candles.count - 2))
        let closeBreak = last.close >= trendNow
        let lowHold = last.low >= trendNow
        let prevBelow = prev.close < trendPrev
        let freshBreak = closeBreak && prevBelow
        let volAvg = avgVolume(candles, period: 20)
        let volumeRatio = volAvg > 0 ? last.volume / volAvg : 0
        let ma20 = smaLast(candles, period: 20)
        let above20 = ma20 > 0 && last.close >= ma20
        let distanceToGJ = trendNow != 0 ? ((last.close - trendNow) / trendNow) * 100 : 0
        let lastIndex = candles.count - 1
        let previousSwingLow = swingLows.filter { $0.index < lastIndex }.dropLast().last
        let recentSwingLow = swingLows.filter { $0.index < lastIndex }.last
        let isLowBreakdown = recentSwingLow.map { last.low < $0.price } ?? false
        let isLowRising = previousSwingLow != nil && recentSwingLow != nil && recentSwingLow!.price > previousSwingLow!.price
        let isLowProtected = recentSwingLow.map { last.low > $0.price } ?? false
        let isBreakoutFailure = closeBreak && isLowBreakdown
        let isCloseBelowRecentLow = recentSwingLow.map { last.close < $0.price } ?? false
        let isBelowMA20 = ma20 > 0 && last.close < ma20
        let isStrongRisk = isLowBreakdown && isBelowMA20
        let lowChangeRate: Double = {
            guard let prev = previousSwingLow, let rec = recentSwingLow, prev.price != 0 else { return 0 }
            return ((rec.price - prev.price) / prev.price) * 100
        }()
        let isLowFlat = previousSwingLow != nil && recentSwingLow != nil && abs(lowChangeRate) <= 1.2
        let isLowFalling = previousSwingLow != nil && recentSwingLow != nil && recentSwingLow!.price < previousSwingLow!.price

        var lowStructure = "저점 확인 필요"
        var lowComment = "최근 저점 구조가 충분하지 않아 보조 확인이 필요합니다."
        if isBreakoutFailure {
            lowStructure = "돌파 실패"
            lowComment = "고고저 돌파 이후 저점이 이탈되어 돌파 실패 가능성이 큽니다."
        } else if isStrongRisk || isCloseBelowRecentLow {
            lowStructure = "저점 이탈"
            lowComment = "최근 저점과 20일선 방어가 동시에 약해져 추가 하락 위험이 큽니다."
        } else if isLowBreakdown || isLowFalling {
            lowStructure = "저점 하락"
            lowComment = "저점이 낮아지는 구조입니다. 매수세 방어 실패 가능성이 있어 관망이 우선입니다."
        } else if isLowRising && isLowProtected {
            lowStructure = "저점 상승"
            lowComment = "저점이 이전보다 높아져 매수세가 상단에서 유입되는 상승 전환 구조입니다."
        } else if isLowProtected {
            lowStructure = "저점 보호"
            lowComment = "최근 저점은 방어 중입니다. 고고저 돌파와 거래량 동반 여부를 추가 확인합니다."
        } else if isLowFlat {
            lowStructure = "저점 횡보"
            lowComment = "저점이 크게 무너지지는 않았지만 상승 저점 구조는 아직 약합니다."
        }

        var phase = "관찰"
        if freshBreak && lowHold && volumeRatio >= 1.2 { phase = "고고저 신규 돌파" }
        else if closeBreak && lowHold { phase = "돌파 후 유지" }
        else if distanceToGJ >= -2 && distanceToGJ < 0 { phase = "돌파 임박" }
        else if above20 && !closeBreak { phase = "20선 지지 확인" }
        else if !above20 { phase = "눌림 또는 약세" }
        let slope = trendSlopePer20Bars(p1: p1, p2: p2)
        let steep = slope >= steepSlopeThreshold
        if isBreakoutFailure { phase = "돌파 실패" }
        else if steep { phase = "급경사 추세선 제외" }

        let breakoutRate = trendNow > 0 ? ((last.close - trendNow) / trendNow) * 100 : 0
        let isVolumeConfirm = volumeRatio >= volumeConfirmRatio
        let isBullishCandle = last.close > last.open
        let lineSane = isLineSane(trendNow: trendNow, candles: candles, p1: p1, p2: p2)
        let isRealBreakout = freshBreak
            && !isBreakoutFailure
            && !steep
            && isVolumeConfirm
            && isBullishCandle
            && breakoutRate >= minBreakoutRatePct
            && lineSane

        return GogoChartSignals(
            closeBreak: closeBreak,
            lowHold: lowHold,
            freshBreak: freshBreak,
            volumeRatio: volumeRatio,
            trendLineNow: trendNow,
            phase: phase,
            confirmedBreakout: closeBreak && !isBreakoutFailure && !steep,
            isBreakoutFailure: isBreakoutFailure,
            lowStructure: lowStructure,
            lowComment: lowComment,
            trendSlopePer20Bars: slope,
            isTrendTooSteep: steep,
            breakoutRate: breakoutRate,
            isVolumeConfirm: isVolumeConfirm,
            isBullishCandle: isBullishCandle,
            isLineSane: lineSane,
            isRealBreakout: isRealBreakout
        )
    }
}
