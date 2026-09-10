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

/// 차트 오버레이 칩 상태 — 종목별 기기 로컬 저장
struct ChartOverlayPrefs: Equatable {
    var showGogo: Bool
    var modes: [String]

    static func key(_ code: String) -> String { "alpha.chart.overlay.\(code)" }

    static func load(code: String) -> ChartOverlayPrefs {
        guard let data = UserDefaults.standard.data(forKey: key(code)),
              let prefs = try? JSONDecoder().decode(ChartOverlayPrefs.self, from: data) else {
            return ChartOverlayPrefs(showGogo: true, modes: [])
        }
        return prefs
    }

    static func save(code: String, showGogo: Bool, modes: [String]) {
        let prefs = ChartOverlayPrefs(showGogo: showGogo, modes: modes)
        if let data = try? JSONEncoder().encode(prefs) {
            UserDefaults.standard.set(data, forKey: key(code))
        }
    }
}

extension ChartOverlayPrefs: Codable {}

/// 수평선 등 그림 도구 — 기기 로컬. iOS에 그리기 UI가 생기면 이 저장소를 사용.
struct ChartDrawing: Codable, Equatable, Identifiable {
    var id: String
    var code: String
    var type: String
    var price: Double?
    var date: String?
}

enum ChartDrawingStore {
    static func key(_ code: String) -> String { "alpha.chart.drawings.\(code)" }

    static func load(code: String) -> [ChartDrawing] {
        guard let data = UserDefaults.standard.data(forKey: key(code)),
              let list = try? JSONDecoder().decode([ChartDrawing].self, from: data) else { return [] }
        return list
    }

    static func save(code: String, drawings: [ChartDrawing]) {
        guard let data = try? JSONEncoder().encode(drawings) else { return }
        UserDefaults.standard.set(data, forKey: key(code))
    }

    static func upsert(_ drawing: ChartDrawing) {
        var list = load(code: drawing.code)
        if let idx = list.firstIndex(where: { $0.id == drawing.id }) {
            list[idx] = drawing
        } else {
            list.append(drawing)
        }
        save(code: drawing.code, drawings: list)
    }

    static func remove(code: String, id: String) {
        save(code: code, drawings: load(code: code).filter { $0.id != id })
    }

    static func resetForTests(code: String) {
        UserDefaults.standard.removeObject(forKey: key(code))
        UserDefaults.standard.removeObject(forKey: ChartOverlayPrefs.key(code))
    }
}
