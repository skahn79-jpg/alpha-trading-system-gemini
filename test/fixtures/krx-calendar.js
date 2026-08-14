/**
 * KRX 거래일 테스트 픽스처 (2026-08, 연말).
 * 명시적 fixture만 사용한다. 운영 캘린더가 아니다.
 *
 * 2026-08-17 광복절 대체공휴일은 목록에서 제외한다.
 * 2026-08-14(금) + 5거래일 = 2026-08-24 (주말만 제외한 2026-08-21이 아님).
 *
 * 레거시 LEGACY_7_CALENDAR_DAYS 목표일 정책:
 *   nominal = base + 7 달력일
 *   nominal이 거래일이면 그대로, 아니면 그 이후 첫 거래일, 없으면 CALENDAR_PENDING
 *
 * 정책 예시:
 *   2026-08-14 + 7 = 2026-08-21 (금, 거래일) → target 2026-08-21
 *   2026-08-10 + 7 = 2026-08-17 (월, 대체공휴일) → 다음 거래일 2026-08-18
 *   2026-08-15(토) + 7 = 2026-08-22(토) → 2026-08-24
 *   2026-08-16(일) + 7 = 2026-08-23(일) → 2026-08-24
 *   2026-12-24 + 7 = 2026-12-31 휴장 → 다음 거래일 2027-01-04 (01-02 토요일이 아님)
 *   캘린더 없음 → CALENDAR_PENDING, 최신 종가 대체 금지
 */

"use strict";

const TRADING_DAYS_2026_08 = Object.freeze([
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-31",
]);

const BASE_DATE = "2026-08-14";
const HOLIDAY_AWARE_TARGET = "2026-08-24";
const WEEKEND_ONLY_WRONG_TARGET = "2026-08-21";

/** 주말 nominal 날짜. 거래일 목록에 넣지 않는다. */
const WEEKEND_NOMINAL_DATES = Object.freeze([
  "2026-08-15",
  "2026-08-16",
  "2026-08-22",
  "2026-08-23",
]);

/**
 * 연말 거래일. 12-25/12-31/01-01 휴장, 01-02 토·01-03 일 제외.
 * 2026-12-24(목) + 7달력일 = 12-31 휴장 → 다음 거래일 2027-01-04 (01-02 토요일이 아님).
 */
const TRADING_DAYS_YEAR_END = Object.freeze([
  "2026-12-24",
  "2026-12-28",
  "2026-12-29",
  "2026-12-30",
  "2027-01-04",
]);

/** 2026만. 다음 연도 캘린더 없음 경계 테스트용. */
const TRADING_DAYS_2026_ONLY_YEAR_END = Object.freeze([
  "2026-12-24",
  "2026-12-28",
  "2026-12-29",
  "2026-12-30",
]);

const COMBINED_TRADING_DAYS = Object.freeze([
  ...TRADING_DAYS_2026_08,
  ...TRADING_DAYS_YEAR_END,
]);

const LEGACY_TARGET_FROM_0814 = "2026-08-21";
const LEGACY_TARGET_FROM_0810 = "2026-08-18";
const LEGACY_TARGET_FROM_0815 = "2026-08-24";
const LEGACY_TARGET_FROM_0816 = "2026-08-24";
const LEGACY_TARGET_FROM_1224 = "2027-01-04";

module.exports = {
  TRADING_DAYS_2026_08,
  BASE_DATE,
  HOLIDAY_AWARE_TARGET,
  WEEKEND_ONLY_WRONG_TARGET,
  WEEKEND_NOMINAL_DATES,
  TRADING_DAYS_YEAR_END,
  TRADING_DAYS_2026_ONLY_YEAR_END,
  COMBINED_TRADING_DAYS,
  LEGACY_TARGET_FROM_0814,
  LEGACY_TARGET_FROM_0810,
  LEGACY_TARGET_FROM_0815,
  LEGACY_TARGET_FROM_0816,
  LEGACY_TARGET_FROM_1224,
};
