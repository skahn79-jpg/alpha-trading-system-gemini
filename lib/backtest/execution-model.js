/**
 * GATE 5C 일봉 체결 근사 모델. 순수 CommonJS. I/O 없음.
 * 실제 주문·브로커 연동 없음. 항상 executionStatus=NOT_EXECUTED.
 * 6R: makeSafeExecutionError is a thin adapter onto shared makeBacktestError.
 * 6X: isPlainObject matches calendar/cost/pipeline proto check.
 */

"use strict";

const { parseYmd } = require("./schemas");
const { makeBacktestError } = require("./make-error");

const MODEL_VERSION = "daily-bar-execution-v0.1";

const CALCULATION_MODE = Object.freeze({
  SYNTHETIC_UNIT_TEST_ONLY: "SYNTHETIC_UNIT_TEST_ONLY",
});

const CALCULATION_STATUS = Object.freeze({
  SIMULATED_CALCULATION_ONLY: "SIMULATED_CALCULATION_ONLY",
});

const ENTRY_TIMING = Object.freeze({
  OPEN: "OPEN",
  INTRABAR_UNKNOWN: "INTRABAR_UNKNOWN",
});

const SIDE = Object.freeze({
  LONG: "LONG",
});

const ORDER_TYPE = Object.freeze({
  MARKET_OPEN: "MARKET_OPEN",
  LIMIT_BUY: "LIMIT_BUY",
});

const INTRABAR_CONFLICT_POLICY = Object.freeze({
  STOP_FIRST: "STOP_FIRST",
});

const FIXTURE_TYPE = Object.freeze({
  SYNTHETIC: "SYNTHETIC",
});

const TRADEABILITY_STATUS = Object.freeze({
  SYNTHETIC_TRADABLE: "SYNTHETIC_TRADABLE",
});

const CANDLE_FINALITY = Object.freeze({
  FINAL: "FINAL",
});

const MARKET = Object.freeze({
  SYNTHETIC_MARKET: "SYNTHETIC_MARKET",
  SYNTHETIC_KOSPI: "SYNTHETIC_KOSPI",
  SYNTHETIC_KOSDAQ: "SYNTHETIC_KOSDAQ",
});

const MARKET_CONTRACT_STATUS = Object.freeze({
  LEGACY_SYNTHETIC_MARKET: "LEGACY_SYNTHETIC_MARKET",
  NORMALIZED_SYNTHETIC_MARKET: "NORMALIZED_SYNTHETIC_MARKET",
});

const ALLOWED_EXECUTION_MARKETS = new Set([
  MARKET.SYNTHETIC_MARKET,
  MARKET.SYNTHETIC_KOSPI,
  MARKET.SYNTHETIC_KOSDAQ,
]);

const PRODUCTION_MARKETS = new Set(["KOSPI", "KOSDAQ"]);

const STATUS = Object.freeze({
  NOT_EXECUTED: "NOT_EXECUTED",
  SIMULATED_NOT_EXECUTED: "SIMULATED_NOT_EXECUTED",
  NOT_FILLED: "NOT_FILLED",
  BLOCKED_INVALID_INPUT: "BLOCKED_INVALID_INPUT",
  BLOCKED_SCHEMA: "BLOCKED_SCHEMA",
  BLOCKED_TRADEABILITY_DATA_MISSING: "BLOCKED_TRADEABILITY_DATA_MISSING",
  BLOCKED_SYNTHETIC_MODE_NOT_ALLOWED: "BLOCKED_SYNTHETIC_MODE_NOT_ALLOWED",
  BLOCKED_NO_ELIGIBLE_ENTRY_CANDLE: "BLOCKED_NO_ELIGIBLE_ENTRY_CANDLE",
  BLOCKED_AMBIGUOUS_SEQUENCE: "BLOCKED_AMBIGUOUS_SEQUENCE",
  BLOCKED_UNSUPPORTED: "BLOCKED_UNSUPPORTED",
});

const ENTRY_STATUS = Object.freeze({
  FILLED: "FILLED",
  NOT_FILLED: "NOT_FILLED",
  BLOCKED: "BLOCKED",
});

const EXIT_STATUS = Object.freeze({
  FILLED: "FILLED",
  NOT_TRIGGERED: "NOT_TRIGGERED",
  BLOCKED: "BLOCKED",
});

const ENTRY_REASON = Object.freeze({
  MARKET_OPEN_NEXT_ELIGIBLE_BAR: "MARKET_OPEN_NEXT_ELIGIBLE_BAR",
  LIMIT_BUY_GAP_IMPROVEMENT: "LIMIT_BUY_GAP_IMPROVEMENT",
  LIMIT_BUY_TOUCHED: "LIMIT_BUY_TOUCHED",
});

const EXIT_REASON = Object.freeze({
  STOP_LOSS_GAP: "STOP_LOSS_GAP",
  STOP_LOSS_TOUCHED: "STOP_LOSS_TOUCHED",
  TAKE_PROFIT_GAP_CAPPED: "TAKE_PROFIT_GAP_CAPPED",
  TAKE_PROFIT_TOUCHED: "TAKE_PROFIT_TOUCHED",
  AMBIGUOUS_INTRABAR_STOP_FIRST: "AMBIGUOUS_INTRABAR_STOP_FIRST",
});

const INTRABAR_STATUS = Object.freeze({
  AMBIGUOUS_INTRABAR: "AMBIGUOUS_INTRABAR",
  AMBIGUOUS_ENTRY_EXIT_SEQUENCE: "AMBIGUOUS_ENTRY_EXIT_SEQUENCE",
  RESOLVED_STOP_FIRST: "RESOLVED_STOP_FIRST",
  NONE: "NONE",
});

const MISSING_DATA = Object.freeze({
  CALENDAR_VALIDATION_NOT_IMPLEMENTED: "CALENDAR_VALIDATION_NOT_IMPLEMENTED",
  COST_POLICY_NOT_CONFIGURED: "COST_POLICY_NOT_CONFIGURED",
});

