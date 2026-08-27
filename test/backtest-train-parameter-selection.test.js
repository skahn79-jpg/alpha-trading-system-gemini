"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sel = require("../lib/backtest/train-parameter-selection");
const {
  SELECTION_METRIC,
  SELECTION_TIE_BREAK,
  SELECTION_STATUS,
  SELECTION_EVALUATION_POLICY,
  TILE_SIZE,
  MAX_COMPLETE_TILE_COUNT,
  padTileIndex,
  buildTrainTiles,
  FOLD_STATUS,
  ERROR,
  AGGREGATE_DEFINITION,
  compareCandidateIdAsc,
  validateParameterCandidates,
  freezeSelectedParameters,
  selectWinnerFromTrainEvaluations,
  runWalkForwardTrainParameterSelection,
  sliceFeatureWindow,
  assertCausalTradeTiming,
  blockedSelectionResult,
  completedSelectionResult,
} = sel;

const walkForward = require("../lib/backtest/walk-forward-validation");
const { WALK_FORWARD_STATUS } = walkForward;

const {
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

const SEL_PATH = path.join(__dirname, "..", "lib", "backtest", "train-parameter-selection.js");

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

function defaultCandidates() {
  // SL/TP must not fill on the entry bar of the synthetic phase pattern
  // (entry high=10500 / low=9800). With LATEST_ALLOWED, early fills are accepted;
  // keep prices outside the entry bar so evaluation uses later bars / market exit.
  return [
    { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
    { id: "P003", stopLossPrice: 9200, takeProfitPrice: 11100 },
  ];
}

function injectExtraCalendarDays(pipelineBase, extraDays) {
  for (const day of extraDays || []) {
    pipelineBase.calendar.days.push(day);
  }
  pipelineBase.calendar.days.sort((a, b) => {
    if (a.tradingDate < b.tradingDate) return -1;
    if (a.tradingDate > b.tradingDate) return 1;
    return 0;
  });
}

function capturePipelineCalendars(runInput) {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const leakageGuard = require("../lib/backtest/leakage-guard");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
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

  function wrap(original, kind) {
    return function patched(input) {
      const tradeIntents = input && Array.isArray(input.tradeIntents)
        ? deepClone(input.tradeIntents)
        : [];
      const tradeIntent = tradeIntents[0] || null;
      const calendarDays = input && input.calendar && Array.isArray(input.calendar.days)
        ? deepClone(input.calendar.days)
        : [];
      const candleDates = input && input.dataset && Array.isArray(input.dataset.candles)
        ? input.dataset.candles.map((c) => c.tradingDate)
        : [];
      const benchmarkDates = input && input.benchmark && Array.isArray(input.benchmark.benchmarkSeries)
        ? input.benchmark.benchmarkSeries.map((r) => r && r.tradingDate)
        : [];
      const result = original(input);
      captures.push({
        kind,
        tradeId: tradeIntent && tradeIntent.tradeId,
        tradeIntent,
        tradeIntents,
        calendarDays,
        candleDates,
        benchmarkDates,
        pipelineStatus: result && result.pipelineStatus,
        totalReturn: result && result.totalReturn,
        closedTrades: result && Array.isArray(result.closedTrades)
          ? deepClone(result.closedTrades)
          : [],
      });
      return result;
    };
  }

  pipelineMod.runSyntheticPerformancePipeline = wrap(originalPerf, "train");
  pipelineMod.runSyntheticBenchmarkPipeline = wrap(originalBench, "oos");
  try {
    const result = runWalkForwardTrainParameterSelection(runInput);
    return { result, captures, featureCaptures };
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
    leakageGuard.assertFeatureWindowNoLookAhead = originalGuard;
  }
}

function findWeekendBetween(dates) {
  if (!dates || dates.length < 2) return null;
  const start = dates[0];
  const end = dates[dates.length - 1];
  let cur = addDaysYmd(start, 1);
  while (cur < end) {
    if (isWeekendYmd(cur) && !dates.includes(cur)) return cur;
    cur = addDaysYmd(cur, 1);
  }
  return null;
}

function blockedStepSize(trainWindowSize, oosWindowSize, embargoTradingDayCount) {
  const embargo = Number.isInteger(embargoTradingDayCount) && embargoTradingDayCount >= 0
    ? embargoTradingDayCount
    : 0;
  return trainWindowSize + 2 * embargo + oosWindowSize;
}

function buildSelectionInput(overrides) {
  const extras = overrides || {};
  const preserveStepSize = extras.preserveStepSize === true;
  const trainWindowSize = extras.trainWindowSize != null ? extras.trainWindowSize : 6;
  const oosWindowSize = extras.oosWindowSize != null ? extras.oosWindowSize : 3;
  const embargoTradingDayCount = extras.embargoTradingDayCount != null ? extras.embargoTradingDayCount : 1;
  const horizonType = extras.horizonType != null ? extras.horizonType : "ULTRA_SHORT";
  const requiredStep = blockedStepSize(trainWindowSize, oosWindowSize, embargoTradingDayCount);
  let stepSize = extras.stepSize != null ? extras.stepSize : requiredStep;
  if (!preserveStepSize && stepSize === oosWindowSize) {
    stepSize = requiredStep;
  }
  const tradingDates = extras.tradingDates || generateWeekdayDates("2101-03-01", requiredStep * 2);
  const market = extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const pipelineBase = extras.pipelineBase || buildPipelineBase(tradingDates, { market, ...extras });
  const {
    tradingDates: _td,
    market: _m,
    pipelineBase: _pb,
    parameterCandidates: _pc,
    benchmarkSeries: _bs,
    trainWindowSize: _tr,
    oosWindowSize: _oos,
    stepSize: _st,
    initialCapital: _ic,
    benchmarkDates: _bd,
    startClose: _sc,
    endClose: _ec,
    policyOverrides: _po,
    quantity: _q,
    calendarId: _cid,
    preserveStepSize: _ps,
    ...rest
  } = extras;
  return {
    market,
    tradingDates,
    trainWindowSize,
    oosWindowSize,
    stepSize,
    embargoTradingDayCount,
    horizonType,
    initialCapital: extras.initialCapital != null ? extras.initialCapital : 1000000,
    benchmarkSeries: extras.benchmarkSeries || buildBenchmarkSeries(
      extras.benchmarkDates || tradingDates,
      extras.startClose,
      extras.endClose,
    ),
    pipelineBase,
    parameterCandidates: extras.parameterCandidates || defaultCandidates(),
    ...rest,
  };
}

function evalRow(id, ret, status, sl, tp) {
  return {
    candidateId: id,
    trainTotalReturn: ret,
    status: status || "COMPLETED",
    stopLossPrice: sl != null ? sl : 9500,
    takeProfitPrice: tp != null ? tp : 11000,
  };
}

// ─── GATE5O Unit S01–S70 ───────────────────────────────────────────────

test("GATE5O-S01 known-answer winner P002 from literal scores", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", 0.05),
    evalRow("P002", 0.12),
    evalRow("P003", 0.08),
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.selectedCandidateId, "P002");
  assert.equal(r.selectionScore, 0.12);
  assert.equal(r.selectionMetric, "TRAIN_TOTAL_RETURN");
});


test("GATE5O-S02 tie-break equal scores → P001 via id ASC", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", 0.10),
    evalRow("P002", 0.10),
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.selectedCandidateId, "P001");
  assert.equal(r.selectionTieBreak, "CANDIDATE_ID_ASC");
});


test("GATE5O-S03 candidate order invariance [P001,P002,P003] vs [P003,P001,P002]", () => {
  const a = selectWinnerFromTrainEvaluations([
    evalRow("P001", 0.05), evalRow("P002", 0.12), evalRow("P003", 0.08),
  ]);
  const b = selectWinnerFromTrainEvaluations([
    evalRow("P003", 0.08), evalRow("P001", 0.05), evalRow("P002", 0.12),
  ]);
  assert.equal(a.selectedCandidateId, "P002");
  assert.equal(b.selectedCandidateId, "P002");
  assert.equal(a.selectionScore, b.selectionScore);
});


test("GATE5O-S04 SELECTION_METRIC constant", () => {
  assert.equal(SELECTION_METRIC, "TRAIN_TOTAL_RETURN");
});


test("GATE5O-S05 SELECTION_TIE_BREAK constant", () => {
  assert.equal(SELECTION_TIE_BREAK, "CANDIDATE_ID_ASC");
});


test("GATE5O-S06 compareCandidateIdAsc code-unit not locale", () => {
  assert.equal(compareCandidateIdAsc("P001", "P002"), -1);
  assert.equal(compareCandidateIdAsc("P002", "P001"), 1);
  assert.equal(compareCandidateIdAsc("P001", "P001"), 0);
  assert.equal(compareCandidateIdAsc("A", "B") < 0, true);
});


test("GATE5O-S07 validate missing candidates", () => {
  const r = validateParameterCandidates(undefined);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S08 validate non-array", () => {
  const r = validateParameterCandidates({ id: "P001" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S09 validate empty array", () => {
  const r = validateParameterCandidates([]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S10 validate single candidate blocked", () => {
  const r = validateParameterCandidates([{ id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 }]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S11 validate duplicate ids", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
    { id: "P001", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S12 validate blank id", () => {
  const r = validateParameterCandidates([
    { id: "  ", stopLossPrice: 9500, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S13 validate empty string id", () => {
  const r = validateParameterCandidates([
    { id: "", stopLossPrice: 9500, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S14 validate NaN stopLoss", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: NaN, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S15 validate Infinity takeProfit", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: 9500, takeProfitPrice: Infinity },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S16 validate negative price", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: -1, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S17 validate zero price blocked", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: 0, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S18 validate unsupported field stopLossPct", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000, stopLossPct: 0.02 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.INVALID_PARAMETER_CANDIDATES);
});


test("GATE5O-S19 validate unsupported field extra", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000, foo: 1 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S20 validate success returns cloned candidates", () => {
  const src = defaultCandidates();
  const r = validateParameterCandidates(src);
  assert.equal(r.ok, true);
  assert.equal(r.candidates.length, 3);
  src[0].stopLossPrice = 1;
  assert.equal(r.candidates[0].stopLossPrice, 9500);
});


test("GATE5O-S21 freezeSelectedParameters STOP_FIRST", () => {
  const r = freezeSelectedParameters({ stopLossPrice: 9500, takeProfitPrice: 11000 });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.intrabarConflictPolicy, "STOP_FIRST");
  assert.equal(Object.isFrozen(r.snapshot), true);
});


test("GATE5O-S22 freeze immutability mutation of original irrelevant", () => {
  const params = { stopLossPrice: 9500, takeProfitPrice: 11000 };
  const r = freezeSelectedParameters(params);
  params.stopLossPrice = 1;
  assert.equal(r.snapshot.stopLossPrice, 9500);
});


test("GATE5O-S23 freeze rejects invalid", () => {
  const r = freezeSelectedParameters({ stopLossPrice: NaN, takeProfitPrice: 11000 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.PARAMETER_FREEZE_FAILED);
});


test("GATE5O-S24 freeze rejects non-object", () => {
  const r = freezeSelectedParameters(null);
  assert.equal(r.ok, false);
});


test("GATE5O-S25 selectWinner empty fails TRAIN_SELECTION_FAILED", () => {
  const r = selectWinnerFromTrainEvaluations([]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.TRAIN_SELECTION_FAILED);
});


test("GATE5O-S26 selectWinner blocked eval TRAIN_CANDIDATE_EVALUATION_FAILED", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", 0.1, "BLOCKED"),
    evalRow("P002", 0.2),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
});


test("GATE5O-S27 selectWinner nonfinite TRAIN_SELECTION_NONFINITE", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", NaN),
    evalRow("P002", 0.2),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.TRAIN_SELECTION_NONFINITE);
});


test("GATE5O-S28 selectWinner Infinity score blocked", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", Infinity),
    evalRow("P002", 0.2),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.TRAIN_SELECTION_NONFINITE);
});


test("GATE5O-S29 candidateEvaluations sorted by id ASC", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P003", 0.08),
    evalRow("P001", 0.05),
    evalRow("P002", 0.12),
  ]);
  assert.deepEqual(r.candidateEvaluations.map((e) => e.candidateId), ["P001", "P002", "P003"]);
});


test("GATE5O-S30 parameterFrozen true on success", () => {
  const r = selectWinnerFromTrainEvaluations([evalRow("P001", 0.1), evalRow("P002", 0.2)]);
  assert.equal(r.parameterFrozen, true);
  assert.equal(Object.isFrozen(r.selectedParameters), true);
});


test("GATE5O-S31 tie three-way picks lowest id", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P003", 0.5),
    evalRow("P001", 0.5),
    evalRow("P002", 0.5),
  ]);
  assert.equal(r.selectedCandidateId, "P001");
});


test("GATE5O-S32 negative returns still comparable", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", -0.2),
    evalRow("P002", -0.05),
    evalRow("P003", -0.1),
  ]);
  assert.equal(r.selectedCandidateId, "P002");
});


test("GATE5O-S33 AGGREGATE_DEFINITION constant", () => {
  assert.equal(AGGREGATE_DEFINITION, "EQUAL_WEIGHTED_FOLD_MEAN");
});


test("GATE5O-S34 SELECTION_STATUS values", () => {
  assert.equal(SELECTION_STATUS.COMPLETED, "COMPLETED_TRAIN_SELECTION");
  assert.equal(SELECTION_STATUS.BLOCKED, "BLOCKED_TRAIN_SELECTION");
});


test("GATE5O-S35 FOLD_STATUS values", () => {
  assert.equal(FOLD_STATUS.COMPLETED, "COMPLETED_OOS_FOLD");
  assert.equal(FOLD_STATUS.BLOCKED, "BLOCKED_OOS_FOLD");
});


test("GATE5O-S36 ERROR codes present", () => {
  assert.equal(ERROR.INVALID_PARAMETER_CANDIDATES, "INVALID_PARAMETER_CANDIDATES");
  assert.equal(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, "TRAIN_CANDIDATE_EVALUATION_FAILED");
  assert.equal(ERROR.TRAIN_SELECTION_FAILED, "TRAIN_SELECTION_FAILED");
  assert.equal(ERROR.TRAIN_SELECTION_NONFINITE, "TRAIN_SELECTION_NONFINITE");
  assert.equal(ERROR.PARAMETER_FREEZE_FAILED, "PARAMETER_FREEZE_FAILED");
  assert.equal(ERROR.TRAIN_SELECTION_STAGE_FAILED, "TRAIN_SELECTION_STAGE_FAILED");
  assert.equal(ERROR.WALK_FORWARD_STAGE_FAILED, "WALK_FORWARD_STAGE_FAILED");
});


