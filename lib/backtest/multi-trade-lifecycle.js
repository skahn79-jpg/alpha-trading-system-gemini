/**
 * GATE 5J Deterministic Synthetic Multi-Trade Lifecycle. 순수 CommonJS. I/O 없음.
 * 6M: makeError via shared makeBacktestError. Non-object input has no extra.
 * 7O: processSingleTrade fail BLOCKED copies result.errors.
 * 7P freeze: pin 7O result.errors slice. Do not slice local-owned
 *     preErrors / marketErrors / allErrors. Do not add official flags
 *     on that BLOCKED return.
 */

"use strict";

const { parseYmd } = require("./schemas");
const { makeBacktestError: makeError } = require("./make-error");
const dataValidation = require("./data-validation");
const executionModel = require("./execution-model");
const costPolicy = require("./cost-policy");

const LIFECYCLE_VERSION = "synthetic-multi-trade-v0.1";

// ─── 상수 ────────────────────────────────────────────────────────────────────

const LIFECYCLE_STATUS = Object.freeze({
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED",
});

const POSITION_STATE = Object.freeze({
  FLAT: "FLAT",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  BLOCKED: "BLOCKED",
});

const ERROR_CODE = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  EMPTY_TRADE_INTENTS: "EMPTY_TRADE_INTENTS",
  DUPLICATE_TRADE_ID: "DUPLICATE_TRADE_ID",
  OVERLAPPING_TRADE_NOT_ALLOWED: "OVERLAPPING_TRADE_NOT_ALLOWED",
  EXIT_BEFORE_ENTRY: "EXIT_BEFORE_ENTRY",
  ENTRY_CANDLE_NOT_FOUND: "ENTRY_CANDLE_NOT_FOUND",
  EXIT_CANDLE_NOT_FOUND: "EXIT_CANDLE_NOT_FOUND",
  ENTRY_DATE_MISMATCH: "ENTRY_DATE_MISMATCH",
  EXIT_DATE_MISMATCH: "EXIT_DATE_MISMATCH",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  SHORT_POSITION_NOT_SUPPORTED: "SHORT_POSITION_NOT_SUPPORTED",
  LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE: "LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE",
  PRODUCTION_MARKET_NOT_ALLOWED: "PRODUCTION_MARKET_NOT_ALLOWED",
  DATA_STAGE_FAILED: "DATA_STAGE_FAILED",
  EXECUTION_STAGE_FAILED: "EXECUTION_STAGE_FAILED",
  COST_STAGE_FAILED: "COST_STAGE_FAILED",
  ENTRY_EXECUTION_FAILED: "ENTRY_EXECUTION_FAILED",
  EXIT_EXECUTION_FAILED: "EXIT_EXECUTION_FAILED",
  PIPELINE_MARKET_INVARIANT_VIOLATION: "PIPELINE_MARKET_INVARIANT_VIOLATION",
});

const ALLOWED_TOP_KEYS = new Set([
  "dataset", "calendar", "calendarValidation", "cost", "tradeIntents", "calculationMode", "execution",
]);

const EXIT_DATE_MODE = Object.freeze({
  EXACT: "EXACT", // default — current GATE 5K behavior
  LATEST_ALLOWED: "LATEST_ALLOWED", // exitDate = last allowed bar (deadline)
});

const ALLOWED_INTENT_KEYS = new Set([
  "tradeId", "quantity", "direction", "side",
  "entryDate", "exitDate", "exitDateMode",
  "entryIntent", "exitPolicy", "modelVersion",
]);

const ALLOWED_ENTRY_INTENT_KEYS = new Set([
  "orderType", "signalTradingDate", "earliestExecutionTradingDate", "limitPrice",
]);

const ALLOWED_EXIT_POLICY_KEYS = new Set([
  "stopLossPrice", "takeProfitPrice", "intrabarConflictPolicy",
]);

const EXECUTION_CANDLE_KEYS = Object.freeze([
  "symbol",
  "market",
  "tradingDate",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "isFinal",
  "candleFinality",
]);

function mapCandleForExecution(candle) {
  if (!isPlainObject(candle)) return candle;
  const mapped = {};
  for (const key of EXECUTION_CANDLE_KEYS) {
    if (Object.hasOwn(candle, key)) {
      mapped[key] = candle[key];
    }
  }
  return mapped;
}

