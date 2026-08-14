/**
 * 백테스트 스키마·검증. 순수 CommonJS. 외부 I/O 없음.
 */

"use strict";

const INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT";
const INVALID_DATE_VALUE = "INVALID_DATE_VALUE";

const EXECUTION_MODE = Object.freeze({
  HISTORICAL_BACKTEST: "HISTORICAL_BACKTEST",
});

const FILL_MODEL_VERSION = Object.freeze({
  DAILY_BAR_APPROXIMATION: "DAILY_BAR_APPROXIMATION",
});

const ORDER_TYPE = Object.freeze({
  LIMIT: "LIMIT",
});

const SIDE = Object.freeze({
  BUY: "BUY",
  SELL: "SELL",
});

const HORIZON_TYPE = Object.freeze({
  LEGACY_7_CALENDAR_DAYS: "LEGACY_7_CALENDAR_DAYS",
  ULTRA_SHORT: "ULTRA_SHORT",
  SHORT: "SHORT",
  MEDIUM: "MEDIUM",
  LONG: "LONG",
});

const PERFORMANCE_STATUS = Object.freeze({
  NOT_EXECUTED: "NOT_EXECUTED",
  SYNTHETIC_FIXTURE_CALCULATED: "SYNTHETIC_FIXTURE_CALCULATED",
  INVALID_INPUT: "INVALID_INPUT",
  DATA_INSUFFICIENT: "DATA_INSUFFICIENT",
  BLOCKED_COST_POLICY_UNVERIFIED: "BLOCKED_COST_POLICY_UNVERIFIED",
});

const UNIT = Object.freeze({
  RATIO: "RATIO",
  CURRENCY: "CURRENCY",
  COUNT: "COUNT",
});

const INTENT_TYPE = "BacktestIntent";
const RECORD_TYPE_FILL = "SimulatedFill";
const FORMULA_VERSION = "spark-hypothesis-v0.1";
const SYNTHETIC_PERFORMANCE_FIXTURE = "SYNTHETIC_PERFORMANCE_FIXTURE";

const FILL_REASON = Object.freeze({
  LIMIT_FILLED_AT_OPEN: "LIMIT_FILLED_AT_OPEN",
  LIMIT_FILLED_AT_LIMIT: "LIMIT_FILLED_AT_LIMIT",
  STOP_GAP_FILL_AT_OPEN: "STOP_GAP_FILL_AT_OPEN",
});

const INTRABAR_AMBIGUITY = Object.freeze({
  AMBIGUOUS_INTRABAR_STOP_FIRST: "AMBIGUOUS_INTRABAR_STOP_FIRST",
});

