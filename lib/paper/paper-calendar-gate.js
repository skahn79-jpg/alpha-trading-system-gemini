/**
 * GATE 12P Paper calendar gate v1.
 * Pure. Injected provider only. Does not import or mutate lib/calendar.
 * SEQUENCE_STATE_MUTATION: 0
 */

"use strict";

const { isPlainObject, hasOwnRecordKey } = require("./paper-account-state");
const { PAPER_MARKETS } = require("./paper-market-event-identity");

const PAPER_MARKET_SET = new Set(PAPER_MARKETS);
const MARKET_TIMEZONE = "Asia/Seoul";
const SEOUL_OFFSET = "+09:00";
const SESSION_TIME_RE = /^(\d{2}):(\d{2}):(\d{2})$/;
const EXCHANGE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;

const CONTROL = Object.freeze({
  REJECT_EVENT: "REJECT_EVENT",
  PAUSE_STREAM: "PAUSE_STREAM",
  HALT_STREAM: "HALT_STREAM",
});

const ERROR = Object.freeze({
  PAPER_CALENDAR_INVALID_INPUT: "PAPER_CALENDAR_INVALID_INPUT",
  PAPER_CALENDAR_UNKNOWN_MARKET: "PAPER_CALENDAR_UNKNOWN_MARKET",
  PAPER_CALENDAR_NOT_TRADING_DAY: "PAPER_CALENDAR_NOT_TRADING_DAY",
  PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION: "PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION",
  PAPER_CALENDAR_UNSUPPORTED_SESSION: "PAPER_CALENDAR_UNSUPPORTED_SESSION",
  PAPER_CALENDAR_UNVERIFIED: "PAPER_CALENDAR_UNVERIFIED",
  PAPER_CALENDAR_UNAVAILABLE: "PAPER_CALENDAR_UNAVAILABLE",
  PAPER_CALENDAR_MALFORMED: "PAPER_CALENDAR_MALFORMED",
  PAPER_CALENDAR_PENDING: "PAPER_CALENDAR_PENDING",
  PAPER_CALENDAR_OUT_OF_RANGE: "PAPER_CALENDAR_OUT_OF_RANGE",
  PAPER_CALENDAR_OFFSET_MISMATCH: "PAPER_CALENDAR_OFFSET_MISMATCH",
  PAPER_CALENDAR_TRADING_DATE_MISMATCH: "PAPER_CALENDAR_TRADING_DATE_MISMATCH",
});

const COVERAGE_PENDING = "PENDING";
const COVERAGE_UNAVAILABLE = "UNAVAILABLE";
const COVERAGE_VERIFIED = "VERIFIED";

function result(ok, code, control, extras) {
  const out = {
    ok: ok === true,
    code: code == null ? null : code,
    control: control == null ? null : control,
    sessionType: extras && extras.sessionType !== undefined ? extras.sessionType : null,
    market: extras && extras.market !== undefined ? extras.market : null,
    tradingDate: extras && extras.tradingDate !== undefined ? extras.tradingDate : null,
    calendarVersion: extras && extras.calendarVersion !== undefined ? extras.calendarVersion : null,
  };
  if (extras && extras.field !== undefined) out.field = extras.field;
  return out;
}

function pause(code, extras) {
  return result(false, code, CONTROL.PAUSE_STREAM, extras);
}

function rejectEvent(code, extras) {
  return result(false, code, CONTROL.REJECT_EVENT, extras);
}

function halt(code, extras) {
  return result(false, code, CONTROL.HALT_STREAM, extras);
}

