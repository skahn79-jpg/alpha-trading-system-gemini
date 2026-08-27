/**
 * GATE 5G 합성 단일 거래 파이프라인 오케스트레이터. 순수 CommonJS. I/O 없음.
 * validateHistoricalDataset → evaluateDailyBarExecution → calculateSyntheticTradeCost
 * 6S: makeSafePipelineError is a thin adapter onto shared makeBacktestError.
 * 6V freeze: persist failedStage on blocked pipeline results. Adapter identity unchanged.
 */

"use strict";

const { makeBacktestError } = require("./make-error");
const dataValidation = require("./data-validation");
const executionModel = require("./execution-model");
const costPolicy = require("./cost-policy");

const multiTradeLifecycle = require("./multi-trade-lifecycle");
const portfolioLedger = require("./portfolio-ledger");
const performanceMetrics = require("./performance-metrics");
const benchmarkPerformance = require("./benchmark-performance");

const PIPELINE_VERSION = "synthetic-single-trade-v0.1";
const MULTI_TRADE_PIPELINE_VERSION = "synthetic-multi-trade-v0.1";

const STAGE = Object.freeze({
  PIPELINE: "PIPELINE",
  DATA: "DATA",
  EXECUTION: "EXECUTION",
  COST: "COST",
  PERFORMANCE: "PERFORMANCE",
  BENCHMARK: "BENCHMARK",
});

const CALCULATION_MODE = Object.freeze({
  SYNTHETIC_UNIT_TEST_ONLY: "SYNTHETIC_UNIT_TEST_ONLY",
  PRODUCTION: "PRODUCTION",
});

const PIPELINE_STATUS = Object.freeze({
  BLOCKED_PIPELINE_SCHEMA: "BLOCKED_PIPELINE_SCHEMA",
  BLOCKED_DATA_STAGE: "BLOCKED_DATA_STAGE",
  BLOCKED_EXECUTION_STAGE: "BLOCKED_EXECUTION_STAGE",
  BLOCKED_COST_STAGE: "BLOCKED_COST_STAGE",
  COMPLETED_NO_ENTRY: "COMPLETED_NO_ENTRY",
  COMPLETED_OPEN_POSITION_NOT_EXECUTED: "COMPLETED_OPEN_POSITION_NOT_EXECUTED",
  COMPLETED_SYNTHETIC_SINGLE_TRADE: "COMPLETED_SYNTHETIC_SINGLE_TRADE",
  COMPLETED_SYNTHETIC_MULTI_TRADE: "COMPLETED_SYNTHETIC_MULTI_TRADE",
  BLOCKED_MULTI_TRADE_LIFECYCLE: "BLOCKED_MULTI_TRADE_LIFECYCLE",
  COMPLETED_PORTFOLIO_LEDGER: "COMPLETED_PORTFOLIO_LEDGER",
  BLOCKED_PORTFOLIO_LEDGER: "BLOCKED_PORTFOLIO_LEDGER",
  COMPLETED_PERFORMANCE_METRICS: "COMPLETED_PERFORMANCE_METRICS",
  BLOCKED_PERFORMANCE_STAGE: "BLOCKED_PERFORMANCE_STAGE",
  COMPLETED_BENCHMARK_ALPHA: "COMPLETED_BENCHMARK_ALPHA",
  BLOCKED_BENCHMARK_STAGE: "BLOCKED_BENCHMARK_STAGE",
});

const STAGE_STATUS = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  FAILED: "FAILED",
  PASSED_SYNTHETIC_ONLY: "PASSED_SYNTHETIC_ONLY",
  COMPLETED_NOT_FILLED: "COMPLETED_NOT_FILLED",
  COMPLETED_OPEN_POSITION: "COMPLETED_OPEN_POSITION",
});

const ERROR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  UNSUPPORTED_PIPELINE_VERSION: "UNSUPPORTED_PIPELINE_VERSION",
  UNSUPPORTED_CALCULATION_MODE: "UNSUPPORTED_CALCULATION_MODE",
  MULTI_SYMBOL_PIPELINE_NOT_SUPPORTED: "MULTI_SYMBOL_PIPELINE_NOT_SUPPORTED",
  MULTI_MARKET_PIPELINE_NOT_SUPPORTED: "MULTI_MARKET_PIPELINE_NOT_SUPPORTED",
  MULTI_TRADE_PIPELINE_NOT_SUPPORTED: "MULTI_TRADE_PIPELINE_NOT_SUPPORTED",
  UNSUPPORTED_PIPELINE_SIDE: "UNSUPPORTED_PIPELINE_SIDE",
  DATA_STAGE_FAILED: "DATA_STAGE_FAILED",
  EXECUTION_STAGE_FAILED: "EXECUTION_STAGE_FAILED",
  COST_STAGE_FAILED: "COST_STAGE_FAILED",
  EXECUTION_RESULT_INCOMPLETE: "EXECUTION_RESULT_INCOMPLETE",
  COST_INPUT_DERIVATION_FAILED: "COST_INPUT_DERIVATION_FAILED",
  SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION: "SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION",
  PRODUCTION_MARKET_NOT_ALLOWED: "PRODUCTION_MARKET_NOT_ALLOWED",
  LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE: "LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE",
  PIPELINE_MARKET_INVARIANT_VIOLATION: "PIPELINE_MARKET_INVARIANT_VIOLATION",
  PERFORMANCE_STAGE_FAILED: "PERFORMANCE_STAGE_FAILED",
  BENCHMARK_STAGE_FAILED: "BENCHMARK_STAGE_FAILED",
  PORTFOLIO_NOT_COMPLETED: "PORTFOLIO_NOT_COMPLETED",
});

const SAFE_ERROR_KEYS = Object.freeze([
  "code",
  "severity",
  "stage",
  "field",
  "recordIndex",
  "symbol",
  "tradingDate",
  "datasetId",
  "datasetVersion",
  "calendarId",
  "calendarVersion",
  "market",
  "modelVersion",
  "orderType",
  "policyId",
  "policyVersion",
  "brokerChannel",
  "currency",
  "taxType",
  "tradeId",
  "tradeIndex",
]);

const TOP_KEYS = Object.freeze([
  "pipelineVersion",
  "calculationMode",
  "dataset",
  "calendar",
  "calendarValidation",
  "execution",
  "cost",
]);

const MULTI_TRADE_TOP_KEYS = Object.freeze([
  "pipelineVersion",
  "calculationMode",
  "dataset",
  "calendar",
  "calendarValidation",
  "cost",
  "tradeIntents",
  "execution",
]);
const MULTI_TRADE_TOP_KEY_SET = new Set(MULTI_TRADE_TOP_KEYS);

const PORTFOLIO_LEDGER_TOP_KEYS = Object.freeze([
  "pipelineVersion",
  "calculationMode",
  "dataset",
  "calendar",
  "calendarValidation",
  "cost",
  "tradeIntents",
  "execution",
  "initialCapital",
  "benchmark",
]);
const PORTFOLIO_LEDGER_TOP_KEY_SET = new Set(PORTFOLIO_LEDGER_TOP_KEYS);

const CALENDAR_VALIDATION_KEYS = Object.freeze(["requiredFrom", "requiredTo"]);

const EXECUTION_KEYS = Object.freeze([
  "modelVersion",
  "side",
  "entryIntent",
  "exitPolicy",
  "quantity",
]);

const ENTRY_INTENT_KEYS = Object.freeze([
  "orderType",
  "signalTradingDate",
  "earliestExecutionTradingDate",
  "limitPrice",
]);

