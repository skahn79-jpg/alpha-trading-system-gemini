"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EXECUTION_MODE,
  FILL_MODEL_VERSION,
  ORDER_TYPE,
  HORIZON_TYPE,
  PERFORMANCE_STATUS,
  UNIT,
  INTENT_TYPE,
  RECORD_TYPE_FILL,
  FORMULA_VERSION,
  FILL_REASON,
  INTRABAR_AMBIGUITY,
  SCHEMA_ERROR,
  INTENT_FIELDS,
  FILL_FIELDS,
  parseYmd,
  parseKstDateTime,
  isValidUtcCivilDate,
  validateBacktestIntent,
  assertBacktestIntent,
  validateSimulatedFill,
  assertSimulatedFill,
  createNotExecutedPerformanceResult,
} = require("../lib/backtest/schemas");

function validIntent(overrides) {
  return {
    intentId: "bt_intent_synthetic_001",
    intentType: INTENT_TYPE,
    executionMode: EXECUTION_MODE.HISTORICAL_BACKTEST,
    strategyId: "synthetic-strategy",
    strategyVersion: "0.0.0-test",
    formulaVersion: FORMULA_VERSION,
    horizonType: HORIZON_TYPE.SHORT,
    symbol: "SYNTH001",
    market: "SYNTHETIC_MARKET",
    side: "BUY",
    orderType: ORDER_TYPE.LIMIT,
    limitPrice: 100,
    orderQuantity: 10,
    signalTradingDate: "2100-01-04",
    signalCreatedAt: "2100-01-04T15:40:00+09:00",
    featureDataAsOf: "2100-01-04T15:40:00+09:00",
    earliestExecutionTradingDate: "2100-01-05",
    executionAllowed: false,
    notActualExecution: true,
    ...overrides,
  };
}

function validFill(overrides) {
  return {
    fillId: "bt_fill_synthetic_001",
    intentId: "bt_intent_synthetic_001",
    recordType: RECORD_TYPE_FILL,
    executionMode: EXECUTION_MODE.HISTORICAL_BACKTEST,
    fillModelVersion: FILL_MODEL_VERSION.DAILY_BAR_APPROXIMATION,
    executionTradingDate: "2100-01-05",
    fillPrice: 99,
    fillQuantity: 10,
    fillReason: FILL_REASON.LIMIT_FILLED_AT_OPEN,
    intrabarAmbiguity: null,
    notActualExecution: true,
    brokerOrderId: null,
    accountId: null,
    ...overrides,
  };
}

function hasError(result, code, field) {
  assert.equal(result.ok, false);
  const found = result.errors.find((err) => err.code === code && (field == null || err.field === field));
  assert.ok(found, `expected ${code}${field ? ` on ${field}` : ""}`);
}

test("정상 BacktestIntent", () => {
  const result = validateBacktestIntent(validIntent());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.fields, [...INTENT_FIELDS]);
  assert.equal(result.intentId, undefined);
  assert.equal(assertBacktestIntent(validIntent()).ok, true);
});

test("executionAllowed=true 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ executionAllowed: true })),
    SCHEMA_ERROR.EXECUTION_ALLOWED_MUST_BE_FALSE,
    "executionAllowed",
  );
});

test("notActualExecution=false 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ notActualExecution: false })),
    SCHEMA_ERROR.NOT_ACTUAL_EXECUTION_MUST_BE_TRUE,
    "notActualExecution",
  );
});

test("MARKET 주문 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ orderType: "MARKET" })),
    SCHEMA_ERROR.MARKET_ORDER_NOT_ALLOWED,
    "orderType",
  );
  hasError(
    validateBacktestIntent(validIntent({ orderType: "market" })),
    SCHEMA_ERROR.MARKET_ORDER_NOT_ALLOWED,
    "orderType",
  );
});