const ERROR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_VOLUME: "INVALID_VOLUME",
  OHLC_INCONSISTENT: "OHLC_INCONSISTENT",
  NON_MONOTONIC_TRADING_DATE: "NON_MONOTONIC_TRADING_DATE",
  DUPLICATE_CANDLE_RECORD: "DUPLICATE_CANDLE_RECORD",
  CANDLE_NOT_FINAL: "CANDLE_NOT_FINAL",
  SAME_DAY_EXECUTION: "SAME_DAY_EXECUTION",
  TRADEABILITY_DATA_MISSING: "TRADEABILITY_DATA_MISSING",
  SYNTHETIC_MODE_NOT_ALLOWED_FOR_PRODUCTION: "SYNTHETIC_MODE_NOT_ALLOWED_FOR_PRODUCTION",
  SYNTHETIC_TRADABLE_NOT_ALLOWED_FOR_PRODUCTION: "SYNTHETIC_TRADABLE_NOT_ALLOWED_FOR_PRODUCTION",
  UNSUPPORTED_MODEL_VERSION: "UNSUPPORTED_MODEL_VERSION",
  UNSUPPORTED_CALCULATION_MODE: "UNSUPPORTED_CALCULATION_MODE",
  UNSUPPORTED_SIDE: "UNSUPPORTED_SIDE",
  UNSUPPORTED_ORDER_TYPE: "UNSUPPORTED_ORDER_TYPE",
  UNSUPPORTED_INTRABAR_CONFLICT_POLICY: "UNSUPPORTED_INTRABAR_CONFLICT_POLICY",
  UNSUPPORTED_FIXTURE_TYPE: "UNSUPPORTED_FIXTURE_TYPE",
  INVALID_EXIT_PRICE_RELATION: "INVALID_EXIT_PRICE_RELATION",
  INVALID_LIMIT_PRICE: "INVALID_LIMIT_PRICE",
  NO_ELIGIBLE_ENTRY_CANDLE: "NO_ELIGIBLE_ENTRY_CANDLE",
  LIMIT_NOT_TOUCHED: "LIMIT_NOT_TOUCHED",
  SCHEMA_NOT_VALID: "SCHEMA_NOT_VALID",
  INVALID_SYMBOL: "INVALID_SYMBOL",
  INVALID_MARKET: "INVALID_MARKET",
  INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
  INVALID_DATE_VALUE: "INVALID_DATE_VALUE",
  INVALID_TRADING_DATE: "INVALID_TRADING_DATE",
  INVALID_TRADING_DATE_YEAR: "INVALID_TRADING_DATE_YEAR",
  PRODUCTION_MARKET_NOT_ALLOWED: "PRODUCTION_MARKET_NOT_ALLOWED",
  MIXED_EXECUTION_MARKETS: "MIXED_EXECUTION_MARKETS",
  EXECUTION_MARKET_MISMATCH: "EXECUTION_MARKET_MISMATCH",
});

const SAFE_ERROR_KEYS = Object.freeze([
  "code",
  "severity",
  "field",
  "recordIndex",
  "symbol",
  "tradingDate",
  "modelVersion",
  "orderType",
  "market",
]);

