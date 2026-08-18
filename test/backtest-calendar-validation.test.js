"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TIMEZONE,
  MARKET,
  CALENDAR_STATUS,
  FIXTURE_TYPE,
  DAY_STATUS,
  SESSION_STATUS,
  STATUS_SOURCE,
  STATUS,
  ERROR,
  ENVELOPE_FIELDS,
  DAY_FIELDS,
  validateCalendarEnvelope,
  validateCalendarDay,
  validateCalendarSequence,
  validateCalendarCoverage,
  validateRequestedRange,
  validateCandleDatesAgainstCalendar,
  countTradingDays,
  validateWarmupRange,
  validateEvaluationRange,
  createCalendarValidationResult,
  makeSafeCalendarError,
} = require("../lib/backtest/calendar-validation");

const MODULE_PATH = path.join(__dirname, "..", "lib", "backtest", "calendar-validation.js");

// --- 합성 데이터 생성 헬퍼 (외부 픽스처 파일 없이 테스트 내부에서만 사용) ---

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDays(ymd, n) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function isWeekend(ymd) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function makeDay(tradingDate, options) {
  const opts = options || {};
  return {
    tradingDate,
    dayStatus: opts.dayStatus || (isWeekend(tradingDate)
      ? DAY_STATUS.NON_TRADING_DAY
      : DAY_STATUS.TRADING_DAY),
    sessionStatus: opts.sessionStatus || SESSION_STATUS.FINAL,
    statusSource: opts.statusSource || STATUS_SOURCE.SYNTHETIC_EXPLICIT,
    market: opts.market || MARKET.SYNTHETIC_KOSPI,
    calendarId: opts.calendarId || "synthetic-calendar-unit",
  };
}

/** 2100년대 연속 달력일(주말 포함) 캘린더를 만든다. 주말은 NON_TRADING_DAY. */
function buildCalendar(options) {
  const opts = options || {};
  const start = opts.start || "2100-01-04";
  const dayCount = opts.dayCount || 30;
  const market = opts.market || MARKET.SYNTHETIC_KOSPI;
  const calendarId = opts.calendarId || "synthetic-calendar-unit";
  const days = [];
  for (let i = 0; i < dayCount; i += 1) {
    days.push(makeDay(addDays(start, i), { market, calendarId }));
  }
  return {
    calendarId,
    calendarVersion: opts.calendarVersion || "synthetic-v1",
    calendarStatus: CALENDAR_STATUS.TEST_VERIFIED,
    fixtureType: FIXTURE_TYPE.SYNTHETIC,
    notProductionData: true,
    productionEligible: false,
    market,
    timezone: TIMEZONE,
    coverage: { from: start, to: addDays(start, dayCount - 1) },
    generatedAt: "2100-01-01T00:00:00+09:00",
    verifiedAt: "2100-01-01T00:00:00+09:00",
    days,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function codesOf(result) {
  return result.errors.map((e) => e.code);
}

function tradingDatesOf(calendar) {
  return calendar.days
    .filter((d) => d.dayStatus === DAY_STATUS.TRADING_DAY)
    .map((d) => d.tradingDate);
}

function makeCandle(tradingDate, market) {
  return {
    symbol: "SYNTH0001",
    market: market || MARKET.SYNTHETIC_KOSPI,
    tradingDate,
  };
}

const LONG_CALENDAR = buildCalendar({ start: "2100-01-04", dayCount: 600 });
const LONG_TRADING_DATES = tradingDatesOf(LONG_CALENDAR);

// ===== Envelope·격리 (1~12) =====

test("01. Envelope: 정상 합성 캘린더 봉투는 통과한다", () => {
  const result = validateCalendarEnvelope(buildCalendar({ dayCount: 10 }), { mode: "TEST" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(ENVELOPE_FIELDS.slice(), [
    "calendarId",
    "calendarVersion",
    "calendarStatus",
    "fixtureType",
    "notProductionData",
    "productionEligible",
    "market",
    "timezone",
    "coverage",
    "generatedAt",
    "verifiedAt",
    "days",
  ]);
});

test("02. Envelope: 허용되지 않은 최상위 필드는 UNKNOWN_FIELD", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.holidayName = "SYNTHETIC_HOLIDAY";
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.UNKNOWN_FIELD));
  assert.equal(result.errors[0].field, "holidayName");
});

test("03. Envelope: 필수 필드 누락은 MISSING_REQUIRED_FIELD", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  delete calendar.calendarVersion;
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.MISSING_REQUIRED_FIELD));
});