const EXIT_POLICY_KEYS = Object.freeze([
  "stopLossPrice",
  "takeProfitPrice",
  "intrabarConflictPolicy",
]);

const COST_KEYS = Object.freeze([
  "policyEngineVersion",
  "brokerChannel",
  "currency",
  "policies",
]);

const TOP_KEY_SET = new Set(TOP_KEYS);
const CALENDAR_VALIDATION_KEY_SET = new Set(CALENDAR_VALIDATION_KEYS);
const EXECUTION_KEY_SET = new Set(EXECUTION_KEYS);
const ENTRY_INTENT_KEY_SET = new Set(ENTRY_INTENT_KEYS);
const EXIT_POLICY_KEY_SET = new Set(EXIT_POLICY_KEYS);
const COST_KEY_SET = new Set(COST_KEYS);

const PIPELINE_ALLOWED_MARKETS = new Set([
  dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
  dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
]);
const REAL_MARKET_NAMES = new Set(["KOSPI", "KOSDAQ", "KRX", "NASDAQ", "NYSE"]);

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

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function uniqueCodes(errors) {
  const seen = new Set();
  const out = [];
  for (const err of errors) {
    if (!err || err.code == null) continue;
    if (seen.has(err.code)) continue;
    seen.add(err.code);
    out.push(err.code);
  }
  return out;
}

function makeSafePipelineError(raw) {
  if (!isPlainObject(raw)) {
    return { severity: "ERROR" };
  }
  const extra = {};
  for (const key of SAFE_ERROR_KEYS) {
    if (key === "code" || key === "severity") continue;
    if (raw[key] !== undefined && raw[key] !== null) extra[key] = raw[key];
  }
  const err = makeBacktestError(raw.code, extra);
  if (raw.code == null) {
    delete err.code;
  }
  err.severity = raw.severity != null ? raw.severity : "ERROR";
  return err;
}

// GATE 8K freeze: leftover object-spread / extra-overwrite / array-copy chapters
// are closed. mergeSafeStageErrors inbound err spread is 7F makeSafe allowlist,
// not leftover leak. Do not reopen 8I/8D/7W/7F.
function mergeSafeStageErrors(stage, errors) {
  const list = Array.isArray(errors) ? errors : [];
  return list.map((err) => makeSafePipelineError({
    ...(isPlainObject(err) ? err : {}),
    stage,
  }));
}

function collectUnknownKeys(obj, allowed, fieldPrefix) {
  const errors = [];
  if (!isPlainObject(obj)) return errors;
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(makeSafePipelineError({
        code: ERROR.UNKNOWN_FIELD,
        field: fieldPrefix ? `${fieldPrefix}.${key}` : key,
      }));
    }
  }
  return errors;
}

function requireFields(obj, fields, fieldPrefix) {
  const errors = [];
  if (!isPlainObject(obj)) return errors;
  for (const field of fields) {
    if (!Object.hasOwn(obj, field)) {
      errors.push(makeSafePipelineError({
        code: ERROR.MISSING_REQUIRED_FIELD,
        field: fieldPrefix ? `${fieldPrefix}.${field}` : field,
      }));
    }
  }
  return errors;
}

function defaultPerformanceFields() {
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

function defaultOperationalFlags() {
  return {
    executionStatus: executionModel.STATUS.NOT_EXECUTED,
    calculationStatus: executionModel.CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
  };
}

function defaultSyntheticFlags() {
  return {
    syntheticDataValidated: false,
    syntheticCalendarVerified: false,
    syntheticCandleDatesVerified: false,
    syntheticExecutionCalculated: false,
    syntheticCostCalculated: false,
  };
}

function mergeMissingData(lists) {
  const set = new Set([
    "PRODUCTION_CALENDAR_NOT_CONFIGURED",
    "PRODUCTION_COST_POLICY_NOT_CONFIGURED",
  ]);
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item != null) set.add(item);
    }
  }
  return Array.from(set);
}

function createSyntheticPipelineResult(partial) {
  const src = isPlainObject(partial) ? partial : {};
  const errors = Array.isArray(src.errors)
    ? src.errors.map((e) => makeSafePipelineError(e))
    : [];
  const ops = defaultOperationalFlags();
  const perf = defaultPerformanceFields();
  const synth = defaultSyntheticFlags();

  return {
    pipelineVersion: PIPELINE_VERSION,
    pipelineStatus: src.pipelineStatus != null ? src.pipelineStatus : PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
    failedStage: typeof src.failedStage === "string" && src.failedStage.length > 0
      ? src.failedStage
      : null,
    ...ops,
    dataStageStatus: src.dataStageStatus != null ? src.dataStageStatus : STAGE_STATUS.NOT_STARTED,
    executionStageStatus: src.executionStageStatus != null ? src.executionStageStatus : STAGE_STATUS.NOT_STARTED,
    costStageStatus: src.costStageStatus != null ? src.costStageStatus : STAGE_STATUS.NOT_STARTED,
    datasetId: src.datasetId != null ? src.datasetId : null,
    datasetVersion: src.datasetVersion != null ? src.datasetVersion : null,
    calendarId: src.calendarId != null ? src.calendarId : null,
    calendarVersion: src.calendarVersion != null ? src.calendarVersion : null,
    symbol: src.symbol != null ? src.symbol : null,
    market: src.market != null ? src.market : null,
    entryStatus: src.entryStatus != null ? src.entryStatus : null,
    entryTradingDate: src.entryTradingDate != null ? src.entryTradingDate : null,
    entryPrice: src.entryPrice != null ? src.entryPrice : null,
    entryReason: src.entryReason != null ? src.entryReason : null,
    exitStatus: src.exitStatus != null ? src.exitStatus : null,
    exitTradingDate: src.exitTradingDate != null ? src.exitTradingDate : null,
    exitPrice: src.exitPrice != null ? src.exitPrice : null,
    exitReason: src.exitReason != null ? src.exitReason : null,
    quantity: src.quantity != null ? src.quantity : null,
    entryAmount: src.entryAmount != null ? src.entryAmount : null,
    exitAmount: src.exitAmount != null ? src.exitAmount : null,
    entryCommission: src.entryCommission != null ? src.entryCommission : null,
    exitCommission: src.exitCommission != null ? src.exitCommission : null,
    sellTaxTotal: src.sellTaxTotal != null ? src.sellTaxTotal : null,
    totalCost: src.totalCost != null ? src.totalCost : null,
    grossProfit: src.grossProfit != null ? src.grossProfit : null,
    netProfit: src.netProfit != null ? src.netProfit : null,
    ...synth,
    syntheticDataValidated: src.syntheticDataValidated === true,
    syntheticCalendarVerified: src.syntheticCalendarVerified === true,
    syntheticCandleDatesVerified: src.syntheticCandleDatesVerified === true,
    syntheticExecutionCalculated: src.syntheticExecutionCalculated === true,
    syntheticCostCalculated: src.syntheticCostCalculated === true,
    ...perf,
    errorCodes: uniqueCodes(errors),
    errors,
    missingData: mergeMissingData([src.missingData]),
    warnings: Array.isArray(src.warnings) ? src.warnings.slice() : [],
    marketContractStatus: src.marketContractStatus != null ? src.marketContractStatus : null,
    // multi-trade optional fields
    // 7E: copy closedTrades so callers cannot mutate the result array.
    closedTrades: Array.isArray(src.closedTrades) ? src.closedTrades.slice() : [],
    multiTradeStatus: src.multiTradeStatus != null ? src.multiTradeStatus : null,
    failedTradeId: src.failedTradeId != null ? src.failedTradeId : null,
    failedTradeIndex: src.failedTradeIndex != null ? src.failedTradeIndex : null,
    lifecycleStatus: src.lifecycleStatus != null ? src.lifecycleStatus : null,
    capitalConstraintApplied: src.capitalConstraintApplied === true ? true : false,
  };
}