const TOP_KEYS = Object.freeze([
  "modelVersion",
  "calculationMode",
  "side",
  "entryIntent",
  "exitPolicy",
  "candles",
  "validationState",
  "fixtureMetadata",
  "tradeabilityStatus",
  "market",
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

const VALIDATION_STATE_KEYS = Object.freeze([
  "schemaValid",
  "datasetVerified",
  "backtestDataEligible",
  "backtestExecutionEligible",
]);

const FIXTURE_METADATA_KEYS = Object.freeze([
  "fixtureType",
  "notProductionData",
  "productionEligible",
]);

const CANDLE_KEYS = Object.freeze([
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

const REQUIRED_TOP = Object.freeze([
  "modelVersion",
  "calculationMode",
  "side",
  "entryIntent",
  "exitPolicy",
  "candles",
  "validationState",
  "fixtureMetadata",
  "tradeabilityStatus",
]);

const REQUIRED_ENTRY_INTENT = Object.freeze([
  "orderType",
  "signalTradingDate",
  "earliestExecutionTradingDate",
]);

const REQUIRED_EXIT_POLICY = Object.freeze([
  "stopLossPrice",
  "takeProfitPrice",
  "intrabarConflictPolicy",
]);

const REQUIRED_VALIDATION_STATE = Object.freeze(["schemaValid"]);

const REQUIRED_FIXTURE_METADATA = Object.freeze([
  "fixtureType",
  "notProductionData",
  "productionEligible",
]);

const REQUIRED_CANDLE_FIELDS = Object.freeze([
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

const TOP_KEY_SET = new Set(TOP_KEYS);
const ENTRY_INTENT_KEY_SET = new Set(ENTRY_INTENT_KEYS);
const EXIT_POLICY_KEY_SET = new Set(EXIT_POLICY_KEYS);
const VALIDATION_STATE_KEY_SET = new Set(VALIDATION_STATE_KEYS);
const FIXTURE_METADATA_KEY_SET = new Set(FIXTURE_METADATA_KEYS);
const CANDLE_KEY_SET = new Set(CANDLE_KEYS);

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

function makeSafeExecutionError(raw) {
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

function collectUnknownKeys(obj, allowed, fieldPrefix, extra) {
  const errors = [];
  if (!isPlainObject(obj)) return errors;
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(makeSafeExecutionError({
        code: ERROR.UNKNOWN_FIELD,
        field: fieldPrefix ? `${fieldPrefix}.${key}` : key,
        ...extra,
      }));
    }
  }
  return errors;
}

function requireFields(obj, fields, fieldPrefix, extra) {
  const errors = [];
  for (const field of fields) {
    if (!Object.hasOwn(obj, field)) {
      errors.push(makeSafeExecutionError({
        code: ERROR.MISSING_FIELD,
        field: fieldPrefix ? `${fieldPrefix}.${field}` : field,
        ...extra,
      }));
    }
  }
  return errors;
}

function isValidPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidVolume(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function recordInvalidTradingDate(errors, warnings, parsed, field, loc) {
  errors.push(makeSafeExecutionError({
    code: ERROR.INVALID_TRADING_DATE,
    field,
    ...(loc || {}),
  }));
  if (parsed && parsed.code) {
    warnings.push({
      code: parsed.code,
      field,
      severity: "WARNING",
    });
  }
}

function isAllowedExecutionMarket(market) {
  return ALLOWED_EXECUTION_MARKETS.has(market);
}

function isProductionMarket(market) {
  return PRODUCTION_MARKETS.has(market);
}

function marketContractStatusFor(market) {
  if (market === MARKET.SYNTHETIC_MARKET) {
    return MARKET_CONTRACT_STATUS.LEGACY_SYNTHETIC_MARKET;
  }
  if (market === MARKET.SYNTHETIC_KOSPI || market === MARKET.SYNTHETIC_KOSDAQ) {
    return MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET;
  }
  return null;
}

function classifyExecutionMarket(market) {
  if (typeof market !== "string") return "invalid";
  if (isProductionMarket(market)) return "production";
  if (isAllowedExecutionMarket(market)) return "allowed";
  return "invalid";
}

function defaultMissingData(extra) {
  const set = new Set([
    MISSING_DATA.CALENDAR_VALIDATION_NOT_IMPLEMENTED,
    MISSING_DATA.COST_POLICY_NOT_CONFIGURED,
  ]);
  if (Array.isArray(extra)) {
    for (const item of extra) {
      if (item != null) set.add(item);
    }
  }
  return Array.from(set);
}

function createExecutionResult(partial) {
  const src = isPlainObject(partial) ? partial : {};
  const errors = Array.isArray(src.errors)
    ? src.errors.map((e) => makeSafeExecutionError(e))
    : [];
  const status = src.status != null ? src.status : STATUS.SIMULATED_NOT_EXECUTED;
  return {
    ok: src.ok === true,
    status,
    executionStatus: STATUS.NOT_EXECUTED,
    calculationStatus: CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    entryStatus: src.entryStatus != null ? src.entryStatus : null,
    exitStatus: src.exitStatus != null ? src.exitStatus : null,
    entryPrice: src.entryPrice != null ? src.entryPrice : null,
    exitPrice: src.exitPrice != null ? src.exitPrice : null,
    entryReason: src.entryReason != null ? src.entryReason : null,
    entryTiming: src.entryTiming != null ? src.entryTiming : null,
    exitReason: src.exitReason != null ? src.exitReason : null,
    entryTradingDate: src.entryTradingDate != null ? src.entryTradingDate : null,
    exitTradingDate: src.exitTradingDate != null ? src.exitTradingDate : null,
    entryIndex: Number.isInteger(src.entryIndex) ? src.entryIndex : null,
    exitIndex: Number.isInteger(src.exitIndex) ? src.exitIndex : null,
    orderType: src.orderType != null ? src.orderType : null,
    side: src.side != null ? src.side : null,
    modelVersion: src.modelVersion != null ? src.modelVersion : MODEL_VERSION,
    calculationMode: src.calculationMode != null ? src.calculationMode : null,
    intrabarStatus: src.intrabarStatus != null ? src.intrabarStatus : null,
    intrabarConflictPolicy: src.intrabarConflictPolicy != null ? src.intrabarConflictPolicy : null,
    grossPriceChange: src.grossPriceChange != null ? src.grossPriceChange : null,
    grossReturnRate: src.grossReturnRate != null ? src.grossReturnRate : null,
    costAmount: null,
    taxAmount: null,
    slippageAmount: null,
    netReturn: null,
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
    warnings: Array.isArray(src.warnings) ? src.warnings.slice() : [],
    missingData: defaultMissingData(src.missingData),
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    datasetVerified: false,
    backtestDataEligible: false,
    schemaValid: src.schemaValid === true,
    market: src.market != null ? src.market : null,
    marketContractStatus: src.marketContractStatus != null
      ? src.marketContractStatus
      : marketContractStatusFor(src.market),
  };
}

function blockedResult(errors, extra) {
  const src = extra || {};
  const list = Array.isArray(errors) ? errors : [];
  const codes = uniqueCodes(list);
  let status = src.status;
  if (!status) {
    if (codes.includes(ERROR.TRADEABILITY_DATA_MISSING)) {
      status = STATUS.BLOCKED_TRADEABILITY_DATA_MISSING;
    } else if (
      codes.includes(ERROR.SYNTHETIC_MODE_NOT_ALLOWED_FOR_PRODUCTION)
      || codes.includes(ERROR.SYNTHETIC_TRADABLE_NOT_ALLOWED_FOR_PRODUCTION)
    ) {
      status = STATUS.BLOCKED_SYNTHETIC_MODE_NOT_ALLOWED;
    } else if (codes.includes(ERROR.SCHEMA_NOT_VALID)) {
      status = STATUS.BLOCKED_SCHEMA;
    } else if (codes.includes(ERROR.NO_ELIGIBLE_ENTRY_CANDLE)) {
      status = STATUS.BLOCKED_NO_ELIGIBLE_ENTRY_CANDLE;
    } else if (
      codes.includes(ERROR.UNSUPPORTED_MODEL_VERSION)
      || codes.includes(ERROR.UNSUPPORTED_CALCULATION_MODE)
      || codes.includes(ERROR.UNSUPPORTED_SIDE)
      || codes.includes(ERROR.UNSUPPORTED_ORDER_TYPE)
      || codes.includes(ERROR.UNSUPPORTED_INTRABAR_CONFLICT_POLICY)
      || codes.includes(ERROR.UNSUPPORTED_FIXTURE_TYPE)
    ) {
      status = STATUS.BLOCKED_UNSUPPORTED;
    } else {
      status = STATUS.BLOCKED_INVALID_INPUT;
    }
  }
  return createExecutionResult({
    ok: false,
    status,
    entryStatus: ENTRY_STATUS.BLOCKED,
    exitStatus: EXIT_STATUS.BLOCKED,
    errors: list,
    warnings: src.warnings,
    missingData: src.missingData,
    orderType: src.orderType,
    side: src.side,
    calculationMode: src.calculationMode,
    modelVersion: src.modelVersion,
    schemaValid: src.schemaValid,
    market: src.market,
    marketContractStatus: src.marketContractStatus,
  });
}

function validateExecutionCandle(candle, recordIndex) {
  const errors = [];
  const idx = recordIndex;
  if (!isPlainObject(candle)) {
    errors.push(makeSafeExecutionError({
      code: ERROR.INVALID_INPUT,
      field: "candles",
      recordIndex: idx,
    }));
    return { ok: false, errors };
  }
  errors.push(...collectUnknownKeys(candle, CANDLE_KEY_SET, null, {
    recordIndex: idx,
    symbol: candle.symbol,
    tradingDate: candle.tradingDate,
  }));
  errors.push(...requireFields(candle, REQUIRED_CANDLE_FIELDS, null, {
    recordIndex: idx,
    symbol: candle.symbol,
    tradingDate: candle.tradingDate,
  }));

  const loc = {
    recordIndex: idx,
    symbol: candle.symbol,
    tradingDate: candle.tradingDate,
  };

  if (Object.hasOwn(candle, "symbol")) {
    if (typeof candle.symbol !== "string" || !candle.symbol.startsWith("SYNTH")) {
      errors.push(makeSafeExecutionError({ code: ERROR.INVALID_SYMBOL, field: "symbol", ...loc }));
    }
  }
  if (Object.hasOwn(candle, "market")) {
    const kind = classifyExecutionMarket(candle.market);
    const marketLoc = {
      ...loc,
      ...(typeof candle.market === "string" ? { market: candle.market } : {}),
    };
    if (kind === "production") {
      errors.push(makeSafeExecutionError({
        code: ERROR.PRODUCTION_MARKET_NOT_ALLOWED,
        field: "market",
        ...marketLoc,
      }));
    } else if (kind !== "allowed") {
      errors.push(makeSafeExecutionError({
        code: ERROR.INVALID_MARKET,
        field: "market",
        ...marketLoc,
      }));
    }
  }

  let parsedDate = null;
  if (Object.hasOwn(candle, "tradingDate")) {
    parsedDate = parseYmd(candle.tradingDate);
    if (!parsedDate.ok) {
      recordInvalidTradingDate(errors, [], parsedDate, "tradingDate", loc);
    } else {
      const year = Number(parsedDate.date.slice(0, 4));
      if (year < 2100 || year > 2199) {
        errors.push(makeSafeExecutionError({
          code: ERROR.INVALID_TRADING_DATE_YEAR,
          field: "tradingDate",
          ...loc,
        }));
      }
    }
  }

  const priceFields = ["open", "high", "low", "close"];
  let pricesOk = true;
  for (const field of priceFields) {
    if (!Object.hasOwn(candle, field)) continue;
    if (!isValidPrice(candle[field])) {
      errors.push(makeSafeExecutionError({ code: ERROR.INVALID_PRICE, field, ...loc }));
      pricesOk = false;
    }
  }
  if (
    pricesOk
    && isValidPrice(candle.open)
    && isValidPrice(candle.high)
    && isValidPrice(candle.low)
    && isValidPrice(candle.close)
  ) {
    const { open, high, low, close } = candle;
    if (!(high >= open && high >= close && high >= low && low <= open && low <= close)) {
      errors.push(makeSafeExecutionError({ code: ERROR.OHLC_INCONSISTENT, field: "high", ...loc }));
    }
  }

  if (Object.hasOwn(candle, "volume") && !isValidVolume(candle.volume)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_VOLUME, field: "volume", ...loc }));
  }

  if (Object.hasOwn(candle, "isFinal") || Object.hasOwn(candle, "candleFinality")) {
    if (candle.isFinal !== true || candle.candleFinality !== CANDLE_FINALITY.FINAL) {
      errors.push(makeSafeExecutionError({ code: ERROR.CANDLE_NOT_FINAL, field: "candleFinality", ...loc }));
    }
  }

  return { ok: errors.length === 0, errors, parsedDate: parsedDate && parsedDate.ok ? parsedDate.date : null };
}

function isProductionLikeFixture(fixtureMetadata) {
  if (!isPlainObject(fixtureMetadata)) return false;
  if (fixtureMetadata.productionEligible === true) return true;
  if (fixtureMetadata.notProductionData === false) return true;
  if (Object.hasOwn(fixtureMetadata, "fixtureType") && fixtureMetadata.fixtureType !== FIXTURE_TYPE.SYNTHETIC) {
    return true;
  }
  return false;
}

function validateExecutionInput(input) {
  const errors = [];
  const warnings = [];
  const missingData = [];

  if (!isPlainObject(input)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_INPUT }));
    return { ok: false, errors, warnings, missingData, parsed: null };
  }

  errors.push(...collectUnknownKeys(input, TOP_KEY_SET, null));
  errors.push(...requireFields(input, REQUIRED_TOP, null));

  if (Object.hasOwn(input, "modelVersion") && input.modelVersion !== MODEL_VERSION) {
    errors.push(makeSafeExecutionError({
      code: ERROR.UNSUPPORTED_MODEL_VERSION,
      field: "modelVersion",
      modelVersion: input.modelVersion,
    }));
  }

  if (Object.hasOwn(input, "calculationMode")
    && input.calculationMode !== CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY) {
    errors.push(makeSafeExecutionError({
      code: ERROR.UNSUPPORTED_CALCULATION_MODE,
      field: "calculationMode",
    }));
  }

  if (Object.hasOwn(input, "side") && input.side !== SIDE.LONG) {
    errors.push(makeSafeExecutionError({ code: ERROR.UNSUPPORTED_SIDE, field: "side" }));
  }

  let entryIntent = null;
  if (!Object.hasOwn(input, "entryIntent")) {
    // missing already recorded
  } else if (!isPlainObject(input.entryIntent)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_INPUT, field: "entryIntent" }));
  } else {
    entryIntent = input.entryIntent;
    errors.push(...collectUnknownKeys(entryIntent, ENTRY_INTENT_KEY_SET, "entryIntent"));
    errors.push(...requireFields(entryIntent, REQUIRED_ENTRY_INTENT, "entryIntent"));
    if (Object.hasOwn(entryIntent, "orderType")
      && entryIntent.orderType !== ORDER_TYPE.MARKET_OPEN
      && entryIntent.orderType !== ORDER_TYPE.LIMIT_BUY) {
      errors.push(makeSafeExecutionError({
        code: ERROR.UNSUPPORTED_ORDER_TYPE,
        field: "entryIntent.orderType",
        orderType: entryIntent.orderType,
      }));
    }
    if (entryIntent.orderType === ORDER_TYPE.MARKET_OPEN && Object.hasOwn(entryIntent, "limitPrice")
      && entryIntent.limitPrice !== null) {
      errors.push(makeSafeExecutionError({
        code: ERROR.INVALID_LIMIT_PRICE,
        field: "entryIntent.limitPrice",
        orderType: ORDER_TYPE.MARKET_OPEN,
      }));
    }
    if (entryIntent.orderType === ORDER_TYPE.LIMIT_BUY) {
      if (!Object.hasOwn(entryIntent, "limitPrice")) {
        errors.push(makeSafeExecutionError({
          code: ERROR.MISSING_FIELD,
          field: "entryIntent.limitPrice",
          orderType: ORDER_TYPE.LIMIT_BUY,
        }));
      } else if (!isValidPrice(entryIntent.limitPrice)) {
        errors.push(makeSafeExecutionError({
          code: ERROR.INVALID_PRICE,
          field: "entryIntent.limitPrice",
          orderType: ORDER_TYPE.LIMIT_BUY,
        }));
      }
    }
  }

  let exitPolicy = null;
  if (!Object.hasOwn(input, "exitPolicy")) {
    // missing already recorded
  } else if (!isPlainObject(input.exitPolicy)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_INPUT, field: "exitPolicy" }));
  } else {
    exitPolicy = input.exitPolicy;
    errors.push(...collectUnknownKeys(exitPolicy, EXIT_POLICY_KEY_SET, "exitPolicy"));
    errors.push(...requireFields(exitPolicy, REQUIRED_EXIT_POLICY, "exitPolicy"));
    if (Object.hasOwn(exitPolicy, "intrabarConflictPolicy")
      && exitPolicy.intrabarConflictPolicy !== INTRABAR_CONFLICT_POLICY.STOP_FIRST) {
      errors.push(makeSafeExecutionError({
        code: ERROR.UNSUPPORTED_INTRABAR_CONFLICT_POLICY,
        field: "exitPolicy.intrabarConflictPolicy",
      }));
    }
    if (Object.hasOwn(exitPolicy, "stopLossPrice") && !isValidPrice(exitPolicy.stopLossPrice)) {
      errors.push(makeSafeExecutionError({
        code: ERROR.INVALID_PRICE,
        field: "exitPolicy.stopLossPrice",
      }));
    }
    if (Object.hasOwn(exitPolicy, "takeProfitPrice") && !isValidPrice(exitPolicy.takeProfitPrice)) {
      errors.push(makeSafeExecutionError({
        code: ERROR.INVALID_PRICE,
        field: "exitPolicy.takeProfitPrice",
      }));
    }
  }

  let validationState = null;
  if (!Object.hasOwn(input, "validationState")) {
    // missing
  } else if (!isPlainObject(input.validationState)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_INPUT, field: "validationState" }));
  } else {
    validationState = input.validationState;
    errors.push(...collectUnknownKeys(validationState, VALIDATION_STATE_KEY_SET, "validationState"));
    errors.push(...requireFields(validationState, REQUIRED_VALIDATION_STATE, "validationState"));
    if (Object.hasOwn(validationState, "schemaValid") && validationState.schemaValid !== true) {
      errors.push(makeSafeExecutionError({
        code: ERROR.SCHEMA_NOT_VALID,
        field: "validationState.schemaValid",
      }));
    }
  }

  let fixtureMetadata = null;
  if (!Object.hasOwn(input, "fixtureMetadata")) {
    // missing
  } else if (!isPlainObject(input.fixtureMetadata)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_INPUT, field: "fixtureMetadata" }));
  } else {
    fixtureMetadata = input.fixtureMetadata;
    errors.push(...collectUnknownKeys(fixtureMetadata, FIXTURE_METADATA_KEY_SET, "fixtureMetadata"));
    errors.push(...requireFields(fixtureMetadata, REQUIRED_FIXTURE_METADATA, "fixtureMetadata"));
    if (Object.hasOwn(fixtureMetadata, "fixtureType")
      && fixtureMetadata.fixtureType !== FIXTURE_TYPE.SYNTHETIC
      && fixtureMetadata.fixtureType != null) {
      errors.push(makeSafeExecutionError({
        code: ERROR.UNSUPPORTED_FIXTURE_TYPE,
        field: "fixtureMetadata.fixtureType",
      }));
    }
  }

  const productionLike = isProductionLikeFixture(fixtureMetadata);
  const syntheticMode = input.calculationMode === CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY;
  if (productionLike && syntheticMode) {
    errors.push(makeSafeExecutionError({
      code: ERROR.SYNTHETIC_MODE_NOT_ALLOWED_FOR_PRODUCTION,
      field: "calculationMode",
    }));
  }

  if (!Object.hasOwn(input, "tradeabilityStatus")) {
    // missing already recorded as MISSING_FIELD; also TRADEABILITY_DATA_MISSING
    errors.push(makeSafeExecutionError({
      code: ERROR.TRADEABILITY_DATA_MISSING,
      field: "tradeabilityStatus",
    }));
  } else if (input.tradeabilityStatus !== TRADEABILITY_STATUS.SYNTHETIC_TRADABLE) {
    errors.push(makeSafeExecutionError({
      code: ERROR.TRADEABILITY_DATA_MISSING,
      field: "tradeabilityStatus",
    }));
  } else if (productionLike) {
    errors.push(makeSafeExecutionError({
      code: ERROR.SYNTHETIC_TRADABLE_NOT_ALLOWED_FOR_PRODUCTION,
      field: "tradeabilityStatus",
    }));
  }

  if (!Object.hasOwn(input, "candles")) {
    // missing
  } else if (!Array.isArray(input.candles)) {
    errors.push(makeSafeExecutionError({ code: ERROR.INVALID_INPUT, field: "candles" }));
  }

  let signalDate = null;
  let earliestDate = null;
  if (entryIntent) {
    if (Object.hasOwn(entryIntent, "signalTradingDate")) {
      const parsed = parseYmd(entryIntent.signalTradingDate);
      if (!parsed.ok) {
        recordInvalidTradingDate(
          errors,
          warnings,
          parsed,
          "entryIntent.signalTradingDate",
        );
      } else {
        signalDate = parsed.date;
      }
    }
    if (Object.hasOwn(entryIntent, "earliestExecutionTradingDate")) {
      const parsed = parseYmd(entryIntent.earliestExecutionTradingDate);
      if (!parsed.ok) {
        recordInvalidTradingDate(
          errors,
          warnings,
          parsed,
          "entryIntent.earliestExecutionTradingDate",
        );
      } else {
        earliestDate = parsed.date;
      }
    }
    if (signalDate && earliestDate) {
      if (!(signalDate < earliestDate)) {
        errors.push(makeSafeExecutionError({
          code: ERROR.SAME_DAY_EXECUTION,
          field: "entryIntent.earliestExecutionTradingDate",
          tradingDate: earliestDate,
        }));
      }
    }
  }

  if (
    exitPolicy
    && entryIntent
    && entryIntent.orderType === ORDER_TYPE.LIMIT_BUY
    && isValidPrice(entryIntent.limitPrice)
    && isValidPrice(exitPolicy.stopLossPrice)
    && isValidPrice(exitPolicy.takeProfitPrice)
  ) {
    if (!(exitPolicy.stopLossPrice < entryIntent.limitPrice
      && entryIntent.limitPrice < exitPolicy.takeProfitPrice)) {
      errors.push(makeSafeExecutionError({
        code: ERROR.INVALID_EXIT_PRICE_RELATION,
        field: "exitPolicy",
      }));
    }
  }

  const candles = Array.isArray(input.candles) ? input.candles : null;
  const candleResults = [];
  if (candles) {
    const lastDateBySymbol = new Map();
    const seenPair = new Set();
    for (let i = 0; i < candles.length; i += 1) {
      const checked = validateExecutionCandle(candles[i], i);
      errors.push(...checked.errors);
      candleResults.push(checked);
      const c = candles[i];
      if (!isPlainObject(c) || !checked.parsedDate) continue;
      const pairKey = `${c.symbol}::${checked.parsedDate}`;
      if (seenPair.has(pairKey)) {
        errors.push(makeSafeExecutionError({
          code: ERROR.DUPLICATE_CANDLE_RECORD,
          field: "tradingDate",
          recordIndex: i,
          symbol: c.symbol,
          tradingDate: checked.parsedDate,
        }));
      } else {
        seenPair.add(pairKey);
        const prev = lastDateBySymbol.get(c.symbol);
        if (prev != null && checked.parsedDate < prev) {
          errors.push(makeSafeExecutionError({
            code: ERROR.NON_MONOTONIC_TRADING_DATE,
            field: "tradingDate",
            recordIndex: i,
            symbol: c.symbol,
            tradingDate: checked.parsedDate,
          }));
        }
      }
      lastDateBySymbol.set(c.symbol, checked.parsedDate);
    }
  }

  let resolvedMarket = null;
  let explicitMarket = null;
  if (Object.hasOwn(input, "market")) {
    const kind = classifyExecutionMarket(input.market);
    if (kind === "production") {
      errors.push(makeSafeExecutionError({
        code: ERROR.PRODUCTION_MARKET_NOT_ALLOWED,
        field: "market",
        ...(typeof input.market === "string" ? { market: input.market } : {}),
      }));
    } else if (kind !== "allowed") {
      errors.push(makeSafeExecutionError({
        code: ERROR.INVALID_MARKET,
        field: "market",
        ...(typeof input.market === "string" ? { market: input.market } : {}),
      }));
    } else {
      explicitMarket = input.market;
      resolvedMarket = input.market;
    }
  }

  if (candles) {
    const candleMarkets = [];
    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i];
      if (!isPlainObject(c) || !Object.hasOwn(c, "market")) continue;
      candleMarkets.push(c.market);
    }
    const uniqueMarkets = [];
    const seenMarkets = new Set();
    for (const market of candleMarkets) {
      if (seenMarkets.has(market)) continue;
      seenMarkets.add(market);
      uniqueMarkets.push(market);
    }
    if (uniqueMarkets.length > 1) {
      errors.push(makeSafeExecutionError({
        code: ERROR.MIXED_EXECUTION_MARKETS,
        field: "candles",
      }));
      resolvedMarket = null;
    } else if (uniqueMarkets.length === 1) {
      const candleMarket = uniqueMarkets[0];
      if (isAllowedExecutionMarket(candleMarket)) {
        if (explicitMarket != null && explicitMarket !== candleMarket) {
          errors.push(makeSafeExecutionError({
            code: ERROR.EXECUTION_MARKET_MISMATCH,
            field: "market",
            market: explicitMarket,
          }));
          resolvedMarket = null;
        } else if (explicitMarket == null) {
          resolvedMarket = candleMarket;
        }
      } else {
        resolvedMarket = null;
      }
    }
  }

  const parsed = {
    modelVersion: input.modelVersion,
    calculationMode: input.calculationMode,
    side: input.side,
    entryIntent,
    exitPolicy,
    validationState,
    fixtureMetadata,
    tradeabilityStatus: input.tradeabilityStatus,
    candles,
    signalDate,
    earliestDate,
    schemaValid: validationState && validationState.schemaValid === true,
    market: resolvedMarket,
    marketContractStatus: marketContractStatusFor(resolvedMarket),
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    missingData,
    parsed,
  };
}