test("04. Envelope: calendarId 격리 접두사 위반은 INVALID_CALENDAR_ID", () => {
  const calendar = buildCalendar({ dayCount: 5, calendarId: "krx-calendar-2024" });
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_CALENDAR_ID));
});

test("05. Envelope: calendarVersion 이 빈 문자열이면 INVALID_CALENDAR_VERSION", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.calendarVersion = "";
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_CALENDAR_VERSION));
});

test("06. Envelope: calendarStatus 가 TEST_VERIFIED 가 아니면 INVALID_CALENDAR_STATUS", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.calendarStatus = "VERIFIED";
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_CALENDAR_STATUS));
});

test("07. Envelope: fixtureType 이 SYNTHETIC 이 아니면 INVALID_FIXTURE_TYPE", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.fixtureType = "REAL";
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_FIXTURE_TYPE));
});

test("08. Envelope: notProductionData 가 true 가 아니면 격리 위반으로 차단", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.notProductionData = false;
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_FIXTURE_TYPE));
});

test("09. Envelope: productionEligible=true 는 SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.productionEligible = true;
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION));
});

test("10. Envelope: 실제 시장 코드 KOSPI 는 INVALID_MARKET 으로 거부", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.market = "KOSPI";
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_MARKET));
});

test("11. Envelope: timezone 이 Asia/Seoul 이 아니면 INVALID_TIMEZONE", () => {
  const calendar = buildCalendar({ dayCount: 5 });
  calendar.timezone = "UTC";
  const result = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_TIMEZONE));
});

test("12. Envelope: PRODUCTION 모드는 SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION", () => {
  const result = validateCalendarEnvelope(buildCalendar({ dayCount: 5 }), { mode: "PRODUCTION" });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION]);
});

// ===== Day 레코드 (13~26) =====

test("13. Day: 정상 레코드는 통과하고 허용 필드 목록이 고정되어 있다", () => {
  const day = makeDay("2100-01-04");
  const result = validateCalendarDay(day, {
    market: MARKET.SYNTHETIC_KOSPI,
    calendarId: "synthetic-calendar-unit",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(DAY_FIELDS.slice(), [
    "tradingDate",
    "dayStatus",
    "sessionStatus",
    "statusSource",
    "market",
    "calendarId",
  ]);
});

test("14. Day: date 별칭 사용은 DATE_ALIAS_NOT_ALLOWED", () => {
  const day = makeDay("2100-01-04");
  day.date = "2100-01-04";
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.DATE_ALIAS_NOT_ALLOWED));
  assert.ok(!codesOf(result).includes(ERROR.UNKNOWN_FIELD));
});

test("15. Day: 허용되지 않은 필드는 UNKNOWN_FIELD", () => {
  const day = makeDay("2100-01-04");
  day.sessionOpenTime = "09:00";
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.UNKNOWN_FIELD));
});

test("16. Day: 필수 필드 누락은 MISSING_REQUIRED_FIELD", () => {
  const day = makeDay("2100-01-04");
  delete day.statusSource;
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.MISSING_REQUIRED_FIELD));
});

test("17. Day: tradingDate 형식 오류는 INVALID_TRADING_DATE", () => {
  const day = makeDay("2100-01-04");
  day.tradingDate = "21000104";
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_TRADING_DATE));
});

test("18. Day: 2099년 등 합성 범위 이전 날짜는 INVALID_TRADING_DATE", () => {
  const day = makeDay("2100-01-04");
  day.tradingDate = "2099-12-31";
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_TRADING_DATE));
});

test("19. Day: 2200년 등 합성 범위 이후 날짜는 INVALID_TRADING_DATE", () => {
  const day = makeDay("2100-01-04");
  day.tradingDate = "2200-01-01";
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_TRADING_DATE));
});

test("20. Day: 미지원 dayStatus 는 INVALID_DAY_STATUS", () => {
  const day = makeDay("2100-01-04", { dayStatus: "HALF_DAY" });
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_DAY_STATUS));
});

test("21. Day: 미지원 sessionStatus 는 INVALID_SESSION_STATUS", () => {
  const day = makeDay("2100-01-04", { sessionStatus: "UNKNOWN" });
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_SESSION_STATUS));
});

