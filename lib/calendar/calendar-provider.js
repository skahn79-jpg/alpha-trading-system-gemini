/**
 * CalendarProvider — 거래일 상태·세션·커버리지를 제공하는 조회 API.
 * 모호한 getNextTradingDay() 는 두지 않는다.
 * 기본 예측 멀티호라이즌은 바꾸지 않는다. 호라이즌 상수만 제공한다.
 */

"use strict";

const {
  addCalendarDays,
  isWeekendUtcCivilDate,
  INVALID_HORIZON,
} = require("./krx-calendar");
const {
  TIMEZONE_SEOUL,
  SESSION_TYPE,
  pendingSessionSchedule,
  resolveSessionSchedule,
} = require("./session-schedule");
const {
  CONTENT_CHECKSUM_MISMATCH,
  METADATA_HASH_MISMATCH,
} = require("./calendar-checksum");

const INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT";
const INVALID_DATE_VALUE = "INVALID_DATE_VALUE";

const SYNTHETIC_FIXTURE_NOT_ALLOWED = "SYNTHETIC_FIXTURE_NOT_ALLOWED";
const TEST_VERIFICATION_STATUS_NOT_ALLOWED = "TEST_VERIFICATION_STATUS_NOT_ALLOWED";
const SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED = "SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED";
const PRODUCTION_NOT_ELIGIBLE = "PRODUCTION_NOT_ELIGIBLE";

const LOAD_MODE = Object.freeze({
  PRODUCTION: "PRODUCTION",
  TEST: "TEST",
});

const TRADING_DAY_STATUS = Object.freeze({
  TRADING_DAY: "TRADING_DAY",
  NON_TRADING_DAY: "NON_TRADING_DAY",
  CALENDAR_PENDING: "CALENDAR_PENDING",
  CALENDAR_RANGE_INSUFFICIENT: "CALENDAR_RANGE_INSUFFICIENT",
  CALENDAR_SOURCE_CONFLICT: "CALENDAR_SOURCE_CONFLICT",
});

const COMPLETENESS = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  UNKNOWN_COMPLETENESS: "UNKNOWN_COMPLETENESS",
});

const VERIFICATION_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  PENDING: "PENDING",
  TEST_VERIFIED: "TEST_VERIFIED",
});

const PRODUCTION_CALENDAR_STATUS = Object.freeze({
  NOT_CONFIGURED: "NOT_CONFIGURED",
  CONFIGURED: "CONFIGURED",
});

const HORIZON_TRADING_DAYS = Object.freeze({
  ULTRA_SHORT: 1,
  SHORT: 5,
  MEDIUM: 20,
  LONG: 60,
});

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * 캘린더 키는 YYYY-MM-DD 만 허용한다.
 * Date / ISO / YYYYMMDD / 로컬 타임존 변환을 하지 않는다.
 * 패턴은 맞지만 존재하지 않는 날(2100-02-30) → INVALID_DATE_VALUE.
 * 패턴 불일치 → INVALID_DATE_FORMAT.
 */
function parseCalendarDate(input) {
  if (typeof input !== "string") {
    return { ok: false, date: null, code: INVALID_DATE_FORMAT, error: "date must be YYYY-MM-DD" };
  }
  if (!YMD_RE.test(input)) {
    return { ok: false, date: null, code: INVALID_DATE_FORMAT, error: "INVALID_DATE_FORMAT" };
  }
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  if (!isValidUtcCivilDate(year, month, day)) {
    return { ok: false, date: null, code: INVALID_DATE_VALUE, error: "INVALID_DATE_VALUE" };
  }
  return { ok: true, date: `${year}-${pad2(month)}-${pad2(day)}`, code: null, error: null };
}

function inCoverage(date, coverage) {
  if (!coverage || !coverage.start || !coverage.end) return false;
  return date >= coverage.start && date <= coverage.end;
}

function normalizeLoadOpts(opts) {
  const mode = opts && opts.mode === LOAD_MODE.TEST ? LOAD_MODE.TEST : LOAD_MODE.PRODUCTION;
  const allowSyntheticFixture = mode === LOAD_MODE.TEST && opts && opts.allowSyntheticFixture === true;
  return { mode, allowSyntheticFixture };
}

