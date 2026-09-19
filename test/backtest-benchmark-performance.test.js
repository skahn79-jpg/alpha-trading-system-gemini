"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  calculateBenchmarkPerformance,
  BENCHMARK_STATUS,
  ERROR,
  ALPHA_DEFINITION,
  ALLOWED_SYNTHETIC_MARKETS,
} = require("../lib/backtest/benchmark-performance");

const SRC_PATH = path.join(__dirname, "..", "lib", "backtest", "benchmark-performance.js");

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function buildValidInput(overrides) {
  const extras = overrides || {};
  const baseSeries = [
    { tradingDate: "2101-03-01", close: 200 },
    { tradingDate: "2101-03-02", close: 210 },
    { tradingDate: "2101-03-03", close: 215 },
    { tradingDate: "2101-03-04", close: 220 },
  ];
  const market = extras.market !== undefined ? extras.market : "SYNTHETIC_KOSPI";
  return {
    performanceStatus: extras.performanceStatus !== undefined
      ? extras.performanceStatus
      : "COMPLETED_PERFORMANCE_METRICS",
    market,
    benchmarkMarket: extras.benchmarkMarket !== undefined ? extras.benchmarkMarket : market,
    periodStart: extras.periodStart !== undefined ? extras.periodStart : "2101-03-01",
    periodEnd: extras.periodEnd !== undefined ? extras.periodEnd : "2101-03-04",
    strategyTotalReturn: extras.strategyTotalReturn !== undefined ? extras.strategyTotalReturn : 0.12,
    benchmarkSeries: extras.benchmarkSeries !== undefined ? extras.benchmarkSeries : baseSeries,
  };
}

test("GATE5M-B01 KOSPI success", () => {
  const result = calculateBenchmarkPerformance(buildValidInput());
  assert.equal(result.ok, true);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.COMPLETED);
  assert.equal(result.market, "SYNTHETIC_KOSPI");
});

test("GATE5M-B02 KOSDAQ success", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ market: "SYNTHETIC_KOSDAQ" }));
  assert.equal(result.ok, true);
  assert.equal(result.market, "SYNTHETIC_KOSDAQ");
  assert.equal(result.benchmarkMarket, "SYNTHETIC_KOSDAQ");
});

test("GATE5M-B03 positive benchmark return (known answer)", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    strategyTotalReturn: 0.12,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(Number(result.benchmarkReturn.toFixed(2)), 0.1);
  assert.equal(Number(result.alpha.toFixed(2)), 0.02);
});

test("GATE5M-B04 negative benchmark return", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 220 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 205 },
      { tradingDate: "2101-03-04", close: 200 },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.benchmarkReturn < 0, true);
});

test("GATE5M-B05 zero benchmark return", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 100 },
      { tradingDate: "2101-03-02", close: 110 },
      { tradingDate: "2101-03-03", close: 90 },
      { tradingDate: "2101-03-04", close: 100 },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.benchmarkReturn, 0);
});

test("GATE5M-B06 positive alpha", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ strategyTotalReturn: 0.2 }));
  assert.equal(result.ok, true);
  assert.equal(result.alpha > 0, true);
});

test("GATE5M-B07 negative alpha", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ strategyTotalReturn: 0.01 }));
  assert.equal(result.ok, true);
  assert.equal(result.alpha < 0, true);
});

test("GATE5M-B08 zero alpha", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ strategyTotalReturn: 0.1 }));
  assert.equal(result.ok, true);
  assert.equal(Math.abs(result.alpha) < 1e-12, true);
});

test("GATE5M-B09 decimal ratio not percent", () => {
  const result = calculateBenchmarkPerformance(buildValidInput());
  assert.equal(result.ok, true);
  assert.equal(Number(result.benchmarkReturn.toFixed(2)), 0.1);
  assert.notEqual(result.benchmarkReturn, 10);
});

test("GATE5M-B10 exact periodStart match required", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ periodStart: "2101-03-02" }));
  assert.equal(result.ok, true);
  assert.equal(result.startClose, 210);
  assert.notEqual(result.startClose, 200);
});

test("GATE5M-B11 exact periodEnd match required", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ periodEnd: "2101-03-03" }));
  assert.equal(result.ok, true);
  assert.equal(result.endClose, 215);
  assert.notEqual(result.endClose, 220);
});

test("GATE5M-B12 missing start date -> BENCHMARK_PERIOD_MISMATCH", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_PERIOD_MISMATCH), true);
});