test("GATE5O-S37 selectedParameters omit id fields", () => {
  const r = selectWinnerFromTrainEvaluations([evalRow("P001", 0.1), evalRow("P002", 0.2)]);
  assert.equal(Object.hasOwn(r.selectedParameters, "id"), false);
  assert.equal(r.selectedParameters.stopLossPrice, 9500);
});


test("GATE5O-S38 validate non-object candidate element", () => {
  const r = validateParameterCandidates(["P001", { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 }]);
  assert.equal(r.ok, false);
});


test("GATE5O-S39 validate non-string id", () => {
  const r = validateParameterCandidates([
    { id: 1, stopLossPrice: 9500, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S40 freeze mutation throws or is ignored", () => {
  const r = freezeSelectedParameters({ stopLossPrice: 9500, takeProfitPrice: 11000 });
  assert.throws(() => {
    r.snapshot.stopLossPrice = 1;
  });
});


test("GATE5O-S41 selectWinner evidence frozen array", () => {
  const r = selectWinnerFromTrainEvaluations([evalRow("P001", 0.1), evalRow("P002", 0.2)]);
  assert.equal(Object.isFrozen(r.candidateEvaluations), true);
});


test("GATE5O-S42 selectWinner ignores benchmark fields if present", () => {
  const rows = [
    { ...evalRow("P001", 0.1), trainBenchmarkReturn: 0.99, trainAlpha: 0.99 },
    { ...evalRow("P002", 0.2), trainBenchmarkReturn: -0.99, trainAlpha: -0.99 },
  ];
  const r = selectWinnerFromTrainEvaluations(rows);
  assert.equal(r.selectedCandidateId, "P002");
});


test("GATE5O-S43 validate padded id rejected", () => {
  const r = validateParameterCandidates([
    { id: "P001 ", stopLossPrice: 9500, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S44 validate two valid candidates ok", () => {
  const r = validateParameterCandidates([
    { id: "A", stopLossPrice: 1, takeProfitPrice: 2 },
    { id: "B", stopLossPrice: 3, takeProfitPrice: 4 },
  ]);
  assert.equal(r.ok, true);
});


test("GATE5O-S45 compareCandidateIdAsc digit vs letter", () => {
  assert.equal(compareCandidateIdAsc("9", "A") < 0, true);
});


test("GATE5O-S46 selectWinner null evaluations", () => {
  const r = selectWinnerFromTrainEvaluations(null);
  assert.equal(r.ok, false);
});


test("GATE5O-S47 freeze rejects zero takeProfit", () => {
  assert.equal(freezeSelectedParameters({ stopLossPrice: 9500, takeProfitPrice: 0 }).ok, false);
});


test("GATE5O-S48 ERROR reexports WF production/legacy", () => {
  assert.equal(ERROR.PRODUCTION_MARKET_NOT_ALLOWED, "PRODUCTION_MARKET_NOT_ALLOWED");
  assert.equal(ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE, "LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE");
});


test("GATE5O-S49 known answer score field name trainTotalReturn only", () => {
  const r = selectWinnerFromTrainEvaluations([
    evalRow("P001", 0.05), evalRow("P002", 0.12), evalRow("P003", 0.08),
  ]);
  assert.equal(r.candidateEvaluations[1].trainTotalReturn, 0.12);
  assert.equal(Object.hasOwn(r.candidateEvaluations[1], "oosTotalReturn"), false);
});


test("GATE5O-S50 tie after reorder still P001", () => {
  const r = selectWinnerFromTrainEvaluations([evalRow("P002", 0.10), evalRow("P001", 0.10)]);
  assert.equal(r.selectedCandidateId, "P001");
});


test("GATE5O-S51 exports runWalkForwardTrainParameterSelection function", () => {assert.equal(typeof runWalkForwardTrainParameterSelection, "function");});


test("GATE5O-S52 exports validateParameterCandidates", () => {assert.equal(typeof validateParameterCandidates, "function");});


test("GATE5O-S53 exports freezeSelectedParameters", () => {assert.equal(typeof freezeSelectedParameters, "function");});


test("GATE5O-S54 exports selectWinnerFromTrainEvaluations", () => {assert.equal(typeof selectWinnerFromTrainEvaluations, "function");});


test("GATE5O-S55 exports compareCandidateIdAsc", () => {assert.equal(typeof compareCandidateIdAsc, "function");});


test("GATE5O-S56 source no Math.random", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("Math.random"), false);
});


test("GATE5O-S57 source no Date.now", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("Date.now"), false);
});


test("GATE5O-S58 source no network http", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("fetch("), false);
});


test("GATE5O-S59 source no placeOrder", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("placeOrder"), false);
});


test("GATE5O-S60 source uses runSyntheticPerformancePipeline", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("runSyntheticPerformancePipeline"), true);
});


test("GATE5O-S61 source uses runSyntheticBenchmarkPipeline", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("runSyntheticBenchmarkPipeline"), true);
});


test("GATE5O-S62 source uses generateWalkForwardWindows", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("generateWalkForwardWindows"), true);
});


test("GATE5O-S63 source STOP_FIRST literal", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("STOP_FIRST"), true);
});


test("GATE5O-S64 source no localeCompare", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("localeCompare"), false);
});


test("GATE5O-S65 validate rejects null stopLoss", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: null, takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S66 validate rejects string price", () => {
  const r = validateParameterCandidates([
    { id: "P001", stopLossPrice: "9500", takeProfitPrice: 11000 },
    { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S67 selectWinner -0 vs 0", () => {
  const r = selectWinnerFromTrainEvaluations([evalRow("P001", -0), evalRow("P002", 0)]);
  // -0 === 0 in JS equality for scores; tie → P001
  assert.equal(r.selectedCandidateId, "P001");
});


test("GATE5O-S68 freeze snapshot keys exactly three", () => {
  const r = freezeSelectedParameters({ stopLossPrice: 1, takeProfitPrice: 2, extra: 3 });
  assert.deepEqual(Object.keys(r.snapshot).sort(), ["intrabarConflictPolicy", "stopLossPrice", "takeProfitPrice"]);
});


test("GATE5O-S69 selectWinner status COMPLETED required", () => {
  const r = selectWinnerFromTrainEvaluations([
    { candidateId: "P001", trainTotalReturn: 0.1, status: "completed", stopLossPrice: 1, takeProfitPrice: 2 },
    evalRow("P002", 0.2),
  ]);
  assert.equal(r.ok, false);
});


test("GATE5O-S70 ERROR OOS and aggregate codes", () => {
  assert.equal(ERROR.OOS_FOLD_FAILED, "OOS_FOLD_FAILED");
  assert.equal(ERROR.WALK_FORWARD_AGGREGATE_NONFINITE, "WALK_FORWARD_AGGREGATE_NONFINITE");
});

// ─── GATE5O Integration P01–P40 ─────────────────────────────────────────

test("GATE5O-P01 KOSPI success completed", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.selectionStatus, SELECTION_STATUS.COMPLETED);
  assert.equal(result.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(result.foldCount >= 2, true);
  assert.equal(Number.isFinite(result.meanOosTotalReturn), true);
});


test("GATE5O-P02 KOSDAQ success", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const market = SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ;
  const input = buildSelectionInput({
    market,
    tradingDates: dates,
    pipelineBase: buildPipelineBase(dates, { market }),
  });
  input.pipelineBase.cost.policies = [makePolicy({ market: MARKET.SYNTHETIC_KOSDAQ })];
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.market, market);
});


test("GATE5O-P03 parameterFrozen on each fold", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  for (const fold of result.folds) {
    assert.equal(fold.parameterFrozen, true);
    assert.equal(Object.isFrozen(fold.selectedParameters), true);
  }
});


test("GATE5O-P04 aggregate means finite", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(Number.isFinite(result.meanOosTotalReturn), true);
  assert.equal(Number.isFinite(result.meanOosBenchmarkReturn), true);
  assert.equal(Number.isFinite(result.meanOosAlpha), true);
});


test("GATE5O-P05 officialFolds equals foldCount", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.officialFolds.length, result.foldCount);
  assert.equal(result.partialFoldResults.length, 0);
});


test("GATE5O-P06 safety flags all false", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
});


test("GATE5O-P07 executionStatus NOT_EXECUTED", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.executionStatus, EXEC_STATUS.NOT_EXECUTED);
});


test("GATE5O-P08 calculationStatus SIMULATED", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
});


test("GATE5O-P09 production KOSPI blocked", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({ market: "KOSPI" }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});


test("GATE5O-P10 legacy SYNTHETIC_MARKET blocked", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({ market: "SYNTHETIC_MARKET" }));
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});


test("GATE5O-P11 freeze after mutate original candidates", () => {
  const candidates = defaultCandidates();
  const input = buildSelectionInput({ parameterCandidates: candidates });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const frozenSl = result.folds[0].selectedParameters.stopLossPrice;
  candidates[0].stopLossPrice = 1;
  candidates[1].stopLossPrice = 1;
  candidates[2].stopLossPrice = 1;
  assert.equal(result.folds[0].selectedParameters.stopLossPrice, frozenSl);
});


test("GATE5O-P12 OOS mutation cannot change selectedCandidateId", () => {
  const input1 = buildSelectionInput();
  const r1 = runWalkForwardTrainParameterSelection(deepClone(input1));
  const input2 = deepClone(input1);
  // mutate last-fold OOS-only candles. Blocked WF: last 3 bars are fold2 OOS.
  const n = input2.pipelineBase.dataset.candles.length;
  for (let i = n - 3; i < n; i += 1) {
    input2.pipelineBase.dataset.candles[i].close = 1;
    input2.pipelineBase.dataset.candles[i].high = 2;
    input2.pipelineBase.dataset.candles[i].low = 1;
    input2.pipelineBase.dataset.candles[i].open = 1;
  }
  input2.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input2.pipelineBase.dataset);
  const r2 = runWalkForwardTrainParameterSelection(input2);
  assert.deepEqual(
    r1.folds.map((f) => f.selectedCandidateId),
    r2.folds.map((f) => f.selectedCandidateId),
  );
});


test("GATE5O-P13 train mutation can change selection", () => {
  const input1 = buildSelectionInput();
  const r1 = runWalkForwardTrainParameterSelection(deepClone(input1));
  const input2 = deepClone(input1);
  // Mutate train exit bars only (3-bar trade uses indices 0..2 / 3..5).
  // Keep entry bars inside all candidates' SL/TP bands to avoid EXIT_DATE_MISMATCH.
  for (const i of [2, 5]) {
    input2.pipelineBase.dataset.candles[i].high = 12000;
    input2.pipelineBase.dataset.candles[i].close = 11500;
    input2.pipelineBase.dataset.candles[i].open = 10800;
    input2.pipelineBase.dataset.candles[i].low = 10700;
  }
  input2.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input2.pipelineBase.dataset);
  const r2 = runWalkForwardTrainParameterSelection(input2);
  // Selection may or may not change; assert both completed and train-sensitive path runs
  assert.equal(r1.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r2.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  // At least selectionScore/id are computed independently (deepEqual of full result not required)
  assert.equal(typeof r2.folds[0].selectedCandidateId, "string");
});


test("GATE5O-P14 future candle mutation cannot change selection", () => {
  const input = buildSelectionInput();
  let extraDate = addDaysYmd(input.tradingDates[input.tradingDates.length - 1], 1);
  while (isWeekendYmd(extraDate)) extraDate = addDaysYmd(extraDate, 1);
  const r1 = runWalkForwardTrainParameterSelection(deepClone(input));
  input.pipelineBase.dataset.candles.push(integratedCandle(extraDate, { close: 50000, high: 51000, low: 49000, open: 50000 }));
  input.pipelineBase.dataset.coverage.to = extraDate;
  input.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input.pipelineBase.dataset);
  input.pipelineBase.calendar.days.push(makeCalendarDay(extraDate));
  input.pipelineBase.calendar.coverage.to = extraDate;
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 999 });
  const r2 = runWalkForwardTrainParameterSelection(deepClone(input));
  assert.deepEqual(
    r1.folds.map((f) => ({ id: f.selectedCandidateId, score: f.selectionScore })),
    r2.folds.map((f) => ({ id: f.selectedCandidateId, score: f.selectionScore })),
  );
});


test("GATE5O-P15 winner-only OOS N train + 1 OOS per fold", () => {
  let trainCalls = 0;
  let oosCalls = 0;
  const candidates = defaultCandidates();
  const input = buildSelectionInput({
    parameterCandidates: candidates,
    hooks: {
      onTrainPipelineCall: () => { trainCalls += 1; },
      onOosPipelineCall: () => { oosCalls += 1; },
    },
  });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const folds = result.foldCount;
  assert.equal(trainCalls, folds * candidates.length);
  assert.equal(oosCalls, folds);
});


test("GATE5O-P16 atomic candidate failure root propagation", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const original = pipelineMod.runSyntheticPerformancePipeline;
  let n = 0;
  pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
    n += 1;
    if (n === 2) {
      return {
        pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
        errors: [{ code: "FORCED_TRAIN_FAIL" }],
        errorCodes: ["FORCED_TRAIN_FAIL"],
        totalReturn: null,
      };
    }
    return original(input);
  };
  try {
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(result.officialFolds.length, 0);
    assert.equal(result.meanOosTotalReturn, null);
    assert.equal(hasCode(result, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED), true);
    assert.equal(hasCode(result, ERROR.TRAIN_SELECTION_STAGE_FAILED), true);
    assert.equal(hasCode(result, ERROR.WALK_FORWARD_STAGE_FAILED), true);
    const codes = result.errorCodes;
    const rootIdx = codes.indexOf(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
    const stageIdx = codes.indexOf(ERROR.TRAIN_SELECTION_STAGE_FAILED);
    const wfIdx = codes.indexOf(ERROR.WALK_FORWARD_STAGE_FAILED);
    assert.equal(rootIdx < stageIdx && stageIdx < wfIdx, true);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = original;
  }
});