function accessFail(code, error) {
  return { ok: false, code, error: error || code };
}

function assertCalendarAccess(snapshot, opts) {
  const loadOpts = normalizeLoadOpts(opts);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: true };
  }

  if (snapshot.verificationStatus === VERIFICATION_STATUS.VERIFIED && snapshot.notProductionData === true) {
    return accessFail(SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED);
  }
  if (snapshot.notProductionData === true && loadOpts.mode !== LOAD_MODE.TEST) {
    return accessFail(SYNTHETIC_FIXTURE_NOT_ALLOWED);
  }
  if (snapshot.verificationStatus === VERIFICATION_STATUS.TEST_VERIFIED && loadOpts.allowSyntheticFixture !== true) {
    return accessFail(TEST_VERIFICATION_STATUS_NOT_ALLOWED);
  }
  if (snapshot.verificationStatus === VERIFICATION_STATUS.VERIFIED && snapshot.productionEligible === false) {
    return accessFail(PRODUCTION_NOT_ELIGIBLE);
  }
  if (snapshot.verificationStatus === VERIFICATION_STATUS.TEST_VERIFIED && snapshot.productionEligible === true) {
    return accessFail(TEST_VERIFICATION_STATUS_NOT_ALLOWED);
  }
  return { ok: true };
}

function dateErrorResult(code, extras = {}) {
  return {
    ok: false,
    date: null,
    tradingDayStatus: null,
    sessionType: null,
    marketOpenTime: null,
    marketCloseTime: null,
    timezone: TIMEZONE_SEOUL,
    calendarVersion: extras.calendarVersion || null,
    sourceRef: null,
    verificationStatus: extras.verificationStatus || VERIFICATION_STATUS.PENDING,
    targetTradingDate: null,
    evaluationStatus: null,
    targetDateStatus: "CALENDAR_PENDING",
    missingData: ["krxTradingCalendar"],
    dates: [],
    code,
    error: extras.error || code,
  };
}

function horizonErrorResult(extras = {}) {
  return {
    ok: false,
    date: extras.date || null,
    tradingDayStatus: extras.tradingDayStatus || null,
    sessionType: SESSION_TYPE.SESSION_SCHEDULE_PENDING,
    marketOpenTime: null,
    marketCloseTime: null,
    timezone: TIMEZONE_SEOUL,
    calendarVersion: extras.calendarVersion || null,
    sourceRef: extras.sourceRef || null,
    verificationStatus: extras.verificationStatus || VERIFICATION_STATUS.PENDING,
    targetTradingDate: null,
    evaluationStatus: null,
    targetDateStatus: "CALENDAR_PENDING",
    missingData: [],
    code: INVALID_HORIZON,
    error: INVALID_HORIZON,
  };
}