test("GATE5M-B13 missing end date -> BENCHMARK_PERIOD_MISMATCH", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_PERIOD_MISMATCH), true);
});

test("GATE5M-B14 no previous-date fallback", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    periodStart: "2101-03-02",
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-03", close: 220 },
      { tradingDate: "2101-03-04", close: 230 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_PERIOD_MISMATCH), true);
});

test("GATE5M-B15 no next-date fallback", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    periodEnd: "2101-03-03",
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_PERIOD_MISMATCH), true);
});

test("GATE5M-B16 unsorted series blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B17 duplicate date blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-01", close: 201 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B18 invalid date blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-02-30", close: 210 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B19 missing close blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02" },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B20 zero close blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 0 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B21 negative close blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: -1 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B22 NaN close blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: Number.NaN },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B23 Infinity close blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: Number.POSITIVE_INFINITY },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B24 -Infinity close blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: Number.NEGATIVE_INFINITY },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B25 strategy totalReturn null blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ strategyTotalReturn: null }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B26 strategy totalReturn NaN blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ strategyTotalReturn: Number.NaN }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B27 strategy totalReturn Infinity blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ strategyTotalReturn: Number.POSITIVE_INFINITY }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
});

test("GATE5M-B28 invalid market blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ market: "UNKNOWN_MARKET" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5M-B29 production KOSPI blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ market: "KOSPI" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5M-B30 production KOSDAQ blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ market: "KOSDAQ" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5M-B31 legacy SYNTHETIC_MARKET blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ market: "SYNTHETIC_MARKET" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5M-B32 market mismatch blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    market: "SYNTHETIC_KOSPI",
    benchmarkMarket: "SYNTHETIC_KOSDAQ",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_MARKET_MISMATCH), true);
});

test("GATE5M-B33 periodStart equals periodEnd blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    periodStart: "2101-03-01",
    periodEnd: "2101-03-01",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_PERIOD_MISMATCH), true);
});

test("GATE5M-B34 reversed period blocked", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    periodStart: "2101-03-04",
    periodEnd: "2101-03-01",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.BENCHMARK_PERIOD_MISMATCH), true);
});

test("GATE5M-B35 future row outside period ignored", () => {
  const base = calculateBenchmarkPerformance(buildValidInput());
  const withFuture = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-04", close: 220 },
      { tradingDate: "2101-03-05", close: 99999 },
    ],
  }));
  assert.equal(base.ok, true);
  assert.equal(withFuture.ok, true);
  assert.equal(withFuture.benchmarkReturn, base.benchmarkReturn);
});

test("GATE5M-B36 pre-period row ignored", () => {
  const base = calculateBenchmarkPerformance(buildValidInput());
  const withPast = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-02-28", close: 1 },
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(base.ok, true);
  assert.equal(withPast.ok, true);
  assert.equal(withPast.benchmarkReturn, base.benchmarkReturn);
});

test("GATE5M-B37 future price change does not change result", () => {
  const a = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-04", close: 220 },
      { tradingDate: "2101-03-05", close: 100 },
    ],
  }));
  const b = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-03", close: 215 },
      { tradingDate: "2101-03-04", close: 220 },
      { tradingDate: "2101-03-05", close: 1000000 },
    ],
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.benchmarkReturn, b.benchmarkReturn);
});

test("GATE5M-B38 pre-period price change does not change result", () => {
  const a = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-02-28", close: 1 },
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  const b = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-02-28", close: 1000000 },
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 210 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.benchmarkReturn, b.benchmarkReturn);
});

test("GATE5M-B39 input immutable benchmarkSeries", () => {
  const input = buildValidInput();
  const snap = JSON.stringify(input.benchmarkSeries);
  calculateBenchmarkPerformance(input);
  assert.equal(JSON.stringify(input.benchmarkSeries), snap);
});

test("GATE5M-B40 determinism deepEqual twice", () => {
  const input = buildValidInput();
  const a = calculateBenchmarkPerformance(input);
  const b = calculateBenchmarkPerformance(input);
  assert.deepEqual(a, b);
});

test("GATE5M-B41 no http/https/fetch in source", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"https\")"), false);
  assert.equal(src.includes("fetch("), false);
});

test("GATE5M-B42 no fs read in source", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("require(\"fs\")"), false);
  assert.equal(src.includes("readFileSync("), false);
});

