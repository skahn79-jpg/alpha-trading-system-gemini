"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const exec = require("../lib/backtest/execution-model");
const {
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
  INVALID_TRADING_DATE,
  ORDER_TYPE,
  SIDE,
  MISSING_DATA,
  MARKET,
  MARKET_CONTRACT_STATUS,
} = exec;

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function candle(tradingDate, open, high, low, close, extra) {
  return {
    symbol: "SYNTH001",
    market: "SYNTHETIC_MARKET",
    tradingDate,
    open,
    high,
    low,
    close,
    volume: 1000,
    isFinal: true,
    candleFinality: "FINAL",
    ...extra,
  };
}

function merge(base, overrides) {
  const out = { ...base, ...overrides };
  if (overrides && overrides.entryIntent) {
    out.entryIntent = { ...base.entryIntent, ...overrides.entryIntent };
  }
  if (overrides && overrides.exitPolicy) {
    out.exitPolicy = { ...base.exitPolicy, ...overrides.exitPolicy };
  }
  if (overrides && overrides.validationState) {
    out.validationState = { ...base.validationState, ...overrides.validationState };
  }
  if (overrides && overrides.fixtureMetadata) {
    out.fixtureMetadata = { ...base.fixtureMetadata, ...overrides.fixtureMetadata };
  }
  return out;
}

function validInput(overrides) {
  const base = {
    modelVersion: MODEL_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    side: SIDE.LONG,
    entryIntent: {
      orderType: ORDER_TYPE.MARKET_OPEN,
      signalTradingDate: "2101-01-03",
      earliestExecutionTradingDate: "2101-01-04",
    },
    exitPolicy: {
      stopLossPrice: 90,
      takeProfitPrice: 120,
      intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
    },
    candles: [
      candle("2101-01-04", 100, 105, 95, 102),
      candle("2101-01-05", 102, 108, 100, 104),
      candle("2101-01-06", 104, 110, 101, 106),
    ],
    validationState: {
      schemaValid: true,
      datasetVerified: false,
      backtestDataEligible: false,
      backtestExecutionEligible: false,
    },
    fixtureMetadata: {
      fixtureType: "SYNTHETIC",
      notProductionData: true,
      productionEligible: false,
    },
    tradeabilityStatus: "SYNTHETIC_TRADABLE",
  };
  return overrides ? merge(base, overrides) : base;
}

function assertNeverEligible(result) {
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.executionStatus, STATUS.NOT_EXECUTED);
}

function candlesForMarket(market) {
  return [
    candle("2101-01-04", 100, 105, 95, 102, { market }),
    candle("2101-01-05", 102, 108, 100, 104, { market }),
    candle("2101-01-06", 104, 110, 101, 106, { market }),
  ];
}

// 1
test("정상 합성 MARKET_OPEN 입력", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.ok, true);
  assert.equal(result.status, STATUS.SIMULATED_NOT_EXECUTED);
  assert.equal(result.entryStatus, ENTRY_STATUS.FILLED);
  assert.equal(result.entryPrice, 100);
  assert.equal(result.entryReason, ENTRY_REASON.MARKET_OPEN_NEXT_ELIGIBLE_BAR);
  assertNeverEligible(result);
});

// 2
test("알 수 없는 입력 필드 거부", () => {
  const result = evaluateDailyBarExecution(validInput({ extraField: 1 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
});

// 3
test("지원하지 않는 모델 버전 거부", () => {
  const result = evaluateDailyBarExecution(validInput({ modelVersion: "daily-bar-execution-v9.9" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_MODEL_VERSION), true);
});

// 4
test("PRODUCTION에서 합성 계산 모드 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    fixtureMetadata: { productionEligible: true },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.SYNTHETIC_MODE_NOT_ALLOWED_FOR_PRODUCTION), true);
});

// 5
test("LONG 외 방향 거부", () => {
  const result = evaluateDailyBarExecution(validInput({ side: "SHORT" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_SIDE), true);
});

// 6
test("문자열·NaN·Infinity 가격 거부", () => {
  const stringPrice = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: "90" },
  }));
  assert.equal(hasCode(stringPrice, ERROR.INVALID_PRICE), true);
  const nanPrice = evaluateDailyBarExecution(validInput({
    exitPolicy: { takeProfitPrice: Number.NaN },
  }));
  assert.equal(hasCode(nanPrice, ERROR.INVALID_PRICE), true);
  const infPrice = evaluateDailyBarExecution(validInput({
    exitPolicy: { takeProfitPrice: Number.POSITIVE_INFINITY },
  }));
  assert.equal(hasCode(infPrice, ERROR.INVALID_PRICE), true);
});

