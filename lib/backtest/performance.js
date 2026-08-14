/**
 * 백테스트 성과 공식. schemas.js 만 의존하는 순수 함수.
 */

"use strict";

const {
  UNIT,
  PERFORMANCE_STATUS,
  SYNTHETIC_PERFORMANCE_FIXTURE,
  parseYmd,
  createNotExecutedPerformanceResult,
} = require("./schemas");

const DAYS_PER_YEAR = 365.2425;

const METRIC_STATUS = Object.freeze({
  CALCULATED: "CALCULATED",
  SHORT_PERIOD_ANNUALIZED: "SHORT_PERIOD_ANNUALIZED",
  MINIMUM_ANNUALIZATION_DAYS_NOT_CONFIGURED: "MINIMUM_ANNUALIZATION_DAYS_NOT_CONFIGURED",
  INSUFFICIENT_OBSERVATION_DAYS: "INSUFFICIENT_OBSERVATION_DAYS",
  INVALID_BEGINNING_EQUITY: "INVALID_BEGINNING_EQUITY",
  INVALID_ENDING_EQUITY: "INVALID_ENDING_EQUITY",
  INVALID_ELAPSED_PERIOD: "INVALID_ELAPSED_PERIOD",
  INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
  INVALID_DATE_VALUE: "INVALID_DATE_VALUE",
  NO_DECISIVE_TRADES: "NO_DECISIVE_TRADES",
  NO_WINNING_TRADES: "NO_WINNING_TRADES",
  NO_LOSING_TRADES: "NO_LOSING_TRADES",
  NO_CLOSED_TRADES: "NO_CLOSED_TRADES",
  INVALID_TRADE_AGGREGATE: "INVALID_TRADE_AGGREGATE",
  ZERO_GROSS_PROFIT: "ZERO_GROSS_PROFIT",
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_EQUITY_CURVE: "INVALID_EQUITY_CURVE",
  DATA_INSUFFICIENT: "DATA_INSUFFICIENT",
  PARAMETER_STATUS_HYPOTHESIS: "HYPOTHESIS",
});

