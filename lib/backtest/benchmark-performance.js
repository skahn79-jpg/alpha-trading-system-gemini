/**
 * GATE 5M benchmark alpha. Pure CommonJS. No I/O.
 * 6J: makeError via shared makeBacktestError. String field args become { field }.
 */

"use strict";

const { parseYmd } = require("./schemas");
const { makeBacktestError: makeError } = require("./make-error");

const PERFORMANCE_STATUS_COMPLETED = "COMPLETED_PERFORMANCE_METRICS";
const ALPHA_DEFINITION = "TOTAL_RETURN_DIFFERENCE";

const BENCHMARK_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_BENCHMARK_ALPHA",
  BLOCKED: "BLOCKED",
  NOT_STARTED: "NOT_STARTED",
});

const ERROR = Object.freeze({
  INVALID_BENCHMARK_INPUT: "INVALID_BENCHMARK_INPUT",
  INVALID_INPUT: "INVALID_INPUT",
  BENCHMARK_PERIOD_MISMATCH: "BENCHMARK_PERIOD_MISMATCH",
  BENCHMARK_MARKET_MISMATCH: "BENCHMARK_MARKET_MISMATCH",
  PRODUCTION_MARKET_NOT_ALLOWED: "PRODUCTION_MARKET_NOT_ALLOWED",
  LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE: "LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE",
  PERFORMANCE_NOT_COMPLETED: "PERFORMANCE_NOT_COMPLETED",
});

const ALLOWED_SYNTHETIC_MARKETS = Object.freeze([
  "SYNTHETIC_KOSPI",
  "SYNTHETIC_KOSDAQ",
]);

const ALLOWED_SYNTHETIC_MARKET_SET = new Set(ALLOWED_SYNTHETIC_MARKETS);
const PRODUCTION_MARKET_SET = new Set(["KOSPI", "KOSDAQ", "KRX", "NASDAQ", "NYSE"]);
const LEGACY_MARKET = "SYNTHETIC_MARKET";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueCodes(errors) {
  const seen = new Set();
  const out = [];
  for (const err of errors) {
    if (!err || err.code == null || seen.has(err.code)) continue;
    seen.add(err.code);
    out.push(err.code);
  }
  return out;
}