const PIPELINE_ALLOWED_MARKETS = new Set([
  dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
  dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
]);

const REAL_MARKET_NAMES = new Set(["KOSPI", "KOSDAQ", "KRX", "NASDAQ", "NYSE"]);

// ─── 유틸리티 ────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function uniqueCodes(errors) {
  const seen = new Set();
  const out = [];
  for (const e of errors) {
    if (!e || e.code == null || seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e.code);
  }
  return out;
}


function nullPerformanceFields() {
  // 7B: BLOCKED keeps the same null performance keys as COMPLETED.
  return {
    totalReturn: null,
    cagr: null,
    mdd: null,
    winRate: null,
    profitFactor: null,
    sharpeRatio: null,
    benchmarkReturn: null,
    alpha: null,
  };
}

function classifyTradeProcessFailure(errors) {
  const codes = uniqueCodes(errors);
  if (codes.includes(ERROR_CODE.COST_STAGE_FAILED) || codes.includes("COST_POLICY_MARKET_MISMATCH")) {
    return "COST";
  }
  return "EXECUTION";
}

function isValidQuantity(v) {
  return typeof v === "number"
    && Number.isInteger(v)
    && Number.isFinite(v)
    && v > 0
    && Number.isSafeInteger(v);
}

// ─── 캔들 조회 (exact date only) ─────────────────────────────────────────────

function findExactCandle(candles, tradingDate) {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (isPlainObject(c) && c.tradingDate === tradingDate) {
      return { ok: true, candle: c, index: i };
    }
  }
  return { ok: false, candle: null, index: -1 };
}

// ─── 정렬 비교 ───────────────────────────────────────────────────────────────

