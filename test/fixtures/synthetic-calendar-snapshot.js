/**
 * 합성 캘린더 fixture. 실제 KRX 공휴일·운영 데이터가 아니다.
 * 연도는 2100/2101/2104 만 사용한다.
 */

"use strict";

const { withChecksums } = require("../../lib/calendar/calendar-checksum");
const {
  COMPLETENESS,
  VERIFICATION_STATUS,
} = require("../../lib/calendar/calendar-provider");
const { SESSION_TYPE, TIMEZONE_SEOUL } = require("../../lib/calendar/session-schedule");

const FIXTURE_META = Object.freeze({
  fixtureType: "SYNTHETIC_CALENDAR_FIXTURE",
  notActualKrxCalendar: true,
  notProductionData: true,
  productionEligible: false,
  verificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
});

const DEFAULT_SOURCES = Object.freeze([
  Object.freeze({ sourceRef: "synthetic-fixture", name: "SYNTHETIC_CALENDAR_FIXTURE" }),
]);

const SYNTHETIC_CLOSURES = Object.freeze([
  "2100-01-15",
  "2100-02-04",
  "2100-02-05",
]);

const MAIN_TRADING_DAYS = Object.freeze([
  "2100-01-05", "2100-01-06", "2100-01-07", "2100-01-08",
  "2100-01-11", "2100-01-12", "2100-01-13", "2100-01-14",
  "2100-01-18", "2100-01-19", "2100-01-20", "2100-01-21", "2100-01-22",
  "2100-01-25", "2100-01-26", "2100-01-27", "2100-01-28", "2100-01-29",
  "2100-02-01", "2100-02-02", "2100-02-03",
  "2100-02-08", "2100-02-09", "2100-02-10", "2100-02-11", "2100-02-12",
]);

const DELAYED_OPEN_EXCEPTION = Object.freeze({
  date: "2100-01-14",
  sessionType: SESSION_TYPE.DELAYED_OPEN_SESSION,
  marketOpenTime: null,
  marketCloseTime: null,
  timezone: TIMEZONE_SEOUL,
  sourceRef: "synthetic-fixture",
});

const LONG_PLUS_1 = "2100-01-06";
const LONG_PLUS_5 = "2100-01-12";
const LONG_PLUS_20 = "2100-02-03";
const LONG_PLUS_60 = "2100-04-02";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromUtc(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addUtcDays(ymd, n) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return ymdFromUtc(new Date(Date.UTC(year, month - 1, day + n)));
}

function isWeekendUtc(ymd) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
}

function weekdaysMinusClosures(start, end, closures) {
  const closed = new Set(closures);
  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    if (!isWeekendUtc(cursor) && !closed.has(cursor)) dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

function attachChecksums(snapshot) {
  const withSums = withChecksums(snapshot);
  return {
    ...withSums,
    contentChecksumVerified: true,
    metadataHashVerified: true,
  };
}

function withFixtureMeta(snapshot) {
  return {
    ...FIXTURE_META,
    canonicalizationVersion: "calendar-c14n-v1",
    markets: ["SYNTHETIC_MARKET"],
    sources: DEFAULT_SOURCES.map((s) => ({ ...s })),
    ...snapshot,
    fixtureType: "SYNTHETIC_CALENDAR_FIXTURE",
    notActualKrxCalendar: true,
    notProductionData: true,
    productionEligible: false,
    verificationStatus: snapshot.verificationStatus || VERIFICATION_STATUS.TEST_VERIFIED,
  };
}

function makeMainCompleteSnapshot() {
  return attachChecksums(withFixtureMeta({
    calendarId: "synthetic-test-calendar-2100",
    calendarVersion: "synthetic-v1-complete",
    coverage: {
      start: "2100-01-05",
      end: "2100-02-12",
      completeness: COMPLETENESS.COMPLETE,
    },
    tradingDays: [...MAIN_TRADING_DAYS],
    sessionExceptions: [{ ...DELAYED_OPEN_EXCEPTION }],
  }));
}

function makePartialSnapshot() {
  return attachChecksums(withFixtureMeta({
    calendarId: "synthetic-test-calendar-2100-partial",
    calendarVersion: "synthetic-v1-partial",
    coverage: {
      start: "2100-01-05",
      end: "2100-02-12",
      completeness: COMPLETENESS.PARTIAL,
    },
    tradingDays: MAIN_TRADING_DAYS.filter((d) => d !== "2100-01-20"),
    sessionExceptions: [{ ...DELAYED_OPEN_EXCEPTION }],
  }));
}

function makeUnknownCompletenessSnapshot() {
  return attachChecksums(withFixtureMeta({
    calendarId: "synthetic-test-calendar-2100-unknown",
    calendarVersion: "synthetic-v1-unknown",
    coverage: {
      start: "2100-01-05",
      end: "2100-02-12",
      completeness: COMPLETENESS.UNKNOWN_COMPLETENESS,
    },
    tradingDays: [...MAIN_TRADING_DAYS],
    sessionExceptions: [{ ...DELAYED_OPEN_EXCEPTION }],
  }));
}

function makeYearBoundarySnapshot() {
  return attachChecksums(withFixtureMeta({
    calendarId: "synthetic-test-calendar-2100-2101",
    calendarVersion: "synthetic-v1-year-boundary",
    coverage: {
      start: "2100-12-29",
      end: "2101-01-07",
      completeness: COMPLETENESS.COMPLETE,
    },
    tradingDays: [
      "2100-12-29",
      "2100-12-30",
      "2100-12-31",
      "2101-01-03",
      "2101-01-04",
      "2101-01-05",
      "2101-01-06",
      "2101-01-07",
    ],
    sessionExceptions: [],
  }));
}

function makeLeapSnapshot() {
  return attachChecksums(withFixtureMeta({
    calendarId: "synthetic-test-calendar-2104",
    calendarVersion: "synthetic-v1-leap",
    coverage: {
      start: "2104-02-25",
      end: "2104-03-03",
      completeness: COMPLETENESS.COMPLETE,
    },
    tradingDays: [
      "2104-02-25",
      "2104-02-26",
      "2104-02-27",
      "2104-02-28",
      "2104-02-29",
      "2104-03-03",
    ],
    sessionExceptions: [],
  }));
}

function makeLongCompleteSnapshot() {
  const tradingDays = weekdaysMinusClosures("2100-01-05", "2100-04-30", SYNTHETIC_CLOSURES);
  return attachChecksums(withFixtureMeta({
    calendarId: "synthetic-test-calendar-2100-long",
    calendarVersion: "synthetic-v1-long",
    coverage: {
      start: "2100-01-05",
      end: "2100-04-30",
      completeness: COMPLETENESS.COMPLETE,
    },
    tradingDays,
    sessionExceptions: [{ ...DELAYED_OPEN_EXCEPTION }],
  }));
}

module.exports = {
  FIXTURE_META,
  MAIN_TRADING_DAYS,
  SYNTHETIC_CLOSURES,
  makeMainCompleteSnapshot,
  makePartialSnapshot,
  makeUnknownCompletenessSnapshot,
  makeYearBoundarySnapshot,
  makeLeapSnapshot,
  makeLongCompleteSnapshot,
  attachChecksums,
  withChecksums,
  LONG_PLUS_1,
  LONG_PLUS_5,
  LONG_PLUS_20,
  LONG_PLUS_60,
};
