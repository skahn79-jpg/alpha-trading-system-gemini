/**
 * GATE 5E 합성 거래 캘린더 검증 엔진. 순수 CommonJS.
 * 파일·소켓·외부 연동 없음. ./schemas 의 parseYmd 만 재사용한다.
 * 2100~2199 합성 날짜만 취급하며, 합성 캘린더가 정상이어도 운영 승격은 항상 차단한다.
 * 6P: makeSafeCalendarError is a thin adapter onto shared makeBacktestError.
 */

"use strict";

const { parseYmd } = require("./schemas");
const { makeBacktestError } = require("./make-error");

const CALENDAR_ENGINE_VERSION = "synthetic-calendar-validation-v0.1";
const MIN_SYNTHETIC_YEAR = 2100;
const MAX_SYNTHETIC_YEAR = 2199;
const SYNTHETIC_CALENDAR_ID_PREFIX = "synthetic-calendar-";
const MAX_COVERAGE_SPAN_DAYS = 40000;

const TIMEZONE = "Asia/Seoul";

const MARKET = Object.freeze({
  SYNTHETIC_KOSPI: "SYNTHETIC_KOSPI",
  SYNTHETIC_KOSDAQ: "SYNTHETIC_KOSDAQ",
});

const CALENDAR_STATUS = Object.freeze({
  TEST_VERIFIED: "TEST_VERIFIED",
});

const FIXTURE_TYPE = Object.freeze({
  SYNTHETIC: "SYNTHETIC",
});

const DAY_STATUS = Object.freeze({
  TRADING_DAY: "TRADING_DAY",
  NON_TRADING_DAY: "NON_TRADING_DAY",
  PENDING: "PENDING",
  CONFLICT: "CONFLICT",
});

const SESSION_STATUS = Object.freeze({
  FINAL: "FINAL",
  PENDING: "PENDING",
});

const STATUS_SOURCE = Object.freeze({
  SYNTHETIC_EXPLICIT: "SYNTHETIC_EXPLICIT",
});

const MODE = Object.freeze({
  TEST: "TEST",
  PRODUCTION: "PRODUCTION",
});

const MARKET_VALUES = new Set(Object.values(MARKET));
const CALENDAR_STATUS_VALUES = new Set(Object.values(CALENDAR_STATUS));
const FIXTURE_TYPE_VALUES = new Set(Object.values(FIXTURE_TYPE));
const DAY_STATUS_VALUES = new Set(Object.values(DAY_STATUS));
const SESSION_STATUS_VALUES = new Set(Object.values(SESSION_STATUS));
const STATUS_SOURCE_VALUES = new Set(Object.values(STATUS_SOURCE));

const STATUS = Object.freeze({
  SYNTHETIC_CALENDAR_VERIFIED: "SYNTHETIC_CALENDAR_VERIFIED",
  BLOCKED_CALENDAR_SCHEMA: "BLOCKED_CALENDAR_SCHEMA",
  BLOCKED_CALENDAR_RANGE: "BLOCKED_CALENDAR_RANGE",
  BLOCKED_CALENDAR_STATUS: "BLOCKED_CALENDAR_STATUS",
  BLOCKED_CANDLE_CALENDAR_MISMATCH: "BLOCKED_CANDLE_CALENDAR_MISMATCH",
  BLOCKED_CALENDAR_VALIDATION: "BLOCKED_CALENDAR_VALIDATION",
});

const ERROR = Object.freeze({
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_CALENDAR_ID: "INVALID_CALENDAR_ID",
  INVALID_CALENDAR_VERSION: "INVALID_CALENDAR_VERSION",
  INVALID_CALENDAR_STATUS: "INVALID_CALENDAR_STATUS",
  INVALID_FIXTURE_TYPE: "INVALID_FIXTURE_TYPE",
  INVALID_MARKET: "INVALID_MARKET",
  INVALID_TIMEZONE: "INVALID_TIMEZONE",
  INVALID_TRADING_DATE: "INVALID_TRADING_DATE",
  DATE_ALIAS_NOT_ALLOWED: "DATE_ALIAS_NOT_ALLOWED",
  INVALID_DAY_STATUS: "INVALID_DAY_STATUS",
  INVALID_SESSION_STATUS: "INVALID_SESSION_STATUS",
  INVALID_STATUS_SOURCE: "INVALID_STATUS_SOURCE",
  CALENDAR_MARKET_MISMATCH: "CALENDAR_MARKET_MISMATCH",
  CALENDAR_ID_MISMATCH: "CALENDAR_ID_MISMATCH",
  NON_MONOTONIC_CALENDAR_DATE: "NON_MONOTONIC_CALENDAR_DATE",
  DUPLICATE_CALENDAR_DATE: "DUPLICATE_CALENDAR_DATE",
  INVALID_COVERAGE_RANGE: "INVALID_COVERAGE_RANGE",
  CALENDAR_DATE_OUTSIDE_COVERAGE: "CALENDAR_DATE_OUTSIDE_COVERAGE",
  CALENDAR_DATE_MISSING: "CALENDAR_DATE_MISSING",
  CALENDAR_RANGE_INSUFFICIENT: "CALENDAR_RANGE_INSUFFICIENT",
  CALENDAR_PENDING: "CALENDAR_PENDING",
  CALENDAR_SOURCE_CONFLICT: "CALENDAR_SOURCE_CONFLICT",
  SESSION_SCHEDULE_PENDING: "SESSION_SCHEDULE_PENDING",
  CANDLE_ON_NON_TRADING_DAY: "CANDLE_ON_NON_TRADING_DAY",
  CALENDAR_WARMUP_INSUFFICIENT: "CALENDAR_WARMUP_INSUFFICIENT",
  CALENDAR_EVALUATION_RANGE_INSUFFICIENT: "CALENDAR_EVALUATION_RANGE_INSUFFICIENT",
  SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION: "SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION",
});

