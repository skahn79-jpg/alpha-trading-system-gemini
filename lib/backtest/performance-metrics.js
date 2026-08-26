/**
 * GATE 5L 포트폴리오 성과 지표. 순수 CommonJS. I/O 없음.
 * CAGR year basis = 365.25 calendar days.
 * Sharpe annualization = sqrt(252) trading-day factor.
 * These two year conventions are intentionally different.
 * 6J: makeError via shared makeBacktestError. String field args become { field }.
 */

"use strict";

const { parseYmd } = require("./schemas");
const { makeBacktestError: makeError } = require("./make-error");

const DAYS_PER_YEAR = 365.25;
const ANNUALIZATION_FACTOR = 252;
const RISK_FREE_RATE_ASSUMPTION = 0;
const MS_PER_DAY = 86400000;

const PORTFOLIO_STATUS_COMPLETED = "COMPLETED_PORTFOLIO_LEDGER";

const PERFORMANCE_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_PERFORMANCE_METRICS",
  BLOCKED: "BLOCKED",
});

const METRIC_STATUS = Object.freeze({
  CALCULATED: "CALCULATED",
  SHORT_PERIOD_ANNUALIZED: "SHORT_PERIOD_ANNUALIZED",
  INSUFFICIENT_PERFORMANCE_PERIOD: "INSUFFICIENT_PERFORMANCE_PERIOD",
  NO_CLOSED_TRADES: "NO_CLOSED_TRADES",
  ALL_BREAK_EVEN: "ALL_BREAK_EVEN",
  NO_GROSS_LOSS: "NO_GROSS_LOSS",
  ZERO_GROSS_PROFIT: "ZERO_GROSS_PROFIT",
  INSUFFICIENT_RETURN_SAMPLES: "INSUFFICIENT_RETURN_SAMPLES",
  ZERO_VOLATILITY: "ZERO_VOLATILITY",
});

const ERROR = Object.freeze({
  PORTFOLIO_NOT_COMPLETED: "PORTFOLIO_NOT_COMPLETED",
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_EQUITY_CURVE: "INVALID_EQUITY_CURVE",
  INSUFFICIENT_PERFORMANCE_PERIOD: "INSUFFICIENT_PERFORMANCE_PERIOD",
  NO_CLOSED_TRADES: "NO_CLOSED_TRADES",
  INSUFFICIENT_RETURN_SAMPLES: "INSUFFICIENT_RETURN_SAMPLES",
  ZERO_VOLATILITY: "ZERO_VOLATILITY",
  NO_GROSS_LOSS: "NO_GROSS_LOSS",
  ALL_BREAK_EVEN: "ALL_BREAK_EVEN",
  ZERO_GROSS_PROFIT: "ZERO_GROSS_PROFIT",
});

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

function nullMetricBundle() {
  return {
    totalReturn: null,
    cagr: null,
    mdd: null,
    winRate: null,
    profitFactor: null,
    sharpeRatio: null,
    cagrStatus: null,
    winRateStatus: null,
    profitFactorStatus: null,
    sharpeStatus: null,
    mddStatus: null,
    totalReturnStatus: null,
    periodStart: null,
    periodEnd: null,
    elapsedDays: null,
    years: null,
    closedTradeCount: null,
    winCount: null,
    lossCount: null,
    breakevenCount: null,
    grossProfit: null,
    grossLoss: null,
    dailyReturnCount: null,
  };
}

function blockedResult(errors) {
  const list = Array.isArray(errors) ? errors.slice() : [makeError(ERROR.INVALID_INPUT)];
  return {
    ok: false,
    performanceStatus: PERFORMANCE_STATUS.BLOCKED,
    ...nullMetricBundle(),
    riskFreeRateAssumption: RISK_FREE_RATE_ASSUMPTION,
    annualizationFactor: ANNUALIZATION_FACTOR,
    daysPerYear: DAYS_PER_YEAR,
    errorCodes: uniqueCodes(list),
    errors: list,
  };
}

function finiteOrNull(value) {
  return isFiniteNumber(value) ? value : null;
}

