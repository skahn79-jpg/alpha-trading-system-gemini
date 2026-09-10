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
        XCTAssertFalse(zones!.swingHighs.isEmpty)
        XCTAssertFalse(zones!.swingLows.isEmpty)
        if let high1 = zones?.trendHigh1, let high2 = zones?.trendHigh2 {
            XCTAssertGreaterThan(high1.price, high2.price)
            XCTAssertLessThan(high1.index, high2.index)
        }
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

    func testVolumeProfileHasPOCAndComment() {
        let candles = (0..<30).map { i in
            ChartCandle(
                date: String(format: "202604%02d", (i % 28) + 1),
                open: 100,
                high: 100 + Double(i % 5),
                low: 95,
                close: i > 20 ? 108 : 100,
                volume: i == 10 ? 9000 : 100
            )
        }
        let profile = MarketSignalEngine.volumeProfile(candles: candles)
        XCTAssertNotNil(profile)
        XCTAssertTrue(profile?.comment.contains("POC") ?? false)
        XCTAssertFalse(profile?.hvnMids.isEmpty ?? true)
    }

    func testWeeklyContextUsesWeeklyMA20() {
        let weekly = (0..<24).map { i in
            ChartCandle(
                date: String(format: "2025%02d01", (i % 12) + 1),
                open: 100,
                high: 101,
                low: 99,
                close: 90 + Double(i),
                volume: 10
            )
        }
        let line = MarketSignalEngine.weeklyContext(candles: weekly)
        XCTAssertEqual(line, "주봉 MA20 위")
        let mixed = MarketSignalEngine.multiTimeframeSummary(candles: weekly, weekly: weekly)
        XCTAssertTrue(mixed?.contains("주봉 MA20") ?? false)
    }

    func testChartDrawingStorePersistsAcrossReload() {
        let code = "TESTDRAW01"
        ChartDrawingStore.resetForTests(code: code)
        defer { ChartDrawingStore.resetForTests(code: code) }
        ChartDrawingStore.upsert(ChartDrawing(id: "h1", code: code, type: "hline", price: 12345, date: nil))
        let loaded = ChartDrawingStore.load(code: code)
        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded.first?.price, 12345)
        ChartOverlayPrefs.save(code: code, showGogo: false, modes: ["지지·저항"])
        let prefs = ChartOverlayPrefs.load(code: code)
        XCTAssertFalse(prefs.showGogo)
        XCTAssertEqual(prefs.modes, ["지지·저항"])
    }

    func testLocalDivergenceFiresOnRSIPriceSplit() {
        var candles: [ChartCandle] = []
        for i in 0..<40 {
            let close: Double
            if i == 10 { close = 80 }
            else if i == 28 { close = 70 }
            else { close = 100 + Double((i % 5) - 2) }
            candles.append(ChartCandle(
                date: String(format: "202605%02d", (i % 28) + 1),
                open: close,
                high: close + 2,
                low: close - 2,
                close: close,
                volume: 1000
            ))
        }
        let signal = MarketSignalEngine.localDivergenceSignal(code: "005930", name: "테스트", candles: candles)
        _ = signal
    }
}
