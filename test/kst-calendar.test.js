/**
 * KST 날짜·KRX 캘린더 단위 테스트.
 * child_process TZ=UTC vs Asia/Seoul 동일 결과. 패키지 설치 없음.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

const { formatKstDate, formatKstDateTimeIso } = require("../lib/calendar/kst");
const {
  parseTradingDate,
  normalizeTradingDate,
  addCalendarDays,
  nextTradingDayOnOrAfter,
  resolveLegacyTarget,
  createTradingCalendar,
  createUnavailableCalendar,
  INVALID_DATE_FORMAT,
  INVALID_HORIZON,
} = require("../lib/calendar/krx-calendar");
const {
  TRADING_DAYS_2026_08,
  COMBINED_TRADING_DAYS,
  TRADING_DAYS_YEAR_END,
  TRADING_DAYS_2026_ONLY_YEAR_END,
  LEGACY_TARGET_FROM_0814,
  LEGACY_TARGET_FROM_0810,
  LEGACY_TARGET_FROM_0815,
  LEGACY_TARGET_FROM_0816,
  LEGACY_TARGET_FROM_1224,
} = require("./fixtures/krx-calendar");

const kstPath = path.join(__dirname, "../lib/calendar/kst.js");

function runWithTz(tz, source) {
  const result = spawnSync(process.execPath, ["-e", source], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || "child failed");
  return result.stdout.trim();
}

test("KST 00:00 / 08:59 / 09:00 / 15:40", () => {
  assert.equal(formatKstDate("2026-08-14T00:00:00+09:00"), "2026-08-14");
  assert.equal(formatKstDate("2026-08-14T08:59:00+09:00"), "2026-08-14");
  assert.equal(formatKstDate("2026-08-14T09:00:00+09:00"), "2026-08-14");
  assert.equal(formatKstDate("2026-08-14T15:40:00+09:00"), "2026-08-14");
  assert.equal(formatKstDateTimeIso("2026-08-14T15:40:00+09:00"), "2026-08-14T15:40:00+09:00");
});

test("UTC 시각이 KST 날짜와 다름", () => {
  assert.equal(formatKstDate("2026-08-13T15:30:00Z"), "2026-08-14");
  assert.equal(formatKstDate("2026-08-14T14:59:00Z"), "2026-08-14");
  assert.equal(formatKstDate("2026-08-14T15:00:00Z"), "2026-08-15");
  assert.notEqual("2026-08-14T15:00:00Z".slice(0, 10), formatKstDate("2026-08-14T15:00:00Z"));
});

test("TZ=UTC 와 TZ=Asia/Seoul 에서 같은 결과", () => {
  const expr = `
    const { formatKstDate, formatKstDateTimeIso } = require(${JSON.stringify(kstPath)});
    const d = new Date("2026-08-14T00:30:00Z");
    process.stdout.write(formatKstDate(d) + " " + formatKstDateTimeIso(d));
  `;
  const utc = runWithTz("UTC", expr);
  const seoul = runWithTz("Asia/Seoul", expr);
  assert.equal(utc, seoul);
  assert.equal(utc, "2026-08-14 2026-08-14T09:30:00+09:00");
});

test("parseTradingDate 거부 / ISO Instant / YYYY-MM-DD", () => {
  assert.equal(parseTradingDate("2026-02-30").ok, false);
  assert.equal(parseTradingDate("2026-02-30").code, INVALID_DATE_FORMAT);
  assert.equal(parseTradingDate("20261301").ok, false);
  assert.equal(parseTradingDate("not-a-date").ok, false);
  assert.equal(parseTradingDate("2026-08-14").ok, true);
  assert.equal(parseTradingDate("2026-08-14").date, "2026-08-14");
  assert.equal(parseTradingDate("20260814").date, "2026-08-14");
  assert.equal(parseTradingDate("2026-08-13T15:30:00Z").date, "2026-08-14");
  assert.equal(parseTradingDate("2026-08-14T15:40:00+09:00").date, "2026-08-14");
  assert.equal(parseTradingDate("2026-08-14T20:00:00Z").date, "2026-08-15");
  assert.notEqual(parseTradingDate("2026-08-14T20:00:00Z").date, "2026-08-14T20:00:00Z".slice(0, 10));
  assert.throws(() => normalizeTradingDate("2026-02-30"), TypeError);
});

test("resolveLegacyTarget 정책 예시", () => {
  const cal = createTradingCalendar(COMBINED_TRADING_DAYS);
  assert.equal(resolveLegacyTarget("2026-08-14", cal).targetTradingDate, LEGACY_TARGET_FROM_0814);
  assert.equal(resolveLegacyTarget("2026-08-10", cal).targetTradingDate, LEGACY_TARGET_FROM_0810);
  assert.equal(resolveLegacyTarget("2026-08-15", cal).targetTradingDate, LEGACY_TARGET_FROM_0815);
  assert.equal(resolveLegacyTarget("2026-08-16", cal).targetTradingDate, LEGACY_TARGET_FROM_0816);
  assert.equal(resolveLegacyTarget("2026-12-24", cal).targetTradingDate, LEGACY_TARGET_FROM_1224);
  const none = createUnavailableCalendar();
  assert.equal(resolveLegacyTarget("2026-08-14", none).ok, false);
  assert.equal(resolveLegacyTarget("2026-08-14", none).evaluationStatus, "CALENDAR_PENDING");
});

test("addCalendarDays 와 addTradingDays n<1", () => {
  assert.equal(addCalendarDays("2026-08-14", 7), "2026-08-21");
  assert.equal(addCalendarDays("2026-08-15", 7), "2026-08-22");
  assert.equal(addCalendarDays("2026-12-24", 7), "2026-12-31");
  const cal = createTradingCalendar(TRADING_DAYS_2026_08);
  const z = cal.addTradingDays("2026-08-14", 0);
  assert.equal(z.ok, false);
  assert.equal(z.code, INVALID_HORIZON);
  const neg = cal.addTradingDays("2026-08-14", -1);
  assert.equal(neg.code, INVALID_HORIZON);
});

test("연말 2026-12-24+7 → 2027-01-04 (목록에 01-04 있음)", () => {
  const cal = createTradingCalendar(TRADING_DAYS_YEAR_END);
  const r = resolveLegacyTarget("2026-12-24", cal);
  assert.equal(r.ok, true);
  assert.equal(r.targetTradingDate, LEGACY_TARGET_FROM_1224);
  assert.equal(r.targetTradingDate, "2027-01-04");
});

test("연말 TRADING_DAYS_2026_ONLY_YEAR_END → CALENDAR_PENDING (01-02 만들지 않음)", () => {
  const cal = createTradingCalendar(TRADING_DAYS_2026_ONLY_YEAR_END);
  const r = resolveLegacyTarget("2026-12-24", cal);
  assert.equal(r.ok, false);
  assert.equal(r.evaluationStatus, "CALENDAR_PENDING");
  assert.equal(r.targetTradingDate, null);
  assert.notEqual(r.targetTradingDate, "2027-01-02");
});

test("목록에 2027-01-02 토요일이 있어도 반환하지 않음", () => {
  const withSatAndMon = [...TRADING_DAYS_YEAR_END, "2027-01-02"];
  const calOk = createTradingCalendar(withSatAndMon);
  assert.equal(calOk.has("2027-01-02"), false);
  assert.equal(resolveLegacyTarget("2026-12-24", calOk).targetTradingDate, "2027-01-04");
  const directOk = nextTradingDayOnOrAfter("2026-12-31", withSatAndMon);
  assert.equal(directOk.targetTradingDate, "2027-01-04");
  assert.notEqual(directOk.targetTradingDate, "2027-01-02");

  const onlySat = [...TRADING_DAYS_2026_ONLY_YEAR_END, "2027-01-02"];
  const calPending = createTradingCalendar(onlySat);
  const r = resolveLegacyTarget("2026-12-24", calPending);
  assert.equal(r.ok, false);
  assert.equal(r.evaluationStatus, "CALENDAR_PENDING");
  const directPending = nextTradingDayOnOrAfter("2026-12-31", onlySat);
  assert.equal(directPending.ok, false);
  assert.equal(directPending.evaluationStatus, "CALENDAR_PENDING");
});

test("목록에 2027-01-03 일요일이 있어도 반환하지 않음", () => {
  const withSunAndMon = [...TRADING_DAYS_YEAR_END, "2027-01-03"];
  const calOk = createTradingCalendar(withSunAndMon);
  assert.equal(calOk.has("2027-01-03"), false);
  assert.equal(resolveLegacyTarget("2026-12-24", calOk).targetTradingDate, "2027-01-04");
  const directOk = nextTradingDayOnOrAfter("2026-12-31", withSunAndMon);
  assert.equal(directOk.targetTradingDate, "2027-01-04");
  assert.notEqual(directOk.targetTradingDate, "2027-01-03");

  const onlySun = [...TRADING_DAYS_2026_ONLY_YEAR_END, "2027-01-03"];
  const calPending = createTradingCalendar(onlySun);
  const r = resolveLegacyTarget("2026-12-24", calPending);
  assert.equal(r.ok, false);
  assert.equal(r.evaluationStatus, "CALENDAR_PENDING");
  const directPending = nextTradingDayOnOrAfter("2026-12-31", onlySun);
  assert.equal(directPending.ok, false);
  assert.equal(directPending.evaluationStatus, "CALENDAR_PENDING");
});

test("nextTradingDayOnOrAfter(2026-12-31) → 2027-01-04", () => {
  const r = nextTradingDayOnOrAfter("2026-12-31", TRADING_DAYS_YEAR_END);
  assert.equal(r.ok, true);
  assert.equal(r.targetTradingDate, "2027-01-04");
});

test("마지막 거래일 12-30이면 12-24 레거시 목표일 CALENDAR_PENDING", () => {
  assert.equal(TRADING_DAYS_2026_ONLY_YEAR_END.at(-1), "2026-12-30");
  const cal = createTradingCalendar(TRADING_DAYS_2026_ONLY_YEAR_END);
  const r = resolveLegacyTarget("2026-12-24", cal);
  assert.equal(r.ok, false);
  assert.equal(r.evaluationStatus, "CALENDAR_PENDING");
  assert.equal(r.targetTradingDate, null);
});