const TRADE_OUTCOME = Object.freeze({
  WINNING_TRADE: "WINNING_TRADE",
  LOSING_TRADE: "LOSING_TRADE",
  BREAK_EVEN_TRADE: "BREAK_EVEN_TRADE",
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function metricResult(value, status, unit, opts, extra) {
  let outStatus = status;
  let fixtureTag = null;
  const warnings = extra && Array.isArray(extra.warnings) ? [...extra.warnings] : [];
  const calculatedLike = status === METRIC_STATUS.CALCULATED
    || status === METRIC_STATUS.SHORT_PERIOD_ANNUALIZED;
  if (opts && opts.synthetic === true && isFiniteNumber(value) && calculatedLike) {
    outStatus = PERFORMANCE_STATUS.SYNTHETIC_FIXTURE_CALCULATED;
    fixtureTag = SYNTHETIC_PERFORMANCE_FIXTURE;
    if (status === METRIC_STATUS.SHORT_PERIOD_ANNUALIZED) {
      warnings.push(METRIC_STATUS.SHORT_PERIOD_ANNUALIZED);
    }
  }
  const result = {
    value,
    status: outStatus,
    unit,
    missingData: extra && Array.isArray(extra.missingData) ? [...extra.missingData] : [],
    warnings,
    fixtureTag,
    notActualPerformance: true,
    promotionEligible: false,
  };
  if (extra && extra.parameterStatus === METRIC_STATUS.PARAMETER_STATUS_HYPOTHESIS) {
    result.parameterStatus = METRIC_STATUS.PARAMETER_STATUS_HYPOTHESIS;
  }
  return result;
}

function ratioResult(value, status, opts, extra) {
  return metricResult(value, status, UNIT.RATIO, opts, extra);
}

function currencyResult(value, status, opts, extra) {
  return metricResult(value, status, UNIT.CURRENCY, opts, extra);
}

function equityStatus(beginningEquity, endingEquity) {
  if (!isFiniteNumber(beginningEquity) || !isFiniteNumber(endingEquity)) {
    return METRIC_STATUS.INVALID_INPUT;
  }
  if (!(beginningEquity > 0)) {
    return METRIC_STATUS.INVALID_BEGINNING_EQUITY;
  }
  if (endingEquity < 0) {
    return METRIC_STATUS.INVALID_ENDING_EQUITY;
  }
  return null;
}

function computeTotalReturn(beginningEquity, endingEquity, opts) {
  const status = equityStatus(beginningEquity, endingEquity);
  if (status) return ratioResult(null, status, opts);
  return ratioResult(endingEquity / beginningEquity - 1, METRIC_STATUS.CALCULATED, opts);
}

function utcMidnightMs(ymd) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function computeCagr(params, opts) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const {
    beginningEquity,
    endingEquity,
    startDate,
    endDate,
    minimumAnnualizationDays,
    parameterStatus,
  } = params;
  const extra = parameterStatus === METRIC_STATUS.PARAMETER_STATUS_HYPOTHESIS
    ? { parameterStatus }
    : undefined;

  const startParsed = parseYmd(startDate);
  if (!startParsed.ok) {
    return ratioResult(null, startParsed.code, opts, extra);
  }
  const endParsed = parseYmd(endDate);
  if (!endParsed.ok) {
    return ratioResult(null, endParsed.code, opts, extra);
  }

  const eqStatus = equityStatus(beginningEquity, endingEquity);
  if (eqStatus) return ratioResult(null, eqStatus, opts, extra);

  if (minimumAnnualizationDays === undefined || minimumAnnualizationDays === null) {
    return ratioResult(null, METRIC_STATUS.MINIMUM_ANNUALIZATION_DAYS_NOT_CONFIGURED, opts, extra);
  }
  if (
    typeof minimumAnnualizationDays !== "number"
    || !Number.isFinite(minimumAnnualizationDays)
    || !Number.isInteger(minimumAnnualizationDays)
    || !(minimumAnnualizationDays > 0)
  ) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts, extra);
  }

  const elapsedCalendarDays = (utcMidnightMs(endParsed.date) - utcMidnightMs(startParsed.date))
    / 86400000;
  if (!(elapsedCalendarDays > 0)) {
    return ratioResult(null, METRIC_STATUS.INVALID_ELAPSED_PERIOD, opts, extra);
  }
  if (elapsedCalendarDays < minimumAnnualizationDays) {
    return ratioResult(null, METRIC_STATUS.INSUFFICIENT_OBSERVATION_DAYS, opts, extra);
  }

  const elapsedYears = elapsedCalendarDays / DAYS_PER_YEAR;
  const cagr = (endingEquity / beginningEquity) ** (1 / elapsedYears) - 1;
  const status = elapsedYears < 1
    ? METRIC_STATUS.SHORT_PERIOD_ANNUALIZED
    : METRIC_STATUS.CALCULATED;
  return ratioResult(cagr, status, opts, extra);
}

