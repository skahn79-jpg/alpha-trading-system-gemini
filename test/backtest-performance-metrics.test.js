"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DAYS_PER_YEAR,
  ANNUALIZATION_FACTOR,
  RISK_FREE_RATE_ASSUMPTION,
  PERFORMANCE_STATUS,
  METRIC_STATUS,
  ERROR,
  calculatePerformanceMetrics,
} = require("../lib/backtest/performance-metrics");

const SRC_PATH = path.join(__dirname, "..", "lib", "backtest", "performance-metrics.js");

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function utcMs(ymd) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function buildCompletedInput(overrides) {
  const extras = overrides || {};
  const dailyEquityCurve = extras.dailyEquityCurve || [
    { tradingDate: "2101-03-01", equity: 1000000 },
    { tradingDate: "2101-03-02", equity: 1010000 },
    { tradingDate: "2101-03-04", equity: 1020000 },
  ];
  const last = dailyEquityCurve[dailyEquityCurve.length - 1];
  const input = {
    portfolioStatus: extras.portfolioStatus !== undefined
      ? extras.portfolioStatus
      : "COMPLETED_PORTFOLIO_LEDGER",
    initialCapital: extras.initialCapital !== undefined ? extras.initialCapital : 1000000,
    finalEquity: extras.finalEquity !== undefined
      ? extras.finalEquity
      : (last && last.equity),
    dailyEquityCurve,
    closedTrades: extras.closedTrades !== undefined
      ? extras.closedTrades
      : [{ netPnl: 10000 }, { netPnl: -4000 }],
  };
  if (extras.market !== undefined) input.market = extras.market;
  return input;
}

function assertSixNull(result) {
  assert.equal(result.totalReturn, null);
  assert.equal(result.cagr, null);
  assert.equal(result.mdd, null);
  assert.equal(result.winRate, null);
  assert.equal(result.profitFactor, null);
  assert.equal(result.sharpeRatio, null);
}

function assertNoNonFiniteMetrics(result) {
  const keys = ["totalReturn", "cagr", "mdd", "winRate", "profitFactor", "sharpeRatio"];
  for (const key of keys) {
    const value = result[key];
    if (value != null) {
      assert.equal(Number.isFinite(value), true, key);
    }
    assert.equal(value === Number.POSITIVE_INFINITY, false, key);
    assert.equal(value === Number.NEGATIVE_INFINITY, false, key);
    assert.equal(Number.isNaN(value), false, key);
  }
}

test("GATE5L-M01 completed input produces COMPLETED_PERFORMANCE_METRICS", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assert.equal(result.ok, true);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.COMPLETED);
  assert.equal(result.performanceStatus, "COMPLETED_PERFORMANCE_METRICS");
});

test("GATE5L-M02 totalReturn uses initialCapital not curve[0]", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    initialCapital: 1000000,
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 900000 },
      { tradingDate: "2101-03-02", equity: 950000 },
      { tradingDate: "2101-03-04", equity: 1100000 },
    ],
    finalEquity: 1100000,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.totalReturn, 1100000 / 1000000 - 1);
  assert.notEqual(result.totalReturn, 1100000 / 900000 - 1);
  assert.equal(result.totalReturnStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M03 blocked when input is null", () => {
  const result = calculatePerformanceMetrics(null);
  assert.equal(result.ok, false);
  assert.equal(result.performanceStatus, "BLOCKED");
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assertSixNull(result);
});

test("GATE5L-M04 blocked when input is array", () => {
  const result = calculatePerformanceMetrics([]);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assertSixNull(result);
});

test("GATE5L-M05 blocked when portfolioStatus missing", () => {
  const input = buildCompletedInput();
  delete input.portfolioStatus;
  const result = calculatePerformanceMetrics(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PORTFOLIO_NOT_COMPLETED), true);
  assertSixNull(result);
});

test("GATE5L-M06 blocked portfolioStatus BLOCKED_PORTFOLIO_LEDGER", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    portfolioStatus: "BLOCKED_PORTFOLIO_LEDGER",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PORTFOLIO_NOT_COMPLETED), true);
  assertSixNull(result);
});

