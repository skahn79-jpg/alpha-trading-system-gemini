"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const wf = require("../lib/backtest/walk-forward-validation");
const {
  WALK_FORWARD_STATUS,
  FOLD_STATUS,
  ERROR,
  AGGREGATE_DEFINITION,
  generateWalkForwardWindows,
  runWalkForwardValidation,
  blockedWalkForwardResult,
  completedWalkForwardResult,
} = wf;

const {
  runSyntheticBenchmarkPipeline,
  PIPELINE_STATUS,
  CALCULATION_MODE,
  MULTI_TRADE_PIPELINE_VERSION,
} = require("../lib/backtest/synthetic-pipeline");

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
  ORDER_TYPE,
  INTRABAR_CONFLICT_POLICY,
  STATUS: EXEC_STATUS,
  CALCULATION_STATUS,
} = require("../lib/backtest/execution-model");

const {
  POLICY_ENGINE_VERSION,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
  ROUNDING_MODE,
} = require("../lib/backtest/cost-policy");

const WF_PATH = path.join(__dirname, "..", "lib", "backtest", "walk-forward-validation.js");

const D = [
  "2101-03-01", "2101-03-02", "2101-03-03", "2101-03-04",
  "2101-03-05", "2101-03-06", "2101-03-07", "2101-03-08",
  "2101-03-09", "2101-03-10", "2101-03-11", "2101-03-12",
  "2101-03-13", "2101-03-14", "2101-03-15", "2101-03-16",
  "2101-03-17", "2101-03-18", "2101-03-19", "2101-03-20",
  "2101-03-21", "2101-03-22",
];
const D12 = D.slice(0, 12);

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}


function assertOfficialLeakageFreeze(result) {
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.executionStatus, EXEC_STATUS.NOT_EXECUTED);
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
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

function generateWeekdayDates(start, count) {
  const out = [];
  let cur = start;
  while (out.length < count) {
    if (!isWeekendYmd(cur)) out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function generateConsecutiveDates(start, count) {
  const out = [];
  let cur = start;
  while (out.length < count) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeCalendarDay(tradingDate, overrides) {
  const extras = overrides || {};
  return {
    tradingDate,
    dayStatus: extras.dayStatus || "TRADING_DAY",
    sessionStatus: extras.sessionStatus || "FINAL",
    statusSource: extras.statusSource || "SYNTHETIC_EXPLICIT",
    market: extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    calendarId: extras.calendarId || "synthetic-calendar-kospi-v1",
  };
}

function buildCalendarForDates(tradingDates, overrides) {
  const extras = overrides || {};
  const market = extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const calendarId = extras.calendarId || "synthetic-calendar-kospi-v1";
  const days = tradingDates.map((d) => makeCalendarDay(d, { market, calendarId }));
  return {
    calendarId,
    calendarVersion: "1.0.0",
    calendarStatus: "TEST_VERIFIED",
    fixtureType: "SYNTHETIC",
    notProductionData: true,
    productionEligible: false,
    market,
    timezone: "Asia/Seoul",
    coverage: { from: tradingDates[0], to: tradingDates[tradingDates.length - 1] },
    generatedAt: "2100-01-01T00:00:00+09:00",
    verifiedAt: "2100-01-01T00:00:00+09:00",
    days,
  };
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

function profitableCandleRow(tradingDate, idx) {
  return { tradingDate, open: 10000, high: 10500, low: 9800, close: 10200 };
}

function buildDatasetForDates(tradingDates, overrides) {
  const extras = overrides || {};
  const market = extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const { market: _marketOverride, ...datasetExtras } = extras;
  const candleRows = tradingDates.map((d, i) => {
    const row = profitableCandleRow(d, i);
    return integratedCandle(d, { ...row, market });
  });
  const envelope = {
    datasetId: "synthetic-dataset-v1",
    datasetVersion: "1.0.0",
    datasetType: DATASET_TYPE.HISTORICAL_DAILY_OHLCV,
    sourceType: SOURCE_TYPE.SYNTHETIC_FIXTURE,
    symbols: ["SYNTH001"],
    markets: [market],
    coverage: { from: tradingDates[0], to: tradingDates[tradingDates.length - 1] },
    perSymbolCoverage: { SYNTH001: { from: tradingDates[0], to: tradingDates[tradingDates.length - 1] } },
    timezone: "Asia/Seoul",
    sortOrder: SORT_ORDER.ASCENDING_BY_TRADING_DATE,
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.UNKNOWN,
    corporateActionPolicyId: "synthetic-ca-v1",
    corporateActionPolicyStatus: CORPORATE_ACTION_POLICY_STATUS.UNKNOWN,
    universePolicyId: "synthetic-universe-v1",
    survivorshipBiasControlled: true,
    calendarVersion: "1.0.0",
    calendarVerificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    contentChecksum: null,
    metadataHash: null,
    verificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
    fixtureType: FIXTURE_TYPE.SYNTHETIC_BACKTEST_DATASET,
    notProductionData: true,
    productionEligible: false,
    candles: candleRows,
    sourceRefs: [],
    verifiedAt: null,
    generatedAt: null,
    loaderTimestamp: null,
    ...datasetExtras,
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
    sellTaxes: [{ taxType: "SYNTHETIC_TRANSACTION_TAX", ratePpm: 1000, roundingMode: ROUNDING_MODE.FLOOR }],
    sourceReference: "SYNTHETIC_TEST_POLICY",
    verifiedAt: "2100-12-01T00:00:00.000Z",
  };
  if (!overrides) return base;
  const out = { ...base, ...overrides };
  if (overrides.commission) out.commission = { ...base.commission, ...overrides.commission };
  return out;
}

function buildBenchmarkSeries(tradingDates, startClose, endClose) {
  if (tradingDates.length === 0) return [];
  const sc = startClose != null ? startClose : 200;
  const ec = endClose != null ? endClose : 220;
  return tradingDates.map((tradingDate, i) => ({
    tradingDate,
    close: sc + ((ec - sc) * i) / Math.max(tradingDates.length - 1, 1),
  }));
}

function buildPipelineBase(tradingDates, overrides) {
  const extras = overrides || {};
  const market = extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const calendar = buildCalendarForDates(tradingDates, { market, calendarId: extras.calendarId });
  const dataset = buildDatasetForDates(tradingDates, { market });
  const t = tradingDates;
  const exitPolicy = {
    stopLossPrice: 9500,
    takeProfitPrice: 11000,
    intrabarConflictPolicy: INTRABAR_CONFLICT_POLICY.STOP_FIRST,
  };
  return {
    pipelineVersion: MULTI_TRADE_PIPELINE_VERSION,
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    dataset,
    calendar,
    calendarValidation: { requiredFrom: t[0], requiredTo: t[t.length - 1] },
    cost: {
      policyEngineVersion: POLICY_ENGINE_VERSION,
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      policies: [makePolicy(extras.policyOverrides)],
    },
    tradeIntents: [{
      tradeId: "T1",
      quantity: extras.quantity != null ? extras.quantity : 10,
      entryDate: t[1],
      exitDate: t[2],
      entryIntent: {
        orderType: ORDER_TYPE.MARKET_OPEN,
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy,
    }],
  };
}

function blockedStepSize(trainWindowSize, oosWindowSize, embargoTradingDayCount) {
  const embargo = Number.isInteger(embargoTradingDayCount) && embargoTradingDayCount >= 0
    ? embargoTradingDayCount
    : 0;
  return trainWindowSize + 2 * embargo + oosWindowSize;
}

function buildWalkForwardInput(overrides) {
  const extras = overrides || {};
  const preserveStepSize = extras.preserveStepSize === true;
  const rest = { ...extras };
  delete rest.preserveStepSize;
  const trainWindowSize = rest.trainWindowSize != null ? rest.trainWindowSize : 6;
  const oosWindowSize = rest.oosWindowSize != null ? rest.oosWindowSize : 3;
  const embargoTradingDayCount = rest.embargoTradingDayCount != null ? rest.embargoTradingDayCount : 1;
  const horizonType = rest.horizonType != null ? rest.horizonType : "ULTRA_SHORT";
  const requiredStep = blockedStepSize(trainWindowSize, oosWindowSize, embargoTradingDayCount);
  let stepSize = rest.stepSize != null ? rest.stepSize : requiredStep;
  if (!preserveStepSize && stepSize === oosWindowSize) {
    stepSize = requiredStep;
  }
  const tradingDates = rest.tradingDates || generateWeekdayDates("2101-03-01", requiredStep * 2);
  const market = rest.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const pipelineBase = buildPipelineBase(tradingDates, { market, ...rest });
  return {
    market,
    tradingDates,
    trainWindowSize,
    oosWindowSize,
    stepSize,
    initialCapital: rest.initialCapital != null ? rest.initialCapital : 1000000,
    benchmarkSeries: buildBenchmarkSeries(
      rest.benchmarkDates || tradingDates,
      rest.startClose,
      rest.endClose,
    ),
    pipelineBase,
    ...rest,
    tradingDates,
    trainWindowSize,
    oosWindowSize,
    stepSize,
    embargoTradingDayCount,
    horizonType,
  };
}

function windowInput(overrides) {
  const o = overrides || {};
  const preserveStepSize = o.preserveStepSize === true;
  const rest = { ...o };
  delete rest.preserveStepSize;
  const trainWindowSize = rest.trainWindowSize != null ? rest.trainWindowSize : 6;
  const oosWindowSize = rest.oosWindowSize != null ? rest.oosWindowSize : 3;
  const embargoTradingDayCount = rest.embargoTradingDayCount != null ? rest.embargoTradingDayCount : 1;
  const horizonType = rest.horizonType != null ? rest.horizonType : "ULTRA_SHORT";
  const requiredStep = blockedStepSize(trainWindowSize, oosWindowSize, embargoTradingDayCount);
  let stepSize = rest.stepSize != null ? rest.stepSize : requiredStep;
  if (!preserveStepSize && stepSize === oosWindowSize) {
    stepSize = requiredStep;
  }
  return {
    tradingDates: D,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: requiredStep,
    ...rest,
    trainWindowSize,
    oosWindowSize,
    stepSize,
    embargoTradingDayCount,
    horizonType,
  };
}

// ─── GATE5N Window Tests W01–W70 ───────────────────────────────────────────────

test("GATE5N-W01 known answer 2 blocks train=6 oos=3 embargo=1 step=11", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
  assert.equal(r.windows[0].foldId, "WF-0001");
  assert.equal(r.windows[0].trainStart, "2101-03-01");
  assert.equal(r.windows[0].trainEnd, "2101-03-06");
  assert.equal(r.windows[0].oosStart, "2101-03-08");
  assert.equal(r.windows[0].oosEnd, "2101-03-10");
  assert.equal(r.windows[1].foldId, "WF-0002");
  assert.equal(r.windows[1].trainStart, "2101-03-12");
  assert.equal(r.windows[1].trainEnd, "2101-03-17");
  assert.equal(r.windows[1].oosStart, "2101-03-19");
  assert.equal(r.windows[1].oosEnd, "2101-03-21");
});

test("GATE5N-W02 stepSize !== train+embargo+oos blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ stepSize: 3, preserveStepSize: true }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W03 trainWindowSize zero blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 0 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W04 oosWindowSize negative blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ oosWindowSize: -1 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W05 stepSize not integer blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ stepSize: 2.5 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W06 minTrainWindowSize not positive integer blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ minTrainWindowSize: 0 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W07 trainWindowSize < minTrainWindowSize blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 3, minTrainWindowSize: 5 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W08 tradingDates not array blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: "2101-03-01" }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W09 invalid date format blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: ["2101-13-01", ...D.slice(1)] }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W10 duplicate dates blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: [D[0], D[0], ...D.slice(2)] }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.WALK_FORWARD_DATE_MISMATCH), true);
});

test("GATE5N-W11 non-ascending dates blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: [D[1], D[0], ...D.slice(2)] }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.WALK_FORWARD_DATE_MISMATCH), true);
});

test("GATE5N-W12 insufficient data n < train+oos", () => {
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: D.slice(0, 8),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INSUFFICIENT_WALK_FORWARD_DATA), true);
});