const SCHEMA_ERROR = Object.freeze({
  NOT_PLAIN_OBJECT: "NOT_PLAIN_OBJECT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_FIELD: "MISSING_FIELD",
  FORBIDDEN_ACCOUNT_FIELD: "FORBIDDEN_ACCOUNT_FIELD",
  FORBIDDEN_BROKER_FIELD: "FORBIDDEN_BROKER_FIELD",
  MARKET_ORDER_NOT_ALLOWED: "MARKET_ORDER_NOT_ALLOWED",
  INVALID_INTENT_TYPE: "INVALID_INTENT_TYPE",
  INVALID_EXECUTION_MODE: "INVALID_EXECUTION_MODE",
  INVALID_ORDER_TYPE: "INVALID_ORDER_TYPE",
  INVALID_SIDE: "INVALID_SIDE",
  INVALID_HORIZON_TYPE: "INVALID_HORIZON_TYPE",
  INVALID_FORMULA_VERSION: "INVALID_FORMULA_VERSION",
  INVALID_LIMIT_PRICE: "INVALID_LIMIT_PRICE",
  INVALID_ORDER_QUANTITY: "INVALID_ORDER_QUANTITY",
  INVALID_FILL_PRICE: "INVALID_FILL_PRICE",
  INVALID_FILL_QUANTITY: "INVALID_FILL_QUANTITY",
  INVALID_STRING: "INVALID_STRING",
  EMPTY_STRING: "EMPTY_STRING",
  WHITESPACE_NOT_ALLOWED: "WHITESPACE_NOT_ALLOWED",
  INVALID_BOOLEAN: "INVALID_BOOLEAN",
  INVALID_DATE_FORMAT,
  INVALID_DATE_VALUE,
  EXECUTION_ALLOWED_MUST_BE_FALSE: "EXECUTION_ALLOWED_MUST_BE_FALSE",
  NOT_ACTUAL_EXECUTION_MUST_BE_TRUE: "NOT_ACTUAL_EXECUTION_MUST_BE_TRUE",
  FEATURE_DATA_AS_OF_AFTER_SIGNAL: "FEATURE_DATA_AS_OF_AFTER_SIGNAL",
  SIGNAL_DATE_NOT_BEFORE_EXECUTION: "SIGNAL_DATE_NOT_BEFORE_EXECUTION",
  SIGNAL_CREATED_AT_NOT_BEFORE_EXECUTION: "SIGNAL_CREATED_AT_NOT_BEFORE_EXECUTION",
  INVALID_FILL_MODEL_VERSION: "INVALID_FILL_MODEL_VERSION",
  INVALID_RECORD_TYPE: "INVALID_RECORD_TYPE",
  INVALID_FILL_REASON: "INVALID_FILL_REASON",
  INVALID_INTRABAR_AMBIGUITY: "INVALID_INTRABAR_AMBIGUITY",
  ACCOUNT_ID_MUST_BE_NULL: "ACCOUNT_ID_MUST_BE_NULL",
  BROKER_ORDER_ID_MUST_BE_NULL: "BROKER_ORDER_ID_MUST_BE_NULL",
});

const INTENT_FIELDS = Object.freeze([
  "intentId",
  "intentType",
  "executionMode",
  "strategyId",
  "strategyVersion",
  "formulaVersion",
  "horizonType",
  "symbol",
  "market",
  "side",
  "orderType",
  "limitPrice",
  "orderQuantity",
  "signalTradingDate",
  "signalCreatedAt",
  "featureDataAsOf",
  "earliestExecutionTradingDate",
  "executionAllowed",
  "notActualExecution",
]);

const FILL_FIELDS = Object.freeze([
  "fillId",
  "intentId",
  "recordType",
  "executionMode",
  "fillModelVersion",
  "executionTradingDate",
  "fillPrice",
  "fillQuantity",
  "fillReason",
  "intrabarAmbiguity",
  "notActualExecution",
  "brokerOrderId",
  "accountId",
]);

const INTENT_FIELD_SET = new Set(INTENT_FIELDS);
const FILL_FIELD_SET = new Set(FILL_FIELDS);
const HORIZON_VALUES = new Set(Object.values(HORIZON_TYPE));
const SIDE_VALUES = new Set(Object.values(SIDE));
const FILL_REASON_VALUES = new Set(Object.values(FILL_REASON));

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/;

const PERFORMANCE_METRIC_KEYS = Object.freeze([
  "totalReturn",
  "cagr",
  "mdd",
  "winRate",
  "profitToLossRatio",
  "profitFactor",
  "expectedValue",
]);

const PERFORMANCE_METRIC_UNITS = Object.freeze({
  totalReturn: UNIT.RATIO,
  cagr: UNIT.RATIO,
  mdd: UNIT.RATIO,
  winRate: UNIT.RATIO,
  profitToLossRatio: UNIT.RATIO,
  profitFactor: UNIT.RATIO,
  expectedValue: UNIT.CURRENCY,
});

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidUtcCivilDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year
    && dt.getUTCMonth() === month - 1
    && dt.getUTCDate() === day;
}

function parseYmd(input) {
  if (typeof input !== "string") {
    return { ok: false, date: null, code: INVALID_DATE_FORMAT };
  }
  if (!YMD_RE.test(input)) {
    return { ok: false, date: null, code: INVALID_DATE_FORMAT };
  }
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  if (!isValidUtcCivilDate(year, month, day)) {
    return { ok: false, date: null, code: INVALID_DATE_VALUE };
  }
  return { ok: true, date: `${year}-${pad2(month)}-${pad2(day)}`, code: null };
}

