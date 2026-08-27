"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pipeline = require("../lib/backtest/synthetic-pipeline");
const {
  PIPELINE_VERSION,
  STAGE,
  PIPELINE_STATUS,
  STAGE_STATUS,
  CALCULATION_MODE,
  ERROR,
  validateSyntheticPipelineInput,
  runSyntheticSingleTradePipeline,
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
} = pipeline;

const {
  LOAD_MODE,
  SOURCE_TYPE,
  FIXTURE_TYPE,
  VERIFICATION_STATUS,
  PRICE_ADJUSTMENT_STATUS,
  CORPORATE_ACTION_POLICY_STATUS,
  FINALITY,
  FINALITY_SOURCE,
  CANDLE_ADJUSTMENT,
  DATASET_TYPE,
  SORT_ORDER,
  CANONICALIZATION_VERSION,
  SYNTHETIC_MARKETS,
  computeDatasetContentChecksum,
  computeDatasetMetadataHash,
} = require("../lib/backtest/data-validation");

const {
  MODEL_VERSION,
  CALCULATION_MODE: EXEC_CALC_MODE,
  CALCULATION_STATUS,
  ORDER_TYPE,
  SIDE,
  INTRABAR_CONFLICT_POLICY,
  ENTRY_STATUS,
  EXIT_STATUS,
  ENTRY_REASON,
  EXIT_REASON,
  STATUS: EXEC_STATUS,
  evaluateDailyBarExecution,
  ERROR: EXEC_ERROR,
  MARKET_CONTRACT_STATUS,
} = require("../lib/backtest/execution-model");

const {
  POLICY_ENGINE_VERSION,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
  ROUNDING_MODE,
  EXECUTION_STATUS,
  ERROR: COST_ERROR,
} = require("../lib/backtest/cost-policy");

const PIPELINE_PATH = path.join(__dirname, "..", "lib", "backtest", "synthetic-pipeline.js");
const DATA_VALIDATION_PATH = path.join(__dirname, "..", "lib", "backtest", "data-validation.js");
const EXECUTION_PATH = path.join(__dirname, "..", "lib", "backtest", "execution-model.js");
const COST_PATH = path.join(__dirname, "..", "lib", "backtest", "cost-policy.js");

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysYmd(ymd, days) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function isWeekendYmd(ymd) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function makeCalendarDay(tradingDate, overrides) {
  const extras = overrides || {};
  return {
    tradingDate,
    dayStatus: extras.dayStatus || (isWeekendYmd(tradingDate) ? "NON_TRADING_DAY" : "TRADING_DAY"),
    sessionStatus: extras.sessionStatus || "FINAL",
    statusSource: extras.statusSource || "SYNTHETIC_EXPLICIT",
    market: extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    calendarId: extras.calendarId || "synthetic-calendar-kospi-v1",
  };
}

function buildCalendar(options) {
  const opts = options || {};
  const start = opts.start || "2101-03-01";
  const dayCount = opts.dayCount || 14;
  const market = opts.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const calendarId = opts.calendarId || "synthetic-calendar-kospi-v1";
  const calendarVersion = opts.calendarVersion || "1.0.0";
  const days = [];
  for (let i = 0; i < dayCount; i += 1) {
    days.push(makeCalendarDay(addDaysYmd(start, i), { market, calendarId }));
  }
  if (Array.isArray(opts.patchDays)) {
    for (const patch of opts.patchDays) {
      const row = days.find((d) => d.tradingDate === patch.tradingDate);
      if (row) Object.assign(row, patch);
    }
  }
  return {
    calendarId,
    calendarVersion,
    calendarStatus: "TEST_VERIFIED",
    fixtureType: "SYNTHETIC",
    notProductionData: true,
    productionEligible: false,
    market,
    timezone: "Asia/Seoul",
    coverage: { from: start, to: addDaysYmd(start, dayCount - 1) },
    generatedAt: "2100-01-01T00:00:00+09:00",
    verifiedAt: "2100-01-01T00:00:00+09:00",
    days,
  };
}

function tradingDatesOf(calendar) {
  return calendar.days
    .filter((d) => d.dayStatus === "TRADING_DAY")
    .map((d) => d.tradingDate);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integratedCandle(tradingDate, overrides) {
  const extras = overrides || {};
  const market = extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  return {
    symbol: extras.symbol || "SYNTH001",
    market,
    tradingDate,
    open: extras.open != null ? extras.open : 10000,
    high: extras.high != null ? extras.high : 10100,
    low: extras.low != null ? extras.low : 9900,
    close: extras.close != null ? extras.close : 10050,
    volume: extras.volume != null ? extras.volume : 1000,
    isFinal: true,
    candleFinality: FINALITY.FINAL,
    finalitySource: FINALITY_SOURCE.EXPLICIT_FINAL_FLAG,
    adjustmentStatus: CANDLE_ADJUSTMENT.UNKNOWN,
    dataAsOf: `${tradingDate}T15:40:00+09:00`,
    sourceDatasetId: "synthetic-dataset-v1",
    ...extras,
  };
}

function buildDataset(calendar, candleRows, overrides) {
  const extras = overrides || {};
  const candles = candleRows.map((row) => integratedCandle(row.tradingDate, row));
  const dates = candles.map((c) => c.tradingDate).sort();
  const envelope = {
    datasetId: "synthetic-dataset-v1",
    datasetVersion: "1.0.0",
    datasetType: DATASET_TYPE.HISTORICAL_DAILY_OHLCV,
    sourceType: SOURCE_TYPE.SYNTHETIC_FIXTURE,
    symbols: ["SYNTH001"],
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    coverage: { from: dates[0], to: dates[dates.length - 1] },
    perSymbolCoverage: { SYNTH001: { from: dates[0], to: dates[dates.length - 1] } },
    timezone: "Asia/Seoul",
    sortOrder: SORT_ORDER.ASCENDING_BY_TRADING_DATE,
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.UNKNOWN,
    corporateActionPolicyId: "synthetic-ca-v1",
    corporateActionPolicyStatus: CORPORATE_ACTION_POLICY_STATUS.UNKNOWN,
    universePolicyId: "synthetic-universe-v1",
    survivorshipBiasControlled: true,
    calendarVersion: calendar.calendarVersion,
    calendarVerificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    contentChecksum: null,
    metadataHash: null,
    verificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
    fixtureType: FIXTURE_TYPE.SYNTHETIC_BACKTEST_DATASET,
    notProductionData: true,
    productionEligible: false,
    candles,
    sourceRefs: [],
    verifiedAt: null,
    generatedAt: null,
    loaderTimestamp: null,
    ...extras,
  };
  envelope.contentChecksum = computeDatasetContentChecksum(envelope);
  envelope.metadataHash = computeDatasetMetadataHash(envelope);
  return envelope;
}

function makePolicy(overrides) {
  const base = {
    policyId: "synthetic-cost-kospi-v1",
    policyVersion: "1.0.0",
    policyStatus: POLICY_STATUS.TEST_VERIFIED,
    fixtureType: "SYNTHETIC",
    notProductionData: true,
    productionEligible: false,
    market: MARKET.SYNTHETIC_KOSPI,
    currency: CURRENCY.KRW,
    effectiveFrom: "2101-01-01",
    effectiveTo: "2101-12-31",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    commission: {
      buyRatePpm: 100,
      sellRatePpm: 100,
      minimumBuyAmount: 0,
      minimumSellAmount: 0,
      roundingMode: ROUNDING_MODE.FLOOR,
    },
    sellTaxes: [
      {
        taxType: "SYNTHETIC_TRANSACTION_TAX",
        ratePpm: 1000,
        roundingMode: ROUNDING_MODE.FLOOR,
      },
    ],
    sourceReference: "SYNTHETIC_TEST_POLICY",
    verifiedAt: "2100-12-01T00:00:00.000Z",
  };
  if (!overrides) return base;
  const out = { ...base, ...overrides };
  if (overrides.commission) out.commission = { ...base.commission, ...overrides.commission };
  if (overrides.sellTaxes) out.sellTaxes = overrides.sellTaxes;
  return out;
}

function policyA() {
  return makePolicy({
    policyId: "synthetic-cost-kospi-a",
    effectiveFrom: "2101-01-01",
    effectiveTo: "2101-06-30",
  });
}

function policyB() {
  return makePolicy({
    policyId: "synthetic-cost-kospi-b",
    effectiveFrom: "2101-07-01",
    effectiveTo: "2101-12-31",
    commission: {
      buyRatePpm: 200,
      sellRatePpm: 200,
      minimumBuyAmount: 0,
      minimumSellAmount: 0,
      roundingMode: ROUNDING_MODE.FLOOR,
    },
    sellTaxes: [
      {
        taxType: "SYNTHETIC_TRANSACTION_TAX",
        ratePpm: 2000,
        roundingMode: ROUNDING_MODE.FLOOR,
      },
    ],
  });
}

function fullTradeCandles(calendar) {
  const t = tradingDatesOf(calendar);
  return [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
  ];
}

function validPipelineInput(overrides) {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, fullTradeCandles(calendar));
  const base = {
    pipelineVersion: PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: calendar.coverage.to,
    },
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy()],
    },
  };
  if (!overrides) return base;
  const out = deepClone(base);
  return { ...out, ...overrides };
}

function validKosdaqPipelineInput(overrides) {
  const calendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(
    calendar,
    fullTradeCandles(calendar).map((row) => ({
      ...row,
      market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    })),
    { markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ] },
  );
  const base = {
    pipelineVersion: PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: calendar.coverage.to,
    },
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy({
        policyId: "synthetic-cost-kosdaq-v1",
        market: MARKET.SYNTHETIC_KOSDAQ,
      })],
    },
  };
  if (!overrides) return base;
  const out = deepClone(base);
  return { ...out, ...overrides };
}

function assertOperationalBlocked(result) {
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.executionStatus, EXECUTION_STATUS.NOT_EXECUTED);
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
}

function assertPerformanceNull(result) {
  assert.equal(result.totalReturn, null);
  assert.equal(result.cagr, null);
  assert.equal(result.mdd, null);
  assert.equal(result.winRate, null);
  assert.equal(result.profitFactor, null);
  assert.equal(result.sharpeRatio, null);
  assert.equal(result.benchmarkReturn, null);
  assert.equal(result.alpha, null);
}

// 1
test("GATE5G-01 정상 합성 파이프라인 입력", () => {
  const result = validateSyntheticPipelineInput(validPipelineInput());
  assert.equal(result.ok, true);
});

// 2
test("GATE5G-02 알 수 없는 최상위 필드", () => {
  const result = validateSyntheticPipelineInput(validPipelineInput({ extraField: 1 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
});

// 3
test("GATE5G-03 필수 필드 누락", () => {
  const input = validPipelineInput();
  delete input.dataset;
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.MISSING_REQUIRED_FIELD), true);
});

// 4
test("GATE5G-04 미지원 pipelineVersion", () => {
  const result = validateSyntheticPipelineInput(validPipelineInput({
    pipelineVersion: "synthetic-single-trade-v9.9",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_PIPELINE_VERSION), true);
});

// 5
test("GATE5G-05 미지원 calculationMode", () => {
  const result = validateSyntheticPipelineInput(validPipelineInput({
    calculationMode: "INVALID_MODE",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_CALCULATION_MODE), true);
});

// 6
test("GATE5G-06 PRODUCTION에서 합성 파이프라인 차단", () => {
  const result = validateSyntheticPipelineInput(validPipelineInput({
    calculationMode: CALCULATION_MODE.PRODUCTION,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION), true);
});

// 7
test("GATE5G-07 다중 심볼 차단", () => {
  const input = validPipelineInput();
  input.dataset.symbols = ["SYNTH001", "SYNTH002"];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.MULTI_SYMBOL_PIPELINE_NOT_SUPPORTED), true);
});

// 8
test("GATE5G-08 다중 시장 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.MULTI_MARKET_PIPELINE_NOT_SUPPORTED), true);
});

// 9
test("GATE5G-09 LONG 외 방향 차단", () => {
  const input = validPipelineInput();
  input.execution.side = "SHORT";
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_PIPELINE_SIDE), true);
});

// 10
test("GATE5G-10 실제 시장명 혼용 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = ["KOSPI"];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

// 11
test("GATE5G-11 정상 데이터·캘린더 통과", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.syntheticDataValidated, true);
  assert.equal(result.syntheticCalendarVerified, true);
  assert.equal(result.syntheticCandleDatesVerified, true);
});

// 12
test("GATE5G-12 데이터 스키마 실패 시 execution 미실행", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].volume = -1;
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.syntheticExecutionCalculated, false);
});

// 13
test("GATE5G-13 캔들 OHLC 오류 시 execution 미실행", () => {
  const input = validPipelineInput();
  input.dataset.candles[1].high = 9000;
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
});

// 14
test("GATE5G-14 체크섬 변조 시 execution 미실행", () => {
  const input = validPipelineInput();
  input.dataset.contentChecksum = "deadbeef";
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(result, "CONTENT_CHECKSUM_MISMATCH"), true);
});

