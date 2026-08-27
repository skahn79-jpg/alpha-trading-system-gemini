"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const lifecycle = require("../lib/backtest/multi-trade-lifecycle");
const {
  LIFECYCLE_VERSION,
  LIFECYCLE_STATUS,
  POSITION_STATE,
  ERROR_CODE,
  EXIT_DATE_MODE,
  runSyntheticMultiTradeLifecycle,
} = lifecycle;

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
  POLICY_ENGINE_VERSION,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
  ROUNDING_MODE,
} = require("../lib/backtest/cost-policy");

const { MODEL_VERSION } = require("../lib/backtest/execution-model");

// ─── 공통 헬퍼 ───────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, "0"); }

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
  for (let i = 0; i < dayCount; i++) {
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
  const mkt = extras.markets ? extras.markets[0] : SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const candles = candleRows.map((row) => integratedCandle(row.tradingDate, { market: mkt, ...row }));
  const dates = candles.map((c) => c.tradingDate).sort();
  const envelope = {
    datasetId: "synthetic-dataset-v1",
    datasetVersion: "1.0.0",
    datasetType: DATASET_TYPE.HISTORICAL_DAILY_OHLCV,
    sourceType: SOURCE_TYPE.SYNTHETIC_FIXTURE,
    symbols: ["SYNTH001"],
    markets: [mkt],
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

// ─── 2-trade 픽스처 (KOSPI) ──────────────────────────────────────────────────

function build2TradeKospiFixture() {
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
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const exitPolicy = {
    stopLossPrice: 9500,
    takeProfitPrice: 11000,
    intrabarConflictPolicy: "STOP_FIRST",
  };
  const tradeIntents = [
    {
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[2],
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy,
    },
    {
      tradeId: "T2",
      quantity: 10,
      entryDate: t[4],
      exitDate: t[5],
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[3],
        earliestExecutionTradingDate: t[4],
        limitPrice: null,
      },
      exitPolicy,
    },
  ];
  return {
    dataset,
    calendar,
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: calendar.coverage.to,
    },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
    t,
  };
}

// ─── 2-trade 픽스처 (KOSDAQ) ─────────────────────────────────────────────────

function build2TradeKosdaqFixture() {
  const calendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(calendar);
  const kosdaqRow = (row) => ({ ...row, market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ });
  const candleRows = [
    kosdaqRow({ tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 }),
    kosdaqRow({ tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 }),
    kosdaqRow({ tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 }),
    kosdaqRow({ tradingDate: t[3], open: 9800, high: 9900, low: 9700, close: 9850 }),
    kosdaqRow({ tradingDate: t[4], open: 10000, high: 10500, low: 9800, close: 10200 }),
    kosdaqRow({ tradingDate: t[5], open: 10800, high: 11200, low: 10700, close: 11100 }),
  ];
  const dataset = buildDataset(calendar, candleRows, { markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ] });
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
  };
  const exitPolicy = { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" };
  const tradeIntents = [
    {
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy,
    },
    {
      tradeId: "T2",
      quantity: 10,
      entryDate: t[4],
      exitDate: t[5],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[3], earliestExecutionTradingDate: t[4], limitPrice: null },
      exitPolicy,
    },
  ];
  return {
    dataset, calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost, tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
    t,
  };
}

// ─── 3-trade 픽스처 ───────────────────────────────────────────────────────────

function build3TradeKospiFixture() {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 24 });
  const t = tradingDatesOf(calendar);
  const candleRows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
    { tradingDate: t[3], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[4], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[5], open: 10800, high: 11200, low: 10700, close: 11100 },
    { tradingDate: t[6], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[7], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[8], open: 10800, high: 11200, low: 10700, close: 11100 },
  ];
  const dataset = buildDataset(calendar, candleRows);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const exitPolicy = { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy,
    },
    {
      tradeId: "T2", quantity: 10, entryDate: t[4], exitDate: t[5],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[3], earliestExecutionTradingDate: t[4], limitPrice: null },
      exitPolicy,
    },
    {
      tradeId: "T3", quantity: 10, entryDate: t[7], exitDate: t[8],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[6], earliestExecutionTradingDate: t[7], limitPrice: null },
      exitPolicy,
    },
  ];
  return {
    dataset, calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost, tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
    t,
  };
}