// 7
test("OHLC 관계 위반 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-01-04", 100, 90, 95, 102),
      candle("2101-01-05", 102, 108, 100, 104),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.OHLC_INCONSISTENT), true);
});

// 8
test("역순 캔들 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-01-06", 104, 110, 101, 106),
      candle("2101-01-05", 102, 108, 100, 104),
      candle("2101-01-04", 100, 105, 95, 102),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.NON_MONOTONIC_TRADING_DATE), true);
});

// 9
test("중복 캔들 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-01-04", 100, 105, 95, 102),
      candle("2101-01-04", 101, 106, 96, 103),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.DUPLICATE_CANDLE_RECORD), true);
});

// 10
test("미확정 캔들 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-01-04", 100, 105, 95, 102, { isFinal: false, candleFinality: "NOT_FINAL" }),
      candle("2101-01-05", 102, 108, 100, 104),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.CANDLE_NOT_FINAL), true);
});

// 11
test("신호일과 같은 날짜 진입 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      signalTradingDate: "2101-01-04",
      earliestExecutionTradingDate: "2101-01-04",
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.SAME_DAY_EXECUTION), true);
});

// 12
test("거래 가능 상태 결측 차단", () => {
  const input = validInput();
  delete input.tradeabilityStatus;
  const result = evaluateDailyBarExecution(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.TRADEABILITY_DATA_MISSING), true);
  assert.equal(result.status, STATUS.BLOCKED_TRADEABILITY_DATA_MISSING);
});

// 13
test("실제 실행 적격성이 항상 false인지 확인", () => {
  const result = evaluateDailyBarExecution(validInput({
    validationState: { backtestExecutionEligible: true },
  }));
  assert.equal(result.ok, true);
  assertNeverEligible(result);
});

// 14
test("오류 객체에 candles와 전체 입력이 없는지 확인", () => {
  const result = evaluateDailyBarExecution(validInput({ extraField: 1, candles: [
    candle("2101-01-04", 100, 105, 95, 102),
  ] }));
  const dumped = JSON.stringify(result);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
  assert.equal(Object.hasOwn(result, "candles"), false);
  assert.equal(Object.hasOwn(result, "input"), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "candles"), false);
    assert.equal(Object.hasOwn(err, "input"), false);
    assert.equal(Object.hasOwn(err, "dataset"), false);
    assert.equal(Object.hasOwn(err, "featureWindow"), false);
    assert.equal(Object.hasOwn(err, "secrets"), false);
  }
  assert.equal(dumped.includes("\"open\":100"), false);
});

// 15
test("주문·네트워크 모듈 참조가 없는지 확인", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/execution-model.js"),
    "utf8",
  );
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("submitOrder"), false);
  assert.equal(source.includes("axios"), false);
  assert.equal(source.includes('require("http")'), false);
  assert.equal(source.includes("require('http')"), false);
  assert.equal(source.includes("/api/trading"), false);
  assert.equal(source.includes("kb/broker"), false);
});

// 16
test("다음 적격 일봉 시가 진입", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      signalTradingDate: "2101-01-03",
      earliestExecutionTradingDate: "2101-01-04",
    },
    candles: [
      candle("2101-01-04", 100, 105, 95, 102),
      candle("2101-01-05", 102, 108, 100, 104),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryPrice, 100);
  assert.equal(result.entryReason, ENTRY_REASON.MARKET_OPEN_NEXT_ELIGIBLE_BAR);
  assert.equal(result.entryTradingDate, "2101-01-04");
});

// 17
test("적격 일봉이 없으면 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: { earliestExecutionTradingDate: "2101-01-10" },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.NO_ELIGIBLE_ENTRY_CANDLE), true);
  assert.equal(result.status, STATUS.BLOCKED_NO_ELIGIBLE_ENTRY_CANDLE);
});

// 18
test("진입 봉에서 손절가 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 130 },
    candles: [
      candle("2101-01-04", 100, 105, 94, 99),
      candle("2101-01-05", 99, 101, 98, 100),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 95);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_TOUCHED);
  assert.equal(result.exitTradingDate, "2101-01-04");
});

// 19
test("진입 봉에서 목표가 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 112, 96, 108),
      candle("2101-01-05", 108, 109, 107, 108),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 110);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_TOUCHED);
});

// 20
test("진입 봉에서 TP·SL 동시 도달 시 STOP_FIRST", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 120, 90, 105),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 95);
  assert.equal(result.exitReason, EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST);
  assert.equal(result.intrabarStatus, INTRABAR_STATUS.AMBIGUOUS_INTRABAR);
});

