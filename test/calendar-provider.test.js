/**
 * CalendarProvider 조회 API 단위 테스트.
 * 합성 fixture만 사용한다. 네트워크 없음.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TRADING_DAY_STATUS,
  COMPLETENESS,
  VERIFICATION_STATUS,
  PRODUCTION_CALENDAR_STATUS,
  HORIZON_TRADING_DAYS,
  INVALID_DATE_FORMAT,
  INVALID_DATE_VALUE,
  createCalendarProvider,
  createUnavailableCalendarProvider,
  parseCalendarDate,
  SYNTHETIC_FIXTURE_NOT_ALLOWED,
  TEST_VERIFICATION_STATUS_NOT_ALLOWED,
  SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED,
  PRODUCTION_NOT_ELIGIBLE,
} = require("../lib/calendar/calendar-provider");
const { SESSION_TYPE, TIMEZONE_SEOUL } = require("../lib/calendar/session-schedule");
const { INVALID_HORIZON } = require("../lib/calendar/krx-calendar");
const { loadCalendarSnapshot } = require("../lib/calendar/calendar-snapshot");
const {
  FIXTURE_META,
  makeMainCompleteSnapshot,
  makePartialSnapshot,
  makeUnknownCompletenessSnapshot,
  makeYearBoundarySnapshot,
  makeLeapSnapshot,
  makeLongCompleteSnapshot,
  attachChecksums,
  LONG_PLUS_1,
  LONG_PLUS_5,
  LONG_PLUS_20,
  LONG_PLUS_60,
} = require("./fixtures/synthetic-calendar-snapshot");

const TEST_LOAD = { mode: "TEST", allowSyntheticFixture: true };
function load(snapshot) {
  const loaded = loadCalendarSnapshot(snapshot, TEST_LOAD);
  assert.equal(loaded.ok, true, loaded.error);
  return loaded.provider;
}

function assertNotHeuristicTimes(result) {
  assert.notEqual(result.marketOpenTime, "09:00");
  assert.notEqual(result.marketOpenTime, "09:00:00");
  assert.notEqual(result.marketCloseTime, "15:30");
  assert.notEqual(result.marketCloseTime, "15:30:00");
  assert.notEqual(result.marketCloseTime, "15:40");
  assert.notEqual(result.marketCloseTime, "15:40:00");
}

test("fixture는 합성 캘린더이며 실제 KRX 데이터가 아니다", () => {
  const snap = makeMainCompleteSnapshot();
  assert.equal(snap.fixtureType, FIXTURE_META.fixtureType);
  assert.equal(snap.notActualKrxCalendar, true);
  assert.equal(snap.notProductionData, true);
  assert.equal(snap.productionEligible, false);
  assert.equal(snap.verificationStatus, VERIFICATION_STATUS.TEST_VERIFIED);
  assert.equal(FIXTURE_META.fixtureType, "SYNTHETIC_CALENDAR_FIXTURE");
  assert.equal(FIXTURE_META.verificationStatus, VERIFICATION_STATUS.TEST_VERIFIED);
  assert.equal(FIXTURE_META.productionEligible, false);
  assert.equal(FIXTURE_META.notProductionData, true);
});

test("getNextTradingDay 는 존재하지 않는다", () => {
  const provider = load(makeMainCompleteSnapshot());
  assert.equal(typeof provider.getNextTradingDay, "undefined");
  assert.equal(typeof provider.getTradingDayOnOrAfter, "function");
  assert.equal(typeof provider.getNextTradingDayAfter, "function");
});

test("HORIZON_TRADING_DAYS 상수", () => {
  assert.equal(HORIZON_TRADING_DAYS.ULTRA_SHORT, 1);
  assert.equal(HORIZON_TRADING_DAYS.SHORT, 5);
  assert.equal(HORIZON_TRADING_DAYS.MEDIUM, 20);
  assert.equal(HORIZON_TRADING_DAYS.LONG, 60);
});

test("createUnavailableCalendarProvider 는 NOT_CONFIGURED / PENDING", () => {
  const provider = createUnavailableCalendarProvider();
  assert.equal(provider.productionCalendarStatus, PRODUCTION_CALENDAR_STATUS.NOT_CONFIGURED);
  assert.equal(provider.verificationStatus, VERIFICATION_STATUS.PENDING);
  const st = provider.getTradingDayStatus("2100-01-05");
  assert.equal(st.ok, false);
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.equal(st.evaluationStatus, null);
  assert.equal(st.targetDateStatus, "CALENDAR_PENDING");
  assert.equal(st.sessionType, SESSION_TYPE.SESSION_SCHEDULE_PENDING);
  assert.equal(st.marketOpenTime, null);
  assert.equal(st.marketCloseTime, null);
  assertNotHeuristicTimes(st);
  assert.equal(provider.getCoverage(), null);
});

test("1. COMPLETE 누락 평일 2100-01-15 은 NON_TRADING_DAY", () => {
  const provider = load(makeMainCompleteSnapshot());
  const st = provider.getTradingDayStatus("2100-01-15");
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.NON_TRADING_DAY);
  assert.equal(st.ok, true);
});

test("2. PARTIAL 누락 평일 2100-01-20 은 CALENDAR_PENDING", () => {
  const provider = load(makePartialSnapshot());
  const st = provider.getTradingDayStatus("2100-01-20");
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.equal(st.ok, true);
  assert.equal(st.evaluationStatus, null);
});

test("3. UNKNOWN_COMPLETENESS 누락 평일 2100-01-15 은 CALENDAR_PENDING", () => {
  const provider = load(makeUnknownCompletenessSnapshot());
  const st = provider.getTradingDayStatus("2100-01-15");
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
});

test("4. coverage 밖은 CALENDAR_RANGE_INSUFFICIENT", () => {
  const provider = load(makeMainCompleteSnapshot());
  assert.equal(
    provider.getTradingDayStatus("2100-01-04").tradingDayStatus,
    TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT,
  );
  assert.equal(
    provider.getTradingDayStatus("2100-02-13").tradingDayStatus,
    TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT,
  );
});

test("5. coverage 안 주말은 NON_TRADING_DAY, 밖 주말은 RANGE", () => {
  const provider = load(makeMainCompleteSnapshot());
  assert.equal(
    provider.getTradingDayStatus("2100-01-10").tradingDayStatus,
    TRADING_DAY_STATUS.NON_TRADING_DAY,
  );
  assert.equal(
    provider.getTradingDayStatus("2100-01-03").tradingDayStatus,
    TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT,
  );
});

test("6. tradingDays 주말은 load 거부 CALENDAR_WEEKEND_TRADING_DAY", () => {
  const snap = makeMainCompleteSnapshot();
  const { contentChecksum, metadataHash, contentChecksumVerified, ...rest } = snap;
  rest.tradingDays = [...rest.tradingDays, "2100-01-10"];
  const loaded = loadCalendarSnapshot(rest, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "CALENDAR_WEEKEND_TRADING_DAY");
  assert.equal(
    loaded.provider.getTradingDayStatus("2100-01-05").tradingDayStatus,
    TRADING_DAY_STATUS.CALENDAR_PENDING,
  );
});

test("7. getTradingDayOnOrAfter 는 오늘이 거래일이면 오늘을 포함한다", () => {
  const provider = load(makeMainCompleteSnapshot());
  const r = provider.getTradingDayOnOrAfter("2100-01-05");
  assert.equal(r.ok, true);
  assert.equal(r.targetTradingDate, "2100-01-05");
  assert.equal(r.date, "2100-01-05");
});

test("8. getNextTradingDayAfter 는 오늘을 제외한다", () => {
  const provider = load(makeMainCompleteSnapshot());
  const r = provider.getNextTradingDayAfter("2100-01-05");
  assert.equal(r.ok, true);
  assert.equal(r.targetTradingDate, "2100-01-06");
  assert.notEqual(r.targetTradingDate, "2100-01-05");
});

test("9. addTradingDays(base, 1) 는 base 를 제외한다", () => {
  const provider = load(makeMainCompleteSnapshot());
  const r = provider.addTradingDays("2100-01-05", 1);
  assert.equal(r.targetTradingDate, "2100-01-06");
  assert.notEqual(r.targetTradingDate, "2100-01-05");
});

test("10. addTradingDays 1/5/20/60 은 long snapshot 에서 확정된다", () => {
  const provider = load(makeLongCompleteSnapshot());
  assert.equal(provider.addTradingDays("2100-01-05", 1).targetTradingDate, LONG_PLUS_1);
  assert.equal(provider.addTradingDays("2100-01-05", 5).targetTradingDate, LONG_PLUS_5);
  assert.equal(provider.addTradingDays("2100-01-05", 20).targetTradingDate, LONG_PLUS_20);
  assert.equal(provider.addTradingDays("2100-01-05", 60).targetTradingDate, LONG_PLUS_60);
  assert.equal(LONG_PLUS_1, "2100-01-06");
  assert.equal(LONG_PLUS_5, "2100-01-12");
  assert.equal(LONG_PLUS_20, "2100-02-03");
  assert.equal(LONG_PLUS_60, "2100-04-02");
});

test("11. 레거시 7 달력일 롤", () => {
  const provider = load(makeMainCompleteSnapshot());
  assert.equal(provider.resolveLegacyTarget("2100-01-05").targetTradingDate, "2100-01-12");
  assert.equal(provider.resolveLegacyTarget("2100-01-08").targetTradingDate, "2100-01-18");
  assert.equal(provider.resolveLegacyTarget("2100-01-28").targetTradingDate, "2100-02-08");
});

test("12. coverage 밖 다음 거래일은 RANGE", () => {
  const provider = load(makeMainCompleteSnapshot());
  const next = provider.getNextTradingDayAfter("2100-02-12");
  assert.equal(next.ok, false);
  assert.equal(next.targetTradingDate, null);
  assert.equal(next.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT);
  assert.equal(next.targetDateStatus, "CALENDAR_RANGE_INSUFFICIENT");
  const add = provider.addTradingDays("2100-02-12", 1);
  assert.equal(add.ok, false);
  assert.equal(add.targetDateStatus, "CALENDAR_RANGE_INSUFFICIENT");
});

test("13. 잘못된 날짜는 Date/YYYYMMDD/ISO 변환 없이 거부한다", () => {
  const provider = load(makeMainCompleteSnapshot());
  assert.equal(provider.getTradingDayStatus("2100-02-30").code, INVALID_DATE_VALUE);
  assert.equal(parseCalendarDate("2100-02-30").code, INVALID_DATE_VALUE);
  assert.equal(provider.getTradingDayStatus("nope").code, INVALID_DATE_FORMAT);
  assert.equal(provider.getTradingDayStatus(new Date("2100-01-05T00:00:00Z")).code, INVALID_DATE_FORMAT);
  assert.equal(provider.getTradingDayStatus("21000105").code, INVALID_DATE_FORMAT);
  assert.equal(provider.getTradingDayStatus("2100-01-05T15:40:00+09:00").code, INVALID_DATE_FORMAT);
});

test("14. 윤년 2104-02-29 는 TRADING_DAY", () => {
  const provider = load(makeLeapSnapshot());
  const st = provider.getTradingDayStatus("2104-02-29");
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  assert.equal(parseCalendarDate("2100-02-29").code, INVALID_DATE_VALUE);
});

test("15. 연말 경계 2100-12-31 / 2101-01-01", () => {
  const provider = load(makeYearBoundarySnapshot());
  assert.equal(provider.getTradingDayStatus("2100-12-31").tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  assert.equal(provider.getTradingDayStatus("2101-01-01").tradingDayStatus, TRADING_DAY_STATUS.NON_TRADING_DAY);
  assert.equal(provider.getNextTradingDayAfter("2100-12-31").targetTradingDate, "2101-01-03");
});

test("16. 연속 휴장 2100-02-04, 02-05 다음은 2100-02-08", () => {
  const provider = load(makeMainCompleteSnapshot());
  const r = provider.getTradingDayOnOrAfter("2100-02-04");
  assert.equal(r.targetTradingDate, "2100-02-08");
  assert.equal(provider.getTradingDayStatus("2100-02-04").tradingDayStatus, TRADING_DAY_STATUS.NON_TRADING_DAY);
  assert.equal(provider.getTradingDayStatus("2100-02-05").tradingDayStatus, TRADING_DAY_STATUS.NON_TRADING_DAY);
});

test("17. 세션 예외는 시각을 발명하지 않는다", () => {
  const provider = load(makeMainCompleteSnapshot());
  const delayed = provider.getSessionSchedule("2100-01-14");
  assert.equal(delayed.tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  assert.equal(delayed.sessionType, SESSION_TYPE.DELAYED_OPEN_SESSION);
  assert.equal(delayed.marketOpenTime, null);
  assert.equal(delayed.marketCloseTime, null);
  assert.equal(delayed.timezone, TIMEZONE_SEOUL);
  const regular = provider.getSessionSchedule("2100-01-05");
  assert.equal(regular.tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  assert.equal(regular.sessionType, SESSION_TYPE.SESSION_SCHEDULE_PENDING);
  assert.equal(regular.marketOpenTime, null);
  assert.equal(regular.marketCloseTime, null);
  assertNotHeuristicTimes(regular);
  assertNotHeuristicTimes(delayed);
});

test("addTradingDays n<1 은 INVALID_HORIZON", () => {
  const provider = load(makeMainCompleteSnapshot());
  assert.equal(provider.addTradingDays("2100-01-05", 0).code, INVALID_HORIZON);
  assert.equal(provider.addTradingDays("2100-01-05", -1).code, INVALID_HORIZON);
});

test("createCalendarProvider duck-type getTradingDayStatus", () => {
  const snap = makeMainCompleteSnapshot();
  const provider = createCalendarProvider(snap, TEST_LOAD);
  assert.equal(typeof provider.getTradingDayStatus, "function");
  assert.equal(provider.getTradingDayStatus("2100-01-05").tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  assert.equal(provider.getCoverage().completeness, COMPLETENESS.COMPLETE);
});

test("isolation: default loadCalendarSnapshot(synthetic) 는 SYNTHETIC_FIXTURE_NOT_ALLOWED", () => {
  const loaded = loadCalendarSnapshot(makeMainCompleteSnapshot());
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, SYNTHETIC_FIXTURE_NOT_ALLOWED);
});

test("isolation: TEST_LOAD 는 합성 fixture 로드에 성공한다", () => {
  const loaded = loadCalendarSnapshot(makeMainCompleteSnapshot(), TEST_LOAD);
  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(loaded.provider.getTradingDayStatus("2100-01-05").tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
});

test("isolation: 합성 fixture 를 VERIFIED 로 강제하면 어떤 모드든 SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED", () => {
  const forced = attachChecksums({
    ...makeMainCompleteSnapshot(),
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
  });
  const prod = loadCalendarSnapshot(forced);
  assert.equal(prod.ok, false);
  assert.equal(prod.code, SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED);
  const testMode = loadCalendarSnapshot(forced, TEST_LOAD);
  assert.equal(testMode.ok, false);
  assert.equal(testMode.code, SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED);
});

test("isolation: TEST_VERIFIED + PRODUCTION 은 TEST_VERIFICATION_STATUS_NOT_ALLOWED", () => {
  const snap = attachChecksums({
    ...makeMainCompleteSnapshot(),
    notProductionData: false,
    productionEligible: false,
    verificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
  });
  const loaded = loadCalendarSnapshot(snap);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, TEST_VERIFICATION_STATUS_NOT_ALLOWED);
});

test("isolation: VERIFIED + productionEligible false 는 PRODUCTION_NOT_ELIGIBLE", () => {
  const snap = attachChecksums({
    ...makeMainCompleteSnapshot(),
    notProductionData: false,
    productionEligible: false,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
  });
  const loaded = loadCalendarSnapshot(snap);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, PRODUCTION_NOT_ELIGIBLE);
});

test("isolation: createCalendarProvider(synthetic) 는 TEST opts 없이 unavailable", () => {
  const provider = createCalendarProvider(makeMainCompleteSnapshot());
  const trading = provider.getTradingDayStatus("2100-01-05");
  assert.equal(trading.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.notEqual(trading.tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  const missing = provider.getTradingDayStatus("2100-01-15");
  assert.equal(missing.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.notEqual(missing.tradingDayStatus, TRADING_DAY_STATUS.NON_TRADING_DAY);
});