function hasCode(result, code) {
  return (Array.isArray(result.errorCodes) && result.errorCodes.includes(code))
    || (Array.isArray(result.errors) && result.errors.some((e) => e.code === code));
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

test("GATE5J-M01 KOSPI 2-trade 성공", () => {
  const { dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode } = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({ dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.errors.length, 0);
});

test("GATE5J-M02 KOSPI 2-trade closedTrade 필드 검증", () => {
  const { dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode } = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({ dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode });
  const t1 = result.closedTrades[0];
  assert.equal(t1.tradeId, "T1");
  assert.equal(t1.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  assert.equal(t1.direction, "LONG");
  assert.equal(t1.quantity, 10);
  assert.ok(t1.entryPrice > 0);
  assert.ok(t1.exitPrice > 0);
  assert.ok(t1.totalCost > 0);
  assert.ok(t1.grossPnl != null);
  assert.ok(t1.netPnl != null);
});

test("GATE5J-M03 KOSDAQ 2-trade 성공", () => {
  const { dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode } = build2TradeKosdaqFixture();
  const result = runSyntheticMultiTradeLifecycle({ dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades.length, 2);
  assert.equal(result.closedTrades[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
});

test("GATE5J-M04 3-trade 성공", () => {
  const { dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode } = build3TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({ dataset, calendar, calendarValidation, cost, tradeIntents, calculationMode });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades.length, 3);
});

test("GATE5J-M05 입력 순서 뒤섞여도 동일 결과", () => {
  const fx = build2TradeKospiFixture();
  const { dataset, calendar, calendarValidation, cost, calculationMode } = fx;
  const reversed = [...fx.tradeIntents].reverse();
  const r1 = runSyntheticMultiTradeLifecycle({ dataset, calendar, calendarValidation, cost, tradeIntents: fx.tradeIntents, calculationMode });
  const r2 = runSyntheticMultiTradeLifecycle({ dataset, calendar, calendarValidation, cost, tradeIntents: reversed, calculationMode });
  assert.equal(r1.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.deepEqual(r1.closedTrades, r2.closedTrades);
});

test("GATE5J-M06 동일 입력 반복 deepEqual", () => {
  const fx = build2TradeKospiFixture();
  const input = {
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  };
  const r1 = runSyntheticMultiTradeLifecycle(input);
  const r2 = runSyntheticMultiTradeLifecycle(input);
  assert.deepEqual(r1, r2);
});

test("GATE5J-M07 duplicate tradeId 차단", () => {
  const fx = build2TradeKospiFixture();
  const intents = [
    { ...fx.tradeIntents[0] },
    { ...fx.tradeIntents[1], tradeId: "T1" },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: intents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.DUPLICATE_TRADE_ID), true);
});

test("GATE5J-M08 empty tradeIntents 차단", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.EMPTY_TRADE_INTENTS), true);
});

test("GATE5J-M09 null tradeIntents 차단", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: null, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_INPUT), true);
});

test("GATE5J-M10 undefined tradeIntents 차단", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: undefined, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
});

test("GATE5J-M11 invalid trade object (string) 차단", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: ["invalid"], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_INPUT), true);
});

test("GATE5J-M12 missing tradeId 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0] };
  delete intent.tradeId;
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.MISSING_REQUIRED_FIELD), true);
});

test("GATE5J-M13 missing entryDate 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0] };
  delete intent.entryDate;
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.MISSING_REQUIRED_FIELD), true);
});