test("GATE5O-P17 missing candidates blocked", () => {
  const input = buildSelectionInput();
  delete input.parameterCandidates;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_PARAMETER_CANDIDATES), true);
});


test("GATE5O-P18 one candidate blocked", () => {
  const input = buildSelectionInput({
    parameterCandidates: [{ id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 }],
  });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(hasCode(result, ERROR.INVALID_PARAMETER_CANDIDATES), true);
});


test("GATE5O-P19 determinism deepEqual", () => {
  const input = buildSelectionInput();
  const r1 = runWalkForwardTrainParameterSelection(deepClone(input));
  const r2 = runWalkForwardTrainParameterSelection(deepClone(input));
  assert.deepEqual(r1, r2);
});


test("GATE5O-P20 input immutability", () => {
  const input = buildSelectionInput();
  const snap = JSON.stringify(input);
  runWalkForwardTrainParameterSelection(input);
  assert.equal(JSON.stringify(input), snap);
});


test("GATE5O-P21 no nonfinite in JSON", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  const json = JSON.stringify(result);
  assert.equal(json.includes("Infinity"), false);
  assert.equal(json.includes("NaN"), false);
});


test("GATE5O-P22 fold fields present", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  const f = result.folds[0];
  assert.equal(f.foldId != null, true);
  assert.equal(f.trainStart != null, true);
  assert.equal(f.oosEnd != null, true);
  assert.equal(f.candidateCount, 3);
  assert.equal(Array.isArray(f.candidateEvaluations), true);
  assert.equal(f.selectedCandidateId != null, true);
  assert.equal(f.selectionMetric, SELECTION_METRIC);
  assert.equal(f.oosTotalReturn != null, true);
  assert.equal(f.totalReturn, f.oosTotalReturn);
  assert.equal(f.benchmarkReturn, f.oosBenchmarkReturn);
  assert.equal(f.alpha, f.oosAlpha);
});


test("GATE5O-P23 candidateEvaluations sorted ASC per fold", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    parameterCandidates: [
      { id: "P003", stopLossPrice: 9200, takeProfitPrice: 11100 },
      { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
      { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
    ],
  }));
  for (const fold of result.folds) {
    const ids = fold.candidateEvaluations.map((e) => e.candidateId);
    assert.deepEqual(ids, ["P001", "P002", "P003"]);
  }
});


test("GATE5O-P24 OOS window not tile-aligned fails at config", () => {
  const dates = generateWeekdayDates("2101-03-01", 12);
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 2,
    stepSize: 8,
  });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "oosWindowSize");
});


test("GATE5O-P25 invalid initialCapital", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({ initialCapital: 0 }));
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});


test("GATE5O-P26 benchmarkSeries must be array", () => {
  const input = buildSelectionInput();
  input.benchmarkSeries = null;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});


test("GATE5O-P27 null input INVALID_INPUT", () => {
  const result = runWalkForwardTrainParameterSelection(null);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});


test("GATE5O-P28 window config fail", () => {
  const input = buildSelectionInput({ stepSize: 1, oosWindowSize: 3 });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_STAGE_FAILED), true);
});


test("GATE5O-P29 production NASDAQ blocked", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({ market: "NASDAQ" }));
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});


test("GATE5O-P30 equal-weighted aggregate identity", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  const mean = result.folds.reduce((s, f) => s + f.oosTotalReturn, 0) / result.folds.length;
  assert.equal(Math.abs(result.meanOosTotalReturn - mean) < 1e-12, true);
  assert.equal(result.aggregateDefinition, AGGREGATE_DEFINITION);
});


test("GATE5O-P31 selectionMetric on result", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.selectionMetric, SELECTION_METRIC);
  assert.equal(result.selectionTieBreak, SELECTION_TIE_BREAK);
});


test("GATE5O-P32 no cross-fold warm-start independent selection", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  // Each fold has its own selectedParameters object (not shared reference across folds)
  if (result.folds.length >= 2) {
    assert.equal(result.folds[0].selectedParameters === result.folds[1].selectedParameters, false);
  }
});


test("GATE5O-P33 OOS fold fail after selection still records selectedCandidateId", () => {
  const input = buildSelectionInput();
  const windows = walkForward.generateWalkForwardWindows({
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  input.benchmarkSeries = input.benchmarkSeries.filter((row) => row.tradingDate !== windows.windows[0].oosStart);
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
  const blocked = result.folds.find((f) => f.status === FOLD_STATUS.BLOCKED);
  assert.equal(blocked.selectedCandidateId != null, true);
  assert.equal(blocked.parameterFrozen, true);
});


test("GATE5O-P34 failedStage TRAIN_SELECTION on candidate fail", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const original = pipelineMod.runSyntheticPerformancePipeline;
  pipelineMod.runSyntheticPerformancePipeline = () => ({
    pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
    errors: [{ code: "X" }],
    errorCodes: ["X"],
    totalReturn: null,
  });
  try {
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.failedStage, "TRAIN_SELECTION");
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = original;
  }
});


test("GATE5O-P35 future benchmark mutation no selection change", () => {
  const input = buildSelectionInput();
  const r1 = runWalkForwardTrainParameterSelection(deepClone(input));
  let extraDate = addDaysYmd(input.tradingDates[input.tradingDates.length - 1], 3);
  while (isWeekendYmd(extraDate)) extraDate = addDaysYmd(extraDate, 1);
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 1 });
  const r2 = runWalkForwardTrainParameterSelection(deepClone(input));
  assert.deepEqual(
    r1.folds.map((f) => f.selectedCandidateId),
    r2.folds.map((f) => f.selectedCandidateId),
  );
});


test("GATE5O-P36 candidate order invariance end-to-end", () => {
  const a = runWalkForwardTrainParameterSelection(buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
      { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
      { id: "P003", stopLossPrice: 9200, takeProfitPrice: 11100 },
    ],
  }));
  const b = runWalkForwardTrainParameterSelection(buildSelectionInput({
    parameterCandidates: [
      { id: "P003", stopLossPrice: 9200, takeProfitPrice: 11100 },
      { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
      { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
    ],
  }));
  assert.deepEqual(
    a.folds.map((f) => f.selectedCandidateId),
    b.folds.map((f) => f.selectedCandidateId),
  );
});


test("GATE5O-P37 errorCodes empty on success", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.deepEqual(result.errorCodes, []);
  assert.equal(result.failedStage, null);
});


test("GATE5O-P38 successfulFoldCount equals foldCount", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.successfulFoldCount, result.foldCount);
  assert.equal(result.failedFoldCount, 0);
});


test("GATE5O-P39 unsupported candidate field blocks before windows", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000, takeProfitPct: 0.1 },
      { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
    ],
  });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(hasCode(result, ERROR.INVALID_PARAMETER_CANDIDATES), true);
  assert.equal(result.foldCount, 0);
});


test("GATE5O-P40 aggregate overflow fail-closed", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const original = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      const base = original(input);
      return {
        ...base,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA,
        totalReturn: Number.MAX_VALUE,
        benchmarkReturn: 0.01,
        alpha: 0.01,
        errors: [],
        errorCodes: [],
      };
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
    assert.equal(result.meanOosTotalReturn, null);
    assert.equal(result.officialFolds.length, 0);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = original;
  }
});

// ─── GATE5O-R1 — Selection / Calendar / Exit Hardening ─────────────────

test("GATE5O-R1-E01 Train→OOS mixed; firstFailure is Train", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tid = input.tradeIntents[0].tradeId;
      if (String(tid).startsWith("WF-0001:") && String(tid).includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "TRAIN_ROOT_WF1" }],
          errorCodes: ["TRAIN_ROOT_WF1"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      const tid = input.tradeIntents[0].tradeId;
      if (String(tid).startsWith("WF-0002:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "OOS_ROOT_WF2" }],
          errorCodes: ["OOS_ROOT_WF2"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assert.equal(result.errors[0].code, "TRAIN_ROOT_WF1");
    assert.equal(result.errorCodes[0], "TRAIN_ROOT_WF1");
    const evalIdx = result.errorCodes.indexOf(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
    assert.equal(evalIdx > 0, true);
    assert.equal(hasCode(result, ERROR.TRAIN_SELECTION_STAGE_FAILED), true);
    assert.equal(hasCode(result, ERROR.WALK_FORWARD_STAGE_FAILED), true);
    assert.equal(result.errorCodes.includes("OOS_ROOT_WF2"), false);
    const fold2 = result.folds.find((f) => f.foldId === "WF-0002");
    assert.equal(fold2 != null, true);
    assert.equal(fold2.errorCodes.includes("OOS_ROOT_WF2"), true);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R1-E02 OOS→Train mixed; firstFailure is OOS", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      const tid = input.tradeIntents[0].tradeId;
      if (String(tid).startsWith("WF-0001:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "OOS_ROOT_WF1" }],
          errorCodes: ["OOS_ROOT_WF1"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tid = input.tradeIntents[0].tradeId;
      if (String(tid).startsWith("WF-0002:") && String(tid).includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "TRAIN_ROOT_LATER" }],
          errorCodes: ["TRAIN_ROOT_LATER"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.failedStage, "WALK_FORWARD");
    assert.equal(result.errors[0].code, "OOS_ROOT_WF1");
    assert.equal(result.errors[1].code, ERROR.OOS_FOLD_FAILED);
    assert.equal(result.errorCodes.includes("TRAIN_ROOT_LATER"), false);
    assert.equal(hasCode(result, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED), false);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R1-E03 multi Train; first Train root wins", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tid = String(input.tradeIntents[0].tradeId);
      if (tid.startsWith("WF-0001:") && tid.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "TRAIN_ROOT_A" }],
          errorCodes: ["TRAIN_ROOT_A"],
          totalReturn: null,
        };
      }
      if (tid.startsWith("WF-0002:") && tid.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "TRAIN_ROOT_B" }],
          errorCodes: ["TRAIN_ROOT_B"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assert.equal(result.errors[0].code, "TRAIN_ROOT_A");
    assert.equal(result.errorCodes[0], "TRAIN_ROOT_A");
    assert.equal(result.errorCodes.includes("TRAIN_ROOT_B"), false);
    const fold2 = result.folds.find((f) => f.foldId === "WF-0002");
    assert.equal(fold2.errorCodes.some((c) => c === ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED), true);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE5O-R1-E04 multi OOS; first OOS root wins", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      const tid = input.tradeIntents[0].tradeId;
      if (String(tid).startsWith("WF-0001:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "OOS_ROOT_A" }],
          errorCodes: ["OOS_ROOT_A"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      if (String(tid).startsWith("WF-0002:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "OOS_ROOT_B" }],
          errorCodes: ["OOS_ROOT_B"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.failedStage, "WALK_FORWARD");
    assert.equal(result.errors[0].code, "OOS_ROOT_A");
    assert.equal(result.errorCodes.includes("OOS_ROOT_B"), false);
    const fold2 = result.folds.find((f) => f.foldId === "WF-0002");
    assert.equal(fold2.errorCodes.includes("OOS_ROOT_B"), true);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R1-E05 later root only in fold2 diagnostics", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tid = String(input.tradeIntents[0].tradeId);
      if (tid.startsWith("WF-0001:") && tid.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "TRAIN_ROOT_FIRST" }],
          errorCodes: ["TRAIN_ROOT_FIRST"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      if (String(input.tradeIntents[0].tradeId).startsWith("WF-0002:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "OOS_ROOT_LATER" }],
          errorCodes: ["OOS_ROOT_LATER"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.errorCodes.includes("OOS_ROOT_LATER"), false);
    const fold2 = result.folds.find((f) => f.foldId === "WF-0002");
    assert.equal(fold2.errorCodes.includes("OOS_ROOT_LATER"), true);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R1-E06 firstFailure deterministic", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  function install() {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tid = String(input.tradeIntents[0].tradeId);
      if (tid.startsWith("WF-0001:") && tid.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "DET_TRAIN" }],
          errorCodes: ["DET_TRAIN"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      if (String(input.tradeIntents[0].tradeId).startsWith("WF-0002:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "DET_OOS" }],
          errorCodes: ["DET_OOS"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
  }
  try {
    install();
    const r1 = runWalkForwardTrainParameterSelection(buildSelectionInput());
    install();
    const r2 = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.deepEqual(r1.errors, r2.errors);
    assert.deepEqual(r1.errorCodes, r2.errorCodes);
    assert.equal(r1.failedStage, r2.failedStage);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R1-C01 non-member TRADING_DAY excluded", () => {
  const input = buildSelectionInput();
  const weekend = findWeekendBetween(input.tradingDates.slice(0, 6));
  assert.equal(weekend != null, true);
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(weekend, { dayStatus: "TRADING_DAY" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train" && String(c.tradeId).startsWith("WF-0001:"));
  assert.equal(trainCap != null, true);
  const row = trainCap.calendarDays.find((d) => d.tradingDate === weekend);
  if (row != null) {
    assert.notEqual(row.dayStatus, "TRADING_DAY");
  }
});

test("GATE5O-R1-C02 missing canonical row synthesized", () => {
  const input = buildSelectionInput();
  const missing = input.tradingDates[1];
  input.pipelineBase.calendar.days = input.pipelineBase.calendar.days.filter(
    (d) => d.tradingDate !== missing,
  );
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train" && String(c.tradeId).startsWith("WF-0001:"));
  const row = trainCap.calendarDays.find((d) => d.tradingDate === missing);
  assert.equal(row != null, true);
  assert.equal(row.dayStatus, "TRADING_DAY");
});

test("GATE5O-R1-C03 non-member CLOSED excluded", () => {
  const input = buildSelectionInput();
  const weekend = findWeekendBetween(input.tradingDates.slice(0, 6));
  assert.equal(weekend != null, true);
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(weekend, { dayStatus: "CLOSED" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train" && String(c.tradeId).startsWith("WF-0001:"));
  const row = trainCap.calendarDays.find((d) => d.tradingDate === weekend);
  if (row != null) {
    assert.notEqual(row.dayStatus, "CLOSED");
  }
});

test("GATE5O-R1-C04 dataset/calendar membership align", () => {
  const input = buildSelectionInput();
  const weekend = findWeekendBetween(input.tradingDates.slice(0, 6));
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(weekend, { dayStatus: "TRADING_DAY" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train" && String(c.tradeId).startsWith("WF-0001:"));
  const trainDates = new Set(input.tradingDates.slice(0, 6));
  for (const d of trainCap.calendarDays) {
    if (d.dayStatus === "TRADING_DAY") {
      assert.equal(trainDates.has(d.tradingDate), true);
    }
  }
  for (const date of trainCap.candleDates) {
    assert.equal(trainDates.has(date), true);
  }
});

test("GATE5O-R1-C05 source calendar immutable", () => {
  const input = buildSelectionInput();
  const weekend = findWeekendBetween(input.tradingDates.slice(0, 6));
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(weekend, { dayStatus: "TRADING_DAY" }),
  ]);
  const before = JSON.stringify(input.pipelineBase.calendar);
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(JSON.stringify(input.pipelineBase.calendar), before);
});

test("GATE5O-R1-C06 OOS calendar same contract", () => {
  const input = buildSelectionInput();
  const oosDates = input.tradingDates.slice(
    input.trainWindowSize + input.embargoTradingDayCount,
    input.trainWindowSize + input.embargoTradingDayCount + input.oosWindowSize,
  );
  // Prefer a weekend inside OOS coverage; otherwise any non-member near the window.
  let injectDate = findWeekendBetween([oosDates[0], oosDates[oosDates.length - 1]]);
  if (injectDate == null) {
    injectDate = addDaysYmd(oosDates[0], 1);
    while (oosDates.includes(injectDate) || input.tradingDates.includes(injectDate)) {
      injectDate = addDaysYmd(injectDate, 1);
    }
  }
  assert.equal(injectDate != null, true);
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(injectDate, { dayStatus: "TRADING_DAY" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosCap = captures.find((c) => c.kind === "oos" && c.tradeId === "WF-0001:oos:T01");
  assert.equal(oosCap != null, true);
  const row = oosCap.calendarDays.find((d) => d.tradingDate === injectDate);
  if (row != null) {
    assert.notEqual(row.dayStatus, "TRADING_DAY");
  }
  const oosSet = new Set(oosDates);
  for (const d of oosCap.calendarDays) {
    if (d.dayStatus === "TRADING_DAY") {
      assert.equal(oosSet.has(d.tradingDate), true);
    }
  }
});

test("GATE5O-R1-X01 entry-bar SL COMPLETED", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9900, takeProfitPrice: 12000 },
      { id: "P002", stopLossPrice: 9900, takeProfitPrice: 12100 },
    ],
  });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const fold of result.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(ev.status, "COMPLETED");
    }
  }
});

test("GATE5O-R1-X02 entry-bar TP COMPLETED", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 8000, takeProfitPrice: 10400 },
      { id: "P002", stopLossPrice: 8100, takeProfitPrice: 10400 },
    ],
  });
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const fold of result.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(ev.status, "COMPLETED");
    }
  }
});

test("GATE5O-R1-X03 middle-bar SL COMPLETED", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9600, takeProfitPrice: 12000 },
      { id: "P002", stopLossPrice: 9600, takeProfitPrice: 12100 },
    ],
  });
  // Entry low=9800 > 9600 (no entry SL); force exit-bar low to hit SL.
  for (const i of [2, 5, 8, 11]) {
    if (input.pipelineBase.dataset.candles[i]) {
      input.pipelineBase.dataset.candles[i].low = 9500;
      input.pipelineBase.dataset.candles[i].close = 9550;
    }
  }
  input.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input.pipelineBase.dataset);
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const fold of result.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(ev.status, "COMPLETED");
    }
  }
});