test("가격 0·음수·NaN·Infinity 거부", () => {
  hasError(validateBacktestIntent(validIntent({ limitPrice: 0 })), SCHEMA_ERROR.INVALID_LIMIT_PRICE, "limitPrice");
  hasError(validateBacktestIntent(validIntent({ limitPrice: -1 })), SCHEMA_ERROR.INVALID_LIMIT_PRICE, "limitPrice");
  hasError(validateBacktestIntent(validIntent({ limitPrice: NaN })), SCHEMA_ERROR.INVALID_LIMIT_PRICE, "limitPrice");
  hasError(
    validateBacktestIntent(validIntent({ limitPrice: Infinity })),
    SCHEMA_ERROR.INVALID_LIMIT_PRICE,
    "limitPrice",
  );
});

test("문자열 가격 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ limitPrice: "100" })),
    SCHEMA_ERROR.INVALID_LIMIT_PRICE,
    "limitPrice",
  );
});

test("수량 0·음수·소수 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ orderQuantity: 0 })),
    SCHEMA_ERROR.INVALID_ORDER_QUANTITY,
    "orderQuantity",
  );
  hasError(
    validateBacktestIntent(validIntent({ orderQuantity: -3 })),
    SCHEMA_ERROR.INVALID_ORDER_QUANTITY,
    "orderQuantity",
  );
  hasError(
    validateBacktestIntent(validIntent({ orderQuantity: 1.5 })),
    SCHEMA_ERROR.INVALID_ORDER_QUANTITY,
    "orderQuantity",
  );
});

test("날짜 역전 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({
      signalTradingDate: "2100-01-05",
      earliestExecutionTradingDate: "2100-01-05",
    })),
    SCHEMA_ERROR.SIGNAL_DATE_NOT_BEFORE_EXECUTION,
    "signalTradingDate",
  );
  hasError(
    validateBacktestIntent(validIntent({
      signalTradingDate: "2100-01-06",
      earliestExecutionTradingDate: "2100-01-05",
    })),
    SCHEMA_ERROR.SIGNAL_DATE_NOT_BEFORE_EXECUTION,
    "signalTradingDate",
  );
  hasError(
    validateBacktestIntent(validIntent({
      signalCreatedAt: "2100-01-05T00:00:00+09:00",
    })),
    SCHEMA_ERROR.SIGNAL_CREATED_AT_NOT_BEFORE_EXECUTION,
    "signalCreatedAt",
  );
});

test("featureDataAsOf가 signalCreatedAt보다 늦으면 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({
      featureDataAsOf: "2100-01-04T16:00:00+09:00",
      signalCreatedAt: "2100-01-04T15:40:00+09:00",
    })),
    SCHEMA_ERROR.FEATURE_DATA_AS_OF_AFTER_SIGNAL,
    "featureDataAsOf",
  );
});

test("실제 계좌·브로커 필드 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ accountId: "synth-account" })),
    SCHEMA_ERROR.FORBIDDEN_ACCOUNT_FIELD,
    "accountId",
  );
  hasError(
    validateBacktestIntent(validIntent({ brokerOrderId: "synth-broker" })),
    SCHEMA_ERROR.FORBIDDEN_BROKER_FIELD,
    "brokerOrderId",
  );
});

test("알 수 없는 필드 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ unexpectedField: true })),
    SCHEMA_ERROR.UNKNOWN_FIELD,
    "unexpectedField",
  );
});

test("배열·null Intent 거부", () => {
  hasError(validateBacktestIntent(null), SCHEMA_ERROR.NOT_PLAIN_OBJECT);
  hasError(validateBacktestIntent([]), SCHEMA_ERROR.NOT_PLAIN_OBJECT);
});

test("존재하지 않는 날짜와 Z datetime 거부", () => {
  hasError(
    validateBacktestIntent(validIntent({ signalTradingDate: "2100-02-30" })),
    SCHEMA_ERROR.INVALID_DATE_VALUE,
    "signalTradingDate",
  );
  hasError(
    validateBacktestIntent(validIntent({ signalCreatedAt: "2100-01-04T15:40:00Z" })),
    SCHEMA_ERROR.INVALID_DATE_FORMAT,
    "signalCreatedAt",
  );
});