test("GATE5J-M14 missing exitDate 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0] };
  delete intent.exitDate;
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.MISSING_REQUIRED_FIELD), true);
});

test("GATE5J-M15 exit < entry 차단", () => {
  const fx = build2TradeKospiFixture();
  const t = fx.t;
  const intent = { ...fx.tradeIntents[0], entryDate: t[2], exitDate: t[1] };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.EXIT_BEFORE_ENTRY), true);
});

test("GATE5J-M16 zero quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: 0 };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M17 negative quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: -5 };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M18 NaN quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: NaN };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M19 Infinity quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: Infinity };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M20 string quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: "10" };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M21 fractional quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: 1.5 };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M22 SHORT 방향 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], direction: "SHORT" };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.SHORT_POSITION_NOT_SUPPORTED), true);
});

test("GATE5J-M23 알 수 없는 direction 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], direction: "UNKNOWN_DIR" };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.SHORT_POSITION_NOT_SUPPORTED), true);
});

test("GATE5J-M24 overlapping trades 차단", () => {
  const fx = build2TradeKospiFixture();
  const t = fx.t;
  const intents = [
    { ...fx.tradeIntents[0], exitDate: t[4] },
    { ...fx.tradeIntents[1], tradeId: "T2", entryDate: t[2], exitDate: t[3] },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: intents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.OVERLAPPING_TRADE_NOT_ALLOWED), true);
});

test("GATE5J-M25 entry candle 없으면 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], entryDate: "2101-01-01", exitDate: fx.t[2] };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.ENTRY_CANDLE_NOT_FOUND), true);
});

test("GATE5J-M26 exit candle 없으면 차단", () => {
  const fx = build2TradeKospiFixture();
  // entryDate(t[1]) 이후이지만 dataset에 캔들이 없는 날짜
  const intent = { ...fx.tradeIntents[0], exitDate: "2101-04-01" };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.EXIT_CANDLE_NOT_FOUND), true);
});

test("GATE5J-M27 다른 시장 calendar 차단", () => {
  const fx = build2TradeKosdaqFixture();
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: kospiCalendar,
    calendarValidation: { requiredFrom: kospiCalendar.coverage.from, requiredTo: kospiCalendar.coverage.to },
    cost: fx.cost, tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
});