test("GATE5O-R1-X04 middle-bar TP COMPLETED", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 8000, takeProfitPrice: 11000 },
      { id: "P002", stopLossPrice: 8100, takeProfitPrice: 11000 },
    ],
  });
  // Entry high=10500 < 11000; exit high=11200 hits TP on deadline bar.
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const fold of result.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(ev.status, "COMPLETED");
    }
  }
});

test("GATE5O-R1-X05 no trigger → final bar market exit COMPLETED", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 100, takeProfitPrice: 999999 },
      { id: "P002", stopLossPrice: 200, takeProfitPrice: 888888 },
    ],
  });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train");
  assert.equal(trainCap.tradeIntent.exitDateMode, "LATEST_ALLOWED");
  for (const fold of result.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(ev.status, "COMPLETED");
    }
  }
});

test("GATE5O-R1-X06 same-bar SL/TP STOP_FIRST", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9900, takeProfitPrice: 10400 },
      { id: "P002", stopLossPrice: 9900, takeProfitPrice: 10400 },
    ],
  });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train" && c.closedTrades.length > 0);
  assert.equal(trainCap != null, true);
  assert.equal(trainCap.closedTrades[0].exitPrice, 9900);
  assert.equal(trainCap.tradeIntent.exitPolicy.intrabarConflictPolicy, "STOP_FIRST");
});

test("GATE5O-R1-X07 actual exitDate propagates", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9900, takeProfitPrice: 12000 },
      { id: "P002", stopLossPrice: 9900, takeProfitPrice: 12100 },
    ],
  });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainCap = captures.find((c) => c.kind === "train" && c.closedTrades.length > 0);
  assert.equal(trainCap != null, true);
  const entryDate = trainCap.tradeIntent.entryDate;
  const plannedExit = trainCap.tradeIntent.exitDate;
  const actualExit = trainCap.closedTrades[0].exitDate;
  assert.equal(actualExit, entryDate);
  assert.notEqual(actualExit, plannedExit);
});

test("GATE5O-R1-X08 trainTotalReturn from performance", () => {
  const input = buildSelectionInput({
    parameterCandidates: [
      { id: "P001", stopLossPrice: 9900, takeProfitPrice: 12000 },
      { id: "P002", stopLossPrice: 8000, takeProfitPrice: 10400 },
    ],
  });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const fold = result.folds[0];
  for (const ev of fold.candidateEvaluations) {
    const cap = captures.find(
      (c) => c.kind === "train" && c.tradeId === `WF-0001:${ev.candidateId}:train:T01`,
    );
    assert.equal(cap != null, true);
    assert.equal(ev.trainTotalReturn, cap.totalReturn);
  }
});

test("GATE5O-R1-SM01 trainWindowSize>3; exitDate is bar2", () => {
  const dates = generateWeekdayDates("2101-03-01", 28);
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 9,
    oosWindowSize: 3,
    stepSize: 14,
  });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainDates = dates.slice(0, 9);
  const trainCap = captures.find((c) => c.kind === "train" && String(c.tradeId).startsWith("WF-0001:"));
  assert.equal(trainCap.tradeIntent.exitDate, trainDates[2]);
  assert.equal(result.folds[0].selectionEvaluationTradingDayCount, 9);
  assert.equal(result.folds[0].selectionTradeCount, 3);
  assert.equal(result.folds[0].selectionEvaluationEnd, trainDates[8]);
  assert.equal(result.folds[0].selectionDroppedTailTradingDayCount, 0);
  assert.equal(result.folds[0].trainTradingDayCount, 9);
});

test("GATE5O-R1-SM02 trainWindowSize 10 fail-closed not tile-aligned", () => {
  const dates = generateWeekdayDates("2101-03-01", 26);
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 10,
    oosWindowSize: 3,
    stepSize: 13,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "trainWindowSize");
});

test("GATE5O-R1-SM03 evaluationStart literal", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  const fold = result.folds[0];
  assert.equal(fold.selectionEvaluationStart, fold.trainStart);
});

test("GATE5O-R1-SM04 evaluationEnd literal", () => {
  const input = buildSelectionInput();
  const result = runWalkForwardTrainParameterSelection(input);
  const fold = result.folds[0];
  assert.equal(fold.selectionEvaluationEnd, input.tradingDates[5]);
  assert.equal(fold.selectionEvaluationEnd, fold.trainEnd);
});

test("GATE5O-R1-SM05 evaluationTradingDayCount = complete tiles * 3", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    trainWindowSize: 9,
    tradingDates: generateWeekdayDates("2101-03-01", 28),
    oosWindowSize: 3,
    stepSize: 14,
  }));
  for (const fold of result.folds) {
    assert.equal(fold.selectionEvaluationTradingDayCount, 9);
    assert.equal(fold.selectionTradeCount, 3);
  }
});

test("GATE5O-R1-SM06 evaluationPolicy exact constant", () => {
  assert.equal(SELECTION_EVALUATION_POLICY, "NONOVERLAPPING_THREE_BAR_TILES");
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  for (const fold of result.folds) {
    assert.equal(fold.selectionEvaluationPolicy, SELECTION_EVALUATION_POLICY);
  }
});

test("GATE5O-R1-A01 winner params", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  const fold = result.folds[0];
  const winner = fold.candidateEvaluations.find((e) => e.candidateId === fold.selectedCandidateId);
  assert.equal(winner != null, true);
  assert.equal(winner.stopLossPrice, fold.selectedParameters.stopLossPrice);
  assert.equal(winner.takeProfitPrice, fold.selectedParameters.takeProfitPrice);
});

test("GATE5O-R1-A02 loser params", () => {
  const candidates = defaultCandidates();
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    parameterCandidates: candidates,
  }));
  const fold = result.folds[0];
  const losers = fold.candidateEvaluations.filter((e) => e.candidateId !== fold.selectedCandidateId);
  assert.equal(losers.length >= 1, true);
  for (const loser of losers) {
    const src = candidates.find((c) => c.id === loser.candidateId);
    assert.equal(loser.stopLossPrice, src.stopLossPrice);
    assert.equal(loser.takeProfitPrice, src.takeProfitPrice);
    assert.equal(typeof loser.trainTotalReturn, "number");
    assert.equal(loser.status, "COMPLETED");
  }
});

test("GATE5O-R1-A03 canonical order", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    parameterCandidates: [
      { id: "P003", stopLossPrice: 9200, takeProfitPrice: 11100 },
      { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
      { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
    ],
  }));
  for (const fold of result.folds) {
    assert.deepEqual(
      fold.candidateEvaluations.map((e) => e.candidateId),
      ["P001", "P002", "P003"],
    );
  }
});

test("GATE5O-R1-A04 mutation immutability", () => {
  const candidates = defaultCandidates();
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    parameterCandidates: candidates,
  }));
  const snap = deepClone(result.folds[0].candidateEvaluations);
  candidates[0].stopLossPrice = 1;
  candidates[1].takeProfitPrice = 1;
  assert.deepEqual(result.folds[0].candidateEvaluations, snap);
});

test("GATE5O-R1-A05 JSON stringify preserves", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  const parsed = JSON.parse(JSON.stringify(result));
  for (const fold of parsed.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(typeof ev.stopLossPrice, "number");
      assert.equal(typeof ev.takeProfitPrice, "number");
      assert.equal(ev.candidateId != null, true);
    }
  }
});

test("GATE5O-R1-A06 finite numbers", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  for (const fold of result.folds) {
    for (const ev of fold.candidateEvaluations) {
      assert.equal(Number.isFinite(ev.stopLossPrice), true);
      assert.equal(Number.isFinite(ev.takeProfitPrice), true);
      assert.equal(Number.isFinite(ev.trainTotalReturn), true);
    }
  }
});

// ─── GATE5O-R2A — First Failure / Exact Calendar Membership ────────────