/** 오류 객체에 남길 수 있는 유일한 키 목록. 그 외 페이로드는 전부 폐기한다. */
const SAFE_ERROR_KEYS = Object.freeze([
  "code",
  "severity",
  "field",
  "recordIndex",
  "calendarId",
  "calendarVersion",
  "market",
  "tradingDate",
  "dayStatus",
  "sessionStatus",
]);

const SAFE_ERROR_KEY_SET = new Set(SAFE_ERROR_KEYS);

/** Envelope 최상위 허용 필드(allowlist). */
const ENVELOPE_FIELDS = Object.freeze([
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

const REQUIRED_ENVELOPE_FIELDS = Object.freeze([
  "calendarId",
  "calendarVersion",
  "calendarStatus",
  "fixtureType",
  "notProductionData",
  "productionEligible",
  "market",
  "timezone",
  "coverage",
  "days",
]);

const COVERAGE_FIELDS = Object.freeze(["from", "to"]);

/** Day 레코드 허용 필드(allowlist). */
const DAY_FIELDS = Object.freeze([
  "tradingDate",
  "dayStatus",
  "sessionStatus",
  "statusSource",
  "market",
  "calendarId",
]);

const REQUIRED_DAY_FIELDS = DAY_FIELDS;

const ENVELOPE_FIELD_SET = new Set(ENVELOPE_FIELDS);
const COVERAGE_FIELD_SET = new Set(COVERAGE_FIELDS);
const DAY_FIELD_SET = new Set(DAY_FIELDS);

const SCHEMA_ERROR_CODES = new Set([
  ERROR.UNKNOWN_FIELD,
  ERROR.MISSING_REQUIRED_FIELD,
  ERROR.INVALID_CALENDAR_ID,
  ERROR.INVALID_CALENDAR_VERSION,
  ERROR.INVALID_CALENDAR_STATUS,
  ERROR.INVALID_FIXTURE_TYPE,
  ERROR.INVALID_MARKET,
  ERROR.INVALID_TIMEZONE,
  ERROR.INVALID_TRADING_DATE,
  ERROR.DATE_ALIAS_NOT_ALLOWED,
  ERROR.INVALID_DAY_STATUS,
  ERROR.INVALID_SESSION_STATUS,
  ERROR.INVALID_STATUS_SOURCE,
  ERROR.CALENDAR_MARKET_MISMATCH,
  ERROR.CALENDAR_ID_MISMATCH,
]);

const STATUS_ERROR_CODES = new Set([
  ERROR.CALENDAR_PENDING,
  ERROR.CALENDAR_SOURCE_CONFLICT,
  ERROR.SESSION_SCHEDULE_PENDING,
]);

const CANDLE_ERROR_CODES = new Set([
  ERROR.CANDLE_ON_NON_TRADING_DAY,
]);

const RANGE_ERROR_CODES = new Set([
  ERROR.NON_MONOTONIC_CALENDAR_DATE,
  ERROR.DUPLICATE_CALENDAR_DATE,
  ERROR.INVALID_COVERAGE_RANGE,
  ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE,
  ERROR.CALENDAR_DATE_MISSING,
  ERROR.CALENDAR_RANGE_INSUFFICIENT,
  ERROR.CALENDAR_WARMUP_INSUFFICIENT,
  ERROR.CALENDAR_EVALUATION_RANGE_INSUFFICIENT,
]);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 허용 키만 남긴 안전한 오류 객체를 만든다.
 * 캘린더 전체·일자 배열·캔들 배열·입력 객체·자격증명류는 절대 담기지 않는다.
 */
function makeSafeCalendarError(raw) {
  if (!isPlainObject(raw)) {
    return { severity: "ERROR" };
  }
  const extra = {};
  for (const key of SAFE_ERROR_KEYS) {
    if (key === "code" || key === "severity") continue;
    if (raw[key] !== undefined && raw[key] !== null) extra[key] = raw[key];
  }
  const err = makeBacktestError(raw.code, extra);
  if (raw.code == null) {
    delete err.code;
  }
  err.severity = raw.severity != null ? raw.severity : "ERROR";
  return err;
}

function uniqueCodes(errors) {
  const seen = new Set();
  const out = [];
  for (const err of errors) {
    if (!err || err.code == null) continue;
    if (seen.has(err.code)) continue;
    seen.add(err.code);
    out.push(err.code);
  }
  return out;
}

function collectUnknownKeys(obj, allowed, fieldPrefix, extra) {
  const errors = [];
  if (!isPlainObject(obj)) return errors;
  for (const key of Object.keys(obj)) {
    if (allowed.has(key)) continue;
    errors.push(makeSafeCalendarError({
      code: ERROR.UNKNOWN_FIELD,
      field: fieldPrefix ? `${fieldPrefix}.${key}` : key,
      ...extra,
    }));
  }
  return errors;
}

function requireFields(obj, fields, fieldPrefix, extra) {
  const errors = [];
  if (!isPlainObject(obj)) return errors;
  for (const field of fields) {
    if (Object.hasOwn(obj, field)) continue;
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: fieldPrefix ? `${fieldPrefix}.${field}` : field,
      ...extra,
    }));
  }
  return errors;
}