test("22. Day: statusSource TIME_HEURISTIC 은 INVALID_STATUS_SOURCE", () => {
  const day = makeDay("2100-01-04", { statusSource: "TIME_HEURISTIC" });
  const result = validateCalendarDay(day, {});
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_STATUS_SOURCE));
});

test("23. Day: 실제 시장 코드 KOSDAQ 은 INVALID_MARKET", () => {
  const day = makeDay("2100-01-04", { market: "KOSDAQ" });
  const result = validateCalendarDay(day, { market: MARKET.SYNTHETIC_KOSPI });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_MARKET));
});

test("24. Day: 봉투 market 과 불일치하면 CALENDAR_MARKET_MISMATCH", () => {
  const day = makeDay("2100-01-04", { market: MARKET.SYNTHETIC_KOSDAQ });
  const result = validateCalendarDay(day, { market: MARKET.SYNTHETIC_KOSPI });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_MARKET_MISMATCH));
});

test("25. Day: 봉투 calendarId 와 불일치하면 CALENDAR_ID_MISMATCH", () => {
  const day = makeDay("2100-01-04", { calendarId: "synthetic-calendar-other" });
  const result = validateCalendarDay(day, { calendarId: "synthetic-calendar-unit" });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_ID_MISMATCH));
});

test("26. Day: 입력 레코드를 변경하지 않는다(불변)", () => {
  const day = Object.freeze(makeDay("2100-01-04"));
  const snapshot = clone(day);
  const result = validateCalendarDay(day, {
    market: MARKET.SYNTHETIC_KOSPI,
    calendarId: "synthetic-calendar-unit",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(day, snapshot);
});

// ===== 정렬·coverage (27~37) =====

test("27. 정렬: tradingDate 엄격 오름차순이면 통과", () => {
  const calendar = buildCalendar({ dayCount: 20 });
  const result = validateCalendarSequence(calendar.days, {
    market: calendar.market,
    calendarId: calendar.calendarId,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("28. 정렬: 역순 날짜는 NON_MONOTONIC_CALENDAR_DATE", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  const days = calendar.days.slice();
  const swapped = days[3];
  days[3] = days[4];
  days[4] = swapped;
  const result = validateCalendarSequence(days, {
    market: calendar.market,
    calendarId: calendar.calendarId,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.NON_MONOTONIC_CALENDAR_DATE));
});

test("29. 정렬: 중복 날짜는 DUPLICATE_CALENDAR_DATE", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  const days = calendar.days.slice();
  days.splice(4, 0, clone(days[3]));
  const result = validateCalendarSequence(days, {
    market: calendar.market,
    calendarId: calendar.calendarId,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.DUPLICATE_CALENDAR_DATE));
});

test("30. 정렬: 자동 정렬·중복제거를 하지 않고 입력 배열을 보존한다", () => {
  const calendar = buildCalendar({ dayCount: 6 });
  const days = calendar.days.slice().reverse();
  const before = days.map((d) => d.tradingDate);
  const result = validateCalendarSequence(days, {
    market: calendar.market,
    calendarId: calendar.calendarId,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(days.map((d) => d.tradingDate), before);
  assert.equal(days.length, before.length);
});

test("31. coverage: from > to 는 INVALID_COVERAGE_RANGE", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  calendar.coverage = { from: "2100-02-10", to: "2100-02-01" };
  const result = validateCalendarCoverage(calendar);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.INVALID_COVERAGE_RANGE));
});

test("32. coverage: 첫날이 coverage.from 이전이면 CALENDAR_DATE_OUTSIDE_COVERAGE", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  calendar.days.unshift(makeDay(addDays(calendar.coverage.from, -1)));
  const result = validateCalendarCoverage(calendar);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE));
});

test("33. coverage: 마지막날이 coverage.to 이후면 CALENDAR_DATE_OUTSIDE_COVERAGE", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  calendar.days.push(makeDay(addDays(calendar.coverage.to, 1)));
  const result = validateCalendarCoverage(calendar);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE));
});

test("34. coverage: 구간 내 달력일이 빠지면 CALENDAR_DATE_MISSING", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  const removed = calendar.days.splice(5, 1)[0];
  const result = validateCalendarCoverage(calendar);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_DATE_MISSING));
  assert.ok(result.errors.some((e) => e.tradingDate === removed.tradingDate));
});