test("GATE5J-M28 legacy SYNTHETIC_MARKET 차단", () => {
  const fx = build2TradeKospiFixture();
  const dataset = {
    ...fx.dataset,
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_MARKET],
    candles: fx.dataset.candles.map((c) => ({ ...c, market: SYNTHETIC_MARKETS.SYNTHETIC_MARKET })),
  };
  dataset.contentChecksum = computeDatasetContentChecksum(dataset);
  dataset.metadataHash = computeDatasetMetadataHash(dataset);
  const result = runSyntheticMultiTradeLifecycle({
    dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5J-M29 production KOSPI 차단", () => {
  const fx = build2TradeKospiFixture();
  const dataset = { ...fx.dataset, markets: ["KOSPI"] };
  const result = runSyntheticMultiTradeLifecycle({
    dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5J-M30 production KOSDAQ 차단", () => {
  const fx = build2TradeKospiFixture();
  const dataset = { ...fx.dataset, markets: ["KOSDAQ"] };
  const result = runSyntheticMultiTradeLifecycle({
    dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5J-M31 calendar mismatch → data stage failed", () => {
  const fx = build2TradeKospiFixture();
  const kosdaqCal = buildCalendar({
    start: "2101-03-01", dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: kosdaqCal,
    calendarValidation: { requiredFrom: kosdaqCal.coverage.from, requiredTo: kosdaqCal.coverage.to },
    cost: fx.cost, tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
});

test("GATE5J-M32 cost policy market mismatch → COST_STAGE_FAILED", () => {
  const fx = build2TradeKospiFixture();
  const kosdaqCost = {
    ...fx.cost,
    policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: kosdaqCost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.COST_STAGE_FAILED), true);
});

test("GATE5J-M33 market identity invariant — closedTrade.market 일치", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  for (const ct of result.closedTrades) {
    assert.equal(ct.market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
  }
});

test("GATE5J-M34 원본 dataset 불변", () => {
  const fx = build2TradeKospiFixture();
  const snap = JSON.stringify(fx.dataset);
  runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(JSON.stringify(fx.dataset), snap);
});

test("GATE5J-M35 원본 tradeIntents 불변", () => {
  const fx = build2TradeKospiFixture();
  const snap = JSON.stringify(fx.tradeIntents);
  runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(JSON.stringify(fx.tradeIntents), snap);
});

test("GATE5J-M36 totalCost > 0", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  for (const ct of result.closedTrades) {
    assert.ok(ct.totalCost > 0, `totalCost should be > 0, got ${ct.totalCost}`);
  }
});

test("GATE5J-M37 grossPnl = (exitPrice - entryPrice) * quantity", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  for (const ct of result.closedTrades) {
    const expected = (ct.exitPrice - ct.entryPrice) * ct.quantity;
    assert.equal(ct.grossPnl, expected);
  }
});

test("GATE5J-M38 netPnl = grossPnl - totalCost", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  for (const ct of result.closedTrades) {
    assert.equal(ct.netPnl, ct.grossPnl - ct.totalCost);
  }
});

test("GATE5J-M39 safety boundary — operationalFlags false", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.calendarVerified, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5J-M40 safety boundary — performance null", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.totalReturn, null);
  assert.equal(result.cagr, null);
  assert.equal(result.mdd, null);
  assert.equal(result.winRate, null);
  assert.equal(result.profitFactor, null);
  assert.equal(result.sharpeRatio, null);
  assert.equal(result.benchmarkReturn, null);
  assert.equal(result.alpha, null);
});

test("GATE5J-M41 null input 차단", () => {
  const result = runSyntheticMultiTradeLifecycle(null);
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_INPUT), true);
});

test("GATE5J-M42 unknown top key 차단", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
    unknownKey: "oops",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.UNKNOWN_FIELD), true);
});

test("GATE5J-M43 missing tradeIntents key 차단", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.MISSING_REQUIRED_FIELD), true);
});

test("GATE5J-M44 fail-closed: 하나 실패 시 closedTrades=[]", () => {
  const fx = build2TradeKospiFixture();
  const intents = [
    fx.tradeIntents[0],
    { ...fx.tradeIntents[1], entryDate: "2101-01-01" },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: intents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(result.closedTrades.length, 0);
});

test("GATE5J-M45 lifecycleVersion 확인", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleVersion, LIFECYCLE_VERSION);
  assert.equal(LIFECYCLE_VERSION, "synthetic-multi-trade-v0.1");
});

test("GATE5J-M46 failedTradeId/failedTradeIndex 반환 확인", () => {
  const fx = build2TradeKospiFixture();
  const intents = [
    { ...fx.tradeIntents[0] },
    { ...fx.tradeIntents[1], tradeId: "T1" },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: intents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(result.failedTradeId, "T1");
  assert.ok(result.failedTradeIndex != null);
});

test("GATE5J-M47 KOSPI 2-trade entryPrice/exitPrice 수치 확인", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  const ct = result.closedTrades[0];
  assert.equal(ct.entryPrice, 10000);
  assert.equal(ct.exitPrice, 11000);
  assert.equal(ct.grossPnl, (11000 - 10000) * 10);
});

test("GATE5J-M48 closedTrade lifecycleStatus = CLOSED", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  for (const ct of result.closedTrades) {
    assert.equal(ct.lifecycleStatus, POSITION_STATE.CLOSED);
  }
});

test("GATE5J-M49 null quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0], quantity: null };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

test("GATE5J-M50 undefined quantity 차단", () => {
  const fx = build2TradeKospiFixture();
  const intent = { ...fx.tradeIntents[0] };
  delete intent.quantity;
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [intent], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_QUANTITY), true);
});