function pipelineMarketContractStatus(market) {
  if (market === dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSPI
    || market === dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ) {
    return executionModel.MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET;
  }
  return null;
}

function isProductionMarketName(market) {
  return REAL_MARKET_NAMES.has(market);
}

function isLegacyPipelineMarket(market) {
  return market === dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_MARKET;
}

function rejectDisallowedPipelineMarket(errors, market, field, extra) {
  if (isProductionMarketName(market)) {
    errors.push(makeSafePipelineError({
      code: ERROR.PRODUCTION_MARKET_NOT_ALLOWED,
      field,
      market,
      stage: STAGE.PIPELINE,
      ...(extra || {}),
    }));
    return true;
  }
  if (isLegacyPipelineMarket(market)) {
    errors.push(makeSafePipelineError({
      code: ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE,
      field,
      market,
      stage: STAGE.PIPELINE,
      ...(extra || {}),
    }));
    return true;
  }
  return false;
}

function collectDisallowedPipelineMarketErrors(input) {
  const errors = [];
  if (!isPlainObject(input)) return errors;
  const dataset = isPlainObject(input.dataset) ? input.dataset : null;
  const calendar = isPlainObject(input.calendar) ? input.calendar : null;
  const extra = dataset ? {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
  } : {};

  if (dataset && Array.isArray(dataset.markets)) {
    for (const market of dataset.markets) {
      rejectDisallowedPipelineMarket(errors, market, "dataset.markets", extra);
    }
  }
  if (calendar && Object.hasOwn(calendar, "market")) {
    rejectDisallowedPipelineMarket(errors, calendar.market, "calendar.market", extra);
  }
  if (dataset && Array.isArray(dataset.candles)) {
    for (let i = 0; i < dataset.candles.length; i += 1) {
      const candle = dataset.candles[i];
      if (!isPlainObject(candle) || !Object.hasOwn(candle, "market")) continue;
      rejectDisallowedPipelineMarket(errors, candle.market, "candles.market", {
        ...extra,
        recordIndex: i,
        symbol: candle.symbol,
        tradingDate: candle.tradingDate,
      });
    }
  }
  return errors;
}

function datasetMarketOf(input) {
  if (!isPlainObject(input) || !isPlainObject(input.dataset)) return null;
  if (!Array.isArray(input.dataset.markets) || input.dataset.markets.length === 0) return null;
  return input.dataset.markets[0];
}

function collectDataMarketInvariantErrors(input) {
  const errors = [];
  const datasetMarket = datasetMarketOf(input);
  const calendarMarket = isPlainObject(input.calendar) ? input.calendar.market : undefined;
  if (datasetMarket !== calendarMarket) {
    errors.push(makeSafePipelineError({
      code: ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION,
      field: "calendar.market",
      stage: STAGE.DATA,
      market: datasetMarket,
    }));
  }
  if (isPlainObject(input.dataset) && Array.isArray(input.dataset.candles)) {
    for (let i = 0; i < input.dataset.candles.length; i += 1) {
      const candle = input.dataset.candles[i];
      if (!isPlainObject(candle)) continue;
      if (candle.market !== datasetMarket) {
        errors.push(makeSafePipelineError({
          code: ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION,
          field: "candles.market",
          stage: STAGE.DATA,
          recordIndex: i,
          symbol: candle.symbol,
          tradingDate: candle.tradingDate,
          market: datasetMarket,
        }));
        break;
      }
    }
  }
  if (datasetMarket != null && !PIPELINE_ALLOWED_MARKETS.has(datasetMarket)) {
    errors.push(makeSafePipelineError({
      code: ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION,
      field: "dataset.markets",
      stage: STAGE.DATA,
      market: datasetMarket,
    }));
  }
  return errors;
}

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

function isDataStagePassed(dataResult) {
  return dataResult.schemaValid === true
    && dataResult.syntheticCalendarProvided === true
    && dataResult.syntheticCalendarVerified === true
    && dataResult.syntheticCandleDatesVerified === true
    && Array.isArray(dataResult.errorCodes)
    && dataResult.errorCodes.length === 0;
}

function isNoEntryExecution(execResult) {
  if (!isPlainObject(execResult)) return false;
  if (execResult.errorCodes && execResult.errorCodes.includes(executionModel.ERROR.NO_ELIGIBLE_ENTRY_CANDLE)) {
    return true;
  }
  if (Array.isArray(execResult.warnings)
    && execResult.warnings.some((w) => w && w.code === executionModel.ERROR.LIMIT_NOT_TOUCHED)) {
    return true;
  }
  if (execResult.status === executionModel.STATUS.NOT_FILLED) {
    return true;
  }
  return false;
}

function isOpenPositionExecution(execResult) {
  return execResult.ok === true
    && execResult.entryStatus === executionModel.ENTRY_STATUS.FILLED
    && execResult.exitStatus === executionModel.EXIT_STATUS.NOT_TRIGGERED;
}

function isFullTradeExecution(execResult) {
  return execResult.ok === true
    && execResult.entryStatus === executionModel.ENTRY_STATUS.FILLED
    && execResult.exitStatus === executionModel.EXIT_STATUS.FILLED;
}