function findEligibleEntryCandle(candles, earliestExecutionTradingDate) {
  if (!Array.isArray(candles)) {
    return { ok: false, candle: null, index: -1, code: ERROR.INVALID_INPUT };
  }
  const earliest = parseYmd(earliestExecutionTradingDate);
  if (!earliest.ok) {
    return { ok: false, candle: null, index: -1, code: earliest.code || ERROR.INVALID_DATE_FORMAT };
  }
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (!isPlainObject(c)) continue;
    const parsed = parseYmd(c.tradingDate);
    if (!parsed.ok) continue;
    if (parsed.date >= earliest.date) {
      return { ok: true, candle: c, index: i, code: null };
    }
  }
  return { ok: false, candle: null, index: -1, code: ERROR.NO_ELIGIBLE_ENTRY_CANDLE };
}

function evaluateMarketOpenEntry(candle) {
  if (!isPlainObject(candle)) {
    return {
      filled: false,
      ok: false,
      code: ERROR.INVALID_INPUT,
      entryPrice: null,
      entryReason: null,
      entryTiming: null,
    };
  }
  if (!isValidPrice(candle.open)) {
    return {
      filled: false,
      ok: false,
      code: ERROR.INVALID_PRICE,
      entryPrice: null,
      entryReason: null,
      entryTiming: null,
    };
  }
  return {
    filled: true,
    ok: true,
    code: null,
    entryPrice: candle.open,
    entryReason: ENTRY_REASON.MARKET_OPEN_NEXT_ELIGIBLE_BAR,
    entryTiming: ENTRY_TIMING.OPEN,
  };
}