test("GATE5L-M07 diagnostic closedTrades on blocked portfolio do not compute winRate", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    portfolioStatus: "BLOCKED_PORTFOLIO_LEDGER",
    closedTrades: [{ netPnl: 100 }, { netPnl: 200 }],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PORTFOLIO_NOT_COMPLETED), true);
  assert.equal(result.winRate, null);
  assert.equal(result.winRateStatus, null);
  assert.equal(result.closedTradeCount, null);
});

test("GATE5L-M08 initialCapital not finite", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ initialCapital: Number.NaN }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assertSixNull(result);
});

test("GATE5L-M09 initialCapital Infinity", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    initialCapital: Number.POSITIVE_INFINITY,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M10 initialCapital zero", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ initialCapital: 0 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M11 initialCapital negative", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ initialCapital: -1 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M12 finalEquity not finite", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ finalEquity: Number.NaN }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M13 finalEquity negative", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ finalEquity: -1 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M14 empty dailyEquityCurve", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [],
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M15 dailyEquityCurve not an array", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: { tradingDate: "2101-03-01", equity: 1000000 },
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-M16 row missing tradingDate", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { equity: 1000000 },
      { tradingDate: "2101-03-02", equity: 1000000 },
    ],
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M17 row missing equity", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01" },
    ],
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M18 parseYmd fail invalid format", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "21010301", equity: 1000000 },
    ],
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M19 parseYmd fail invalid calendar date", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-02-29", equity: 1000000 },
    ],
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M20 duplicate dates INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-01", equity: 1010000 },
    ],
    finalEquity: 1010000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M21 unsorted dates INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-04", equity: 1010000 },
      { tradingDate: "2101-03-02", equity: 1020000 },
    ],
    finalEquity: 1020000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M22 reversed dates INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-02", equity: 1000000 },
      { tradingDate: "2101-03-01", equity: 1010000 },
    ],
    finalEquity: 1010000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M23 zero equity INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-02", equity: 0 },
    ],
    finalEquity: 0,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M24 negative equity INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-02", equity: -1 },
      { tradingDate: "2101-03-04", equity: 1000000 },
    ],
    finalEquity: 1000000,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M25 last equity mismatch vs finalEquity", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-02", equity: 1010000 },
    ],
    finalEquity: 999999,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M26 timezone UTC elapsedDays 2101-03-01 to 2101-03-02 === 1", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-02", equity: 1000000 },
    ],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.elapsedDays, 1);
  assert.equal((utcMs("2101-03-02") - utcMs("2101-03-01")) / 86400000, 1);
});

test("GATE5L-M27 leap year 2104-02-28 to 2104-03-01 elapsedDays === 2", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2104-02-28", equity: 1000000 },
      { tradingDate: "2104-03-01", equity: 1000000 },
    ],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.elapsedDays, 2);
});

test("GATE5L-M28 same-date elapsedDays === 0 CAGR INSUFFICIENT_PERFORMANCE_PERIOD", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
    ],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.elapsedDays, 0);
  assert.equal(result.cagr, null);
  assert.equal(result.cagrStatus, METRIC_STATUS.INSUFFICIENT_PERFORMANCE_PERIOD);
});

test("GATE5L-M29 elapsedDays === 1 CAGR still insufficient", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-02", equity: 1010000 },
    ],
    finalEquity: 1010000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.elapsedDays, 1);
  assert.equal(result.cagr, null);
  assert.equal(result.cagrStatus, METRIC_STATUS.INSUFFICIENT_PERFORMANCE_PERIOD);
});

test("GATE5L-M30 elapsedDays >= 2 computes CAGR", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-03", equity: 1100000 },
    ],
    finalEquity: 1100000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.elapsedDays, 2);
  const years = 2 / 365.25;
  assert.equal(result.cagr, (1100000 / 1000000) ** (1 / years) - 1);
  assert.equal(result.cagrStatus, METRIC_STATUS.SHORT_PERIOD_ANNUALIZED);
});

test("GATE5L-M31 years >= 1 CAGR CALCULATED", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2102-03-02", equity: 1100000 },
    ],
    finalEquity: 1100000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.years >= 1, true);
  assert.equal(Number.isFinite(result.cagr), true);
  assert.equal(result.cagrStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M32 years uses 365.25 not 365.2425", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-04", equity: 1000000 },
    ],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.years, 3 / 365.25);
  assert.notEqual(result.years, 3 / 365.2425);
  assert.equal(DAYS_PER_YEAR, 365.25);
});