test("assertBacktestIntent는 첫 오류 코드로 throw", () => {
  assert.throws(
    () => assertBacktestIntent(validIntent({ executionAllowed: true })),
    (err) => {
      assert.equal(err.code, SCHEMA_ERROR.EXECUTION_ALLOWED_MUST_BE_FALSE);
      return true;
    },
  );
});

test("정상 SimulatedFill", () => {
  const result = validateSimulatedFill(validFill());
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, [...FILL_FIELDS]);
  assert.equal(result.fillId, undefined);
  assert.equal(assertSimulatedFill(validFill()).ok, true);
  assert.equal(
    validateSimulatedFill(validFill({
      fillReason: FILL_REASON.LIMIT_FILLED_AT_LIMIT,
      intrabarAmbiguity: INTRABAR_AMBIGUITY.AMBIGUOUS_INTRABAR_STOP_FIRST,
    })).ok,
    true,
  );
});

test("잘못된 fillModelVersion 거부", () => {
  hasError(
    validateSimulatedFill(validFill({ fillModelVersion: "TICK_APPROXIMATION" })),
    SCHEMA_ERROR.INVALID_FILL_MODEL_VERSION,
    "fillModelVersion",
  );
});

test("SimulatedFill 비-null 계좌·브로커 거부", () => {
  hasError(
    validateSimulatedFill(validFill({ accountId: "synth-account" })),
    SCHEMA_ERROR.ACCOUNT_ID_MUST_BE_NULL,
    "accountId",
  );
  hasError(
    validateSimulatedFill(validFill({ brokerOrderId: "synth-broker" })),
    SCHEMA_ERROR.BROKER_ORDER_ID_MUST_BE_NULL,
    "brokerOrderId",
  );
});

test("SimulatedFill fillPrice 0·음수·NaN·Infinity·문자열 거부", () => {
  hasError(validateSimulatedFill(validFill({ fillPrice: 0 })), SCHEMA_ERROR.INVALID_FILL_PRICE, "fillPrice");
  hasError(validateSimulatedFill(validFill({ fillPrice: -1 })), SCHEMA_ERROR.INVALID_FILL_PRICE, "fillPrice");
  hasError(validateSimulatedFill(validFill({ fillPrice: NaN })), SCHEMA_ERROR.INVALID_FILL_PRICE, "fillPrice");
  hasError(validateSimulatedFill(validFill({ fillPrice: Infinity })), SCHEMA_ERROR.INVALID_FILL_PRICE, "fillPrice");
  hasError(validateSimulatedFill(validFill({ fillPrice: "99" })), SCHEMA_ERROR.INVALID_FILL_PRICE, "fillPrice");
});

test("SimulatedFill fillQuantity 0·음수·소수·NaN·Infinity·문자열 거부", () => {
  hasError(validateSimulatedFill(validFill({ fillQuantity: 0 })), SCHEMA_ERROR.INVALID_FILL_QUANTITY, "fillQuantity");
  hasError(validateSimulatedFill(validFill({ fillQuantity: -3 })), SCHEMA_ERROR.INVALID_FILL_QUANTITY, "fillQuantity");
  hasError(validateSimulatedFill(validFill({ fillQuantity: 1.5 })), SCHEMA_ERROR.INVALID_FILL_QUANTITY, "fillQuantity");
  hasError(validateSimulatedFill(validFill({ fillQuantity: NaN })), SCHEMA_ERROR.INVALID_FILL_QUANTITY, "fillQuantity");
  hasError(
    validateSimulatedFill(validFill({ fillQuantity: Infinity })),
    SCHEMA_ERROR.INVALID_FILL_QUANTITY,
    "fillQuantity",
  );
  hasError(validateSimulatedFill(validFill({ fillQuantity: "10" })), SCHEMA_ERROR.INVALID_FILL_QUANTITY, "fillQuantity");
});