function validateSyntheticPipelineInput(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    errors.push(makeSafePipelineError({ code: ERROR.INVALID_INPUT, stage: STAGE.PIPELINE }));
    return { ok: false, errors, parsed: null };
  }

  errors.push(...collectUnknownKeys(input, TOP_KEY_SET, null));

  const requiredTop = [
    "pipelineVersion",
    "calculationMode",
    "dataset",
    "calendar",
    "calendarValidation",
    "execution",
    "cost",
  ];
  errors.push(...requireFields(input, requiredTop, null));

  if (Object.hasOwn(input, "pipelineVersion") && input.pipelineVersion !== PIPELINE_VERSION) {
    errors.push(makeSafePipelineError({
      code: ERROR.UNSUPPORTED_PIPELINE_VERSION,
      field: "pipelineVersion",
      stage: STAGE.PIPELINE,
    }));
  }

  if (Object.hasOwn(input, "calculationMode")) {
    if (input.calculationMode === CALCULATION_MODE.PRODUCTION) {
      errors.push(makeSafePipelineError({
        code: ERROR.SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION,
        field: "calculationMode",
        stage: STAGE.PIPELINE,
      }));
    } else if (input.calculationMode !== CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY) {
      errors.push(makeSafePipelineError({
        code: ERROR.UNSUPPORTED_CALCULATION_MODE,
        field: "calculationMode",
        stage: STAGE.PIPELINE,
      }));
    }
  }

  if (Object.hasOwn(input, "calendarValidation")) {
    if (!isPlainObject(input.calendarValidation)) {
      errors.push(makeSafePipelineError({
        code: ERROR.INVALID_INPUT,
        field: "calendarValidation",
        stage: STAGE.PIPELINE,
      }));
    } else {
      errors.push(...collectUnknownKeys(input.calendarValidation, CALENDAR_VALIDATION_KEY_SET, "calendarValidation"));
      errors.push(...requireFields(input.calendarValidation, CALENDAR_VALIDATION_KEYS, "calendarValidation"));
    }
  }

  if (Object.hasOwn(input, "execution")) {
    if (!isPlainObject(input.execution)) {
      errors.push(makeSafePipelineError({
        code: ERROR.INVALID_INPUT,
        field: "execution",
        stage: STAGE.PIPELINE,
      }));
    } else {
      errors.push(...collectUnknownKeys(input.execution, EXECUTION_KEY_SET, "execution"));
      errors.push(...requireFields(input.execution, EXECUTION_KEYS, "execution"));
      if (Object.hasOwn(input.execution, "side") && input.execution.side !== executionModel.SIDE.LONG) {
        errors.push(makeSafePipelineError({
          code: ERROR.UNSUPPORTED_PIPELINE_SIDE,
          field: "execution.side",
          stage: STAGE.PIPELINE,
        }));
      }
      if (isPlainObject(input.execution.entryIntent)) {
        errors.push(...collectUnknownKeys(
          input.execution.entryIntent,
          ENTRY_INTENT_KEY_SET,
          "execution.entryIntent",
        ));
      }
      if (isPlainObject(input.execution.exitPolicy)) {
        errors.push(...collectUnknownKeys(
          input.execution.exitPolicy,
          EXIT_POLICY_KEY_SET,
          "execution.exitPolicy",
        ));
      }
    }
  }

  if (Object.hasOwn(input, "cost")) {
    if (!isPlainObject(input.cost)) {
      errors.push(makeSafePipelineError({
        code: ERROR.INVALID_INPUT,
        field: "cost",
        stage: STAGE.PIPELINE,
      }));
    } else {
      errors.push(...collectUnknownKeys(input.cost, COST_KEY_SET, "cost"));
      errors.push(...requireFields(input.cost, COST_KEYS, "cost"));
    }
  }

  if (isPlainObject(input.dataset)) {
    const dataset = input.dataset;
    if (Array.isArray(dataset.symbols) && dataset.symbols.length > 1) {
      errors.push(makeSafePipelineError({
        code: ERROR.MULTI_SYMBOL_PIPELINE_NOT_SUPPORTED,
        field: "dataset.symbols",
        stage: STAGE.PIPELINE,
        datasetId: dataset.datasetId,
        datasetVersion: dataset.datasetVersion,
      }));
    }
    if (Array.isArray(dataset.markets)) {
      if (dataset.markets.length > 1) {
        errors.push(makeSafePipelineError({
          code: ERROR.MULTI_MARKET_PIPELINE_NOT_SUPPORTED,
          field: "dataset.markets",
          stage: STAGE.PIPELINE,
          datasetId: dataset.datasetId,
          datasetVersion: dataset.datasetVersion,
        }));
      }
    }
  }

  errors.push(...collectDisallowedPipelineMarketErrors(input));

  return {
    ok: errors.length === 0,
    errors: mergeSafeStageErrors(STAGE.PIPELINE, errors),
    parsed: errors.length === 0 ? input : null,
  };
}