/** 2100~2199 범위의 YYYY-MM-DD 합성 날짜만 통과시킨다. */
function parseSyntheticYmd(value) {
  const parsed = parseYmd(value);
  if (!parsed.ok) return null;
  const year = Number(parsed.date.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  if (year < MIN_SYNTHETIC_YEAR || year > MAX_SYNTHETIC_YEAR) return null;
  return parsed.date;
}

function addDaysYmd(ymd, days) {
  const parsed = parseYmd(ymd);
  if (!parsed.ok) return null;
  const year = Number(parsed.date.slice(0, 4));
  const month = Number(parsed.date.slice(5, 7));
  const day = Number(parsed.date.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** from~to(양끝 포함)의 모든 달력일을 배열로 만든다. 주말·휴일도 전부 포함한다. */
function enumerateCalendarDates(from, to) {
  const out = [];
  if (typeof from !== "string" || typeof to !== "string") return out;
  if (from > to) return out;
  let current = from;
  let guard = 0;
  while (current <= to && guard <= MAX_COVERAGE_SPAN_DAYS) {
    out.push(current);
    const next = addDaysYmd(current, 1);
    if (next == null) break;
    current = next;
    guard += 1;
  }
  return out;
}

function envelopeMeta(calendar) {
  if (!isPlainObject(calendar)) return {};
  const meta = {};
  if (typeof calendar.calendarId === "string") meta.calendarId = calendar.calendarId;
  if (typeof calendar.calendarVersion === "string") meta.calendarVersion = calendar.calendarVersion;
  if (typeof calendar.market === "string") meta.market = calendar.market;
  return meta;
}

/**
 * 합성 캘린더 Envelope(최상위 봉투) 검증.
 * opts.mode 가 PRODUCTION 이면 합성 캘린더는 무조건 차단한다.
 */
function validateCalendarEnvelope(calendar, opts) {
  const options = isPlainObject(opts) ? opts : {};
  const mode = options.mode == null ? MODE.TEST : options.mode;
  const errors = [];

  if (!isPlainObject(calendar)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "calendar",
    }));
    return { ok: false, errors };
  }

  const meta = envelopeMeta(calendar);

  if (mode === MODE.PRODUCTION) {
    errors.push(makeSafeCalendarError({
      code: ERROR.SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION,
      field: "mode",
      ...meta,
    }));
    return { ok: false, errors };
  }

  errors.push(...collectUnknownKeys(calendar, ENVELOPE_FIELD_SET, null, meta));
  errors.push(...requireFields(calendar, REQUIRED_ENVELOPE_FIELDS, null, meta));

  if (Object.hasOwn(calendar, "calendarId")) {
    if (typeof calendar.calendarId !== "string"
      || !calendar.calendarId.startsWith(SYNTHETIC_CALENDAR_ID_PREFIX)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_CALENDAR_ID,
        field: "calendarId",
        ...meta,
      }));
    }
  }

  if (Object.hasOwn(calendar, "calendarVersion")) {
    if (typeof calendar.calendarVersion !== "string"
      || calendar.calendarVersion.length === 0
      || calendar.calendarVersion.trim() !== calendar.calendarVersion) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_CALENDAR_VERSION,
        field: "calendarVersion",
        ...meta,
      }));
    }
  }

  if (Object.hasOwn(calendar, "calendarStatus")
    && !CALENDAR_STATUS_VALUES.has(calendar.calendarStatus)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_CALENDAR_STATUS,
      field: "calendarStatus",
      ...meta,
    }));
  }

  if (Object.hasOwn(calendar, "fixtureType")
    && !FIXTURE_TYPE_VALUES.has(calendar.fixtureType)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_FIXTURE_TYPE,
      field: "fixtureType",
      ...meta,
    }));
  }

  if (Object.hasOwn(calendar, "notProductionData") && calendar.notProductionData !== true) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_FIXTURE_TYPE,
      field: "notProductionData",
      ...meta,
    }));
  }

  if (Object.hasOwn(calendar, "productionEligible") && calendar.productionEligible !== false) {
    errors.push(makeSafeCalendarError({
      code: ERROR.SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION,
      field: "productionEligible",
      ...meta,
    }));
  }

  if (Object.hasOwn(calendar, "market") && !MARKET_VALUES.has(calendar.market)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_MARKET,
      field: "market",
      ...meta,
    }));
  }

  if (Object.hasOwn(calendar, "timezone") && calendar.timezone !== TIMEZONE) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TIMEZONE,
      field: "timezone",
      ...meta,
    }));
  }

  if (Object.hasOwn(calendar, "coverage")) {
    const coverage = calendar.coverage;
    if (!isPlainObject(coverage)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_COVERAGE_RANGE,
        field: "coverage",
        ...meta,
      }));
    } else {
      errors.push(...collectUnknownKeys(coverage, COVERAGE_FIELD_SET, "coverage", meta));
      errors.push(...requireFields(coverage, COVERAGE_FIELDS, "coverage", meta));
      const from = parseSyntheticYmd(coverage.from);
      const to = parseSyntheticYmd(coverage.to);
      if (Object.hasOwn(coverage, "from") && from == null) {
        errors.push(makeSafeCalendarError({
          code: ERROR.INVALID_TRADING_DATE,
          field: "coverage.from",
          ...meta,
        }));
      }
      if (Object.hasOwn(coverage, "to") && to == null) {
        errors.push(makeSafeCalendarError({
          code: ERROR.INVALID_TRADING_DATE,
          field: "coverage.to",
          ...meta,
        }));
      }
      if (from != null && to != null && from > to) {
        errors.push(makeSafeCalendarError({
          code: ERROR.INVALID_COVERAGE_RANGE,
          field: "coverage",
          ...meta,
        }));
      }
    }
  }

  if (Object.hasOwn(calendar, "days") && !Array.isArray(calendar.days)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "days",
      ...meta,
    }));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 개별 Day 레코드 검증. context 로 봉투의 market/calendarId 를 넘기면 일치 여부까지 본다.
 */