function createUnavailableCalendarProvider(opts = {}) {
  const failCode = opts.code || TRADING_DAY_STATUS.CALENDAR_PENDING;
  const verificationStatus = VERIFICATION_STATUS.PENDING;
  const productionCalendarStatus = PRODUCTION_CALENDAR_STATUS.NOT_CONFIGURED;
  const calendarVersion = null;

  function pendingQuery(dateInput) {
    const parsed = parseCalendarDate(dateInput);
    if (!parsed.ok) {
      return dateErrorResult(parsed.code, { error: parsed.error, verificationStatus, calendarVersion });
    }
    const session = pendingSessionSchedule(parsed.date);
    return {
      ok: false,
      date: parsed.date,
      tradingDayStatus: TRADING_DAY_STATUS.CALENDAR_PENDING,
      sessionType: session.sessionType,
      marketOpenTime: session.marketOpenTime,
      marketCloseTime: session.marketCloseTime,
      timezone: session.timezone,
      calendarVersion,
      sourceRef: null,
      verificationStatus,
      productionCalendarStatus,
      targetTradingDate: null,
      evaluationStatus: null,
      targetDateStatus: "CALENDAR_PENDING",
      missingData: ["krxTradingCalendar"],
      dates: [],
      code: failCode,
      error: failCode,
      providerStatus: "UNAVAILABLE",
      originalErrorCode: failCode,
    };
  }

  return {
    productionCalendarStatus,
    verificationStatus,
    providerStatus: "UNAVAILABLE",
    originalErrorCode: failCode,
    getTradingDayStatus(date) {
      return pendingQuery(date);
    },
    getTradingDayOnOrAfter(date) {
      return pendingQuery(date);
    },
    getNextTradingDayAfter(date) {
      return pendingQuery(date);
    },
    addTradingDays(date, count) {
      if (!Number.isInteger(count) || count < 1) {
        const parsed = typeof date === "string" && YMD_RE.test(date) ? parseCalendarDate(date) : { ok: false };
        return horizonErrorResult({
          date: parsed.ok ? parsed.date : null,
          tradingDayStatus: parsed.ok ? TRADING_DAY_STATUS.CALENDAR_PENDING : null,
          verificationStatus,
          calendarVersion,
        });
      }
      return pendingQuery(date);
    },
    addCalendarDays,
    resolveLegacyTarget(baseTradingDate) {
      return pendingQuery(baseTradingDate);
    },
    getTradingDaysBetween(startDate, endDate) {
      const start = parseCalendarDate(startDate);
      if (!start.ok) return dateErrorResult(start.code, { error: start.error, verificationStatus, calendarVersion });
      const end = parseCalendarDate(endDate);
      if (!end.ok) return dateErrorResult(end.code, { error: end.error, verificationStatus, calendarVersion });
      return pendingQuery(startDate);
    },
    getSessionSchedule(date) {
      return pendingQuery(date);
    },
    getCoverage() {
      return null;
    },
    getVersion() {
      return {
        calendarId: null,
        calendarVersion,
        canonicalizationVersion: null,
        contentChecksum: null,
        metadataHash: null,
        verificationStatus,
        productionCalendarStatus,
        originalErrorCode: failCode,
        providerStatus: "UNAVAILABLE",
      };
    },
    getSources() {
      return [];
    },
    validateIntegrity() {
      return {
        ok: false,
        code: failCode,
        error: failCode,
        providerStatus: "UNAVAILABLE",
      };
    },
  };
}

function canConfirmNonTradingWeekday(snapshot, loadOpts) {
  const coverage = snapshot.coverage || {};
  if (coverage.completeness !== COMPLETENESS.COMPLETE) return false;
  if (snapshot.sourceConflict === true) return false;
  if (snapshot.contentChecksumVerified !== true) return false;
  if (snapshot.metadataHashVerified !== true) return false;

  const opts = normalizeLoadOpts(loadOpts);
  if (opts.mode === LOAD_MODE.TEST && opts.allowSyntheticFixture === true) {
    return snapshot.verificationStatus === VERIFICATION_STATUS.TEST_VERIFIED
      && snapshot.notProductionData === true
      && snapshot.productionEligible === false;
  }
  return snapshot.verificationStatus === VERIFICATION_STATUS.VERIFIED
    && snapshot.notProductionData !== true
    && snapshot.productionEligible === true;
}