// 21
test("시가가 지정가 이하인 갭 개선 체결", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 90, takeProfitPrice: 120 },
    candles: [
      candle("2101-01-04", 99, 101, 98, 100),
      candle("2101-01-05", 100, 102, 99, 101),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryPrice, 99);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT);
  assert.equal(result.status, STATUS.SIMULATED_NOT_EXECUTED);
});

// 22
test("저가가 지정가에 닿은 지정가 체결", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 90, takeProfitPrice: 120 },
    candles: [
      candle("2101-01-04", 101, 103, 100, 102),
      candle("2101-01-05", 102, 104, 101, 103),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryPrice, 100);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_TOUCHED);
});

// 23
test("지정가 미도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 90,
    },
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 120 },
    candles: [
      candle("2101-01-04", 100, 105, 95, 102),
      candle("2101-01-05", 102, 108, 96, 104),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.status, STATUS.NOT_FILLED);
  assert.equal(result.entryStatus, ENTRY_STATUS.NOT_FILLED);
  assert.equal(result.errorCodes.length, 0);
  assert.equal(result.executionStatus, STATUS.NOT_EXECUTED);
});

// 24
test("LIMIT_BUY 진입 봉에서 TP 관측 시 순서 불명 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 90, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 101, 112, 100, 108),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
  assert.equal(result.intrabarStatus, INTRABAR_STATUS.AMBIGUOUS_ENTRY_EXIT_SEQUENCE);
  assert.equal(result.exitPrice, null);
  assert.equal(result.executionStatus, STATUS.NOT_EXECUTED);
});

// 25
test("LIMIT_BUY 진입 봉에서 SL 관측 시 순서 불명 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 130 },
    candles: [
      candle("2101-01-04", 101, 105, 94, 99),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
  assert.equal(result.exitPrice, null);
});

// 26
test("LIMIT_BUY 진입 봉에서 TP·SL 동시 관측 시 순서 불명 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 101, 120, 90, 105),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
  assert.equal(result.exitPrice, null);
});

// 27
test("손절가 아래 갭 하락은 시가 청산", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 130 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 90, 94, 88, 92),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 90);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_GAP);
  assert.equal(result.exitTradingDate, "2101-01-05");
});

// 28
test("장중 손절가 도달은 손절가 청산", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 130 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 101, 103, 94, 98),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 95);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_TOUCHED);
});

// 29
test("목표가 위 갭 상승은 목표가로 보수적 제한", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 120, 122, 118, 121),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 110);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_GAP_CAPPED);
  assert.notEqual(result.exitPrice, 120);
});

// 30
test("장중 목표가 도달은 목표가 청산", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 103, 112, 101, 111),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 110);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_TOUCHED);
});

// 31
test("일반 봉의 TP·SL 동시 도달은 STOP_FIRST", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 101, 120, 90, 108),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 95);
  assert.equal(result.exitReason, EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST);
});

// 32
test("STOP_FIRST 외 충돌 정책 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { intrabarConflictPolicy: "TAKE_PROFIT_FIRST" },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_INTRABAR_CONFLICT_POLICY), true);
});

// 33
test("단일 거래 grossPriceChange 계산", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 103, 112, 101, 111),
    ],
  }));
  assert.equal(result.grossPriceChange, 10);
});

// 34
test("단일 거래 grossReturnRate 계산", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 103, 112, 101, 111),
    ],
  }));
  assert.equal(result.grossReturnRate, 0.1);
});

// 35
test("비용·세금·슬리피지 null", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.costAmount, null);
  assert.equal(result.taxAmount, null);
  assert.equal(result.slippageAmount, null);
  assert.equal(result.netReturn, null);
});

// 36
test("totalReturn·CAGR·MDD·winRate·profitFactor null", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.totalReturn, null);
  assert.equal(result.cagr, null);
  assert.equal(result.mdd, null);
  assert.equal(result.winRate, null);
  assert.equal(result.profitFactor, null);
  assert.equal(result.sharpeRatio, null);
  assert.equal(result.benchmarkReturn, null);
  assert.equal(result.alpha, null);
});

// 37
test("Paper·Live 적격성 false", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.promotionEligible, false);
});

// 38
test("캘린더와 비용 정책 결측 상태 보존", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.missingData.includes(MISSING_DATA.CALENDAR_VALIDATION_NOT_IMPLEMENTED), true);
  assert.equal(result.missingData.includes(MISSING_DATA.COST_POLICY_NOT_CONFIGURED), true);
});