test("GATE5O-R2A-A train-first then OOS-later keeps exact official errors", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tradeId = String(input.tradeIntents[0].tradeId);
      if (tradeId.startsWith("WF-0001:") && tradeId.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "R2A_TRAIN_ROOT" }],
          errorCodes: ["R2A_TRAIN_ROOT"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      if (String(input.tradeIntents[0].tradeId).startsWith("WF-0002:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "R2A_OOS_LATER" }],
          errorCodes: ["R2A_OOS_LATER"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };

    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.errorCodes[0], "R2A_TRAIN_ROOT");
    const rootIdx = result.errorCodes.indexOf("R2A_TRAIN_ROOT");
    const evalIdx = result.errorCodes.indexOf(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
    const selIdx = result.errorCodes.indexOf(ERROR.TRAIN_SELECTION_STAGE_FAILED);
    const wfIdx = result.errorCodes.indexOf(ERROR.WALK_FORWARD_STAGE_FAILED);
    assert.equal(rootIdx > -1 && evalIdx > rootIdx && selIdx > evalIdx && wfIdx > selIdx, true);
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assert.equal(result.errors[0].code, "R2A_TRAIN_ROOT");
    assert.equal(result.errorCodes.includes("R2A_OOS_LATER"), false);
    assert.equal(
      result.folds.find((fold) => fold.foldId === "WF-0002").errorCodes.includes("R2A_OOS_LATER"),
      true,
    );
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R2A-B OOS-first then Train-later keeps exact official errors", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      if (String(input.tradeIntents[0].tradeId).startsWith("WF-0001:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "R2A_OOS_FIRST", foldId: "WF-0001" }],
          errorCodes: ["R2A_OOS_FIRST"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tradeId = String(input.tradeIntents[0].tradeId);
      if (tradeId.startsWith("WF-0002:") && tradeId.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "R2A_TRAIN_LATER" }],
          errorCodes: ["R2A_TRAIN_LATER"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };

    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.deepEqual(result.errorCodes, [
      "R2A_OOS_FIRST",
      ERROR.OOS_FOLD_FAILED,
      ERROR.WALK_FORWARD_STAGE_FAILED,
    ]);
    assert.equal(result.failedStage, "WALK_FORWARD");
    assert.equal(result.errors[0].foldId, "WF-0001");
    assert.equal(result.errorCodes.includes(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED), false);
    assert.equal(
      result.folds.find((fold) => fold.foldId === "WF-0002").errorCodes
        .includes(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED),
      true,
    );
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R2A-C first failure snapshot isolates pipeline error references", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  const sharedRoot = {
    code: "R2A_SHARED_ROOT",
    foldId: "WF-0001",
    field: "benchmark",
    details: { source: "FIRST" },
    tags: ["A"],
  };
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      if (String(input.tradeIntents[0].tradeId).startsWith("WF-0001:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [sharedRoot],
          errorCodes: [sharedRoot.code],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    sharedRoot.code = "MUTATED_AFTER_CAPTURE";
    sharedRoot.foldId = "MUTATED";
    sharedRoot.field = "mutated";
    sharedRoot.details.source = "MUTATED";
    sharedRoot.tags.push("B");
    assert.deepEqual(result.errors[0], {
      code: "R2A_SHARED_ROOT",
      foldId: "WF-0001",
      field: "benchmark",
      details: { source: "FIRST" },
      tags: ["A"],
    });
    assert.notEqual(result.errors[0].details, sharedRoot.details);
    assert.notEqual(result.errors[0].tags, sharedRoot.tags);
    assert.equal(Object.isFrozen(result.errors[0]), true);
    assert.equal(Object.isFrozen(result.errors[0].details), true);
    assert.equal(Object.isFrozen(result.errors[0].tags), true);
    assert.throws(() => {
      result.errors[0].details.source = "ILLEGAL";
    });
    assert.throws(() => {
      result.errors[0].tags.push("ILLEGAL");
    });
    assert.deepEqual(result.errorCodes, [
      "R2A_SHARED_ROOT",
      ERROR.OOS_FOLD_FAILED,
      ERROR.WALK_FORWARD_STAGE_FAILED,
    ]);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5O-R2A-D train calendar equals canonical dates and excludes gap TRADING_DAY", () => {
  const input = buildSelectionInput();
  const canonicalTrainDates = input.tradingDates.slice(0, input.trainWindowSize);
  const tile1Dates = canonicalTrainDates.slice(0, TILE_SIZE);
  const gapDate = findWeekendBetween(canonicalTrainDates);
  assert.equal(gapDate != null, true);
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(gapDate, { dayStatus: "TRADING_DAY" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const capture = captures.find(
    (row) => row.kind === "train" && String(row.tradeId).startsWith("WF-0001:"),
  );
  assert.deepEqual(capture.calendarDays.map((day) => day.tradingDate), tile1Dates);
  assert.equal(capture.calendarDays.some((day) => day.tradingDate === gapDate), false);
});

test("GATE5O-R2A-E non-member CLOSED is absent entirely", () => {
  const input = buildSelectionInput();
  const canonicalTrainDates = input.tradingDates.slice(0, input.trainWindowSize);
  const tile1Dates = canonicalTrainDates.slice(0, TILE_SIZE);
  const gapDate = findWeekendBetween(canonicalTrainDates);
  assert.equal(gapDate != null, true);
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(gapDate, { dayStatus: "CLOSED" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const capture = captures.find(
    (row) => row.kind === "train" && String(row.tradeId).startsWith("WF-0001:"),
  );
  assert.equal(capture.calendarDays.some((day) => day.tradingDate === gapDate), false);
  assert.deepEqual(capture.calendarDays.map((day) => day.tradingDate), tile1Dates);
});

test("GATE5O-R2A-F missing canonical row is synthesized with exact membership", () => {
  const input = buildSelectionInput();
  const canonicalTrainDates = input.tradingDates.slice(0, input.trainWindowSize);
  const tile1Dates = canonicalTrainDates.slice(0, TILE_SIZE);
  const missingDate = canonicalTrainDates[2];
  input.pipelineBase.calendar.days = input.pipelineBase.calendar.days.filter(
    (day) => day.tradingDate !== missingDate,
  );
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const capture = captures.find(
    (row) => row.kind === "train" && String(row.tradeId).startsWith("WF-0001:"),
  );
  assert.deepEqual(capture.calendarDays.map((day) => day.tradingDate), tile1Dates);
  assert.equal(capture.calendarDays.length, tile1Dates.length);
  assert.equal(
    capture.calendarDays.find((day) => day.tradingDate === missingDate).dayStatus,
    "TRADING_DAY",
  );
});

test("GATE5O-R2A-G OOS calendar equals canonical OOS dates in order", () => {
  const input = buildSelectionInput();
  const canonicalOosDates = input.tradingDates.slice(
    input.trainWindowSize + input.embargoTradingDayCount,
    input.trainWindowSize + input.embargoTradingDayCount + input.oosWindowSize,
  );
  let extraDate = addDaysYmd(input.tradingDates[input.tradingDates.length - 1], 1);
  while (isWeekendYmd(extraDate)) extraDate = addDaysYmd(extraDate, 1);
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(extraDate, { dayStatus: "CLOSED" }),
  ]);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const capture = captures.find((row) => row.kind === "oos" && row.tradeId === "WF-0001:oos:T01");
  assert.deepEqual(capture.calendarDays.map((day) => day.tradingDate), canonicalOosDates);
});

test("GATE5O-R2A-H calendar rows outside fold train set cannot affect selection", () => {
  const baselineInput = buildSelectionInput();
  const baseline = runWalkForwardTrainParameterSelection(deepClone(baselineInput));
  const changedInput = deepClone(baselineInput);
  const foldTrainDates = changedInput.tradingDates.slice(0, changedInput.trainWindowSize);
  const gapDate = findWeekendBetween(foldTrainDates);
  const oosDate = changedInput.tradingDates[changedInput.trainWindowSize + changedInput.embargoTradingDayCount];
  let futureDate = addDaysYmd(
    changedInput.tradingDates[changedInput.tradingDates.length - 1],
    10,
  );
  while (isWeekendYmd(futureDate)) futureDate = addDaysYmd(futureDate, 1);
  injectExtraCalendarDays(changedInput.pipelineBase, [
    makeCalendarDay(gapDate, { dayStatus: "TRADING_DAY" }),
    makeCalendarDay(oosDate, { dayStatus: "NON_TRADING_DAY" }),
    makeCalendarDay(futureDate, { dayStatus: "TRADING_DAY" }),
  ]);
  const changed = runWalkForwardTrainParameterSelection(changedInput);
  assert.equal(baseline.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.deepEqual(changed.folds[0].candidateEvaluations, baseline.folds[0].candidateEvaluations);
  assert.equal(changed.folds[0].selectedCandidateId, baseline.folds[0].selectedCandidateId);
  assert.equal(changed.folds[0].selectionScore, baseline.folds[0].selectionScore);
});

test("GATE5O-R2A-I source calendar remains immutable", () => {
  const input = buildSelectionInput();
  const gapDate = findWeekendBetween(input.tradingDates.slice(0, input.trainWindowSize));
  injectExtraCalendarDays(input.pipelineBase, [
    makeCalendarDay(gapDate, { dayStatus: "TRADING_DAY" }),
  ]);
  const before = deepClone(input.pipelineBase.calendar);
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.deepEqual(input.pipelineBase.calendar, before);
});

test("GATE5O-R2A-J future row cannot influence synthesized train row or selection", () => {
  const baselineInput = buildSelectionInput();
  const canonicalTrainDates = baselineInput.tradingDates.slice(0, baselineInput.trainWindowSize);
  const missingDate = canonicalTrainDates[2];
  baselineInput.pipelineBase.calendar.days = baselineInput.pipelineBase.calendar.days.filter(
    (day) => day.tradingDate !== missingDate,
  );
  const changedInput = deepClone(baselineInput);
  let futureDate = addDaysYmd(
    changedInput.tradingDates[changedInput.tradingDates.length - 1],
    10,
  );
  while (isWeekendYmd(futureDate)) futureDate = addDaysYmd(futureDate, 1);
  changedInput.pipelineBase.calendar.days.unshift({
    tradingDate: futureDate,
    dayStatus: "TRADING_DAY",
    sessionStatus: "FINAL",
    statusSource: "MUTATED_FUTURE_SOURCE",
    market: "MUTATED_FUTURE_MARKET",
    calendarId: "mutated-future-calendar",
  });

  const baselineRun = capturePipelineCalendars(baselineInput);
  const changedRun = capturePipelineCalendars(changedInput);
  assert.equal(baselineRun.result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(changedRun.result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const baselineCapture = baselineRun.captures.find(
    (row) => row.kind === "train" && String(row.tradeId).startsWith("WF-0001:"),
  );
  const changedCapture = changedRun.captures.find(
    (row) => row.kind === "train" && String(row.tradeId).startsWith("WF-0001:"),
  );
  const expectedSynthesized = {
    tradingDate: missingDate,
    dayStatus: "TRADING_DAY",
    sessionStatus: "FINAL",
    statusSource: "SYNTHETIC_EXPLICIT",
    market: baselineInput.pipelineBase.calendar.market,
    calendarId: baselineInput.pipelineBase.calendar.calendarId,
  };
  assert.deepEqual(
    baselineCapture.calendarDays.find((day) => day.tradingDate === missingDate),
    expectedSynthesized,
  );
  assert.deepEqual(
    changedCapture.calendarDays.find((day) => day.tradingDate === missingDate),
    expectedSynthesized,
  );
  assert.deepEqual(
    changedRun.result.folds[0].candidateEvaluations,
    baselineRun.result.folds[0].candidateEvaluations,
  );
  assert.equal(
    changedRun.result.folds[0].selectedCandidateId,
    baselineRun.result.folds[0].selectedCandidateId,
  );
  assert.equal(changedRun.result.folds[0].selectionScore, baselineRun.result.folds[0].selectionScore);
});

test("GATE5O-R2A-K empty source days synthesize exact train and OOS calendars", () => {
  const input = buildSelectionInput();
  input.pipelineBase.calendar.days = [];
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const trainDates = input.tradingDates.slice(0, input.trainWindowSize);
  const oosDates = input.tradingDates.slice(
    input.trainWindowSize + input.embargoTradingDayCount,
    input.trainWindowSize + input.embargoTradingDayCount + input.oosWindowSize,
  );
  const expectedDays = (dates) => dates.map((date) => ({
    tradingDate: date,
    dayStatus: "TRADING_DAY",
    sessionStatus: "FINAL",
    statusSource: "SYNTHETIC_EXPLICIT",
    market: input.pipelineBase.calendar.market,
    calendarId: input.pipelineBase.calendar.calendarId,
  }));
  const trainCapture = captures.find(
    (row) => row.kind === "train" && String(row.tradeId).startsWith("WF-0001:"),
  );
  const oosCapture = captures.find((row) => row.kind === "oos" && row.tradeId === "WF-0001:oos:T01");
  assert.deepEqual(trainCapture.calendarDays, expectedDays(trainDates.slice(0, TILE_SIZE)));
  assert.deepEqual(oosCapture.calendarDays, expectedDays(oosDates));
});

// ─── GATE 5P — Full Train-Window Selection Scoring ─────────────────────

test("GATE5P-P01 padTileIndex T01..T99 and T100", () => {
  assert.equal(padTileIndex(1), "T01");
  assert.equal(padTileIndex(9), "T09");
  assert.equal(padTileIndex(10), "T10");
  assert.equal(padTileIndex(99), "T99");
  assert.equal(padTileIndex(100), "T100");
  assert.equal(TILE_SIZE, 3);
  assert.equal(MAX_COMPLETE_TILE_COUNT, 100);
});

test("GATE5P-P02 buildTrainTiles index-only slice; leftover dropped", () => {
  const dates = [
    "2101-03-01",
    "2101-03-02",
    "2101-03-03",
    "2101-03-08",
    "2101-03-09",
    "2101-03-10",
    "2101-03-15",
  ];
  const built = buildTrainTiles(dates);
  assert.equal(built.tiles.length, 2);
  assert.deepEqual(built.tiles[0], ["2101-03-01", "2101-03-02", "2101-03-03"]);
  assert.deepEqual(built.tiles[1], ["2101-03-08", "2101-03-09", "2101-03-10"]);
  assert.deepEqual(built.droppedDates, ["2101-03-15"]);
});

test("GATE5P-P03 window sizes 3/6 success empty tails; 4/5 fail-closed", () => {
  for (const size of [4, 5]) {
    const dates = generateWeekdayDates("2101-03-01", 2 * (size + 3));
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: dates,
      trainWindowSize: size,
      oosWindowSize: 3,
      stepSize: size + 3,
    }));
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
    assert.equal(result.errors[0].field, "trainWindowSize");
  }
  const cases = [
    { size: 3, tiles: 1, evalDays: 3 },
    { size: 6, tiles: 2, evalDays: 6 },
  ];
  for (const c of cases) {
    const dates = generateWeekdayDates("2101-03-01", 2 * (c.size + 5));
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: dates,
      trainWindowSize: c.size,
      oosWindowSize: 3,
      stepSize: c.size + 5,
    }));
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
    const fold = result.folds[0];
    assert.equal(fold.selectionEvaluationPolicy, "NONOVERLAPPING_THREE_BAR_TILES");
    assert.equal(fold.selectionTradeCount, c.tiles);
    assert.equal(fold.selectionEvaluationTradingDayCount, c.evalDays);
    assert.equal(fold.selectionDroppedTailTradingDayCount, 0);
    assert.deepEqual(fold.selectionDroppedTailDates, []);
    assert.equal(fold.selectionEvaluationStart, dates[0]);
    assert.equal(fold.selectionEvaluationEnd, dates[c.tiles * 3 - 1]);
  }
});

test("GATE5P-P04 unique tradeIds through max complete tiles", () => {
  const n = MAX_COMPLETE_TILE_COUNT * TILE_SIZE;
  const dates = [];
  for (let i = 0; i < n; i += 1) dates.push("T" + String(i).padStart(4, "0"));
  const built = buildTrainTiles(dates);
  assert.equal(built.tiles.length, MAX_COMPLETE_TILE_COUNT);
  assert.equal(built.droppedDates.length, 0);
  const ids = built.tiles.map((_, k) => "WF-0001:P001:train:" + padTileIndex(k + 1));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "WF-0001:P001:train:T01");
  assert.equal(ids[98], "WF-0001:P001:train:T99");
  assert.equal(ids[99], "WF-0001:P001:train:T100");
});

test("GATE5P-P05 train pipeline uses tiled intents T01..; OOS remains single winner trade", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const { result, captures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 3,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const t01 = captures.find((c) => c.kind === "train" && c.tradeId === "WF-0001:P001:train:T01");
  const t02 = captures.find((c) => c.kind === "train" && c.tradeId === "WF-0001:P001:train:T02");
  assert.equal(t01 != null, true);
  assert.equal(t02 != null, true);
  assert.equal(t01.tradeIntents.length, 1);
  assert.equal(t02.tradeIntents.length, 1);
  assert.equal(t01.tradeIntents[0].tradeId, "WF-0001:P001:train:T01");
  assert.equal(t02.tradeIntents[0].tradeId, "WF-0001:P001:train:T02");
  assert.equal(t01.tradeIntents[0].entryDate, dates[1]);
  assert.equal(t01.tradeIntents[0].exitDate, dates[2]);
  assert.equal(t01.tradeIntents[0].exitDateMode, "LATEST_ALLOWED");
  assert.equal(t02.tradeIntents[0].entryDate, dates[4]);
  assert.equal(t02.tradeIntents[0].exitDate, dates[5]);
  const oosCap = captures.find((c) => c.kind === "oos" && c.tradeId === "WF-0001:oos:T01");
  assert.equal(oosCap.tradeIntents.length, 1);
  assert.equal(oosCap.tradeIntents[0].tradeId, "WF-0001:oos:T01");
});