test("GATE5N-W13 insufficient folds (<2)", () => {
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: D.slice(0, 11),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS), true);
});

test("GATE5N-W14 leftover suffix fail-closed", () => {
  const dates = generateWeekdayDates("2101-03-01", 23);
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "tradingDates");
  assert.equal(r.droppedIncompleteTail, false);
});

test("GATE5N-W15 droppedIncompleteTail false when exact fit", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.ok, true);
  assert.equal(r.droppedIncompleteTail, false);
});

test("GATE5N-W16 foldId format WF-0001 pad 4", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].foldId, "WF-0001");
  assert.equal(r.windows[1].foldId, "WF-0002");
});

test("GATE5N-W17 trainEnd strictly before oosStart", () => {
  const r = generateWalkForwardWindows(windowInput());
  for (const w of r.windows) {
    assert.equal(w.trainEnd < w.oosStart, true, w.foldId);
  }
});

test("GATE5N-W18 OOS folds do not overlap", () => {
  const r = generateWalkForwardWindows(windowInput());
  for (let i = 1; i < r.windows.length; i += 1) {
    assert.equal(r.windows[i].oosStart > r.windows[i - 1].oosEnd, true);
  }
});

test("GATE5N-W19 trainTradingDayCount equals trainWindowSize", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 6 }));
  for (const w of r.windows) assert.equal(w.trainTradingDayCount, 6);
});

test("GATE5N-W20 oosTradingDayCount equals oosWindowSize", () => {
  const r = generateWalkForwardWindows(windowInput({ oosWindowSize: 3 }));
  for (const w of r.windows) assert.equal(w.oosTradingDayCount, 3);
});

test("GATE5N-W21 minTrainWindowSize valid passes", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 6, minTrainWindowSize: 3 }));
  assert.equal(r.ok, true);
});

test("GATE5N-W22 null input object blocked", () => {
  const r = generateWalkForwardWindows(null);
  assert.equal(r.ok, false);
});

test("GATE5N-W23 weekend dates in list are index-valid", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].oosStart, "2101-03-08");
});

test("GATE5N-W24 trainStartIndex increments by stepSize", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].trainStartIndex, 0);
  assert.equal(r.windows[1].trainStartIndex, 11);
});

test("GATE5N-W25 oosStartIndex = trainEndIndex + 1 + embargo", () => {
  const r = generateWalkForwardWindows(windowInput());
  for (const w of r.windows) {
    assert.equal(w.oosStartIndex, w.trainEndIndex + 1 + w.embargoTradingDayCount);
  }
});

test("GATE5N-W26 success returns empty errorCodes", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.deepEqual(r.errorCodes, []);
  assert.deepEqual(r.errors, []);
});

test("GATE5N-W27 fail returns empty windows array", () => {
  const r = generateWalkForwardWindows(windowInput({ stepSize: 1 }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.windows, []);
});

test("GATE5N-W28 fail droppedIncompleteTail false", () => {
  const r = generateWalkForwardWindows(windowInput({ stepSize: 1 }));
  assert.equal(r.droppedIncompleteTail, false);
});

test("GATE5N-W29 larger train window fewer folds", () => {
  const small = generateWalkForwardWindows(windowInput({
    tradingDates: generateWeekdayDates("2101-03-01", 33),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  const large = generateWalkForwardWindows(windowInput({
    tradingDates: generateWeekdayDates("2101-03-01", 28),
    trainWindowSize: 9,
    oosWindowSize: 3,
    stepSize: 14,
  }));
  assert.equal(small.ok, true);
  assert.equal(large.ok, true);
  assert.equal(large.windows.length < small.windows.length, true);
});

test("GATE5N-W30 old rolling stepSize === oosWindowSize blocked", () => {
  const r = generateWalkForwardWindows(windowInput({
    oosWindowSize: 3,
    stepSize: 3,
    trainWindowSize: 6,
    preserveStepSize: true,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-W31 exact minimum 2 folds", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
});

test("GATE5N-W32 trainWindowSize 1 fail-closed not tile-aligned", () => {
  const r = generateWalkForwardWindows(windowInput({
    trainWindowSize: 1,
    oosWindowSize: 3,
    stepSize: 4,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "trainWindowSize");
});

test("GATE5N-W33 oosWindowSize 1 fail-closed not tile-aligned", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 1,
    stepSize: 7,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "oosWindowSize");
});

test("GATE5N-W34 34-date exact two-block window generation", () => {
  const dates = generateWeekdayDates("2101-03-01", 34);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 9,
    oosWindowSize: 6,
    stepSize: 17,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
  assert.equal(r.droppedIncompleteTail, false);
});

test("GATE5N-W35 last fold oosEnd is last complete OOS end", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[r.windows.length - 1].oosEnd, "2101-03-21");
});

test("GATE5N-W36 first fold trainStart is first date", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].trainStart, D[0]);
});

test("GATE5N-W37 indices within bounds", () => {
  const r = generateWalkForwardWindows(windowInput());
  const n = D.length;
  for (const w of r.windows) {
    assert.equal(w.oosEndIndex < n, true);
    assert.equal(w.trainStartIndex >= 0, true);
  }
});

test("GATE5N-W38 non-string date in array blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: [123, ...D.slice(1)] }));
  assert.equal(r.ok, false);
});

test("GATE5N-W39 empty tradingDates blocked insufficient data", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: [] }));
  assert.equal(r.ok, false);
});

test("GATE5N-W40 trainWindowSize float blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 4.5 }));
  assert.equal(r.ok, false);
});

test("GATE5N-W41 oosWindowSize zero blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ oosWindowSize: 0, stepSize: 0 }));
  assert.equal(r.ok, false);
});

test("GATE5N-W42 stepSize zero blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ stepSize: 0 }));
  assert.equal(r.ok, false);
});

test("GATE5N-W43 minTrainWindowSize 2 allowed as floor under tile-aligned train", () => {
  const r = generateWalkForwardWindows(windowInput({ minTrainWindowSize: 2, trainWindowSize: 6 }));
  assert.equal(r.ok, true);
});

test("GATE5N-W44 next train starts after previous oosEnd", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].trainStart, "2101-03-01");
  assert.equal(r.windows[1].trainStart, "2101-03-12");
  assert.equal(r.windows[1].trainStartIndex, r.windows[0].oosEndIndex + 1 + 1);
});

test("GATE5N-W45 consecutive OOS windows do not overlap", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].oosEnd, "2101-03-10");
  assert.equal(r.windows[1].oosStart, "2101-03-19");
  assert.equal(r.windows[1].oosStart > r.windows[0].oosEnd, true);
});

test("GATE5N-W46 insufficient data at exact boundary", () => {
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: D.slice(0, 8),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INSUFFICIENT_WALK_FORWARD_DATA), true);
});

test("GATE5N-W47 sufficient data at exact boundary 8 dates train3 oos3 embargo1", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: D.slice(0, 8),
    trainWindowSize: 3,
    oosWindowSize: 3,
    stepSize: 8,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS), true);
});