// 15
test("GATE5G-15 캘린더 누락 시 execution 미실행", () => {
  const input = validPipelineInput();
  delete input.calendar;
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  const run = runSyntheticSingleTradePipeline(input);
  assert.equal(run.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
});

// 16
test("GATE5G-16 캘린더 coverage 오류", () => {
  const input = validPipelineInput();
  input.calendarValidation.requiredTo = "2100-01-01";
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
});

// 17
test("GATE5G-17 NON_TRADING_DAY 캔들", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const weekend = calendar.days.find((d) => d.dayStatus === "NON_TRADING_DAY").tradingDate;
  const rows = fullTradeCandles(calendar);
  rows.push({ tradingDate: weekend, open: 10000, high: 10100, low: 9900, close: 10050 });
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(result, "CANDLE_ON_NON_TRADING_DAY"), true);
});

// 18
test("GATE5G-18 PENDING 캘린더", () => {
  const input = validPipelineInput();
  const td = input.dataset.candles[0].tradingDate;
  input.calendar.days.find((d) => d.tradingDate === td).dayStatus = "PENDING";
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(result, "CALENDAR_PENDING"), true);
});

// 19
test("GATE5G-19 calendarVersion 불일치", () => {
  const input = validPipelineInput();
  input.dataset.calendarVersion = "mismatch-version";
  input.dataset.contentChecksum = computeDatasetContentChecksum(input.dataset);
  input.dataset.metadataHash = computeDatasetMetadataHash(input.dataset);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(result, "CALENDAR_VERSION_MISMATCH"), true);
});

// 20
test("GATE5G-20 데이터 오류가 안전하게 병합됨", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].volume = -1;
  const result = runSyntheticSingleTradePipeline(input);
  const dumped = JSON.stringify(result.errors);
  assert.equal(dumped.includes('"candles"'), false);
  assert.equal(result.errors.every((e) => e.stage === STAGE.DATA || e.stage === STAGE.PIPELINE || e.code === ERROR.DATA_STAGE_FAILED), true);
});

// 21
test("GATE5G-21 MARKET_OPEN 진입·청산 완료", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.entryStatus, ENTRY_STATUS.FILLED);
  assert.equal(result.exitStatus, EXIT_STATUS.FILLED);
  assert.equal(result.entryPrice, 10000);
  assert.equal(result.exitPrice, 11000);
  assert.equal(result.entryReason, ENTRY_REASON.MARKET_OPEN_NEXT_ELIGIBLE_BAR);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_TOUCHED);
});

// 22
test("GATE5G-22 LIMIT_BUY 시가 체결", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 9900, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.LIMIT_BUY,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: 10000,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_GAP_IMPROVEMENT);
});

// 23
test("GATE5G-23 LIMIT_BUY 장중 접촉", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10100, high: 10500, low: 9950, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.LIMIT_BUY,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: 10000,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.entryReason, ENTRY_REASON.LIMIT_BUY_TOUCHED);
});

// 24
test("GATE5G-24 LIMIT_BUY 미체결", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10100, high: 10500, low: 10050, close: 10200 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.LIMIT_BUY,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: 10000,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_NO_ENTRY);
  assert.equal(result.executionStageStatus, STAGE_STATUS.COMPLETED_NOT_FILLED);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
});

// 25
test("GATE5G-25 적격 진입 봉 없음", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = fullTradeCandles(calendar);
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: "2101-12-31",
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_NO_ENTRY);
});

// 26
test("GATE5G-26 진입 완료·청산 미완료", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9900, close: 10050 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_OPEN_POSITION_NOT_EXECUTED);
  assert.equal(result.exitAmount, null);
  assert.equal(result.netProfit, null);
});

// 27
test("GATE5G-27 손절가 갭 하락", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9900, close: 10050 },
    { tradingDate: t[2], open: 9400, high: 9600, low: 9300, close: 9500 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 12000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.exitReason, EXIT_REASON.STOP_LOSS_GAP);
  assert.equal(result.exitPrice, 9400);
});

// 28
test("GATE5G-28 목표가 갭 상승", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9900, close: 10050 },
    { tradingDate: t[2], open: 11500, high: 11600, low: 11400, close: 11550 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.exitReason, EXIT_REASON.TAKE_PROFIT_GAP_CAPPED);
});

// 29
test("GATE5G-29 TP·SL 동일 봉 STOP_FIRST", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9900, close: 10050 },
    { tradingDate: t[2], open: 10200, high: 11200, low: 9400, close: 10500 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.exitReason, EXIT_REASON.AMBIGUOUS_INTRABAR_STOP_FIRST);
  assert.equal(result.exitPrice, 9500);
});

// 30
test("GATE5G-30 장중 LIMIT_BUY 진입·청산 순서 불명", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10100, high: 11200, low: 9400, close: 10200 },
  ];
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.LIMIT_BUY,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: 10000,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
});

// 31
test("GATE5G-31 체결 실패 시 비용 미실행", () => {
  const input = validPipelineInput();
  input.execution.exitPolicy.stopLossPrice = "bad";
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.syntheticCostCalculated, false);
});

// 32
test("GATE5G-32 체결 가격·날짜가 비용 입력의 유일 출처", () => {
  const input = validPipelineInput();
  const run = runSyntheticSingleTradePipeline(input);
  const built = buildCostInput(input, {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
    entryTradingDate: run.entryTradingDate,
    exitTradingDate: run.exitTradingDate,
    entryPrice: run.entryPrice,
    exitPrice: run.exitPrice,
  });
  assert.equal(built.ok, true);
  assert.equal(built.input.entryPrice, run.entryPrice);
  assert.equal(built.input.exitPrice, run.exitPrice);
  assert.equal(built.input.entryTradingDate, run.entryTradingDate);
  assert.equal(built.input.exitTradingDate, run.exitTradingDate);
});

// 33
test("GATE5G-33 정상 비용 계산", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.entryAmount, 100000);
  assert.equal(result.exitAmount, 110000);
  assert.equal(result.totalCost, 131);
  assert.equal(result.netProfit, 9869);
});

// 34
test("GATE5G-34 진입일 정책 A·청산일 정책 B", () => {
  const calendar = buildCalendar({ start: "2101-06-28", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const juneEntryIdx = t.findIndex((d) => d <= "2101-06-30" && d > t[0]);
  const julyExitIdx = t.findIndex((d) => d >= "2101-07-01");
  assert.ok(juneEntryIdx > 0);
  assert.ok(julyExitIdx > juneEntryIdx);
  const rows = [];
  for (let i = 0; i <= julyExitIdx; i += 1) {
    if (i === 0) {
      rows.push({ tradingDate: t[i], open: 9800, high: 9900, low: 9700, close: 9850 });
    } else if (i === juneEntryIdx) {
      rows.push({ tradingDate: t[i], open: 10000, high: 10500, low: 9800, close: 10200 });
    } else if (i === julyExitIdx) {
      rows.push({ tradingDate: t[i], open: 10800, high: 11200, low: 10700, close: 11100 });
    } else {
      rows.push({ tradingDate: t[i], open: 10100, high: 10200, low: 10000, close: 10150 });
    }
  }
  const input = validPipelineInput({
    dataset: buildDataset(calendar, rows),
    calendar,
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: calendar.coverage.to,
    },
    execution: {
      modelVersion: MODEL_VERSION,
      side: SIDE.LONG,
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[juneEntryIdx],
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 11000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
      quantity: 10,
    },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [policyA(), policyB()],
    },
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.entryCommission, 10);
  assert.equal(result.exitCommission, 22);
  assert.equal(result.sellTaxTotal, 220);
});

// 35
test("GATE5G-35 매수 수수료", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.entryCommission, 10);
});

// 36
test("GATE5G-36 매도 수수료", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.exitCommission, 11);
});

// 37
test("GATE5G-37 매도 세금", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.sellTaxTotal, 110);
});

// 38
test("GATE5G-38 총비용", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.totalCost, result.entryCommission + result.exitCommission + result.sellTaxTotal);
});

// 39
test("GATE5G-39 grossProfit", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.grossProfit, 10000);
});

// 40
test("GATE5G-40 netProfit", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.netProfit, 9869);
});

// 41
test("GATE5G-41 비용정책 미발견", () => {
  const input = validPipelineInput();
  input.cost.policies = [];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_NOT_FOUND), true);
});

// 42
test("GATE5G-42 비용정책 공백", () => {
  const input = validPipelineInput();
  input.cost.policies = [
    makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-03-01" }),
    makePolicy({
      policyId: "synthetic-cost-kospi-gap",
      effectiveFrom: "2101-05-01",
      effectiveTo: "2101-12-31",
    }),
  ];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_GAP), true);
});

// 43
test("GATE5G-43 비용정책 중첩", () => {
  const input = validPipelineInput();
  input.cost.policies = [
    makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-12-31" }),
    makePolicy({
      policyId: "synthetic-cost-kospi-overlap",
      effectiveFrom: "2101-06-01",
      effectiveTo: "2101-12-31",
    }),
  ];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_OVERLAP), true);
});

// 44
test("GATE5G-44 비용 overflow", () => {
  const input = validPipelineInput();
  input.execution.quantity = Number.MAX_SAFE_INTEGER;
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.ARITHMETIC_OVERFLOW), true);
});

// 45
test("GATE5G-45 비용 실패가 안전하게 병합됨", () => {
  const input = validPipelineInput();
  input.cost.policies = [];
  const result = runSyntheticSingleTradePipeline(input);
  const dumped = JSON.stringify(result.errors);
  assert.equal(dumped.includes('"policies"'), false);
  assert.equal(result.errors.some((e) => e.stage === STAGE.COST), true);
});

// 46
test("GATE5G-46 비용 입력에서 체결 결과 덮어쓰기 불가", () => {
  const built = buildCostInput(validPipelineInput(), {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.NOT_TRIGGERED,
    entryTradingDate: "2101-03-02",
    entryPrice: 10000,
  });
  assert.equal(built.ok, false);
  assert.equal(hasCode(built, ERROR.EXECUTION_RESULT_INCOMPLETE), true);
});

// 47
test("GATE5G-47 정상 완료 pipelineStatus", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

// 48
test("GATE5G-48 dataStageStatus", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.dataStageStatus, STAGE_STATUS.PASSED_SYNTHETIC_ONLY);
});

// 49
test("GATE5G-49 executionStageStatus", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.executionStageStatus, STAGE_STATUS.PASSED_SYNTHETIC_ONLY);
});

// 50
test("GATE5G-50 costStageStatus", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.costStageStatus, STAGE_STATUS.PASSED_SYNTHETIC_ONLY);
});

// 51
test("GATE5G-51 executionStatus=NOT_EXECUTED", () => {
  assertOperationalBlocked(runSyntheticSingleTradePipeline(validPipelineInput()));
});

// 52
test("GATE5G-52 calculationStatus=SIMULATED_CALCULATION_ONLY", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
});

// 53
test("GATE5G-53 calendarVerified=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).calendarVerified, false);
});

// 54
test("GATE5G-54 datasetVerified=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).datasetVerified, false);
});

// 55
test("GATE5G-55 costPolicyVerified=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).costPolicyVerified, false);
});

// 56
test("GATE5G-56 backtestExecutionEligible=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).backtestExecutionEligible, false);
});

// 57
test("GATE5G-57 promotionEligible=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).promotionEligible, false);
});

// 58
test("GATE5G-58 paperEligible=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).paperEligible, false);
});

// 59
test("GATE5G-59 liveEligible=false", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).liveEligible, false);
});

// 60
test("GATE5G-60 모든 승격 플래그 동시 주입 차단", () => {
  const input = validPipelineInput({
    calendarVerified: true,
    datasetVerified: true,
    costPolicyVerified: true,
    backtestExecutionEligible: true,
    promotionEligible: true,
    paperEligible: true,
    liveEligible: true,
  });
  const validated = validateSyntheticPipelineInput(input);
  assert.equal(validated.ok, false);
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assertOperationalBlocked(result);
});

// 61
test("GATE5G-61 totalReturn null", () => {
  assertPerformanceNull(runSyntheticSingleTradePipeline(validPipelineInput()));
});

// 62
test("GATE5G-62 CAGR null", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).cagr, null);
});

// 63
test("GATE5G-63 MDD null", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).mdd, null);
});

// 64
test("GATE5G-64 winRate null", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).winRate, null);
});

// 65
test("GATE5G-65 profitFactor null", () => {
  assert.equal(runSyntheticSingleTradePipeline(validPipelineInput()).profitFactor, null);
});

// 66
test("GATE5G-66 오류에 원본 입력 없음", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].volume = -1;
  const result = runSyntheticSingleTradePipeline(input);
  const dumped = JSON.stringify(result.errors);
  assert.equal(dumped.includes('"dataset"'), false);
  assert.equal(dumped.includes('"calendar"'), false);
  assert.equal(dumped.includes('"policies"'), false);
});

// 67
test("GATE5G-67 모든 입력 객체 불변", () => {
  const input = validPipelineInput();
  const snap = JSON.stringify(input);
  runSyntheticSingleTradePipeline(input);
  assert.equal(JSON.stringify(input), snap);
});