// 39
test("동일 입력은 동일 결과 반환", () => {
  const input = validInput();
  const a = evaluateDailyBarExecution(input);
  const b = evaluateDailyBarExecution(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// 40
test("함수가 입력 candles 배열을 변경하지 않음", () => {
  const candles = Object.freeze([
    Object.freeze(candle("2101-01-04", 100, 105, 95, 102)),
    Object.freeze(candle("2101-01-05", 102, 108, 100, 104)),
  ]);
  const input = validInput({ candles });
  const beforeLen = candles.length;
  const beforeOpen = candles[0].open;
  const snapshot = JSON.stringify(candles);
  evaluateDailyBarExecution(input);
  assert.equal(candles.length, beforeLen);
  assert.equal(candles[0].open, beforeOpen);
  assert.equal(JSON.stringify(candles), snapshot);
  assert.equal(Object.isFrozen(candles), true);
});

test("validateExecutionInput 정상", () => {
  const result = validateExecutionInput(validInput());
  assert.equal(result.ok, true);
});

test("validateExecutionInput 필수 필드 결측", () => {
  const result = validateExecutionInput({});
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.code === ERROR.MISSING_FIELD), true);
});

test("validateExecutionInput 경계: schemaValid false", () => {
  const result = validateExecutionInput(validInput({
    validationState: { schemaValid: false },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.code === ERROR.SCHEMA_NOT_VALID), true);
});

test("validateExecutionCandle 정상", () => {
  const result = validateExecutionCandle(candle("2101-01-04", 100, 105, 95, 102), 0);
  assert.equal(result.ok, true);
});

test("validateExecutionCandle 알 수 없는 필드", () => {
  const result = validateExecutionCandle(
    candle("2101-01-04", 100, 105, 95, 102, { extra: true }),
    0,
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.code === ERROR.UNKNOWN_FIELD), true);
});

test("validateExecutionCandle 연도 경계 실패", () => {
  const result = validateExecutionCandle(candle("2099-12-31", 100, 105, 95, 102), 0);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.code === ERROR.INVALID_TRADING_DATE_YEAR), true);
});

test("findEligibleEntryCandle 정상", () => {
  const found = findEligibleEntryCandle([
    candle("2101-01-04", 100, 105, 95, 102),
    candle("2101-01-05", 102, 108, 100, 104),
  ], "2101-01-05");
  assert.equal(found.ok, true);
  assert.equal(found.index, 1);
});

test("findEligibleEntryCandle 경계: 첫 봉이 정확히 earliest", () => {
  const found = findEligibleEntryCandle([
    candle("2101-01-04", 100, 105, 95, 102),
  ], "2101-01-04");
  assert.equal(found.ok, true);
  assert.equal(found.index, 0);
});

test("findEligibleEntryCandle 실패: 적격 없음", () => {
  const found = findEligibleEntryCandle([
    candle("2101-01-04", 100, 105, 95, 102),
  ], "2101-01-10");
  assert.equal(found.ok, false);
  assert.equal(found.code, ERROR.NO_ELIGIBLE_ENTRY_CANDLE);
});

test("evaluateMarketOpenEntry 정상", () => {
  const result = evaluateMarketOpenEntry(candle("2101-01-04", 100, 105, 95, 102));
  assert.equal(result.filled, true);
  assert.equal(result.entryPrice, 100);
});

test("evaluateMarketOpenEntry 경계: 시가 최소 양수", () => {
  const result = evaluateMarketOpenEntry(candle("2101-01-04", 0.01, 1, 0.01, 0.5));
  assert.equal(result.filled, true);
  assert.equal(result.entryPrice, 0.01);
});

test("evaluateMarketOpenEntry 실패: 시가 0", () => {
  const result = evaluateMarketOpenEntry({ open: 0 });
  assert.equal(result.filled, false);
  assert.equal(result.code, ERROR.INVALID_PRICE);
});

test("evaluateLimitBuyEntry 갭 개선", () => {
  const result = evaluateLimitBuyEntry(candle("2101-01-04", 99, 101, 98, 100), 100);
  assert.equal(result.filled, true);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT);
});

test("evaluateLimitBuyEntry 경계: 저가 정확히 지정가", () => {
  const result = evaluateLimitBuyEntry(candle("2101-01-04", 101, 103, 100, 102), 100);
  assert.equal(result.filled, true);
  assert.equal(result.entryPrice, 100);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_TOUCHED);
});

test("evaluateLimitBuyEntry 실패: 미도달", () => {
  const result = evaluateLimitBuyEntry(candle("2101-01-04", 101, 103, 100.5, 102), 100);
  assert.equal(result.filled, false);
});