function compareTradeIntents(a, b) {
  if (a.entryDate < b.entryDate) return -1;
  if (a.entryDate > b.entryDate) return 1;
  if (a.exitDate < b.exitDate) return -1;
  if (a.exitDate > b.exitDate) return 1;
  const ta = String(a.tradeId);
  const tb = String(b.tradeId);
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

// ─── overlap 검사 (정렬된 indexed 항목) ──────────────────────────────────────

function findOverlappingTrade(sortedIndexed, newItem) {
  for (const existing of sortedIndexed) {
    const a = existing.intent;
    const b = newItem.intent;
    if (a.entryDate <= b.exitDate && b.entryDate <= a.exitDate) {
      return existing;
    }
  }
  return null;
}

// ─── 시장 검사 ───────────────────────────────────────────────────────────────

function rejectMarket(market, errors, extra) {
  if (REAL_MARKET_NAMES.has(market)) {
    errors.push(makeError(ERROR_CODE.PRODUCTION_MARKET_NOT_ALLOWED, { ...extra, market }));
    return true;
  }
  if (market === dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_MARKET) {
    errors.push(makeError(ERROR_CODE.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE, { ...extra, market }));
    return true;
  }
  return false;
}

function datasetMarketOf(dataset) {
  if (!isPlainObject(dataset)) return null;
  if (!Array.isArray(dataset.markets) || dataset.markets.length === 0) return null;
  return dataset.markets[0];
}

// ─── 단건 trade 처리 ─────────────────────────────────────────────────────────

function processSingleTrade(intent, originalIndex, dataset, calendar, calendarValidation, cost, calculationMode) {
  const errors = [];
  const candles = Array.isArray(dataset.candles) ? dataset.candles : [];
  const market = datasetMarketOf(dataset);

  // direction/side 검사 (LONG만 허용)
  const direction = intent.direction || intent.side;
  if (direction != null && direction !== executionModel.SIDE.LONG) {
    errors.push(makeError(ERROR_CODE.SHORT_POSITION_NOT_SUPPORTED, {
      field: "direction",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // quantity 검사
  if (!isValidQuantity(intent.quantity)) {
    errors.push(makeError(ERROR_CODE.INVALID_QUANTITY, {
      field: "quantity",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // entry/exit date 검사
  const entryParsed = parseYmd(intent.entryDate);
  const exitParsed = parseYmd(intent.exitDate);
  if (!entryParsed.ok || !exitParsed.ok) {
    errors.push(makeError(ERROR_CODE.INVALID_INPUT, {
      field: !entryParsed.ok ? "entryDate" : "exitDate",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }
  if (entryParsed.date > exitParsed.date) {
    errors.push(makeError(ERROR_CODE.EXIT_BEFORE_ENTRY, {
      field: "exitDate",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // exitPolicy 필수 확인
  const exitPolicy = isPlainObject(intent.exitPolicy) ? intent.exitPolicy : null;
  if (!exitPolicy) {
    errors.push(makeError(ERROR_CODE.MISSING_REQUIRED_FIELD, {
      field: "exitPolicy",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // entry candle 찾기 (exact date only)
  const entryFound = findExactCandle(candles, intent.entryDate);
  if (!entryFound.ok) {
    errors.push(makeError(ERROR_CODE.ENTRY_CANDLE_NOT_FOUND, {
      field: "entryDate",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // exit candle 찾기 (exact date only)
  const exitFound = findExactCandle(candles, intent.exitDate);
  if (!exitFound.ok) {
    errors.push(makeError(ERROR_CODE.EXIT_CANDLE_NOT_FOUND, {
      field: "exitDate",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // entryIntent 구성 (생략 시 기본값)
  let entryIntentSpec;
  if (isPlainObject(intent.entryIntent)) {
    entryIntentSpec = intent.entryIntent;
  } else {
    // signal: entryDate 직전 캘린더 거래일 찾기
    const tradingDays = Array.isArray(calendar.days)
      ? calendar.days.filter((d) => d.dayStatus === "TRADING_DAY").map((d) => d.tradingDate).sort()
      : [];
    const entryIdx = tradingDays.indexOf(intent.entryDate);
    const signalDate = entryIdx > 0 ? tradingDays[entryIdx - 1] : tradingDays[0];
    entryIntentSpec = {
      orderType: executionModel.ORDER_TYPE.MARKET_OPEN,
      signalTradingDate: signalDate,
      earliestExecutionTradingDate: intent.entryDate,
      limitPrice: null,
    };
  }

  // entry+exit: entryIndex~exitIndex inclusive 단일 evaluateDailyBarExecution
  const execInput = {
    modelVersion: (intent.modelVersion) || executionModel.MODEL_VERSION,
    calculationMode: calculationMode || "SYNTHETIC_UNIT_TEST_ONLY",
    side: executionModel.SIDE.LONG,
    market,
    entryIntent: {
      orderType: entryIntentSpec.orderType,
      signalTradingDate: entryIntentSpec.signalTradingDate,
      earliestExecutionTradingDate: entryIntentSpec.earliestExecutionTradingDate,
      limitPrice: Object.hasOwn(entryIntentSpec, "limitPrice") ? entryIntentSpec.limitPrice : null,
    },
    exitPolicy: {
      stopLossPrice: exitPolicy.stopLossPrice,
      takeProfitPrice: exitPolicy.takeProfitPrice,
      intrabarConflictPolicy: exitPolicy.intrabarConflictPolicy,
    },
    candles: candles.slice(entryFound.index, exitFound.index + 1).map(mapCandleForExecution),
    validationState: {
      schemaValid: true,
      datasetVerified: false,
      backtestDataEligible: false,
      backtestExecutionEligible: false,
    },
    fixtureMetadata: {
      fixtureType: executionModel.FIXTURE_TYPE.SYNTHETIC,
      notProductionData: true,
      productionEligible: false,
    },
    tradeabilityStatus: executionModel.TRADEABILITY_STATUS.SYNTHETIC_TRADABLE,
  };

  const execResult = executionModel.evaluateDailyBarExecution(execInput);

  if (!execResult.ok
    || execResult.entryStatus !== executionModel.ENTRY_STATUS.FILLED
    || execResult.entryPrice == null) {
    errors.push(makeError(ERROR_CODE.ENTRY_EXECUTION_FAILED, {
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  // entry date 일치 확인
  if (execResult.entryTradingDate !== intent.entryDate) {
    errors.push(makeError(ERROR_CODE.ENTRY_DATE_MISMATCH, {
      field: "entryDate",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  const entryPrice = execResult.entryPrice;

  // exitDateMode: missing → EXACT (GATE 5K-R16). Invalid value → INVALID_INPUT.
  const exitDateMode = Object.hasOwn(intent, "exitDateMode")
    ? intent.exitDateMode
    : EXIT_DATE_MODE.EXACT;
  if (exitDateMode !== EXIT_DATE_MODE.EXACT && exitDateMode !== EXIT_DATE_MODE.LATEST_ALLOWED) {
    errors.push(makeError(ERROR_CODE.INVALID_INPUT, {
      field: "exitDateMode",
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  let exitPrice;
  let exitTradingDate;

  if (exitDateMode === EXIT_DATE_MODE.LATEST_ALLOWED) {
    // exitDate is a deadline (last allowed bar). One evaluateDailyBarExecution only.
    if (
      execResult.ok
      && execResult.exitStatus === executionModel.EXIT_STATUS.FILLED
      && execResult.exitPrice != null
      && execResult.exitTradingDate != null
    ) {
      if (execResult.exitTradingDate > intent.exitDate) {
        errors.push(makeError(ERROR_CODE.EXIT_DATE_MISMATCH, {
          field: "exitDate",
          tradeId: intent.tradeId,
          tradeIndex: originalIndex,
        }));
        return { ok: false, errors, closedTrade: null };
      }
      // Early or on-deadline SL/TP: ACCEPT (no EXIT_DATE_MISMATCH).
      exitTradingDate = execResult.exitTradingDate;
      exitPrice = execResult.exitPrice;
    } else if (
      execResult.ok
      && execResult.exitStatus === executionModel.EXIT_STATUS.NOT_TRIGGERED
    ) {
      // Authoritative final-bar market exit at intent.exitDate close.
      const deadlineCandle = exitFound.candle;
      const closePrice = deadlineCandle && deadlineCandle.close;
      if (!(typeof closePrice === "number" && Number.isFinite(closePrice) && closePrice > 0)) {
        errors.push(makeError(ERROR_CODE.EXIT_EXECUTION_FAILED, {
          tradeId: intent.tradeId,
          tradeIndex: originalIndex,
        }));
        return { ok: false, errors, closedTrade: null };
      }
      exitTradingDate = intent.exitDate;
      exitPrice = closePrice;
    } else {
      errors.push(makeError(ERROR_CODE.EXIT_EXECUTION_FAILED, {
        tradeId: intent.tradeId,
        tradeIndex: originalIndex,
      }));
      return { ok: false, errors, closedTrade: null };
    }
  } else {
    // EXACT — GATE 5K-R16: exit must fill on intent.exitDate exactly.
    if (!execResult.ok
      || execResult.exitStatus !== executionModel.EXIT_STATUS.FILLED
      || execResult.exitPrice == null) {
      errors.push(makeError(ERROR_CODE.EXIT_EXECUTION_FAILED, {
        tradeId: intent.tradeId,
        tradeIndex: originalIndex,
      }));
      return { ok: false, errors, closedTrade: null };
    }

    // exit date 일치 확인 (조기 SL/TP는 FILLED여도 의도 exitDate와 불일치)
    if (execResult.exitTradingDate !== intent.exitDate) {
      errors.push(makeError(ERROR_CODE.EXIT_DATE_MISMATCH, {
        field: "exitDate",
        tradeId: intent.tradeId,
        tradeIndex: originalIndex,
      }));
      return { ok: false, errors, closedTrade: null };
    }

    exitTradingDate = execResult.exitTradingDate;
    exitPrice = execResult.exitPrice;
  }

  // cost 계산
  const costInput = {
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
    policyEngineVersion: cost.policyEngineVersion,
    market,
    currency: cost.currency,
    brokerChannel: cost.brokerChannel,
    quantity: intent.quantity,
    entryTradingDate: execResult.entryTradingDate,
    exitTradingDate,
    entryPrice,
    exitPrice,
    policies: cost.policies,
  };

  const costResult = costPolicy.calculateSyntheticTradeCost(costInput);

  if (costResult.ok !== true) {
    const costErrors = Array.isArray(costResult.errors) ? costResult.errors : [];
    // GATE 8E: fold inbound cost errors through makeError. Do not spread e.
    // GATE 8F freeze: inbound cost errors fold through makeError. Do not spread e.
    // Do not add official flags on this helper return (7P). Do not modify make-error.js.
    for (const e of costErrors) {
      errors.push(makeError(e && e.code, Object.assign({}, e, {
        tradeId: intent.tradeId,
        tradeIndex: originalIndex,
      })));
    }
    errors.push(makeError(ERROR_CODE.COST_STAGE_FAILED, {
      tradeId: intent.tradeId,
      tradeIndex: originalIndex,
    }));
    return { ok: false, errors, closedTrade: null };
  }

  const closedTrade = {
    tradeId: intent.tradeId,
    market,
    direction: executionModel.SIDE.LONG,
    quantity: intent.quantity,
    entryDate: execResult.entryTradingDate,
    entryPrice,
    exitDate: exitTradingDate,
    exitPrice,
    entryCost: costResult.entryCommission,
    exitCost: costResult.exitCommission != null && costResult.sellTaxTotal != null
      ? costResult.exitCommission + costResult.sellTaxTotal
      : costResult.exitCommission,
    totalCost: costResult.totalCost,
    entryCommission: costResult.entryCommission,
    exitCommission: costResult.exitCommission,
    sellTaxTotal: costResult.sellTaxTotal,
    grossPnl: costResult.grossProfit,
    netPnl: costResult.netProfit,
    // safety flags
    executionStatus: executionModel.STATUS.NOT_EXECUTED,
    calculationStatus: executionModel.CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    capitalConstraintApplied: false,
    lifecycleVersion: LIFECYCLE_VERSION,
    lifecycleStatus: POSITION_STATE.CLOSED,
    // performance (항상 null)
    totalReturn: null,
    cagr: null,
    mdd: null,
    winRate: null,
    profitFactor: null,
    sharpeRatio: null,
    benchmarkReturn: null,
    alpha: null,
  };

  return { ok: true, errors: [], closedTrade };
}

// ─── 메인 함수 ───────────────────────────────────────────────────────────────

function runSyntheticMultiTradeLifecycle(input) {
  const errors = [];

  // 1. plain object 검사
  if (!isPlainObject(input)) {
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: [ERROR_CODE.INVALID_INPUT],
      errors: [makeError(ERROR_CODE.INVALID_INPUT)],
      ...nullPerformanceFields(),
    };
  }

  // 2. unknown top key 검사
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      errors.push(makeError(ERROR_CODE.UNKNOWN_FIELD, { field: key }));
    }
  }

  // 3. tradeIntents 필수
  if (!Object.hasOwn(input, "tradeIntents")) {
    errors.push(makeError(ERROR_CODE.MISSING_REQUIRED_FIELD, { field: "tradeIntents" }));
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(errors),
      errors,
      ...nullPerformanceFields(),
    };
  }

  // tradeIntents가 null/undefined/non-array
  if (!Array.isArray(input.tradeIntents)) {
    errors.push(makeError(ERROR_CODE.INVALID_INPUT, { field: "tradeIntents" }));
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(errors),
      errors,
      ...nullPerformanceFields(),
    };
  }

  // 4. empty list
  if (input.tradeIntents.length === 0) {
    errors.push(makeError(ERROR_CODE.EMPTY_TRADE_INTENTS, { field: "tradeIntents" }));
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(errors),
      errors,
      ...nullPerformanceFields(),
    };
  }

  if (errors.length > 0) {
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(errors),
      errors,
      ...nullPerformanceFields(),
    };
  }

  const dataset = input.dataset;
  const calendar = input.calendar;
  const calendarValidation = input.calendarValidation;
  const cost = input.cost;
  const calculationMode = input.calculationMode;

  // 5. 시장 검사 (dataset/calendar)
  const marketErrors = [];
  if (isPlainObject(dataset) && Array.isArray(dataset.markets)) {
    for (const m of dataset.markets) {
      rejectMarket(m, marketErrors, { field: "dataset.markets" });
    }
  }
  if (isPlainObject(calendar) && Object.hasOwn(calendar, "market")) {
    rejectMarket(calendar.market, marketErrors, { field: "calendar.market" });
  }
  if (isPlainObject(dataset) && Array.isArray(dataset.candles)) {
    for (let i = 0; i < dataset.candles.length; i++) {
      const c = dataset.candles[i];
      if (isPlainObject(c) && Object.hasOwn(c, "market")) {
        if (rejectMarket(c.market, marketErrors, { field: "candles.market", recordIndex: i })) break;
      }
    }
  }
  if (marketErrors.length > 0) {
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      failedStage: "DATA",
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(marketErrors),
      errors: marketErrors,
      ...nullPerformanceFields(),
    };
  }

  // 6. validateHistoricalDataset
  const dataResult = dataValidation.validateHistoricalDataset(dataset, {
    mode: dataValidation.LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    marketContract: dataValidation.VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
    calendar,
    calendarValidation,
  });

  const dataOk = dataResult.schemaValid === true
    && dataResult.syntheticCalendarProvided === true
    && dataResult.syntheticCalendarVerified === true
    && dataResult.syntheticCandleDatesVerified === true
    && Array.isArray(dataResult.errorCodes)
    && dataResult.errorCodes.length === 0;

  if (!dataOk) {
    const propagatedErrors = Array.isArray(dataResult.errors) ? dataResult.errors : [];
    const summary = makeError(ERROR_CODE.DATA_STAGE_FAILED, { stage: "DATA" });
    const allErrors = [...propagatedErrors, summary];
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      failedStage: "DATA",
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(allErrors),
      errors: allErrors,
      ...nullPerformanceFields(),
    };
  }

  // 7. market invariant 검사
  const datasetMarket = datasetMarketOf(dataset);
  if (!PIPELINE_ALLOWED_MARKETS.has(datasetMarket)) {
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      failedStage: "DATA",
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: [ERROR_CODE.PIPELINE_MARKET_INVARIANT_VIOLATION],
      errors: [makeError(ERROR_CODE.PIPELINE_MARKET_INVARIANT_VIOLATION, { field: "dataset.markets", market: datasetMarket })],
      ...nullPerformanceFields(),
    };
  }

  // 8. tradeIntents 개별 검사 + indexed 생성
  const intents = input.tradeIntents;
  const preErrors = [];
  const indexed = [];

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    if (!isPlainObject(intent)) {
      preErrors.push(makeError(ERROR_CODE.INVALID_INPUT, { field: `tradeIntents[${i}]`, tradeIndex: i }));
      continue;
    }
    // unknown keys in intent
    for (const k of Object.keys(intent)) {
      if (!ALLOWED_INTENT_KEYS.has(k)) {
        preErrors.push(makeError(ERROR_CODE.UNKNOWN_FIELD, { field: `tradeIntents[${i}].${k}`, tradeIndex: i }));
      }
    }
    // tradeId 필수
    if (!Object.hasOwn(intent, "tradeId") || intent.tradeId == null) {
      preErrors.push(makeError(ERROR_CODE.MISSING_REQUIRED_FIELD, { field: `tradeIntents[${i}].tradeId`, tradeIndex: i }));
      continue;
    }
    // entryDate, exitDate 필수
    if (!Object.hasOwn(intent, "entryDate")) {
      preErrors.push(makeError(ERROR_CODE.MISSING_REQUIRED_FIELD, { field: "entryDate", tradeId: String(intent.tradeId), tradeIndex: i }));
    }
    if (!Object.hasOwn(intent, "exitDate")) {
      preErrors.push(makeError(ERROR_CODE.MISSING_REQUIRED_FIELD, { field: "exitDate", tradeId: String(intent.tradeId), tradeIndex: i }));
    }
    // entryIntent 키 검사
    if (isPlainObject(intent.entryIntent)) {
      for (const k of Object.keys(intent.entryIntent)) {
        if (!ALLOWED_ENTRY_INTENT_KEYS.has(k)) {
          preErrors.push(makeError(ERROR_CODE.UNKNOWN_FIELD, {
            field: `tradeIntents[${i}].entryIntent.${k}`,
            tradeId: String(intent.tradeId),
            tradeIndex: i,
          }));
        }
      }
    }
    // exitPolicy 키 검사
    if (isPlainObject(intent.exitPolicy)) {
      for (const k of Object.keys(intent.exitPolicy)) {
        if (!ALLOWED_EXIT_POLICY_KEYS.has(k)) {
          preErrors.push(makeError(ERROR_CODE.UNKNOWN_FIELD, {
            field: `tradeIntents[${i}].exitPolicy.${k}`,
            tradeId: String(intent.tradeId),
            tradeIndex: i,
          }));
        }
      }
    }
    indexed.push({ intent, originalIndex: i });
  }

  if (preErrors.length > 0) {
    return {
      lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
      multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
      closedTrades: [],
      partialClosedTrades: [],
      failedTradeId: null,
      failedTradeIndex: null,
      lifecycleVersion: LIFECYCLE_VERSION,
      errorCodes: uniqueCodes(preErrors),
      errors: preErrors,
      ...nullPerformanceFields(),
    };
  }

  // 9. duplicate tradeId 검사
  const idSeen = new Map();
  for (const { intent, originalIndex } of indexed) {
    const tid = String(intent.tradeId);
    if (idSeen.has(tid)) {
      const dupErr = makeError(ERROR_CODE.DUPLICATE_TRADE_ID, {
        field: "tradeId",
        tradeId: tid,
        tradeIndex: originalIndex,
      });
      return {
        lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
        multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
        closedTrades: [],
        partialClosedTrades: [],
        failedTradeId: tid,
        failedTradeIndex: originalIndex,
        lifecycleVersion: LIFECYCLE_VERSION,
        errorCodes: [ERROR_CODE.DUPLICATE_TRADE_ID],
        errors: [dupErr],
      
      ...nullPerformanceFields(),
    };
    }
    idSeen.set(tid, originalIndex);
  }

  // 10. 정렬 (복사본, 주의: indexed.intent 기반으로 비교)
  const sortedIndexed = indexed.slice().sort((a, b) => compareTradeIntents(a.intent, b.intent));

  // 11. overlap 검사
  const processedForOverlap = [];
  for (const item of sortedIndexed) {
    const overlap = findOverlappingTrade(processedForOverlap, item);
    if (overlap) {
      const oe = makeError(ERROR_CODE.OVERLAPPING_TRADE_NOT_ALLOWED, {
        field: "entryDate",
        tradeId: String(item.intent.tradeId),
        tradeIndex: item.originalIndex,
      });
      return {
        lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
        multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
        closedTrades: [],
        partialClosedTrades: [],
        failedTradeId: String(item.intent.tradeId),
        failedTradeIndex: item.originalIndex,
        lifecycleVersion: LIFECYCLE_VERSION,
        errorCodes: [ERROR_CODE.OVERLAPPING_TRADE_NOT_ALLOWED],
        errors: [oe],
      
      ...nullPerformanceFields(),
    };
    }
    processedForOverlap.push(item);
  }

  // 12. 각 trade 처리
  const closedTrades = [];
  const partialClosedTrades = [];

  for (const { intent, originalIndex } of sortedIndexed) {
    const result = processSingleTrade(
      intent, originalIndex,
      dataset, calendar, calendarValidation, cost, calculationMode,
    );
    if (!result.ok) {
      return {
        lifecycleStatus: LIFECYCLE_STATUS.BLOCKED,
        multiTradeStatus: LIFECYCLE_STATUS.BLOCKED,
        failedStage: classifyTradeProcessFailure(result.errors),
        closedTrades: [],
        partialClosedTrades: closedTrades.slice(),
        failedTradeId: String(intent.tradeId),
        failedTradeIndex: originalIndex,
        lifecycleVersion: LIFECYCLE_VERSION,
        errorCodes: uniqueCodes(result.errors),
        errors: Array.isArray(result.errors) ? result.errors.slice() : [],
      
      ...nullPerformanceFields(),
    };
    }
    closedTrades.push(result.closedTrade);
    partialClosedTrades.push(result.closedTrade);
  }

  return {
    lifecycleStatus: LIFECYCLE_STATUS.COMPLETED,
    multiTradeStatus: LIFECYCLE_STATUS.COMPLETED,
    closedTrades,
    partialClosedTrades: [],
    failedTradeId: null,
    failedTradeIndex: null,
    lifecycleVersion: LIFECYCLE_VERSION,
    errorCodes: [],
    errors: [],
    // safety
    executionStatus: executionModel.STATUS.NOT_EXECUTED,
    calculationStatus: executionModel.CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    capitalConstraintApplied: false,
    // performance null
    totalReturn: null,
    cagr: null,
    mdd: null,
    winRate: null,
    profitFactor: null,
    sharpeRatio: null,
    benchmarkReturn: null,
    alpha: null,
  };
}

module.exports = {
  LIFECYCLE_VERSION,
  LIFECYCLE_STATUS,
  POSITION_STATE,
  ERROR_CODE,
  EXIT_DATE_MODE,
  runSyntheticMultiTradeLifecycle,
};