function buildExecutionInput(input, dataResult) {
  const dataset = input.dataset;
  const execution = input.execution;
  const candles = Array.isArray(dataset.candles)
    ? dataset.candles.map((c) => mapCandleForExecution(c))
    : [];

  return {
    modelVersion: execution.modelVersion,
    calculationMode: input.calculationMode,
    side: execution.side,
    market: Array.isArray(dataset.markets) ? dataset.markets[0] : null,
    entryIntent: {
      orderType: execution.entryIntent.orderType,
      signalTradingDate: execution.entryIntent.signalTradingDate,
      earliestExecutionTradingDate: execution.entryIntent.earliestExecutionTradingDate,
      limitPrice: Object.hasOwn(execution.entryIntent, "limitPrice")
        ? execution.entryIntent.limitPrice
        : null,
    },
    exitPolicy: {
      stopLossPrice: execution.exitPolicy.stopLossPrice,
      takeProfitPrice: execution.exitPolicy.takeProfitPrice,
      intrabarConflictPolicy: execution.exitPolicy.intrabarConflictPolicy,
    },
    candles,
    validationState: {
      schemaValid: dataResult.schemaValid === true,
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
}

function buildCostInput(input, executionResult) {
  const dataset = input.dataset;
  const execution = input.execution;
  const cost = input.cost;

  if (!isFullTradeExecution(executionResult)) {
    return {
      ok: false,
      errors: [makeSafePipelineError({
        code: ERROR.EXECUTION_RESULT_INCOMPLETE,
        stage: STAGE.COST,
      })],
      input: null,
    };
  }

  if (executionResult.entryPrice == null
    || executionResult.exitPrice == null
    || executionResult.entryTradingDate == null
    || executionResult.exitTradingDate == null) {
    return {
      ok: false,
      errors: [makeSafePipelineError({
        code: ERROR.COST_INPUT_DERIVATION_FAILED,
        stage: STAGE.COST,
      })],
      input: null,
    };
  }

  const market = Array.isArray(dataset.markets) ? dataset.markets[0] : null;

  return {
    ok: true,
    errors: [],
    input: {
      calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
      policyEngineVersion: cost.policyEngineVersion,
      market,
      currency: cost.currency,
      brokerChannel: cost.brokerChannel,
      quantity: execution.quantity,
      entryTradingDate: executionResult.entryTradingDate,
      exitTradingDate: executionResult.exitTradingDate,
      entryPrice: executionResult.entryPrice,
      exitPrice: executionResult.exitPrice,
      policies: cost.policies,
    },
  };
}

// GATE 7Z: meta is ids/quantity/market only. Do not put array fields here;
// trailing ...meta would overwrite caller-merged arrays.
// GATE 8A freeze: return keys stay exactly these eight. Do not add keys,
// shorthand, spread, or computed properties.
// GATE 8D freeze: extra-overwrite leftover class 7X-8C is closed. Do not reopen.
function baseResultMeta(input, dataResult) {
  const dataset = input.dataset;
  const calendar = input.calendar;
  return {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    calendarId: (dataResult && dataResult.calendarId) || calendar.calendarId || null,
    calendarVersion: (dataResult && dataResult.calendarVersion) || calendar.calendarVersion || null,
    symbol: Array.isArray(dataset.symbols) ? dataset.symbols[0] : null,
    market: Array.isArray(dataset.markets) ? dataset.markets[0] : null,
    marketContractStatus: pipelineMarketContractStatus(
      Array.isArray(dataset.markets) ? dataset.markets[0] : null,
    ),
    quantity: input.execution.quantity,
  };
}

function runSyntheticSingleTradePipeline(input) {
  const validated = validateSyntheticPipelineInput(input);
  if (!validated.ok) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      dataStageStatus: STAGE_STATUS.NOT_STARTED,
      executionStageStatus: STAGE_STATUS.NOT_STARTED,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      errors: validated.errors,
    });
  }

  const dataResult = dataValidation.validateHistoricalDataset(input.dataset, {
    mode: dataValidation.LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    marketContract: dataValidation.VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
    calendar: input.calendar,
    calendarValidation: input.calendarValidation,
  });

  const meta = baseResultMeta(input, dataResult);
  const dataErrors = mergeSafeStageErrors(STAGE.DATA, dataResult.errors || []);

  if (!isDataStagePassed(dataResult)) {
    const errors = dataErrors.slice();
    errors.push(makeSafePipelineError({
      code: ERROR.DATA_STAGE_FAILED,
      stage: STAGE.DATA,
      datasetId: meta.datasetId,
      datasetVersion: meta.datasetVersion,
      calendarId: meta.calendarId,
      calendarVersion: meta.calendarVersion,
    }));
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_DATA_STAGE,
      failedStage: STAGE.DATA,
      dataStageStatus: STAGE_STATUS.FAILED,
      executionStageStatus: STAGE_STATUS.NOT_STARTED,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      syntheticCalendarVerified: dataResult.syntheticCalendarVerified === true,
      syntheticCandleDatesVerified: dataResult.syntheticCandleDatesVerified === true,
      errors,
      missingData: dataResult.missingData,
      warnings: dataResult.warnings,
      ...meta,
    });
  }

  const dataInvariantErrors = collectDataMarketInvariantErrors(input);
  if (dataInvariantErrors.length > 0) {
    // 6Y: keep invariant root first, then DATA_STAGE_FAILED stage summary.
    const errors = dataInvariantErrors.slice();
    errors.push(makeSafePipelineError({
      code: ERROR.DATA_STAGE_FAILED,
      stage: STAGE.DATA,
      datasetId: meta.datasetId,
      datasetVersion: meta.datasetVersion,
      calendarId: meta.calendarId,
      calendarVersion: meta.calendarVersion,
    }));
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_DATA_STAGE,
      failedStage: STAGE.DATA,
      dataStageStatus: STAGE_STATUS.FAILED,
      executionStageStatus: STAGE_STATUS.NOT_STARTED,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      syntheticCalendarVerified: dataResult.syntheticCalendarVerified === true,
      syntheticCandleDatesVerified: dataResult.syntheticCandleDatesVerified === true,
      errors,
      missingData: dataResult.missingData,
      warnings: dataResult.warnings,
      ...meta,
    });
  }

  const datasetMarket = datasetMarketOf(input);
  const execInput = buildExecutionInput(input, dataResult);
  const execResult = executionModel.evaluateDailyBarExecution(execInput);
  const execErrors = mergeSafeStageErrors(STAGE.EXECUTION, execResult.errors || []);
  const synthDataFlags = {
    syntheticDataValidated: true,
    syntheticCalendarVerified: true,
    syntheticCandleDatesVerified: true,
    ...meta,
    missingData: mergeMissingData([dataResult.missingData, execResult.missingData]),
    warnings: [
      ...(Array.isArray(dataResult.warnings) ? dataResult.warnings : []),
      ...(Array.isArray(execResult.warnings) ? execResult.warnings : []),
    ],
  };

  const execCandlesMatch = Array.isArray(execInput.candles)
    && execInput.candles.every((c) => !isPlainObject(c) || c.market === datasetMarket);
  if (execInput.market !== datasetMarket || execResult.market !== datasetMarket || !execCandlesMatch) {
    const errors = execErrors.slice();
    errors.push(makeSafePipelineError({
      code: ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION,
      stage: STAGE.EXECUTION,
      field: "market",
      market: datasetMarket,
    }));
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE,
      failedStage: STAGE.EXECUTION,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.FAILED,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      syntheticExecutionCalculated: false,
      errors,
      ...synthDataFlags,
    });
  }

  if (isNoEntryExecution(execResult)) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.COMPLETED_NO_ENTRY,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.COMPLETED_NOT_FILLED,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      entryStatus: execResult.entryStatus,
      exitStatus: execResult.exitStatus,
      syntheticExecutionCalculated: true,
      errors: execErrors,
      ...synthDataFlags,
    });
  }

  if (isOpenPositionExecution(execResult)) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.COMPLETED_OPEN_POSITION_NOT_EXECUTED,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.COMPLETED_OPEN_POSITION,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      entryStatus: execResult.entryStatus,
      entryTradingDate: execResult.entryTradingDate,
      entryPrice: execResult.entryPrice,
      entryReason: execResult.entryReason,
      exitStatus: execResult.exitStatus,
      exitTradingDate: null,
      exitPrice: null,
      exitReason: null,
      exitAmount: null,
      exitCommission: null,
      sellTaxTotal: null,
      totalCost: null,
      netProfit: null,
      syntheticExecutionCalculated: true,
      errors: execErrors,
      ...synthDataFlags,
    });
  }

  if (!isFullTradeExecution(execResult)) {
    const errors = execErrors.slice();
    errors.push(makeSafePipelineError({
      code: ERROR.EXECUTION_STAGE_FAILED,
      stage: STAGE.EXECUTION,
      modelVersion: execResult.modelVersion,
      orderType: execResult.orderType,
    }));
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE,
      failedStage: STAGE.EXECUTION,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.FAILED,
      costStageStatus: STAGE_STATUS.NOT_STARTED,
      syntheticExecutionCalculated: false,
      errors,
      ...synthDataFlags,
    });
  }

  const costBuilt = buildCostInput(input, execResult);
  if (!costBuilt.ok || (costBuilt.input && costBuilt.input.market !== datasetMarket)) {
    const errors = costBuilt.ok
      ? [makeSafePipelineError({
        code: ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION,
        stage: STAGE.COST,
        field: "market",
        market: datasetMarket,
      })]
      : mergeSafeStageErrors(STAGE.COST, costBuilt.errors);
    errors.push(makeSafePipelineError({
      code: ERROR.COST_STAGE_FAILED,
      stage: STAGE.COST,
    }));
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_COST_STAGE,
      failedStage: STAGE.COST,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      costStageStatus: STAGE_STATUS.FAILED,
      entryStatus: execResult.entryStatus,
      entryTradingDate: execResult.entryTradingDate,
      entryPrice: execResult.entryPrice,
      entryReason: execResult.entryReason,
      exitStatus: execResult.exitStatus,
      exitTradingDate: execResult.exitTradingDate,
      exitPrice: execResult.exitPrice,
      exitReason: execResult.exitReason,
      syntheticExecutionCalculated: true,
      errors,
      ...synthDataFlags,
    });
  }

  const costResult = costPolicy.calculateSyntheticTradeCost(costBuilt.input);
  const costErrors = mergeSafeStageErrors(STAGE.COST, costResult.errors || []);

  // GATE 8B: blocked cost does not copy leftover amounts. They stay null.
  // GATE 8C freeze: this blocked return stays verbatim. Do not add leftover
  // amount keys.
  // GATE 8D freeze: extra-overwrite leftover class 7X-8C is closed. Do not reopen.
  if (costResult.ok !== true) {
    const errors = costErrors.slice();
    errors.push(makeSafePipelineError({
      code: ERROR.COST_STAGE_FAILED,
      stage: STAGE.COST,
    }));
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_COST_STAGE,
      failedStage: STAGE.COST,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      costStageStatus: STAGE_STATUS.FAILED,
      entryStatus: execResult.entryStatus,
      entryTradingDate: execResult.entryTradingDate,
      entryPrice: execResult.entryPrice,
      entryReason: execResult.entryReason,
      exitStatus: execResult.exitStatus,
      exitTradingDate: execResult.exitTradingDate,
      exitPrice: execResult.exitPrice,
      exitReason: execResult.exitReason,
      syntheticExecutionCalculated: true,
      errors,
      missingData: mergeMissingData([synthDataFlags.missingData, costResult.missingData]),
      warnings: [
        ...synthDataFlags.warnings,
        ...(Array.isArray(costResult.warnings) ? costResult.warnings : []),
      ],
      ...meta,
      syntheticDataValidated: true,
      syntheticCalendarVerified: true,
      syntheticCandleDatesVerified: true,
    });
  }

  return createSyntheticPipelineResult({
    pipelineStatus: PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE,
    dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
    executionStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
    costStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
    entryStatus: execResult.entryStatus,
    entryTradingDate: execResult.entryTradingDate,
    entryPrice: execResult.entryPrice,
    entryReason: execResult.entryReason,
    exitStatus: execResult.exitStatus,
    exitTradingDate: execResult.exitTradingDate,
    exitPrice: execResult.exitPrice,
    exitReason: execResult.exitReason,
    entryAmount: costResult.entryAmount,
    exitAmount: costResult.exitAmount,
    entryCommission: costResult.entryCommission,
    exitCommission: costResult.exitCommission,
    sellTaxTotal: costResult.sellTaxTotal,
    totalCost: costResult.totalCost,
    grossProfit: costResult.grossProfit,
    netProfit: costResult.netProfit,
    syntheticDataValidated: true,
    syntheticCalendarVerified: true,
    syntheticCandleDatesVerified: true,
    syntheticExecutionCalculated: true,
    syntheticCostCalculated: true,
    errors: costErrors,
    missingData: mergeMissingData([synthDataFlags.missingData, costResult.missingData]),
    warnings: [
      ...synthDataFlags.warnings,
      ...(Array.isArray(costResult.warnings) ? costResult.warnings : []),
    ],
    ...meta,
  });
}