test("35. coverage: 주말 포함 모든 달력일이 존재하면 통과", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const result = validateCalendarCoverage(calendar);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(calendar.days.some((d) => d.dayStatus === DAY_STATUS.NON_TRADING_DAY));
});

test("36. 요청범위: coverage 시작보다 앞선 요청은 CALENDAR_RANGE_INSUFFICIENT", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  const result = validateRequestedRange({
    calendar,
    requiredFrom: addDays(calendar.coverage.from, -1),
    requiredTo: calendar.coverage.to,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_RANGE_INSUFFICIENT]);
});

test("37. 요청범위: coverage 종료 이후 요청은 CALENDAR_RANGE_INSUFFICIENT (근접 보정 없음)", () => {
  const calendar = buildCalendar({ dayCount: 10 });
  const requiredTo = addDays(calendar.coverage.to, 3);
  const result = validateRequestedRange({
    calendar,
    requiredFrom: calendar.coverage.from,
    requiredTo,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_RANGE_INSUFFICIENT]);
  assert.equal(result.errors[0].tradingDate, requiredTo);
  assert.equal(calendar.coverage.to, addDays(calendar.coverage.from, 9));
});

// ===== 캔들 대조 (38~46) =====

test("38. 캔들: 모든 캔들이 거래일이면 통과", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const candles = tradingDatesOf(calendar).map((d) => makeCandle(d));
  const result = validateCandleDatesAgainstCalendar({
    candles,
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("39. 캔들: 비거래일 캔들은 CANDLE_ON_NON_TRADING_DAY", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const nonTrading = calendar.days.find((d) => d.dayStatus === DAY_STATUS.NON_TRADING_DAY);
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(nonTrading.tradingDate)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CANDLE_ON_NON_TRADING_DAY]);
});

test("40. 캔들: 캘린더 레코드가 없는 날짜는 CALENDAR_DATE_MISSING", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const removed = calendar.days.splice(10, 1)[0];
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(removed.tradingDate)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_DATE_MISSING]);
});

test("41. 캔들: coverage 밖 날짜는 CALENDAR_DATE_OUTSIDE_COVERAGE", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(addDays(calendar.coverage.to, 5))],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE]);
});

test("42. 캔들: 캔들 market 불일치는 CALENDAR_MARKET_MISMATCH", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const tradingDate = tradingDatesOf(calendar)[0];
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(tradingDate, MARKET.SYNTHETIC_KOSDAQ)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_MARKET_MISMATCH]);
});

test("43. 캔들: 캘린더 market 불일치는 CALENDAR_MARKET_MISMATCH", () => {
  const calendar = buildCalendar({ dayCount: 30, market: MARKET.SYNTHETIC_KOSDAQ });
  const tradingDate = tradingDatesOf(calendar)[0];
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(tradingDate, MARKET.SYNTHETIC_KOSPI)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_MARKET_MISMATCH]);
});

test("44. 캔들: sessionStatus PENDING 인 날짜는 SESSION_SCHEDULE_PENDING", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const target = calendar.days.find((d) => d.dayStatus === DAY_STATUS.TRADING_DAY);
  target.sessionStatus = SESSION_STATUS.PENDING;
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(target.tradingDate)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.SESSION_SCHEDULE_PENDING]);
});

test("45. 캔들: dayStatus CONFLICT 인 날짜는 CALENDAR_SOURCE_CONFLICT", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const target = calendar.days.find((d) => d.dayStatus === DAY_STATUS.TRADING_DAY);
  target.dayStatus = DAY_STATUS.CONFLICT;
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(target.tradingDate)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_SOURCE_CONFLICT]);
});

test("46. 캔들: 요청 범위가 coverage 를 벗어나면 CALENDAR_RANGE_INSUFFICIENT", () => {
  const calendar = buildCalendar({ start: "2100-03-01", dayCount: 30 });
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(tradingDatesOf(calendar)[0])],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
    requiredFrom: addDays(calendar.coverage.from, -10),
    requiredTo: calendar.coverage.to,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_RANGE_INSUFFICIENT));
});

// ===== 웜업·평가 (47~56) =====