// ─── GATE5J-R01~R08: 하위 계층 오류 코드 전파 회귀 테스트 ─────────────────────

test("GATE5J-R01 KOSPI dataset + KOSDAQ calendar → CALENDAR_MARKET_MISMATCH 포함", () => {
  // KOSPI 데이터셋에 KOSDAQ 캘린더를 붙여 calendar market mismatch 유발
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const kosdaqCalendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(kospiCalendar);
  const candleRows = [
    { tradingDate: t[0] }, { tradingDate: t[1] }, { tradingDate: t[2] },
    { tradingDate: t[3] }, { tradingDate: t[4] }, { tradingDate: t[5] },
  ];
  const dataset = buildDataset(kospiCalendar, candleRows);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const exitPolicy = { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy,
    },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar: kosdaqCalendar,
    calendarValidation: { requiredFrom: kosdaqCalendar.coverage.from, requiredTo: kosdaqCalendar.coverage.to },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, "CALENDAR_MARKET_MISMATCH"), true,
    `CALENDAR_MARKET_MISMATCH 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
});

test("GATE5J-R02 KOSDAQ dataset + KOSPI calendar → CALENDAR_MARKET_MISMATCH 포함", () => {
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const kosdaqCalendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(kosdaqCalendar);
  const candleRows = [
    { tradingDate: t[0] }, { tradingDate: t[1] }, { tradingDate: t[2] },
    { tradingDate: t[3] }, { tradingDate: t[4] }, { tradingDate: t[5] },
  ];
  const dataset = buildDataset(kosdaqCalendar, candleRows, { markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ] });
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
  };
  const exitPolicy = { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy,
    },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar: kospiCalendar,
    calendarValidation: { requiredFrom: kospiCalendar.coverage.from, requiredTo: kospiCalendar.coverage.to },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, "CALENDAR_MARKET_MISMATCH"), true,
    `CALENDAR_MARKET_MISMATCH 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
});

test("GATE5J-R03 KOSPI dataset + KOSDAQ cost policy → COST_POLICY_MARKET_MISMATCH 포함", () => {
  const fx = build2TradeKospiFixture();
  // KOSDAQ policy를 KOSPI lifecycle에 주입
  const mismatchedCost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset,
    calendar: fx.calendar,
    calendarValidation: fx.calendarValidation,
    cost: mismatchedCost,
    tradeIntents: fx.tradeIntents,
    calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, "COST_POLICY_MARKET_MISMATCH"), true,
    `COST_POLICY_MARKET_MISMATCH 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
});

test("GATE5J-R04 KOSDAQ dataset + KOSPI cost policy → COST_POLICY_MARKET_MISMATCH 포함", () => {
  const fx = build2TradeKosdaqFixture();
  // KOSPI policy를 KOSDAQ lifecycle에 주입
  const mismatchedCost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset,
    calendar: fx.calendar,
    calendarValidation: fx.calendarValidation,
    cost: mismatchedCost,
    tradeIntents: fx.tradeIntents,
    calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, "COST_POLICY_MARKET_MISMATCH"), true,
    `COST_POLICY_MARKET_MISMATCH 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
});

test("GATE5J-R05 calendar mismatch 시 closedTrades=[], executionStageStatus 미확인(DATA BLOCKED)", () => {
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const kosdaqCalendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(kospiCalendar);
  const candleRows = [
    { tradingDate: t[0] }, { tradingDate: t[1] }, { tradingDate: t[2] },
  ];
  const dataset = buildDataset(kospiCalendar, candleRows);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar: kosdaqCalendar,
    calendarValidation: { requiredFrom: kosdaqCalendar.coverage.from, requiredTo: kosdaqCalendar.coverage.to },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.deepEqual(result.closedTrades, []);
  assert.equal(result.failedStage, "DATA");
});