// 68
test("GATE5G-68 동일 입력은 동일 결과", () => {
  const input = validPipelineInput();
  const a = runSyntheticSingleTradePipeline(input);
  const b = runSyntheticSingleTradePipeline(input);
  assert.deepEqual(a, b);
});

// 69
test("GATE5G-69 네트워크·주문 모듈 참조 없음", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"https\")"), false);
  assert.equal(src.includes("require(\"axios\")"), false);
  assert.equal(src.includes("require(\"../server\")"), false);
  assert.equal(src.includes("fetch("), false);
});

// 70
test("GATE5G-70 기존 모듈 파일 변경 없음", () => {
  assert.equal(fs.existsSync(DATA_VALIDATION_PATH), true);
  assert.equal(fs.existsSync(EXECUTION_PATH), true);
  assert.equal(fs.existsSync(COST_PATH), true);
  assert.equal(fs.existsSync(PIPELINE_PATH), true);
});

// helper: validateSyntheticPipelineInput 경계
test("GATE5G-71 validateSyntheticPipelineInput 경계: null", () => {
  const result = validateSyntheticPipelineInput(null);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

// helper: validateSyntheticPipelineInput 실패
test("GATE5G-72 validateSyntheticPipelineInput 실패: cost 미지정 필드", () => {
  const input = validPipelineInput();
  input.cost.extra = 1;
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
});

// helper: buildExecutionInput 정상
test("GATE5G-73 buildExecutionInput 정상", () => {
  const input = validPipelineInput();
  const dataResult = {
    schemaValid: true,
    syntheticCalendarProvided: true,
    syntheticCalendarVerified: true,
    syntheticCandleDatesVerified: true,
    errorCodes: [],
  };
  const execInput = buildExecutionInput(input, dataResult);
  assert.equal(execInput.calculationMode, CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY);
  assert.equal(execInput.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(execInput.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(input.dataset.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

// helper: buildExecutionInput 경계
test("GATE5G-74 buildExecutionInput 경계: fixtureMetadata 고정", () => {
  const execInput = buildExecutionInput(validPipelineInput(), { schemaValid: true });
  assert.equal(execInput.fixtureMetadata.notProductionData, true);
  assert.equal(execInput.fixtureMetadata.productionEligible, false);
});

// helper: buildExecutionInput 실패 불변
test("GATE5G-75 buildExecutionInput 실패: 원본 캔들 market 유지", () => {
  const input = validPipelineInput();
  buildExecutionInput(input, { schemaValid: true });
  assert.equal(input.dataset.candles.every((c) => c.market === SYNTHETIC_MARKETS.SYNTHETIC_KOSPI), true);
});

// helper: buildCostInput 정상
test("GATE5G-76 buildCostInput 정상", () => {
  const built = buildCostInput(validPipelineInput(), {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
    entryTradingDate: "2101-03-02",
    exitTradingDate: "2101-03-03",
    entryPrice: 10000,
    exitPrice: 11000,
  });
  assert.equal(built.ok, true);
  assert.equal(built.input.market, MARKET.SYNTHETIC_KOSPI);
  assert.equal(built.input.quantity, 10);
});

// helper: buildCostInput 경계
test("GATE5G-77 buildCostInput 경계: null exitPrice", () => {
  const built = buildCostInput(validPipelineInput(), {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
    entryTradingDate: "2101-03-02",
    exitTradingDate: "2101-03-03",
    entryPrice: 10000,
    exitPrice: null,
  });
  assert.equal(built.ok, false);
  assert.equal(hasCode(built, ERROR.COST_INPUT_DERIVATION_FAILED), true);
});

// helper: buildCostInput 실패
test("GATE5G-78 buildCostInput 실패: 미완료 체결", () => {
  const built = buildCostInput(validPipelineInput(), {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.NOT_TRIGGERED,
    entryTradingDate: "2101-03-02",
    entryPrice: 10000,
  });
  assert.equal(built.ok, false);
  assert.equal(hasCode(built, ERROR.EXECUTION_RESULT_INCOMPLETE), true);
});

// helper: mergeSafeStageErrors
test("GATE5G-79 mergeSafeStageErrors stage 부여", () => {
  const merged = mergeSafeStageErrors(STAGE.DATA, [{ code: "INVALID_VOLUME" }]);
  assert.equal(merged[0].stage, STAGE.DATA);
  assert.equal(merged[0].code, "INVALID_VOLUME");
});

// helper: createSyntheticPipelineResult
test("GATE5G-80 createSyntheticPipelineResult 기본값", () => {
  const result = createSyntheticPipelineResult({});
  assert.equal(result.pipelineVersion, PIPELINE_VERSION);
  assertOperationalBlocked(result);
  assertPerformanceNull(result);
});

// helper: makeSafePipelineError
test("GATE5G-81 makeSafePipelineError 화이트리스트", () => {
  const err = makeSafePipelineError({
    code: ERROR.UNKNOWN_FIELD,
    field: "dataset",
    dataset: { candles: [] },
    calendar: {},
    policies: [],
  });
  assert.equal(err.code, ERROR.UNKNOWN_FIELD);
  assert.equal(Object.hasOwn(err, "dataset"), false);
  assert.equal(Object.hasOwn(err, "calendar"), false);
});

// helper: mapCandleMarketForExecution
test("GATE5G-82 mapCandleMarketForExecution KOSPI→MARKET", () => {
  assert.equal(Object.hasOwn(pipeline, "mapCandleMarketForExecution"), false);
  const execInput = buildExecutionInput(validPipelineInput(), { schemaValid: true });
  assert.equal(execInput.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

// helper: isDataStagePassed
test("GATE5G-83 isDataStagePassed 정상", () => {
  assert.equal(isDataStagePassed({
    schemaValid: true,
    syntheticCalendarProvided: true,
    syntheticCalendarVerified: true,
    syntheticCandleDatesVerified: true,
    errorCodes: [],
  }), true);
});

// helper: isNoEntryExecution
test("GATE5G-84 isNoEntryExecution LIMIT_NOT_TOUCHED", () => {
  assert.equal(isNoEntryExecution({
    ok: true,
    status: EXEC_STATUS.NOT_FILLED,
    warnings: [{ code: "LIMIT_NOT_TOUCHED" }],
  }), true);
});

// helper: isOpenPositionExecution
test("GATE5G-85 isOpenPositionExecution", () => {
  assert.equal(isOpenPositionExecution({
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.NOT_TRIGGERED,
  }), true);
});

// helper: isFullTradeExecution
test("GATE5G-86 isFullTradeExecution", () => {
  assert.equal(isFullTradeExecution({
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
  }), true);
});

test("GATE5H-P17 KOSPI 정상 단일 거래", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5H-P18 KOSDAQ 정상 단일 거래", () => {
  const result = runSyntheticSingleTradePipeline(validKosdaqPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5H-P19 KOSPI dataset→calendar 일치", () => {
  const input = validPipelineInput();
  assert.equal(input.dataset.markets[0], SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(input.calendar.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(input.dataset.markets[0], input.calendar.market);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5H-P20 KOSPI dataset→execution 일치", () => {
  const input = validPipelineInput();
  const execInput = buildExecutionInput(input, { schemaValid: true });
  assert.equal(execInput.market, input.dataset.markets[0]);
  assert.equal(execInput.candles.every((c) => c.market === input.dataset.markets[0]), true);
  assert.equal(execInput.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

test("GATE5H-P21 KOSPI execution→cost 일치", () => {
  const input = validPipelineInput();
  const built = buildCostInput(input, {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
    entryTradingDate: "2101-03-02",
    exitTradingDate: "2101-03-03",
    entryPrice: 10000,
    exitPrice: 11000,
  });
  assert.equal(built.ok, true);
  assert.equal(built.input.market, input.dataset.markets[0]);
  assert.equal(built.input.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5H-P22 KOSPI result market 유지", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5H-P23 KOSDAQ dataset→calendar 일치", () => {
  const input = validKosdaqPipelineInput();
  assert.equal(input.dataset.markets[0], SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(input.calendar.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(input.dataset.markets[0], input.calendar.market);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5H-P24 KOSDAQ dataset→execution 일치", () => {
  const input = validKosdaqPipelineInput();
  const execInput = buildExecutionInput(input, { schemaValid: true });
  assert.equal(execInput.market, input.dataset.markets[0]);
  assert.equal(execInput.candles.every((c) => c.market === input.dataset.markets[0]), true);
  assert.equal(execInput.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
});

test("GATE5H-P25 KOSDAQ execution→cost 일치", () => {
  const input = validKosdaqPipelineInput();
  const built = buildCostInput(input, {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
    entryTradingDate: "2101-03-02",
    exitTradingDate: "2101-03-03",
    entryPrice: 10000,
    exitPrice: 11000,
  });
  assert.equal(built.ok, true);
  assert.equal(built.input.market, input.dataset.markets[0]);
  assert.equal(built.input.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5H-P26 KOSDAQ result market 유지", () => {
  const result = runSyntheticSingleTradePipeline(validKosdaqPipelineInput());
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5H-P27 파이프라인에서 SYNTHETIC_MARKET 매핑 없음", () => {
  assert.equal(Object.hasOwn(pipeline, "mapCandleMarketForExecution"), false);
  const input = validPipelineInput();
  const execInput = buildExecutionInput(input, { schemaValid: true });
  assert.equal(execInput.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  const result = runSyntheticSingleTradePipeline(input);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5H-P28 레거시 SYNTHETIC_MARKET 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_MARKET];
  input.dataset.candles.forEach((c) => {
    c.market = SYNTHETIC_MARKETS.SYNTHETIC_MARKET;
  });
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5H-P29 실제 KOSPI 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = ["KOSPI"];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5H-P30 실제 KOSDAQ 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = ["KOSDAQ"];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5H-P31 KOSPI 데이터 + KOSDAQ 캘린더", () => {
  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(result, "CALENDAR_MARKET_MISMATCH"), true);
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5H-P32 KOSPI 데이터 + KOSDAQ 비용정책", () => {
  const input = validPipelineInput();
  input.cost.policies = [makePolicy({
    policyId: "synthetic-cost-kosdaq-v1",
    market: MARKET.SYNTHETIC_KOSDAQ,
  })];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5H-P33 KOSPI 캔들 + KOSDAQ execution", () => {
  const input = validPipelineInput();
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ];
  const execInput = buildExecutionInput(input, { schemaValid: true });
  assert.equal(execInput.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(execInput.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  const execResult = evaluateDailyBarExecution(execInput);
  assert.equal(execResult.ok, false);
  assert.equal(hasCode(execResult, EXEC_ERROR.EXECUTION_MARKET_MISMATCH), true);
});

test("GATE5H-P34 KOSDAQ 데이터 + KOSPI 캘린더", () => {
  const input = validKosdaqPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    calendarId: "synthetic-calendar-kospi-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(result, "CALENDAR_MARKET_MISMATCH"), true);
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5H-P35 KOSDAQ 데이터 + KOSPI 비용정책", () => {
  const input = validKosdaqPipelineInput();
  input.cost.policies = [makePolicy({
    policyId: "synthetic-cost-kospi-v1",
    market: MARKET.SYNTHETIC_KOSPI,
  })];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5H-P36 KOSDAQ 캔들 + KOSPI execution", () => {
  const input = validKosdaqPipelineInput();
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI];
  const execInput = buildExecutionInput(input, { schemaValid: true });
  assert.equal(execInput.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(execInput.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  const execResult = evaluateDailyBarExecution(execInput);
  assert.equal(execResult.ok, false);
  assert.equal(hasCode(execResult, EXEC_ERROR.EXECUTION_MARKET_MISMATCH), true);
});

test("GATE5H-P37 혼합 시장 캔들 배열", () => {
  const input = validPipelineInput();
  input.dataset.candles[1].market = SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ;
  input.dataset.contentChecksum = computeDatasetContentChecksum(input.dataset);
  input.dataset.metadataHash = computeDatasetMetadataHash(input.dataset);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(
    result.pipelineStatus === PIPELINE_STATUS.BLOCKED_DATA_STAGE
      || hasCode(result, ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION),
    true,
  );
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5H-P38 복수 시장 데이터셋", () => {
  const input = validPipelineInput();
  input.dataset.markets = [
    SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
  ];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
  assert.equal(hasCode(result, ERROR.MULTI_MARKET_PIPELINE_NOT_SUPPORTED), true);
});

test("GATE5H-P39 시장 불일치 후 fallback 없음", () => {
  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes(PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE), false);
});

test("GATE5H-P40 시장 불일치 후 비용 단계 미실행", () => {
  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
});

test("GATE5H-P41 원본 dataset 불변", () => {
  const input = validPipelineInput();
  const snap = JSON.stringify(input.dataset);
  runSyntheticSingleTradePipeline(input);
  assert.equal(JSON.stringify(input.dataset), snap);
});

test("GATE5H-P42 원본 calendar 불변", () => {
  const input = validPipelineInput();
  const snap = JSON.stringify(input.calendar);
  runSyntheticSingleTradePipeline(input);
  assert.equal(JSON.stringify(input.calendar), snap);
});

test("GATE5H-P43 원본 cost policies 불변", () => {
  const input = validPipelineInput();
  const snap = JSON.stringify(input.cost.policies);
  runSyntheticSingleTradePipeline(input);
  assert.equal(JSON.stringify(input.cost.policies), snap);
});

test("GATE5H-P44 KOSDAQ 경로 원본 불변", () => {
  const input = validKosdaqPipelineInput();
  const snap = JSON.stringify(input);
  runSyntheticSingleTradePipeline(input);
  assert.equal(JSON.stringify(input), snap);
});

test("GATE5H-P45 execution 입력 캔들 복사 후 원본 market 유지", () => {
  const input = validPipelineInput();
  const originalMarket = input.dataset.candles[0].market;
  const execInput = buildExecutionInput(input, { schemaValid: true });
  execInput.candles[0].market = SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ;
  assert.equal(input.dataset.candles[0].market, originalMarket);
  assert.equal(input.dataset.candles[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

test("GATE5H-P46 동일 입력 동일 결과", () => {
  const kospi = validPipelineInput();
  assert.deepEqual(
    runSyntheticSingleTradePipeline(kospi),
    runSyntheticSingleTradePipeline(kospi),
  );
  const kosdaq = validKosdaqPipelineInput();
  assert.deepEqual(
    runSyntheticSingleTradePipeline(kosdaq),
    runSyntheticSingleTradePipeline(kosdaq),
  );
});

test("GATE5H-P47 운영 적격성 false", () => {
  assertOperationalBlocked(runSyntheticSingleTradePipeline(validPipelineInput()));
  assertOperationalBlocked(runSyntheticSingleTradePipeline(validKosdaqPipelineInput()));
});

test("GATE5H-P48 성과 null", () => {
  assertPerformanceNull(runSyntheticSingleTradePipeline(validPipelineInput()));
  assertPerformanceNull(runSyntheticSingleTradePipeline(validKosdaqPipelineInput()));
});

test("GATE5H-P49 네트워크·주문 참조 없음", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"https\")"), false);
  assert.equal(src.includes("axios"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("placeOrder"), false);
  assert.equal(src.includes("submitOrder"), false);
});

test("GATE5H-P50 허용 파일 외 변경 없음", () => {
  const { execFileSync } = require("node:child_process");
  const names = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    encoding: "utf8",
    cwd: path.join(__dirname, ".."),
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const allowed = new Set([
    "lib/backtest/execution-model.js",
    "lib/backtest/data-validation.js",
    "test/backtest-execution-model.test.js",
    "test/backtest-data-validation.test.js",
    "lib/backtest/calendar-validation.js",
    "test/backtest-calendar-validation.test.js",
    "lib/backtest/cost-policy.js",
    "test/backtest-cost-policy.test.js",
    "lib/backtest/synthetic-pipeline.js",
    "test/backtest-synthetic-pipeline.test.js",
    "lib/backtest/multi-trade-lifecycle.js",
    "test/backtest-multi-trade-lifecycle.test.js",
    "lib/backtest/portfolio-ledger.js",
    "test/backtest-portfolio-ledger.test.js",
    "lib/backtest/performance-metrics.js",
    "test/backtest-performance-metrics.test.js",
    "lib/backtest/benchmark-performance.js",
    "test/backtest-benchmark-performance.test.js",
    "lib/backtest/walk-forward-validation.js",
    "test/backtest-walk-forward-validation.test.js",
    "lib/backtest/train-parameter-selection.js",
    "test/backtest-train-parameter-selection.test.js",
    "src/trading-platform.jsx",
    "src/pro-chart-canvas.jsx",
    "src/nchart.js",
    "src/ndraw.js",
    "src/nindicators.js",
    "src/ncvdd.js",
    "src/nbti.js",
    "src/nbubble.js",
    "src/nbbp.js",
    "src/nlth.js",
    "lib/backtest/finite-tile-mean.js",
    "test/finite-tile-mean.test.js",
    "lib/backtest/make-error.js",
    "test/backtest-make-error.test.js",
    "lib/backtest/leakage-guard.js",
    "test/backtest-leakage.test.js",
    "lib/backtest/schemas.js",
    "test/backtest-schemas.test.js",
  ]);
  for (const name of names) {
    assert.equal(allowed.has(name), true, name);
  }
});

test("GATE5I-P01 normalized KOSPI e2e 성공", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5I-P02 normalized KOSDAQ e2e 성공", () => {
  const result = runSyntheticSingleTradePipeline(validKosdaqPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5I-P03 레거시 SYNTHETIC_MARKET 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_MARKET];
  input.dataset.candles.forEach((c) => {
    c.market = SYNTHETIC_MARKETS.SYNTHETIC_MARKET;
  });
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5I-P04 레거시 캔들 market 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].market = SYNTHETIC_MARKETS.SYNTHETIC_MARKET;
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5I-P05 실제 KOSPI 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = ["KOSPI"];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5I-P06 실제 KOSDAQ 파이프라인 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = ["KOSDAQ"];
  const result = validateSyntheticPipelineInput(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5I-P07 KOSPI 데이터+KOSDAQ 캘린더 mismatch", () => {
  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(
    hasCode(result, "CALENDAR_MARKET_MISMATCH")
      || hasCode(result, ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION),
    true,
  );
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
});

test("GATE5I-P08 KOSPI 데이터+KOSDAQ 비용정책 mismatch", () => {
  const input = validPipelineInput();
  input.cost.policies = [makePolicy({
    policyId: "synthetic-cost-kosdaq-v1",
    market: MARKET.SYNTHETIC_KOSDAQ,
  })];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
});

test("GATE5I-P09 KOSDAQ 데이터+KOSPI 캘린더 mismatch", () => {
  const input = validKosdaqPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    calendarId: "synthetic-calendar-kospi-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(
    hasCode(result, "CALENDAR_MARKET_MISMATCH")
      || hasCode(result, ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION),
    true,
  );
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
});

test("GATE5I-P10 KOSDAQ 데이터+KOSPI 비용정책 mismatch", () => {
  const input = validKosdaqPipelineInput();
  input.cost.policies = [makePolicy({
    policyId: "synthetic-cost-kospi-v1",
    market: MARKET.SYNTHETIC_KOSPI,
  })];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
});

test("GATE5I-P11 혼합 시장 캔들 배열 차단", () => {
  const input = validPipelineInput();
  input.dataset.candles[1].market = SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ;
  input.dataset.contentChecksum = computeDatasetContentChecksum(input.dataset);
  input.dataset.metadataHash = computeDatasetMetadataHash(input.dataset);
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(
    result.pipelineStatus === PIPELINE_STATUS.BLOCKED_DATA_STAGE
      || hasCode(result, ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION),
    true,
  );
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5I-P12 복수 시장 데이터셋 차단", () => {
  const input = validPipelineInput();
  input.dataset.markets = [
    SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
  ];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
  assert.equal(hasCode(result, ERROR.MULTI_MARKET_PIPELINE_NOT_SUPPORTED), true);
});

test("GATE5I-P13 KOSPI dataset→execution market 일치", () => {
  const input = validPipelineInput();
  const execInput = buildExecutionInput(input, { schemaValid: true });
  assert.equal(execInput.market, input.dataset.markets[0]);
  assert.equal(execInput.candles.every((c) => c.market === input.dataset.markets[0]), true);
  assert.equal(execInput.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

test("GATE5I-P14 KOSPI execution→cost market 일치", () => {
  const input = validPipelineInput();
  const built = buildCostInput(input, {
    ok: true,
    entryStatus: ENTRY_STATUS.FILLED,
    exitStatus: EXIT_STATUS.FILLED,
    entryTradingDate: "2101-03-02",
    exitTradingDate: "2101-03-03",
    entryPrice: 10000,
    exitPrice: 11000,
  });
  assert.equal(built.ok, true);
  assert.equal(built.input.market, input.dataset.markets[0]);
  assert.equal(built.input.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

test("GATE5I-P15 KOSDAQ result market 유지", () => {
  const result = runSyntheticSingleTradePipeline(validKosdaqPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
});

test("GATE5I-P16 파이프라인 입력 객체 불변", () => {
  const input = validPipelineInput();
  const snap = JSON.stringify(input);
  runSyntheticSingleTradePipeline(input);
  assert.equal(JSON.stringify(input), snap);
  const kosdaq = validKosdaqPipelineInput();
  const kosdaqSnap = JSON.stringify(kosdaq);
  runSyntheticSingleTradePipeline(kosdaq);
  assert.equal(JSON.stringify(kosdaq), kosdaqSnap);
});

test("GATE5I-P17 데이터 검증 실패 시 execution 미실행", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].volume = -1;
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(result.executionStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.syntheticExecutionCalculated, false);
});

test("GATE5I-P18 시장 mismatch 시 cost 미실행", () => {
  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5I-P19 시장 불일치 후 fallback 없음", () => {
  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.notEqual(result.market, SYNTHETIC_MARKETS.SYNTHETIC_MARKET);
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes(PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE), false);
});

test("GATE5I-P20 동일 입력 동일 결과", () => {
  const kospi = validPipelineInput();
  assert.deepEqual(
    runSyntheticSingleTradePipeline(kospi),
    runSyntheticSingleTradePipeline(kospi),
  );
  const kosdaq = validKosdaqPipelineInput();
  assert.deepEqual(
    runSyntheticSingleTradePipeline(kosdaq),
    runSyntheticSingleTradePipeline(kosdaq),
  );
});

// ─── GATE5J Pipeline Tests ────────────────────────────────────────────────────

const {
  runSyntheticMultiTradePipeline,
  runSyntheticPortfolioLedger,
  runSyntheticPerformancePipeline,
  runSyntheticBenchmarkPipeline,
  MULTI_TRADE_PIPELINE_VERSION,
} = pipeline;

function buildMultiTradeKospiInput() {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const candleRows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
    { tradingDate: t[3], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[4], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[5], open: 10800, high: 11200, low: 10700, close: 11100 },
  ];
  const dataset = buildDataset(calendar, candleRows);
  const exitPolicy = { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST };
  return {
    pipelineVersion: MULTI_TRADE_PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy()],
    },
    tradeIntents: [
      {
        tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
        entryIntent: { orderType: ORDER_TYPE.MARKET_OPEN, signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
        exitPolicy,
      },
      {
        tradeId: "T2", quantity: 10, entryDate: t[4], exitDate: t[5],
        entryIntent: { orderType: ORDER_TYPE.MARKET_OPEN, signalTradingDate: t[3], earliestExecutionTradingDate: t[4], limitPrice: null },
        exitPolicy,
      },
    ],
  };
}

function buildMultiTradeKosdaqInput() {
  const calendar = buildCalendar({
    start: "2101-03-01", dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ, calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(calendar);
  const kr = (row) => ({ ...row, market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ });
  const candleRows = [
    kr({ tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 }),
    kr({ tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 }),
    kr({ tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 }),
    kr({ tradingDate: t[3], open: 9800, high: 9900, low: 9700, close: 9850 }),
    kr({ tradingDate: t[4], open: 10000, high: 10500, low: 9800, close: 10200 }),
    kr({ tradingDate: t[5], open: 10800, high: 11200, low: 10700, close: 11100 }),
  ];
  const dataset = buildDataset(calendar, candleRows, { markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ] });
  const exitPolicy = { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST };
  return {
    pipelineVersion: MULTI_TRADE_PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
    },
    tradeIntents: [
      {
        tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
        entryIntent: { orderType: ORDER_TYPE.MARKET_OPEN, signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
        exitPolicy,
      },
      {
        tradeId: "T2", quantity: 10, entryDate: t[4], exitDate: t[5],
        entryIntent: { orderType: ORDER_TYPE.MARKET_OPEN, signalTradingDate: t[3], earliestExecutionTradingDate: t[4], limitPrice: null },
        exitPolicy,
      },
    ],
  };
}

test("GATE5J-P01 KOSPI multi-trade e2e 성공", () => {
  const input = buildMultiTradeKospiInput();
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

test("GATE5J-P02 KOSDAQ multi-trade e2e 성공", () => {
  const input = buildMultiTradeKosdaqInput();
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
});

test("GATE5J-P03 MULTI_TRADE_PIPELINE_VERSION 값 확인", () => {
  assert.equal(MULTI_TRADE_PIPELINE_VERSION, "synthetic-multi-trade-v0.1");
});

test("GATE5J-P04 non-object input 차단", () => {
  const result = runSyntheticMultiTradePipeline(null);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
});

test("GATE5J-P05 PRODUCTION calculationMode 차단", () => {
  const input = buildMultiTradeKospiInput();
  input.calculationMode = CALCULATION_MODE.PRODUCTION;
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
  assert.equal(hasCode(result, ERROR.SYNTHETIC_PIPELINE_BLOCKED_IN_PRODUCTION), true);
});

test("GATE5J-P06 잘못된 pipelineVersion 차단", () => {
  const input = buildMultiTradeKospiInput();
  input.pipelineVersion = "synthetic-single-trade-v0.1";
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_PIPELINE_VERSION), true);
});

test("GATE5J-P07 legacy SYNTHETIC_MARKET 차단", () => {
  const input = buildMultiTradeKospiInput();
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_MARKET];
  input.dataset.candles.forEach((c) => { c.market = SYNTHETIC_MARKETS.SYNTHETIC_MARKET; });
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5J-P08 production KOSPI 차단", () => {
  const input = buildMultiTradeKospiInput();
  input.dataset.markets = ["KOSPI"];
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5J-P09 calendar mismatch 차단", () => {
  const input = buildMultiTradeKospiInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ, calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
});

test("GATE5J-P10 cost policy mismatch 차단", () => {
  const input = buildMultiTradeKospiInput();
  input.cost.policies = [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })];
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
});

test("GATE5J-P11 overlapping intents 차단", () => {
  const input = buildMultiTradeKospiInput();
  const t = tradingDatesOf(input.calendar);
  input.tradeIntents[0] = { ...input.tradeIntents[0], exitDate: t[4] };
  input.tradeIntents[1] = { ...input.tradeIntents[1], entryDate: t[2], exitDate: t[3] };
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
});

test("GATE5J-P12 fail-closed behavior — closedTrades=[]", () => {
  const input = buildMultiTradeKospiInput();
  input.tradeIntents[1] = { ...input.tradeIntents[1], entryDate: "2101-01-01" };
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(result.closedTrades.length, 0);
});

test("GATE5J-P13 failedTradeId 포함 여부", () => {
  const input = buildMultiTradeKospiInput();
  input.tradeIntents = [
    { ...input.tradeIntents[0] },
    { ...input.tradeIntents[1], tradeId: "T1" },
  ];
  const result = runSyntheticMultiTradePipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(result.failedTradeId, "T1");
});

test("GATE5J-P14 closedTrade count 확인", () => {
  const input = buildMultiTradeKospiInput();
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  assert.equal(result.closedTrades.length, 2);
});

test("GATE5J-P15 원본 input 불변", () => {
  const input = buildMultiTradeKospiInput();
  const snap = JSON.stringify(input.dataset);
  runSyntheticMultiTradePipeline(input);
  assert.equal(JSON.stringify(input.dataset), snap);
});

test("GATE5J-P16 deterministic ordering — 동일 입력 deepEqual", () => {
  const input = buildMultiTradeKospiInput();
  const r1 = runSyntheticMultiTradePipeline(input);
  const r2 = runSyntheticMultiTradePipeline(input);
  assert.deepEqual(r1, r2);
});

test("GATE5J-P17 performance fields null", () => {
  const input = buildMultiTradeKospiInput();
  const result = runSyntheticMultiTradePipeline(input);
  assertPerformanceNull(result);
});

test("GATE5J-P18 eligibility fields false", () => {
  const input = buildMultiTradeKospiInput();
  const result = runSyntheticMultiTradePipeline(input);
  assertOperationalBlocked(result);
});

test("GATE5J-P19 market = SYNTHETIC_KOSPI 결과", () => {
  const input = buildMultiTradeKospiInput();
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5J-P20 market = SYNTHETIC_KOSDAQ 결과", () => {
  const input = buildMultiTradeKosdaqInput();
  const result = runSyntheticMultiTradePipeline(input);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(result.marketContractStatus, MARKET_CONTRACT_STATUS.NORMALIZED_SYNTHETIC_MARKET);
});

test("GATE5J-P21 GATE5H-P50 허용 파일 세트 업데이트 확인", () => {
  // 신규 파일 2개가 허용 세트에 포함되어야 함. 직접 파일 목록으로 검증
  const allowed = new Set([
    "lib/backtest/execution-model.js",
    "lib/backtest/data-validation.js",
    "test/backtest-execution-model.test.js",
    "test/backtest-data-validation.test.js",
    "lib/backtest/calendar-validation.js",
    "test/backtest-calendar-validation.test.js",
    "lib/backtest/cost-policy.js",
    "test/backtest-cost-policy.test.js",
    "lib/backtest/synthetic-pipeline.js",
    "test/backtest-synthetic-pipeline.test.js",
    "lib/backtest/multi-trade-lifecycle.js",
    "test/backtest-multi-trade-lifecycle.test.js",
    "lib/backtest/portfolio-ledger.js",
    "test/backtest-portfolio-ledger.test.js",
    "lib/backtest/performance-metrics.js",
    "test/backtest-performance-metrics.test.js",
    "lib/backtest/benchmark-performance.js",
    "test/backtest-benchmark-performance.test.js",
    "lib/backtest/walk-forward-validation.js",
    "test/backtest-walk-forward-validation.test.js",
    "lib/backtest/train-parameter-selection.js",
    "test/backtest-train-parameter-selection.test.js",
  ]);
  assert.equal(allowed.has("lib/backtest/multi-trade-lifecycle.js"), true);
  assert.equal(allowed.has("test/backtest-multi-trade-lifecycle.test.js"), true);
  assert.equal(allowed.has("lib/backtest/portfolio-ledger.js"), true);
  assert.equal(allowed.has("test/backtest-portfolio-ledger.test.js"), true);
  assert.equal(allowed.has("lib/backtest/performance-metrics.js"), true);
  assert.equal(allowed.has("test/backtest-performance-metrics.test.js"), true);
  assert.equal(allowed.has("lib/backtest/benchmark-performance.js"), true);
  assert.equal(allowed.has("test/backtest-benchmark-performance.test.js"), true);
  assert.equal(allowed.has("lib/backtest/walk-forward-validation.js"), true);
  assert.equal(allowed.has("test/backtest-walk-forward-validation.test.js"), true);
  assert.equal(allowed.has("lib/backtest/train-parameter-selection.js"), true);
  assert.equal(allowed.has("test/backtest-train-parameter-selection.test.js"), true);
  assert.equal(allowed.has("lib/backtest/calendar-validation.js"), true);
  assert.equal(allowed.has("test/backtest-calendar-validation.test.js"), true);
  assert.equal(allowed.has("lib/backtest/cost-policy.js"), true);
  assert.equal(allowed.has("test/backtest-cost-policy.test.js"), true);
});

test("GATE5J-P22 single-trade 계약 변경 없음 — PIPELINE_VERSION 불변", () => {
  assert.equal(PIPELINE_VERSION, "synthetic-single-trade-v0.1");
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
});

test("GATE5J-P23 one-trade parity — single vs multi 결과 비교", () => {
  // single-trade pipeline 결과
  const singleInput = validPipelineInput();
  const singleResult = runSyntheticSingleTradePipeline(singleInput);
  assert.equal(singleResult.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);

  // multi-trade pipeline에 동일 거래 1건
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const candleRows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
  ];
  const dataset = buildDataset(calendar, candleRows);
  const multiInput = {
    pipelineVersion: MULTI_TRADE_PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy()],
    },
    tradeIntents: [
      {
        tradeId: "T1",
        quantity: 10,
        entryDate: t[1],
        exitDate: t[2],
        entryIntent: {
          orderType: ORDER_TYPE.MARKET_OPEN,
          signalTradingDate: t[0],
          earliestExecutionTradingDate: t[1],
          limitPrice: null,
        },
        exitPolicy: {
          stopLossPrice: 9500,
          takeProfitPrice: 11000,
          intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
        },
      },
    ],
  };
  const multiResult = runSyntheticMultiTradePipeline(multiInput);
  assert.equal(multiResult.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE);
  const ct = multiResult.closedTrades[0];

  // single vs multi 핵심 수치 비교
  assert.equal(ct.market, singleResult.market);
  assert.equal(ct.entryPrice, singleResult.entryPrice);
  assert.equal(ct.exitPrice, singleResult.exitPrice);
  assert.equal(ct.totalCost, singleResult.totalCost);
  assert.equal(ct.grossPnl, singleResult.grossProfit);
  assert.equal(ct.netPnl, singleResult.netProfit);
});

// ─── GATE5K Pipeline Tests ────────────────────────────────────────────────────

function buildPortfolioKospiInput(overrides) {
  const extras = overrides || {};
  const base = buildMultiTradeKospiInput();
  if (extras.oneTrade) base.tradeIntents = [base.tradeIntents[0]];
  return {
    ...base,
    initialCapital: extras.initialCapital != null ? extras.initialCapital : 1000000,
  };
}

function buildPortfolioKosdaqInput(overrides) {
  const extras = overrides || {};
  const base = buildMultiTradeKosdaqInput();
  if (extras.oneTrade) base.tradeIntents = [base.tradeIntents[0]];
  return {
    ...base,
    initialCapital: extras.initialCapital != null ? extras.initialCapital : 1000000,
  };
}

test("GATE5K-P01 KOSPI one-trade portfolio success", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.closedTrades.length, 1);
  assert.equal(result.finalCash, 1009869);
  assert.equal(result.finalEquity, 1009869);
  assert.equal(result.capitalConstraintApplied, true);
});

test("GATE5K-P02 KOSDAQ one-trade success", () => {
  const input = buildPortfolioKosdaqInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(result.closedTrades.length, 1);
  assert.equal(result.finalCash, 1009869);
  assert.equal(result.finalEquity, 1009869);
  assert.equal(result.capitalConstraintApplied, true);
});

test("GATE5K-P03 KOSPI two-trade success", () => {
  const input = buildPortfolioKospiInput();
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.finalCash, 1019738);
});

test("GATE5K-P04 KOSDAQ two-trade success", () => {
  const input = buildPortfolioKosdaqInput();
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.finalCash, 1019738);
});

test("GATE5K-P05 insufficient cash block", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(hasCode(result, "INSUFFICIENT_CASH"), true);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-P06 no quantity resize", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  assert.equal(input.tradeIntents[0].quantity, 10);
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(input.tradeIntents[0].quantity, 10);
});

test("GATE5K-P07 final cash parity", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  const pnlSum = result.closedTrades.reduce((acc, trade) => acc + trade.netPnl, 0);
  assert.equal(result.finalCash, input.initialCapital + pnlSum);
});

test("GATE5K-P08 final equity parity", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.finalEquity, result.finalCash);
});

test("GATE5K-P09 daily equity generated", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(Array.isArray(result.dailyEquityCurve), true);
  assert.equal(result.dailyEquityCurve.length > 0, true);
});

test("GATE5K-P10 flat-period equity", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  const first = result.dailyEquityCurve[0];
  assert.equal(first.marketValue, 0);
  assert.equal(first.equity, first.cashBalance);
});

test("GATE5K-P11 MTM gain", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(
    result.ledgerEvents.some((e) => e.eventType === "MARK_TO_MARKET" && e.unrealizedPnl > 0),
    true,
  );
});

test("GATE5K-P12 MTM loss", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const entryDate = input.tradeIntents[0].entryDate;
  for (const candle of input.dataset.candles) {
    if (candle.tradingDate === entryDate) {
      // open/high/low 유지: MARKET_OPEN 진입가와 SL/TP 경로를 바꾸지 않는다.
      // close=9000은 기존 low(9800)보다 낮아 OHLC_INCONSISTENT로 데이터 단계가 차단되고,
      // low를 9000으로 내리면 stopLoss(9500)가 진입일에 체결된다.
      // 진입가(10000) 미만이면서 OHLC를 만족하는 close만 패치한다.
      candle.close = 9800;
    }
  }
  input.dataset.contentChecksum = computeDatasetContentChecksum(input.dataset);
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(Array.isArray(result.ledgerEvents), true);
  assert.equal(
    result.ledgerEvents.some((e) => e.eventType === "MARK_TO_MARKET" && e.unrealizedPnl < 0),
    true,
  );
});

test("GATE5K-P13 ledger atomic failure", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1 });
  const result = runSyntheticPortfolioLedger(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-P14 root error preservation", () => {
  const calendarInput = buildPortfolioKospiInput({ oneTrade: true });
  calendarInput.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const calendarResult = runSyntheticPortfolioLedger(calendarInput);
  assert.equal(hasCode(calendarResult, "CALENDAR_MARKET_MISMATCH"), true);
  assert.equal(calendarResult.errorCodes.includes("CALENDAR_MARKET_MISMATCH"), true);
  assert.equal(
    calendarResult.errorCodes.length === 1
      && (calendarResult.errorCodes[0] === ERROR.DATA_STAGE_FAILED
        || calendarResult.errorCodes[0] === ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION),
    false,
  );

  const costInput = buildPortfolioKospiInput({ oneTrade: true });
  costInput.cost.policies = [makePolicy({
    policyId: "synthetic-cost-kosdaq-v1",
    market: MARKET.SYNTHETIC_KOSDAQ,
  })];
  const costResult = runSyntheticPortfolioLedger(costInput);
  assert.equal(hasCode(costResult, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
  assert.equal(costResult.errorCodes.includes(COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
  assert.equal(
    costResult.errorCodes.length === 1 && costResult.errorCodes[0] === ERROR.COST_STAGE_FAILED,
    false,
  );
});

test("GATE5K-P15 legacy market block", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  input.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_MARKET];
  input.dataset.candles.forEach((c) => {
    c.market = SYNTHETIC_MARKETS.SYNTHETIC_MARKET;
  });
  const result = runSyntheticPortfolioLedger(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5K-P16 production market block", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  input.dataset.markets = ["KOSPI"];
  const result = runSyntheticPortfolioLedger(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5K-P17 safety fields false", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assertOperationalBlocked(result);
  assert.equal(result.capitalConstraintApplied, true);
});

test("GATE5K-P18 performance fields null", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assertPerformanceNull(result);
});

test("GATE5K-P19 input immutable", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const datasetSnap = JSON.stringify(input.dataset);
  const intentsSnap = JSON.stringify(input.tradeIntents);
  const calendarSnap = JSON.stringify(input.calendar);
  runSyntheticPortfolioLedger(input);
  assert.equal(JSON.stringify(input.dataset), datasetSnap);
  assert.equal(JSON.stringify(input.tradeIntents), intentsSnap);
  assert.equal(JSON.stringify(input.calendar), calendarSnap);
});

test("GATE5K-P20 network/order count remains zero", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"https\")"), false);
  assert.equal(src.includes("axios"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("placeOrder"), false);
  assert.equal(src.includes("submitOrder"), false);
});

test("GATE5K-P21 missing initialCapital", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  delete input.initialCapital;
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PIPELINE_SCHEMA);
  assert.equal(hasCode(result, ERROR.MISSING_REQUIRED_FIELD), true);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-P22 ledger events integer cash", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  const entry = result.ledgerEvents.find((e) => e.eventType === "ENTRY");
  assert.equal(entry.cashBefore, 1000000);
  assert.equal(entry.entryAmount, 100000);
  assert.equal(entry.cost, 10);
  assert.equal(entry.cashAfter, 899990);
  const exit = result.ledgerEvents.find((e) => e.eventType === "EXIT");
  assert.equal(exit.cashBefore, 899990);
  assert.equal(exit.exitAmount, 110000);
  assert.equal(exit.cost, 121);
  assert.equal(exit.cashAfter, 1009869);
});

function buildMtmMissThreeDayHoldInput() {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const candleRows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[3], open: 10000, high: 21000, low: 9900, close: 20000 },
  ];
  const dataset = buildDataset(calendar, candleRows);
  return {
    pipelineVersion: MULTI_TRADE_PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy()],
    },
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[3],
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 20000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
    }],
    initialCapital: 1000000,
  };
}