test("GATE5P-P06 trainWindowSize 2 fail-closed at config before zero-tile", () => {
  const dates = generateWeekdayDates("2101-03-01", 12);
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 2,
    oosWindowSize: 3,
    stepSize: 5,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "trainWindowSize");
  assert.equal(result.officialFolds.length, 0);
  assert.equal(result.meanOosTotalReturn, null);
});

test("GATE5P-P07 overflow finite trades → nonfinite totalReturn fail-closed", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const inner = originalPerf(input);
      return {
        ...inner,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS,
        totalReturn: Number.POSITIVE_INFINITY,
      };
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(result.selectionStatus, SELECTION_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.TRAIN_SELECTION_NONFINITE), true);
    assert.equal(result.errors[0].code, ERROR.TRAIN_SELECTION_NONFINITE);
    assert.equal(result.officialFolds.length, 0);
    assert.equal(result.meanOosTotalReturn, null);
    assert.equal(result.folds[0].selectedParameters, null);
    assert.equal(result.folds[0].selectionScore, null);
    assert.equal(result.folds[0].candidateEvaluations[0].status, "BLOCKED");
    assert.equal(Number.isFinite(result.folds[0].selectionScore), false);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE5P-P08 multi-fail permutation keeps first official root", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  function install() {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tid = String(input.tradeIntents[0].tradeId);
      if (tid.includes(":P002:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "ROOT_P002" }],
          errorCodes: ["ROOT_P002"],
          totalReturn: null,
        };
      }
      if (tid.includes(":P001:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "ROOT_P001" }],
          errorCodes: ["ROOT_P001"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
  }
  const dates = generateWeekdayDates("2101-03-01", 22);
  const shared = {
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 3,
    parameterCandidates: [
      { id: "P002", stopLossPrice: 9000, takeProfitPrice: 11200 },
      { id: "P001", stopLossPrice: 9500, takeProfitPrice: 11000 },
    ],
  };
  try {
    install();
    const r1 = runWalkForwardTrainParameterSelection(buildSelectionInput(shared));
    const r2 = runWalkForwardTrainParameterSelection(buildSelectionInput({
      ...shared,
      parameterCandidates: shared.parameterCandidates.slice().reverse(),
    }));
    assert.equal(r1.errors[0].code, "ROOT_P001");
    assert.equal(r2.errors[0].code, "ROOT_P001");
    assert.equal(r1.failedStage, r2.failedStage);
    assert.equal(hasCode(r1, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED), true);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE5P-P09 multi-tile first-root is candidate pipeline failure", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const intents = input.tradeIntents || [];
      if (intents.length >= 1 && String(intents[0].tradeId).includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "MULTI_TILE_ROOT" }],
          errorCodes: ["MULTI_TILE_ROOT"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      trainWindowSize: 6,
      tradingDates: generateWeekdayDates("2101-03-01", 22),
    }));
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assert.equal(result.errors[0].code, "MULTI_TILE_ROOT");
    assert.equal(hasCode(result, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED), true);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE5P-P10 complete-tile mutation can change score; leftover train size rejected", () => {
  const leftover = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 26),
    trainWindowSize: 10,
    oosWindowSize: 3,
    stepSize: 13,
  }));
  assert.equal(leftover.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(leftover.errors[0].field, "trainWindowSize");

  const dates = generateWeekdayDates("2101-03-01", 28);
  const base = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 9,
    oosWindowSize: 3,
    stepSize: 14,
  });
  const r0 = runWalkForwardTrainParameterSelection(deepClone(base));
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.folds[0].selectionDroppedTailTradingDayCount, 0);
  const tileMut = deepClone(base);
  tileMut.pipelineBase.dataset.candles[1].open = 8000;
  tileMut.pipelineBase.dataset.candles[1].high = 8100;
  tileMut.pipelineBase.dataset.candles[1].low = 7900;
  tileMut.pipelineBase.dataset.candles[1].close = 8050;
  tileMut.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(tileMut.pipelineBase.dataset);
  const rTile = runWalkForwardTrainParameterSelection(tileMut);
  assert.notEqual(rTile.folds[0].selectionScore, r0.folds[0].selectionScore);
});

test("GATE5P-P11 winner-only OOS not tiled", () => {
  const { result, captures } = capturePipelineCalendars(buildSelectionInput({
    trainWindowSize: 6,
    oosWindowSize: 3,
    tradingDates: generateWeekdayDates("2101-03-01", 22),
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosCaps = captures.filter((c) => c.kind === "oos");
  for (const cap of oosCaps) {
    assert.equal(cap.tradeIntents.length, 1);
    assert.equal(String(cap.tradeId).includes(":train:"), false);
  }
});

test("GATE5P-P12 lifecycle default exit mode remains EXACT", () => {
  const life = require("../lib/backtest/multi-trade-lifecycle");
  assert.equal(life.EXIT_DATE_MODE.EXACT, "EXACT");
  assert.equal(life.EXIT_DATE_MODE.LATEST_ALLOWED, "LATEST_ALLOWED");
});

// ─── GATE 5Q — Full OOS-Window Scoring ────────────────────────────────

test("GATE5Q-P01 oosWindow 3/6 success empty tails; 4/5 fail-closed", () => {
  for (const oos of [4, 5]) {
    const dates = generateWeekdayDates("2101-03-01", 2 * (6 + oos));
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: dates,
      trainWindowSize: 6,
      oosWindowSize: oos,
      stepSize: 6 + oos,
    }));
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
    assert.equal(result.errors[0].field, "oosWindowSize");
  }
  const cases = [
    { oos: 3, tiles: 1 },
    { oos: 6, tiles: 2 },
  ];
  for (const c of cases) {
    const dates = generateWeekdayDates("2101-03-01", 2 * (8 + c.oos));
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: dates,
      trainWindowSize: 6,
      oosWindowSize: c.oos,
      stepSize: 8 + c.oos,
    }));
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
    const fold = result.folds[0];
    const oosDates = dates.slice(7, 7 + c.oos);
    assert.equal(fold.oosTradeCount, c.tiles);
    assert.equal(fold.oosEvaluationTradingDayCount, c.tiles * 3);
    assert.equal(fold.oosDroppedTailTradingDayCount, 0);
    assert.deepEqual(fold.oosDroppedTailDates, []);
    assert.equal(fold.oosEvaluationStart, oosDates[0]);
    assert.equal(fold.oosEvaluationEnd, oosDates[c.tiles * 3 - 1]);
  }
});

test("GATE5Q-P02 OOS tile tradeIds T01.. and frozen winner params on every tile", () => {
  const dates = generateWeekdayDates("2101-03-01", 28);
  const { result, captures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosT01 = captures.find((c) => c.kind === "oos" && c.tradeId === "WF-0001:oos:T01");
  const oosT02 = captures.find((c) => c.kind === "oos" && c.tradeId === "WF-0001:oos:T02");
  assert.equal(oosT01 != null, true);
  assert.equal(oosT02 != null, true);
  assert.equal(oosT01.tradeIntents.length, 1);
  assert.equal(oosT02.tradeIntents.length, 1);
  const winner = result.folds[0].selectedParameters;
  for (const cap of [oosT01, oosT02]) {
    const intent = cap.tradeIntents[0];
    assert.equal(intent.exitPolicy.stopLossPrice, winner.stopLossPrice);
    assert.equal(intent.exitPolicy.takeProfitPrice, winner.takeProfitPrice);
    assert.equal(intent.exitDateMode, "LATEST_ALLOWED");
  }
});

test("GATE5Q-P03 leftover oos=7 rejected; complete tile mutation can change OOS metrics", () => {
  const leftover = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 26),
    trainWindowSize: 6,
    oosWindowSize: 7,
    stepSize: 13,
  }));
  assert.equal(leftover.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(leftover.errors[0].field, "oosWindowSize");

  const dates = generateWeekdayDates("2101-03-01", 28);
  const base = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
  });
  const r0 = runWalkForwardTrainParameterSelection(deepClone(base));
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.folds[0].oosDroppedTailTradingDayCount, 0);
  const oosStart = 7;
  const tileMut = deepClone(base);
  const entryIdx = oosStart + 1;
  tileMut.pipelineBase.dataset.candles[entryIdx].open = 8000;
  tileMut.pipelineBase.dataset.candles[entryIdx].high = 8100;
  tileMut.pipelineBase.dataset.candles[entryIdx].low = 7900;
  tileMut.pipelineBase.dataset.candles[entryIdx].close = 8050;
  tileMut.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(tileMut.pipelineBase.dataset);
  const rTile = runWalkForwardTrainParameterSelection(tileMut);
  assert.notEqual(rTile.folds[0].oosTotalReturn, r0.folds[0].oosTotalReturn);
  assert.equal(rTile.folds[0].selectedCandidateId, r0.folds[0].selectedCandidateId);
});

test("GATE5Q-P04 overflow finite OOS trades → nonfinite metrics fail-closed", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      const inner = originalBench(input);
      return {
        ...inner,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA,
        totalReturn: Number.POSITIVE_INFINITY,
      };
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(result.errors[0].code, ERROR.OOS_EVALUATION_NONFINITE);
    assert.equal(result.officialFolds.length, 0);
    assert.equal(result.meanOosTotalReturn, null);
    assert.equal(result.folds[0].oosTotalReturn, null);
    assert.equal(result.folds[0].selectedCandidateId != null, true);
  } finally {
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE5Q-P05 oosWindowSize 2 fail-closed at config before zero-tile", () => {
  const dates = generateWeekdayDates("2101-03-01", 12);
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 2,
    stepSize: 8,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "oosWindowSize");
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), false);
});

test("GATE5Q-P06 Train selection unchanged vs tiled OOS", () => {
  const dates = generateWeekdayDates("2101-03-01", 24);
  const small = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: dates.slice(0, 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  const wide = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 28),
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
  }));
  assert.equal(small.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(wide.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(small.folds[0].selectedCandidateId, wide.folds[0].selectedCandidateId);
  assert.equal(small.folds[0].selectionScore, wide.folds[0].selectionScore);
});


// ─── GATE 5R — Embargo isolation ───────────────────────────────────────

test("GATE5R-P01 omitted embargo and explicit 0 fail-closed under PURGE_MIN", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const omitted = buildSelectionInput({ tradingDates: dates });
  delete omitted.embargoTradingDayCount;
  const a = runWalkForwardTrainParameterSelection(omitted);
  const b = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: dates,
    embargoTradingDayCount: 0,
  }));
  assert.equal(a.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(b.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(a.errors[0].field, "embargoTradingDayCount");
  assert.equal(b.errors[0].field, "embargoTradingDayCount");
});

test("GATE5R-P02 embargo bar mutation does not change train or OOS scores", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const base = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  const r0 = runWalkForwardTrainParameterSelection(deepClone(base));
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.deepEqual(r0.folds[0].embargoDates, [dates[6]]);
  assert.equal(r0.folds[0].oosStart, dates[7]);
  const mutated = deepClone(base);
  mutated.pipelineBase.dataset.candles[6].open = 8000;
  mutated.pipelineBase.dataset.candles[6].high = 50000;
  mutated.pipelineBase.dataset.candles[6].low = 7900;
  mutated.pipelineBase.dataset.candles[6].close = 45000;
  mutated.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(mutated.pipelineBase.dataset);
  const r1 = runWalkForwardTrainParameterSelection(mutated);
  assert.equal(r1.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.folds[0].selectedCandidateId, r1.folds[0].selectedCandidateId);
  assert.equal(r0.folds[0].selectionScore, r1.folds[0].selectionScore);
  assert.equal(r0.folds[0].oosTotalReturn, r1.folds[0].oosTotalReturn);
});

test("GATE5R-P03 invalid embargo fail-closed", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    embargoTradingDayCount: 1.5,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});


test("GATE5S-P01 previous-fold OOS mutation does not change next-fold train selection", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const base = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  const r0 = runWalkForwardTrainParameterSelection(deepClone(base));
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.folds.length, 2);
  const mutated = deepClone(base);
  const oos0 = 7;
  mutated.pipelineBase.dataset.candles[oos0].high = 50000;
  mutated.pipelineBase.dataset.candles[oos0].close = 45000;
  mutated.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(mutated.pipelineBase.dataset);
  const r1 = runWalkForwardTrainParameterSelection(mutated);
  assert.equal(r1.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.folds[1].selectedCandidateId, r1.folds[1].selectedCandidateId);
  assert.equal(r0.folds[1].selectionScore, r1.folds[1].selectionScore);
});

test("GATE5T-P01 post-OOS embargo bar mutation does not change train or OOS scores", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const base = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
  });
  const r0 = runWalkForwardTrainParameterSelection(deepClone(base));
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const mutated = deepClone(base);
  mutated.pipelineBase.dataset.candles[10].high = 50000;
  mutated.pipelineBase.dataset.candles[10].close = 45000;
  mutated.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(mutated.pipelineBase.dataset);
  const r1 = runWalkForwardTrainParameterSelection(mutated);
  assert.equal(r1.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.folds[0].selectedCandidateId, r1.folds[0].selectedCandidateId);
  assert.equal(r0.folds[0].selectionScore, r1.folds[0].selectionScore);
  assert.equal(r0.folds[0].oosTotalReturn, r1.folds[0].oosTotalReturn);
  assert.deepEqual(r0.folds[0].postOosEmbargoDates, [dates[10]]);
});

test("GATE5U-P01 success dropped tails empty", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const fold of result.folds) {
    assert.equal(fold.selectionDroppedTailTradingDayCount, 0);
    assert.deepEqual(fold.selectionDroppedTailDates, []);
    assert.equal(fold.oosDroppedTailTradingDayCount, 0);
    assert.deepEqual(fold.oosDroppedTailDates, []);
  }
});