test("GATE5J-R06 calendar mismatch 시 DATA_STAGE_FAILED도 errorCodes에 포함(summary 유지)", () => {
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const kosdaqCalendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(kospiCalendar);
  const candleRows = [
    { tradingDate: t[0] }, { tradingDate: t[1] }, { tradingDate: t[2] },
  ];
  const dataset = buildDataset(kospiCalendar, candleRows);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar: kosdaqCalendar,
    calendarValidation: { requiredFrom: kosdaqCalendar.coverage.from, requiredTo: kosdaqCalendar.coverage.to },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.DATA_STAGE_FAILED), true,
    `DATA_STAGE_FAILED 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
  assert.equal(hasCode(result, "CALENDAR_MARKET_MISMATCH"), true,
    `CALENDAR_MARKET_MISMATCH 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
});

test("GATE5J-R07 cost mismatch 시 closedTrades=[] 확인", () => {
  const fx = build2TradeKospiFixture();
  const mismatchedCost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset,
    calendar: fx.calendar,
    calendarValidation: fx.calendarValidation,
    cost: mismatchedCost,
    tradeIntents: fx.tradeIntents,
    calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.deepEqual(result.closedTrades, []);
});

test("GATE5J-R08 market invariant는 data 검증에서 보호됨(collectMarketErrors)", () => {
  // dataset.markets가 PIPELINE_ALLOWED_MARKETS에 없는 값이면 PIPELINE_MARKET_INVARIANT_VIOLATION
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(kospiCalendar);
  const candleRows = [
    { tradingDate: t[0] }, { tradingDate: t[1] }, { tradingDate: t[2] },
  ];
  // 허용되지 않는 market 값으로 dataset 구성
  const dataset = buildDataset(kospiCalendar, candleRows, { markets: ["PRODUCTION_KOSPI"] });
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar: kospiCalendar,
    calendarValidation: { requiredFrom: kospiCalendar.coverage.from, requiredTo: kospiCalendar.coverage.to },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  // PRODUCTION_MARKET_NOT_ALLOWED 또는 PIPELINE_MARKET_INVARIANT_VIOLATION 중 하나 이상 포함
  const hasInvariantViolation = hasCode(result, ERROR_CODE.PIPELINE_MARKET_INVARIANT_VIOLATION)
    || hasCode(result, ERROR_CODE.PRODUCTION_MARKET_NOT_ALLOWED)
    || hasCode(result, ERROR_CODE.DATA_STAGE_FAILED);
  assert.equal(hasInvariantViolation, true,
    `market invariant 안전망 없음. errorCodes=${JSON.stringify(result.errorCodes)}`);
});

const LIFECYCLE_SRC_PATH = path.join(__dirname, "..", "lib", "backtest", "multi-trade-lifecycle.js");

test("GATE5K-R11 cost mismatch → failedStage=COST", () => {
  const fx = build2TradeKospiFixture();
  const mismatchedCost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ policyId: "synthetic-cost-kosdaq-v1", market: MARKET.SYNTHETIC_KOSDAQ })],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset,
    calendar: fx.calendar,
    calendarValidation: fx.calendarValidation,
    cost: mismatchedCost,
    tradeIntents: fx.tradeIntents,
    calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(result.failedStage, "COST");
  assert.equal(hasCode(result, "COST_POLICY_MARKET_MISMATCH"), true);
});

test("GATE5K-R13 evaluateDailyBarExecution call count === 1", () => {
  const src = fs.readFileSync(LIFECYCLE_SRC_PATH, "utf8");
  const matches = src.match(/executionModel\.evaluateDailyBarExecution/g) || [];
  assert.equal(matches.length, 1);
});

test("GATE5K-R14 SL on exitDate", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9800, close: 10000 },
    { tradingDate: t[2], open: 10000, high: 10100, low: 9400, close: 9600 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[2],
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 20000, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades[0].exitPrice, 9500);
  assert.equal(result.closedTrades[0].exitDate, t[2]);
});