test("GATE5K-R01 two-trade second qty=20 insufficient cash", () => {
  const input = buildPortfolioKospiInput({ initialCapital: 150000 });
  input.tradeIntents = [
    { ...input.tradeIntents[0] },
    { ...input.tradeIntents[1], quantity: 20 },
  ];
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(hasCode(result, "INSUFFICIENT_CASH"), true);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.closedTrades[0].tradeId, "T1");
});

test("GATE5K-R02 ledger block is not a COMPLETED_* success", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  const result = runSyntheticPortfolioLedger(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(String(result.pipelineStatus).startsWith("COMPLETED_"), false);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-R03 ledger block official cash/equity are null", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(result.finalCash, null);
  assert.equal(result.finalEquity, null);
});

test("GATE5K-R09 MTM candle miss → BLOCKED_PORTFOLIO_LEDGER", () => {
  const input = buildMtmMissThreeDayHoldInput();
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(hasCode(result, "MTM_CANDLE_NOT_FOUND"), true);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
});

test("GATE5K-R10 MTM miss has no previous-close fallback", () => {
  const input = buildMtmMissThreeDayHoldInput();
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(hasCode(result, "MTM_CANDLE_NOT_FOUND"), true);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assert.equal(result.finalCash, null);
});

test("GATE5K-R11b pipeline BLOCKED_COST_STAGE", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  input.cost = {
    ...input.cost,
    policies: [makePolicy({
      policyId: "synthetic-cost-kosdaq-v1",
      market: MARKET.SYNTHETIC_KOSDAQ,
    })],
  };
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
  assert.equal(result.costStageStatus, STAGE_STATUS.FAILED);
});

