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

    func testCrashSignalHighOnSharpDrop() {
        let signal = MarketSignalEngine.crashSignal(
            code: "005930",
            name: "테스트전자",
            changeRate: -6.2,
            analysis: nil,
            candles: []
        )
        XCTAssertEqual(signal?.kind, .crash)
        XCTAssertEqual(signal?.severity, .high)
        XCTAssertFalse(signal?.opportunity ?? true)
    }

    func testCrashSignalIgnoresMildDrop() {
        let signal = MarketSignalEngine.crashSignal(
            code: "005930",
            name: "테스트전자",
            changeRate: -1.2,
            analysis: nil,
            candles: []
        )
        XCTAssertNil(signal)
    }

    func testBreakoutWhenCloseAboveRecentHigh() {
        var candles: [ChartCandle] = []
        for i in 0..<20 {
            candles.append(ChartCandle(
                date: String(format: "202601%02d", i + 1),
                open: 100, high: 105, low: 99, close: 102, volume: 1000
            ))
        }
        candles.append(ChartCandle(date: "20260201", open: 106, high: 112, low: 105, close: 111, volume: 3000))
        let signal = MarketSignalEngine.breakoutSignal(
            code: "005930",
            name: "테스트전자",
            analysis: nil,
            candles: candles,
            lastPrice: 111
        )
        XCTAssertEqual(signal?.kind, .breakout)
        XCTAssertTrue(signal?.opportunity ?? false)
    }

    func testNewsMapsTickerAndOpportunityKeyword() {
        let signal = MarketSignalEngine.newsSignal(
            code: "005930",
            name: "테스트전자",
            titles: ["테스트전자 실적 상향 계약"]
        )
        XCTAssertEqual(signal?.kind, .news)
        XCTAssertTrue(signal?.opportunity ?? false)
    }

    func testFearGreedFromExtremeIndex() {
        let fear = MarketSignalEngine.fearGreedSignal(
            code: "BTC",
            name: "비트코인",
            analysis: nil,
            fearGreedValue: 12
        )
        XCTAssertEqual(fear?.kind, .fearGreed)
        XCTAssertTrue(fear?.opportunity ?? false)
        let greed = MarketSignalEngine.fearGreedSignal(
            code: "BTC",
            name: "비트코인",
            analysis: nil,
            fearGreedValue: 88
        )
        XCTAssertEqual(greed?.kind, .fearGreed)
        XCTAssertFalse(greed?.opportunity ?? true)
    }

    func testGogoZonesDetectHighLowBands() {
        var candles: [ChartCandle] = []
        let closes: [Double] = [
            100, 102, 108, 104, 101,
            99, 96, 92, 95, 98,
            103, 110, 106, 104, 107,
            100, 94, 90, 93, 97
        ]
        for (i, close) in closes.enumerated() {
            candles.append(ChartCandle(
                date: String(format: "202602%02d", i + 1),
                open: close - 1,
                high: close + 3,
                low: close - 3,
                close: close,
                volume: 1000
            ))
        }
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertNotNil(zones)
        XCTAssertGreaterThan(zones!.highHigh, zones!.lowLow)
        XCTAssertFalse(zones!.comment.isEmpty)
    }

    func testSignalInboxCooldownRejectsDuplicateKind() {
        SignalInbox.resetForTests()
        defer { SignalInbox.resetForTests() }
        let first = PersonalSignal(
            code: "005930",
            name: "테스트전자",
            kind: .crash,
            severity: .high,
            title: "급락",
            detail: "test",
            createdAt: 1_000,
            opportunity: false
        )
        XCTAssertEqual(SignalInbox.ingest([first], now: 1_000).count, 1)
        XCTAssertTrue(SignalInbox.ingest([first], now: 1_001).isEmpty)
        XCTAssertEqual(SignalInbox.ingest([first], now: 1_000 + MarketSignalEngine.cooldownSeconds + 1).count, 1)
    }

    func testMultiTimeframeSummaryUsesMovingAverages() {
        let candles = (0..<60).map { i in
            ChartCandle(
                date: String(format: "202603%02d", (i % 28) + 1),
                open: 100,
                high: 101,
                low: 99,
                close: 100 + Double(i),
                volume: 10
            )
        }
        let line = MarketSignalEngine.multiTimeframeSummary(candles: candles)
        XCTAssertNotNil(line)
        XCTAssertTrue(line?.contains("MA20") ?? false)
    }
}
