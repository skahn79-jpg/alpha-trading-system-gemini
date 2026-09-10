import XCTest
@testable import AlphaTrading

final class AlphaTradingTests: XCTestCase {
    func testSmoke() {
        XCTAssertTrue(true)
    }

    func testVersionStringFormat() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        XCTAssertFalse(version.isEmpty)
    }

    func testChartWindowSliceLeavesLatestWhenOffsetZero() {
        let candles = (0..<100).map { $0 }
        let window = ChartWindow(visibleCount: 20, offset: 0).clamped(total: candles.count)
        XCTAssertEqual(Array(window.slice(candles)), Array(80..<100))
    }

    func testChartWindowPanRightRevealsOlderBars() {
        let candles = (0..<100).map { $0 }
        let next = ChartWindow(visibleCount: 20, offset: 0)
            .panned(translationX: 40, chartWidth: 200, startOffset: 0, total: candles.count)
        XCTAssertGreaterThan(next.offset, 0)
        let slice = Array(next.slice(candles))
        XCTAssertEqual(slice.last, 99 - next.offset)
        XCTAssertLessThan(slice.first ?? 0, 80)
    }

    func testChartWindowPinchOutReducesVisibleCount() {
        let next = ChartWindow(visibleCount: 60, offset: 0)
            .pinched(scale: 2, baseCount: 60, total: 200)
        XCTAssertEqual(next.visibleCount, 30)
    }

    func testChartWindowHorizontalPanGate() {
        XCTAssertTrue(ChartWindow.isHorizontalPan(dx: 20, dy: 4))
        XCTAssertFalse(ChartWindow.isHorizontalPan(dx: 4, dy: 20))
    }
}