function parseKstDateTime(input) {
  if (typeof input !== "string") {
    return { ok: false, ms: null, code: INVALID_DATE_FORMAT };
  }
  const matched = KST_DATETIME_RE.exec(input);
  if (!matched) {
    return { ok: false, ms: null, code: INVALID_DATE_FORMAT };
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  if (!isValidUtcCivilDate(year, month, day)) {
    return { ok: false, ms: null, code: INVALID_DATE_VALUE };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, ms: null, code: INVALID_DATE_VALUE };
  }
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) {
    return { ok: false, ms: null, code: INVALID_DATE_VALUE };
  }
  return { ok: true, ms, code: null };
}

function resultOk(fields) {
  return { ok: true, status: null, errors: [], fields: [...fields] };
}

function resultFail(errors) {
  const list = errors.length > 0 ? errors : [{ code: PERFORMANCE_STATUS.INVALID_INPUT, field: null }];
  return { ok: false, status: list[0].code, errors: list };
}

function pushError(errors, code, field) {
  errors.push({ code, field });
}

function checkRequiredString(value, field, errors) {
  if (typeof value !== "string") {
    pushError(errors, SCHEMA_ERROR.INVALID_STRING, field);
    return false;
  }
  if (value.length === 0) {
    pushError(errors, SCHEMA_ERROR.EMPTY_STRING, field);
    return false;
  }
  if (value.trim() !== value) {
    pushError(errors, SCHEMA_ERROR.WHITESPACE_NOT_ALLOWED, field);
    return false;
  }
  return true;
}

function checkOwnKeys(input, allowed, errors, forbiddenAccount) {
  for (const key of Object.keys(input)) {
    if (forbiddenAccount && key === "accountId") {
      pushError(errors, SCHEMA_ERROR.FORBIDDEN_ACCOUNT_FIELD, "accountId");
      continue;
    }
    if (forbiddenAccount && key === "brokerOrderId") {
      pushError(errors, SCHEMA_ERROR.FORBIDDEN_BROKER_FIELD, "brokerOrderId");
      continue;
    }
    if (!allowed.has(key)) {
      pushError(errors, SCHEMA_ERROR.UNKNOWN_FIELD, key);
    }
  }
}

function requireOwn(input, field, errors) {
  if (!Object.hasOwn(input, field)) {
    pushError(errors, SCHEMA_ERROR.MISSING_FIELD, field);
    return false;
  }
  return true;
}

function checkPositiveFiniteNumber(value, field, errors, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    pushError(errors, code, field);
    return false;
  }
  return true;
}

function checkPositiveInteger(value, field, errors, code) {
  if (typeof value !== "number" || !Number.isInteger(value) || !(value > 0)) {
    pushError(errors, code, field);
    return false;
  }
  return true;
}

function checkNotActualExecutionTrue(value, field, errors) {
  if (typeof value !== "boolean") {
    pushError(errors, SCHEMA_ERROR.INVALID_BOOLEAN, field);
    return false;
  }
  if (value !== true) {
    pushError(errors, SCHEMA_ERROR.NOT_ACTUAL_EXECUTION_MUST_BE_TRUE, field);
    return false;
  }
  return true;
}

function checkExecutionMode(value, field, errors) {
  if (!checkRequiredString(value, field, errors)) return false;
  if (value !== EXECUTION_MODE.HISTORICAL_BACKTEST) {
    pushError(errors, SCHEMA_ERROR.INVALID_EXECUTION_MODE, field);
    return false;
  }
  return true;
}

function throwOnInvalid(result) {
  if (result.ok) return result;
  const first = result.errors[0];
  const err = new Error(first.code);
  err.code = first.code;
  throw err;
}