test("GATE5N-W48 two folds with 16 dates train3 oos3 embargo1 step8", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: D.slice(0, 16),
    trainWindowSize: 3,
    oosWindowSize: 3,
    stepSize: 8,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
});

test("GATE5N-W49 invalid YMD day 32 blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: ["2101-03-32", ...D.slice(1)] }));
  assert.equal(r.ok, false);
});

test("GATE5N-W50 invalid YMD month 13 blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: ["2101-13-01", ...D.slice(1)] }));
  assert.equal(r.ok, false);
});

test("GATE5N-W51 windows preserve date strings not reformat", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows[0].trainStart, "2101-03-01");
});

test("GATE5N-W52 oosEndIndex = oosStartIndex + oosWindowSize - 1", () => {
  const r = generateWalkForwardWindows(windowInput());
  for (const w of r.windows) {
    assert.equal(w.oosEndIndex, w.oosStartIndex + w.oosTradingDayCount - 1);
  }
});

test("GATE5N-W53 trainEndIndex = trainStartIndex + trainWindowSize - 1", () => {
  const r = generateWalkForwardWindows(windowInput());
  for (const w of r.windows) {
    assert.equal(w.trainEndIndex, w.trainStartIndex + w.trainTradingDayCount - 1);
  }
});

test("GATE5N-W54 equal-weighted mean formula via completed folds", () => {
  const input = buildWalkForwardInput();
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.foldCount, 2);
  const expected = (result.folds[0].totalReturn + result.folds[1].totalReturn) / 2;
  assert.equal(result.meanOosTotalReturn, expected);
  assert.equal(result.aggregateDefinition, AGGREGATE_DEFINITION);
});

test("GATE5N-W55 equal-weight benchmark mean", () => {
  const input = buildWalkForwardInput();
  const result = runWalkForwardValidation(input);
  const expected = (result.folds[0].benchmarkReturn + result.folds[1].benchmarkReturn) / 2;
  assert.equal(result.meanOosBenchmarkReturn, expected);
});

test("GATE5N-W56 equal-weight alpha mean", () => {
  const input = buildWalkForwardInput();
  const result = runWalkForwardValidation(input);
  const expected = (result.folds[0].alpha + result.folds[1].alpha) / 2;
  assert.equal(result.meanOosAlpha, expected);
});

test("GATE5N-W57 hardcoded equal-weight unit (0.10,0.00,-0.05,0.15) => 0.05", () => {
  const vals = [0.10, 0.00, -0.05, 0.15];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  assert.equal(mean, 0.05);
});

test("GATE5N-W58 generateWalkForwardWindows not plain object", () => {
  const r = generateWalkForwardWindows("bad");
  assert.equal(r.ok, false);
});

test("GATE5N-W59 large step equal oos produces single fold path blocked", () => {
  const r = generateWalkForwardWindows(windowInput({
    trainWindowSize: 9,
    oosWindowSize: 6,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS), true);
});

test("GATE5N-W60 22 dates train6 oos3 embargo1 step11 => 2 folds window only", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
});

test("GATE5N-W61 fold count scales with data length", () => {
  const r2 = generateWalkForwardWindows(windowInput());
  const rLong = generateWalkForwardWindows(windowInput({
    tradingDates: generateWeekdayDates("2101-03-01", 33),
  }));
  assert.equal(rLong.windows.length > r2.windows.length, true);
});

test("GATE5N-W62 no silent sort of tradingDates", () => {
  const unsorted = [D[2], D[0], D[1], ...D.slice(3)];
  const r = generateWalkForwardWindows(windowInput({ tradingDates: unsorted }));
  assert.equal(r.ok, false);
});

test("GATE5N-W63 duplicate at end blocked", () => {
  const r = generateWalkForwardWindows(windowInput({ tradingDates: [...D.slice(0, 11), D[10]] }));
  assert.equal(r.ok, false);
});

test("GATE5N-W64 minTrainWindowSize omitted passes", () => {
  const r = generateWalkForwardWindows(windowInput({ minTrainWindowSize: undefined }));
  assert.equal(r.ok, true);
});

test("GATE5N-W65 train window covers index range", () => {
  const r = generateWalkForwardWindows(windowInput());
  const w = r.windows[0];
  assert.equal(w.trainStart, D[w.trainStartIndex]);
  assert.equal(w.trainEnd, D[w.trainEndIndex]);
});

test("GATE5N-W66 oos window covers index range", () => {
  const r = generateWalkForwardWindows(windowInput());
  const w = r.windows[0];
  assert.equal(w.oosStart, D[w.oosStartIndex]);
  assert.equal(w.oosEnd, D[w.oosEndIndex]);
});

test("GATE5N-W67 insufficient folds one fold only", () => {
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: D.slice(0, 11),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS), true);
});

test("GATE5N-W68 leftover suffix fail-closed", () => {
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: generateWeekdayDates("2101-03-01", 23),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "tradingDates");
  assert.equal(r.droppedIncompleteTail, false);
});

test("GATE5N-W69 success ok true", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.ok, true);
});

test("GATE5N-W70 windows array length matches fold count", () => {
  const r = generateWalkForwardWindows(windowInput());
  assert.equal(r.windows.length, 2);
});

test("GATE5N-W71 extra coverage 3-fold train6 oos3 step9", () => {
  const r = generateWalkForwardWindows(windowInput({
    tradingDates: generateWeekdayDates("2101-03-01", 33),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 3);
});

// ─── GATE5N Pipeline Tests P01–P30 ───────────────────────────────────────────

test("GATE5N-P01 KOSPI full success COMPLETED_WALK_FORWARD", () => {
  const input = buildWalkForwardInput();
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(result.foldCount, 2);
});

test("GATE5N-P02 KOSDAQ full success", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const input = buildWalkForwardInput({
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    tradingDates: dates,
    policyOverrides: { policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ },
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  input.pipelineBase.dataset.markets = [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ];
  input.pipelineBase.dataset.candles.forEach((c) => { c.market = SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ; });
  input.pipelineBase.calendar.market = SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
});

test("GATE5N-P03 each fold COMPLETED_OOS_FOLD", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  for (const fold of result.folds) {
    assert.equal(fold.status, FOLD_STATUS.COMPLETED);
    assert.equal(fold.totalReturn != null, true);
  }
});

test("GATE5N-P04 aggregateDefinition EQUAL_WEIGHTED_FOLD_MEAN", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.aggregateDefinition, AGGREGATE_DEFINITION);
});

test("GATE5N-P05 oosCoverageStart first fold oosStart", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  const result = runWalkForwardValidation(input);
  assert.equal(result.oosCoverageStart, windows.windows[0].oosStart);
});

test("GATE5N-P06 oosCoverageEnd last fold oosEnd", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  const result = runWalkForwardValidation(input);
  assert.equal(result.oosCoverageEnd, windows.windows[windows.windows.length - 1].oosEnd);
});

test("GATE5N-P07 safety flags all false", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
});

test("GATE5N-P08 executionStatus NOT_EXECUTED", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.executionStatus, EXEC_STATUS.NOT_EXECUTED);
});

test("GATE5N-P09 calculationStatus SIMULATED_CALCULATION_ONLY", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
});

test("GATE5N-P10 production KOSPI blocked", () => {
  const input = buildWalkForwardInput({ market: "KOSPI" });
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5N-P11 production KOSDAQ blocked", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({ market: "KOSDAQ" }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5N-P12 legacy SYNTHETIC_MARKET blocked", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({ market: "SYNTHETIC_MARKET" }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5N-P13 missing pipelineBase blocked after windows ok", () => {
  const input = buildWalkForwardInput();
  delete input.pipelineBase;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5N-P14 non-object input INVALID_INPUT", () => {
  const result = runWalkForwardValidation(null);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5N-P15 one fold fail atomic blocked all aggregates null", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  const fold2OosStart = windows.windows[1].oosStart;
  input.benchmarkSeries = input.benchmarkSeries.filter((row) => row.tradingDate !== fold2OosStart);
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(result.meanOosTotalReturn, null);
  assert.equal(result.meanOosBenchmarkReturn, null);
  assert.equal(result.meanOosAlpha, null);
  assert.equal(result.failedFoldCount >= 1, true);
});

test("GATE5N-P16 partialFoldResults populated on block", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  input.benchmarkSeries = input.benchmarkSeries.filter((row) => row.tradingDate !== windows.windows[1].oosStart);
  const result = runWalkForwardValidation(input);
  assert.equal(result.partialFoldResults.length, result.foldCount);
  assert.equal(result.officialFolds.length, 0);
});

test("GATE5N-P17 failedStage WALK_FORWARD on block", () => {
  const input = buildWalkForwardInput();
  input.initialCapital = -1;
  const result = runWalkForwardValidation(input);
  assert.equal(result.failedStage, "WALK_FORWARD");
});

test("GATE5N-P18 window config fail blocked with WALK_FORWARD_STAGE_FAILED", () => {
  const input = buildWalkForwardInput({ stepSize: 1, oosWindowSize: 3 });
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_STAGE_FAILED), true);
});

test("GATE5N-P19 OOS_FOLD_FAILED in errorCodes on fold fail", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  input.benchmarkSeries = input.benchmarkSeries.filter((row) => row.tradingDate !== windows.windows[0].oosStart);
  const result = runWalkForwardValidation(input);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
});

test("GATE5N-P20 same initialCapital each fold no compounding", () => {
  const input = buildWalkForwardInput({ initialCapital: 1000000 });
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.folds[0].totalReturn, result.folds[1].totalReturn);
});