test("evaluateLongExit 손절 터치", () => {
  const result = evaluateLongExit(
    candle("2101-01-05", 100, 102, 90, 95),
    95,
    130,
    INTRABAR_CONFLICT_POLICY.STOP_FIRST,
  );
  assert.equal(result.exited, true);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_TOUCHED);
});

test("evaluateLongExit 경계: 시가 갭 손절", () => {
  const result = evaluateLongExit(
    candle("2101-01-05", 90, 94, 88, 92),
    95,
    130,
    INTRABAR_CONFLICT_POLICY.STOP_FIRST,
  );
  assert.equal(result.exited, true);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_GAP);
});

test("evaluateLongExit 실패: 미청산", () => {
  const result = evaluateLongExit(
    candle("2101-01-05", 100, 105, 96, 102),
    90,
    120,
    INTRABAR_CONFLICT_POLICY.STOP_FIRST,
  );
  assert.equal(result.exited, false);
});

test("resolveIntrabarConflict 정상 STOP_FIRST", () => {
  const result = resolveIntrabarConflict({
    stopLossPrice: 95,
    takeProfitPrice: 110,
    intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
  });
  assert.equal(result.ok, true);
  assert.equal(result.exitPrice, 95);
  assert.equal(result.exitReason, EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST);
});

test("resolveIntrabarConflict 경계: 가격 결측", () => {
  const result = resolveIntrabarConflict({
    stopLossPrice: 95,
    intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.INVALID_PRICE);
});

test("resolveIntrabarConflict 실패: 미지원 정책", () => {
  const result = resolveIntrabarConflict({
    stopLossPrice: 95,
    takeProfitPrice: 110,
    intrabarConflictPolicy: "OPEN_FIRST",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.UNSUPPORTED_INTRABAR_CONFLICT_POLICY);
});

test("createExecutionResult 항상 미실행 플래그", () => {
  const result = createExecutionResult({ ok: true, status: STATUS.SIMULATED_NOT_EXECUTED });
  assert.equal(result.executionStatus, STATUS.NOT_EXECUTED);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.liveEligible, false);
});

test("createExecutionResult 결측 정책 항상 포함", () => {
  const result = createExecutionResult({ ok: true });
  assert.equal(result.missingData.includes(MISSING_DATA.CALENDAR_VALIDATION_NOT_IMPLEMENTED), true);
  assert.equal(result.missingData.includes(MISSING_DATA.COST_POLICY_NOT_CONFIGURED), true);
});

test("createExecutionResult 실패 상태도 성과 지표 null", () => {
  const result = createExecutionResult({ ok: false, status: STATUS.BLOCKED_INVALID_INPUT });
  assert.equal(result.totalReturn, null);
  assert.equal(result.cagr, null);
  assert.equal(result.executionStatus, STATUS.NOT_EXECUTED);
});

test("makeSafeExecutionError 허용 키만 복사", () => {
  const err = makeSafeExecutionError({
    code: ERROR.UNKNOWN_FIELD,
    field: "extraField",
    candles: [{ open: 100 }],
    input: { secret: "x" },
    dataset: {},
    featureWindow: [],
    secrets: { token: "x" },
  });
  assert.equal(err.code, ERROR.UNKNOWN_FIELD);
  assert.equal(err.severity, "ERROR");
  assert.equal(err.field, "extraField");
  assert.equal(Object.hasOwn(err, "candles"), false);
  assert.equal(Object.hasOwn(err, "input"), false);
  assert.equal(Object.hasOwn(err, "secrets"), false);
});

test("makeSafeExecutionError 경계: code만 있는 입력", () => {
  const err = makeSafeExecutionError({ code: ERROR.INVALID_INPUT });
  assert.equal(err.code, ERROR.INVALID_INPUT);
  assert.equal(err.severity, "ERROR");
});

test("makeSafeExecutionError 실패: 비객체는 기본 severity만", () => {
  const err = makeSafeExecutionError(null);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.hasOwn(err, "candles"), false);
});

test("LIMIT_BUY 시가 체결 후 같은 봉 SL 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 130 },
    candles: [
      candle("2101-01-04", 99, 105, 94, 98),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT);
  assert.equal(result.entryTiming, ENTRY_TIMING.OPEN);
  assert.notEqual(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
  assert.notEqual(result.intrabarStatus, INTRABAR_STATUS.AMBIGUOUS_ENTRY_EXIT_SEQUENCE);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_TOUCHED);
  assert.equal(result.exitPrice, 95);
});