test("GATE5K-R15 TP on exitDate", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[2],
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades[0].exitPrice, 11000);
  assert.equal(result.closedTrades[0].exitDate, t[2]);
});

test("GATE5K-R16 early SL before exitDate → EXIT_DATE_MISMATCH", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9800, close: 10000 },
    { tradingDate: t[2], open: 10000, high: 10100, low: 9000, close: 9600 },
    { tradingDate: t[3], open: 10800, high: 11200, low: 10700, close: 11100 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[3],
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.EXIT_DATE_MISMATCH), true);
  assert.deepEqual(result.closedTrades, []);
});

test("GATE5O-R1 LATEST_ALLOWED early SL before exitDate → COMPLETED", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9800, close: 10000 },
    { tradingDate: t[2], open: 10000, high: 10100, low: 9000, close: 9600 },
    { tradingDate: t[3], open: 10800, high: 11200, low: 10700, close: 11100 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[3],
      exitDateMode: EXIT_DATE_MODE.LATEST_ALLOWED,
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades[0].exitDate, t[2]);
  assert.equal(result.closedTrades[0].exitPrice, 9500);
});

test("GATE5O-R1 EXACT (default/missing) still EXIT_DATE_MISMATCH on early SL", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9800, close: 10000 },
    { tradingDate: t[2], open: 10000, high: 10100, low: 9000, close: 9600 },
    { tradingDate: t[3], open: 10800, high: 11200, low: 10700, close: 11100 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[3],
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.EXIT_DATE_MISMATCH), true);
});

test("GATE5O-R1 invalid exitDateMode → INVALID_INPUT", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[2],
      exitDateMode: "INVALID_MODE",
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_INPUT), true);
});

test("GATE5O-R1 LATEST_ALLOWED no SL/TP → market exit at exitDate close COMPLETED", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10100, low: 9900, close: 10050 },
    { tradingDate: t[2], open: 10000, high: 10100, low: 9900, close: 10080 },
    { tradingDate: t[3], open: 10100, high: 10200, low: 10000, close: 10150 },
  ]);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar,
    calendarValidation: { requiredFrom: calendar.coverage.from, requiredTo: calendar.coverage.to },
    cost,
    tradeIntents: [{
      tradeId: "T1",
      quantity: 10,
      entryDate: t[1],
      exitDate: t[3],
      exitDateMode: EXIT_DATE_MODE.LATEST_ALLOWED,
      entryIntent: {
        orderType: "MARKET_OPEN",
        signalTradingDate: t[0],
        earliestExecutionTradingDate: t[1],
        limitPrice: null,
      },
      exitPolicy: { stopLossPrice: 100, takeProfitPrice: 999999, intrabarConflictPolicy: "STOP_FIRST" },
    }],
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.COMPLETED);
  assert.equal(result.closedTrades[0].exitDate, t[3]);
  assert.equal(result.closedTrades[0].exitPrice, 10150);
});

test("GATE6M-G01 source pins shared makeBacktestError and no local makeError", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "backtest", "multi-trade-lifecycle.js"), "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
  assert.equal(src.includes("{ field: null }"), false);
});

test("GATE6M-G02 null input has no field key and severity ERROR", () => {
  const result = runSyntheticMultiTradeLifecycle(null);
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.INVALID_INPUT), true);
  const err = result.errors[0];
  assert.equal(err.code, ERROR_CODE.INVALID_INPUT);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "field"), false);
});

test("GATE6M-G03 duplicate tradeId keeps tradeIndex tradeId and severity ERROR", () => {
  const fx = build2TradeKospiFixture();
  const intents = [
    { ...fx.tradeIntents[0] },
    { ...fx.tradeIntents[1], tradeId: "T1" },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: intents, calculationMode: fx.calculationMode,
  });
  assert.equal(hasCode(result, ERROR_CODE.DUPLICATE_TRADE_ID), true);
  const err = result.errors.find((e) => e.code === ERROR_CODE.DUPLICATE_TRADE_ID);
  assert.equal(err.field, "tradeId");
  assert.equal(err.tradeId, "T1");
  assert.equal(err.tradeIndex, 1);
  assert.equal(err.severity, "ERROR");
});