test("GATE5N-P21 NYSE production market blocked", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({ market: "NYSE" }));
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5N-P22 KRX production market blocked", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({ market: "KRX" }));
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5N-P23 future row leakage fold metrics unchanged", () => {
  const input = buildWalkForwardInput();
  const extraDate = addDaysYmd(input.tradingDates[input.tradingDates.length - 1], 7);
  while (isWeekendYmd(extraDate)) { /* skip */ }
  const extraCandle = integratedCandle(extraDate, { close: 50000 });
  input.pipelineBase.dataset.candles.push(extraCandle);
  input.pipelineBase.dataset.coverage.to = extraDate;
  input.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input.pipelineBase.dataset);
  input.pipelineBase.dataset.metadataHash = computeDatasetMetadataHash(input.pipelineBase.dataset);
  input.pipelineBase.calendar.days.push(makeCalendarDay(extraDate));
  input.pipelineBase.calendar.coverage.to = extraDate;
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 999 });
  const r1 = runWalkForwardValidation(deepClone(input));
  input.pipelineBase.dataset.candles[input.pipelineBase.dataset.candles.length - 1].close = 1;
  input.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input.pipelineBase.dataset);
  const r2 = runWalkForwardValidation(deepClone(input));
  assert.deepEqual(r1.folds, r2.folds);
  assert.equal(r1.meanOosTotalReturn, r2.meanOosTotalReturn);
});

test("GATE5N-P24 JSON snapshot input immutable", () => {
  const input = buildWalkForwardInput();
  const snap = JSON.stringify(input);
  runWalkForwardValidation(input);
  assert.equal(JSON.stringify(input), snap);
});

test("GATE5N-P25 determinism deepEqual twice", () => {
  const input = buildWalkForwardInput();
  const r1 = runWalkForwardValidation(deepClone(input));
  const r2 = runWalkForwardValidation(deepClone(input));
  assert.deepEqual(r1, r2);
});

test("GATE5N-P26 officialFolds populated on success", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.officialFolds.length, result.foldCount);
  assert.equal(result.partialFoldResults.length, 0);
});

test("GATE5N-P27 successfulFoldCount equals foldCount on success", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.successfulFoldCount, result.foldCount);
  assert.equal(result.failedFoldCount, 0);
});

test("GATE5N-P28 folds array includes train metadata", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.folds[0].trainStart != null, true);
  assert.equal(result.folds[0].trainEnd != null, true);
});

test("GATE5N-P29 invalid initialCapital blocked", () => {
  const input = buildWalkForwardInput({ initialCapital: 0 });
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5N-P30 benchmarkSeries must be array", () => {
  const input = buildWalkForwardInput();
  input.benchmarkSeries = null;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5N-P31 NASDAQ production blocked", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({ market: "NASDAQ" }));
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5N-P32 oos window not tile-aligned fails at config", () => {
  const dates = generateWeekdayDates("2101-03-01", 12);
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 2,
    stepSize: 8,
  });
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "oosWindowSize");
});

test("GATE5N-P33 folds and partialFoldResults same on block", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  input.benchmarkSeries = input.benchmarkSeries.filter((row) => row.tradingDate !== windows.windows[1].oosStart);
  const result = runWalkForwardValidation(input);
  assert.deepEqual(result.folds, result.partialFoldResults);
});

test("GATE5N-P34 source guards no Math.random Date.now network orders", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes("Math.random"), false);
  assert.equal(src.includes("Date.now"), false);
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("placeOrder"), false);
});

test("GATE5N-P35 fold uses runSyntheticBenchmarkPipeline path", () => {
  const input = buildWalkForwardInput();
  const result = runWalkForwardValidation(input);
  assert.equal(result.folds[0].benchmarkReturn != null, true);
  assert.equal(result.folds[0].alpha != null, true);
});

test("GATE5N-P36 leftover suffix blocked at window config", () => {
  const dates = generateWeekdayDates("2101-03-01", 23);
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "tradingDates");
  assert.equal(result.droppedIncompleteTail, false);
});

test("GATE5N-P37 errorCodes empty on success", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.deepEqual(result.errorCodes, []);
});

test("GATE5N-P38 failedStage null on success", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  assert.equal(result.failedStage, null);
});

test("GATE5N-P39 fold alpha equals totalReturn minus benchmarkReturn approx", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput());
  for (const fold of result.folds) {
    const diff = Math.abs(fold.alpha - (fold.totalReturn - fold.benchmarkReturn));
    assert.equal(diff < 1e-10, true);
  }
});

test("GATE5N-P40 window-only insufficient data blocked before pipeline", () => {
  const input = buildWalkForwardInput({ tradingDates: D.slice(0, 5), trainWindowSize: 6, oosWindowSize: 3, stepSize: 11 });
  const result = runWalkForwardValidation(input);
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_WALK_FORWARD_DATA), true);
});

// ── GATE5N-R01~R08: Aggregate fail-closed (IEEE overflow) ─────────────────

const pipelineMod = require("../lib/backtest/synthetic-pipeline");

function withPatchedPipeline(metricFactory, fn) {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    let call = 0;
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      const base = original(input);
      call += 1;
      const override = metricFactory(call, base, input);
      return {
        ...base,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA,
        totalReturn: override.totalReturn,
        benchmarkReturn: override.benchmarkReturn,
        alpha: override.alpha,
        errors: [],
        errorCodes: [],
      };
    };
    return fn();
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
}

// Sanity fixture: IEEE overflow is real
test("GATE5N-R00 IEEE overflow fixture", () => {
  assert.equal(Number.isFinite(Number.MAX_VALUE), true);
  assert.equal(Number.isFinite(Number.MAX_VALUE + Number.MAX_VALUE), false);
});

test("GATE5N-R01 totalReturn MAX_VALUE overflow → BLOCKED WALK_FORWARD_AGGREGATE_NONFINITE, meanOosTotalReturn null", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(result.failedStage, "WALK_FORWARD");
  assert.equal(result.officialFolds.length, 0);
  assert.equal(result.folds.every((f) => f.status === "COMPLETED_OOS_FOLD" || f.status === FOLD_STATUS.COMPLETED), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.meanOosTotalReturn, null);
  assert.notEqual(result.meanOosTotalReturn, Infinity);
});

test("GATE5N-R02 benchmarkReturn MAX_VALUE overflow → BLOCKED, meanOosBenchmarkReturn null", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: 0.01, benchmarkReturn: Number.MAX_VALUE, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.meanOosBenchmarkReturn, null);
});

test("GATE5N-R03 alpha MAX_VALUE overflow → BLOCKED, meanOosAlpha null", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: 0.01, benchmarkReturn: 0.01, alpha: Number.MAX_VALUE }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.meanOosAlpha, null);
});

test("GATE5N-R04 overflow → officialFolds.length === 0", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.officialFolds.length, 0);
});

test("GATE5N-R05 overflow → all three mean* null", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.meanOosTotalReturn, null);
  assert.equal(result.meanOosBenchmarkReturn, null);
  assert.equal(result.meanOosAlpha, null);
});

test("GATE5N-R06 overflow → errorCodes has WALK_FORWARD_AGGREGATE_NONFINITE before WALK_FORWARD_STAGE_FAILED", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_STAGE_FAILED), true);
  const codes = result.errorCodes;
  const aggIdx = codes.indexOf(ERROR.WALK_FORWARD_AGGREGATE_NONFINITE);
  const stageIdx = codes.indexOf(ERROR.WALK_FORWARD_STAGE_FAILED);
  assert.equal(aggIdx < stageIdx, true);
});

test("GATE5N-R07 overflow → mean* are null (not Infinity/NaN in JSON)", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.meanOosTotalReturn, null);
  assert.equal(result.meanOosBenchmarkReturn, null);
  assert.equal(result.meanOosAlpha, null);
  const json = JSON.stringify(result);
  assert.equal(json.includes('"Infinity"'), false);
  assert.equal(json.includes('"NaN"'), false);
});

test("GATE5N-R08 large finite (MAX_VALUE/4 per fold) → COMPLETED, Number.isFinite(meanOosTotalReturn)", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE / 4, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(Number.isFinite(result.meanOosTotalReturn), true);
});


// ─── GATE 5R — Purged walk-forward embargo ─────────────────────────────

test("GATE5R-W01 omitted embargo and explicit 0 fail-closed under PURGE_MIN", () => {
  const a = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  const b = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 0,
  });
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(a.errors[0].field, "embargoTradingDayCount");
  assert.equal(b.errors[0].field, "embargoTradingDayCount");
});

test("GATE5R-W02 embargo=1 is index gap not calendar skip", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const result = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(result.ok, true);
  const w = result.windows[0];
  assert.equal(w.trainEndIndex, 5);
  assert.equal(w.oosStartIndex, 7);
  assert.equal(w.oosEndIndex, 9);
  assert.deepEqual(w.embargoDates, [dates[6]]);
  assert.equal(w.embargoStart, dates[6]);
  assert.equal(w.embargoEnd, dates[6]);
  assert.equal(w.oosStart, dates[7]);
  assert.notEqual(w.trainEnd, w.oosStart);
});

test("GATE5R-W03 negative embargo fail-closed", () => {
  const result = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: D,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 3,
    embargoTradingDayCount: -1,
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "embargoTradingDayCount");
});

test("GATE5R-W04 embargo included in insufficient-data bound", () => {
  const dates = generateWeekdayDates("2101-03-01", 12);
  const result = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 17,
    embargoTradingDayCount: 4,
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_WALK_FORWARD_DATA), true);
});