// ─── Multi-Trade Pipeline ─────────────────────────────────────────────────────

function runSyntheticMultiTradePipeline(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      errors: [makeSafePipelineError({ code: ERROR.INVALID_INPUT, stage: STAGE.PIPELINE })],
    });
  }

  // unknown top keys
  for (const key of Object.keys(input)) {
    if (!MULTI_TRADE_TOP_KEY_SET.has(key)) {
      errors.push(makeSafePipelineError({ code: ERROR.UNKNOWN_FIELD, field: key, stage: STAGE.PIPELINE }));
    }
  }

  // pipelineVersion 검사
  if (Object.hasOwn(input, "pipelineVersion") && input.pipelineVersion !== MULTI_TRADE_PIPELINE_VERSION) {
    errors.push(makeSafePipelineError({
      code: ERROR.UNSUPPORTED_PIPELINE_VERSION,
      field: "pipelineVersion",
      stage: STAGE.PIPELINE,
    }));
  }

  // calculationMode 검사
  if (Object.hasOwn(input, "calculationMode")) {
    if (input.calculationMode === CALCULATION_MODE.PRODUCTION) {
      errors.push(makeSafePipelineError({
        code: ERROR.SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION,
        field: "calculationMode",
        stage: STAGE.PIPELINE,
      }));
    } else if (input.calculationMode !== CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY) {
      errors.push(makeSafePipelineError({
        code: ERROR.UNSUPPORTED_CALCULATION_MODE,
        field: "calculationMode",
        stage: STAGE.PIPELINE,
      }));
    }
  }

  // 필수 필드
  for (const f of ["pipelineVersion", "calculationMode", "dataset", "calendar", "calendarValidation", "cost", "tradeIntents"]) {
    if (!Object.hasOwn(input, f)) {
      errors.push(makeSafePipelineError({ code: ERROR.MISSING_REQUIRED_FIELD, field: f, stage: STAGE.PIPELINE }));
    }
  }

  if (errors.length > 0) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      errors,
    });
  }

  // market 검사 (dataset)
  const mktErrors = collectDisallowedPipelineMarketErrors(input);
  if (mktErrors.length > 0) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      errors: mktErrors,
    });
  }

  // lifecycle 호출
  const lifecycleInput = {
    dataset: input.dataset,
    calendar: input.calendar,
    calendarValidation: input.calendarValidation,
    cost: input.cost,
    tradeIntents: input.tradeIntents,
    calculationMode: input.calculationMode,
  };
  if (Object.hasOwn(input, "execution")) {
    lifecycleInput.execution = input.execution;
  }

  const lc = multiTradeLifecycle.runSyntheticMultiTradeLifecycle(lifecycleInput);

  const dataset = isPlainObject(input.dataset) ? input.dataset : {};
  const calendar = isPlainObject(input.calendar) ? input.calendar : {};

  const base = {
    datasetId: dataset.datasetId || null,
    datasetVersion: dataset.datasetVersion || null,
    calendarId: calendar.calendarId || null,
    calendarVersion: calendar.calendarVersion || null,
    symbol: Array.isArray(dataset.symbols) ? dataset.symbols[0] : null,
    market: Array.isArray(dataset.markets) ? dataset.markets[0] : null,
    marketContractStatus: Array.isArray(dataset.markets)
      ? pipelineMarketContractStatus(dataset.markets[0])
      : null,
  };

  if (lc.lifecycleStatus === multiTradeLifecycle.LIFECYCLE_STATUS.COMPLETED) {
    // GATE 8W freeze: GATE 8V spread base first so pipelineStatus wins. Do not put base last. portfolio overlay stays first.
    // GATE 8Z freeze: leftover result-overlay class 8V-8Y is closed. Do not reopen. Do not unify with 8U allowlist extra, 8I inbound-spread, or 8D extra-overwrite.
    // GATE 9B freeze: leftover-class audit after 8Z found no remaining leftover drop. Do not reopen 8Z/8U/8I/8D/8C/7W.
    return createSyntheticPipelineResult({
      ...base,
      pipelineStatus: PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      costStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      syntheticDataValidated: true,
      syntheticCalendarVerified: true,
      syntheticCandleDatesVerified: true,
      syntheticExecutionCalculated: true,
      syntheticCostCalculated: true,
      closedTrades: lc.closedTrades,
      multiTradeStatus: lc.multiTradeStatus,
      lifecycleStatus: lc.lifecycleStatus,
      capitalConstraintApplied: false,
      errors: [],
    });
  }

  // BLOCKED 처리
  const lcErrors = Array.isArray(lc.errors) ? lc.errors.map((e) => makeSafePipelineError(e)) : [];
  const failedStage = lc.failedStage || null;
  let pipelineStatus;
  if (failedStage === "DATA") {
    pipelineStatus = PIPELINE_STATUS.BLOCKED_DATA_STAGE;
  } else if (failedStage === "EXECUTION") {
    pipelineStatus = PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE;
  } else if (failedStage === "COST") {
    pipelineStatus = PIPELINE_STATUS.BLOCKED_COST_STAGE;
  } else {
    pipelineStatus = PIPELINE_STATUS.BLOCKED_MULTI_TRADE_LIFECYCLE;
  }

  return createSyntheticPipelineResult({
    ...base,
    pipelineStatus,
    failedStage: failedStage || null,
    dataStageStatus: failedStage === "DATA" ? STAGE_STATUS.FAILED : undefined,
    executionStageStatus: failedStage === "EXECUTION" ? STAGE_STATUS.FAILED : undefined,
    costStageStatus: failedStage === "COST" ? STAGE_STATUS.FAILED : undefined,
    closedTrades: [],
    multiTradeStatus: lc.multiTradeStatus,
    failedTradeId: lc.failedTradeId,
    failedTradeIndex: lc.failedTradeIndex,
    lifecycleStatus: lc.lifecycleStatus,
    capitalConstraintApplied: false,
    errors: lcErrors,
  });
}

// ─── Portfolio Ledger Pipeline ────────────────────────────────────────────────