function evaluateLimitBuyEntry(candle, limitPrice) {
  if (!isValidPrice(limitPrice)) {
    return {
      filled: false,
      ok: false,
      code: ERROR.INVALID_PRICE,
      entryPrice: null,
      entryReason: null,
      entryTiming: null,
    };
  }
  if (!isPlainObject(candle)) {
    return {
      filled: false,
      ok: true,
      code: null,
      entryPrice: null,
      entryReason: null,
      entryTiming: null,
    };
  }
  if (isValidPrice(candle.open) && candle.open <= limitPrice) {
    return {
      filled: true,
      ok: true,
      code: null,
      entryPrice: candle.open,
      entryReason: ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT,
      entryTiming: ENTRY_TIMING.OPEN,
    };
  }
  if (
    isValidPrice(candle.open)
    && candle.open > limitPrice
    && isValidPrice(candle.low)
    && candle.low <= limitPrice
  ) {
    return {
      filled: true,
      ok: true,
      code: null,
      entryPrice: limitPrice,
      entryReason: ENTRY_REASON.LIMIT_BUY_TOUCHED,
      entryTiming: ENTRY_TIMING.INTRABAR_UNKNOWN,
    };
  }
  return {
    filled: false,
    ok: true,
    code: null,
    entryPrice: null,
    entryReason: null,
    entryTiming: null,
  };
}