test("GATE5M-B43 no Math.random in source", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("Math.random"), false);
});

test("GATE5M-B44 no Date.now in source", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("Date.now"), false);
});

test("GATE5M-B45 alpha uses totalReturn difference", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    strategyTotalReturn: 0.12,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 100 },
      { tradingDate: "2101-03-04", close: 110 },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(Number(result.alpha.toFixed(2)), 0.02);
});

test("GATE5M-B46 alpha does not require CAGR input", () => {
  const input = buildValidInput();
  delete input.cagr;
  const result = calculateBenchmarkPerformance(input);
  assert.equal(result.ok, true);
  assert.equal(Number.isFinite(result.alpha), true);
});

test("GATE5M-B47 no beta field in result", () => {
  const result = calculateBenchmarkPerformance(buildValidInput());
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "beta"), false);
});

test("GATE5M-B48 no risk-free in calculation", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.toLowerCase().includes("riskfree"), false);
  assert.equal(src.toLowerCase().includes("risk_free"), false);
});

test("GATE5M-B49 no Jensen alpha", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.toLowerCase().includes("jensen"), false);
});

test("GATE5M-B50 nonfinite benchmarkReturn fail closed", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: Number.MIN_VALUE },
      { tradingDate: "2101-03-04", close: Number.MAX_VALUE },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
  assert.equal(result.benchmarkReturn, null);
  assert.equal(result.alpha, null);
  assert.notEqual(result.benchmarkReturn, 0);
});

test("GATE5M-B51 nonfinite alpha fail closed", () => {
  const startClose = 1;
  const endClose = Number.MAX_VALUE;
  const expectedBenchmarkReturn = endClose / startClose - 1;
  assert.equal(Number.isFinite(startClose), true);
  assert.equal(Number.isFinite(endClose), true);
  assert.equal(Number.isFinite(expectedBenchmarkReturn), true);
  assert.equal(Number.isFinite(-Number.MAX_VALUE), true);
  assert.equal(Number.isFinite(-Number.MAX_VALUE - expectedBenchmarkReturn), false);

  const result = calculateBenchmarkPerformance(buildValidInput({
    strategyTotalReturn: -Number.MAX_VALUE,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: startClose },
      { tradingDate: "2101-03-04", close: endClose },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_BENCHMARK_INPUT), true);
  assert.equal(result.benchmarkReturn, null);
  assert.equal(result.alpha, null);
});

test("GATE5M-B52 result market identity preserved", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ market: "SYNTHETIC_KOSDAQ" }));
  assert.equal(result.ok, true);
  assert.equal(result.market, "SYNTHETIC_KOSDAQ");
});

test("GATE5M-B53 periodStart/End preserved", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    periodStart: "2101-03-02",
    periodEnd: "2101-03-04",
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 205 },
      { tradingDate: "2101-03-03", close: 210 },
      { tradingDate: "2101-03-04", close: 220 },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.periodStart, "2101-03-02");
  assert.equal(result.periodEnd, "2101-03-04");
});

test("GATE5M-B54 root error stable on repeated call", () => {
  const input = buildValidInput({ market: "KOSPI" });
  const a = calculateBenchmarkPerformance(input);
  const b = calculateBenchmarkPerformance(input);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.deepEqual(a.errorCodes, b.errorCodes);
});

test("GATE5M-B55 success deepEqual twice", () => {
  const input = buildValidInput();
  assert.deepEqual(calculateBenchmarkPerformance(input), calculateBenchmarkPerformance(input));
});

test("GATE5M-B56 performanceStatus NOT_STARTED -> NOT_STARTED benchmark", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ performanceStatus: "NOT_STARTED" }));
  assert.equal(result.ok, false);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.NOT_STARTED);
  assert.deepEqual(result.errorCodes, []);
});

test("GATE5M-B57 performanceStatus BLOCKED -> PERFORMANCE_NOT_COMPLETED", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({ performanceStatus: "BLOCKED" }));
  assert.equal(result.ok, false);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.PERFORMANCE_NOT_COMPLETED), true);
});

test("GATE5M-B58 benchmarkMarket omitted defaults to market", () => {
  const input = buildValidInput({ market: "SYNTHETIC_KOSDAQ" });
  delete input.benchmarkMarket;
  const result = calculateBenchmarkPerformance(input);
  assert.equal(result.ok, true);
  assert.equal(result.market, "SYNTHETIC_KOSDAQ");
  assert.equal(result.benchmarkMarket, "SYNTHETIC_KOSDAQ");
});