function runSyntheticPortfolioLedger(input) {
  if (!isPlainObject(input)) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      errors: [makeSafePipelineError({ code: ERROR.INVALID_INPUT, stage: STAGE.PIPELINE })],
    });
  }

  // unknown top keys (PORTFOLIO_LEDGER_TOP_KEY_SET 기준)
  const schemaErrors = [];
  for (const key of Object.keys(input)) {
    if (!PORTFOLIO_LEDGER_TOP_KEY_SET.has(key)) {
      schemaErrors.push(makeSafePipelineError({ code: ERROR.UNKNOWN_FIELD, field: key, stage: STAGE.PIPELINE }));
    }
  }

  // pipelineVersion 검사
  if (Object.hasOwn(input, "pipelineVersion") && input.pipelineVersion !== MULTI_TRADE_PIPELINE_VERSION) {
    schemaErrors.push(makeSafePipelineError({
      code: ERROR.UNSUPPORTED_PIPELINE_VERSION,
      field: "pipelineVersion",
      stage: STAGE.PIPELINE,
    }));
  }

  // calculationMode 검사
  if (Object.hasOwn(input, "calculationMode")) {
    if (input.calculationMode === CALCULATION_MODE.PRODUCTION) {
      schemaErrors.push(makeSafePipelineError({
        code: ERROR.SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION,
        field: "calculationMode",
        stage: STAGE.PIPELINE,
      }));
    } else if (input.calculationMode !== CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY) {
      schemaErrors.push(makeSafePipelineError({
        code: ERROR.UNSUPPORTED_CALCULATION_MODE,
        field: "calculationMode",
        stage: STAGE.PIPELINE,
      }));
    }
  }

  // 필수 필드
  const requiredFields = ["pipelineVersion", "calculationMode", "dataset", "calendar", "calendarValidation", "cost", "tradeIntents", "initialCapital"];
  for (const f of requiredFields) {
    if (!Object.hasOwn(input, f)) {
      schemaErrors.push(makeSafePipelineError({ code: ERROR.MISSING_REQUIRED_FIELD, field: f, stage: STAGE.PIPELINE }));
    }
  }

  if (schemaErrors.length > 0) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      errors: schemaErrors,
    });
  }

  // market 검사
  const mktErrors = collectDisallowedPipelineMarketErrors(input);
  if (mktErrors.length > 0) {
    return createSyntheticPipelineResult({
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA,
      failedStage: STAGE.PIPELINE,
      errors: mktErrors,
    });
  }

  // multi-trade lifecycle 실행
  const lifecycleInput = {
    dataset: input.dataset,
    calendar: input.calendar,
    calendarValidation: input.calendarValidation,
    cost: input.cost,
    tradeIntents: input.tradeIntents,
    calculationMode: input.calculationMode,
  };
  if (Object.hasOwn(input, "execution")) {
    lifecycleInput.execution = input.execution;
  }

  const lc = multiTradeLifecycle.runSyntheticMultiTradeLifecycle(lifecycleInput);

  const dataset = isPlainObject(input.dataset) ? input.dataset : {};
  const calendar = isPlainObject(input.calendar) ? input.calendar : {};
  const base = {
    datasetId: dataset.datasetId || null,
    datasetVersion: dataset.datasetVersion || null,
    calendarId: calendar.calendarId || null,
    calendarVersion: calendar.calendarVersion || null,
    symbol: Array.isArray(dataset.symbols) ? dataset.symbols[0] : null,
    market: Array.isArray(dataset.markets) ? dataset.markets[0] : null,
    marketContractStatus: Array.isArray(dataset.markets)
      ? pipelineMarketContractStatus(dataset.markets[0])
      : null,
  };

  if (lc.lifecycleStatus !== multiTradeLifecycle.LIFECYCLE_STATUS.COMPLETED) {
    // lifecycle 오류 그대로 보존
    const lcErrors = Array.isArray(lc.errors) ? lc.errors.map((e) => makeSafePipelineError(e)) : [];
    const failedStage = lc.failedStage || null;
    let pipelineStatus;
    if (failedStage === "DATA") {
      pipelineStatus = PIPELINE_STATUS.BLOCKED_DATA_STAGE;
    } else if (failedStage === "EXECUTION") {
      pipelineStatus = PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE;
    } else if (failedStage === "COST") {
      pipelineStatus = PIPELINE_STATUS.BLOCKED_COST_STAGE;
    } else {
      pipelineStatus = PIPELINE_STATUS.BLOCKED_MULTI_TRADE_LIFECYCLE;
    }
    return createSyntheticPipelineResult({
      ...base,
      pipelineStatus,
      failedStage: failedStage || null,
      dataStageStatus: failedStage === "DATA" ? STAGE_STATUS.FAILED : undefined,
      executionStageStatus: failedStage === "EXECUTION" ? STAGE_STATUS.FAILED : undefined,
      costStageStatus: failedStage === "COST" ? STAGE_STATUS.FAILED : undefined,
      closedTrades: [],
      multiTradeStatus: lc.multiTradeStatus,
      failedTradeId: lc.failedTradeId,
      failedTradeIndex: lc.failedTradeIndex,
      lifecycleStatus: lc.lifecycleStatus,
      capitalConstraintApplied: false,
      errors: lcErrors,
    });
  }

  // portfolio ledger 실행
  const candles = Array.isArray(dataset.candles) ? dataset.candles : [];
  const ledgerInput = {
    initialCapital: input.initialCapital,
    closedTrades: lc.closedTrades,
    candles,
    calendar: input.calendar,
  };
  const ledgerResult = portfolioLedger.runPortfolioLedger(ledgerInput);

  const ledgerCompleted = ledgerResult.portfolioStatus === portfolioLedger.PORTFOLIO_STATUS.COMPLETED;

  if (!ledgerCompleted) {
    const ledgerErrors = Array.isArray(ledgerResult.errors)
      ? ledgerResult.errors.map((e) => makeSafePipelineError(e))
      : [];
    return {
      ...createSyntheticPipelineResult({
        ...base,
        pipelineStatus: PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER,
        closedTrades: lc.closedTrades,
        multiTradeStatus: lc.multiTradeStatus,
        lifecycleStatus: lc.lifecycleStatus,
        capitalConstraintApplied: false,
        errors: ledgerErrors,
        syntheticDataValidated: true,
        syntheticCalendarVerified: true,
        syntheticCandleDatesVerified: true,
        syntheticExecutionCalculated: true,
        syntheticCostCalculated: true,
      }),
      portfolioStatus: ledgerResult.portfolioStatus,
      finalCash: null,
      finalEquity: null,
      dailyEquityCurve: [],
      ledgerEvents: [],
    };
  }

  return {
    ...createSyntheticPipelineResult({
      ...base,
      pipelineStatus: PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER,
      dataStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      executionStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      costStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
      syntheticDataValidated: true,
      syntheticCalendarVerified: true,
      syntheticCandleDatesVerified: true,
      syntheticExecutionCalculated: true,
      syntheticCostCalculated: true,
      closedTrades: lc.closedTrades,
      multiTradeStatus: lc.multiTradeStatus,
      lifecycleStatus: lc.lifecycleStatus,
      capitalConstraintApplied: true,
      errors: [],
    }),
    // ledger 전용 필드
    portfolioStatus: ledgerResult.portfolioStatus,
    ledgerVersion: ledgerResult.ledgerVersion,
    initialCapital: ledgerResult.initialCapital,
    finalCash: ledgerResult.finalCash,
    finalEquity: ledgerResult.finalEquity,
    realizedPnl: ledgerResult.realizedPnl,
    cumulativeFees: ledgerResult.cumulativeFees,
    cumulativeTaxes: ledgerResult.cumulativeTaxes,
    cumulativeTotalCost: ledgerResult.cumulativeTotalCost,
    ledgerEvents: ledgerResult.ledgerEvents,
    dailyEquityCurve: ledgerResult.dailyEquityCurve,
  };
}

