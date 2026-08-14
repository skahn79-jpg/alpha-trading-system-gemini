/**
 * 거래일(trading day)과 장 세션(session)을 분리한다.
 * 공식 세션 공지가 없으면 SESSION_SCHEDULE_PENDING, 시각은 null.
 * TIME_HEURISTIC 15:40 또는 09:00/15:30 을 공식 세션으로 쓰지 않는다.
 */

"use strict";

const TIMEZONE_SEOUL = "Asia/Seoul";

const SESSION_TYPE = Object.freeze({
  REGULAR_SESSION: "REGULAR_SESSION",
  DELAYED_OPEN_SESSION: "DELAYED_OPEN_SESSION",
  EARLY_CLOSE_SESSION: "EARLY_CLOSE_SESSION",
  SPECIAL_SESSION: "SPECIAL_SESSION",
  SESSION_SCHEDULE_PENDING: "SESSION_SCHEDULE_PENDING",
});

const SESSION_TYPES = new Set(Object.values(SESSION_TYPE));

function pendingSessionSchedule(date, extra = {}) {
  return {
    date: date || null,
    sessionType: SESSION_TYPE.SESSION_SCHEDULE_PENDING,
    marketOpenTime: null,
    marketCloseTime: null,
    timezone: TIMEZONE_SEOUL,
    ...extra,
  };
}

function isKnownSessionType(value) {
  return SESSION_TYPES.has(value);
}

/**
 * 공식 세션 공지(session exception / notice)가 있을 때만 시각·유형을 채운다.
 * CSAT 등 지연 개장일은 TRADING_DAY + DELAYED_OPEN_SESSION 이며,
 * 시각은 공지에 있을 때만 넣고 없으면 null 이다.
 */
function resolveSessionSchedule(date, sessionException) {
  if (!sessionException) {
    return pendingSessionSchedule(date);
  }
  const sessionType = isKnownSessionType(sessionException.sessionType)
    ? sessionException.sessionType
    : SESSION_TYPE.SESSION_SCHEDULE_PENDING;
  return {
    date,
    sessionType,
    marketOpenTime: sessionException.marketOpenTime == null ? null : sessionException.marketOpenTime,
    marketCloseTime: sessionException.marketCloseTime == null ? null : sessionException.marketCloseTime,
    timezone: sessionException.timezone || TIMEZONE_SEOUL,
    sourceRef: sessionException.sourceRef || null,
  };
}

module.exports = {
  TIMEZONE_SEOUL,
  SESSION_TYPE,
  SESSION_TYPES,
  isKnownSessionType,
  pendingSessionSchedule,
  resolveSessionSchedule,
};