test("47. countTradingDays: TRADING_DAY 만 계산한다", () => {
  const manual = [
    makeDay("2100-03-01", { dayStatus: DAY_STATUS.TRADING_DAY }),
    makeDay("2100-03-02", { dayStatus: DAY_STATUS.NON_TRADING_DAY }),
    makeDay("2100-03-03", { dayStatus: DAY_STATUS.TRADING_DAY }),
    makeDay("2100-03-04", { dayStatus: DAY_STATUS.PENDING }),
  ];
  assert.equal(countTradingDays(manual, null, null), 2);
  assert.equal(countTradingDays([], null, null), 0);
});

test("48. countTradingDays: 구간 양끝을 포함한다", () => {
  const manual = [
    makeDay("2100-03-01", { dayStatus: DAY_STATUS.TRADING_DAY }),
    makeDay("2100-03-02", { dayStatus: DAY_STATUS.TRADING_DAY }),
    makeDay("2100-03-03", { dayStatus: DAY_STATUS.TRADING_DAY }),
  ];
  assert.equal(countTradingDays(manual, "2100-03-01", "2100-03-03"), 3);
  assert.equal(countTradingDays(manual, "2100-03-02", "2100-03-02"), 1);
  assert.equal(countTradingDays(manual, "2100-03-04", "2100-03-09"), 0);
});

test("49. 웜업: 252 거래일이 확보되면 통과", () => {
  const featureStart = LONG_TRADING_DATES[252];
  const result = validateWarmupRange({
    calendar: LONG_CALENDAR,
    requiredWarmupTradingDays: 252,
    featureStartTradingDate: featureStart,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tradingDayCount, 252);
  assert.deepEqual(result.errors, []);
});

test("50. 웜업: 251 거래일이면 CALENDAR_WARMUP_INSUFFICIENT", () => {
  const featureStart = LONG_TRADING_DATES[251];
  const result = validateWarmupRange({
    calendar: LONG_CALENDAR,
    requiredWarmupTradingDays: 252,
    featureStartTradingDate: featureStart,
  });
  assert.equal(result.ok, false);
  assert.equal(result.tradingDayCount, 251);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_WARMUP_INSUFFICIENT]);
});

test("51. 웜업: requiredWarmupTradingDays 누락은 MISSING_REQUIRED_FIELD (기본값 없음)", () => {
  const result = validateWarmupRange({
    calendar: LONG_CALENDAR,
    featureStartTradingDate: LONG_TRADING_DATES[252],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.MISSING_REQUIRED_FIELD]);
  assert.equal(result.errors[0].field, "requiredWarmupTradingDays");
});

test("52. 웜업: featureStartTradingDate 누락은 MISSING_REQUIRED_FIELD", () => {
  const result = validateWarmupRange({
    calendar: LONG_CALENDAR,
    requiredWarmupTradingDays: 252,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.MISSING_REQUIRED_FIELD]);
  assert.equal(result.errors[0].field, "featureStartTradingDate");
});

test("53. 평가: 60 거래일 구간이 확보되면 통과", () => {
  const featureStart = LONG_TRADING_DATES[252];
  const evaluationEnd = LONG_TRADING_DATES[252 + 59];
  const result = validateEvaluationRange({
    calendar: LONG_CALENDAR,
    requiredEvaluationTradingDays: 60,
    featureStartTradingDate: featureStart,
    evaluationEndTradingDate: evaluationEnd,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tradingDayCount, 60);
});

test("54. 평가: 59 거래일이면 CALENDAR_EVALUATION_RANGE_INSUFFICIENT", () => {
  const featureStart = LONG_TRADING_DATES[252];
  const evaluationEnd = LONG_TRADING_DATES[252 + 58];
  const result = validateEvaluationRange({
    calendar: LONG_CALENDAR,
    requiredEvaluationTradingDays: 60,
    featureStartTradingDate: featureStart,
    evaluationEndTradingDate: evaluationEnd,
  });
  assert.equal(result.ok, false);
  assert.equal(result.tradingDayCount, 59);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_EVALUATION_RANGE_INSUFFICIENT]);
});