function validateCalendarDay(day, context) {
  const ctx = isPlainObject(context) ? context : {};
  const base = {};
  if (Number.isInteger(ctx.recordIndex)) base.recordIndex = ctx.recordIndex;
  const errors = [];

  if (!isPlainObject(day)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "days",
      ...base,
    }));
    return { ok: false, errors };
  }

  const extra = { ...base };
  if (typeof day.tradingDate === "string") extra.tradingDate = day.tradingDate;
  if (typeof day.market === "string") extra.market = day.market;
  if (typeof day.calendarId === "string") extra.calendarId = day.calendarId;

  if (Object.hasOwn(day, "date")) {
    errors.push(makeSafeCalendarError({
      code: ERROR.DATE_ALIAS_NOT_ALLOWED,
      field: "date",
      ...extra,
    }));
  }

  for (const key of Object.keys(day)) {
    if (key === "date") continue;
    if (DAY_FIELD_SET.has(key)) continue;
    errors.push(makeSafeCalendarError({
      code: ERROR.UNKNOWN_FIELD,
      field: key,
      ...extra,
    }));
  }

  errors.push(...requireFields(day, REQUIRED_DAY_FIELDS, null, extra));

  if (Object.hasOwn(day, "tradingDate") && parseSyntheticYmd(day.tradingDate) == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "tradingDate",
      ...extra,
    }));
  }

  if (Object.hasOwn(day, "dayStatus") && !DAY_STATUS_VALUES.has(day.dayStatus)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_DAY_STATUS,
      field: "dayStatus",
      ...extra,
    }));
  }

  if (Object.hasOwn(day, "sessionStatus") && !SESSION_STATUS_VALUES.has(day.sessionStatus)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_SESSION_STATUS,
      field: "sessionStatus",
      ...extra,
    }));
  }

  if (Object.hasOwn(day, "statusSource") && !STATUS_SOURCE_VALUES.has(day.statusSource)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_STATUS_SOURCE,
      field: "statusSource",
      ...extra,
    }));
  }

  if (Object.hasOwn(day, "market")) {
    if (!MARKET_VALUES.has(day.market)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_MARKET,
        field: "market",
        ...extra,
      }));
    } else if (typeof ctx.market === "string" && day.market !== ctx.market) {
      errors.push(makeSafeCalendarError({
        code: ERROR.CALENDAR_MARKET_MISMATCH,
        field: "market",
        ...extra,
      }));
    }
  }

  if (Object.hasOwn(day, "calendarId")) {
    if (typeof day.calendarId !== "string"
      || !day.calendarId.startsWith(SYNTHETIC_CALENDAR_ID_PREFIX)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_CALENDAR_ID,
        field: "calendarId",
        ...extra,
      }));
    } else if (typeof ctx.calendarId === "string" && day.calendarId !== ctx.calendarId) {
      errors.push(makeSafeCalendarError({
        code: ERROR.CALENDAR_ID_MISMATCH,
        field: "calendarId",
        ...extra,
      }));
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Day 배열 검증. tradingDate 엄격 오름차순만 허용하며
 * 자동 정렬·중복제거는 하지 않는다(입력 배열은 그대로 둔다).
 */
function validateCalendarSequence(days, context) {
  const ctx = isPlainObject(context) ? context : {};
  const errors = [];

  if (!Array.isArray(days)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "days",
    }));
    return { ok: false, errors };
  }

  const seen = new Set();
  let previous = null;

  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    const dayResult = validateCalendarDay(day, {
      recordIndex: i,
      market: ctx.market,
      calendarId: ctx.calendarId,
    });
    errors.push(...dayResult.errors);

    if (!isPlainObject(day)) continue;
    const current = parseSyntheticYmd(day.tradingDate);
    if (current == null) continue;

    if (seen.has(current)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.DUPLICATE_CALENDAR_DATE,
        field: "tradingDate",
        recordIndex: i,
        tradingDate: current,
        market: typeof day.market === "string" ? day.market : undefined,
        calendarId: typeof day.calendarId === "string" ? day.calendarId : undefined,
      }));
    } else if (previous != null && current < previous) {
      errors.push(makeSafeCalendarError({
        code: ERROR.NON_MONOTONIC_CALENDAR_DATE,
        field: "tradingDate",
        recordIndex: i,
        tradingDate: current,
        market: typeof day.market === "string" ? day.market : undefined,
        calendarId: typeof day.calendarId === "string" ? day.calendarId : undefined,
      }));
    }

    seen.add(current);
    previous = current;
  }

  return { ok: errors.length === 0, errors };
}