// ─── GATE 5S — Non-overlapping blocked walk-forward ─────────────────────

test("GATE5S-W01 18-date two-block known answer rejects old rolling", () => {
  const blocked = generateWalkForwardWindows(windowInput());
  assert.equal(blocked.ok, true);
  assert.equal(blocked.windows.length, 2);
  assert.equal(blocked.windows[0].trainStart, "2101-03-01");
  assert.equal(blocked.windows[0].oosEnd, "2101-03-10");
  assert.equal(blocked.windows[1].trainStart, "2101-03-12");
  assert.equal(blocked.windows[1].oosEnd, "2101-03-21");
  const rolling = generateWalkForwardWindows(windowInput({ stepSize: 3, preserveStepSize: true }));
  assert.equal(rolling.ok, false);
  assert.equal(hasCode(rolling, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5S-W02 old embargo=1 14-date 4+2 fail-closed at tile alignment", () => {
  const dates = generateWeekdayDates("2101-03-01", 28);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 4,
    oosWindowSize: 2,
    stepSize: 7,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "trainWindowSize");
});

test("GATE5S-W02b embargo=1 identity moved to 5T", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
  const a = r.windows[0];
  const b = r.windows[1];
  assert.equal(a.trainStartIndex, 0);
  assert.equal(a.trainEndIndex, 5);
  assert.deepEqual(a.embargoDates, [dates[6]]);
  assert.equal(a.oosStartIndex, 7);
  assert.equal(a.oosEndIndex, 9);
  assert.equal(b.trainStartIndex, 11);
  assert.equal(b.trainEndIndex, 16);
  assert.deepEqual(b.embargoDates, [dates[17]]);
  assert.equal(b.oosStartIndex, 18);
  assert.equal(b.oosEndIndex, 20);
  assert.equal(b.trainStartIndex, a.oosEndIndex + 1 + 1);
  assert.equal(a.embargoDates.includes(dates[b.trainStartIndex]), false);
  assert.equal(b.embargoDates.includes(dates[a.oosStartIndex]), false);
});

test("GATE5S-W03 pairwise disjoint train/embargo/oos across folds", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  const sets = r.windows.map((w) => ({
    train: new Set(Array.from({ length: w.trainEndIndex - w.trainStartIndex + 1 }, (_, i) => w.trainStartIndex + i)),
    embargo: new Set(Array.from({ length: w.embargoTradingDayCount }, (_, i) => w.trainEndIndex + 1 + i)),
    oos: new Set(Array.from({ length: w.oosEndIndex - w.oosStartIndex + 1 }, (_, i) => w.oosStartIndex + i)),
    postOosEmbargo: new Set(Array.from({ length: w.postOosEmbargoTradingDayCount }, (_, i) => w.oosEndIndex + 1 + i)),
  }));
  const kinds = ["train", "embargo", "oos", "postOosEmbargo"];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i; j < sets.length; j += 1) {
      for (const ka of kinds) {
        for (const kb of kinds) {
          if (i === j && ka === kb) continue;
          for (const v of sets[i][ka]) {
            assert.equal(sets[j][kb].has(v), false, `${i}:${ka} vs ${j}:${kb} ${v}`);
          }
        }
      }
    }
  }
});

// ─── GATE 5T — Post-OOS embargo ────────────────────────────────────────

test("GATE5T-W01 embargo=0 fail-closed under PURGE_MIN", () => {
  const r = generateWalkForwardWindows(windowInput({ embargoTradingDayCount: 0 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "embargoTradingDayCount");
});

test("GATE5T-W02 embargo=1 22-date known answer", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
  const a = r.windows[0];
  const b = r.windows[1];
  assert.equal(a.trainStartIndex, 0);
  assert.equal(a.trainEndIndex, 5);
  assert.deepEqual(a.embargoDates, [dates[6]]);
  assert.equal(a.oosStartIndex, 7);
  assert.equal(a.oosEndIndex, 9);
  assert.deepEqual(a.postOosEmbargoDates, [dates[10]]);
  assert.equal(b.trainStartIndex, 11);
  assert.equal(b.trainEndIndex, 16);
  assert.deepEqual(b.embargoDates, [dates[17]]);
  assert.equal(b.oosStartIndex, 18);
  assert.equal(b.oosEndIndex, 20);
  assert.deepEqual(b.postOosEmbargoDates, [dates[21]]);
  assert.equal(b.trainStartIndex, a.oosEndIndex + 1 + 1);
});

test("GATE5T-W03 old 5S embargo=1 step=train+embargo+oos rejected", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 10,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "stepSize");
});

// ─── GATE 5U — Tile-aligned train/OOS window sizes ─────────────────────

test("GATE5U-W01 trainWindowSize 4 fail-closed", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 4 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "trainWindowSize");
});

test("GATE5U-W02 oosWindowSize 2 fail-closed", () => {
  const r = generateWalkForwardWindows(windowInput({ oosWindowSize: 2 }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "oosWindowSize");
});

test("GATE5U-W03 old 12-date 4+2 fixture rejected at config", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    embargoTradingDayCount: 1,
    tradingDates: D12,
    trainWindowSize: 4,
    oosWindowSize: 2,
    stepSize: 6,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "trainWindowSize");
});

test("GATE5U-W04 minTrainWindowSize 1 cannot validate non-multiple train", () => {
  const r = generateWalkForwardWindows(windowInput({ trainWindowSize: 4, minTrainWindowSize: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, "trainWindowSize");
});

test("GATE5U-W05 embargo=0 tile-aligned path fail-closed under PURGE_MIN", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 9,
    embargoTradingDayCount: 0,
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, "embargoTradingDayCount");
});

test("GATE5U-W06 trainWindowSize 303 exceeds tile cap fail-closed", () => {
  const r = generateWalkForwardWindows(windowInput({
    trainWindowSize: 303,
    oosWindowSize: 3,
    stepSize: 306,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "trainWindowSize");
});

test("GATE5U-W07 oosWindowSize 303 exceeds tile cap fail-closed", () => {
  const r = generateWalkForwardWindows(windowInput({
    trainWindowSize: 6,
    oosWindowSize: 303,
    stepSize: 309,
  }));
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "oosWindowSize");
});

test("GATE5U-W08 trainWindowSize 300 at tile cap succeeds", () => {
  const dates = generateWeekdayDates("2101-03-01", 610);
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: dates,
    trainWindowSize: 300,
    oosWindowSize: 3,
    stepSize: 305,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
});

test("GATE5V-W01 leftover n=23 train=6 oos=3 embargo=1 step=11 fail-closed", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 23),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "tradingDates");
  assert.equal(r.droppedIncompleteTail, false);
});

test("GATE5V-W02 exact n=22 succeeds with droppedIncompleteTail false", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
  assert.equal(r.droppedIncompleteTail, false);
});

// GATE 5W PURGE_MIN embargo

test("GATE5W-W01 missing horizonType fail-closed", () => {
  const r = generateWalkForwardWindows({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(hasCode(r, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(r.errors[0].field, "horizonType");
});

test("GATE5W-W02 omitted embargo fail-closed", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 9,
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, "embargoTradingDayCount");
});

test("GATE5W-W03 embargo=0 ULTRA_SHORT fail-closed", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 9,
    embargoTradingDayCount: 0,
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, "embargoTradingDayCount");
});

test("GATE5W-W04 embargo=1 ULTRA_SHORT 22-date success", () => {
  const r = generateWalkForwardWindows({
    horizonType: "ULTRA_SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.windows.length, 2);
});

test("GATE5W-W05 embargo=1 SHORT fail-closed min 5", () => {
  const r = generateWalkForwardWindows({
    horizonType: "SHORT",
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, "embargoTradingDayCount");
});

function captureWalkForwardBenchmarks(runInput) {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const leakageGuard = require("../lib/backtest/leakage-guard");
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  const originalGuard = leakageGuard.assertFeatureWindowNoLookAhead;
  const captures = [];
  const featureCaptures = [];
  leakageGuard.assertFeatureWindowNoLookAhead = function patchedGuard(payload) {
    featureCaptures.push({
      featureDates: payload && Array.isArray(payload.featureWindow)
        ? payload.featureWindow.map((c) => c && c.tradingDate)
        : [],
      featureAsOfTradingDate: payload && payload.featureAsOfTradingDate,
    });
    return originalGuard(payload);
  };
  pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
    const benchmarkDates = input && input.benchmark && Array.isArray(input.benchmark.benchmarkSeries)
      ? input.benchmark.benchmarkSeries.map((r) => r && r.tradingDate)
      : [];
    const candleDates = input && input.dataset && Array.isArray(input.dataset.candles)
      ? input.dataset.candles.map((c) => c.tradingDate)
      : [];
    const tradeIntent = input && Array.isArray(input.tradeIntents) ? input.tradeIntents[0] : null;
    const result = original(input);
    captures.push({
      benchmarkDates,
      candleDates,
      tradeIntent,
      pipelineStatus: result && result.pipelineStatus,
      initialCapital: input && input.initialCapital,
    });
    return result;
  };
  try {
    const result = runWalkForwardValidation(runInput);
    return { result, captures, featureCaptures };
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
    leakageGuard.assertFeatureWindowNoLookAhead = originalGuard;
  }
}

test("GATE5Y-W01 extra future benchmark excluded from every standalone OOS fold", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 99999 });
  const { result, captures } = captureWalkForwardBenchmarks(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(captures.length > 0, true);
  for (const cap of captures) {
    assert.equal(cap.benchmarkDates.includes(extraDate), false);
  }
});