test("55. 평가: 구간 내 sessionStatus PENDING 은 SESSION_SCHEDULE_PENDING", () => {
  const calendar = clone(LONG_CALENDAR);
  const featureStart = LONG_TRADING_DATES[252];
  const evaluationEnd = LONG_TRADING_DATES[252 + 59];
  const target = calendar.days.find((d) => d.tradingDate === LONG_TRADING_DATES[252 + 10]);
  target.sessionStatus = SESSION_STATUS.PENDING;
  const result = validateEvaluationRange({
    calendar,
    requiredEvaluationTradingDays: 60,
    featureStartTradingDate: featureStart,
    evaluationEndTradingDate: evaluationEnd,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.SESSION_SCHEDULE_PENDING));
});

test("56. 평가: 평가 종료일이 coverage 밖이면 CALENDAR_DATE_OUTSIDE_COVERAGE", () => {
  const result = validateEvaluationRange({
    calendar: LONG_CALENDAR,
    requiredEvaluationTradingDays: 60,
    featureStartTradingDate: LONG_TRADING_DATES[252],
    evaluationEndTradingDate: addDays(LONG_CALENDAR.coverage.to, 1),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE]);
});

// ===== 상태·안전 (57~70) =====

test("57. 상태: dayStatus PENDING 은 CALENDAR_PENDING 으로 차단", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const target = calendar.days.find((d) => d.dayStatus === DAY_STATUS.TRADING_DAY);
  target.dayStatus = DAY_STATUS.PENDING;
  const result = validateEvaluationRange({
    calendar,
    requiredEvaluationTradingDays: 1,
    featureStartTradingDate: calendar.coverage.from,
    evaluationEndTradingDate: calendar.coverage.to,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_PENDING));
});

test("58. 상태: dayStatus CONFLICT 는 CALENDAR_SOURCE_CONFLICT 로 차단", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const target = calendar.days.find((d) => d.dayStatus === DAY_STATUS.TRADING_DAY);
  target.dayStatus = DAY_STATUS.CONFLICT;
  const result = validateEvaluationRange({
    calendar,
    requiredEvaluationTradingDays: 1,
    featureStartTradingDate: calendar.coverage.from,
    evaluationEndTradingDate: calendar.coverage.to,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.CALENDAR_SOURCE_CONFLICT));
});

test("59. 상태: sessionStatus PENDING 은 SESSION_SCHEDULE_PENDING 으로 차단", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const target = calendar.days.find((d) => d.dayStatus === DAY_STATUS.TRADING_DAY);
  target.sessionStatus = SESSION_STATUS.PENDING;
  const result = validateEvaluationRange({
    calendar,
    requiredEvaluationTradingDays: 1,
    featureStartTradingDate: calendar.coverage.from,
    evaluationEndTradingDate: calendar.coverage.to,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR.SESSION_SCHEDULE_PENDING));
});