function createCalendarProvider(snapshot, opts) {
  const loadOpts = normalizeLoadOpts(opts);
  const gate = assertCalendarAccess(snapshot, loadOpts);
  if (!gate.ok) {
    return createUnavailableCalendarProvider({ code: gate.code });
  }

  const coverage = snapshot.coverage;
  const tradingDays = Array.isArray(snapshot.tradingDays) ? [...snapshot.tradingDays].sort() : [];
  const tradingDaySet = new Set(tradingDays);
  const sessionByDate = new Map();
  for (const ex of snapshot.sessionExceptions || []) {
    if (ex && ex.date) sessionByDate.set(ex.date, ex);
  }
  const sources = Array.isArray(snapshot.sources) ? snapshot.sources.map((s) => ({ ...s })) : [];
  const sourceRefDefault = sources[0] && sources[0].sourceRef ? sources[0].sourceRef : null;
  const calendarVersion = snapshot.calendarVersion || null;
  const verificationStatus = snapshot.verificationStatus || VERIFICATION_STATUS.PENDING;
  const confirmNonTrading = canConfirmNonTradingWeekday(snapshot, loadOpts);
  const productionCalendarStatus = loadOpts.mode === LOAD_MODE.TEST
    ? PRODUCTION_CALENDAR_STATUS.NOT_CONFIGURED
    : (confirmNonTrading
      ? PRODUCTION_CALENDAR_STATUS.CONFIGURED
      : PRODUCTION_CALENDAR_STATUS.NOT_CONFIGURED);

  function attachSession(date, tradingDayStatus) {
    if (tradingDayStatus !== TRADING_DAY_STATUS.TRADING_DAY) {
      const pending = pendingSessionSchedule(date);
      return {
        ...pending,
        sourceRef: sourceRefDefault,
      };
    }
    const resolved = resolveSessionSchedule(date, sessionByDate.get(date) || null);
    return {
      ...resolved,
      sourceRef: resolved.sourceRef || sourceRefDefault,
    };
  }

  function statusResult(date, tradingDayStatus) {
    const session = attachSession(date, tradingDayStatus);
    const known = tradingDayStatus === TRADING_DAY_STATUS.TRADING_DAY
      || tradingDayStatus === TRADING_DAY_STATUS.NON_TRADING_DAY;
    const unresolved = !known;
    return {
      ok: true,
      date,
      tradingDayStatus,
      sessionType: session.sessionType,
      marketOpenTime: session.marketOpenTime,
      marketCloseTime: session.marketCloseTime,
      timezone: session.timezone || TIMEZONE_SEOUL,
      calendarVersion,
      sourceRef: session.sourceRef || sourceRefDefault,
      verificationStatus,
      productionCalendarStatus,
      targetTradingDate: null,
      evaluationStatus: unresolved ? null : "PENDING",
      targetDateStatus: tradingDayStatus === TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT
        ? "CALENDAR_RANGE_INSUFFICIENT"
        : tradingDayStatus === TRADING_DAY_STATUS.CALENDAR_SOURCE_CONFLICT
          ? "CALENDAR_SOURCE_CONFLICT"
          : unresolved ? "CALENDAR_PENDING" : "CONFIRMED",
      missingData: unresolved ? ["krxTradingCalendar"] : [],
      dates: [],
      code: known ? null : tradingDayStatus,
      error: known ? null : tradingDayStatus,
    };
  }

  function targetSuccess(status) {
    return {
      ...status,
      ok: true,
      targetTradingDate: status.date,
      evaluationStatus: "PENDING",
      targetDateStatus: "CONFIRMED",
      missingData: [],
      code: null,
      error: null,
    };
  }

  function targetFailure(status) {
    let targetDateStatus = "CALENDAR_PENDING";
    if (status.tradingDayStatus === TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT) {
      targetDateStatus = "CALENDAR_RANGE_INSUFFICIENT";
    } else if (status.tradingDayStatus === TRADING_DAY_STATUS.CALENDAR_SOURCE_CONFLICT) {
      targetDateStatus = "CALENDAR_SOURCE_CONFLICT";
    }
    const code = status.code
      || (status.tradingDayStatus === TRADING_DAY_STATUS.TRADING_DAY
        || status.tradingDayStatus === TRADING_DAY_STATUS.NON_TRADING_DAY
        ? TRADING_DAY_STATUS.CALENDAR_PENDING
        : status.tradingDayStatus);
    return {
      ...status,
      ok: false,
      targetTradingDate: null,
      evaluationStatus: null,
      targetDateStatus,
      missingData: ["krxTradingCalendar"],
      dates: [],
      code,
      error: status.error || code,
    };
  }

  function getTradingDayStatus(dateInput) {
    const parsed = parseCalendarDate(dateInput);
    if (!parsed.ok) {
      return dateErrorResult(parsed.code, { error: parsed.error, verificationStatus, calendarVersion });
    }
    const date = parsed.date;
    if (snapshot.sourceConflict === true) {
      return statusResult(date, TRADING_DAY_STATUS.CALENDAR_SOURCE_CONFLICT);
    }
    if (!inCoverage(date, coverage)) {
      return statusResult(date, TRADING_DAY_STATUS.CALENDAR_RANGE_INSUFFICIENT);
    }
    if (isWeekendUtcCivilDate(date)) {
      return statusResult(date, TRADING_DAY_STATUS.NON_TRADING_DAY);
    }
    if (tradingDaySet.has(date)) {
      return statusResult(date, TRADING_DAY_STATUS.TRADING_DAY);
    }
    if (confirmNonTrading) {
      return statusResult(date, TRADING_DAY_STATUS.NON_TRADING_DAY);
    }
    return statusResult(date, TRADING_DAY_STATUS.CALENDAR_PENDING);
  }

  function getTradingDayOnOrAfter(dateInput) {
    const parsed = parseCalendarDate(dateInput);
    if (!parsed.ok) {
      return dateErrorResult(parsed.code, { error: parsed.error, verificationStatus, calendarVersion });
    }
    let cursor = parsed.date;
    for (let i = 0; i < 4000; i += 1) {
      const status = getTradingDayStatus(cursor);
      if (status.code === INVALID_DATE_FORMAT || status.code === INVALID_DATE_VALUE) {
        return status;
      }
      if (status.tradingDayStatus === TRADING_DAY_STATUS.TRADING_DAY) {
        return targetSuccess(status);
      }
      if (status.tradingDayStatus === TRADING_DAY_STATUS.NON_TRADING_DAY) {
        cursor = addCalendarDays(cursor, 1);
        continue;
      }
      return targetFailure(status);
    }
    return targetFailure(getTradingDayStatus(cursor));
  }

  function getNextTradingDayAfter(dateInput) {
    const parsed = parseCalendarDate(dateInput);
    if (!parsed.ok) {
      return dateErrorResult(parsed.code, { error: parsed.error, verificationStatus, calendarVersion });
    }
    const next = addCalendarDays(parsed.date, 1);
    return getTradingDayOnOrAfter(next);
  }

  function addTradingDays(dateInput, count) {
    if (!Number.isInteger(count) || count < 1) {
      const parsed = parseCalendarDate(dateInput);
      return horizonErrorResult({
        date: parsed.ok ? parsed.date : null,
        tradingDayStatus: parsed.ok ? getTradingDayStatus(parsed.date).tradingDayStatus : null,
        verificationStatus,
        calendarVersion,
        sourceRef: sourceRefDefault,
      });
    }
    const parsed = parseCalendarDate(dateInput);
    if (!parsed.ok) {
      return dateErrorResult(parsed.code, { error: parsed.error, verificationStatus, calendarVersion });
    }
    const baseStatus = getTradingDayStatus(parsed.date);
    if (baseStatus.tradingDayStatus !== TRADING_DAY_STATUS.TRADING_DAY) {
      return targetFailure(baseStatus);
    }
    let remaining = count;
    let cursor = parsed.date;
    while (remaining > 0) {
      cursor = addCalendarDays(cursor, 1);
      const status = getTradingDayStatus(cursor);
      if (status.code === INVALID_DATE_FORMAT || status.code === INVALID_DATE_VALUE) {
        return status;
      }
      if (status.tradingDayStatus === TRADING_DAY_STATUS.TRADING_DAY) {
        remaining -= 1;
        if (remaining === 0) return targetSuccess(status);
        continue;
      }
      if (status.tradingDayStatus === TRADING_DAY_STATUS.NON_TRADING_DAY) {
        continue;
      }
      return targetFailure(status);
    }
    return targetFailure(baseStatus);
  }

  function resolveLegacyTarget(baseTradingDate) {
    const parsed = parseCalendarDate(baseTradingDate);
    if (!parsed.ok) {
      return dateErrorResult(parsed.code, { error: parsed.error, verificationStatus, calendarVersion });
    }
    const nominal = addCalendarDays(parsed.date, 7);
    const status = getTradingDayStatus(nominal);
    if (status.code === INVALID_DATE_FORMAT || status.code === INVALID_DATE_VALUE) {
      return status;
    }
    if (status.tradingDayStatus === TRADING_DAY_STATUS.TRADING_DAY) {
      return targetSuccess(status);
    }
    if (status.tradingDayStatus === TRADING_DAY_STATUS.NON_TRADING_DAY) {
      return getTradingDayOnOrAfter(nominal);
    }
    return targetFailure(status);
  }

  function getTradingDaysBetween(startDate, endDate) {
    const start = parseCalendarDate(startDate);
    if (!start.ok) {
      return dateErrorResult(start.code, { error: start.error, verificationStatus, calendarVersion });
    }
    const end = parseCalendarDate(endDate);
    if (!end.ok) {
      return dateErrorResult(end.code, { error: end.error, verificationStatus, calendarVersion });
    }
    const dates = [];
    let cursor = start.date;
    while (cursor <= end.date) {
      const status = getTradingDayStatus(cursor);
      if (status.tradingDayStatus === TRADING_DAY_STATUS.TRADING_DAY) {
        dates.push(cursor);
      } else if (status.tradingDayStatus === TRADING_DAY_STATUS.NON_TRADING_DAY) {
        /* skip */
      } else {
        return { ...targetFailure(status), dates: [] };
      }
      cursor = addCalendarDays(cursor, 1);
    }
    return {
      ok: true,
      dates,
      date: start.date,
      tradingDayStatus: TRADING_DAY_STATUS.TRADING_DAY,
      sessionType: SESSION_TYPE.SESSION_SCHEDULE_PENDING,
      marketOpenTime: null,
      marketCloseTime: null,
      timezone: TIMEZONE_SEOUL,
      calendarVersion,
      sourceRef: sourceRefDefault,
      verificationStatus,
      targetTradingDate: dates[0] || null,
      evaluationStatus: "PENDING",
      targetDateStatus: "CONFIRMED",
      missingData: [],
      code: null,
      error: null,
    };
  }

  function getSessionSchedule(dateInput) {
    return getTradingDayStatus(dateInput);
  }

  const version = {
    calendarId: snapshot.calendarId,
    calendarVersion,
    canonicalizationVersion: snapshot.canonicalizationVersion,
    contentChecksum: snapshot.contentChecksum || null,
    metadataHash: snapshot.metadataHash || null,
    verificationStatus,
    productionCalendarStatus,
  };
  if (snapshot.metadataHashVerified !== undefined) {
    version.metadataHashVerified = snapshot.metadataHashVerified;
  }

  return {
    productionCalendarStatus,
    verificationStatus,
    getTradingDayStatus,
    getTradingDayOnOrAfter,
    getNextTradingDayAfter,
    addTradingDays,
    addCalendarDays,
    resolveLegacyTarget,
    getTradingDaysBetween,
    getSessionSchedule,
    getCoverage() {
      return {
        start: coverage.start,
        end: coverage.end,
        completeness: coverage.completeness,
      };
    },
    getVersion() {
      return { ...version };
    },
    getSources() {
      return sources.map((s) => ({ ...s }));
    },
    validateIntegrity() {
      if (snapshot.sourceConflict === true) {
        return { ok: false, code: TRADING_DAY_STATUS.CALENDAR_SOURCE_CONFLICT, error: "source conflict" };
      }
      if (snapshot.contentChecksumVerified !== true) {
        return { ok: false, code: CONTENT_CHECKSUM_MISMATCH, error: "content checksum not verified" };
      }
      if (snapshot.metadataHashVerified !== true) {
        return { ok: false, code: METADATA_HASH_MISMATCH, error: "metadata hash not verified" };
      }
      return { ok: true, code: null, error: null };
    },
  };
}

module.exports = {
  INVALID_DATE_FORMAT,
  INVALID_DATE_VALUE,
  TRADING_DAY_STATUS,
  COMPLETENESS,
  VERIFICATION_STATUS,
  PRODUCTION_CALENDAR_STATUS,
  HORIZON_TRADING_DAYS,
  LOAD_MODE,
  SYNTHETIC_FIXTURE_NOT_ALLOWED,
  TEST_VERIFICATION_STATUS_NOT_ALLOWED,
  SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED,
  PRODUCTION_NOT_ELIGIBLE,
  parseCalendarDate,
  normalizeLoadOpts,
  assertCalendarAccess,
  canConfirmNonTradingWeekday,
  createCalendarProvider,
  createUnavailableCalendarProvider,
};