test("GATE5L-M33 MDD 900 then 1200 is 0 not min/max-1", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    initialCapital: 900,
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 900 },
      { tradingDate: "2101-03-02", equity: 1200 },
      { tradingDate: "2101-03-04", equity: 1200 },
    ],
    finalEquity: 1200,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.mdd, 0);
  assert.notEqual(result.mdd, 900 / 1200 - 1);
  assert.equal(result.mddStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M34 MDD 1200 then 900 is -0.25", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    initialCapital: 1200,
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1200 },
      { tradingDate: "2101-03-02", equity: 900 },
      { tradingDate: "2101-03-04", equity: 900 },
    ],
    finalEquity: 900,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.mdd, 900 / 1200 - 1);
  assert.equal(result.mdd, -0.25);
});

test("GATE5L-M35 rising-only MDD is 0", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 100 },
      { tradingDate: "2101-03-02", equity: 110 },
      { tradingDate: "2101-03-03", equity: 150 },
    ],
    finalEquity: 150,
    closedTrades: [],
  }));
  assert.equal(result.mdd, 0);
});

test("GATE5L-M36 MDD never positive", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assert.equal(result.mdd <= 0, true);
});

test("GATE5L-M37 winRate no closed trades", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ closedTrades: [] }));
  assert.equal(result.ok, true);
  assert.equal(result.winRate, null);
  assert.equal(result.winRateStatus, METRIC_STATUS.NO_CLOSED_TRADES);
  assert.equal(result.closedTradeCount, 0);
});

test("GATE5L-M38 all breakeven winRate null not 0", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 0 }, { netPnl: 0 }],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.winRate, null);
  assert.notEqual(result.winRate, 0);
  assert.equal(result.winRateStatus, METRIC_STATUS.ALL_BREAK_EVEN);
  assert.equal(result.breakevenCount, 2);
});

test("GATE5L-M39 winRate includes breakeven in denominator", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 10 }, { netPnl: -5 }, { netPnl: 0 }],
  }));
  assert.equal(result.winRate, 1 / 3);
  assert.equal(result.winCount, 1);
  assert.equal(result.lossCount, 1);
  assert.equal(result.breakevenCount, 1);
  assert.equal(result.winRateStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M40 integer compare netPnl === 0 is breakeven", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 0 }],
  }));
  assert.equal(result.breakevenCount, 1);
  assert.equal(result.winCount, 0);
  assert.equal(result.lossCount, 0);
});

test("GATE5L-M41 profitFactor no closed trades", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ closedTrades: [] }));
  assert.equal(result.profitFactor, null);
  assert.equal(result.profitFactorStatus, METRIC_STATUS.NO_CLOSED_TRADES);
});

test("GATE5L-M42 profitFactor all breakeven", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 0 }],
  }));
  assert.equal(result.profitFactor, null);
  assert.equal(result.profitFactorStatus, METRIC_STATUS.ALL_BREAK_EVEN);
});

test("GATE5L-M43 NO_GROSS_LOSS never Infinity", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 50 }, { netPnl: 25 }],
  }));
  assert.equal(result.profitFactor, null);
  assert.equal(result.profitFactorStatus, METRIC_STATUS.NO_GROSS_LOSS);
  assert.notEqual(result.profitFactor, Number.POSITIVE_INFINITY);
  assert.equal(result.grossProfit, 75);
  assert.equal(result.grossLoss, 0);
});

test("GATE5L-M44 ZERO_GROSS_PROFIT profitFactor 0", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: -20 }, { netPnl: -5 }],
  }));
  assert.equal(result.profitFactor, 0);
  assert.equal(result.profitFactorStatus, METRIC_STATUS.ZERO_GROSS_PROFIT);
  assert.equal(result.grossProfit, 0);
  assert.equal(result.grossLoss, 25);
});

test("GATE5L-M45 profitFactor grossProfit/grossLoss", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 10 }, { netPnl: -4 }],
  }));
  assert.equal(result.profitFactor, 10 / 4);
  assert.equal(result.profitFactorStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M46 sharpe insufficient with fewer than 2 returns", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-03", equity: 1100000 },
    ],
    finalEquity: 1100000,
    closedTrades: [],
  }));
  assert.equal(result.dailyReturnCount, 1);
  assert.equal(result.sharpeRatio, null);
  assert.equal(result.sharpeStatus, METRIC_STATUS.INSUFFICIENT_RETURN_SAMPLES);
});