test("60. 상태: calendarStatus 가 TEST_VERIFIED 여도 개별 날짜 검사를 생략하지 않는다", () => {
  const calendar = buildCalendar({ dayCount: 30 });
  const target = calendar.days.find((d) => d.dayStatus === DAY_STATUS.TRADING_DAY);
  target.dayStatus = DAY_STATUS.PENDING;
  const envelope = validateCalendarEnvelope(calendar, { mode: "TEST" });
  assert.equal(envelope.ok, true);
  assert.equal(calendar.calendarStatus, CALENDAR_STATUS.TEST_VERIFIED);
  const result = validateCandleDatesAgainstCalendar({
    candles: [makeCandle(target.tradingDate)],
    calendar,
    market: MARKET.SYNTHETIC_KOSPI,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [ERROR.CALENDAR_PENDING]);
});

test("61. 안전: makeSafeCalendarError 는 허용 필드만 유지한다", () => {
  const err = makeSafeCalendarError({
    code: ERROR.CALENDAR_PENDING,
    severity: "ERROR",
    field: "dayStatus",
    recordIndex: 3,
    calendarId: "synthetic-calendar-unit",
    calendarVersion: "synthetic-v1",
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2100-01-04",
    dayStatus: DAY_STATUS.PENDING,
    sessionStatus: SESSION_STATUS.PENDING,
  });
  assert.deepEqual(Object.keys(err).slice().sort(), [
    "calendarId",
    "calendarVersion",
    "code",
    "dayStatus",
    "field",
    "market",
    "recordIndex",
    "sessionStatus",
    "severity",
    "tradingDate",
  ].sort());
});

test("62. 안전: makeSafeCalendarError 는 금지 페이로드를 제거한다", () => {
  const err = makeSafeCalendarError({
    code: ERROR.CALENDAR_SOURCE_CONFLICT,
    days: [makeDay("2100-01-04")],
    candles: [makeCandle("2100-01-04")],
    calendar: buildCalendar({ dayCount: 2 }),
    input: { secret: 1 },
    apiKey: "k-123",
    accessToken: "t-123",
    accountId: "acct-1",
    stack: "Error: boom",
  });
  assert.deepEqual(Object.keys(err).slice().sort(), ["code", "severity"]);
});

test("63. 결과: 정상 합성 검증은 syntheticCalendarVerified=true 와 전용 status", () => {
  const result = createCalendarValidationResult({
    schemaValid: true,
    candleDatesVerified: true,
    warmupRangeVerified: true,
    evaluationRangeVerified: true,
    syntheticCalendarVerified: true,
    errors: [],
  });
  assert.equal(result.syntheticCalendarVerified, true);
  assert.equal(result.status, STATUS.SYNTHETIC_CALENDAR_VERIFIED);
  assert.equal(result.schemaValid, true);
  assert.deepEqual(result.errorCodes, []);
});

test("64. 결과: 운영 승격 플래그는 항상 false 로 고정된다", () => {
  const result = createCalendarValidationResult({
    schemaValid: true,
    syntheticCalendarVerified: true,
    errors: [],
  });
  assert.equal(result.calendarVerified, false);
  assert.equal(result.calendarDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
});

test("65. 결과: 스키마 오류는 BLOCKED_CALENDAR_SCHEMA", () => {
  const result = createCalendarValidationResult({
    schemaValid: false,
    errors: [{ code: ERROR.UNKNOWN_FIELD, field: "holidayName" }],
  });
  assert.equal(result.status, STATUS.BLOCKED_CALENDAR_SCHEMA);
  assert.equal(result.schemaValid, false);
  assert.equal(result.syntheticCalendarVerified, false);
});

test("66. 결과: 범위 오류는 BLOCKED_CALENDAR_RANGE", () => {
  const result = createCalendarValidationResult({
    schemaValid: true,
    errors: [
      { code: ERROR.CALENDAR_RANGE_INSUFFICIENT },
      { code: ERROR.CALENDAR_WARMUP_INSUFFICIENT },
    ],
  });
  assert.equal(result.status, STATUS.BLOCKED_CALENDAR_RANGE);
  assert.deepEqual(result.errorCodes, [
    ERROR.CALENDAR_RANGE_INSUFFICIENT,
    ERROR.CALENDAR_WARMUP_INSUFFICIENT,
  ]);
});

test("67. 결과: 상태 오류는 BLOCKED_CALENDAR_STATUS", () => {
  const result = createCalendarValidationResult({
    schemaValid: true,
    errors: [{ code: ERROR.CALENDAR_PENDING }, { code: ERROR.SESSION_SCHEDULE_PENDING }],
  });
  assert.equal(result.status, STATUS.BLOCKED_CALENDAR_STATUS);
});

test("68. 결과: 캔들 불일치는 BLOCKED_CANDLE_CALENDAR_MISMATCH, 그 외는 기본 status", () => {
  const mismatch = createCalendarValidationResult({
    schemaValid: true,
    errors: [{ code: ERROR.CANDLE_ON_NON_TRADING_DAY }],
  });
  assert.equal(mismatch.status, STATUS.BLOCKED_CANDLE_CALENDAR_MISMATCH);
  const fallback = createCalendarValidationResult({
    schemaValid: true,
    errors: [{ code: ERROR.SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION }],
  });
  assert.equal(fallback.status, STATUS.BLOCKED_CALENDAR_VALIDATION);
});

test("69. 안전: 모듈 소스에 외부 통신 참조가 없다", () => {
  const source = fs.readFileSync(MODULE_PATH, "utf8");
  assert.equal(/axios/i.test(source), false);
  assert.equal(/fetch/i.test(source), false);
  assert.equal(/https?/i.test(source), false);
  assert.equal(/\bhttp\b/i.test(source), false);
});

test("70. 안전: 모듈 소스에 주문·체결 관련 참조가 없다", () => {
  const source = fs.readFileSync(MODULE_PATH, "utf8");
  assert.equal(/order/i.test(source), false);
  assert.equal(/submit/i.test(source), false);
  assert.equal(/broker/i.test(source), false);
});