test("createNotExecutedPerformanceResult 모든 value null, NOT_EXECUTED", () => {
  const result = createNotExecutedPerformanceResult();
  const keys = [
    "totalReturn",
    "cagr",
    "mdd",
    "winRate",
    "profitToLossRatio",
    "profitFactor",
    "expectedValue",
  ];
  for (const key of keys) {
    assert.equal(result[key].value, null);
    assert.equal(result[key].status, PERFORMANCE_STATUS.NOT_EXECUTED);
    assert.equal(result[key].notActualPerformance, true);
    assert.equal(result[key].promotionEligible, false);
    assert.equal(result[key].fixtureTag, null);
    assert.ok(result[key].unit === UNIT.RATIO || result[key].unit === UNIT.CURRENCY);
  }
  assert.equal(result.expectedValue.unit, UNIT.CURRENCY);
  assert.equal(result.notActualPerformance, true);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.fixtureTag, null);
  assert.equal(result.executionStatus, PERFORMANCE_STATUS.NOT_EXECUTED);
  assert.equal(result.backtestExecutionEligible, false);
});

test("createNotExecutedPerformanceResult 최상위 실행 상태", () => {
  const result = createNotExecutedPerformanceResult();
  const keys = [
    "totalReturn",
    "cagr",
    "mdd",
    "winRate",
    "profitToLossRatio",
    "profitFactor",
    "expectedValue",
  ];
  assert.equal(result.executionStatus, PERFORMANCE_STATUS.NOT_EXECUTED);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.notActualPerformance, true);
  assert.equal(result.promotionEligible, false);
  for (const key of keys) {
    assert.equal(result[key].value, null);
    assert.equal(result[key].status, PERFORMANCE_STATUS.NOT_EXECUTED);
  }
});

test("parseYmd·parseKstDateTime·isValidUtcCivilDate", () => {
  assert.equal(parseYmd("2100-01-05").ok, true);
  assert.equal(parseYmd("2100-02-30").code, SCHEMA_ERROR.INVALID_DATE_VALUE);
  assert.equal(parseYmd("21000105").code, SCHEMA_ERROR.INVALID_DATE_FORMAT);
  assert.equal(parseKstDateTime("2100-01-04T15:40:00+09:00").ok, true);
  assert.equal(parseKstDateTime("2100-01-04T15:40:00Z").ok, false);
  assert.equal(isValidUtcCivilDate(2100, 1, 5), true);
  assert.equal(isValidUtcCivilDate(2100, 2, 29), false);
});

test("lib/backtest 소스에 주문·네트워크 경로가 없다", () => {
  const files = [
    path.join(__dirname, "../lib/backtest/schemas.js"),
    path.join(__dirname, "../lib/backtest/performance.js"),
  ];
  const sourceText = files.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
  const forbidden = [
    "kb/broker",
    "/api/trading",
    "placeOrder",
    "submitOrder",
    "amendOrder",
    "cancelOrder",
    'require("http")',
    'require("https")',
    'require("net")',
    'require("dns")',
    'require("axios")',
  ];
  for (const token of forbidden) {
    assert.equal(sourceText.includes(token), false, token);
  }

  const scanned = [
    sourceText,
    fs.readFileSync(__filename, "utf8"),
    fs.readFileSync(path.join(__dirname, "backtest-performance.test.js"), "utf8"),
  ].join("\n");
  const bannedCodes = ["005" + "930", "000" + "660"];
  for (const code of bannedCodes) {
    assert.equal(scanned.includes(code), false, code);
  }
  const bannedYears = ["20" + "26", "20" + "27"];
  for (const year of bannedYears) {
    assert.equal(sourceText.includes(year), false, year);
    assert.equal(fs.readFileSync(__filename, "utf8").includes(year), false, year);
    assert.equal(
      fs.readFileSync(path.join(__dirname, "backtest-performance.test.js"), "utf8").includes(year),
      false,
      year,
    );
  }
});