test("GATE5L-M47 sample stddev uses n-1 not n", () => {
  const curve = [
    { tradingDate: "2101-03-01", equity: 100 },
    { tradingDate: "2101-03-02", equity: 110 },
    { tradingDate: "2101-03-03", equity: 105 },
  ];
  const result = calculatePerformanceMetrics(buildCompletedInput({
    initialCapital: 100,
    dailyEquityCurve: curve,
    finalEquity: 105,
    closedTrades: [],
  }));
  const r0 = 110 / 100 - 1;
  const r1 = 105 / 110 - 1;
  const mean = (r0 + r1) / 2;
  const sq = (r0 - mean) ** 2 + (r1 - mean) ** 2;
  const sampleStd = Math.sqrt(sq / (2 - 1));
  const popStd = Math.sqrt(sq / 2);
  const expected = (mean / sampleStd) * Math.sqrt(252);
  const populationSharpe = (mean / popStd) * Math.sqrt(252);
  assert.equal(result.dailyReturnCount, 2);
  assert.equal(result.sharpeRatio, expected);
  assert.notEqual(result.sharpeRatio, populationSharpe);
  assert.equal(result.sharpeStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M48 ZERO_VOLATILITY when all daily returns equal", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 100 },
      { tradingDate: "2101-03-02", equity: 110 },
      { tradingDate: "2101-03-03", equity: 121 },
    ],
    initialCapital: 100,
    finalEquity: 121,
    closedTrades: [],
  }));
  assert.equal(result.sharpeRatio, null);
  assert.equal(result.sharpeStatus, METRIC_STATUS.ZERO_VOLATILITY);
});

test("GATE5L-M49 riskFreeRateAssumption is 0", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assert.equal(result.riskFreeRateAssumption, 0);
  assert.equal(RISK_FREE_RATE_ASSUMPTION, 0);
});

test("GATE5L-M50 annualizationFactor 252 distinct from DAYS_PER_YEAR", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assert.equal(result.annualizationFactor, 252);
  assert.equal(ANNUALIZATION_FACTOR, 252);
  assert.equal(result.daysPerYear, 365.25);
  assert.notEqual(ANNUALIZATION_FACTOR, DAYS_PER_YEAR);
});

test("GATE5L-M51 no Infinity or NaN on success metrics", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assertNoNonFiniteMetrics(result);
});

test("GATE5L-M52 no Infinity or NaN on blocked metrics", () => {
  const result = calculatePerformanceMetrics(null);
  assertNoNonFiniteMetrics(result);
});

test("GATE5L-M53 determinism deepEqual twice", () => {
  const input = buildCompletedInput();
  const a = calculatePerformanceMetrics(input);
  const b = calculatePerformanceMetrics(input);
  assert.deepEqual(a, b);
});

test("GATE5L-M54 JSON snapshot of input unchanged", () => {
  const input = buildCompletedInput();
  const snap = JSON.stringify(input);
  calculatePerformanceMetrics(input);
  assert.equal(JSON.stringify(input), snap);
});

test("GATE5L-M55 copied arrays are not mutated back into input", () => {
  const input = buildCompletedInput();
  const curveRef = input.dailyEquityCurve;
  const tradesRef = input.closedTrades;
  const curveSnap = JSON.stringify(curveRef);
  const tradesSnap = JSON.stringify(tradesRef);
  calculatePerformanceMetrics(input);
  assert.equal(input.dailyEquityCurve, curveRef);
  assert.equal(JSON.stringify(curveRef), curveSnap);
  assert.equal(JSON.stringify(tradesRef), tradesSnap);
});

test("GATE5L-M56 source has no http/https/fetch/Math.random/Date.now", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"https\")"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("Math.random"), false);
  assert.equal(src.includes("Date.now"), false);
});

test("GATE5L-M57 source never parses YYYY-MM-DD via new Date string", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("new Date(\"YYYY-MM-DD\")"), false);
  assert.equal(/new Date\(\s*["'`]/.test(src), false);
});

test("GATE5L-M58 source does not import lib/backtest/performance.js", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("require(\"./performance\")"), false);
  assert.equal(src.includes("performance.js"), false);
});