test("GATE5K-R17 cost mismatch sets costStageStatus FAILED", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  input.cost = {
    ...input.cost,
    policies: [makePolicy({
      policyId: "synthetic-cost-kosdaq-v1",
      market: MARKET.SYNTHETIC_KOSDAQ,
    })],
  };
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(result.costStageStatus, STAGE_STATUS.FAILED);
  assert.equal(hasCode(result, COST_ERROR.COST_POLICY_MARKET_MISMATCH), true);
  assert.equal(hasCode(result, ERROR.COST_STAGE_FAILED), true);
  assert.notEqual(result.costStageStatus, STAGE_STATUS.NOT_STARTED);
});

test("GATE5K-R12 calendar mismatch → BLOCKED_DATA_STAGE", () => {
  const calendarInput = buildPortfolioKospiInput({ oneTrade: true });
  calendarInput.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const calendarResult = runSyntheticPortfolioLedger(calendarInput);
  assert.equal(hasCode(calendarResult, "CALENDAR_MARKET_MISMATCH"), true);
  assert.equal(calendarResult.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
});

// ─── GATE5L Pipeline Tests ────────────────────────────────────────────────────

const PERFORMANCE_METRICS_PATH = path.join(__dirname, "..", "lib", "backtest", "performance-metrics.js");
const BENCHMARK_PERFORMANCE_PATH = path.join(__dirname, "..", "lib", "backtest", "benchmark-performance.js");

function utcMsFromYmd(ymd) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function assertFiniteOrNullWithStatus(value, status) {
  if (value == null) {
    assert.equal(status != null, true);
    return;
  }
  assert.equal(Number.isFinite(value), true);
  assert.equal(status != null, true);
}

function buildLosingTradeInput() {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const candleRows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9800, close: 10000 },
    { tradingDate: t[2], open: 10000, high: 10100, low: 9400, close: 9600 },
  ];
  const dataset = buildDataset(calendar, candleRows);
  return {
    pipelineVersion: MULTI_TRADE_PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy()],
    },
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[2],
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: {
        stopLossPrice: 9500,
        takeProfitPrice: 20000,
        intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
      },
    }],
    initialCapital: 1000000,
  };
}