test("GATE6M-G04 DATA_STAGE_FAILED keeps stage DATA and severity ERROR", () => {
  const kospiCalendar = buildCalendar({ start: "2101-03-01", dayCount: 14 });
  const kosdaqCalendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
    calendarId: "synthetic-calendar-kosdaq-v1",
  });
  const t = tradingDatesOf(kospiCalendar);
  const candleRows = [
    { tradingDate: t[0] }, { tradingDate: t[1] }, { tradingDate: t[2] },
  ];
  const dataset = buildDataset(kospiCalendar, candleRows);
  const cost = {
    policyEngineVersion: POLICY_ENGINE_VERSION,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  };
  const tradeIntents = [
    {
      tradeId: "T1", quantity: 10, entryDate: t[1], exitDate: t[2],
      entryIntent: { orderType: "MARKET_OPEN", signalTradingDate: t[0], earliestExecutionTradingDate: t[1], limitPrice: null },
      exitPolicy: { stopLossPrice: 9500, takeProfitPrice: 11000, intrabarConflictPolicy: "STOP_FIRST" },
    },
  ];
  const result = runSyntheticMultiTradeLifecycle({
    dataset,
    calendar: kosdaqCalendar,
    calendarValidation: { requiredFrom: kosdaqCalendar.coverage.from, requiredTo: kosdaqCalendar.coverage.to },
    cost,
    tradeIntents,
    calculationMode: "SYNTHETIC_UNIT_TEST_ONLY",
  });
  assert.equal(hasCode(result, ERROR_CODE.DATA_STAGE_FAILED), true);
  const err = result.errors.find((e) => e.code === ERROR_CODE.DATA_STAGE_FAILED);
  assert.equal(err.stage, "DATA");
  assert.equal(err.severity, "ERROR");
});

test("GATE6M-G05 production market extra stays present with severity ERROR", () => {
  const fx = build2TradeKospiFixture();
  const dataset = { ...fx.dataset, markets: ["KOSPI"] };
  const result = runSyntheticMultiTradeLifecycle({
    dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: fx.tradeIntents, calculationMode: fx.calculationMode,
  });
  assert.equal(hasCode(result, ERROR_CODE.PRODUCTION_MARKET_NOT_ALLOWED), true);
  const err = result.errors.find((e) => e.code === ERROR_CODE.PRODUCTION_MARKET_NOT_ALLOWED);
  assert.equal(err.market, "KOSPI");
  assert.equal(err.field, "dataset.markets");
  assert.equal(err.severity, "ERROR");
});

const PERF_KEYS = [
  "totalReturn", "cagr", "mdd", "winRate",
  "profitFactor", "sharpeRatio", "benchmarkReturn", "alpha",
];

function assertNullPerformanceKeys(result) {
  for (const key of PERF_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, key), true, key);
    assert.equal(result[key], null, key);
  }
  assert.notEqual(result.liveEligible, true);
}

test("GATE7B-L01 non-object BLOCKED has null performance keys", () => {
  const result = runSyntheticMultiTradeLifecycle(null);
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assertNullPerformanceKeys(result);
});

test("GATE7B-L02 empty tradeIntents BLOCKED has null performance keys", () => {
  const fx = build2TradeKospiFixture();
  const result = runSyntheticMultiTradeLifecycle({
    dataset: fx.dataset, calendar: fx.calendar,
    calendarValidation: fx.calendarValidation, cost: fx.cost,
    tradeIntents: [], calculationMode: fx.calculationMode,
  });
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR_CODE.EMPTY_TRADE_INTENTS), true);
  assertNullPerformanceKeys(result);
});