function validateBacktestIntent(input) {
  if (!isPlainObject(input)) {
    return resultFail([{ code: SCHEMA_ERROR.NOT_PLAIN_OBJECT, field: null }]);
  }

  const errors = [];
  checkOwnKeys(input, INTENT_FIELD_SET, errors, true);

  for (const field of INTENT_FIELDS) {
    requireOwn(input, field, errors);
  }

  if (Object.hasOwn(input, "intentId")) {
    checkRequiredString(input.intentId, "intentId", errors);
  }
  if (Object.hasOwn(input, "intentType")) {
    if (checkRequiredString(input.intentType, "intentType", errors) && input.intentType !== INTENT_TYPE) {
      pushError(errors, SCHEMA_ERROR.INVALID_INTENT_TYPE, "intentType");
    }
  }
  if (Object.hasOwn(input, "executionMode")) {
    checkExecutionMode(input.executionMode, "executionMode", errors);
  }
  if (Object.hasOwn(input, "strategyId")) {
    checkRequiredString(input.strategyId, "strategyId", errors);
  }
  if (Object.hasOwn(input, "strategyVersion")) {
    checkRequiredString(input.strategyVersion, "strategyVersion", errors);
  }
  if (Object.hasOwn(input, "formulaVersion")) {
    if (checkRequiredString(input.formulaVersion, "formulaVersion", errors)
      && input.formulaVersion !== FORMULA_VERSION) {
      pushError(errors, SCHEMA_ERROR.INVALID_FORMULA_VERSION, "formulaVersion");
    }
  }
  if (Object.hasOwn(input, "horizonType")) {
    if (checkRequiredString(input.horizonType, "horizonType", errors)
      && !HORIZON_VALUES.has(input.horizonType)) {
      pushError(errors, SCHEMA_ERROR.INVALID_HORIZON_TYPE, "horizonType");
    }
  }
  if (Object.hasOwn(input, "symbol")) {
    checkRequiredString(input.symbol, "symbol", errors);
  }
  if (Object.hasOwn(input, "market")) {
    checkRequiredString(input.market, "market", errors);
  }
  if (Object.hasOwn(input, "side")) {
    if (checkRequiredString(input.side, "side", errors) && !SIDE_VALUES.has(input.side)) {
      pushError(errors, SCHEMA_ERROR.INVALID_SIDE, "side");
    }
  }
  if (Object.hasOwn(input, "orderType")) {
    if (checkRequiredString(input.orderType, "orderType", errors)) {
      if (input.orderType.toUpperCase() === "MARKET") {
        pushError(errors, SCHEMA_ERROR.MARKET_ORDER_NOT_ALLOWED, "orderType");
      } else if (input.orderType !== ORDER_TYPE.LIMIT) {
        pushError(errors, SCHEMA_ERROR.INVALID_ORDER_TYPE, "orderType");
      }
    }
  }
  if (Object.hasOwn(input, "limitPrice")) {
    checkPositiveFiniteNumber(
      input.limitPrice,
      "limitPrice",
      errors,
      SCHEMA_ERROR.INVALID_LIMIT_PRICE,
    );
  }
  if (Object.hasOwn(input, "orderQuantity")) {
    checkPositiveInteger(
      input.orderQuantity,
      "orderQuantity",
      errors,
      SCHEMA_ERROR.INVALID_ORDER_QUANTITY,
    );
  }

  let signalDate = null;
  let executionDate = null;
  if (Object.hasOwn(input, "signalTradingDate")) {
    if (checkRequiredString(input.signalTradingDate, "signalTradingDate", errors)) {
      const parsed = parseYmd(input.signalTradingDate);
      if (!parsed.ok) {
        pushError(errors, parsed.code, "signalTradingDate");
      } else {
        signalDate = parsed.date;
      }
    }
  }
  if (Object.hasOwn(input, "earliestExecutionTradingDate")) {
    if (checkRequiredString(input.earliestExecutionTradingDate, "earliestExecutionTradingDate", errors)) {
      const parsed = parseYmd(input.earliestExecutionTradingDate);
      if (!parsed.ok) {
        pushError(errors, parsed.code, "earliestExecutionTradingDate");
      } else {
        executionDate = parsed.date;
      }
    }
  }

  let createdMs = null;
  if (Object.hasOwn(input, "signalCreatedAt")) {
    if (checkRequiredString(input.signalCreatedAt, "signalCreatedAt", errors)) {
      const parsed = parseKstDateTime(input.signalCreatedAt);
      if (!parsed.ok) {
        pushError(errors, parsed.code, "signalCreatedAt");
      } else {
        createdMs = parsed.ms;
      }
    }
  }
  let featureMs = null;
  if (Object.hasOwn(input, "featureDataAsOf")) {
    if (checkRequiredString(input.featureDataAsOf, "featureDataAsOf", errors)) {
      const parsed = parseKstDateTime(input.featureDataAsOf);
      if (!parsed.ok) {
        pushError(errors, parsed.code, "featureDataAsOf");
      } else {
        featureMs = parsed.ms;
      }
    }
  }

  if (Object.hasOwn(input, "executionAllowed")) {
    if (typeof input.executionAllowed !== "boolean") {
      pushError(errors, SCHEMA_ERROR.INVALID_BOOLEAN, "executionAllowed");
    } else if (input.executionAllowed !== false) {
      pushError(errors, SCHEMA_ERROR.EXECUTION_ALLOWED_MUST_BE_FALSE, "executionAllowed");
    }
  }
  if (Object.hasOwn(input, "notActualExecution")) {
    checkNotActualExecutionTrue(input.notActualExecution, "notActualExecution", errors);
  }

  if (signalDate != null && executionDate != null && !(signalDate < executionDate)) {
    pushError(errors, SCHEMA_ERROR.SIGNAL_DATE_NOT_BEFORE_EXECUTION, "signalTradingDate");
  }
  if (featureMs != null && createdMs != null && featureMs > createdMs) {
    pushError(errors, SCHEMA_ERROR.FEATURE_DATA_AS_OF_AFTER_SIGNAL, "featureDataAsOf");
  }
  if (createdMs != null && executionDate != null) {
    const sessionStartMs = Date.parse(`${executionDate}T00:00:00+09:00`);
    if (!Number.isFinite(sessionStartMs) || !(createdMs < sessionStartMs)) {
      pushError(errors, SCHEMA_ERROR.SIGNAL_CREATED_AT_NOT_BEFORE_EXECUTION, "signalCreatedAt");
    }
  }

  if (errors.length > 0) return resultFail(errors);
  return resultOk(INTENT_FIELDS);
}