function resolveIntrabarConflict(input) {
  const src = isPlainObject(input) ? input : {};
  const policy = src.intrabarConflictPolicy;
  if (policy !== INTRABAR_CONFLICT_POLICY.STOP_FIRST) {
    return {
      ok: false,
      code: ERROR.UNSUPPORTED_INTRABAR_CONFLICT_POLICY,
      intrabarStatus: null,
      resolution: null,
      exitPrice: null,
      exitReason: null,
    };
  }
  if (!isValidPrice(src.stopLossPrice) || !isValidPrice(src.takeProfitPrice)) {
    return {
      ok: false,
      code: ERROR.INVALID_PRICE,
      intrabarStatus: INTRABAR_STATUS.AMBIGUOUS_INTRABAR,
      resolution: null,
      exitPrice: null,
      exitReason: null,
    };
  }
  return {
    ok: true,
    code: null,
    intrabarStatus: INTRABAR_STATUS.AMBIGUOUS_INTRABAR,
    resolution: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
    exitPrice: src.stopLossPrice,
    exitReason: EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST,
  };
}

function evaluateLongExit(candle, stopLossPrice, takeProfitPrice, intrabarConflictPolicy) {
  if (!isPlainObject(candle)) {
    return { exited: false, ok: false, code: ERROR.INVALID_INPUT };
  }
  if (!isValidPrice(stopLossPrice) || !isValidPrice(takeProfitPrice)) {
    return { exited: false, ok: false, code: ERROR.INVALID_PRICE };
  }
  if (intrabarConflictPolicy !== INTRABAR_CONFLICT_POLICY.STOP_FIRST) {
    return { exited: false, ok: false, code: ERROR.UNSUPPORTED_INTRABAR_CONFLICT_POLICY };
  }

  const open = candle.open;
  const high = candle.high;
  const low = candle.low;

  if (isValidPrice(open) && open <= stopLossPrice) {
    return {
      exited: true,
      ok: true,
      exitPrice: open,
      exitReason: EXIT_REASON.STOP_LOSS_GAP,
      intrabarStatus: INTRABAR_STATUS.NONE,
    };
  }
  if (isValidPrice(open) && open >= takeProfitPrice) {
    return {
      exited: true,
      ok: true,
      exitPrice: takeProfitPrice,
      exitReason: EXIT_REASON.TAKE_PROFIT_GAP_CAPPED,
      intrabarStatus: INTRABAR_STATUS.NONE,
    };
  }
  const hitSl = isValidPrice(low) && low <= stopLossPrice;
  const hitTp = isValidPrice(high) && high >= takeProfitPrice;
  if (hitSl && hitTp) {
    const resolved = resolveIntrabarConflict({
      candle,
      stopLossPrice,
      takeProfitPrice,
      intrabarConflictPolicy,
    });
    return {
      exited: true,
      ok: resolved.ok,
      exitPrice: resolved.exitPrice,
      exitReason: resolved.exitReason,
      intrabarStatus: resolved.intrabarStatus,
      code: resolved.code,
    };
  }
  if (hitSl) {
    return {
      exited: true,
      ok: true,
      exitPrice: stopLossPrice,
      exitReason: EXIT_REASON.STOP_LOSS_TOUCHED,
      intrabarStatus: INTRABAR_STATUS.NONE,
    };
  }
  if (hitTp) {
    return {
      exited: true,
      ok: true,
      exitPrice: takeProfitPrice,
      exitReason: EXIT_REASON.TAKE_PROFIT_TOUCHED,
      intrabarStatus: INTRABAR_STATUS.NONE,
    };
  }
  return {
    exited: false,
    ok: true,
    exitPrice: null,
    exitReason: null,
    intrabarStatus: INTRABAR_STATUS.NONE,
  };
}