/**
 * coverage 검증. days 는 coverage 안에 있어야 하고
 * coverage 안의 모든 달력일(주말 포함)이 days 에 존재해야 한다.
 */
function validateCalendarCoverage(calendar) {
  const errors = [];

  if (!isPlainObject(calendar)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "calendar",
    }));
    return { ok: false, errors };
  }

  const meta = envelopeMeta(calendar);
  const coverage = calendar.coverage;

  if (!isPlainObject(coverage)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_COVERAGE_RANGE,
      field: "coverage",
      ...meta,
    }));
    return { ok: false, errors };
  }

  const from = parseSyntheticYmd(coverage.from);
  const to = parseSyntheticYmd(coverage.to);
  if (from == null || to == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "coverage",
      ...meta,
    }));
    return { ok: false, errors };
  }
  if (from > to) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_COVERAGE_RANGE,
      field: "coverage",
      ...meta,
    }));
    return { ok: false, errors };
  }

  const days = calendar.days;
  if (!Array.isArray(days)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "days",
      ...meta,
    }));
    return { ok: false, errors };
  }

  const present = new Set();
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (!isPlainObject(day)) continue;
    const date = parseSyntheticYmd(day.tradingDate);
    if (date == null) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_TRADING_DATE,
        field: "tradingDate",
        recordIndex: i,
        ...meta,
      }));
      continue;
    }
    if (date < from || date > to) {
      errors.push(makeSafeCalendarError({
        code: ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE,
        field: "tradingDate",
        recordIndex: i,
        tradingDate: date,
        ...meta,
      }));
      continue;
    }
    present.add(date);
  }

  for (const date of enumerateCalendarDates(from, to)) {
    if (present.has(date)) continue;
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_DATE_MISSING,
      field: "days",
      tradingDate: date,
      ...meta,
    }));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 요청 범위가 coverage 안에 완전히 포함되는지 확인한다.
 * 가장 가까운 날짜로 보정하는 동작은 없다.
 */
function validateRequestedRange(input) {
  const src = isPlainObject(input) ? input : {};
  const calendar = src.calendar;
  const errors = [];

  if (!isPlainObject(calendar) || !isPlainObject(calendar.coverage)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "calendar.coverage",
    }));
    return { ok: false, errors };
  }

  const meta = envelopeMeta(calendar);

  if (!Object.hasOwn(src, "requiredFrom") || !Object.hasOwn(src, "requiredTo")) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: !Object.hasOwn(src, "requiredFrom") ? "requiredFrom" : "requiredTo",
      ...meta,
    }));
    return { ok: false, errors };
  }

  const from = parseSyntheticYmd(calendar.coverage.from);
  const to = parseSyntheticYmd(calendar.coverage.to);
  const requiredFrom = parseSyntheticYmd(src.requiredFrom);
  const requiredTo = parseSyntheticYmd(src.requiredTo);

  if (from == null || to == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "coverage",
      ...meta,
    }));
    return { ok: false, errors };
  }
  if (requiredFrom == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "requiredFrom",
      ...meta,
    }));
  }
  if (requiredTo == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "requiredTo",
      ...meta,
    }));
  }
  if (requiredFrom == null || requiredTo == null) {
    return { ok: false, errors };
  }

  if (requiredFrom > requiredTo) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_COVERAGE_RANGE,
      field: "requiredFrom",
      tradingDate: requiredFrom,
      ...meta,
    }));
    return { ok: false, errors };
  }

  if (requiredFrom < from) {
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_RANGE_INSUFFICIENT,
      field: "requiredFrom",
      tradingDate: requiredFrom,
      ...meta,
    }));
  }
  if (requiredTo > to) {
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_RANGE_INSUFFICIENT,
      field: "requiredTo",
      tradingDate: requiredTo,
      ...meta,
    }));
  }

  return { ok: errors.length === 0, errors };
}