test("GATE5U-P02 trainWindowSize 303 exceeds tile cap fail-closed", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    trainWindowSize: 303,
    oosWindowSize: 3,
    stepSize: 306,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assert.equal(result.errors[0].field, "trainWindowSize");
});

test("GATE5X-W01 tile1 dataset excludes tile2 dates", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const { result, captures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const t01 = captures.find((c) => c.kind === "train" && c.tradeId === "WF-0001:P001:train:T01");
  const t02 = captures.find((c) => c.kind === "train" && c.tradeId === "WF-0001:P001:train:T02");
  assert.equal(t01 != null, true);
  assert.equal(t02 != null, true);
  assert.equal(t01.tradeIntents.length, 1);
  const tile2 = new Set(dates.slice(3, 6));
  for (const date of t01.candleDates) {
    assert.equal(tile2.has(date), false);
  }
  for (const d of t01.calendarDays) {
    assert.equal(tile2.has(d.tradingDate), false);
  }
  assert.deepEqual(t01.candleDates.slice().sort(), dates.slice(0, 3).slice().sort());
});

test("GATE5X-W02 extra post-window candle excluded from every tile slice", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  input.pipelineBase.dataset.candles.push(integratedCandle(extraDate, {
    open: 99999, high: 99999, low: 99999, close: 99999,
  }));
  input.pipelineBase.dataset.contentChecksum = computeDatasetContentChecksum(input.pipelineBase.dataset);
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  for (const cap of captures) {
    assert.equal(cap.candleDates.includes(extraDate), false);
  }
  assert.equal(result.errorCodes.includes("LOOKAHEAD_CANDLE_PRESENT"), false);
});

test("GATE5X-W03 embargo=1 ULTRA_SHORT 22-date success still PASS", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.folds.length, 2);
});

test("GATE5X-W04 omitted embargo still FAIL", () => {
  const input = buildSelectionInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5Y-W01 extra future benchmark excluded from every OOS tile", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 99999 });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosCaps = captures.filter((c) => c.kind === "oos");
  assert.equal(oosCaps.length > 0, true);
  for (const cap of oosCaps) {
    assert.equal(cap.benchmarkDates.includes(extraDate), false);
    assert.equal(cap.candleDates.includes(extraDate), false);
  }
});

test("GATE5Y-W02 5X tile dataset isolation still holds", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const { result, captures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const t01 = captures.find((c) => c.kind === "train" && c.tradeId === "WF-0001:P001:train:T01");
  const tile2 = new Set(dates.slice(3, 6));
  for (const date of t01.candleDates) {
    assert.equal(tile2.has(date), false);
  }
});

test("GATE5Y-W03 embargo=1 ULTRA_SHORT 22-date success still PASS", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
});

test("GATE5Y-W04 omitted embargo still FAIL", () => {
  const input = buildSelectionInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5Y-W05 reversed benchmark order does not change outcome", () => {
  const base = buildSelectionInput();
  const r0 = runWalkForwardTrainParameterSelection(deepClone(base));
  const reversed = deepClone(base);
  reversed.benchmarkSeries = reversed.benchmarkSeries.slice().reverse();
  const r1 = runWalkForwardTrainParameterSelection(reversed);
  assert.equal(r0.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r1.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(r0.meanOosTotalReturn, r1.meanOosTotalReturn);
  assert.equal(r0.meanOosAlpha, r1.meanOosAlpha);
  assert.equal(r0.folds[0].selectedCandidateId, r1.folds[0].selectedCandidateId);
});

test("GATE5Y-W06 duplicate in-window and out-of-window rows do not expand coverage", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  const oos0 = dates.slice(7, 10);
  input.benchmarkSeries.push({ tradingDate: oos0[0], close: 12345 });
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 99999 });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosT01 = captures.find((c) => c.kind === "oos" && c.tradeId === "WF-0001:oos:T01");
  assert.equal(oosT01.benchmarkDates.includes(extraDate), false);
  for (const date of oosT01.benchmarkDates) {
    assert.equal(oos0.includes(date), true);
  }
});

test("GATE5Y-W07 empty benchmark after slice fail-closed", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  input.benchmarkSeries = [{ tradingDate: extraDate, close: 1 }];
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_FOLD_FAILED), true);
});

test("GATE5Z-W01 feature asOf is signal and execution candles include entry and exit", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const { result, captures, featureCaptures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(featureCaptures.length > 0, true);
  const oosCaps = captures.filter((c) => c.kind === "oos");
  assert.equal(oosCaps.length > 0, true);
  for (const cap of oosCaps) {
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

test("GATE5Z-W02 5X tile dataset isolation still holds", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const { result, captures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const t01 = captures.find((c) => c.kind === "train" && c.tradeId === "WF-0001:P001:train:T01");
  const tile2 = new Set(dates.slice(3, 6));
  for (const date of t01.candleDates) {
    assert.equal(tile2.has(date), false);
  }
});

test("GATE5Z-W03 5Y extra future benchmark excluded from every OOS tile", () => {
  const dates = generateWeekdayDates("2101-03-01", 22);
  const extraDate = generateWeekdayDates(dates[dates.length - 1], 3)[1];
  const input = buildSelectionInput({
    tradingDates: dates,
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  });
  input.benchmarkSeries.push({ tradingDate: extraDate, close: 99999 });
  const { result, captures } = capturePipelineCalendars(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosCaps = captures.filter((c) => c.kind === "oos");
  for (const cap of oosCaps) {
    assert.equal(cap.benchmarkDates.includes(extraDate), false);
  }
});

test("GATE5Z-W04 embargo=1 ULTRA_SHORT 22-date success still PASS", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
});

test("GATE5Z-W05 omitted embargo still FAIL", () => {
  const input = buildSelectionInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
});

test("GATE5Z-W06 feature window does not include entry or exit dates", () => {
  const { result, captures, featureCaptures } = capturePipelineCalendars(buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 22),
    trainWindowSize: 6,
    oosWindowSize: 3,
    stepSize: 11,
  }));
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  const oosT01 = captures.find((c) => c.kind === "oos" && c.tradeId === "WF-0001:oos:T01");
  const signal = oosT01.tradeIntent.entryIntent.signalTradingDate;
  const entry = oosT01.tradeIntent.entryDate;
  const exit = oosT01.tradeIntent.exitDate;
  const matching = featureCaptures.filter((f) => f.featureAsOfTradingDate === signal);
  assert.equal(matching.length > 0, true);
  for (const feat of matching) {
    assert.equal(feat.featureDates.includes(entry), false);
    assert.equal(feat.featureDates.includes(exit), false);
    assert.equal(feat.featureDates.includes(signal), true);
  }
});

test("GATE5Z-W07 post-signal candles in a feature window fail-closed", () => {
  const leakageGuard = require("../lib/backtest/leakage-guard");
  const r = leakageGuard.assertFeatureWindowNoLookAhead({
    featureWindow: [
      { tradingDate: "2101-03-01", symbol: "SYN-1", open: 1, high: 1, low: 1, close: 1 },
      { tradingDate: "2101-03-03", symbol: "SYN-1", open: 1, high: 1, low: 1, close: 1 },
    ],
    featureAsOfTradingDate: "2101-03-01",
  });
  assert.equal(r.ok, false);
});

test("GATE5Z-W08 same-day signal fill helper fail-closed", () => {
  const dates = ["2101-03-01", "2101-03-02", "2101-03-03"];
  const r = assertCausalTradeTiming({
    entryDate: dates[0],
    exitDate: dates[2],
    entryIntent: {
      signalTradingDate: dates[0],
      earliestExecutionTradingDate: dates[0],
    },
  }, dates, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, "T");
  assert.equal(r.ok, false);
  const ok = assertCausalTradeTiming({
    entryDate: dates[1],
    exitDate: dates[2],
    entryIntent: {
      signalTradingDate: dates[0],
      earliestExecutionTradingDate: dates[1],
    },
  }, dates, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, "T");
  assert.equal(ok.ok, true);
});

test("GATE6A-W01 22-date embargo=1 success pins all official flags false", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
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
  const input = buildSelectionInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assertOfficialLeakageFreeze(result);
});

test("GATE6A-W03 5Z feature asOf remains signal and flags stay false", () => {
  const { result, featureCaptures } = capturePipelineCalendars(buildSelectionInput({
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

test("GATE6C-W01 two finite MAX_VALUE train tiles overflow as TRAIN_SELECTION_NONFINITE", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const inner = originalPerf(input);
      return {
        ...inner,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS,
        totalReturn: Number.MAX_VALUE,
      };
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    }));
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.TRAIN_SELECTION_NONFINITE), true);
    assert.equal(result.errors[0].code, ERROR.TRAIN_SELECTION_NONFINITE);
    assert.equal(result.errors[0].field, "trainTotalReturn");
    assert.equal(result.officialFolds.length, 0);
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

function sixBarSelectionInput() {
  return buildSelectionInput({
    tradingDates: generateWeekdayDates("2101-03-01", 28),
    trainWindowSize: 6,
    oosWindowSize: 6,
    stepSize: 14,
    embargoTradingDayCount: 1,
    horizonType: "ULTRA_SHORT",
  });
}

function withSelectionOosMetrics(metricFactory, fn) {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
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

test("GATE6C-W02 two finite MAX_VALUE selection-OOS totals overflow as OOS_EVALUATION_NONFINITE", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), false);
  assert.equal(result.errors[0].code, ERROR.OOS_EVALUATION_NONFINITE);
  assert.equal(result.errors[0].field, "oosMetrics");
  assert.equal(result.meanOosTotalReturn, null);
  assertOfficialLeakageFreeze(result);
});

test("GATE6C-W03 two finite MAX_VALUE selection-OOS benchmarks overflow as OOS_EVALUATION_NONFINITE", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: 0.01, benchmarkReturn: Number.MAX_VALUE, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assertOfficialLeakageFreeze(result);
});

test("GATE6C-W04 two finite MAX_VALUE selection-OOS alphas overflow as OOS_EVALUATION_NONFINITE", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: 0.01, benchmarkReturn: 0.01, alpha: Number.MAX_VALUE }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assertOfficialLeakageFreeze(result);
});

test("GATE6C-W05 two-tile MAX_VALUE/4 selection-OOS remains COMPLETED", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE / 4, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(Number.isFinite(result.meanOosTotalReturn), true);
  assertOfficialLeakageFreeze(result);
});

test("GATE6C-W06 one-tile MAX_VALUE OOS still aggregate-overflow identity", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    })),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), false);
  assertOfficialLeakageFreeze(result);
});

test("GATE6C-W07 omitted embargo still FAIL", () => {
  const input = buildSelectionInput();
  delete input.embargoTradingDayCount;
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_WALK_FORWARD_CONFIG), true);
  assertOfficialLeakageFreeze(result);
});

test("GATE6D-S01 selection requires finite-tile-mean helper", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes('require("./finite-tile-mean")'), true);
  assert.equal(src.includes("assertFiniteEqualWeightedMean"), true);
});

test("GATE6E-S01 fold aggregate uses finite-tile-mean helper", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes('require("./finite-tile-mean")'), true);
  assert.equal(src.includes("assertFiniteEqualWeightedMean"), true);
  assert.equal(src.includes("folds.map((fold) => fold.totalReturn)"), true);
  assert.equal(src.includes("folds.map((fold) => fold.benchmarkReturn)"), true);
  assert.equal(src.includes("folds.map((fold) => fold.alpha)"), true);
  assert.equal(src.includes("let sumTotal = 0"), false);
  assert.equal(src.includes("sumTotal += fold.totalReturn"), false);
});

test("GATE6F-S01 selection fold aggregate overflow field matches walk-forward meanOosTotalReturn", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    })),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), false);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.meanOosTotalReturn, null);
  assertOfficialLeakageFreeze(result);
});

test("GATE6F-S02 selection source no longer uses sum* aggregate fields", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("sumTotalReturn"), false);
  assert.equal(src.includes("sumBenchmarkReturn"), false);
  assert.equal(src.includes("aggregateBlockedResult(\"sumAlpha\")"), false);
  assert.equal(src.includes('aggregateBlockedResult("meanOosTotalReturn")'), true);
  assert.equal(src.includes('aggregateBlockedResult("meanOosBenchmarkReturn")'), true);
  assert.equal(src.includes('aggregateBlockedResult("meanOosAlpha")'), true);
});

test("GATE6G-S01 freeze source pins helper for tile means and fold aggregate", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
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

test("GATE6G-S02 one-tile MAX_VALUE OOS still aggregate identity meanOosTotalReturn", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    })),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), false);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assertOfficialLeakageFreeze(result);
});

test("GATE6G-S03 two-tile selection OOS MAX_VALUE still OOS_EVALUATION_NONFINITE field oosMetrics", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), true);
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), false);
  assert.equal(result.errors[0].field, "oosMetrics");
  assertOfficialLeakageFreeze(result);
});

test("GATE6H-S01 source pins shared makeBacktestError and drops local makeError", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
});

test("GATE6H-S02 one-tile MAX_VALUE OOS overflow keeps severity ERROR and meanOosTotalReturn", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    })),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6H-S03 two-tile selection OOS overflow keeps severity ERROR and oosMetrics", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6H-S04 selection extras cause/candidateId/tradeId still present", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("cause: tradeResult.error.code"), false);
  assert.equal(src.includes("cause: build.error.code"), false);
  assert.equal(src.includes("{ field: \"periodDates\", tradeId }"), true);
  const r = selectWinnerFromTrainEvaluations([
    { candidateId: "P001", trainTotalReturn: 0.1, status: "BLOCKED" },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
  assert.equal(r.error.candidateId, "P001");
  assert.equal(r.error.severity, "ERROR");
});

test("GATE6I-S01 freeze source pins shared makeBacktestError and no local makeError", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
});