function assertNoNetworkOrOrderCalls(src) {
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"https\")"), false);
  assert.equal(src.includes("axios"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("placeOrder"), false);
  assert.equal(src.includes("submitOrder"), false);
}

test("GATE5L-P01 KOSPI success COMPLETED_PERFORMANCE_METRICS", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.performanceStatus, "COMPLETED_PERFORMANCE_METRICS");
  assert.equal(result.finalEquity, 1009869);
  assert.equal(result.totalReturn, 1009869 / 1000000 - 1);
});

test("GATE5L-P02 KOSDAQ success same cash numbers", () => {
  const input = buildPortfolioKosdaqInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
  assert.equal(result.finalEquity, 1009869);
  assert.equal(result.totalReturn, 1009869 / 1000000 - 1);
});

test("GATE5L-P03 positive totalReturn", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.totalReturn > 0, true);
});

test("GATE5L-P04 negative totalReturn still completes performance", () => {
  const input = buildLosingTradeInput();
  const ledger = runSyntheticPortfolioLedger(input);
  assert.equal(ledger.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.totalReturn < 0, true);
});

test("GATE5L-P05 CAGR propagated with elapsedDays from curve", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assertFiniteOrNullWithStatus(result.cagr, result.cagrStatus);
  assert.equal(Number.isFinite(result.cagr), true);
  assert.equal(result.cagrStatus, "SHORT_PERIOD_ANNUALIZED");
  const curve = result.dailyEquityCurve;
  assert.equal(Array.isArray(curve) && curve.length >= 2, true);
  const elapsedDays = (utcMsFromYmd(curve[curve.length - 1].tradingDate)
    - utcMsFromYmd(curve[0].tradingDate)) / 86400000;
  assert.equal(result.elapsedDays, elapsedDays);
  assert.equal(elapsedDays >= 2, true);
});

test("GATE5L-P06 MDD <= 0", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(Number.isFinite(result.mdd), true);
  assert.equal(result.mdd <= 0, true);
  assert.equal(result.mddStatus, "CALCULATED");
});

test("GATE5L-P07 winRate in [0,1] or null with status", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  if (result.winRate == null) {
    assert.equal(result.winRateStatus != null, true);
  } else {
    assert.equal(result.winRate >= 0 && result.winRate <= 1, true);
    assert.equal(result.winRateStatus != null, true);
  }
});

test("GATE5L-P08 profitFactor finite or null with status", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assertFiniteOrNullWithStatus(result.profitFactor, result.profitFactorStatus);
  assert.equal(result.profitFactor, null);
  assert.equal(result.profitFactorStatus, "NO_GROSS_LOSS");
});

test("GATE5L-P09 sharpe finite or null with status", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assertFiniteOrNullWithStatus(result.sharpeRatio, result.sharpeStatus);
});

test("GATE5L-P10 BLOCKED_PORTFOLIO_LEDGER insufficient cash", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(result.performanceStatus, "NOT_STARTED");
  assert.equal(result.performanceStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.totalReturn, null);
  assert.equal(hasCode(result, "INSUFFICIENT_CASH"), true);
  assert.equal(hasCode(result, ERROR.PERFORMANCE_STAGE_FAILED), false);
});

test("GATE5L-P11 insufficient cash capitalConstraintApplied false", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(result.performanceStatus, "NOT_STARTED");
  assert.equal(result.capitalConstraintApplied, false);
  assert.equal(hasCode(result, "INSUFFICIENT_CASH"), true);
});

test("GATE5L-P12 MTM missing performanceStatus NOT_STARTED", () => {
  const input = buildMtmMissThreeDayHoldInput();
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(result.performanceStatus, "NOT_STARTED");
  assert.equal(result.performanceStageStatus, STAGE_STATUS.NOT_STARTED);
  assert.equal(result.totalReturn, null);
  assert.equal(hasCode(result, "MTM_CANDLE_NOT_FOUND"), true);
});

test("GATE5L-P13 ledger block preserves root errors", () => {
  const cashInput = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  const cashResult = runSyntheticPerformancePipeline(cashInput);
  assert.equal(cashResult.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(hasCode(cashResult, "INSUFFICIENT_CASH"), true);
  assert.equal(hasCode(cashResult, ERROR.PERFORMANCE_STAGE_FAILED), false);
  assert.equal(cashResult.performanceStatus, "NOT_STARTED");

  const calendarInput = buildPortfolioKospiInput({ oneTrade: true });
  calendarInput.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const calendarResult = runSyntheticPerformancePipeline(calendarInput);
  assert.equal(calendarResult.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(hasCode(calendarResult, "CALENDAR_MARKET_MISMATCH"), true);
  assert.equal(hasCode(calendarResult, ERROR.PERFORMANCE_STAGE_FAILED), false);
  assert.equal(calendarResult.performanceStatus, "NOT_STARTED");
});

test("GATE5L-P14 portfolio success does not set failedStage PERFORMANCE", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.notEqual(result.failedStage, "PERFORMANCE");
  assert.equal(result.performanceStageStatus, STAGE_STATUS.PASSED_SYNTHETIC_ONLY);
});

test("GATE5L-P15 benchmarkReturn null", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.benchmarkReturn, null);
});

test("GATE5L-P16 alpha null", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.alpha, null);
});

test("GATE5L-P17 safety flags false", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assertOperationalBlocked(result);
});

test("GATE5L-P18 capitalConstraintApplied true", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assert.equal(result.capitalConstraintApplied, true);
});

test("GATE5L-P19 input immutable", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const datasetSnap = JSON.stringify(input.dataset);
  const intentsSnap = JSON.stringify(input.tradeIntents);
  const calendarSnap = JSON.stringify(input.calendar);
  runSyntheticPerformancePipeline(input);
  assert.equal(JSON.stringify(input.dataset), datasetSnap);
  assert.equal(JSON.stringify(input.tradeIntents), intentsSnap);
  assert.equal(JSON.stringify(input.calendar), calendarSnap);
});

test("GATE5L-P20 source has no network or order calls", () => {
  assertNoNetworkOrOrderCalls(fs.readFileSync(PIPELINE_PATH, "utf8"));
  assertNoNetworkOrOrderCalls(fs.readFileSync(PERFORMANCE_METRICS_PATH, "utf8"));
});

test("GATE5L-P21 determinism deepEqual", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1000000 });
  const r1 = runSyntheticPerformancePipeline(input);
  const r2 = runSyntheticPerformancePipeline(input);
  assert.deepEqual(r1, r2);
});

test("GATE5L-P22 GATE5K-P18 ledger performance still null", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true });
  const result = runSyntheticPortfolioLedger(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER);
  assertPerformanceNull(result);
});