function utcMsFromYmd(ymd) {
  const parsed = parseYmd(ymd);
  if (!parsed.ok || parsed.date == null) return null;
  const year = Number(parsed.date.slice(0, 4));
  const month = Number(parsed.date.slice(5, 7));
  const day = Number(parsed.date.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function nullBenchmarkBundle() {
  return {
    benchmarkReturn: null,
    alpha: null,
    periodStart: null,
    periodEnd: null,
    market: null,
    benchmarkMarket: null,
    startClose: null,
    endClose: null,
  };
}

function blockedResult(errors) {
  const list = Array.isArray(errors) && errors.length > 0
    ? errors.slice()
    : [makeError(ERROR.INVALID_INPUT)];
  return {
    ok: false,
    benchmarkStatus: BENCHMARK_STATUS.BLOCKED,
    alphaDefinition: ALPHA_DEFINITION,
    ...nullBenchmarkBundle(),
    errorCodes: uniqueCodes(list),
    errors: list,
  };
}

function notStartedResult() {
  return {
    ok: false,
    benchmarkStatus: BENCHMARK_STATUS.NOT_STARTED,
    alphaDefinition: ALPHA_DEFINITION,
    ...nullBenchmarkBundle(),
    errorCodes: [],
    errors: [],
  };
}

function validateSyntheticMarket(market, field) {
  if (PRODUCTION_MARKET_SET.has(market)) return makeError(ERROR.PRODUCTION_MARKET_NOT_ALLOWED, { field });
  if (market === LEGACY_MARKET) return makeError(ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE, { field });
  if (!ALLOWED_SYNTHETIC_MARKET_SET.has(market)) return makeError(ERROR.INVALID_INPUT, { field });
  return null;
}

function calculateBenchmarkPerformance(input) {
  if (!isPlainObject(input)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT)]);
  }

  if (input.performanceStatus !== PERFORMANCE_STATUS_COMPLETED) {
    if (input.performanceStatus === "NOT_STARTED") return notStartedResult();
    return blockedResult([makeError(ERROR.PERFORMANCE_NOT_COMPLETED, { field: "performanceStatus" })]);
  }

  if (!isFiniteNumber(input.strategyTotalReturn)) {
    return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "strategyTotalReturn" })]);
  }

  const market = input.market;
  const marketError = validateSyntheticMarket(market, "market");
  if (marketError) return blockedResult([marketError]);

  const benchmarkMarket = input.benchmarkMarket == null ? market : input.benchmarkMarket;
  const benchmarkMarketError = validateSyntheticMarket(benchmarkMarket, "benchmarkMarket");
  if (benchmarkMarketError) return blockedResult([benchmarkMarketError]);
  if (market !== benchmarkMarket) {
    return blockedResult([makeError(ERROR.BENCHMARK_MARKET_MISMATCH, { field: "benchmarkMarket" })]);
  }

  const periodStartParsed = parseYmd(input.periodStart);
  const periodEndParsed = parseYmd(input.periodEnd);
  if (!periodStartParsed.ok || !periodEndParsed.ok) {
    return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "period" })]);
  }

  const periodStart = periodStartParsed.date;
  const periodEnd = periodEndParsed.date;
  const periodStartMs = utcMsFromYmd(periodStart);
  const periodEndMs = utcMsFromYmd(periodEnd);
  if (periodStartMs == null || periodEndMs == null || !(periodStartMs < periodEndMs)) {
    return blockedResult([makeError(ERROR.BENCHMARK_PERIOD_MISMATCH, { field: "period" })]);
  }

  if (!Array.isArray(input.benchmarkSeries) || input.benchmarkSeries.length < 2) {
    return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries" })]);
  }

  const series = input.benchmarkSeries.slice();
  const seenDates = new Set();
  let prevMs = null;
  let startClose = null;
  let endClose = null;

  for (let i = 0; i < series.length; i += 1) {
    const row = series[i];
    if (!isPlainObject(row) || !Object.hasOwn(row, "tradingDate") || !Object.hasOwn(row, "close")) {
      return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries" })]);
    }
    if (!isFiniteNumber(row.close) || row.close <= 0) {
      return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries.close" })]);
    }

    const parsed = parseYmd(row.tradingDate);
    if (!parsed.ok || parsed.date == null) {
      return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries.tradingDate" })]);
    }
    const ymd = parsed.date;
    const ms = utcMsFromYmd(ymd);
    if (ms == null) {
      return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries.tradingDate" })]);
    }
    if (seenDates.has(ymd)) {
      return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries.tradingDate" })]);
    }
    seenDates.add(ymd);
    if (prevMs != null && !(ms > prevMs)) {
      return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT, { field: "benchmarkSeries" })]);
    }
    prevMs = ms;

    if (ymd === periodStart) startClose = row.close;
    if (ymd === periodEnd) endClose = row.close;
  }

  if (!isFiniteNumber(startClose) || !isFiniteNumber(endClose)) {
    return blockedResult([makeError(ERROR.BENCHMARK_PERIOD_MISMATCH, { field: "benchmarkSeries" })]);
  }

  const benchmarkReturn = endClose / startClose - 1;
  const alpha = input.strategyTotalReturn - benchmarkReturn;
  if (!isFiniteNumber(benchmarkReturn) || !isFiniteNumber(alpha)) {
    return blockedResult([makeError(ERROR.INVALID_BENCHMARK_INPUT)]);
  }

  return {
    ok: true,
    benchmarkStatus: BENCHMARK_STATUS.COMPLETED,
    benchmarkReturn,
    alpha,
    alphaDefinition: ALPHA_DEFINITION,
    periodStart,
    periodEnd,
    market,
    benchmarkMarket,
    startClose,
    endClose,
    errorCodes: [],
    errors: [],
  };
}

module.exports = {
  BENCHMARK_STATUS,
  ERROR,
  ALPHA_DEFINITION,
  ALLOWED_SYNTHETIC_MARKETS,
  calculateBenchmarkPerformance,
};