test("GATE5L-M59 KOSPI vs KOSDAQ extra market string ignored", () => {
  const kospi = calculatePerformanceMetrics(buildCompletedInput({ market: "KOSPI" }));
  const kosdaq = calculatePerformanceMetrics(buildCompletedInput({ market: "KOSDAQ" }));
  assert.equal(kospi.ok, true);
  assert.equal(kosdaq.ok, true);
  assert.equal(kospi.totalReturn, kosdaq.totalReturn);
  assert.equal(kospi.cagr, kosdaq.cagr);
  assert.equal(kospi.mdd, kosdaq.mdd);
  assert.equal(kospi.winRate, kosdaq.winRate);
  assert.equal(kospi.profitFactor, kosdaq.profitFactor);
  assert.equal(kospi.sharpeRatio, kosdaq.sharpeRatio);
});

test("GATE5L-M60 module does not set benchmarkReturn or alpha", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assert.equal(Object.hasOwn(result, "benchmarkReturn"), false);
  assert.equal(Object.hasOwn(result, "alpha"), false);
});

test("GATE5L-M61 blocked result has no alpha calculation", () => {
  const result = calculatePerformanceMetrics({ portfolioStatus: "BLOCKED" });
  assert.equal(Object.hasOwn(result, "alpha"), false);
  assert.equal(Object.hasOwn(result, "benchmarkReturn"), false);
});

test("GATE5L-M62 partial null metrics still ok true", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
    ],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.performanceStatus, "COMPLETED_PERFORMANCE_METRICS");
  assert.equal(result.cagr, null);
  assert.equal(result.winRate, null);
  assert.equal(result.sharpeRatio, null);
  assert.equal(Number.isFinite(result.totalReturn), true);
  assert.equal(result.mdd, 0);
});

test("GATE5L-M63 missing closedTrades treated as INVALID_INPUT whole BLOCKED", () => {
  const input = buildCompletedInput();
  delete input.closedTrades;
  const result = calculatePerformanceMetrics(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assertSixNull(result);
});

test("GATE5L-M64 errors are {code, field?} arrays", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    portfolioStatus: "NOT_DONE",
  }));
  assert.equal(Array.isArray(result.errors), true);
  assert.equal(result.errors.length > 0, true);
  assert.equal(typeof result.errors[0].code, "string");
  assert.equal(result.errors[0].field, "portfolioStatus");
});

test("GATE5L-M65 INSUFFICIENT_PERFORMANCE_PERIOD is cagr-only not whole BLOCKED", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [{ tradingDate: "2101-03-01", equity: 1000000 }],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.ok, true);
  assert.notEqual(result.performanceStatus, "BLOCKED");
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_PERFORMANCE_PERIOD), false);
  assert.equal(result.cagrStatus, METRIC_STATUS.INSUFFICIENT_PERFORMANCE_PERIOD);
});

test("GATE5L-M66 elapsedDays < 0 is INVALID_EQUITY_CURVE not INSUFFICIENT", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("elapsedDays < 0"), true);
  assert.equal(
    src.includes("elapsedDays < 0") && src.includes("INVALID_EQUITY_CURVE"),
    true,
  );
});

test("GATE5L-M67 non-object curve row INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [null, { tradingDate: "2101-03-02", equity: 1 }],
    finalEquity: 1,
  }));
  assert.equal(hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
  assertSixNull(result);
});

test("GATE5L-M68 equity NaN INVALID_EQUITY_CURVE", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [{ tradingDate: "2101-03-01", equity: Number.NaN }],
    finalEquity: Number.NaN,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT) || hasCode(result, ERROR.INVALID_EQUITY_CURVE), true);
});

test("GATE5L-M69 wins only with breakeven still NO_GROSS_LOSS", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: 8 }, { netPnl: 0 }],
  }));
  assert.equal(result.profitFactor, null);
  assert.equal(result.profitFactorStatus, METRIC_STATUS.NO_GROSS_LOSS);
  assert.equal(result.winRate, 1 / 2);
});