function limitSameBarAmbiguous(candle, stopLossPrice, takeProfitPrice) {
  if (!isPlainObject(candle)) return false;
  const hitSl = isValidPrice(candle.low) && isValidPrice(stopLossPrice) && candle.low <= stopLossPrice;
  const hitTp = isValidPrice(candle.high) && isValidPrice(takeProfitPrice) && candle.high >= takeProfitPrice;
  return hitSl || hitTp;
}

function evaluateDailyBarExecution(input) {
  const validated = validateExecutionInput(input);
  const parsed = validated.parsed || {};
  const context = {
    orderType: parsed.entryIntent && parsed.entryIntent.orderType,
    side: parsed.side,
    calculationMode: parsed.calculationMode,
    modelVersion: parsed.modelVersion,
    schemaValid: parsed.schemaValid === true,
    missingData: validated.missingData,
    market: parsed.market != null ? parsed.market : null,
    marketContractStatus: marketContractStatusFor(parsed.market),
  };

  if (!validated.ok) {
    return blockedResult(validated.errors, context);
  }

  const candles = parsed.candles;
  const entryIntent = parsed.entryIntent;
  const exitPolicy = parsed.exitPolicy;
  const orderType = entryIntent.orderType;
  const sl = exitPolicy.stopLossPrice;
  const tp = exitPolicy.takeProfitPrice;
  const policy = exitPolicy.intrabarConflictPolicy;

  const eligible = findEligibleEntryCandle(candles, parsed.earliestDate);
  if (!eligible.ok) {
    return blockedResult(
      [makeSafeExecutionError({
        code: ERROR.NO_ELIGIBLE_ENTRY_CANDLE,
        field: "candles",
      })],
      { ...context, status: STATUS.BLOCKED_NO_ELIGIBLE_ENTRY_CANDLE },
    );
  }

  let entryIndex = -1;
  let entryCandle = null;
  let entryEval = null;

  if (orderType === ORDER_TYPE.MARKET_OPEN) {
    entryIndex = eligible.index;
    entryCandle = eligible.candle;
    entryEval = evaluateMarketOpenEntry(entryCandle);
    if (!entryEval.filled) {
      return blockedResult(
        [makeSafeExecutionError({
          code: entryEval.code || ERROR.INVALID_PRICE,
          field: "open",
          recordIndex: entryIndex,
          symbol: entryCandle && entryCandle.symbol,
          tradingDate: entryCandle && entryCandle.tradingDate,
          orderType,
        })],
        context,
      );
    }
  } else {
    for (let i = eligible.index; i < candles.length; i += 1) {
      const attempt = evaluateLimitBuyEntry(candles[i], entryIntent.limitPrice);
      if (!attempt.ok) {
        return blockedResult(
          [makeSafeExecutionError({
            code: attempt.code || ERROR.INVALID_PRICE,
            field: "entryIntent.limitPrice",
            recordIndex: i,
            orderType,
          })],
          context,
        );
      }
      if (attempt.filled) {
        entryIndex = i;
        entryCandle = candles[i];
        entryEval = attempt;
        break;
      }
    }
    if (!entryEval || !entryEval.filled) {
      return createExecutionResult({
        ok: true,
        status: STATUS.NOT_FILLED,
        entryStatus: ENTRY_STATUS.NOT_FILLED,
        exitStatus: EXIT_STATUS.NOT_TRIGGERED,
        orderType,
        side: parsed.side,
        calculationMode: parsed.calculationMode,
        schemaValid: true,
        market: context.market,
        marketContractStatus: context.marketContractStatus,
        warnings: [{ code: ERROR.LIMIT_NOT_TOUCHED, severity: "WARNING" }],
      });
    }
  }

  const entryPrice = entryEval.entryPrice;
  if (orderType === ORDER_TYPE.MARKET_OPEN) {
    if (!(sl < entryPrice && entryPrice < tp)) {
      return blockedResult(
        [makeSafeExecutionError({
          code: ERROR.INVALID_EXIT_PRICE_RELATION,
          field: "exitPolicy",
          orderType,
        })],
        context,
      );
    }
  }

  const entryTiming = entryEval.entryTiming;
  if (
    orderType === ORDER_TYPE.LIMIT_BUY
    && entryTiming === ENTRY_TIMING.INTRABAR_UNKNOWN
    && limitSameBarAmbiguous(entryCandle, sl, tp)
  ) {
    return createExecutionResult({
      ok: false,
      status: STATUS.BLOCKED_AMBIGUOUS_SEQUENCE,
      entryStatus: ENTRY_STATUS.FILLED,
      exitStatus: EXIT_STATUS.BLOCKED,
      entryPrice,
      exitPrice: null,
      entryReason: entryEval.entryReason,
      entryTiming,
      exitReason: null,
      entryTradingDate: entryCandle.tradingDate,
      entryIndex,
      orderType,
      side: parsed.side,
      calculationMode: parsed.calculationMode,
      schemaValid: true,
      market: context.market,
      marketContractStatus: context.marketContractStatus,
      intrabarStatus: INTRABAR_STATUS.AMBIGUOUS_ENTRY_EXIT_SEQUENCE,
      intrabarConflictPolicy: policy,
      errors: [makeSafeExecutionError({
        code: "AMBIGUOUS_ENTRY_EXIT_SEQUENCE",
        field: "candles",
        recordIndex: entryIndex,
        symbol: entryCandle.symbol,
        tradingDate: entryCandle.tradingDate,
        orderType,
      })],
    });
  }

  const startExitIndex = entryTiming === ENTRY_TIMING.OPEN
    ? entryIndex
    : entryIndex + 1;
  let exitEval = null;
  let exitIndex = -1;
  let exitCandle = null;
  for (let i = startExitIndex; i < candles.length; i += 1) {
    const attempt = evaluateLongExit(candles[i], sl, tp, policy);
    if (!attempt.ok && attempt.code) {
      return blockedResult(
        [makeSafeExecutionError({
          code: attempt.code,
          recordIndex: i,
          orderType,
        })],
        context,
      );
    }
    if (attempt.exited) {
      exitEval = attempt;
      exitIndex = i;
      exitCandle = candles[i];
      break;
    }
  }

  let grossPriceChange = null;
  let grossReturnRate = null;
  if (exitEval && exitEval.exited && isValidPrice(entryPrice) && isValidPrice(exitEval.exitPrice)) {
    grossPriceChange = exitEval.exitPrice - entryPrice;
    grossReturnRate = grossPriceChange / entryPrice;
  }

  return createExecutionResult({
    ok: true,
    status: STATUS.SIMULATED_NOT_EXECUTED,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: exitEval && exitEval.exited ? EXIT_STATUS.FILLED : EXIT_STATUS.NOT_TRIGGERED,
    entryPrice,
    exitPrice: exitEval && exitEval.exited ? exitEval.exitPrice : null,
    entryReason: entryEval.entryReason,
    entryTiming,
    exitReason: exitEval && exitEval.exited ? exitEval.exitReason : null,
    entryTradingDate: entryCandle.tradingDate,
    exitTradingDate: exitCandle ? exitCandle.tradingDate : null,
    entryIndex,
    exitIndex: exitEval && exitEval.exited ? exitIndex : null,
    orderType,
    side: parsed.side,
    calculationMode: parsed.calculationMode,
    schemaValid: true,
    market: context.market,
    marketContractStatus: context.marketContractStatus,
    intrabarStatus: exitEval && exitEval.exited ? exitEval.intrabarStatus : INTRABAR_STATUS.NONE,
    intrabarConflictPolicy: policy,
    grossPriceChange,
    grossReturnRate,
  });
}

module.exports = {
  evaluateDailyBarExecution,
  validateExecutionInput,
  validateExecutionCandle,
  findEligibleEntryCandle,
  evaluateMarketOpenEntry,
  evaluateLimitBuyEntry,
  evaluateLongExit,
  resolveIntrabarConflict,
  createExecutionResult,
  makeSafeExecutionError,
  SAFE_ERROR_KEYS,
  ERROR,
  STATUS,
  ENTRY_STATUS,
  EXIT_STATUS,
  ENTRY_REASON,
  EXIT_REASON,
  INTRABAR_STATUS,
  INTRABAR_CONFLICT_POLICY,
  MODEL_VERSION,
  CALCULATION_MODE,
  CALCULATION_STATUS,
  ENTRY_TIMING,
  INVALID_TRADING_DATE: ERROR.INVALID_TRADING_DATE,
  ORDER_TYPE,
  SIDE,
  MISSING_DATA,
  FIXTURE_TYPE,
  TRADEABILITY_STATUS,
  CANDLE_FINALITY,
  MARKET,
  MARKET_CONTRACT_STATUS,
};