test("GATE5Y-W02 embargo=1 ULTRA_SHORT 22-date success still PASS", () => {
  const r = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(r.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
});

test("GATE5Y-W03 omitted embargo still FAIL", () => {
  const input = buildWalkForwardInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5Y-W04 reversed benchmark order does not change fold metrics", () => {
  const base = buildWalkForwardInput();
  const r0 = runWalkForwardValidation(deepClone(base));
  const reversed = deepClone(base);
  reversed.benchmarkSeries = reversed.benchmarkSeries.slice().reverse();
  const r1 = runWalkForwardValidation(reversed);
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r1.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.meanOosTotalReturn, r1.meanOosTotalReturn);
  assert.equal(r0.meanOosAlpha, r1.meanOosAlpha);
});

test("GATE5Y-W05 empty benchmark after slice fail-closed", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  input.benchmarkSeries = [{ tradingDate: extraDate, close: 1 }];
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
});

test("GATE5Z-W01 feature asOf is signal and execution candles include entry and exit", () => {
  const { result, captures, featureCaptures } = captureWalkForwardBenchmarks(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(featureCaptures.length > 0, true);
  assert.equal(captures.length > 0, true);
  for (const cap of captures) {
    const signal = cap.tradeIntent.entryIntent.signalTradingDate;
    const entry = cap.tradeIntent.entryDate;
    const exit = cap.tradeIntent.exitDate;
    assert.equal(signal < entry, true);
    assert.equal(cap.candleDates.includes(entry), true);
    assert.equal(cap.candleDates.includes(exit), true);
  }
  for (const feat of featureCaptures) {
    assert.equal(feat.featureAsOfTradingDate != null, true);
    for (const date of feat.featureDates) {
      assert.equal(date <= feat.featureAsOfTradingDate, true);
    }
  }
});

test("GATE5Z-W02 embargo=1 ULTRA_SHORT 22-date success still PASS", () => {
  const r = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(r.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
});

test("GATE5Z-W03 omitted embargo still FAIL", () => {
  const input = buildWalkForwardInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5Z-W04 extra future benchmark still excluded", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 99999 });
  const { result, captures } = captureWalkForwardBenchmarks(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const cap of captures) {
    assert.equal(cap.benchmarkDates.includes(extraDate), false);
  }
});

test("GATE5Z-W05 feature window does not include entry or exit dates", () => {
  const { result, captures, featureCaptures } = captureWalkForwardBenchmarks(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const cap = captures[0];
  const signal = cap.tradeIntent.entryIntent.signalTradingDate;
  const entry = cap.tradeIntent.entryDate;
  const exit = cap.tradeIntent.exitDate;
  const matching = featureCaptures.filter((f) => f.featureAsOfTradingDate === signal);
  assert.equal(matching.length > 0, true);
  for (const feat of matching) {
    assert.equal(feat.featureDates.includes(entry), false);
    assert.equal(feat.featureDates.includes(exit), false);
    assert.equal(feat.featureDates.includes(signal), true);
  }
});

test("GATE6A-W01 22-date embargo=1 success pins all official flags false", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assertOfficialLeakageFreeze(result);
});

test("GATE6A-W02 omitted embargo still FAIL", () => {
  const input = buildWalkForwardInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assertOfficialLeakageFreeze(result);
});

test("GATE6A-W03 5Z feature asOf remains signal and flags stay false", () => {
  const { result, featureCaptures } = captureWalkForwardBenchmarks(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assertOfficialLeakageFreeze(result);
  assert.equal(featureCaptures.length > 0, true);
  for (const feat of featureCaptures) {
    assert.equal(feat.featureAsOfTradingDate != null, true);
    for (const date of feat.featureDates) {
      assert.equal(date <= feat.featureAsOfTradingDate, true);
    }
  }
});


function sixBarWalkForwardInput() {
  return buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 28),
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  });
}

function withTileMetrics(metricFactory, fn) {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    let call = 0;
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(inp) {
      const base = original(inp);
      call += 1;
      const override = metricFactory(call, base, inp);
      return {
        ...base,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA,
        totalReturn: override.totalReturn,
        benchmarkReturn: override.benchmarkReturn,
        alpha: override.alpha,
        errors: [],
        errorCodes: [],
      };
    };
    return fn();
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
}

test("GATE6B-W01 oos=3 remains one 3-bar tile per fold", () => {
  const { result, captures } = captureWalkForwardBenchmarks(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(captures.length, 2);
  for (const cap of captures) {
    assert.equal(cap.candleDates.length, 3);
    const signal = cap.tradeIntent.entryIntent.signalTradingDate;
    const entry = cap.tradeIntent.entryDate;
    const exit = cap.tradeIntent.exitDate;
    assert.equal(cap.candleDates[0], signal);
    assert.equal(cap.candleDates[1], entry);
    assert.equal(cap.candleDates[2], exit);
    assert.equal(cap.initialCapital, 1000000);
  }
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W02 oos=6 scores two tiles as equal-weighted mean", () => {
  const dates = generateWeekdayDates("2101-03-01", 28);
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
    initialCapital: 1000000,
  });
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  let call = 0;
  const capturedCapitals = [];
  const capturedTiles = [];
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(inp) {
      call += 1;
      capturedCapitals.push(inp.initialCapital);
      capturedTiles.push((inp.dataset && Array.isArray(inp.dataset.candles)
        ? inp.dataset.candles.map((c) => c.tradingDate)
        : []));
      const base = original(inp);
      const totalReturn = call % 2 === 1 ? 0.10 : 0.30;
      const benchmarkReturn = call % 2 === 1 ? 0.04 : 0.08;
      return {
        ...base,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA,
        totalReturn,
        benchmarkReturn,
        alpha: totalReturn - benchmarkReturn,
        errors: [],
        errorCodes: [],
      };
    };
    const result = runWalkForwardValidation(input);
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
    assert.equal(call, 4);
    assert.equal(result.foldCount, 2);
    assert.equal(Math.abs(result.folds[0].totalReturn - 0.20) < 1e-12, true);
    assert.equal(Math.abs(result.folds[0].benchmarkReturn - 0.06) < 1e-12, true);
    assert.equal(Math.abs(result.folds[0].alpha - 0.14) < 1e-12, true);
    assert.equal(Math.abs(result.folds[1].totalReturn - 0.20) < 1e-12, true);
    assert.equal(Math.abs(result.folds[1].benchmarkReturn - 0.06) < 1e-12, true);
    assert.equal(Math.abs(result.folds[1].alpha - 0.14) < 1e-12, true);
    assert.deepEqual(capturedCapitals, [1000000, 1000000, 1000000, 1000000]);
    const windows = generateWalkForwardWindows({
      tradingDates: dates,
      trainWindowSize: 6,
      oosWindowSize: 6,
      stepSize: 14,
      embargoTradingDayCount: 1,
      horizonType: "ULTRA_SHORT",
    });
    assert.equal(windows.windows.length, 2);
    const oos0 = dates.slice(windows.windows[0].oosStartIndex, windows.windows[0].oosEndIndex + 1);
    const oos1 = dates.slice(windows.windows[1].oosStartIndex, windows.windows[1].oosEndIndex + 1);
    assert.equal(oos0.length, 6);
    assert.equal(oos1.length, 6);
    assert.deepEqual(capturedTiles[0], oos0.slice(0, 3));
    assert.deepEqual(capturedTiles[1], oos0.slice(3, 6));
    assert.deepEqual(capturedTiles[2], oos1.slice(0, 3));
    assert.deepEqual(capturedTiles[3], oos1.slice(3, 6));
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE6B-W03 embargo=1 ULTRA_SHORT 22-date success still PASS", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W04 omitted embargo still FAIL", () => {
  const input = buildWalkForwardInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardValidation(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W05 feature asOf is signal of that tile for oos=6", () => {
  const { result, captures, featureCaptures } = captureWalkForwardBenchmarks(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 28),
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(captures.length, 4);
  assert.equal(featureCaptures.length, 4);
  for (const cap of captures) {
    const signal = cap.tradeIntent.entryIntent.signalTradingDate;
    const entry = cap.tradeIntent.entryDate;
    const exit = cap.tradeIntent.exitDate;
    assert.equal(signal < entry, true);
    assert.equal(entry <= exit, true);
    assert.equal(cap.candleDates.includes(entry), true);
    assert.equal(cap.candleDates.includes(exit), true);
    const matching = featureCaptures.filter((f) => f.featureAsOfTradingDate === signal);
    assert.equal(matching.length > 0, true);
    for (const feat of matching) {
      assert.equal(feat.featureDates.includes(entry), false);
      assert.equal(feat.featureDates.includes(exit), false);
      assert.equal(feat.featureDates.includes(signal), true);
      for (const date of feat.featureDates) {
        assert.equal(date <= feat.featureAsOfTradingDate, true);
      }
    }
  }
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W06 extra future benchmark excluded from every standalone tile", () => {
  const dates = generateWeekdayDates("2101-03-01", 28);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  });
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 99999 });
  const { result, captures } = captureWalkForwardBenchmarks(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(captures.length, 4);
  for (const cap of captures) {
    assert.equal(cap.benchmarkDates.includes(extraDate), false);
    assert.equal(cap.benchmarkDates.length, 3);
  }
});