function calculatePerformanceMetrics(input) {
  if (!isPlainObject(input)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT)]);
  }

  if (input.portfolioStatus !== PORTFOLIO_STATUS_COMPLETED) {
    return blockedResult([makeError(ERROR.PORTFOLIO_NOT_COMPLETED, { field: "portfolioStatus" })]);
  }

  const errors = [];
  const initialCapital = input.initialCapital;
  const finalEquity = input.finalEquity;

  if (!isFiniteNumber(initialCapital) || initialCapital <= 0) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "initialCapital" }));
  }
  if (!isFiniteNumber(finalEquity) || finalEquity < 0) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "finalEquity" }));
  }

  if (!Array.isArray(input.dailyEquityCurve) || input.dailyEquityCurve.length === 0) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "dailyEquityCurve" }));
  }

  if (errors.length > 0) {
    return blockedResult(errors);
  }

  if (!Array.isArray(input.closedTrades)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "closedTrades" })]);
  }

  const curve = input.dailyEquityCurve.slice();
  const trades = input.closedTrades.slice();

  const parsedDates = [];
  const seenDates = new Set();
  for (let i = 0; i < curve.length; i += 1) {
    const row = curve[i];
    if (!isPlainObject(row) || !Object.hasOwn(row, "tradingDate") || !Object.hasOwn(row, "equity")) {
      errors.push(makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" }));
      break;
    }
    const parsed = parseYmd(row.tradingDate);
    if (!parsed.ok) {
      errors.push(makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" }));
      break;
    }
    if (seenDates.has(parsed.date)) {
      errors.push(makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" }));
      break;
    }
    seenDates.add(parsed.date);
    const ms = utcMsFromYmd(parsed.date);
    if (ms == null) {
      errors.push(makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" }));
      break;
    }
    if (parsedDates.length > 0 && !(ms > parsedDates[parsedDates.length - 1].ms)) {
      errors.push(makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" }));
      break;
    }
    if (!isFiniteNumber(row.equity) || row.equity < 0 || row.equity === 0) {
      errors.push(makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" }));
      break;
    }
    parsedDates.push({ date: parsed.date, ms, equity: row.equity });
  }

  if (errors.length > 0) {
    return blockedResult(errors);
  }

  const lastRow = parsedDates[parsedDates.length - 1];
  if (lastRow.equity !== finalEquity) {
    return blockedResult([makeError(ERROR.INVALID_EQUITY_CURVE, { field: "finalEquity" })]);
  }

  const firstRow = parsedDates[0];
  const elapsedDays = (lastRow.ms - firstRow.ms) / MS_PER_DAY;
  if (!isFiniteNumber(elapsedDays) || elapsedDays < 0) {
    return blockedResult([makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" })]);
  }

  const years = elapsedDays / DAYS_PER_YEAR;

  let totalReturn = finalEquity / initialCapital - 1;
  let totalReturnStatus = METRIC_STATUS.CALCULATED;
  if (!isFiniteNumber(totalReturn)) {
    return blockedResult([makeError(ERROR.INVALID_EQUITY_CURVE, { field: "totalReturn" })]);
  }

  let cagr = null;
  let cagrStatus = METRIC_STATUS.INSUFFICIENT_PERFORMANCE_PERIOD;
  if (elapsedDays < 2) {
    cagr = null;
    cagrStatus = METRIC_STATUS.INSUFFICIENT_PERFORMANCE_PERIOD;
  } else {
    const ratio = finalEquity / initialCapital;
    cagr = ratio ** (1 / years) - 1;
    if (!isFiniteNumber(cagr)) {
      cagr = null;
      cagrStatus = METRIC_STATUS.INSUFFICIENT_PERFORMANCE_PERIOD;
    } else if (years < 1) {
      cagrStatus = METRIC_STATUS.SHORT_PERIOD_ANNUALIZED;
    } else {
      cagrStatus = METRIC_STATUS.CALCULATED;
    }
  }

  let peak = parsedDates[0].equity;
  let mdd = 0;
  for (let i = 0; i < parsedDates.length; i += 1) {
    const equity = parsedDates[i].equity;
    if (equity > peak) peak = equity;
    const drawdown = equity / peak - 1;
    if (!isFiniteNumber(drawdown)) {
      return blockedResult([makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" })]);
    }
    if (drawdown < mdd) mdd = drawdown;
  }
  if (!isFiniteNumber(mdd) || mdd > 0) {
    return blockedResult([makeError(ERROR.INVALID_EQUITY_CURVE, { field: "mdd" })]);
  }
  const mddStatus = METRIC_STATUS.CALCULATED;

  const closedTradeCount = trades.length;
  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let grossProfit = 0;
  let signedGrossLoss = 0;
  for (let i = 0; i < trades.length; i += 1) {
    const trade = trades[i];
    if (!isPlainObject(trade) || !isFiniteNumber(trade.netPnl)) {
      return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "closedTrades" })]);
    }
    const netPnl = trade.netPnl;
    if (netPnl > 0) {
      winCount += 1;
      grossProfit += netPnl;
    } else if (netPnl < 0) {
      lossCount += 1;
      signedGrossLoss += netPnl;
    } else {
      breakevenCount += 1;
    }
  }
  const grossLoss = signedGrossLoss === 0 ? 0 : Math.abs(signedGrossLoss);
  if (!isFiniteNumber(grossProfit) || !isFiniteNumber(signedGrossLoss) || !isFiniteNumber(grossLoss)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "closedTrades" })]);
  }

  let winRate = null;
  let winRateStatus = METRIC_STATUS.NO_CLOSED_TRADES;
  if (closedTradeCount === 0) {
    winRate = null;
    winRateStatus = METRIC_STATUS.NO_CLOSED_TRADES;
  } else if (winCount === 0 && lossCount === 0 && breakevenCount > 0) {
    winRate = null;
    winRateStatus = METRIC_STATUS.ALL_BREAK_EVEN;
  } else {
    winRate = winCount / closedTradeCount;
    if (!isFiniteNumber(winRate)) {
      winRate = null;
      winRateStatus = METRIC_STATUS.NO_CLOSED_TRADES;
    } else {
      winRateStatus = METRIC_STATUS.CALCULATED;
    }
  }

  let profitFactor = null;
  let profitFactorStatus = METRIC_STATUS.NO_CLOSED_TRADES;
  if (closedTradeCount === 0) {
    profitFactor = null;
    profitFactorStatus = METRIC_STATUS.NO_CLOSED_TRADES;
  } else if (winCount === 0 && lossCount === 0 && breakevenCount > 0) {
    profitFactor = null;
    profitFactorStatus = METRIC_STATUS.ALL_BREAK_EVEN;
  } else if (grossLoss === 0 && grossProfit > 0) {
    profitFactor = null;
    profitFactorStatus = METRIC_STATUS.NO_GROSS_LOSS;
  } else if (grossProfit === 0 && grossLoss > 0) {
    profitFactor = 0;
    profitFactorStatus = METRIC_STATUS.ZERO_GROSS_PROFIT;
  } else {
    profitFactor = grossProfit / grossLoss;
    if (!isFiniteNumber(profitFactor)) {
      profitFactor = null;
      profitFactorStatus = METRIC_STATUS.NO_GROSS_LOSS;
    } else {
      profitFactorStatus = METRIC_STATUS.CALCULATED;
    }
  }

  const dailyReturns = [];
  for (let i = 1; i < parsedDates.length; i += 1) {
    const prev = parsedDates[i - 1].equity;
    const curr = parsedDates[i].equity;
    const ret = curr / prev - 1;
    if (!isFiniteNumber(ret)) {
      return blockedResult([makeError(ERROR.INVALID_EQUITY_CURVE, { field: "dailyEquityCurve" })]);
    }
    dailyReturns.push(ret);
  }
  const dailyReturnCount = dailyReturns.length;

  let sharpeRatio = null;
  let sharpeStatus = METRIC_STATUS.INSUFFICIENT_RETURN_SAMPLES;
  if (dailyReturnCount < 2) {
    sharpeRatio = null;
    sharpeStatus = METRIC_STATUS.INSUFFICIENT_RETURN_SAMPLES;
  } else {
    let sum = 0;
    for (let i = 0; i < dailyReturnCount; i += 1) sum += dailyReturns[i];
    const mean = sum / dailyReturnCount;
    let sq = 0;
    for (let i = 0; i < dailyReturnCount; i += 1) {
      const diff = dailyReturns[i] - mean;
      sq += diff * diff;
    }
    const sampleStd = Math.sqrt(sq / (dailyReturnCount - 1));
    if (!isFiniteNumber(mean) || !isFiniteNumber(sampleStd)) {
      sharpeRatio = null;
      sharpeStatus = METRIC_STATUS.INSUFFICIENT_RETURN_SAMPLES;
    } else if (sampleStd === 0) {
      sharpeRatio = null;
      sharpeStatus = METRIC_STATUS.ZERO_VOLATILITY;
    } else {
      sharpeRatio = (mean / sampleStd) * Math.sqrt(ANNUALIZATION_FACTOR);
      if (!isFiniteNumber(sharpeRatio)) {
        sharpeRatio = null;
        sharpeStatus = METRIC_STATUS.ZERO_VOLATILITY;
      } else {
        sharpeStatus = METRIC_STATUS.CALCULATED;
      }
    }
  }

  return {
    ok: true,
    performanceStatus: PERFORMANCE_STATUS.COMPLETED,
    totalReturn: finiteOrNull(totalReturn),
    cagr: finiteOrNull(cagr),
    mdd: finiteOrNull(mdd),
    winRate: finiteOrNull(winRate),
    profitFactor: finiteOrNull(profitFactor),
    sharpeRatio: finiteOrNull(sharpeRatio),
    cagrStatus,
    winRateStatus,
    profitFactorStatus,
    sharpeStatus,
    mddStatus,
    totalReturnStatus,
    periodStart: firstRow.date,
    periodEnd: lastRow.date,
    elapsedDays,
    years,
    closedTradeCount,
    winCount,
    lossCount,
    breakevenCount,
    grossProfit,
    grossLoss,
    dailyReturnCount,
    riskFreeRateAssumption: RISK_FREE_RATE_ASSUMPTION,
    annualizationFactor: ANNUALIZATION_FACTOR,
    daysPerYear: DAYS_PER_YEAR,
    errorCodes: [],
    errors: [],
  };
}

module.exports = {
  DAYS_PER_YEAR,
  ANNUALIZATION_FACTOR,
  RISK_FREE_RATE_ASSUMPTION,
  PERFORMANCE_STATUS,
  METRIC_STATUS,
  ERROR,
  calculatePerformanceMetrics,
};