function buildDayMap(days) {
  const map = new Map();
  if (!Array.isArray(days)) return map;
  for (const day of days) {
    if (!isPlainObject(day)) continue;
    const date = parseSyntheticYmd(day.tradingDate);
    if (date == null) continue;
    if (map.has(date)) continue;
    map.set(date, day);
  }
  return map;
}

/**
 * 캔들 날짜를 캘린더와 대조한다.
 * 각 캔들은 coverage 안에 있고, 캘린더 레코드가 있으며,
 * TRADING_DAY + FINAL + market 일치여야 한다.
 */
function validateCandleDatesAgainstCalendar(input) {
  const src = isPlainObject(input) ? input : {};
  const { candles, calendar, market } = src;
  const errors = [];

  if (!isPlainObject(calendar)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "calendar",
    }));
    return { ok: false, errors };
  }
  const meta = envelopeMeta(calendar);

  if (!Array.isArray(candles)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "candles",
      ...meta,
    }));
    return { ok: false, errors };
  }

  if (!MARKET_VALUES.has(market)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_MARKET,
      field: "market",
      ...meta,
    }));
    return { ok: false, errors };
  }

  if (calendar.market !== market) {
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_MARKET_MISMATCH,
      field: "calendar.market",
      market,
      calendarId: meta.calendarId,
      calendarVersion: meta.calendarVersion,
    }));
    return { ok: false, errors };
  }

  if (Object.hasOwn(src, "requiredFrom") || Object.hasOwn(src, "requiredTo")) {
    const rangeResult = validateRequestedRange({
      calendar,
      requiredFrom: src.requiredFrom,
      requiredTo: src.requiredTo,
    });
    errors.push(...rangeResult.errors);
  }

  const coverage = isPlainObject(calendar.coverage) ? calendar.coverage : {};
  const from = parseSyntheticYmd(coverage.from);
  const to = parseSyntheticYmd(coverage.to);
  const dayMap = buildDayMap(calendar.days);

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!isPlainObject(candle)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.MISSING_REQUIRED_FIELD,
        field: "candles",
        recordIndex: i,
        ...meta,
      }));
      continue;
    }

    const date = parseSyntheticYmd(candle.tradingDate);
    if (date == null) {
      errors.push(makeSafeCalendarError({
        code: ERROR.INVALID_TRADING_DATE,
        field: "tradingDate",
        recordIndex: i,
        ...meta,
      }));
      continue;
    }

    const loc = {
      field: "tradingDate",
      recordIndex: i,
      tradingDate: date,
      calendarId: meta.calendarId,
      calendarVersion: meta.calendarVersion,
    };

    if (candle.market !== market) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_MARKET_MISMATCH,
        field: "market",
        market: typeof candle.market === "string" ? candle.market : undefined,
      }));
      continue;
    }

    if (from != null && to != null && (date < from || date > to)) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE,
        market,
      }));
      continue;
    }

    const record = dayMap.get(date);
    if (record === undefined) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_DATE_MISSING,
        market,
      }));
      continue;
    }

    if (record.market !== market) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_MARKET_MISMATCH,
        market: typeof record.market === "string" ? record.market : undefined,
      }));
      continue;
    }

    if (record.dayStatus === DAY_STATUS.PENDING) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_PENDING,
        market,
        dayStatus: record.dayStatus,
      }));
      continue;
    }
    if (record.dayStatus === DAY_STATUS.CONFLICT) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_SOURCE_CONFLICT,
        market,
        dayStatus: record.dayStatus,
      }));
      continue;
    }
    if (record.dayStatus !== DAY_STATUS.TRADING_DAY) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CANDLE_ON_NON_TRADING_DAY,
        market,
        dayStatus: record.dayStatus,
      }));
      continue;
    }

    if (record.sessionStatus !== SESSION_STATUS.FINAL) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.SESSION_SCHEDULE_PENDING,
        market,
        dayStatus: record.dayStatus,
        sessionStatus: record.sessionStatus,
      }));
    }
  }

  return { ok: errors.length === 0, errors };
}

/** from~to(양끝 포함) 구간의 TRADING_DAY 개수를 센다. null 은 무제한을 뜻한다. */
function countTradingDays(days, from, to) {
  if (!Array.isArray(days)) return 0;
  let count = 0;
  for (const day of days) {
    if (!isPlainObject(day)) continue;
    if (day.dayStatus !== DAY_STATUS.TRADING_DAY) continue;
    const date = parseSyntheticYmd(day.tradingDate);
    if (date == null) continue;
    if (from != null && date < from) continue;
    if (to != null && date > to) continue;
    count += 1;
  }
  return count;
}

