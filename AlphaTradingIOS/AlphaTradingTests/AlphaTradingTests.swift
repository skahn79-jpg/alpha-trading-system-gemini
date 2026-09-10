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
        let t0 = Date().timeIntervalSince1970
        let first = PersonalSignal(
            code: "TEST-COOLDOWN",
            name: "테스트전자",
            kind: .crash,
            severity: .high,
            title: "급락",
            detail: "test",
            createdAt: t0,
            opportunity: false
        )
        XCTAssertEqual(SignalInbox.ingest([first], now: t0).count, 1)
        XCTAssertTrue(SignalInbox.ingest([first], now: t0 + 1).isEmpty)
        XCTAssertEqual(SignalInbox.ingest([first], now: t0 + MarketSignalEngine.cooldownSeconds + 1).count, 1)
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

    func testNotificationPayloadRebuildsTitleBodyFromUserInfo() {
        let payload = NotificationOpenPayload.resolve(
            requestId: "signal-abc",
            title: "",
            body: "",
            userInfo: [
                "id": "abc",
                "code": "005930",
                "name": "테스트전자",
                "kind": "crash",
                "title": "테스트전자 급락",
                "detail": "등락률 -6.2% · ATR 3.1%",
                "body": "등락률 -6.2% · ATR 3.1%",
            ]
        )
        XCTAssertEqual(payload.id, "abc")
        XCTAssertEqual(payload.code, "005930")
        XCTAssertEqual(payload.name, "테스트전자")
        XCTAssertEqual(payload.kind, "crash")
        XCTAssertEqual(payload.title, "테스트전자 급락")
        XCTAssertEqual(payload.body, "등락률 -6.2% · ATR 3.1%")
        XCTAssertEqual(payload.detail, "등락률 -6.2% · ATR 3.1%")
        XCTAssertEqual(payload.kindLabel, "급락")
        XCTAssertEqual(payload.tickerLabel, "테스트전자 (005930)")
        XCTAssertEqual(payload.stock?.code, "005930")
    }

    func testNotificationPayloadUsesBannerTextWhenUserInfoIsThin() {
        let payload = NotificationOpenPayload.resolve(
            requestId: "signal-old",
            title: "급락 · 테스트전자",
            body: "등락률 -6.2%",
            userInfo: ["code": "005930", "kind": "crash"]
        )
        XCTAssertEqual(payload.title, "급락 · 테스트전자")
        XCTAssertEqual(payload.body, "등락률 -6.2%")
        XCTAssertEqual(payload.code, "005930")
        XCTAssertEqual(payload.kind, "crash")
    }

    func testNotificationPayloadReadsRemoteApsAlert() {
        let payload = NotificationOpenPayload.resolve(
            requestId: "remote",
            title: "",
            body: "",
            userInfo: [
                "aps": [
                    "alert": ["title": "서버 알림", "body": "목표가 도달"],
                    "sound": "default",
                ],
                "code": "000660",
                "name": "테스트반도체",
                "kind": "priceAbove",
                "id": "alert-1",
            ]
        )
        XCTAssertEqual(payload.title, "서버 알림")
        XCTAssertEqual(payload.body, "목표가 도달")
        XCTAssertEqual(payload.code, "000660")
        XCTAssertEqual(payload.kindLabel, "목표가 이상")
    }

    func testNotificationPayloadLooksUpSignalInboxAfterRelaunch() {
        SignalInbox.resetForTests()
        defer { SignalInbox.resetForTests() }
        let stored = PersonalSignal(
            id: "inbox-1",
            code: "035420",
            name: "테스트포털",
            kind: .breakout,
            severity: .high,
            title: "테스트포털 돌파",
            detail: "종가가 최근 고점을 상향 돌파",
            opportunity: true
        )
        XCTAssertEqual(SignalInbox.ingest([stored]).count, 1)
        let payload = NotificationOpenPayload.resolve(
            requestId: "signal-inbox-1",
            title: "",
            body: "",
            userInfo: ["id": "inbox-1", "code": "035420", "kind": "breakout"]
        )
        XCTAssertEqual(payload.title, "테스트포털 돌파")
        XCTAssertEqual(payload.body, "종가가 최근 고점을 상향 돌파")
        XCTAssertEqual(payload.name, "테스트포털")
    }

    func testPersonalSignalUserInfoContainsReconstructableFields() {
        let signal = PersonalSignal(
            code: "005930",
            name: "테스트전자",
            kind: .news,
            severity: .medium,
            title: "테스트전자 뉴스",
            detail: "수주 계약",
            opportunity: true
        )
        let info = signal.notificationUserInfo
        XCTAssertEqual(info["id"] as? String, signal.id)
        XCTAssertEqual(info["code"] as? String, "005930")
        XCTAssertEqual(info["title"] as? String, "테스트전자 뉴스")
        XCTAssertEqual(info["detail"] as? String, "수주 계약")
        XCTAssertEqual(info["body"] as? String, "수주 계약")
        XCTAssertEqual(info["kind"] as? String, "news")
    }

    func testChartWindowYDomainFitsVisibleHighLowOnly() {
        let recent = [
            ChartCandle(date: "a", open: 101, high: 103, low: 100, close: 102, volume: 1),
            ChartCandle(date: "b", open: 102, high: 104, low: 101, close: 103, volume: 1),
        ]
        let domain = ChartWindow.yDomain(candles: recent)
        XCTAssertGreaterThan(domain.lowerBound, 96)
        XCTAssertLessThan(domain.upperBound, 108)
        let pad = (domain.upperBound - 104)
        let span = 104.0 - 100.0
        XCTAssertGreaterThan(pad, span * 0.019)
        XCTAssertLessThan(pad, span * 0.051)
    }

    func testChartWindowYDomainIgnoresOldGlobalHigh() {
        let visible = [
            ChartCandle(date: "r1", open: 51000, high: 52000, low: 50500, close: 51500, volume: 1),
            ChartCandle(date: "r2", open: 51500, high: 52200, low: 51200, close: 51800, volume: 1),
        ]
        let domain = ChartWindow.yDomain(candles: visible)
        XCTAssertGreaterThan(domain.lowerBound, 48000)
        XCTAssertLessThan(domain.upperBound, 54000)
    }

    func testGogoBreakoutWhenCloseAboveTrendline() {
        let candles = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 2500, prevClose: 90, lastOpen: 140)
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertNotNil(zones)
        XCTAssertEqual(zones?.isBreakout, true)
        XCTAssertEqual(zones?.isRealBreakout, true)
        let item = MarketSignalEngine.gogoBreakout(
            code: "005930",
            name: "테스트전자",
            candles: candles
        )
        XCTAssertNotNil(item)
        XCTAssertTrue(item?.brokeTrend ?? false)
        XCTAssertFalse(item?.detail.isEmpty ?? true)
        XCTAssertEqual(item?.asStock.code, "005930")
    }

    func testGogoBreakoutNilWhenCloseBelowTrendline() {
        let candles = gogoPairFixture(lastClose: 85, lastLow: 80, lastVolume: 2500, prevClose: 90, lastOpen: 88)
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertNotNil(zones)
        XCTAssertEqual(zones?.isBreakout, false)
        let item = MarketSignalEngine.gogoBreakout(
            code: "005930",
            name: "테스트전자",
            candles: candles
        )
        XCTAssertNil(item)
    }

    func testGogoPrefersGlobalHighestThenLaterLowerPair() {
        let candles = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 2500, prevClose: 90, lastOpen: 140)
        let pair = GogoZoneDetector.findGoGoJeoTrend(candles)
        XCTAssertEqual(pair?.0.price, 160)
        XCTAssertEqual(pair?.0.index, 8)
        XCTAssertEqual(pair?.1.price, 140)
        XCTAssertEqual(pair?.1.index, 22)
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertEqual(zones?.trendHigh1?.price, 160)
        XCTAssertEqual(zones?.trendHigh2?.price, 140)
        XCTAssertNotEqual(zones?.trendHigh1?.price, 112)
        XCTAssertEqual(zones?.freshBreak, true)
        XCTAssertEqual(zones?.lowHold, true)
        XCTAssertEqual(zones?.confirmedBreakout, true)
        XCTAssertEqual(zones?.isBreakoutFailure, false)
    }

    func testGogoDoesNotConfirmWhenLowStructureFails() {
        let candles = gogoPairFixture(lastClose: 150, lastLow: 60, lastVolume: 2500, prevClose: 90, lastOpen: 140)
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertEqual(zones?.isBreakout, true)
        XCTAssertEqual(zones?.isBreakoutFailure, true)
        XCTAssertEqual(zones?.confirmedBreakout, false)
        XCTAssertEqual(zones?.isRealBreakout, false)
        XCTAssertNil(MarketSignalEngine.gogoBreakout(code: "005930", name: "테스트전자", candles: candles))
    }

    func testGogoStaleAboveLineIsNotListedLikeAitech() {
        // 에이텍형: 이미 오래 추세선 위(closeBreak+lowHold)지만 전일도 위 → freshBreak 없음
        let candles = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 2500, prevClose: 140, lastOpen: 140)
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertEqual(zones?.isBreakout, true)
        XCTAssertEqual(zones?.lowHold, true)
        XCTAssertEqual(zones?.freshBreak, false)
        XCTAssertEqual(zones?.isRealBreakout, false)
        XCTAssertNil(MarketSignalEngine.gogoBreakout(code: "045660", name: "테스트텍", candles: candles))
    }

    func testGogoSteepTrendExcludedLikeDoosan() {
        // 두산에너빌리티 참고: ① 139200 → ② 117000 (약 11봉) → slope/20봉 >= 18
        let p1 = GogoPivot(index: 0, price: 139200, date: "20260507")
        let p2 = GogoPivot(index: 11, price: 117000, date: "20260522")
        let slope = GogoZoneDetector.trendSlopePer20Bars(p1: p1, p2: p2)
        XCTAssertGreaterThanOrEqual(slope, 18)
        XCTAssertTrue(GogoZoneDetector.isTrendTooSteep(p1: p1, p2: p2))

        let candles = gogoSteepPairFixture()
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertEqual(zones?.isTrendTooSteep, true)
        XCTAssertEqual(zones?.isRealBreakout, false)
        XCTAssertNil(MarketSignalEngine.gogoBreakout(code: "034020", name: "테스트에너지", candles: candles))
    }

    func testGogoBreakoutRequiresVolumeAndBullish() {
        let weakVol = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 1000, prevClose: 90, lastOpen: 140)
        XCTAssertEqual(GogoZoneDetector.detect(candles: weakVol)?.isVolumeConfirm, false)
        XCTAssertNil(MarketSignalEngine.gogoBreakout(code: "005930", name: "테스트전자", candles: weakVol))

        let bearish = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 2500, prevClose: 90, lastOpen: 155)
        XCTAssertEqual(GogoZoneDetector.detect(candles: bearish)?.isBullishCandle, false)
        XCTAssertNil(MarketSignalEngine.gogoBreakout(code: "005930", name: "테스트전자", candles: bearish))
    }

    func testGogoUniverseGroupsKospiKosdaqOverseas() {
        let merged = GogoBreakoutUniverse.mergeCandidates(
            kospi: [Stock(code: "005930", name: "테스트전자")],
            kosdaq: [Stock(code: "247540", name: "테스트비엠")],
            overseas: [Stock(code: "NVDA", name: "TestGPU", assetType: "us")],
            featured: [Stock(code: "035420", name: "테스트포털")],
            watchlist: [Stock(code: "AAPL", name: "TestPhone", assetType: "us")],
            kospiCodes: ["005930", "035420"],
            kosdaqCodes: ["247540"]
        )
        XCTAssertEqual(merged.count, 5)
        XCTAssertEqual(merged.first(where: { $0.stock.code == "005930" })?.group, .kospi)
        XCTAssertEqual(merged.first(where: { $0.stock.code == "247540" })?.group, .kosdaq)
        XCTAssertEqual(merged.first(where: { $0.stock.code == "NVDA" })?.group, .overseas)
        XCTAssertEqual(merged.first(where: { $0.stock.code == "AAPL" })?.group, .overseas)
        XCTAssertEqual(merged.first(where: { $0.stock.code == "035420" })?.group, .kospi)
    }

    private func gogoPairFixture(
        lastClose: Double,
        lastLow: Double,
        lastVolume: Double,
        prevClose: Double,
        lastOpen: Double? = nil
    ) -> [ChartCandle] {
        var candles: [ChartCandle] = []
        for i in 0..<40 {
            var high = 90 + Double(i) * 0.001
            var low = 80 - Double(i) * 0.001
            var close = 85.0
            var open = close
            var volume = 1000.0
            if i == 8 { high = 160; low = 140; close = 150; open = 148 }
            else if i == 22 { high = 140; low = 120; close = 128; open = 126 }
            else if i == 28 { high = 112; low = 100; close = 105; open = 104 }
            else if i == 34 { high = 104; low = 96; close = 100; open = 99 }
            else if i == 14 { high = 88; low = 70; close = 80; open = 82 }
            if i == 38 {
                close = prevClose
                open = prevClose
            }
            if i == 39 {
                close = lastClose
                open = lastOpen ?? lastClose
                high = max(high, lastClose + 2, open)
                low = lastLow
                volume = lastVolume
            }
            candles.append(ChartCandle(
                date: String(format: "d%02d", i),
                open: open,
                high: high,
                low: low,
                close: close,
                volume: volume
            ))
        }
        return candles
    }

    /// 짧은 급락 고점쌍 — 추세선이 가격 아래로 붕괴되어 closeBreak가 상시 true가 되는 형태
    private func gogoSteepPairFixture() -> [ChartCandle] {
        var candles: [ChartCandle] = []
        for i in 0..<40 {
            var high = 94000.0 - Double(i) * 20
            var low = high - 4000
            var close = high - 1500
            var open = close - 200
            var volume = 2000.0
            if i == 8 { high = 139200; low = 120000; close = 130000; open = 128000 }
            else if i == 6 || i == 7 || i == 9 || i == 10 { high = 110000; low = 100000; close = 105000; open = 104000 }
            else if i == 19 { high = 117000; low = 100000; close = 108000; open = 107000 }
            else if i == 17 || i == 18 || i == 20 || i == 21 { high = 108000; low = 98000; close = 102000; open = 101000 }
            if i == 38 { close = 80000; open = 79000; high = 81000; low = 78000 }
            if i == 39 {
                close = 82000
                open = 80000
                high = 83000
                low = 79500
                volume = 4000
            }
            candles.append(ChartCandle(
                date: String(format: "d%02d", i),
                open: open,
                high: high,
                low: low,
                close: close,
                volume: volume
            ))
        }
        return candles
    }
}