function runSyntheticPerformancePipeline(input) {
  const portfolio = runSyntheticPortfolioLedger(input);
  if (portfolio.pipelineStatus !== PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER) {
    return {
      ...portfolio,
      performanceStatus: "NOT_STARTED",
      performanceStageStatus: STAGE_STATUS.NOT_STARTED,
    };
  }
  const metrics = performanceMetrics.calculatePerformanceMetrics({
    portfolioStatus: portfolio.portfolioStatus,
    initialCapital: portfolio.initialCapital,
    finalEquity: portfolio.finalEquity,
    dailyEquityCurve: portfolio.dailyEquityCurve,
    closedTrades: portfolio.closedTrades,
  });
  if (!metrics.ok) {
    const portfolioErrors = Array.isArray(portfolio.errors)
      ? portfolio.errors.map((e) => makeSafePipelineError(e))
      : [];
    const metricErrors = (Array.isArray(metrics.errors) ? metrics.errors : []).map((e) =>
      makeSafePipelineError({
        ...(isPlainObject(e) ? e : {}),
        stage: STAGE.PERFORMANCE,
      }),
    );
    const errors = [
      ...portfolioErrors,
      ...metricErrors,
      makeSafePipelineError({
        code: ERROR.PERFORMANCE_STAGE_FAILED,
        stage: STAGE.PERFORMANCE,
      }),
    ];
    return {
      ...portfolio,
      pipelineStatus: PIPELINE_STATUS.BLOCKED_PERFORMANCE_STAGE,
      performanceStatus: "BLOCKED",
      performanceStageStatus: STAGE_STATUS.FAILED,
      failedStage: "PERFORMANCE",
      totalReturn: null,
      cagr: null,
      mdd: null,
      winRate: null,
      profitFactor: null,
      sharpeRatio: null,
      benchmarkReturn: null,
      alpha: null,
      errors,
      errorCodes: uniqueCodes(errors),
      calendarVerified: false,
      datasetVerified: false,
      costPolicyVerified: false,
      backtestExecutionEligible: false,
      promotionEligible: false,
      paperEligible: false,
      liveEligible: false,
      capitalConstraintApplied: portfolio.capitalConstraintApplied === true,
    };
  }
  return {
    ...portfolio,
    pipelineStatus: PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS,
    performanceStatus: "COMPLETED_PERFORMANCE_METRICS",
    performanceStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
    totalReturn: metrics.totalReturn,
    cagr: metrics.cagr,
    mdd: metrics.mdd,
    winRate: metrics.winRate,
    profitFactor: metrics.profitFactor,
    sharpeRatio: metrics.sharpeRatio,
    cagrStatus: metrics.cagrStatus,
    winRateStatus: metrics.winRateStatus,
    profitFactorStatus: metrics.profitFactorStatus,
    sharpeStatus: metrics.sharpeStatus,
    mddStatus: metrics.mddStatus,
    totalReturnStatus: metrics.totalReturnStatus,
    periodStart: metrics.periodStart,
    periodEnd: metrics.periodEnd,
    elapsedDays: metrics.elapsedDays,
    years: metrics.years,
    closedTradeCount: metrics.closedTradeCount,
    winCount: metrics.winCount,
    lossCount: metrics.lossCount,
    breakevenCount: metrics.breakevenCount,
    grossProfit: metrics.grossProfit,
    grossLoss: metrics.grossLoss,
    dailyReturnCount: metrics.dailyReturnCount,
    riskFreeRateAssumption: metrics.riskFreeRateAssumption,
    annualizationFactor: metrics.annualizationFactor,
    daysPerYear: metrics.daysPerYear,
    benchmarkReturn: null,
    alpha: null,
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    capitalConstraintApplied: true,
    executionStatus: executionModel.STATUS.NOT_EXECUTED,
    calculationStatus: executionModel.CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
  };
}

function runSyntheticBenchmarkPipeline(input) {
  const performance = runSyntheticPerformancePipeline(input);
  if (
    performance.pipelineStatus !== PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS
    || performance.performanceStatus !== PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS
  ) {
    return {
      ...performance,
      benchmarkStatus: benchmarkPerformance.BENCHMARK_STATUS.NOT_STARTED,
      benchmarkStageStatus: STAGE_STATUS.NOT_STARTED,
      benchmarkReturn: null,
      alpha: null,
      alphaDefinition: benchmarkPerformance.ALPHA_DEFINITION,
    };
  }

  const benchmarkInput = isPlainObject(input) && isPlainObject(input.benchmark)
    ? input.benchmark
    : null;

  if (!benchmarkInput) {
    return {
      ...performance,
      benchmarkStatus: benchmarkPerformance.BENCHMARK_STATUS.NOT_STARTED,
      benchmarkStageStatus: STAGE_STATUS.NOT_STARTED,
      benchmarkReturn: null,
      alpha: null,
      alphaDefinition: benchmarkPerformance.ALPHA_DEFINITION,
    };
  }

  const benchmark = benchmarkPerformance.calculateBenchmarkPerformance({
    performanceStatus: performance.performanceStatus,
    market: performance.market,
    benchmarkMarket: benchmarkInput.market,
    benchmarkSeries: benchmarkInput.benchmarkSeries,
    periodStart: performance.periodStart,
    periodEnd: performance.periodEnd,
    strategyTotalReturn: performance.totalReturn,
  });

  if (!benchmark.ok) {
    const performanceErrors = Array.isArray(performance.errors)
      ? performance.errors.map((e) => makeSafePipelineError(e))
      : [];
    const benchmarkErrors = (Array.isArray(benchmark.errors) ? benchmark.errors : []).map((e) =>
      makeSafePipelineError({
        ...(isPlainObject(e) ? e : {}),
        stage: STAGE.BENCHMARK,
      }),
    );
    const errors = [
      ...performanceErrors,
      ...benchmarkErrors,
      makeSafePipelineError({
        code: ERROR.BENCHMARK_STAGE_FAILED,
        stage: STAGE.BENCHMARK,
      }),
    ];
    return {
      ...performance,
      pipelineStatus: PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE,
      benchmarkStatus: benchmarkPerformance.BENCHMARK_STATUS.BLOCKED,
      benchmarkStageStatus: STAGE_STATUS.FAILED,
      failedStage: STAGE.BENCHMARK,
      benchmarkReturn: null,
      alpha: null,
      alphaDefinition: benchmarkPerformance.ALPHA_DEFINITION,
      errors,
      errorCodes: uniqueCodes(errors),
      calendarVerified: false,
      datasetVerified: false,
      costPolicyVerified: false,
      backtestExecutionEligible: false,
      promotionEligible: false,
      paperEligible: false,
      liveEligible: false,
    };
  }

  return {
    ...performance,
    pipelineStatus: PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA,
    benchmarkStatus: benchmarkPerformance.BENCHMARK_STATUS.COMPLETED,
    benchmarkStageStatus: STAGE_STATUS.PASSED_SYNTHETIC_ONLY,
    benchmarkReturn: benchmark.benchmarkReturn,
    alpha: benchmark.alpha,
    alphaDefinition: benchmark.alphaDefinition,
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
  };
}

module.exports = {
  PIPELINE_VERSION,
  MULTI_TRADE_PIPELINE_VERSION,
  STAGE,
  PIPELINE_STATUS,
  STAGE_STATUS,
  CALCULATION_MODE,
  ERROR,
  validateSyntheticPipelineInput,
  runSyntheticSingleTradePipeline,
  runSyntheticMultiTradePipeline,
  buildExecutionInput,
  buildCostInput,
  mergeSafeStageErrors,
  createSyntheticPipelineResult,
  makeSafePipelineError,
  SAFE_ERROR_KEYS,
  mapCandleForExecution,
  isDataStagePassed,
  isNoEntryExecution,
  isOpenPositionExecution,
  isFullTradeExecution,
  runSyntheticPortfolioLedger,
  runSyntheticPerformancePipeline,
  runSyntheticBenchmarkPipeline,
};