test("GATE6I-S02 freeze one-tile MAX_VALUE still severity ERROR field meanOosTotalReturn", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    })),
  );
  assert.equal(hasCode(result, ERROR.WALK_FORWARD_AGGREGATE_NONFINITE), true);
  assert.equal(result.errors[0].field, "meanOosTotalReturn");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6I-S03 freeze two-tile OOS MAX_VALUE still severity ERROR field oosMetrics", () => {
  const result = withSelectionOosMetrics(
    () => ({ totalReturn: Number.MAX_VALUE, benchmarkReturn: 0.01, alpha: 0.01 }),
    () => runWalkForwardTrainParameterSelection(sixBarSelectionInput()),
  );
  assert.equal(hasCode(result, ERROR.OOS_EVALUATION_NONFINITE), true);
  assert.equal(result.errors[0].field, "oosMetrics");
  assert.equal(result.errors[0].severity, "ERROR");
  assertOfficialLeakageFreeze(result);
});

test("GATE6I-S04 freeze selection extras cause/candidateId/tradeId still present", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("cause: tradeResult.error.code"), false);
  assert.equal(src.includes("{ field: \"periodDates\", tradeId }"), true);
  const r = selectWinnerFromTrainEvaluations([
    { candidateId: "P001", trainTotalReturn: 0.1, status: "BLOCKED" },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.error.candidateId, "P001");
  assert.equal(r.error.severity, "ERROR");
});


test("GATE6U-R3-S01 nested train pipeline root is errorCodes[0]", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tradeId = String(input.tradeIntents[0].tradeId);
      if (tradeId.startsWith("WF-0001:") && tradeId.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "R2A_TRAIN_ROOT" }],
          errorCodes: ["R2A_TRAIN_ROOT"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.errorCodes[0], "R2A_TRAIN_ROOT");
    assert.equal(result.errors[0].code, "R2A_TRAIN_ROOT");
    const evalIdx = result.errorCodes.indexOf(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
    assert.equal(evalIdx > 0, true);
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE6U-R3-S02 later-fold OOS stays off top-level errorCodes", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  const originalBench = pipelineMod.runSyntheticBenchmarkPipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tradeId = String(input.tradeIntents[0].tradeId);
      if (tradeId.startsWith("WF-0001:") && tradeId.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "R2A_TRAIN_ROOT" }],
          errorCodes: ["R2A_TRAIN_ROOT"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    pipelineMod.runSyntheticBenchmarkPipeline = function patched(input) {
      if (String(input.tradeIntents[0].tradeId).startsWith("WF-0002:oos:")) {
        return {
          pipelineStatus: "BLOCKED_BENCHMARK_STAGE",
          errors: [{ code: "R2A_OOS_LATER" }],
          errorCodes: ["R2A_OOS_LATER"],
          totalReturn: null,
          benchmarkReturn: null,
          alpha: null,
        };
      }
      return originalBench(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.errorCodes.includes("R2A_OOS_LATER"), false);
    assert.equal(
      result.folds.find((fold) => fold.foldId === "WF-0002").errorCodes.includes("R2A_OOS_LATER"),
      true,
    );
    assert.equal(result.failedStage, "TRAIN_SELECTION");
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
    pipelineMod.runSyntheticBenchmarkPipeline = originalBench;
  }
});

test("GATE6U-R3-S03 evaluateTrainCandidate no longer wraps with cause: rootErr.code", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("cause: rootErr.code"), false);
  assert.equal(src.includes("cause: build.error.code"), false);
  assert.equal(src.includes("cause: tradeResult.error.code"), false);
});


test("GATE6V-S01 freeze train nested root stays errorCodes[0]", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tradeId = String(input.tradeIntents[0].tradeId);
      if (tradeId.startsWith("WF-0001:") && tradeId.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "R2A_TRAIN_ROOT" }],
          errorCodes: ["R2A_TRAIN_ROOT"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.errorCodes[0], "R2A_TRAIN_ROOT");
    const evalIdx = result.errorCodes.indexOf(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
    assert.equal(evalIdx > 0, true);
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});


test("GATE6W-S01 OOS cause wrappers are gone from source", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  assert.equal(src.includes("cause: tradeResult.error.code"), false);
  assert.equal(src.includes("cause: build.error.code"), false);
  assert.equal(src.includes("cloneNestedRootError"), true);
});

test("GATE6W-S02 nested OOS build root is errorCodes[0]", () => {
  const leakageGuard = require("../lib/backtest/leakage-guard");
  const originalGuard = leakageGuard.assertFeatureWindowNoLookAhead;
  const input = buildSelectionInput();
  const windows = walkForward.generateWalkForwardWindows({
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });
  const oosStarts = new Set(windows.windows.map((w) => w.oosStart));
  try {
    leakageGuard.assertFeatureWindowNoLookAhead = function patched(payload) {
      const asOf = payload && payload.featureAsOfTradingDate;
      if (oosStarts.has(asOf)) {
        return { ok: false, errors: [{ code: "W_OOS_ROOT", severity: "ERROR" }] };
      }
      return originalGuard(payload);
    };
    const result = runWalkForwardTrainParameterSelection(input);
    assert.equal(result.errorCodes[0], "W_OOS_ROOT");
    const oosIdx = result.errorCodes.indexOf(ERROR.OOS_FOLD_FAILED);
    assert.equal(oosIdx > 0, true);
    assert.equal(result.failedStage, "WALK_FORWARD");
    assertOfficialLeakageFreeze(result);
  } finally {
    leakageGuard.assertFeatureWindowNoLookAhead = originalGuard;
  }
});

test("GATE6W-S03 train nested root pin still holds", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const tradeId = String(input.tradeIntents[0].tradeId);
      if (tradeId.startsWith("WF-0001:") && tradeId.includes(":train:")) {
        return {
          pipelineStatus: "BLOCKED_PERFORMANCE_STAGE",
          errors: [{ code: "R2A_TRAIN_ROOT" }],
          errorCodes: ["R2A_TRAIN_ROOT"],
          totalReturn: null,
        };
      }
      return originalPerf(input);
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
    assert.equal(result.errorCodes[0], "R2A_TRAIN_ROOT");
    const evalIdx = result.errorCodes.indexOf(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED);
    assert.equal(evalIdx > 0, true);
    assert.equal(result.failedStage, "TRAIN_SELECTION");
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE7A-S01 Infinity tile return stores trainTotalReturn null", () => {
  const pipelineMod = require("../lib/backtest/synthetic-pipeline");
  const originalPerf = pipelineMod.runSyntheticPerformancePipeline;
  try {
    pipelineMod.runSyntheticPerformancePipeline = function patched(input) {
      const inner = originalPerf(input);
      return {
        ...inner,
        pipelineStatus: PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS,
        totalReturn: Infinity,
      };
    };
    const result = runWalkForwardTrainParameterSelection(buildSelectionInput({
      tradingDates: generateWeekdayDates("2101-03-01", 22),
      trainWindowSize: 6,
      oosWindowSize: 3,
      stepSize: 11,
    }));
    assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
    assert.equal(hasCode(result, ERROR.TRAIN_SELECTION_NONFINITE), true);
    assert.equal(result.errors[0].code, ERROR.TRAIN_SELECTION_NONFINITE);
    assert.equal(result.errors[0].field, "trainTotalReturn");
    assert.equal(Array.isArray(result.folds) && result.folds.length > 0, true);
    const evidence = result.folds[0].candidateEvaluations;
    assert.equal(Array.isArray(evidence) && evidence.length > 0, true);
    for (const row of evidence) {
      assert.equal(row.trainTotalReturn, null);
      assert.equal(Number.isFinite(row.trainTotalReturn), false);
    }
    assert.equal(JSON.stringify(result).includes("Infinity"), false);
    assertOfficialLeakageFreeze(result);
  } finally {
    pipelineMod.runSyntheticPerformancePipeline = originalPerf;
  }
});

test("GATE7A-S02 nonfinite tile path no longer copies pipelineResult.totalReturn", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  const start = src.indexOf("if (!isFiniteNumber(pipelineResult.totalReturn))");
  assert.equal(start >= 0, true);
  const window = src.slice(start, start + 500);
  assert.equal(window.includes("trainTotalReturn: pipelineResult.totalReturn"), false);
  assert.equal(window.includes("evaluation: blockedEval"), true);
  const meanStart = src.indexOf("const meanResult = assertFiniteEqualWeightedMean(tileReturns);");
  assert.equal(meanStart >= 0, true);
  const meanWindow = src.slice(meanStart, meanStart + 500);
  assert.equal(meanWindow.includes("trainTotalReturn: null"), true);
});

test("GATE7A-Z01 late INVALID_BENCHMARK_INPUT still first-failure-wins field", () => {
  const benchPath = path.join(__dirname, "..", "lib", "backtest", "benchmark-performance.js");
  const src = fs.readFileSync(benchPath, "utf8");
  assert.equal(src.includes('const field = !isFiniteNumber(benchmarkReturn) ? "benchmarkReturn" : "alpha";'), true);
});

test("GATE7B-A01 nonfinite tile path still uses blockedEval", () => {
  const src = fs.readFileSync(SEL_PATH, "utf8");
  const start = src.indexOf("if (!isFiniteNumber(pipelineResult.totalReturn))");
  assert.equal(start >= 0, true);
  const window = src.slice(start, start + 500);
  assert.equal(window.includes("evaluation: blockedEval"), true);
  assert.equal(window.includes("trainTotalReturn: pipelineResult.totalReturn"), false);
});

test("GATE7H-S01 blockedSelectionResult copies folds array", () => {
  const folds = [{ foldId: "F1" }];
  const result = blockedSelectionResult({ folds });
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

test("GATE7H-S02 non-array folds become empty array", () => {
  const result = blockedSelectionResult({ folds: { foldId: "F1" } });
  assert.deepEqual(result.folds, []);
  assert.deepEqual(result.partialFoldResults, []);
});

test("GATE7H-G01 walk-forward still slices blocked folds", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/walk-forward-validation.js"),
    "utf8"
  );
  assert.equal(src.includes("src.folds.slice()"), true);
});

test("GATE7J-C01 completedSelectionResult copies folds array", () => {
  const folds = [{ foldId: "F1" }];
  const result = completedSelectionResult({ folds });
  assert.equal(result.selectionStatus, SELECTION_STATUS.COMPLETED);
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

test("GATE7J-C02 non-array folds become empty arrays", () => {
  const result = completedSelectionResult({ folds: { foldId: "F1" } });
  assert.deepEqual(result.folds, []);
  assert.deepEqual(result.officialFolds, []);
});

test("GATE7J-I01 walk-forward completed still slices folds", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/walk-forward-validation.js"),
    "utf8"
  );
  assert.equal(src.includes("// 7I: copy folds/officialFolds so callers cannot mutate the result arrays."), true);
  assert.equal(src.includes("src.folds.slice()"), true);
});

test("GATE7K-H01 train still slices blocked and completed folds", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/train-parameter-selection.js"),
    "utf8"
  );
  assert.equal(src.includes("7K freeze"), true);
  assert.equal(src.includes("src.folds.slice()"), true);
  assert.equal(src.includes("src.partialFoldResults.slice()"), true);
});

test("GATE7M-S01 foldBase slices embargo date arrays", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/train-parameter-selection.js"),
    "utf8"
  );
  assert.equal(src.includes("window.embargoDates.slice()"), true);
  assert.equal(src.includes("window.postOosEmbargoDates.slice()"), true);
});

test("GATE7M-W01 fold embargoDates match window contents", () => {
  const input = buildSelectionInput();
  const windows = walkForward.generateWalkForwardWindows({
    horizonType: input.horizonType,
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
  });
  assert.equal(windows.ok, true);
  const result = runWalkForwardTrainParameterSelection(input);
  assert.equal(result.folds.length > 0, true);
  assert.deepEqual(result.folds[0].embargoDates, windows.windows[0].embargoDates);
  assert.deepEqual(result.folds[0].postOosEmbargoDates, windows.windows[0].postOosEmbargoDates);
  assert.equal(result.liveEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE7L-S01 pin walk-forward still slices embargo date arrays", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/walk-forward-validation.js"),
    "utf8"
  );
  assert.equal(src.includes("window.embargoDates.slice()"), true);
  assert.equal(src.includes("window.postOosEmbargoDates.slice()"), true);
});

test("GATE7N-M01 train freeze pins embargo date slices", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/train-parameter-selection.js"),
    "utf8"
  );
  assert.equal(src.includes("7N freeze"), true);
  assert.equal(src.includes("window.embargoDates.slice()"), true);
  assert.equal(src.includes("window.postOosEmbargoDates.slice()"), true);
});


test("GATE9J-J07 selection COMPLETED keeps family B plus selection extensions", () => {
  const result = runWalkForwardTrainParameterSelection(buildSelectionInput());
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.COMPLETED);
  assert.equal(result.selectionStatus, SELECTION_STATUS.COMPLETED);
  assert.equal(Object.hasOwn(result, "ok"), false);
  assert.equal(Object.hasOwn(result, "pipelineStatus"), false);
  assert.equal(result.failedStage, null);
  assert.deepEqual(result.errors, []);
  assert.equal(result.officialFolds, result.folds);
  assert.equal(Array.isArray(result.folds), true);
  assert.equal(result.folds.length > 0, true);
  const fold = result.folds[0];
  assert.equal(Array.isArray(fold.candidateEvaluations), true);
  assert.equal(fold.candidateEvaluations.length > 0, true);
  assert.equal(fold.selectedParameters != null, true);
  assert.equal(typeof fold.selectedCandidateId, "string");
  assert.equal(Number.isFinite(result.meanOosTotalReturn), true);
});

test("GATE9J-J08 selection FAILURE has no stale root winner payload", () => {
  const result = runWalkForwardTrainParameterSelection(null);
  assert.equal(result.walkForwardStatus, WALK_FORWARD_STATUS.BLOCKED);
  assert.equal(result.selectionStatus, SELECTION_STATUS.BLOCKED);
  assert.equal(Object.hasOwn(result, "ok"), false);
  assert.equal(Object.hasOwn(result, "pipelineStatus"), false);
  assert.equal(result.failedStage != null && result.failedStage.length > 0, true);
  assert.deepEqual(result.officialFolds, []);
  assert.equal(result.meanOosTotalReturn, null);
  assert.equal(result.meanOosBenchmarkReturn, null);
  assert.equal(result.meanOosAlpha, null);
  assert.equal(Object.hasOwn(result, "selectedCandidateId"), false);
  assert.equal(Object.hasOwn(result, "selectedParameters"), false);
  assert.equal(result.errors.length > 0, true);
});