function timeToSeconds(hhmmss) {
  const matched = SESSION_TIME_RE.exec(hhmmss);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const second = Number(matched[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 3600 + minute * 60 + second;
}

function parseExchangeRepresentation(value) {
  if (typeof value !== "string") return null;
  const matched = EXCHANGE_TIME_RE.exec(value);
  if (!matched) return null;
  return {
    date: matched[1] + "-" + matched[2] + "-" + matched[3],
    time: matched[4] + ":" + matched[5] + ":" + matched[6],
    offset: matched[7] + matched[8] + ":" + matched[9],
    hour: Number(matched[4]),
    minute: Number(matched[5]),
    second: Number(matched[6]),
  };
}

function readOwn(record, key) {
  if (!isPlainObject(record) || !hasOwnRecordKey(record, key)) return undefined;
  return record[key];
}

function findRegularSession(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { found: false, empty: true, session: null };
  }
  let sawNonRegular = false;
  for (let i = 0; i < sessions.length; i += 1) {
    const sess = sessions[i];
    if (!isPlainObject(sess)) continue;
    const type = readOwn(sess, "type");
    if (type === "REGULAR") {
      return { found: true, empty: false, session: sess, sawNonRegular: sawNonRegular };
    }
    if (typeof type === "string") sawNonRegular = true;
  }
  return { found: false, empty: false, session: null, sawNonRegular: sawNonRegular };
}

function validatePaperMarketCalendar(canonicalEvent, calendarProvider) {
  const extrasBase = { sessionType: null, market: null, tradingDate: null, calendarVersion: null };

  if (!isPlainObject(canonicalEvent)) {
    return pause(ERROR.PAPER_CALENDAR_INVALID_INPUT, extrasBase);
  }

  const market = readOwn(canonicalEvent, "market");
  const tradingDate = readOwn(canonicalEvent, "tradingDate");
  const exchangeEventTime = readOwn(canonicalEvent, "exchangeEventTime");
  extrasBase.market = typeof market === "string" ? market : null;
  extrasBase.tradingDate = typeof tradingDate === "string" ? tradingDate : null;

  if (market === undefined || tradingDate === undefined || exchangeEventTime === undefined) {
    return pause(ERROR.PAPER_CALENDAR_INVALID_INPUT, extrasBase);
  }

  if (typeof market !== "string" || !PAPER_MARKET_SET.has(market)) {
    return rejectEvent(ERROR.PAPER_CALENDAR_UNKNOWN_MARKET, extrasBase);
  }

  if (calendarProvider == null || !isPlainObject(calendarProvider)
    || typeof calendarProvider.lookup !== "function") {
    return pause(ERROR.PAPER_CALENDAR_UNAVAILABLE, extrasBase);
  }

  let providerResult;
  try {
    providerResult = calendarProvider.lookup({ market: market, tradingDate: tradingDate });
  } catch (_err) {
    return pause(ERROR.PAPER_CALENDAR_UNAVAILABLE, extrasBase);
  }

  if (providerResult == null) {
    return pause(ERROR.PAPER_CALENDAR_UNAVAILABLE, extrasBase);
  }
  if (!isPlainObject(providerResult)) {
    return pause(ERROR.PAPER_CALENDAR_MALFORMED, extrasBase);
  }

  const coverageStatus = readOwn(providerResult, "coverageStatus");
  if (coverageStatus === COVERAGE_PENDING) {
    return pause(ERROR.PAPER_CALENDAR_PENDING, extrasBase);
  }
  if (coverageStatus === COVERAGE_UNAVAILABLE) {
    return pause(ERROR.PAPER_CALENDAR_UNAVAILABLE, extrasBase);
  }
  if (readOwn(providerResult, "outOfRange") === true) {
    return pause(ERROR.PAPER_CALENDAR_OUT_OF_RANGE, extrasBase);
  }

  const verified = readOwn(providerResult, "verified");
  if (verified !== true) {
    return pause(ERROR.PAPER_CALENDAR_UNVERIFIED, extrasBase);
  }

  extrasBase.calendarVersion = readOwn(providerResult, "version");
  if (extrasBase.calendarVersion !== undefined && extrasBase.calendarVersion !== null
    && typeof extrasBase.calendarVersion !== "string") {
    return pause(ERROR.PAPER_CALENDAR_MALFORMED, extrasBase);
  }
  if (extrasBase.calendarVersion === undefined) extrasBase.calendarVersion = null;

  const timezone = readOwn(providerResult, "timezone");
  if (timezone !== MARKET_TIMEZONE) {
    return pause(ERROR.PAPER_CALENDAR_MALFORMED, extrasBase);
  }

  const tradingDay = readOwn(providerResult, "tradingDay");
  if (tradingDay !== true) {
    return rejectEvent(ERROR.PAPER_CALENDAR_NOT_TRADING_DAY, extrasBase);
  }

  const parsedTime = parseExchangeRepresentation(exchangeEventTime);
  if (parsedTime == null) {
    return pause(ERROR.PAPER_CALENDAR_MALFORMED, extrasBase);
  }
  if (parsedTime.offset !== SEOUL_OFFSET) {
    return halt(ERROR.PAPER_CALENDAR_OFFSET_MISMATCH, extrasBase);
  }
  if (parsedTime.date !== tradingDate) {
    return halt(ERROR.PAPER_CALENDAR_TRADING_DATE_MISMATCH, extrasBase);
  }

  const sessions = readOwn(providerResult, "sessions");
  const regular = findRegularSession(sessions);
  if (!Array.isArray(sessions) || regular.empty || !regular.found) {
    if (Array.isArray(sessions) && !regular.empty && regular.sawNonRegular && !regular.found) {
      return rejectEvent(ERROR.PAPER_CALENDAR_UNSUPPORTED_SESSION, extrasBase);
    }
    return pause(ERROR.PAPER_CALENDAR_UNVERIFIED, extrasBase);
  }

  const start = readOwn(regular.session, "start");
  const end = readOwn(regular.session, "end");
  const startSec = typeof start === "string" ? timeToSeconds(start) : null;
  const endSec = typeof end === "string" ? timeToSeconds(end) : null;
  if (startSec == null || endSec == null) {
    return pause(ERROR.PAPER_CALENDAR_UNVERIFIED, extrasBase);
  }

  const eventSec = parsedTime.hour * 3600 + parsedTime.minute * 60 + parsedTime.second;
  if (eventSec < startSec || eventSec >= endSec) {
    return rejectEvent(ERROR.PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION, extrasBase);
  }

  return result(true, null, null, {
    sessionType: "REGULAR",
    market: market,
    tradingDate: tradingDate,
    calendarVersion: extrasBase.calendarVersion,
  });
}

function createPaperCalendarGate(input) {
  const src = isPlainObject(input) ? input : {};
  const calendarProvider = hasOwnRecordKey(src, "calendarProvider") ? src.calendarProvider : null;

  function validate(canonicalEvent) {
    return validatePaperMarketCalendar(canonicalEvent, calendarProvider);
  }

  return Object.freeze({
    validate: validate,
    validatePaperMarketCalendar: validate,
  });
}

module.exports = {
  createPaperCalendarGate,
  validatePaperMarketCalendar,
  CONTROL,
  ERROR,
  MARKET_TIMEZONE,
  SEOUL_OFFSET,
};