/** 지정 구간 안의 레코드 상태(PENDING/CONFLICT/세션 미확정)를 점검한다. */
function checkWindowStatuses(days, from, to, meta, errors) {
  if (!Array.isArray(days)) return;
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (!isPlainObject(day)) continue;
    const date = parseSyntheticYmd(day.tradingDate);
    if (date == null) continue;
    if (from != null && date < from) continue;
    if (to != null && date > to) continue;

    const loc = {
      field: "dayStatus",
      recordIndex: i,
      tradingDate: date,
      market: typeof day.market === "string" ? day.market : undefined,
      calendarId: meta.calendarId,
      calendarVersion: meta.calendarVersion,
    };

    if (day.dayStatus === DAY_STATUS.PENDING) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_PENDING,
        dayStatus: day.dayStatus,
      }));
      continue;
    }
    if (day.dayStatus === DAY_STATUS.CONFLICT) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.CALENDAR_SOURCE_CONFLICT,
        dayStatus: day.dayStatus,
      }));
      continue;
    }
    if (day.dayStatus === DAY_STATUS.TRADING_DAY
      && day.sessionStatus !== SESSION_STATUS.FINAL) {
      errors.push(makeSafeCalendarError({
        ...loc,
        code: ERROR.SESSION_SCHEDULE_PENDING,
        field: "sessionStatus",
        dayStatus: day.dayStatus,
        sessionStatus: day.sessionStatus,
      }));
    }
  }
}

function coverageBounds(calendar) {
  const coverage = isPlainObject(calendar) && isPlainObject(calendar.coverage)
    ? calendar.coverage
    : {};
  return {
    from: parseSyntheticYmd(coverage.from),
    to: parseSyntheticYmd(coverage.to),
  };
}

/**
 * 웜업 구간 검증. featureStartTradingDate 이전(미포함)에
 * requiredWarmupTradingDays 개 이상의 TRADING_DAY 가 있어야 한다.
 * 기본값은 사용하지 않는다(누락 시 MISSING_REQUIRED_FIELD).
 */
function validateWarmupRange(input) {
  const src = isPlainObject(input) ? input : {};
  const calendar = src.calendar;
  const errors = [];

  if (!isPlainObject(calendar)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "calendar",
    }));
    return { ok: false, errors, tradingDayCount: null };
  }
  const meta = envelopeMeta(calendar);

  if (!Object.hasOwn(src, "requiredWarmupTradingDays")) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "requiredWarmupTradingDays",
      ...meta,
    }));
  }
  if (!Object.hasOwn(src, "featureStartTradingDate")) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "featureStartTradingDate",
      ...meta,
    }));
  }
  if (errors.length > 0) {
    return { ok: false, errors, tradingDayCount: null };
  }

  const required = src.requiredWarmupTradingDays;
  if (!Number.isInteger(required) || required < 0) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "requiredWarmupTradingDays",
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }

  const featureStart = parseSyntheticYmd(src.featureStartTradingDate);
  if (featureStart == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "featureStartTradingDate",
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }

  const bounds = coverageBounds(calendar);
  if (bounds.from == null || bounds.to == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_COVERAGE_RANGE,
      field: "coverage",
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }
  if (featureStart < bounds.from || featureStart > bounds.to) {
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE,
      field: "featureStartTradingDate",
      tradingDate: featureStart,
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }

  const windowTo = addDaysYmd(featureStart, -1);
  const tradingDayCount = windowTo == null || windowTo < bounds.from
    ? 0
    : countTradingDays(calendar.days, bounds.from, windowTo);

  checkWindowStatuses(calendar.days, bounds.from, windowTo, meta, errors);

  if (tradingDayCount < required) {
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_WARMUP_INSUFFICIENT,
      field: "requiredWarmupTradingDays",
      tradingDate: featureStart,
      ...meta,
    }));
  }

  return { ok: errors.length === 0, errors, tradingDayCount };
}

/**
 * 평가 구간 검증. featureStartTradingDate~evaluationEndTradingDate(양끝 포함)에
 * requiredEvaluationTradingDays 개 이상의 TRADING_DAY 가 있어야 한다.
 */