test("LIMIT_BUY 시가 체결 후 같은 봉 TP 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 99, 112, 98, 108),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryTiming, ENTRY_TIMING.OPEN);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_TOUCHED);
  assert.equal(result.exitPrice, 110);
});

test("LIMIT_BUY 시가 체결 후 같은 봉 TP·SL 동시 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 99, 120, 90, 105),
    ],
  }));
  assert.equal(result.ok, true);
  assert.notEqual(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
  assert.equal(result.exitReason, EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST);
  assert.equal(result.exitPrice, 95);
});

test("LIMIT_BUY 장중 접촉 후 같은 봉 SL 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 130 },
    candles: [
      candle("2101-01-04", 101, 105, 94, 99),
    ],
  }));
  assert.equal(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
  assert.equal(result.entryTiming, ENTRY_TIMING.INTRABAR_UNKNOWN);
});

test("LIMIT_BUY 장중 접촉 후 같은 봉 TP 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    exitPolicy: { stopLossPrice: 90, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 101, 112, 100, 108),
    ],
  }));
  assert.equal(result.status, STATUS.BLOCKED_AMBIGUOUS_SEQUENCE);
});

test("기존 포지션의 갭 손절 봉에서 고가가 TP도 초과", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 90, 120, 88, 100),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_GAP);
  assert.equal(result.exitPrice, 90);
  assert.notEqual(result.intrabarStatus, INTRABAR_STATUS.AMBIGUOUS_INTRABAR);
});

test("기존 포지션의 갭 목표가 봉에서 저가가 SL도 하회", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 120, 122, 80, 115),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_GAP_CAPPED);
  assert.equal(result.exitPrice, 110);
  assert.notEqual(result.intrabarStatus, INTRABAR_STATUS.AMBIGUOUS_INTRABAR);
});

test("시가에서 청산 조건이 없고 봉내 TP·SL 동시 도달", () => {
  const result = evaluateDailyBarExecution(validInput({
    exitPolicy: { stopLossPrice: 95, takeProfitPrice: 110 },
    candles: [
      candle("2101-01-04", 100, 105, 96, 102),
      candle("2101-01-05", 101, 120, 90, 108),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.exitReason, EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST);
});

test("executionStatus가 NOT_EXECUTED", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.executionStatus, STATUS.NOT_EXECUTED);
});

test("calculationStatus가 SIMULATED_CALCULATION_ONLY", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
});

test("잘못된 날짜 형식 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    entryIntent: { signalTradingDate: "2101/01/03" },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_TRADING_DATE), true);
  assert.equal(hasCode(result, INVALID_TRADING_DATE), true);
  assert.equal(result.status === STATUS.BLOCKED_INVALID_INPUT
    || result.status === STATUS.BLOCKED_SCHEMA, true);
});

test("존재하지 않는 날짜 거부", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-02-30", 100, 105, 95, 102),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_TRADING_DATE), true);
});

test("GATE5H-E01 SYNTHETIC_KOSPI MARKET_OPEN", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSPI),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryStatus, ENTRY_STATUS.FILLED);
  assert.equal(result.entryReason, ENTRY_REASON.MARKET_OPEN_NEXT_ELIGIBLE_BAR);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSPI);
});

test("GATE5H-E02 SYNTHETIC_KOSDAQ MARKET_OPEN", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSDAQ,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSDAQ),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryStatus, ENTRY_STATUS.FILLED);
  assert.equal(result.entryReason, ENTRY_REASON.MARKET_OPEN_NEXT_ELIGIBLE_BAR);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSDAQ);
});

test("GATE5H-E03 SYNTHETIC_KOSPI LIMIT_BUY", () => {
  const kospi = MARKET.SYNTHETIC_KOSPI;
  const result = evaluateDailyBarExecution(validInput({
    market: kospi,
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    candles: [
      candle("2101-01-04", 99, 101, 98, 100, { market: kospi }),
      candle("2101-01-05", 100, 102, 99, 101, { market: kospi }),
      candle("2101-01-06", 101, 103, 100, 102, { market: kospi }),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryStatus, ENTRY_STATUS.FILLED);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT);
  assert.equal(result.entryPrice, 99);
  assert.equal(result.market, kospi);
});

test("GATE5H-E04 SYNTHETIC_KOSDAQ LIMIT_BUY", () => {
  const kosdaq = MARKET.SYNTHETIC_KOSDAQ;
  const result = evaluateDailyBarExecution(validInput({
    market: kosdaq,
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 100,
    },
    candles: [
      candle("2101-01-04", 99, 101, 98, 100, { market: kosdaq }),
      candle("2101-01-05", 100, 102, 99, 101, { market: kosdaq }),
      candle("2101-01-06", 101, 103, 100, 102, { market: kosdaq }),
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryStatus, ENTRY_STATUS.FILLED);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT);
  assert.equal(result.entryPrice, 99);
  assert.equal(result.market, kosdaq);
});

test("GATE5H-E05 결과 market KOSPI 보존", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSPI),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSPI);
  assert.notEqual(result.market, MARKET.SYNTHETIC_MARKET);
});

