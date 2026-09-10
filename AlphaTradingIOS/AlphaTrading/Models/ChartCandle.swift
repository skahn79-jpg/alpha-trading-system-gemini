import Foundation

struct ChartCandle: Identifiable, Decodable {
    var id: String { date }
    let date: String
    // 미국주식·코인은 소수점 가격 (국내 주식 정수도 그대로 디코딩됨)
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double

    var isUp: Bool { close >= open }
}

struct ChartResponse: Decodable {
    let code: String?
    let symbol: String?
    let period: String?
    let candles: [ChartCandle]
}

/// Visible window over oldest→newest candles. offset 0 = latest bars.
struct ChartWindow: Equatable {
    var visibleCount: Int
    var offset: Int

    static let minCount = 20
    static let defaultCount = 60

    func clamped(total: Int) -> ChartWindow {
        let safeTotal = max(0, total)
        let count = min(max(Self.minCount, visibleCount), max(Self.minCount, safeTotal))
        let boundedCount = min(count, max(1, safeTotal))
        let maxOffset = max(0, safeTotal - boundedCount)
        return ChartWindow(visibleCount: boundedCount, offset: min(max(0, offset), maxOffset))
    }

    func slice<T>(_ items: [T]) -> ArraySlice<T> {
        let w = clamped(total: items.count)
        guard !items.isEmpty else { return items[...] }
        let start = max(0, items.count - w.visibleCount - w.offset)
        let end = min(items.count, start + w.visibleCount)
        return items[start..<end]
    }

    /// Pinch out (scale > 1) zooms in → fewer bars.
    func pinched(scale: CGFloat, baseCount: Int, total: Int) -> ChartWindow {
        let safeScale = max(0.05, scale)
        let next = Int((Double(baseCount) / Double(safeScale)).rounded())
        return ChartWindow(visibleCount: next, offset: offset).clamped(total: total)
    }

    /// Drag right (positive x) reveals older candles → larger offset.
    func panned(translationX: CGFloat, chartWidth: CGFloat, startOffset: Int, total: Int) -> ChartWindow {
        let current = clamped(total: total)
        let barWidth = max(2, chartWidth / CGFloat(max(1, current.visibleCount)))
        let deltaBars = Int((translationX / barWidth).rounded())
        return ChartWindow(visibleCount: current.visibleCount, offset: startOffset + deltaBars).clamped(total: total)
    }

    /// Horizontal pan wins only when |dx| > |dy| so the parent ScrollView can still scroll vertically.
    static func isHorizontalPan(dx: CGFloat, dy: CGFloat) -> Bool {
        abs(dx) > abs(dy)
    }
}