function validateEvaluationRange(input) {
  const src = isPlainObject(input) ? input : {};
  const calendar = src.calendar;
  const errors = [];

  if (!isPlainObject(calendar)) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "calendar",
    }));
    return { ok: false, errors, tradingDayCount: null };
  }
  const meta = envelopeMeta(calendar);

  const requiredKeys = [
    "requiredEvaluationTradingDays",
    "featureStartTradingDate",
    "evaluationEndTradingDate",
  ];
  for (const key of requiredKeys) {
    if (!Object.hasOwn(src, key)) {
      errors.push(makeSafeCalendarError({
        code: ERROR.MISSING_REQUIRED_FIELD,
        field: key,
        ...meta,
      }));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, tradingDayCount: null };
  }

  const required = src.requiredEvaluationTradingDays;
  if (!Number.isInteger(required) || required < 0) {
    errors.push(makeSafeCalendarError({
      code: ERROR.MISSING_REQUIRED_FIELD,
      field: "requiredEvaluationTradingDays",
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }

  const featureStart = parseSyntheticYmd(src.featureStartTradingDate);
  const evaluationEnd = parseSyntheticYmd(src.evaluationEndTradingDate);
  if (featureStart == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "featureStartTradingDate",
      ...meta,
    }));
  }
  if (evaluationEnd == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_TRADING_DATE,
      field: "evaluationEndTradingDate",
      ...meta,
    }));
  }
  if (featureStart == null || evaluationEnd == null) {
    return { ok: false, errors, tradingDayCount: null };
  }

  if (featureStart > evaluationEnd) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_COVERAGE_RANGE,
      field: "featureStartTradingDate",
      tradingDate: featureStart,
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }

  const bounds = coverageBounds(calendar);
  if (bounds.from == null || bounds.to == null) {
    errors.push(makeSafeCalendarError({
      code: ERROR.INVALID_COVERAGE_RANGE,
      field: "coverage",
      ...meta,
    }));
    return { ok: false, errors, tradingDayCount: null };
  }

  let outside = false;
  if (featureStart < bounds.from || featureStart > bounds.to) {
    outside = true;
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE,
      field: "featureStartTradingDate",
      tradingDate: featureStart,
      ...meta,
    }));
  }
  if (evaluationEnd < bounds.from || evaluationEnd > bounds.to) {
    outside = true;
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE,
      field: "evaluationEndTradingDate",
      tradingDate: evaluationEnd,
      ...meta,
    }));
  }
  if (outside) {
    return { ok: false, errors, tradingDayCount: null };
  }

  const tradingDayCount = countTradingDays(calendar.days, featureStart, evaluationEnd);
  checkWindowStatuses(calendar.days, featureStart, evaluationEnd, meta, errors);

  if (tradingDayCount < required) {
    errors.push(makeSafeCalendarError({
      code: ERROR.CALENDAR_EVALUATION_RANGE_INSUFFICIENT,
      field: "requiredEvaluationTradingDays",
      tradingDate: evaluationEnd,
      ...meta,
    }));
  }

  return { ok: errors.length === 0, errors, tradingDayCount };
}

function deriveStatus(codes) {
  for (const code of codes) {
    if (SCHEMA_ERROR_CODES.has(code)) return STATUS.BLOCKED_CALENDAR_SCHEMA;
  }
  for (const code of codes) {
    if (STATUS_ERROR_CODES.has(code)) return STATUS.BLOCKED_CALENDAR_STATUS;
  }
  for (const code of codes) {
    if (CANDLE_ERROR_CODES.has(code)) return STATUS.BLOCKED_CANDLE_CALENDAR_MISMATCH;
  }
  for (const code of codes) {
    if (RANGE_ERROR_CODES.has(code)) return STATUS.BLOCKED_CALENDAR_RANGE;
  }
  return STATUS.BLOCKED_CALENDAR_VALIDATION;
}

/**
 * 캘린더 검증 결과 객체. 합성 캘린더가 완전히 정상이어도
 * calendarVerified / calendarDataEligible / backtestExecutionEligible /
 * promotionEligible / paperEligible / liveEligible 은 항상 false 다.
 */
function createCalendarValidationResult(partial) {
  const src = isPlainObject(partial) ? partial : {};
  const errors = Array.isArray(src.errors)
    ? src.errors.map((e) => makeSafeCalendarError(e))
    : [];
  const errorCodes = uniqueCodes(errors);

  const schemaValid = src.schemaValid === true && errorCodes.length === 0;
  const candleDatesVerified = src.candleDatesVerified === true && errorCodes.length === 0;
  const warmupRangeVerified = src.warmupRangeVerified === true && errorCodes.length === 0;
  const evaluationRangeVerified = src.evaluationRangeVerified === true && errorCodes.length === 0;
  const syntheticCalendarVerified = src.syntheticCalendarVerified === true
    && schemaValid
    && errorCodes.length === 0;

  let status;
  if (typeof src.status === "string" && src.status.length > 0) {
    status = src.status;
  } else if (syntheticCalendarVerified) {
    status = STATUS.SYNTHETIC_CALENDAR_VERIFIED;
  } else {
    status = deriveStatus(errorCodes);
  }

  return {
    ok: syntheticCalendarVerified,
    calendarEngineVersion: CALENDAR_ENGINE_VERSION,
    schemaValid,
    calendarVerified: false,
    candleDatesVerified,
    warmupRangeVerified,
    evaluationRangeVerified,
    calendarDataEligible: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    status,
    syntheticCalendarVerified,
    errors,
    errorCodes,
    missingData: Array.isArray(src.missingData) ? src.missingData.slice() : [],
    warnings: Array.isArray(src.warnings) ? src.warnings.slice() : [],
  };
}

module.exports = {
  CALENDAR_ENGINE_VERSION,
  MIN_SYNTHETIC_YEAR,
  MAX_SYNTHETIC_YEAR,
  TIMEZONE,
  MODE,
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
  SAFE_ERROR_KEYS,
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
};