test("GATE5L-M70 periodStart and periodEnd from first/last curve dates", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    dailyEquityCurve: [
      { tradingDate: "2101-03-01", equity: 1000000 },
      { tradingDate: "2101-03-08", equity: 1000000 },
    ],
    finalEquity: 1000000,
    closedTrades: [],
  }));
  assert.equal(result.periodStart, "2101-03-01");
  assert.equal(result.periodEnd, "2101-03-08");
  assert.equal(result.elapsedDays, 7);
});

test("GATE5L-M71 all-loss winRate is 0 CALCULATED", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: -1 }, { netPnl: -2 }],
  }));
  assert.equal(result.winRate, 0);
  assert.equal(result.winRateStatus, METRIC_STATUS.CALCULATED);
});

test("GATE5L-M72 success errorCodes empty", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput());
  assert.deepEqual(result.errorCodes, []);
  assert.deepEqual(result.errors, []);
});

test("GATE5L-M73 constants exported match result fields", () => {
  assert.equal(DAYS_PER_YEAR, 365.25);
  assert.equal(ANNUALIZATION_FACTOR, 252);
  assert.equal(RISK_FREE_RATE_ASSUMPTION, 0);
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("365.2425"), false);
});

test("GATE5L-M74 NaN netPnl is INVALID_INPUT not fake winRate 0", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [{ netPnl: Number.NaN }],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(result.winRate, null);
});

function overflowProfitLossTrades() {
  return [
    { netPnl: Number.MAX_VALUE },
    { netPnl: Number.MAX_VALUE },
    { netPnl: -1 },
  ];
}

test("GATE5L-R01 MAX_VALUE+MAX_VALUE+(-1) overflow is BLOCKED INVALID_INPUT", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: overflowProfitLossTrades(),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-R02 many large negative netPnl overflow is BLOCKED", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: [
      { netPnl: -Number.MAX_VALUE },
      { netPnl: -Number.MAX_VALUE },
      { netPnl: -Number.MAX_VALUE },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5L-R03 overflow profitFactor is null not 0 fallback", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: overflowProfitLossTrades(),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.profitFactor, null);
  assert.notEqual(result.profitFactor, 0);
});

test("GATE5L-R04 overflow profitFactorStatus is not ZERO_GROSS_PROFIT", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: overflowProfitLossTrades(),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.profitFactorStatus, null);
  assert.notEqual(result.profitFactorStatus, METRIC_STATUS.ZERO_GROSS_PROFIT);
});

test("GATE5L-R05 overflow all six official metrics null", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({
    closedTrades: overflowProfitLossTrades(),
  }));
  assert.equal(result.ok, false);
  assertSixNull(result);
});

test("GATE5L-R06 delete closedTrades is INVALID_INPUT", () => {
  const input = buildCompletedInput();
  delete input.closedTrades;
  const result = calculatePerformanceMetrics(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assertSixNull(result);
});

test("GATE5L-R07 closedTrades undefined is INVALID_INPUT", () => {
  const input = buildCompletedInput();
  input.closedTrades = undefined;
  const result = calculatePerformanceMetrics(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assertSixNull(result);
});

test("GATE5L-R08 closedTrades null is INVALID_INPUT", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ closedTrades: null }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(result.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assertSixNull(result);
});

test("GATE5L-R09 closedTrades object or string is INVALID_INPUT", () => {
  const objectResult = calculatePerformanceMetrics(buildCompletedInput({ closedTrades: {} }));
  assert.equal(objectResult.ok, false);
  assert.equal(hasCode(objectResult, ERROR.INVALID_INPUT), true);
  assert.equal(objectResult.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assertSixNull(objectResult);

  const stringResult = calculatePerformanceMetrics(buildCompletedInput({ closedTrades: "x" }));
  assert.equal(stringResult.ok, false);
  assert.equal(hasCode(stringResult, ERROR.INVALID_INPUT), true);
  assert.equal(stringResult.performanceStatus, PERFORMANCE_STATUS.BLOCKED);
  assertSixNull(stringResult);
});

test("GATE5L-R10 closedTrades empty array is NO_CLOSED_TRADES not BLOCKED", () => {
  const result = calculatePerformanceMetrics(buildCompletedInput({ closedTrades: [] }));
  assert.equal(result.ok, true);
  assert.equal(result.winRate, null);
  assert.equal(result.winRateStatus, METRIC_STATUS.NO_CLOSED_TRADES);
});
