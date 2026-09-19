/**
 * 일봉 배열에서 predict() opts를 만든다.
 * KST 15:40 = 정규장 종가 확정 시각 휴리스틱. KIS 공식 확정이 아니다.
 * TIME_HEURISTIC을 공식 종가 확정/공식 캘린더로 쓰지 않는다. 추가 KIS 호출 없음.
 * latest candle = candles[0].
 */

"use strict";

const { formatKstDate, formatKstDateTimeIso } = require("./kst");
const { parseTradingDate } = require("./krx-calendar");

const SESSION_CLOSE_HHMM = "15:40";

function unclearOpts(now, dataAsOf, extraCandle = {}) {
  return {
    now,
    dataAsOf,
    tradingDate: undefined,
    baseTradingDate: undefined,
    candleFinality: "UNKNOWN",
    finalitySource: "UNKNOWN",
    candleTradingDate: extraCandle.tradingDate || extraCandle.date,
    candle: { isFinal: false, ...extraCandle },
  };
}

function buildPredictOptsFromCandles(candles, now = new Date()) {
  const dataAsOf = formatKstDateTimeIso(now);
  const kstToday = formatKstDate(now);
  const hhmm = dataAsOf.slice(11, 16);

  const latest = Array.isArray(candles) && candles.length > 0 ? candles[0] : null;
  const rawDate = latest && (latest.date || latest.tradingDate);
  const parsed = rawDate != null ? parseTradingDate(rawDate) : { ok: false };

  if (!parsed.ok || !parsed.date) {
    return unclearOpts(now, dataAsOf);
  }

  const date = parsed.date;
  let isFinal;
  let marketSession;
  let candleFinality;
  let finalitySource;

  if (date < kstToday) {
    isFinal = true;
    marketSession = "CLOSED";
    candleFinality = "FINAL";
    finalitySource = "HISTORICAL_DATE";
  } else if (date === kstToday && hhmm >= SESSION_CLOSE_HHMM) {
    // TIME_HEURISTIC: 15:40 시각 판정. KIS 공식 종가 확정이 아니다.
    isFinal = true;
    marketSession = "CLOSED";
    candleFinality = "FINAL";
    finalitySource = "TIME_HEURISTIC";
  } else if (date === kstToday && hhmm < SESSION_CLOSE_HHMM) {
    isFinal = false;
    marketSession = "OPEN";
    candleFinality = "NOT_FINAL";
    finalitySource = "TIME_HEURISTIC";
  } else {
    return unclearOpts(now, dataAsOf, { date, tradingDate: date });
  }

  return {
    now,
    dataAsOf,
    tradingDate: date,
    baseTradingDate: date,
    candleFinality,
    finalitySource,
    candleTradingDate: date,
    candle: { date, tradingDate: date, isFinal, marketSession },
  };
}

module.exports = { buildPredictOptsFromCandles };