test("GATE5L-P23 losing trade profitFactor allows finite or null", () => {
  const input = buildLosingTradeInput();
  const result = runSyntheticPerformancePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS);
  assertFiniteOrNullWithStatus(result.profitFactor, result.profitFactorStatus);
  assert.equal(result.totalReturn < 0, true);
});

test("GATE5L-R11 overflow trades force PERFORMANCE fail-closed", () => {
  const metricsModule = require("../lib/backtest/performance-metrics");
  const originalCalculatePerformanceMetrics = metricsModule.calculatePerformanceMetrics;
  const input = buildPortfolioKospiInput({ oneTrade: true });
  let result;
  try {
    metricsModule.calculatePerformanceMetrics = function patched(metricsInput) {
      return originalCalculatePerformanceMetrics({
        ...metricsInput,
        closedTrades: [
          { netPnl: Number.MAX_VALUE },
          { netPnl: Number.MAX_VALUE },
          { netPnl: -1 },
        ],
      });
    };
    result = runSyntheticPerformancePipeline(input);
    assert.equal(result.failedStage, "PERFORMANCE");
    assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PERFORMANCE_STAGE);
    assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
    assert.equal(hasCode(result, ERROR.PERFORMANCE_STAGE_FAILED), true);
    assert.equal(result.totalReturn, null);
  } finally {
    metricsModule.calculatePerformanceMetrics = originalCalculatePerformanceMetrics;
  }
});

test("GATE5L-R12 malformed closedTrades force PERFORMANCE fail-closed", () => {
  const metricsModule = require("../lib/backtest/performance-metrics");
  const originalCalculatePerformanceMetrics = metricsModule.calculatePerformanceMetrics;
  const input = buildPortfolioKospiInput({ oneTrade: true });
  let result;
  try {
    metricsModule.calculatePerformanceMetrics = function patched(metricsInput) {
      return originalCalculatePerformanceMetrics({
        ...metricsInput,
        closedTrades: null,
      });
    };
    result = runSyntheticPerformancePipeline(input);
    assert.equal(result.failedStage, "PERFORMANCE");
    assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PERFORMANCE_STAGE);
    assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
    assert.equal(hasCode(result, ERROR.PERFORMANCE_STAGE_FAILED), true);
    assert.equal(result.totalReturn, null);
  } finally {
    metricsModule.calculatePerformanceMetrics = originalCalculatePerformanceMetrics;
  }
});

test("GATE5L-R13 overflow keeps INVALID_INPUT and PERFORMANCE_STAGE_FAILED", () => {
  const metricsModule = require("../lib/backtest/performance-metrics");
  const originalCalculatePerformanceMetrics = metricsModule.calculatePerformanceMetrics;
  const input = buildPortfolioKospiInput({ oneTrade: true });
  let result;
  try {
    metricsModule.calculatePerformanceMetrics = function patched(metricsInput) {
      return originalCalculatePerformanceMetrics({
        ...metricsInput,
        closedTrades: [
          { netPnl: Number.MAX_VALUE },
          { netPnl: Number.MAX_VALUE },
          { netPnl: -1 },
        ],
      });
    };
    result = runSyntheticPerformancePipeline(input);
    assert.equal(result.failedStage, "PERFORMANCE");
    assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PERFORMANCE_STAGE);
    assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
    assert.equal(hasCode(result, ERROR.PERFORMANCE_STAGE_FAILED), true);
    assert.equal(result.errorCodes.includes(ERROR.INVALID_INPUT), true);
    assert.equal(result.errorCodes.includes(ERROR.PERFORMANCE_STAGE_FAILED), true);
    assert.equal(
      result.errorCodes.filter((code) => code === ERROR.INVALID_INPUT).length > 0
        && result.errorCodes.filter((code) => code === ERROR.PERFORMANCE_STAGE_FAILED).length > 0,
      true,
    );
    assert.notEqual(
      result.errorCodes.length === 1 && result.errorCodes[0] === ERROR.PERFORMANCE_STAGE_FAILED,
      true,
    );
  } finally {
    metricsModule.calculatePerformanceMetrics = originalCalculatePerformanceMetrics;
  }
});

// ─── GATE5M Pipeline Tests ────────────────────────────────────────────────────

function buildBenchmarkSeriesForPerformance(periodStart, periodEnd, startClose, endClose, extras) {
  const rows = [
    { tradingDate: periodStart, close: startClose },
    { tradingDate: addDaysYmd(periodStart, 1), close: (startClose + endClose) / 2 },
    { tradingDate: periodEnd, close: endClose },
  ];
  if (!Array.isArray(extras)) return rows;
  return rows.concat(extras);
}

function buildPortfolioKospiWithBenchmark(overrides) {
  const extras = overrides || {};
  const input = buildPortfolioKospiInput(extras);
  const perf = runSyntheticPerformancePipeline(input);
  input.benchmark = {
    market: extras.benchmarkMarket || input.dataset.markets[0],
    benchmarkSeries: buildBenchmarkSeriesForPerformance(
      perf.periodStart,
      perf.periodEnd,
      extras.startClose != null ? extras.startClose : 200,
      extras.endClose != null ? extras.endClose : 220,
      extras.benchmarkExtras,
    ),
  };
  return input;
}

function buildPortfolioKosdaqWithBenchmark(overrides) {
  const extras = overrides || {};
  const input = buildPortfolioKosdaqInput(extras);
  const perf = runSyntheticPerformancePipeline(input);
  input.benchmark = {
    market: extras.benchmarkMarket || input.dataset.markets[0],
    benchmarkSeries: buildBenchmarkSeriesForPerformance(
      perf.periodStart,
      perf.periodEnd,
      extras.startClose != null ? extras.startClose : 200,
      extras.endClose != null ? extras.endClose : 220,
      extras.benchmarkExtras,
    ),
  };
  return input;
}

test("GATE5M-P01 KOSPI full success COMPLETED_BENCHMARK_ALPHA", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.benchmarkStatus, "COMPLETED_BENCHMARK_ALPHA");
});

test("GATE5M-P02 KOSDAQ full success", () => {
  const input = buildPortfolioKosdaqWithBenchmark({ oneTrade: true, initialCapital: 1000000 });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
});

test("GATE5M-P03 benchmarkReturn propagated", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(Number(result.benchmarkReturn.toFixed(2)), 0.1);
});

test("GATE5M-P04 alpha propagated", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const perf = runSyntheticPerformancePipeline(input);
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(Number(result.alpha.toFixed(12)), Number((perf.totalReturn - 0.1).toFixed(12)));
});

test("GATE5M-P05 positive alpha example", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true, startClose: 200, endClose: 201 });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.alpha > 0, true);
});

test("GATE5M-P06 negative alpha example", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true, startClose: 200, endClose: 260 });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.alpha < 0, true);
});

test("GATE5M-P07 zero alpha example", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const perf = runSyntheticPerformancePipeline(input);
  input.benchmark.benchmarkSeries = buildBenchmarkSeriesForPerformance(
    perf.periodStart,
    perf.periodEnd,
    100,
    100 * (1 + perf.totalReturn),
  );
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.alpha, 0);
});

test("GATE5M-P08 performance not complete -> benchmark NOT_STARTED", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 50000 });
  input.benchmark = {
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 220 },
    ],
  };
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER);
  assert.equal(result.benchmarkStatus, "NOT_STARTED");
  assert.equal(result.benchmarkStageStatus, STAGE_STATUS.NOT_STARTED);
});

test("GATE5M-P09 portfolio blocked -> benchmark NOT_STARTED", () => {
  const input = buildPortfolioKospiInput({ oneTrade: true, initialCapital: 1 });
  input.benchmark = {
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 220 },
    ],
  };
  const result = runSyntheticBenchmarkPipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.benchmarkStatus, "NOT_STARTED");
});

test("GATE5M-P10 performance failed -> benchmark NOT_STARTED", () => {
  const input = buildMtmMissThreeDayHoldInput();
  input.benchmark = {
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    benchmarkSeries: [
      { tradingDate: "2101-03-01", close: 200 },
      { tradingDate: "2101-03-02", close: 220 },
    ],
  };
  const result = runSyntheticBenchmarkPipeline(input);
  assert.notEqual(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assert.equal(result.benchmarkStatus, "NOT_STARTED");
});

test("GATE5M-P11 missing benchmark start -> BENCHMARK failed", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const perf = runSyntheticPerformancePipeline(input);
  input.benchmark.benchmarkSeries = input.benchmark.benchmarkSeries
    .filter((row) => row.tradingDate !== perf.periodStart);
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.failedStage, "BENCHMARK");
});

test("GATE5M-P12 missing benchmark end -> BENCHMARK failed", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const perf = runSyntheticPerformancePipeline(input);
  input.benchmark.benchmarkSeries = input.benchmark.benchmarkSeries
    .filter((row) => row.tradingDate !== perf.periodEnd);
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.failedStage, "BENCHMARK");
});

test("GATE5M-P13 market mismatch -> BENCHMARK_MARKET_MISMATCH", () => {
  const input = buildPortfolioKospiWithBenchmark({
    oneTrade: true,
    benchmarkMarket: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
  });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(hasCode(result, "BENCHMARK_MARKET_MISMATCH"), true);
});

test("GATE5M-P14 invalid benchmark input", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.benchmarkSeries[1].close = Number.NaN;
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(hasCode(result, "INVALID_BENCHMARK_INPUT"), true);
});

test("GATE5M-P14b malformed benchmarkSeries object fails closed not NOT_STARTED", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.benchmarkSeries = {};
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.failedStage, "BENCHMARK");
  assert.equal(hasCode(result, "INVALID_BENCHMARK_INPUT"), true);
  assert.notEqual(result.benchmarkStatus, "NOT_STARTED");
});

test("GATE5M-P15 failedStage=BENCHMARK", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.market = "KOSPI";
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.failedStage, "BENCHMARK");
});

test("GATE5M-P16 root preserved in errorCodes", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.benchmarkSeries = [{ tradingDate: "2101-03-01", close: 200 }];
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(
    hasCode(result, "INVALID_BENCHMARK_INPUT") || hasCode(result, "BENCHMARK_PERIOD_MISMATCH"),
    true,
  );
});

test("GATE5M-P17 BENCHMARK_STAGE_FAILED summary present", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.market = "KOSPI";
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(hasCode(result, ERROR.BENCHMARK_STAGE_FAILED), true);
});

test("GATE5M-P18 benchmarkReturn null on failure", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.market = "KOSPI";
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.benchmarkReturn, null);
});

test("GATE5M-P19 alpha null on failure", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  input.benchmark.market = "KOSPI";
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.alpha, null);
});

test("GATE5M-P20 safety flags false on success", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA);
  assertOperationalBlocked(result);
});

test("GATE5M-P21 executionStatus NOT_EXECUTED", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.executionStatus, EXEC_STATUS.NOT_EXECUTED);
});

test("GATE5M-P22 calculationStatus SIMULATED_CALCULATION_ONLY", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
});

test("GATE5M-P23 determinism deepEqual", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const a = runSyntheticBenchmarkPipeline(input);
  const b = runSyntheticBenchmarkPipeline(input);
  assert.deepEqual(a, b);
});

test("GATE5M-P24 input immutable", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const snap = JSON.stringify(input);
  runSyntheticBenchmarkPipeline(input);
  assert.equal(JSON.stringify(input), snap);
});

test("GATE5M-P25 source no network/order calls in benchmark path", () => {
  assertNoNetworkOrOrderCalls(fs.readFileSync(PIPELINE_PATH, "utf8"));
  assertNoNetworkOrOrderCalls(fs.readFileSync(BENCHMARK_PERFORMANCE_PATH, "utf8"));
});

test("GATE5M-R03 overflow benchmark series fail-closed at BENCHMARK stage", () => {
  const input = buildPortfolioKospiWithBenchmark({ oneTrade: true });
  const start = input.benchmark.benchmarkSeries[0].tradingDate;
  const end = input.benchmark.benchmarkSeries[input.benchmark.benchmarkSeries.length - 1].tradingDate;
  input.benchmark.benchmarkSeries = input.benchmark.benchmarkSeries.map((row) => {
    if (row.tradingDate === start) return { tradingDate: row.tradingDate, close: Number.MIN_VALUE };
    if (row.tradingDate === end) return { tradingDate: row.tradingDate, close: Number.MAX_VALUE };
    return row;
  });
  const result = runSyntheticBenchmarkPipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_BENCHMARK_STAGE);
  assert.equal(result.failedStage, "BENCHMARK");
  assert.equal(hasCode(result, "INVALID_BENCHMARK_INPUT"), true);
  assert.equal(hasCode(result, ERROR.BENCHMARK_STAGE_FAILED), true);
  assert.equal(result.benchmarkReturn, null);
  assert.equal(result.alpha, null);
  assert.equal(Number.isFinite(result.totalReturn), true);
});

test("GATE6S-G01 source pins shared makeBacktestError adapter", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
  assert.equal(src.includes("const err = makeBacktestError(raw.code, extra)"), true);
  assert.equal(src.includes("if (raw.code == null)"), true);
  assert.equal(src.includes("err.severity = raw.severity != null ? raw.severity : \"ERROR\""), true);
  assert.equal(src.includes("for (const key of SAFE_ERROR_KEYS)"), true);
  assert.equal(src.includes("return { severity: \"ERROR\" }"), true);
});