function assertBacktestIntent(input) {
  return throwOnInvalid(validateBacktestIntent(input));
}

function validateSimulatedFill(input) {
  if (!isPlainObject(input)) {
    return resultFail([{ code: SCHEMA_ERROR.NOT_PLAIN_OBJECT, field: null }]);
  }

  const errors = [];
  checkOwnKeys(input, FILL_FIELD_SET, errors, false);

  for (const field of FILL_FIELDS) {
    requireOwn(input, field, errors);
  }

  if (Object.hasOwn(input, "fillId")) {
    checkRequiredString(input.fillId, "fillId", errors);
  }
  if (Object.hasOwn(input, "intentId")) {
    checkRequiredString(input.intentId, "intentId", errors);
  }
  if (Object.hasOwn(input, "recordType")) {
    if (checkRequiredString(input.recordType, "recordType", errors)
      && input.recordType !== RECORD_TYPE_FILL) {
      pushError(errors, SCHEMA_ERROR.INVALID_RECORD_TYPE, "recordType");
    }
  }
  if (Object.hasOwn(input, "executionMode")) {
    checkExecutionMode(input.executionMode, "executionMode", errors);
  }
  if (Object.hasOwn(input, "fillModelVersion")) {
    if (checkRequiredString(input.fillModelVersion, "fillModelVersion", errors)
      && input.fillModelVersion !== FILL_MODEL_VERSION.DAILY_BAR_APPROXIMATION) {
      pushError(errors, SCHEMA_ERROR.INVALID_FILL_MODEL_VERSION, "fillModelVersion");
    }
  }
  if (Object.hasOwn(input, "executionTradingDate")) {
    if (checkRequiredString(input.executionTradingDate, "executionTradingDate", errors)) {
      const parsed = parseYmd(input.executionTradingDate);
      if (!parsed.ok) {
        pushError(errors, parsed.code, "executionTradingDate");
      }
    }
  }
  if (Object.hasOwn(input, "fillPrice")) {
    checkPositiveFiniteNumber(input.fillPrice, "fillPrice", errors, SCHEMA_ERROR.INVALID_FILL_PRICE);
  }
  if (Object.hasOwn(input, "fillQuantity")) {
    checkPositiveInteger(
      input.fillQuantity,
      "fillQuantity",
      errors,
      SCHEMA_ERROR.INVALID_FILL_QUANTITY,
    );
  }
  if (Object.hasOwn(input, "fillReason")) {
    if (checkRequiredString(input.fillReason, "fillReason", errors)
      && !FILL_REASON_VALUES.has(input.fillReason)) {
      pushError(errors, SCHEMA_ERROR.INVALID_FILL_REASON, "fillReason");
    }
  }
  if (Object.hasOwn(input, "intrabarAmbiguity")) {
    const amb = input.intrabarAmbiguity;
    if (amb !== null && amb !== INTRABAR_AMBIGUITY.AMBIGUOUS_INTRABAR_STOP_FIRST) {
      pushError(errors, SCHEMA_ERROR.INVALID_INTRABAR_AMBIGUITY, "intrabarAmbiguity");
    }
  }
  if (Object.hasOwn(input, "notActualExecution")) {
    checkNotActualExecutionTrue(input.notActualExecution, "notActualExecution", errors);
  }
  if (Object.hasOwn(input, "accountId") && input.accountId !== null) {
    pushError(errors, SCHEMA_ERROR.ACCOUNT_ID_MUST_BE_NULL, "accountId");
  }
  if (Object.hasOwn(input, "brokerOrderId") && input.brokerOrderId !== null) {
    pushError(errors, SCHEMA_ERROR.BROKER_ORDER_ID_MUST_BE_NULL, "brokerOrderId");
  }

  if (errors.length > 0) return resultFail(errors);
  return resultOk(FILL_FIELDS);
}