function computeMdd(equityPath, opts) {
  if (!Array.isArray(equityPath)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  if (equityPath.length === 0) {
    return ratioResult(null, METRIC_STATUS.DATA_INSUFFICIENT, opts);
  }

  let peak = null;
  let mdd = 0;
  for (const equity of equityPath) {
    if (!isFiniteNumber(equity)) {
      return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
    }
    if (equity < 0) {
      return ratioResult(null, METRIC_STATUS.INVALID_EQUITY_CURVE, opts);
    }
    if (peak === null) {
      if (!(equity > 0)) {
        return ratioResult(null, METRIC_STATUS.INVALID_EQUITY_CURVE, opts);
      }
      peak = equity;
      continue;
    }
    peak = Math.max(peak, equity);
    const drawdown = (peak - equity) / peak;
    if (drawdown > mdd) mdd = drawdown;
  }
  return ratioResult(mdd, METRIC_STATUS.CALCULATED, opts);
}

function classifyTrade(netPnl) {
  if (!isFiniteNumber(netPnl)) {
    return { outcome: null, status: METRIC_STATUS.INVALID_INPUT };
  }
  if (netPnl > 0) return { outcome: TRADE_OUTCOME.WINNING_TRADE, status: null };
  if (netPnl < 0) return { outcome: TRADE_OUTCOME.LOSING_TRADE, status: null };
  return { outcome: TRADE_OUTCOME.BREAK_EVEN_TRADE, status: null };
}

function countError(value, field) {
  if (!isNonNegativeInteger(value)) {
    return { code: METRIC_STATUS.INVALID_INPUT, field };
  }
  return null;
}

function validateTradeAggregates(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      status: METRIC_STATUS.INVALID_INPUT,
      errors: [{ code: METRIC_STATUS.INVALID_INPUT, field: null }],
    };
  }
  const errors = [];
  const {
    winningTradeCount,
    losingTradeCount,
    breakEvenTradeCount,
    averageProfitPerWinningTrade,
    averageLossPerLosingTrade,
  } = input;

  const winErr = countError(winningTradeCount, "winningTradeCount");
  if (winErr) errors.push(winErr);
  const loseErr = countError(losingTradeCount, "losingTradeCount");
  if (loseErr) errors.push(loseErr);
  if (breakEvenTradeCount !== undefined) {
    const evenErr = countError(breakEvenTradeCount, "breakEvenTradeCount");
    if (evenErr) errors.push(evenErr);
  }
  if (errors.length > 0) {
    return { ok: false, status: errors[0].code, errors };
  }

  if (winningTradeCount > 0) {
    if (!isFiniteNumber(averageProfitPerWinningTrade) || !(averageProfitPerWinningTrade > 0)) {
      errors.push({
        code: METRIC_STATUS.INVALID_TRADE_AGGREGATE,
        field: "averageProfitPerWinningTrade",
      });
    }
  } else if (averageProfitPerWinningTrade !== undefined && averageProfitPerWinningTrade !== null) {
    errors.push({
      code: METRIC_STATUS.INVALID_TRADE_AGGREGATE,
      field: "averageProfitPerWinningTrade",
    });
  }

  if (losingTradeCount > 0) {
    if (!isFiniteNumber(averageLossPerLosingTrade) || !(averageLossPerLosingTrade < 0)) {
      errors.push({
        code: METRIC_STATUS.INVALID_TRADE_AGGREGATE,
        field: "averageLossPerLosingTrade",
      });
    }
  } else if (averageLossPerLosingTrade !== undefined && averageLossPerLosingTrade !== null) {
    errors.push({
      code: METRIC_STATUS.INVALID_TRADE_AGGREGATE,
      field: "averageLossPerLosingTrade",
    });
  }

  if (errors.length > 0) {
    return { ok: false, status: errors[0].code, errors };
  }
  return { ok: true, status: null, errors: [] };
}