test("GATE5H-E06 결과 market KOSDAQ 보존", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSDAQ),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSDAQ);
  assert.notEqual(result.market, MARKET.SYNTHETIC_MARKET);
});

test("GATE5H-E07 KOSPI marketContractStatus 정상", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSPI),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5H-E08 KOSDAQ marketContractStatus 정상", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSDAQ,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSDAQ),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5H-E09 레거시 SYNTHETIC_MARKET 직접 실행 유지", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.ok, true);
  assert.equal(result.market, MARKET.SYNTHETIC_MARKET);
});

test("GATE5H-E10 레거시 상태 표시", () => {
  const result = evaluateDailyBarExecution(validInput());
  assert.equal(result.ok, true);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.LEGACY_SYNTHETIC_MARKET);
});

test("GATE5H-E11 실제 KOSPI 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: "KOSPI",
    candles: candlesForMarket("KOSPI"),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
  assert.equal(result.market, null);
});

test("GATE5H-E12 실제 KOSDAQ 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: "KOSDAQ",
    candles: candlesForMarket("KOSDAQ"),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
  assert.equal(result.market, null);
});

test("GATE5H-E13 미지원 시장 차단", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: "NASDAQ",
    candles: candlesForMarket("NASDAQ"),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_MARKET), true);
});

test("GATE5H-E14 혼합 캔들 시장", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-01-04", 100, 105, 95, 102, { market: MARKET.SYNTHETIC_KOSPI }),
      candle("2101-01-05", 102, 108, 100, 104, { market: MARKET.SYNTHETIC_KOSDAQ }),
      candle("2101-01-06", 104, 110, 101, 106, { market: MARKET.SYNTHETIC_KOSPI }),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.MIXED_EXECUTION_MARKETS), true);
  assert.equal(result.market, null);
});

test("GATE5H-E15 명시 시장·캔들 시장 불일치", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSDAQ),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.EXECUTION_MARKET_MISMATCH), true);
});

test("GATE5H-E16 시장 필드 문자열 외 값 거부", () => {
  const result = evaluateDailyBarExecution(validInput({ market: 12 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_MARKET), true);
});

test("GATE5H-E17 validateExecutionCandle 정상 SYNTHETIC_KOSPI", () => {
  const result = validateExecutionCandle(
    candle("2101-01-04", 100, 105, 95, 102, { market: MARKET.SYNTHETIC_KOSPI }),
    0,
  );
  assert.equal(result.ok, true);
});

test("GATE5H-E18 validateExecutionCandle 경계 SYNTHETIC_MARKET", () => {
  const result = validateExecutionCandle(candle("2101-01-04", 100, 105, 95, 102), 0);
  assert.equal(result.ok, true);
});

test("GATE5H-E19 validateExecutionCandle 실패 실제 KOSPI", () => {
  const result = validateExecutionCandle(
    candle("2101-01-04", 100, 105, 95, 102, { market: "KOSPI" }),
    0,
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.code === ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5H-E20 evaluateDailyBarExecution 정상 명시 시장 일치", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSPI),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSPI);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5H-E21 evaluateDailyBarExecution 경계 상위 시장 생략 후 도출", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSDAQ),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSDAQ);
});

test("GATE5H-E22 evaluateDailyBarExecution 실패 혼합 시장", () => {
  const result = evaluateDailyBarExecution(validInput({
    candles: [
      candle("2101-01-04", 100, 105, 95, 102, { market: MARKET.SYNTHETIC_KOSPI }),
      candle("2101-01-05", 102, 108, 100, 104, { market: MARKET.SYNTHETIC_MARKET }),
      candle("2101-01-06", 104, 110, 101, 106, { market: MARKET.SYNTHETIC_KOSPI }),
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.MIXED_EXECUTION_MARKETS), true);
});

test("GATE5H-E23 NOT_FILLED 경로 시장 보존", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    entryIntent: {
      orderType: ORDER_TYPE.LIMIT_BUY,
      limitPrice: 90,
    },
    exitPolicy: { stopLossPrice: 80, takeProfitPrice: 120 },
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSPI),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.status, STATUS.NOT_FILLED);
  assert.equal(result.entryStatus, ENTRY_STATUS.NOT_FILLED);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSPI);
});