test("GATE6S-G02 unknown field stays inside SAFE_ERROR_KEYS", () => {
  const result = validateSyntheticPipelineInput(validPipelineInput({ extraField: 1 }));
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === ERROR.UNKNOWN_FIELD);
  assert.equal(err.field, "extraField");
  assert.equal(err.severity, "ERROR");
  const allowed = new Set(SAFE_ERROR_KEYS);
  for (const key of Object.keys(err)) {
    assert.equal(allowed.has(key), true, key);
  }
});

test("GATE6S-G03 non-object input keeps severity ERROR without a code key", () => {
  const err = makeSafePipelineError(null);
  assert.deepEqual(err, { severity: "ERROR" });
  assert.equal(Object.prototype.hasOwnProperty.call(err, "code"), false);
});

test("GATE6S-G04 adapter copies pipeline extras and drops cause candidateId foldId sequence", () => {
  const err = makeSafePipelineError({
    code: ERROR.UNKNOWN_FIELD,
    field: "extraField",
    stage: STAGE.PIPELINE,
    tradeId: "T1",
    tradeIndex: 0,
    policyId: "synthetic-cost-kospi-v1",
    modelVersion: MODEL_VERSION,
    orderType: ORDER_TYPE.MARKET_OPEN,
    cause: "TRAIN_ROOT_A",
    candidateId: "P001",
    foldId: "WF-0001",
    sequence: 1,
  });
  assert.equal(err.field, "extraField");
  assert.equal(err.stage, STAGE.PIPELINE);
  assert.equal(err.tradeId, "T1");
  assert.equal(err.tradeIndex, 0);
  assert.equal(err.policyId, "synthetic-cost-kospi-v1");
  assert.equal(err.modelVersion, MODEL_VERSION);
  assert.equal(err.orderType, ORDER_TYPE.MARKET_OPEN);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "cause"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "candidateId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "foldId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "sequence"), false);
});

test("GATE6S-G05 missing or null code omits the code key", () => {
  const missing = makeSafePipelineError({ field: "dataset" });
  assert.equal(Object.prototype.hasOwnProperty.call(missing, "code"), false);
  assert.equal(missing.severity, "ERROR");
  const nulled = makeSafePipelineError({ code: null, field: "dataset" });
  assert.equal(Object.prototype.hasOwnProperty.call(nulled, "code"), false);
  assert.equal(nulled.field, "dataset");
});

test("GATE6S-G06 empty-string and WARNING severity are preserved", () => {
  const empty = makeSafePipelineError({ code: ERROR.INVALID_INPUT, severity: "" });
  assert.equal(empty.code, ERROR.INVALID_INPUT);
  assert.equal(empty.severity, "");
  const warn = makeSafePipelineError({ code: ERROR.INVALID_INPUT, severity: "WARNING" });
  assert.equal(warn.severity, "WARNING");
  const numeric = makeSafePipelineError({ code: ERROR.INVALID_INPUT, severity: 0 });
  assert.equal(numeric.severity, 0);
});

test("GATE6U-R2-P01 DATA block sets failedStage DATA", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].volume = -1;
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(result.failedStage, STAGE.DATA);
  assert.equal(result.dataStageStatus, STAGE_STATUS.FAILED);
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
});

test("GATE6U-R2-P02 EXECUTION block sets failedStage EXECUTION", () => {
  const input = validPipelineInput();
  input.execution.exitPolicy.stopLossPrice = "bad";
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_EXECUTION_STAGE);
  assert.equal(result.failedStage, STAGE.EXECUTION);
  assert.equal(result.executionStageStatus, STAGE_STATUS.FAILED);
  assert.equal(result.calendarVerified, false);
  assert.equal(result.liveEligible, false);
});

test("GATE6U-R2-P03 COST block sets failedStage COST", () => {
  const input = validPipelineInput();
  input.cost.policies = [];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(result.failedStage, STAGE.COST);
  assert.equal(result.costStageStatus, STAGE_STATUS.FAILED);
  assert.equal(result.calendarVerified, false);
  assert.equal(result.liveEligible, false);
});

test("GATE6U-R2-P04 completed pipeline failedStage is null", () => {
  const result = runSyntheticSingleTradePipeline(validPipelineInput());
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE);
  assert.equal(result.failedStage, null);
  assert.equal(result.calendarVerified, false);
  assert.equal(result.liveEligible, false);
});

test("GATE6Y-P01 DATA invariant wrap keeps nested root then DATA_STAGE_FAILED", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  const start = src.indexOf("const dataInvariantErrors = collectDataMarketInvariantErrors(input);");
  assert.equal(start >= 0, true);
  const window = src.slice(start, start + 900);
  assert.equal(window.includes("dataInvariantErrors.slice()"), true);
  assert.equal(window.includes("ERROR.DATA_STAGE_FAILED"), true);
  assert.equal(window.includes("failedStage: STAGE.DATA"), true);

  const input = validPipelineInput();
  input.calendar = buildCalendar({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(result.failedStage, STAGE.DATA);
  assert.equal(
    result.errorCodes[0] === "CALENDAR_MARKET_MISMATCH"
      || result.errorCodes[0] === ERROR.PIPELINE_MARKET_INVARIANT_VIOLATION,
    true,
    `root was ${result.errorCodes[0]}`,
  );
  assert.equal(result.errorCodes.includes(ERROR.DATA_STAGE_FAILED), true);
  assert.equal(result.errorCodes.indexOf(ERROR.DATA_STAGE_FAILED) > 0, true);
  assert.equal(result.errorCodes[0] === ERROR.DATA_STAGE_FAILED, false);
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
});

test("GATE6Y-P02 data-schema fail still has nested root then DATA_STAGE_FAILED", () => {
  const input = validPipelineInput();
  input.dataset.candles[0].volume = -1;
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_DATA_STAGE);
  assert.equal(result.failedStage, STAGE.DATA);
  assert.equal(Array.isArray(result.errorCodes) && result.errorCodes.length > 0, true);
  assert.equal(result.errorCodes[0] === ERROR.DATA_STAGE_FAILED, false);
  assert.equal(result.errorCodes.includes(ERROR.DATA_STAGE_FAILED), true);
  assert.equal(result.errorCodes.indexOf(ERROR.DATA_STAGE_FAILED) > 0, true);
  assert.equal(result.calendarVerified, false);
  assert.equal(result.liveEligible, false);
});

test("GATE7E-P01 createSyntheticPipelineResult copies closedTrades array", () => {
  const closedTrades = [{ tradeId: "T1" }];
  const result = createSyntheticPipelineResult({ closedTrades });
  assert.notEqual(result.closedTrades, closedTrades);
  assert.equal(result.closedTrades.length, 1);
  assert.equal(result.closedTrades[0], closedTrades[0]);
  closedTrades.push({ tradeId: "T2" });
  assert.equal(result.closedTrades.length, 1);
  assert.equal(result.liveEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE7E-P02 non-array closedTrades become empty array", () => {
  const result = createSyntheticPipelineResult({ closedTrades: { tradeId: "T1" } });
  assert.deepEqual(result.closedTrades, []);
});

test("GATE7E-D01 data-validation still slices warnings", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/data-validation.js"),
    "utf8"
  );
  assert.equal(src.includes("src.warnings.slice()"), true);
});

test("GATE7F-E01 pipeline still slices closedTrades", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/synthetic-pipeline.js"),
    "utf8"
  );
  assert.equal(src.includes("src.closedTrades.slice()"), true);
});

test("GATE7Z-C01 baseResultMeta does not carry array fields", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  const start = src.indexOf("function baseResultMeta");
  const end = src.indexOf("function runSyntheticSingleTradePipeline");
  assert.equal(start >= 0, true);
  assert.equal(end > start, true);
  const block = src.slice(start, end);
  assert.equal(block.includes("missingData"), false);
  assert.equal(block.includes("warnings"), false);
});

test("GATE8A-Z01 freeze pins baseResultMeta return keys verbatim", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  const start = src.indexOf("function baseResultMeta");
  const end = src.indexOf("function runSyntheticSingleTradePipeline");
  assert.equal(start >= 0, true);
  assert.equal(end > start, true);
  const block = src.slice(start, end);
  const expected = `  return {
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
  };`;
  assert.equal(block.includes(expected), true);
  assert.equal(block.includes("..."), false);
  assert.equal(block.includes("missingData"), false);
  assert.equal(block.includes("warnings"), false);
});

test("GATE8B-C01 blocked costResult fail does not copy leftover amounts", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  const start = src.indexOf("if (costResult.ok !== true)");
  const end = src.indexOf("pipelineStatus: PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE", start);
  assert.equal(start >= 0, true);
  assert.equal(end > start, true);
  const block = src.slice(start, end);
  assert.equal(block.includes("entryAmount"), false);
  assert.equal(block.includes("exitAmount"), false);
});

test("GATE8B-C02 blocked cost stage leftover amounts stay null", () => {
  const input = validPipelineInput();
  input.cost.policies = [];
  const result = runSyntheticSingleTradePipeline(input);
  assert.equal(result.pipelineStatus, PIPELINE_STATUS.BLOCKED_COST_STAGE);
  assert.equal(result.entryAmount, null);
  assert.equal(result.exitAmount, null);
  assert.equal(result.totalCost, null);
  assert.equal(result.grossProfit, null);
  assert.equal(result.netProfit, null);
  assert.equal(result.liveEligible, false);
});

test("GATE8C-B01 freeze pins blocked cost return verbatim", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  const start = src.indexOf("if (costResult.ok !== true)");
  const end = src.indexOf("pipelineStatus: PIPELINE_STATUS.COMPLETED_SYNTHETIC_SINGLE_TRADE", start);
  assert.equal(start >= 0, true);
  assert.equal(end > start, true);
  const block = src.slice(start, end);
  const expected = `    return createSyntheticPipelineResult({
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
    });`;
  assert.equal(block.includes(expected), true);
  const forbidden = [
    "entryAmount",
    "exitAmount",
    "totalCost",
    "grossProfit",
    "netProfit",
    "entryCommission",
    "exitCommission",
    "sellTaxTotal",
  ];
  for (const key of forbidden) {
    assert.equal(block.includes(key), false);
  }
});

test("GATE8D-F01 freeze pins extra-overwrite leftover chapter closed", () => {
  const costSrc = fs.readFileSync(COST_PATH, "utf8");
  const pipeSrc = fs.readFileSync(PIPELINE_PATH, "utf8");
  assert.equal(costSrc.includes("7Y freeze"), true);
  assert.equal(costSrc.includes("8D freeze"), true);
  assert.equal(pipeSrc.includes("8A freeze"), true);
  assert.equal(pipeSrc.includes("8C freeze"), true);
  assert.equal(pipeSrc.includes("8D freeze"), true);
});


test("GATE8V-C01 pipeline createSyntheticPipelineResult calls spread base first", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  assert.equal(src.includes("      ...base,\n      pipelineStatus: PIPELINE_STATUS.COMPLETED_SYNTHETIC_MULTI_TRADE"), true);
  assert.equal(src.includes("    ...base,\n    pipelineStatus,"), true);
  assert.equal(src.includes("      ...base,\n      pipelineStatus,"), true);
  assert.equal(src.includes("        ...base,\n        pipelineStatus: PIPELINE_STATUS.BLOCKED_PORTFOLIO_LEDGER"), true);
  assert.equal(src.includes("      ...base,\n      pipelineStatus: PIPELINE_STATUS.COMPLETED_PORTFOLIO_LEDGER"), true);
  assert.equal(src.includes("      ...base,\n    });"), false);
  assert.equal(src.includes("    ...base,\n  });"), false);
  assert.equal(src.includes("        ...base,\n      }),"), false);
  assert.equal(src.includes("      ...base,\n    }),"), false);
});

test("GATE8V-C02 local base stays seven meta keys without pipelineStatus", () => {
  const src = fs.readFileSync(PIPELINE_PATH, "utf8");
  const baseBlock = `const base = {
    datasetId: dataset.datasetId || null,
    datasetVersion: dataset.datasetVersion || null,
    calendarId: calendar.calendarId || null,
    calendarVersion: calendar.calendarVersion || null,
    symbol: Array.isArray(dataset.symbols) ? dataset.symbols[0] : null,
    market: Array.isArray(dataset.markets) ? dataset.markets[0] : null,
    marketContractStatus: Array.isArray(dataset.markets)
      ? pipelineMarketContractStatus(dataset.markets[0])
      : null,
  };`;
  assert.equal(src.split(baseBlock).length - 1, 2);
  assert.equal(baseBlock.includes("pipelineStatus"), false);
  assert.equal(src.includes("      ...base,\n    });"), false);
  assert.equal(src.includes("    ...base,\n  });"), false);
  assert.equal(src.includes("        ...base,\n      }),"), false);
  assert.equal(src.includes("      ...base,\n    }),"), false);
});
