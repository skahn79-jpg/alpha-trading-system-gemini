/**
 * KRX 거래일 캘린더.
 * 주말만 제외하는 추정·장기 휴장일 하드코딩을 하지 않는다.
 * UTC civil date 기준 토(6)/일(0)은 거래일로 반환하지 않는다.
 * 목록에 없는 날짜는 임의로 계산하지 않고 CALENDAR_PENDING 을 반환한다.
 * 캘린더 밖 날짜를 생성하지 않는다.
 */

"use strict";

const { formatKstDate } = require("./kst");

const INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT";
const INVALID_HORIZON = "INVALID_HORIZON";
const CALENDAR_PENDING_CODE = "CALENDAR_PENDING";

const CALENDAR_PENDING = Object.freeze({
  ok: false,
  targetTradingDate: null,
  evaluationStatus: "CALENDAR_PENDING",
  missingData: Object.freeze(["krxTradingCalendar"]),
  code: CALENDAR_PENDING_CODE,
});

function pendingResult(code = CALENDAR_PENDING_CODE) {
  return {
    ok: CALENDAR_PENDING.ok,
    targetTradingDate: CALENDAR_PENDING.targetTradingDate,
    evaluationStatus: CALENDAR_PENDING.evaluationStatus,
    missingData: [...CALENDAR_PENDING.missingData],
    code,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isValidUtcCivilDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year
    && dt.getUTCMonth() === month - 1
    && dt.getUTCDate() === day;
}

function ymdFromUtc(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseYmdParts(s) {
  if (/^\d{8}$/.test(s)) {
    return {
      year: Number(s.slice(0, 4)),
      month: Number(s.slice(4, 6)),
      day: Number(s.slice(6, 8)),
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return {
      year: Number(s.slice(0, 4)),
      month: Number(s.slice(5, 7)),
      day: Number(s.slice(8, 10)),
    };
  }
  return null;
}

function okDate(date) {
  return { ok: true, date, code: null };
}

function failDate(code = INVALID_DATE_FORMAT) {
  return { ok: false, date: null, code };
}

/**
 * Date / YYYYMMDD / YYYY-MM-DD / ISO8601 → { ok, date, code }
 * - Date: KST 날짜 (kst.js)
 * - YYYY-MM-DD 만 있으면 그 날짜를 거래일로 사용 (타임존 변환 없음)
 * - ISO8601+offset/Z: Instant 파싱 후 KST 날짜 (앞 10자 slice 금지)
 */
function parseTradingDate(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return failDate();
    try {
      return okDate(formatKstDate(input));
    } catch {
      return failDate();
    }
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return parseTradingDate(String(Math.trunc(input)));
  }

  if (typeof input !== "string") return failDate();

  const s = input.trim();
  if (!s) return failDate();

  const ymdOnly = parseYmdParts(s);
  if (ymdOnly && (s.length === 8 || s.length === 10)) {
    if (!isValidUtcCivilDate(ymdOnly.year, ymdOnly.month, ymdOnly.day)) return failDate();
    return okDate(`${ymdOnly.year}-${pad2(ymdOnly.month)}-${pad2(ymdOnly.day)}`);
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2} /.test(s)) {
    const instant = new Date(s);
    if (Number.isNaN(instant.getTime())) return failDate();
    try {
      return okDate(formatKstDate(instant));
    } catch {
      return failDate();
    }
  }

  return failDate();
}

/**
 * YYYYMMDD | YYYY-MM-DD | ISO datetime | Date → YYYY-MM-DD
 * 잘못된 형식이면 TypeError. 검증만 필요하면 parseTradingDate 를 쓴다.
 */
function normalizeTradingDate(input) {
  const parsed = parseTradingDate(input);
  if (!parsed.ok) {
    throw new TypeError(`invalid trading date: ${String(input)}`);
  }
  return parsed.date;
}

function utcWeekday(ymd) {
  const parts = parseYmdParts(ymd);
  if (!parts || !isValidUtcCivilDate(parts.year, parts.month, parts.day)) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** UTC civil date 토(6)/일(0). 주말은 거래일이 아니다. */
function isWeekendUtcCivilDate(ymd) {
  const dow = utcWeekday(ymd);
  return dow === 0 || dow === 6;
}

function addCalendarDays(ymd, n) {
  const parsed = parseTradingDate(ymd);
  if (!parsed.ok) {
    throw new TypeError(`invalid trading date: ${String(ymd)}`);
  }
  if (!Number.isInteger(n)) {
    throw new TypeError("n must be an integer");
  }
  const parts = parseYmdParts(parsed.date);
  const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return ymdFromUtc(dt);
}

/**
 * Compatibility wrapper; prefer CalendarProvider getTradingDayOnOrAfter.
 * Existing behavior is unchanged: first listed non-weekend trading day on or after ymd, else CALENDAR_PENDING.
 */
function nextTradingDayOnOrAfter(ymd, tradingDays) {
  const parsed = parseTradingDate(ymd);
  if (!parsed.ok) return pendingResult(INVALID_DATE_FORMAT);
  const days = Array.isArray(tradingDays) ? tradingDays : [];
  if (days.length === 0) return pendingResult();
  for (const raw of days) {
    let d;
    try {
      d = normalizeTradingDate(raw);
    } catch {
      continue;
    }
    if (isWeekendUtcCivilDate(d)) continue;
    if (d >= parsed.date) {
      return {
        ok: true,
        targetTradingDate: d,
        evaluationStatus: "PENDING",
        missingData: [],
        code: null,
      };
    }
  }
  return pendingResult();
}

function resolveLegacyTarget(base, calendar) {
  const parsed = parseTradingDate(base);
  if (!parsed.ok) return pendingResult(INVALID_DATE_FORMAT);
  const days = calendar && typeof calendar.list === "function" ? calendar.list() : [];
  if (!Array.isArray(days) || days.length === 0) return pendingResult();
  const nominal = addCalendarDays(parsed.date, 7);
  return nextTradingDayOnOrAfter(nominal, days);
}

function createTradingCalendar(tradingDays) {
  if (!Array.isArray(tradingDays) || tradingDays.length === 0) {
    return createUnavailableCalendar();
  }

  let days;
  try {
    days = [...new Set(tradingDays.map((d) => normalizeTradingDate(d)))]
      .filter((d) => !isWeekendUtcCivilDate(d))
      .sort();
  } catch {
    return createUnavailableCalendar();
  }
  if (days.length === 0) return createUnavailableCalendar();

  const indexByDate = new Map(days.map((d, i) => [d, i]));

  function addTradingDays(baseDate, n) {
    if (!Number.isInteger(n) || n < 1) return pendingResult(INVALID_HORIZON);
    const parsed = parseTradingDate(baseDate);
    if (!parsed.ok) return pendingResult(parsed.code || INVALID_DATE_FORMAT);
    const idx = indexByDate.get(parsed.date);
    if (idx === undefined) return pendingResult();
    const targetIdx = idx + n;
    if (targetIdx >= days.length) return pendingResult();
    return {
      ok: true,
      targetTradingDate: days[targetIdx],
      evaluationStatus: "PENDING",
      missingData: [],
      code: null,
    };
  }

  return {
    addTradingDays,
    addCalendarDays,
    nextTradingDayOnOrAfter(ymd) {
      return nextTradingDayOnOrAfter(ymd, days);
    },
    resolveLegacyTarget(base) {
      return resolveLegacyTarget(base, this);
    },
    has(date) {
      const parsed = parseTradingDate(date);
      if (!parsed.ok) return false;
      return indexByDate.has(parsed.date);
    },
    list() {
      return [...days];
    },
  };
}

function createUnavailableCalendar() {
  return {
    addTradingDays() {
      return pendingResult();
    },
    addCalendarDays,
    nextTradingDayOnOrAfter() {
      return pendingResult();
    },
    resolveLegacyTarget() {
      return pendingResult();
    },
    has() {
      return false;
    },
    list() {
      return [];
    },
  };
}

module.exports = {
  normalizeTradingDate,
  parseTradingDate,
  addCalendarDays,
  nextTradingDayOnOrAfter,
  resolveLegacyTarget,
  createTradingCalendar,
  createUnavailableCalendar,
  isWeekendUtcCivilDate,
  INVALID_DATE_FORMAT,
  INVALID_HORIZON,
};