function computeWinRate(counts, opts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const { winningTradeCount, losingTradeCount, breakEvenTradeCount } = counts;
  if (!isNonNegativeInteger(winningTradeCount)
    || !isNonNegativeInteger(losingTradeCount)
    || !isNonNegativeInteger(breakEvenTradeCount)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const closed = winningTradeCount + losingTradeCount + breakEvenTradeCount;
  if (closed === 0) {
    return ratioResult(null, METRIC_STATUS.NO_CLOSED_TRADES, opts);
  }
  const decisive = winningTradeCount + losingTradeCount;
  if (decisive === 0) {
    return ratioResult(null, METRIC_STATUS.NO_DECISIVE_TRADES, opts);
  }
  return ratioResult(winningTradeCount / decisive, METRIC_STATUS.CALCULATED, opts);
}

function computeProfitToLossRatio(input, opts) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const {
    averageProfitPerWinningTrade,
    averageLossPerLosingTrade,
    winningTradeCount,
    losingTradeCount,
  } = input;
  if (!isNonNegativeInteger(winningTradeCount) || !isNonNegativeInteger(losingTradeCount)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  if (winningTradeCount === 0 && losingTradeCount === 0) {
    return ratioResult(null, METRIC_STATUS.NO_CLOSED_TRADES, opts);
  }
  const aggregates = validateTradeAggregates({
    winningTradeCount,
    losingTradeCount,
    averageProfitPerWinningTrade,
    averageLossPerLosingTrade,
  });
  if (!aggregates.ok) {
    return ratioResult(null, aggregates.status, opts);
  }
  if (winningTradeCount === 0) {
    return ratioResult(null, METRIC_STATUS.NO_WINNING_TRADES, opts);
  }
  if (losingTradeCount === 0) {
    return ratioResult(null, METRIC_STATUS.NO_LOSING_TRADES, opts);
  }
  const ratio = averageProfitPerWinningTrade / Math.abs(averageLossPerLosingTrade);
  if (!isFiniteNumber(ratio)) {
    return ratioResult(null, METRIC_STATUS.INVALID_TRADE_AGGREGATE, opts);
  }
  return ratioResult(ratio, METRIC_STATUS.CALCULATED, opts);
}

function computeProfitFactor(input, opts) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const { grossProfit, grossLoss, winningTradeCount, losingTradeCount } = input;
  if (!isFiniteNumber(grossProfit) || !isFiniteNumber(grossLoss)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  if (!isNonNegativeInteger(winningTradeCount) || !isNonNegativeInteger(losingTradeCount)) {
    return ratioResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  if (winningTradeCount === 0 && losingTradeCount === 0) {
    return ratioResult(null, METRIC_STATUS.NO_CLOSED_TRADES, opts);
  }
  if (losingTradeCount === 0 && grossLoss === 0) {
    return ratioResult(null, METRIC_STATUS.NO_LOSING_TRADES, opts);
  }
  if (losingTradeCount > 0 && grossLoss >= 0) {
    return ratioResult(null, METRIC_STATUS.INVALID_TRADE_AGGREGATE, opts);
  }
  if (losingTradeCount === 0 && grossLoss !== 0) {
    return ratioResult(null, METRIC_STATUS.INVALID_TRADE_AGGREGATE, opts);
  }
  if (winningTradeCount === 0 && grossProfit === 0) {
    return ratioResult(0, METRIC_STATUS.ZERO_GROSS_PROFIT, opts);
  }
  if (winningTradeCount > 0 && grossProfit <= 0) {
    return ratioResult(null, METRIC_STATUS.INVALID_TRADE_AGGREGATE, opts);
  }
  if (winningTradeCount === 0 && grossProfit !== 0) {
    return ratioResult(null, METRIC_STATUS.INVALID_TRADE_AGGREGATE, opts);
  }
  const profitFactor = grossProfit / Math.abs(grossLoss);
  if (!isFiniteNumber(profitFactor)) {
    return ratioResult(null, METRIC_STATUS.NO_LOSING_TRADES, opts);
  }
  return ratioResult(profitFactor, METRIC_STATUS.CALCULATED, opts);
}

function computeExpectedValue(input, opts) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return currencyResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const {
    totalNetPnl,
    winningTradeCount,
    losingTradeCount,
    breakEvenTradeCount,
    totalClosedTrades,
  } = input;
  if (!isFiniteNumber(totalNetPnl)) {
    return currencyResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  if (!isNonNegativeInteger(winningTradeCount)
    || !isNonNegativeInteger(losingTradeCount)
    || !isNonNegativeInteger(breakEvenTradeCount)) {
    return currencyResult(null, METRIC_STATUS.INVALID_INPUT, opts);
  }
  const summed = winningTradeCount + losingTradeCount + breakEvenTradeCount;
  if (totalClosedTrades !== undefined) {
    if (!isNonNegativeInteger(totalClosedTrades) || totalClosedTrades !== summed) {
      return currencyResult(null, METRIC_STATUS.INVALID_TRADE_AGGREGATE, opts);
    }
  }
  if (summed === 0) {
    return currencyResult(null, METRIC_STATUS.NO_CLOSED_TRADES, opts);
  }
  return currencyResult(totalNetPnl / summed, METRIC_STATUS.CALCULATED, opts);
}

module.exports = {
  METRIC_STATUS,
  TRADE_OUTCOME,
  DAYS_PER_YEAR,
  computeTotalReturn,
  computeCagr,
  computeMdd,
  classifyTrade,
  computeWinRate,
  validateTradeAggregates,
  computeProfitToLossRatio,
  computeProfitFactor,
  computeExpectedValue,
  createNotExecutedPerformanceResult,
};