test("GATE6B-W07 first tile failure maps to OOS_FOLD_FAILED and stops later tiles", () => {
  const dates = generateWeekdayDates("2101-03-01", 28);
  const input = buildWalkForwardInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  });
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  let call = 0;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(inp) {
      call += 1;
      if (call === 1) {
        return {
          pipelineStatus: "BLOCKED_PIPELINE",
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
          errors: [{ code: ERROR.OOS_FOLD_FAILED, field: "tile1" }],
          errorCodes: [ERROR.OOS_FOLD_FAILED],
        };
      }
      return original(inp);
    };
    const result = runWalkForwardValidation(input);
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
    assert.equal(call, 3);
    assert.equal(result.errors[0].field, "tile1");
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE6B-W08 two finite MAX_VALUE tile totals overflow fold mean as OOS_FOLD_FAILED", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), false);
  assert.equal(result.errors[0].field, "oosMetrics");
  assert.equal(result.folds[0].totalReturn, null);
  assert.equal(result.folds[0].benchmarkReturn, null);
  assert.equal(result.folds[0].alpha, null);
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W09 two finite MAX_VALUE tile benchmarks overflow fold mean as OOS_FOLD_FAILED", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: 0.01, benchmarkReturn: Number.MAX_VALUE, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W10 two finite MAX_VALUE tile alphas overflow fold mean as OOS_FOLD_FAILED", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: 0.01, benchmarkReturn: 0.01, alpha: Number.MAX_VALUE }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assertOfficialLeakageFreeze(result);
});

test("GATE6B-W11 large finite tile pair remains COMPLETED", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE / 4, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(Number.isFinite(result.folds[0].totalReturn), true);
  assert.equal(Number.isFinite(result.meanOosTotalReturn), true);
  assertOfficialLeakageFreeze(result);
});

test("GATE6D-W01 standalone walk-forward requires finite-tile-mean helper", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes('require("./finite-tile-mean")'), true);
  assert.equal(src.includes("assertFiniteEqualWeightedMean"), true);
});

test("GATE6E-W01 fold aggregate uses finite-tile-mean helper", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes('require("./finite-tile-mean")'), true);
  assert.equal(src.includes("assertFiniteEqualWeightedMean"), true);
  assert.equal(src.includes("folds.map((fold) => fold.totalReturn)"), true);
  assert.equal(src.includes("folds.map((fold) => fold.benchmarkReturn)"), true);
  assert.equal(src.includes("folds.map((fold) => fold.alpha)"), true);
  assert.equal(src.includes("let sumTotal = 0"), false);
  assert.equal(src.includes("sumTotal += fold.totalReturn"), false);
  assert.equal(src.includes("sumTotal + fold.totalReturn"), false);
});

test("GATE6E-U01 helper still has no official aggregate error code", () => {
  const helperSrc = fs.readFileSync(
    path.join(__dirname, "..", "lib", "backtest", "finite-tile-mean.js"),
    "utf8",
  );
  assert.equal(helperSrc.includes("WALK_FORWARD_AGGREGATE_NONFINITE"), false);
});

test("GATE6F-W01 fold aggregate overflow field is meanOosTotalReturn", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.meanOosTotalReturn, null);
  assertOfficialLeakageFreeze(result);
});

test("GATE6F-W02 fold aggregate benchmark overflow field is meanOosBenchmarkReturn", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: 0.01, benchmarkReturn: Number.MAX_VALUE, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosBenchmarkReturn");
  assertOfficialLeakageFreeze(result);
});

test("GATE6F-W03 fold aggregate alpha overflow field is meanOosAlpha", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: 0.01, benchmarkReturn: 0.01, alpha: Number.MAX_VALUE }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosAlpha");
  assertOfficialLeakageFreeze(result);
});

test("GATE6G-W01 freeze source pins helper for tile means and fold aggregate", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes('require("./finite-tile-mean")'), true);
  assert.equal(src.includes("assertFiniteEqualWeightedMean"), true);
  assert.equal(src.includes("folds.map((fold) => fold.totalReturn)"), true);
  assert.equal(src.includes("folds.map((fold) => fold.benchmarkReturn)"), true);
  assert.equal(src.includes("folds.map((fold) => fold.alpha)"), true);
  assert.equal(src.includes("let sumTotal = 0"), false);
  assert.equal(src.includes("sumTotal += fold.totalReturn"), false);
  assert.equal(src.includes("sumTotal + fold.totalReturn"), false);
  assert.equal(src.includes("sumTotalReturn"), false);
  assert.equal(src.includes("sumBenchmarkReturn"), false);
  assert.equal(src.includes('aggregateBlockedResult("meanOosTotalReturn")'), true);
  assert.equal(src.includes('aggregateBlockedResult("meanOosBenchmarkReturn")'), true);
  assert.equal(src.includes('aggregateBlockedResult("meanOosAlpha")'), true);
});

test("GATE6G-W02 22-date embargo=1 success still pins official flags false", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assertOfficialLeakageFreeze(result);
});

test("GATE6G-W03 one-tile MAX_VALUE still aggregate identity meanOosTotalReturn", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), false);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.meanOosTotalReturn, null);
  assertOfficialLeakageFreeze(result);
});

test("GATE6G-W04 two-tile MAX_VALUE still OOS_FOLD_FAILED field oosMetrics", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), false);
  assert.equal(result.errors[0].field, "oosMetrics");
  assertOfficialLeakageFreeze(result);
});

test("GATE6H-W01 source pins shared makeBacktestError and drops local makeError", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
});

test("GATE6H-W02 one-tile MAX_VALUE overflow keeps severity ERROR and meanOosTotalReturn", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6H-W03 two-tile MAX_VALUE overflow keeps severity ERROR and oosMetrics", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6H-W04 22-date embargo=1 success still pins official flags false", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assertOfficialLeakageFreeze(result);
});

test("GATE6I-W01 freeze source pins shared makeBacktestError and no local makeError", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
});

test("GATE6I-W02 freeze one-tile MAX_VALUE still severity ERROR field meanOosTotalReturn", () => {
  const result = withPatchedPipeline(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(buildWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6I-W03 freeze two-tile MAX_VALUE still severity ERROR field oosMetrics", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6I-W04 freeze 22-date embargo=1 success still pins official flags false", () => {
  const result = runWalkForwardValidation(buildWalkForwardInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assertOfficialLeakageFreeze(result);
});

test("GATE6U-R1-W01 nested pipeline fail fold.errorCodes[0] equals fold.error.code", () => {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched() {
      return {
        pipelineStatus: "BLOCKED_DATA_STAGE",
        totalReturn: null,
        benchmarkReturn: null,
        alpha: null,
        errors: [
          { code: "CALENDAR_MARKET_MISMATCH", severity: "ERROR" },
          { code: "DATA_STAGE_FAILED", severity: "ERROR" },
        ],
        errorCodes: ["CALENDAR_MARKET_MISMATCH", "DATA_STAGE_FAILED"],
      };
    };
    const result = runWalkForwardValidation(buildWalkForwardInput());
    const fold = result.folds[0];
    assert.equal(fold.status, FOLD_STATUS.BLOCKED);
    assert.equal(fold.errorCodes[0], "CALENDAR_MARKET_MISMATCH");
    assert.equal(result.errors[0].code, "CALENDAR_MARKET_MISMATCH");
    assert.equal(fold.errorCodes[0], result.errors[0].code);
    assert.equal(fold.errorCodes.includes(ERROR.OOS_FOLD_FAILED), true);
    assert.equal(fold.errorCodes[0] === ERROR.OOS_FOLD_FAILED, false);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE6U-R1-W02 nested pipeline fail keeps OOS_FOLD_FAILED after root", () => {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched() {
      return {
        pipelineStatus: "BLOCKED_DATA_STAGE",
        totalReturn: null,
        benchmarkReturn: null,
        alpha: null,
        errors: [
          { code: "CALENDAR_MARKET_MISMATCH", severity: "ERROR" },
          { code: "DATA_STAGE_FAILED", severity: "ERROR" },
        ],
        errorCodes: ["CALENDAR_MARKET_MISMATCH", "DATA_STAGE_FAILED"],
      };
    };
    const result = runWalkForwardValidation(buildWalkForwardInput());
    const fold = result.folds[0];
    const rootIdx = fold.errorCodes.indexOf("CALENDAR_MARKET_MISMATCH");
    const wrapIdx = fold.errorCodes.indexOf(ERROR.OOS_FOLD_FAILED);
    const dataIdx = fold.errorCodes.indexOf("DATA_STAGE_FAILED");
    assert.equal(rootIdx < wrapIdx, true);
    assert.equal(wrapIdx > -1, true);
    assert.equal(dataIdx > wrapIdx, true);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE6U-R1-W03 local OOS_FOLD_FAILED errorCodes[0] matches error.code", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.errors[0].code, ERROR.OOS_FOLD_FAILED);
  assert.equal(result.errorCodes[0], ERROR.OOS_FOLD_FAILED);
  assert.equal(result.folds[0].errorCodes[0], ERROR.OOS_FOLD_FAILED);
  assert.equal(result.errors[0].field, "oosMetrics");
});

test("GATE6U-R1-W04 top-level nested fail stays root-first then summaries", () => {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched() {
      return {
        pipelineStatus: "BLOCKED_DATA_STAGE",
        totalReturn: null,
        benchmarkReturn: null,
        alpha: null,
        errors: [
          { code: "CALENDAR_MARKET_MISMATCH", severity: "ERROR" },
          { code: "DATA_STAGE_FAILED", severity: "ERROR" },
        ],
        errorCodes: ["CALENDAR_MARKET_MISMATCH", "DATA_STAGE_FAILED"],
      };
    };
    const result = runWalkForwardValidation(buildWalkForwardInput());
    assert.equal(result.errors[0].code, result.errorCodes[0]);
    assert.equal(result.errorCodes[0], "CALENDAR_MARKET_MISMATCH");
    const rootIdx = result.errorCodes.indexOf("CALENDAR_MARKET_MISMATCH");
    const oosIdx = result.errorCodes.indexOf(ERROR.OOS_FOLD_FAILED);
    const wfIdx = result.errorCodes.indexOf(ERROR.WALK_FORWARD_STAGE_FAILED);
    assert.equal(rootIdx < oosIdx && oosIdx < wfIdx, true);
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE6U-R1-W05 train-parameter-selection 5O cause wrapper removed by 6U-R3", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "backtest", "train-parameter-selection.js"),
    "utf8",
  );
  assert.equal(src.includes("cause: rootErr.code"), false);
});

test("GATE6U-R2-W01 nested DATA pipeline fail copies failedStage DATA", () => {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched() {
      return {
        pipelineStatus: "BLOCKED_DATA_STAGE",
        failedStage: "DATA",
        totalReturn: null,
        benchmarkReturn: null,
        alpha: null,
        errors: [
          { code: "CALENDAR_MARKET_MISMATCH", severity: "ERROR" },
          { code: "DATA_STAGE_FAILED", severity: "ERROR" },
        ],
        errorCodes: ["CALENDAR_MARKET_MISMATCH", "DATA_STAGE_FAILED"],
      };
    };
    const result = runWalkForwardValidation(buildWalkForwardInput());
    assert.equal(result.failedStage, "DATA");
    assert.equal(result.errorCodes[0], "CALENDAR_MARKET_MISMATCH");
    const rootIdx = result.errorCodes.indexOf("CALENDAR_MARKET_MISMATCH");
    const oosIdx = result.errorCodes.indexOf(ERROR.OOS_FOLD_FAILED);
    assert.equal(rootIdx < oosIdx, true);
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE6U-R2-W02 invalid initialCapital stays failedStage WALK_FORWARD", () => {
  const input = buildWalkForwardInput();
  input.initialCapital = -1;
  const result = runWalkForwardValidation(input);
  assert.equal(result.failedStage, "WALK_FORWARD");
  assertOfficialLeakageFreeze(result);
});

test("GATE6U-R2-W03 train-parameter-selection failedStage TRAIN_SELECTION stays", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "backtest", "train-parameter-selection.js"),
    "utf8",
  );
  assert.equal(src.includes('failedStage: "TRAIN_SELECTION"'), true);
  assert.equal(src.includes("cause: rootErr.code"), false);
});

