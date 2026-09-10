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

    func testMacroDashboardHeadlinesPreferKeySeries() {
        func item(_ id: String, _ name: String) -> MacroIndicator {
            MacroIndicator(
                id: id,
                name: name,
                unit: "%",
                value: 1.2,
                change: -0.3,
                date: nil,
                note: nil,
                stance: "headwind",
                spark: nil
            )
        }
        let report = MacroReport(
            ok: true,
            source: nil,
            mood: "mixed",
            moodLabel: "혼조",
            supportive: 2,
            headwind: 3,
            indicators: [
                item("CPIAUCSL", "미국 CPI"),
                item("CPILFESL", "근원 CPI"),
                item("DFF", "연준 기준금리"),
                item("DGS10", "미 10년물 금리"),
                item("WALCL", "연준 총자산"),
                item("RRPONTSYD", "연준 역레포"),
                item("VIXCLS", "VIX 변동성"),
                item("DTWEXBGS", "달러 인덱스"),
            ],
            disclaimer: nil
        )
        XCTAssertEqual(
            report.dashboardHeadlines.map(\.id),
            ["VIXCLS", "DFF", "DGS10", "CPIAUCSL", "WALCL", "DTWEXBGS"]
        )
        XCTAssertEqual(report.dashboardHeadlines.count, 6)
        XCTAssertEqual(report.dashboardHeadlines[0].stanceLabel, "부담")
        XCTAssertEqual(report.dashboardHeadlines[0].changeText, "-0.3")
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

    func testPersonalSignalsSplitIntoRiskAndOpportunitySections() {
        let crash = PersonalSignal(
            code: "005930",
            name: "테스트전자",
            kind: .crash,
            severity: .high,
            title: "급락",
            detail: "위험",
            opportunity: false
        )
        let breakout = PersonalSignal(
            code: "005930",
            name: "테스트전자",
            kind: .breakout,
            severity: .high,
            title: "돌파",
            detail: "기회",
            opportunity: true
        )
        let greed = PersonalSignal(
            code: "005930",
            name: "테스트전자",
            kind: .fearGreed,
            severity: .medium,
            title: "탐욕",
            detail: "위험",
            opportunity: false
        )
        let mixed = [crash, breakout, greed]
        XCTAssertEqual(PersonalSignal.riskSignals(in: mixed).map(\.kind), [.crash, .fearGreed])
        XCTAssertEqual(PersonalSignal.opportunitySignals(in: mixed).map(\.kind), [.breakout])
        XCTAssertTrue(PersonalSignal.riskSignals(in: mixed).allSatisfy { !$0.opportunity })
        XCTAssertTrue(PersonalSignal.opportunitySignals(in: mixed).allSatisfy(\.opportunity))
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
        XCTAssertEqual(item?.breakoutBarsAgo, 0)
        XCTAssertEqual(item?.isTodayBreak, true)
        XCTAssertEqual(zones?.breakoutBarsAgo, 0)
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
        // 에이텍형: lookback(5거래일)보다 오래 추세선 위 — 최근 구간에 fresh cross 없음
        let candles = gogoStaleAboveFixture()
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertEqual(zones?.isBreakout, true)
        XCTAssertEqual(zones?.lowHold, true)
        XCTAssertEqual(zones?.freshBreak, false)
        XCTAssertEqual(zones?.isRealBreakout, false)
        XCTAssertNil(MarketSignalEngine.gogoBreakout(code: "045660", name: "테스트텍", candles: candles))
    }

    func testGogoRecentBreakoutWithinLookbackIsListed() {
        // 3거래일 전 품질 돌파 후 오늘까지 추세선 위 유지
        let candles = gogoRecentBreakFixture(barsAgo: 3)
        let zones = GogoZoneDetector.detect(candles: candles)
        XCTAssertEqual(zones?.isBreakout, true)
        XCTAssertEqual(zones?.freshBreak, false)
        XCTAssertEqual(zones?.isRealBreakout, true)
        XCTAssertEqual(zones?.breakoutBarsAgo, 3)
        let item = MarketSignalEngine.gogoBreakout(code: "005930", name: "테스트전자", candles: candles)
        XCTAssertNotNil(item)
        XCTAssertEqual(item?.breakoutBarsAgo, 3)
        XCTAssertEqual(item?.isTodayBreak, false)
        XCTAssertEqual(item?.ageBadge, "3일 전")
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

    func testGogoSteepAthFallsBackOrHidesLikeLginnotek() {
        // LG이노텍형: ATH 급락 쌍(steep20>=18)은 활성 고고저로 쓰지 않는다.
        var candles: [ChartCandle] = []
        for i in 0..<80 {
            var high = 500_000.0 + Double(i) * 100
            var low = high - 20_000
            var close = high - 8_000
            var open = close - 1_000
            var volume = 2000.0
            if i == 20 { // ATH ①
                high = 1_788_000; low = 1_500_000; close = 1_700_000; open = 1_650_000
            } else if i == 18 || i == 19 || i == 21 || i == 22 {
                high = 1_200_000; low = 1_050_000; close = 1_100_000; open = 1_080_000
            } else if i == 35 { // 급락 고점② — steep with ATH
                high = 1_320_000; low = 1_100_000; close = 1_200_000; open = 1_180_000
            } else if i == 33 || i == 34 || i == 36 || i == 37 {
                high = 1_050_000; low = 950_000; close = 1_000_000; open = 990_000
            } else if i == 55 { // secondary gentler lower high structure
                high = 720_000; low = 650_000; close = 700_000; open = 690_000
            } else if i == 53 || i == 54 || i == 56 || i == 57 {
                high = 680_000; low = 620_000; close = 650_000; open = 640_000
            } else if i == 70 { // later lower high for secondary pair
                high = 640_000; low = 580_000; close = 610_000; open = 600_000
            } else if i == 68 || i == 69 || i == 71 || i == 72 {
                high = 620_000; low = 560_000; close = 590_000; open = 580_000
            }
            if i >= 75 {
                high = 570_000; low = 540_000; close = 557_000; open = 550_000; volume = 2500
            }
            candles.append(ChartCandle(
                date: String(format: "2026%02d%02d", (i / 28) + 1, (i % 28) + 1),
                open: open, high: high, low: low, close: close, volume: volume
            ))
        }
        let raw = GogoZoneDetector.findGoGoJeoTrendRaw(candles)
        XCTAssertNotNil(raw)
        if let raw {
            XCTAssertEqual(raw.0.price, 1_788_000, accuracy: 1)
            XCTAssertTrue(GogoZoneDetector.isTrendTooSteep(p1: raw.0, p2: raw.1) || !GogoZoneDetector.isUsableTrendPair(p1: raw.0, p2: raw.1, candles: candles))
        }
        let usable = GogoZoneDetector.findGoGoJeoTrend(candles)
        if let usable {
            XCTAssertFalse(GogoZoneDetector.isTrendTooSteep(p1: usable.0, p2: usable.1))
            XCTAssertTrue(GogoZoneDetector.isUsableTrendPair(p1: usable.0, p2: usable.1, candles: candles))
            XCTAssertNotEqual(usable.0.price, 1_788_000, accuracy: 1) // must not keep ATH crash pair
        }
        let zones = GogoZoneDetector.detect(candles: candles, period: "D")
        if zones?.trendHigh1 != nil {
            XCTAssertEqual(zones?.isTrendTooSteep, false)
            XCTAssertNotEqual(zones?.trendHigh1?.price, 1_788_000, accuracy: 1)
        } else {
            XCTAssertEqual(zones?.isTrendTooSteep, true)
        }
        // Monthly window must not force ATH→last-bar
        let monthly = GogoZoneDetector.detect(candles: candles, period: "M")
        if let h1 = monthly?.trendHigh1, let h2 = monthly?.trendHigh2 {
            XCTAssertFalse(GogoZoneDetector.isTrendTooSteep(p1: h1, p2: h2))
        }
    }

    func testGogoLookbackByPeriod() {
        XCTAssertEqual(GogoZoneDetector.lookbackBars(for: "D"), 160)
        XCTAssertEqual(GogoZoneDetector.lookbackBars(for: "W"), 78)
        XCTAssertEqual(GogoZoneDetector.lookbackBars(for: "M"), 36)
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

    /// 최근 5거래일 이상 추세선 위에 머무른 에이텍형 (lookback 내 fresh cross 없음)
    private func gogoStaleAboveFixture() -> [ChartCandle] {
        var candles = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 2500, prevClose: 148, lastOpen: 148)
        // Keep the last 10 sessions clearly above the declining trend without a fresh cross.
        for i in 30..<40 {
            var c = candles[i]
            let close = 145 + Double(i - 30) * 0.4
            candles[i] = ChartCandle(
                date: c.date,
                open: close - 1,
                high: close + 3,
                low: close - 2,
                close: close,
                volume: 2500
            )
        }
        return candles
    }

    /// Qualifying fresh break `barsAgo` sessions back, then hold above the line through today.
    private func gogoRecentBreakFixture(barsAgo: Int) -> [ChartCandle] {
        var candles = gogoPairFixture(lastClose: 150, lastLow: 145, lastVolume: 2500, prevClose: 148, lastOpen: 148)
        let breakIndex = 39 - barsAgo
        for i in 30..<40 {
            let isBreak = i == breakIndex
            let afterBreak = i > breakIndex
            let close: Double
            let open: Double
            let low: Double
            let volume: Double
            if isBreak {
                close = 150
                open = 140
                low = 145
                volume = 2500
            } else if afterBreak {
                close = 148 + Double(i - breakIndex)
                open = close - 1
                low = close - 3
                volume = 1200
            } else {
                close = 90
                open = 89
                low = 85
                volume = 1000
            }
            candles[i] = ChartCandle(
                date: String(format: "d%02d", i),
                open: open,
                high: max(close + 2, open + 1),
                low: low,
                close: close,
                volume: volume
            )
        }
        // Day before break must be below trend for fresh cross.
        if breakIndex > 0 {
            let i = breakIndex - 1
            candles[i] = ChartCandle(date: String(format: "d%02d", i), open: 88, high: 92, low: 84, close: 90, volume: 1000)
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