function assertSimulatedFill(input) {
  return throwOnInvalid(validateSimulatedFill(input));
}

function notExecutedMetric(unit) {
  return {
    value: null,
    status: PERFORMANCE_STATUS.NOT_EXECUTED,
    unit,
    missingData: [],
    warnings: [],
    fixtureTag: null,
    notActualPerformance: true,
    promotionEligible: false,
  };
}

function createNotExecutedPerformanceResult() {
  const metrics = {};
  for (const key of PERFORMANCE_METRIC_KEYS) {
    metrics[key] = notExecutedMetric(PERFORMANCE_METRIC_UNITS[key]);
  }
  return {
    ...metrics,
    executionStatus: PERFORMANCE_STATUS.NOT_EXECUTED,
    backtestExecutionEligible: false,
    notActualPerformance: true,
    promotionEligible: false,
    fixtureTag: null,
  };
}

module.exports = {
  EXECUTION_MODE,
  FILL_MODEL_VERSION,
  ORDER_TYPE,
  SIDE,
  HORIZON_TYPE,
  PERFORMANCE_STATUS,
  UNIT,
  INTENT_TYPE,
  RECORD_TYPE_FILL,
  FORMULA_VERSION,
  SYNTHETIC_PERFORMANCE_FIXTURE,
  FILL_REASON,
  INTRABAR_AMBIGUITY,
  SCHEMA_ERROR,
  INTENT_FIELDS,
  FILL_FIELDS,
  INVALID_DATE_FORMAT,
  INVALID_DATE_VALUE,
  isValidUtcCivilDate,
  parseYmd,
  parseKstDateTime,
  validateBacktestIntent,
  assertBacktestIntent,
  validateSimulatedFill,
  assertSimulatedFill,
  createNotExecutedPerformanceResult,
};