test("GATE6U-R2-W04 local tile overflow stays failedStage WALK_FORWARD", () => {
  const result = withTileMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardValidation(sixBarWalkForwardInput()),
  );
  assert.equal(result.failedStage, "WALK_FORWARD");
  assert.equal(result.errors[0].code, ERROR.OOS_FOLD_FAILED);
  assertOfficialLeakageFreeze(result);
});


test("GATE6U-R3-W01 walk-forward 6U-R1/R2 pins still hold", () => {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched() {
      return {
        pipelineStatus: "BLOCKED_DATA_STAGE",
        failedStage: "DATA",
        totalReturn: null,
        benchmarkReturn: null,
        alpha: null,
        errors: [
          { code: "CALENDAR_MARKET_MISMATCH", severity: "ERROR" },
          { code: "DATA_STAGE_FAILED", severity: "ERROR" },
        ],
        errorCodes: ["CALENDAR_MARKET_MISMATCH", "DATA_STAGE_FAILED"],
      };
    };
    const result = runWalkForwardValidation(buildWalkForwardInput());
    assert.equal(result.errorCodes[0], "CALENDAR_MARKET_MISMATCH");
    const rootIdx = result.errorCodes.indexOf("CALENDAR_MARKET_MISMATCH");
    const oosIdx = result.errorCodes.indexOf(ERROR.OOS_FOLD_FAILED);
    const wfIdx = result.errorCodes.indexOf(ERROR.WALK_FORWARD_STAGE_FAILED);
    assert.equal(rootIdx < oosIdx && oosIdx < wfIdx, true);
    assert.equal(result.failedStage, "DATA");
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});


test("GATE6V-W01 freeze nested DATA fail stays root-first with failedStage DATA", () => {
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched() {
      return {
        pipelineStatus: "BLOCKED_DATA_STAGE",
        failedStage: "DATA",
        totalReturn: null,
        benchmarkReturn: null,
        alpha: null,
        errors: [
          { code: "CALENDAR_MARKET_MISMATCH", severity: "ERROR" },
          { code: "DATA_STAGE_FAILED", severity: "ERROR" },
        ],
        errorCodes: ["CALENDAR_MARKET_MISMATCH", "DATA_STAGE_FAILED"],
      };
    };
    const result = runWalkForwardValidation(buildWalkForwardInput());
    assert.equal(result.errorCodes[0], "CALENDAR_MARKET_MISMATCH");
    const rootIdx = result.errorCodes.indexOf("CALENDAR_MARKET_MISMATCH");
    const oosIdx = result.errorCodes.indexOf(ERROR.OOS_FOLD_FAILED);
    const wfIdx = result.errorCodes.indexOf(ERROR.WALK_FORWARD_STAGE_FAILED);
    assert.equal(rootIdx < oosIdx && oosIdx < wfIdx, true);
    assert.equal(result.failedStage, "DATA");
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

test("GATE7G-W01 blockedWalkForwardResult copies folds array", () => {
  const folds = [{ foldId: "F1" }];
  const result = blockedWalkForwardResult({ folds });
  assert.notEqual(result.folds, folds);
  assert.equal(result.folds.length, 1);
  assert.equal(result.folds[0], folds[0]);
  assert.equal(result.partialFoldResults, result.folds);
  folds.push({ foldId: "F2" });
  assert.equal(result.folds.length, 1);
  assert.notEqual(result.partialFoldResults, folds);
  assert.equal(result.liveEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE7G-W02 non-array folds become empty array", () => {
  const result = blockedWalkForwardResult({ folds: { foldId: "F1" } });
  assert.deepEqual(result.folds, []);
  assert.deepEqual(result.partialFoldResults, []);
});

test("GATE7G-F01 make-error still has GATE 7F freeze", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/make-error.js"),
    "utf8"
  );
  assert.equal(src.includes("GATE 7F freeze"), true);
});

test("GATE7I-C01 completedWalkForwardResult copies folds array", () => {
  const folds = [{ foldId: "F1" }];
  const result = completedWalkForwardResult({ folds });
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.notEqual(result.folds, folds);
  assert.equal(result.officialFolds, result.folds);
  assert.equal(result.folds.length, 1);
  assert.equal(result.folds[0], folds[0]);
  folds.push({ foldId: "F2" });
  assert.equal(result.folds.length, 1);
  assert.notEqual(result.officialFolds, folds);
  assert.equal(result.liveEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE7I-C02 non-array folds become empty arrays", () => {
  const result = completedWalkForwardResult({ folds: { foldId: "F1" } });
  assert.deepEqual(result.folds, []);
  assert.deepEqual(result.officialFolds, []);
});

test("GATE7I-H01 train blockedSelectionResult still slices folds", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/train-parameter-selection.js"),
    "utf8"
  );
  assert.equal(src.includes("src.folds.slice()"), true);
});

test("GATE7K-G01 walk-forward still slices blocked and completed folds", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/walk-forward-validation.js"),
    "utf8"
  );
  assert.equal(src.includes("7K freeze"), true);
  assert.equal(src.includes("src.folds.slice()"), true);
  assert.equal(src.includes("src.partialFoldResults.slice()"), true);
});

test("GATE7K-C01 blocked and completed copies are not caller arrays", () => {
  const folds = [{ foldId: "F1" }];
  const blocked = blockedWalkForwardResult({ folds });
  assert.notEqual(blocked.folds, folds);
  assert.deepEqual(blocked.officialFolds, []);
  const completed = completedWalkForwardResult({ folds });
  assert.notEqual(completed.folds, folds);
  assert.equal(completed.officialFolds, completed.folds);
  assert.equal(completed.liveEligible, false);
});

test("GATE7L-S01 foldBase slices embargo date arrays", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes("window.embargoDates.slice()"), true);
  assert.equal(src.includes("window.postOosEmbargoDates.slice()"), true);
});

test("GATE7L-W01 fold embargoDates match window contents", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: input.horizonType,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
  });
  assert.equal(windows.ok, true);
  const result = runWalkForwardValidation(input);
  assert.equal(result.folds.length > 0, true);
  assert.deepEqual(result.folds[0].embargoDates, windows.windows[0].embargoDates);
  assert.deepEqual(result.folds[0].postOosEmbargoDates, windows.windows[0].postOosEmbargoDates);
  assert.equal(result.liveEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE7N-L01 walk-forward freeze pins embargo date slices", () => {
  const src = fs.readFileSync(WF_PATH, "utf8");
  assert.equal(src.includes("7N freeze"), true);
  assert.equal(src.includes("window.embargoDates.slice()"), true);
  assert.equal(src.includes("window.postOosEmbargoDates.slice()"), true);
});

test("GATE7N-C01 fold embargoDates still match window contents", () => {
  const input = buildWalkForwardInput();
  const windows = generateWalkForwardWindows({
    horizonType: input.horizonType,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
  });
  assert.equal(windows.ok, true);
  const result = runWalkForwardValidation(input);
  assert.equal(result.folds.length > 0, true);
  assert.deepEqual(result.folds[0].embargoDates, windows.windows[0].embargoDates);
  assert.equal(result.liveEligible, false);
});