test("GATE5H-E24 원본 캔들 시장 불변", () => {
  const candles = Object.freeze(candlesForMarket(MARKET.SYNTHETIC_KOSPI).map((c) => Object.freeze(c)));
  const snapshot = JSON.stringify(candles);
  evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    candles,
  }));
  assert.equal(JSON.stringify(candles), snapshot);
  assert.equal(candles[0].market, MARKET.SYNTHETIC_KOSPI);
});

test("GATE5H-E25 createExecutionResult 기본 시장 필드", () => {
  const result = createExecutionResult({});
  assert.equal(result.market, null);
  assert.equal(result.marketContractStatus, null);
});

test("GATE5H-E26 차단 경로에서도 알려진 시장 유지", () => {
  const result = evaluateDailyBarExecution(validInput({
    market: MARKET.SYNTHETIC_KOSPI,
    candles: candlesForMarket(MARKET.SYNTHETIC_KOSPI),
    entryIntent: { earliestExecutionTradingDate: "2101-01-10" },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.NO_ELIGIBLE_ENTRY_CANDLE), true);
  assert.equal(result.market, MARKET.SYNTHETIC_KOSPI);
});

test("GATE6R-G01 source pins shared makeBacktestError adapter", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/execution-model.js"),
    "utf8"
  );
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
  assert.equal(src.includes("const err = makeBacktestError(raw.code, extra)"), true);
  assert.equal(src.includes("if (raw.code == null)"), true);
  assert.equal(src.includes("err.severity = raw.severity != null ? raw.severity : \"ERROR\""), true);
  assert.equal(src.includes("for (const key of SAFE_ERROR_KEYS)"), true);
  assert.equal(src.includes("return { severity: \"ERROR\" }"), true);
});

test("GATE6R-G02 unknown field stays inside SAFE_ERROR_KEYS", () => {
  const result = evaluateDailyBarExecution(validInput({ extraField: 1 }));
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === ERROR.UNKNOWN_FIELD);
  assert.equal(err.field, "extraField");
  assert.equal(err.severity, "ERROR");
  const allowed = new Set(SAFE_ERROR_KEYS);
  for (const key of Object.keys(err)) {
    assert.equal(allowed.has(key), true, key);
  }
});

test("GATE6R-G03 non-object input keeps severity ERROR without a code key", () => {
  const err = makeSafeExecutionError(null);
  assert.deepEqual(err, { severity: "ERROR" });
  assert.equal(Object.prototype.hasOwnProperty.call(err, "code"), false);
});

test("GATE6R-G04 adapter copies execution extras and drops cause tradeId stage policyId", () => {
  const err = makeSafeExecutionError({
    code: ERROR.UNKNOWN_FIELD,
    field: "extraField",
    modelVersion: MODEL_VERSION,
    orderType: ORDER_TYPE.MARKET_OPEN,
    market: MARKET.SYNTHETIC_KOSPI,
    cause: "TRAIN_ROOT_A",
    tradeId: "T1",
    stage: "DATA",
    policyId: "pol",
  });
  assert.equal(err.field, "extraField");
  assert.equal(err.modelVersion, MODEL_VERSION);
  assert.equal(err.orderType, ORDER_TYPE.MARKET_OPEN);
  assert.equal(err.market, MARKET.SYNTHETIC_KOSPI);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "cause"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "tradeId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "stage"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "policyId"), false);
});

test("GATE6R-G05 missing or null code omits the code key", () => {
  const missing = makeSafeExecutionError({ field: "modelVersion" });
  assert.equal(Object.prototype.hasOwnProperty.call(missing, "code"), false);
  assert.equal(missing.severity, "ERROR");
  const nulled = makeSafeExecutionError({ code: null, field: "modelVersion" });
  assert.equal(Object.prototype.hasOwnProperty.call(nulled, "code"), false);
  assert.equal(nulled.field, "modelVersion");
});

test("GATE6R-G06 empty-string and WARNING severity are preserved", () => {
  const empty = makeSafeExecutionError({ code: ERROR.INVALID_INPUT, severity: "" });
  assert.equal(empty.code, ERROR.INVALID_INPUT);
  assert.equal(empty.severity, "");
  const warn = makeSafeExecutionError({ code: ERROR.INVALID_INPUT, severity: "WARNING" });
  assert.equal(warn.severity, "WARNING");
  const numeric = makeSafeExecutionError({ code: ERROR.INVALID_INPUT, severity: 0 });
  assert.equal(numeric.severity, 0);
});