test("GATE5M-B59 allowed synthetic markets constants exact", () => {
  assert.deepEqual(ALLOWED_SYNTHETIC_MARKETS, ["SYNTHETIC_KOSPI", "SYNTHETIC_KOSDAQ"]);
});

test("GATE5M-B60 alpha definition constant preserved", () => {
  const result = calculateBenchmarkPerformance(buildValidInput());
  assert.equal(result.alphaDefinition, ALPHA_DEFINITION);
  assert.equal(ALPHA_DEFINITION, "TOTAL_RETURN_DIFFERENCE");
});

test("GATE6J-B01 source pins shared makeBacktestError and no local makeError", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
});

test("GATE6J-B02 blocked performanceStatus keeps field and severity ERROR", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    performanceStatus: "BLOCKED",
  }));
  assert.equal(hasCode(result, ERROR.PERFORMANCE_NOT_COMPLETED), true);
  assert.equal(result.errors[0].field, "performanceStatus");
  assert.equal(result.errors[0].severity, "ERROR");
});

test("GATE6Z-B01 overflow benchmarkReturn sets field benchmarkReturn", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: Number.MIN_VALUE },
      { tradingDate: "2101-03-02", close: 1 },
      { tradingDate: "2101-03-03", close: 1 },
      { tradingDate: "2101-03-04", close: Number.MAX_VALUE },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.BLOCKED);
  assert.equal(result.errorCodes[0], ERROR.INVALID_BENCHMARK_INPUT);
  assert.equal(result.errors[0].code, ERROR.INVALID_BENCHMARK_INPUT);
  assert.equal(result.errors[0].field, "benchmarkReturn");
  assert.equal(result.errors[0].severity, "ERROR");
});

test("GATE6Z-B02 finite return with overflow alpha sets field alpha", () => {
  const result = calculateBenchmarkPerformance(buildValidInput({
    strategyTotalReturn: -Number.MAX_VALUE,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 2 },
      { tradingDate: "2101-03-02", close: 2 },
      { tradingDate: "2101-03-03", close: 2 },
      { tradingDate: "2101-03-04", close: Number.MAX_VALUE },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.benchmarkStatus, BENCHMARK_STATUS.BLOCKED);
  assert.equal(result.errorCodes[0], ERROR.INVALID_BENCHMARK_INPUT);
  assert.equal(result.errors[0].code, ERROR.INVALID_BENCHMARK_INPUT);
  assert.equal(result.errors[0].field, "alpha");
  assert.equal(result.errors[0].severity, "ERROR");
});

test("GATE6Z-Y01 DATA invariant wrap still appends DATA_STAGE_FAILED", () => {
  const pipelinePath = path.join(__dirname, "..", "lib", "backtest", "synthetic-pipeline.js");
  const src = fs.readFileSync(pipelinePath, "utf8");
  const start = src.indexOf("const dataInvariantErrors = collectDataMarketInvariantErrors(input);");
  assert.equal(start >= 0, true);
  const window = src.slice(start, start + 900);
  assert.equal(window.includes("dataInvariantErrors.slice()"), true);
  assert.equal(window.includes("ERROR.DATA_STAGE_FAILED"), true);
});


test("GATE9J-J13 benchmark SUCCESS keeps return/alpha and FAILURE nulls them", () => {
  const success = calculateBenchmarkPerformance(buildValidInput());
  const failure = calculateBenchmarkPerformance(null);
  assert.equal(success.ok, true);
  assert.equal(success.benchmarkStatus, BENCHMARK_STATUS.COMPLETED);
  assert.equal(typeof success.benchmarkReturn === "number" && Number.isFinite(success.benchmarkReturn), true);
  assert.equal(typeof success.alpha === "number" && Number.isFinite(success.alpha), true);
  assert.equal(Object.hasOwn(success, "failedStage"), false);
  assert.equal(Object.hasOwn(success, "pipelineStatus"), false);
  assert.equal(failure.ok, false);
  assert.equal(failure.benchmarkStatus, BENCHMARK_STATUS.BLOCKED);
  assert.equal(failure.benchmarkReturn, null);
  assert.equal(failure.alpha, null);
  assert.equal(failure.errors.length > 0, true);
  assert.equal(Object.hasOwn(failure, "failedStage"), false);
});
