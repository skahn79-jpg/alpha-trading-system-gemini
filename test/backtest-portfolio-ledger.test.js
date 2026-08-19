"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ledger = require("../lib/backtest/portfolio-ledger");
const {
  PORTFOLIO_LEDGER_VERSION,
  PORTFOLIO_STATUS,
  LEDGER_EVENT_TYPE,
  ERROR,
  runPortfolioLedger,
} = ledger;

const {
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
  STATUS: EXEC_STATUS,
  CALCULATION_STATUS,
} = require("../lib/backtest/execution-model");

const INITIAL_CAPITAL = 1000000;
const ENTRY_PRICE = 10000;
const EXIT_PRICE = 11000;
const QTY = 10;
const ENTRY_AMOUNT = 100000;
const EXIT_AMOUNT = 110000;
const ENTRY_COST = 10;
const EXIT_COMMISSION = 11;
const SELL_TAX_TOTAL = 110;
const EXIT_COST = 121;
const TOTAL_COST = 131;
const GROSS_PNL = 10000;
const NET_PNL = 9869;
const ENTRY_CASH_AFTER = INITIAL_CAPITAL - ENTRY_AMOUNT - ENTRY_COST; // 899990
const EXIT_CASH_AFTER = ENTRY_CASH_AFTER + EXIT_AMOUNT - EXIT_COST; // 1009869

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

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

function canonicalClosedTrade(t, overrides) {
  const extras = overrides || {};
  const quantity = extras.quantity != null ? extras.quantity : QTY;
  const entryPrice = extras.entryPrice != null ? extras.entryPrice : ENTRY_PRICE;
  const exitPrice = extras.exitPrice != null ? extras.exitPrice : EXIT_PRICE;
  const entryAmount = entryPrice * quantity;
  const exitAmount = exitPrice * quantity;
  const entryCommission = extras.entryCommission != null
    ? extras.entryCommission
    : Math.floor((entryAmount * 100) / 1000000);
  const exitCommission = extras.exitCommission != null
    ? extras.exitCommission
    : Math.floor((exitAmount * 100) / 1000000);
  const sellTaxTotal = extras.sellTaxTotal != null
    ? extras.sellTaxTotal
    : Math.floor((exitAmount * 1000) / 1000000);
  const entryCost = extras.entryCost != null ? extras.entryCost : entryCommission;
  const exitCost = extras.exitCost != null ? extras.exitCost : exitCommission + sellTaxTotal;
  const grossPnl = (exitPrice - entryPrice) * quantity;
  const netPnl = extras.netPnl != null ? extras.netPnl : grossPnl - entryCost - exitCost;
  return {
    tradeId: extras.tradeId || "T1",
    market: extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    direction: "LONG",
    quantity,
    entryDate: extras.entryDate || t[1],
    entryPrice,
    exitDate: extras.exitDate || t[2],
    exitPrice,
    entryCost,
    exitCost,
    totalCost: entryCost + exitCost,
    entryCommission,
    exitCommission,
    sellTaxTotal,
    grossPnl,
    netPnl,
  };
}

function standardCandleRows(t, market) {
  const mkt = market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const rows = [
    { tradingDate: t[0], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[1], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[2], open: 10800, high: 11200, low: 10700, close: 11100 },
    { tradingDate: t[3], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[4], open: 10000, high: 10500, low: 9800, close: 10200 },
    { tradingDate: t[5], open: 10800, high: 11200, low: 10700, close: 11100 },
    { tradingDate: t[6], open: 9800, high: 9900, low: 9700, close: 9850 },
    { tradingDate: t[7], open: 10000, high: 10500, low: 9800, close: 10200 },
  ];
  return rows.filter((r) => r.tradingDate).map((r) => ({ ...r, market: mkt }));
}

function oneTradeFixture(options) {
  const opts = options || {};
  const market = opts.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const calendarId = market === SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ
    ? "synthetic-calendar-kosdaq-v1"
    : "synthetic-calendar-kospi-v1";
  const calendar = buildCalendar({
    start: "2101-03-01",
    dayCount: 14,
    market,
    calendarId,
  });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, standardCandleRows(t, market), { markets: [market] });
  const closedTrades = [canonicalClosedTrade(t, { market, ...(opts.trade || {}) })];
  return {
    calendar,
    t,
    dataset,
    input: {
      initialCapital: Object.hasOwn(opts, "initialCapital") ? opts.initialCapital : INITIAL_CAPITAL,
      closedTrades,
      candles: dataset.candles,
      calendar,
    },
  };
}

function twoTradeFixture(options) {
  const opts = options || {};
  const fx = oneTradeFixture(opts);
  const t = fx.t;
  const market = opts.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  fx.input.closedTrades = [
    canonicalClosedTrade(t, { tradeId: "T1", market }),
    canonicalClosedTrade(t, { tradeId: "T2", market, entryDate: t[4], exitDate: t[5] }),
  ];
  return fx;
}

function threeTradeFixture() {
  const fx = twoTradeFixture();
  const t = fx.t;
  fx.input.closedTrades.push(
    canonicalClosedTrade(t, { tradeId: "T3", entryDate: t[6], exitDate: t[7] }),
  );
  return fx;
}

function eventsOf(result, type) {
  return result.ledgerEvents.filter((e) => e.eventType === type);
}

function assertOperationalBlocked(result) {
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

test("GATE5K-L01 valid initial capital", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  assert.equal(result.initialCapital, INITIAL_CAPITAL);
  assert.equal(result.ledgerVersion, PORTFOLIO_LEDGER_VERSION);
});

test("GATE5K-L02 zero capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: 0 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-L03 negative capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: -1 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
});

test("GATE5K-L04 NaN capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: Number.NaN });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
});

test("GATE5K-L05 Infinity capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: Number.POSITIVE_INFINITY });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
});

test("GATE5K-L06 string capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: "1000000" });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
});

test("GATE5K-L07 null capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: null });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
});

test("GATE5K-L08 undefined capital 차단", () => {
  const fx = oneTradeFixture();
  delete fx.input.initialCapital;
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.MISSING_REQUIRED_FIELD), true);
});

test("GATE5K-L09 one-trade entry cash", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const entry = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY)[0];
  assert.equal(entry.cashBefore, INITIAL_CAPITAL);
  assert.equal(entry.entryAmount, ENTRY_AMOUNT);
  assert.equal(entry.cost, ENTRY_COST);
  assert.equal(entry.cashAfter, ENTRY_CASH_AFTER);
});

test("GATE5K-L10 entry commission reflected", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const entry = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY)[0];
  assert.equal(entry.cost, ENTRY_COST);
  assert.equal(entry.equity, ENTRY_CASH_AFTER + ENTRY_AMOUNT);
  assert.equal(entry.equity, INITIAL_CAPITAL - ENTRY_COST);
});

test("GATE5K-L11 entry equity", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const entry = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY)[0];
  assert.equal(entry.equity, entry.cashAfter + entry.marketValue);
  assert.notEqual(entry.equity, INITIAL_CAPITAL);
});

test("GATE5K-L12 open market value", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const entry = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY)[0];
  assert.equal(entry.marketValue, ENTRY_AMOUNT);
  assert.equal(entry.positionQuantityAfter, QTY);
});

test("GATE5K-L13 unrealized gain", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const mtm = eventsOf(result, LEDGER_EVENT_TYPE.MARK_TO_MARKET)[0];
  assert.equal(mtm.marketPrice, 10200);
  assert.equal(mtm.marketValue, 102000);
  assert.equal(mtm.unrealizedPnl, 2000);
});

test("GATE5K-L14 unrealized loss", () => {
  const fx = oneTradeFixture();
  fx.input.candles = fx.input.candles.map((c) => {
    if (c.tradingDate === fx.t[1]) return { ...c, close: 9000 };
    return c;
  });
  const result = runPortfolioLedger(fx.input);
  const mtm = eventsOf(result, LEDGER_EVENT_TYPE.MARK_TO_MARKET)[0];
  assert.equal(mtm.marketPrice, 9000);
  assert.equal(mtm.unrealizedPnl, -10000);
});

test("GATE5K-L15 daily MTM", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const mtms = eventsOf(result, LEDGER_EVENT_TYPE.MARK_TO_MARKET);
  assert.ok(mtms.length >= 2);
  assert.equal(mtms[0].tradingDate, fx.t[1]);
  assert.equal(mtms[1].tradingDate, fx.t[2]);
  assert.equal(mtms[1].marketPrice, 11100);
});

test("GATE5K-L16 exit cash", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const exit = eventsOf(result, LEDGER_EVENT_TYPE.EXIT)[0];
  assert.equal(exit.cashBefore, ENTRY_CASH_AFTER);
  assert.equal(exit.exitAmount, EXIT_AMOUNT);
  assert.equal(exit.cost, EXIT_COST);
  assert.equal(exit.cashAfter, EXIT_CASH_AFTER);
});

test("GATE5K-L17 exit commission", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.cumulativeFees, ENTRY_COST + EXIT_COMMISSION);
});

test("GATE5K-L18 sell tax", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.cumulativeTaxes, SELL_TAX_TOTAL);
});

test("GATE5K-L19 realized PnL", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.realizedPnl, NET_PNL);
  const exit = eventsOf(result, LEDGER_EVENT_TYPE.EXIT)[0];
  assert.equal(exit.realizedPnl, NET_PNL);
});

test("GATE5K-L20 unrealized reset on exit", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const exit = eventsOf(result, LEDGER_EVENT_TYPE.EXIT)[0];
  assert.equal(exit.unrealizedPnl, 0);
  const lastDay = result.dailyEquityCurve.find((d) => d.tradingDate === fx.t[2]);
  assert.equal(lastDay.unrealizedPnl, 0);
});

test("GATE5K-L21 position reset", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const exit = eventsOf(result, LEDGER_EVENT_TYPE.EXIT)[0];
  assert.equal(exit.positionQuantityAfter, 0);
  assert.equal(exit.marketValue, 0);
});

test("GATE5K-L22 final equity = cash", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.finalEquity, result.finalCash);
});

test("GATE5K-L23 final cash = initial + netPnl", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.finalCash, INITIAL_CAPITAL + NET_PNL);
  assert.equal(result.finalCash, EXIT_CASH_AFTER);
});

test("GATE5K-L24 two trades cumulative cash", () => {
  const fx = twoTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  assert.equal(result.finalCash, INITIAL_CAPITAL + NET_PNL + NET_PNL);
  assert.equal(result.realizedPnl, NET_PNL * 2);
});

test("GATE5K-L25 three trades cumulative cash", () => {
  const fx = threeTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.finalCash, INITIAL_CAPITAL + (NET_PNL * 3));
});

test("GATE5K-L26 insufficient cash", () => {
  const fx = oneTradeFixture({ initialCapital: 50000 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_CASH), true);
  assert.equal(result.capitalConstraintApplied, false);
  assert.deepEqual(result.ledgerEvents, []);
});

test("GATE5K-L27 exact cash boundary", () => {
  const required = ENTRY_AMOUNT + ENTRY_COST;
  const fx = oneTradeFixture({ initialCapital: required });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  const entry = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY)[0];
  assert.equal(entry.cashAfter, 0);
  assert.equal(result.finalCash, required + NET_PNL);
});

test("GATE5K-L28 one unit too expensive", () => {
  const fx = oneTradeFixture({ initialCapital: ENTRY_AMOUNT + ENTRY_COST - 1 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_CASH), true);
});

test("GATE5K-L29 no quantity auto reduction", () => {
  const fx = oneTradeFixture({ initialCapital: ENTRY_AMOUNT + ENTRY_COST - 1 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_CASH), true);
  assert.equal(result.finalCash, null);
  assert.equal(fx.input.closedTrades[0].quantity, QTY);
});

test("GATE5K-L30 no negative cash", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  for (const ev of result.ledgerEvents) {
    assert.ok(ev.cashAfter >= 0);
    assert.equal(Number.isSafeInteger(ev.cashAfter), true);
  }
  for (const row of result.dailyEquityCurve) {
    assert.ok(row.cashBalance >= 0);
  }
});

test("GATE5K-L31 fee cumulative", () => {
  const fx = twoTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.cumulativeFees, (ENTRY_COST + EXIT_COMMISSION) * 2);
});

test("GATE5K-L32 tax cumulative", () => {
  const fx = twoTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.cumulativeTaxes, SELL_TAX_TOTAL * 2);
});

test("GATE5K-L33 total cost cumulative", () => {
  const fx = twoTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.cumulativeTotalCost, TOTAL_COST * 2);
  assert.equal(result.cumulativeTotalCost, result.cumulativeFees + result.cumulativeTaxes);
});

test("GATE5K-L34 event sequence deterministic", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  result.ledgerEvents.forEach((ev, i) => {
    assert.equal(ev.sequence, i);
  });
});

test("GATE5K-L35 same input deepEqual", () => {
  const fx = oneTradeFixture();
  const r1 = runPortfolioLedger(fx.input);
  const r2 = runPortfolioLedger(fx.input);
  assert.deepEqual(r1, r2);
});

test("GATE5K-L36 event date ordering", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const dated = result.ledgerEvents.filter((e) => e.tradingDate != null);
  for (let i = 1; i < dated.length; i++) {
    assert.ok(dated[i - 1].tradingDate <= dated[i].tradingDate);
  }
});

test("GATE5K-L37 flat day equity", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const flat = result.dailyEquityCurve.find((d) => d.tradingDate === fx.t[0]);
  assert.equal(flat.marketValue, 0);
  assert.equal(flat.unrealizedPnl, 0);
  assert.equal(flat.equity, flat.cashBalance);
  assert.equal(flat.cashBalance, INITIAL_CAPITAL);
});

test("GATE5K-L38 open day equity", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const open = result.dailyEquityCurve.find((d) => d.tradingDate === fx.t[1]);
  assert.equal(open.equity, open.cashBalance + open.marketValue);
  assert.equal(open.marketValue, 102000);
});

test("GATE5K-L39 daily curve one row/date", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const seen = new Set();
  for (const row of result.dailyEquityCurve) {
    assert.equal(seen.has(row.tradingDate), false);
    seen.add(row.tradingDate);
  }
  assert.equal(result.dailyEquityCurve.length, fx.t.length);
});

test("GATE5K-L40 input immutability", () => {
  const fx = oneTradeFixture();
  const snap = JSON.stringify(fx.input);
  runPortfolioLedger(fx.input);
  assert.equal(JSON.stringify(fx.input), snap);
});

test("GATE5K-L41 closedTrades immutability", () => {
  const fx = oneTradeFixture();
  const snap = JSON.stringify(fx.input.closedTrades);
  runPortfolioLedger(fx.input);
  assert.equal(JSON.stringify(fx.input.closedTrades), snap);
});

test("GATE5K-L42 KOSPI market identity", () => {
  const fx = oneTradeFixture({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  assert.equal(fx.input.closedTrades[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI);
});

test("GATE5K-L43 KOSDAQ market identity", () => {
  const fx = oneTradeFixture({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  assert.equal(fx.input.closedTrades[0].market, SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ);
});

test("GATE5K-L44 legacy market block", () => {
  const fx = oneTradeFixture({
    trade: { market: SYNTHETIC_MARKETS.SYNTHETIC_MARKET },
  });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE), true);
});

test("GATE5K-L45 production market block", () => {
  const fx = oneTradeFixture({ trade: { market: "KOSPI" } });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5K-L46 ledger does not emit lifecycle generic codes", () => {
  const fx = oneTradeFixture({ initialCapital: 1 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INSUFFICIENT_CASH), true);
  assert.equal(hasCode(result, ERROR.LIFECYCLE_FAILED), false);
  assert.equal(result.errorCodes.includes("CALENDAR_MARKET_MISMATCH"), false);
  assert.equal(result.errorCodes.includes("COST_POLICY_MARKET_MISMATCH"), false);
});

test("GATE5K-L47 missing field is explicit not generic stage wrap", () => {
  const fx = oneTradeFixture();
  delete fx.input.closedTrades[0].exitCommission;
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.MISSING_REQUIRED_FIELD), true);
  assert.equal(result.errors[0].field, "exitCommission");
});

test("GATE5K-L48 cash invariant integers", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  for (const ev of result.ledgerEvents) {
    assert.equal(Number.isSafeInteger(ev.cashBefore), true);
    assert.equal(Number.isSafeInteger(ev.cashAfter), true);
    assert.equal(ev.cashAfter === ev.cashAfter, true);
  }
});

test("GATE5K-L49 position invariant", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const entry = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY)[0];
  assert.ok(entry.positionQuantityAfter > 0);
  const exit = eventsOf(result, LEDGER_EVENT_TYPE.EXIT)[0];
  assert.equal(exit.positionQuantityAfter, 0);
  assert.equal(exit.marketValue, 0);
});

test("GATE5K-L50 equity invariant", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  for (const ev of result.ledgerEvents) {
    assert.equal(ev.equity, ev.cashAfter + ev.marketValue);
  }
  for (const row of result.dailyEquityCurve) {
    assert.equal(row.equity, row.cashBalance + row.marketValue);
  }
});

test("GATE5K-L51 open position at end", () => {
  const calendar = buildCalendar({ start: "2101-03-01", dayCount: 5 });
  const t = tradingDatesOf(calendar);
  const dataset = buildDataset(calendar, t.map((d) => ({
    tradingDate: d, open: 10000, high: 10100, low: 9900, close: 10050,
  })));
  const result = runPortfolioLedger({
    initialCapital: INITIAL_CAPITAL,
    closedTrades: [canonicalClosedTrade(t, { entryDate: t[0], exitDate: "2101-12-31" })],
    candles: dataset.candles,
    calendar,
  });
  assert.equal(hasCode(result, ERROR.OPEN_POSITION_AT_END), true);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-L52 empty closedTrades", () => {
  const fx = oneTradeFixture();
  fx.input.closedTrades = [];
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.EMPTY_CLOSED_TRADES), true);
});

test("GATE5K-L53 missing MTM candle", () => {
  const fx = oneTradeFixture();
  fx.input.candles = fx.input.candles.filter((c) => c.tradingDate !== fx.t[1]);
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.MTM_CANDLE_NOT_FOUND), true);
});

test("GATE5K-L54 zero market price", () => {
  const fx = oneTradeFixture();
  fx.input.candles = fx.input.candles.map((c) => {
    if (c.tradingDate === fx.t[1]) return { ...c, close: 0 };
    return c;
  });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  const mtm = eventsOf(result, LEDGER_EVENT_TYPE.MARK_TO_MARKET)[0];
  assert.equal(mtm.marketPrice, 0);
  assert.equal(mtm.marketValue, 0);
  assert.equal(mtm.unrealizedPnl, -ENTRY_AMOUNT);
});

test("GATE5K-L55 non-finite market price", () => {
  const fx = oneTradeFixture();
  fx.input.candles = fx.input.candles.map((c) => {
    if (c.tradingDate === fx.t[1]) return { ...c, close: Number.NaN };
    return c;
  });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5K-L56 duplicate trading date handling", () => {
  const fx = oneTradeFixture();
  fx.input.candles = fx.input.candles.concat([{ ...fx.input.candles[0] }]);
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
});

test("GATE5K-L57 event type ordering", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.ledgerEvents[0].eventType, LEDGER_EVENT_TYPE.INITIAL);
  const dated = result.ledgerEvents.filter((e) => e.tradingDate === fx.t[1]);
  assert.equal(dated[0].eventType, LEDGER_EVENT_TYPE.ENTRY);
  assert.equal(dated[1].eventType, LEDGER_EVENT_TYPE.MARK_TO_MARKET);
  const exitDay = result.ledgerEvents.filter((e) => e.tradingDate === fx.t[2]);
  assert.equal(exitDay[0].eventType, LEDGER_EVENT_TYPE.MARK_TO_MARKET);
  assert.equal(exitDay[1].eventType, LEDGER_EVENT_TYPE.EXIT);
});

test("GATE5K-L58 entry day snapshot", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const snap = result.dailyEquityCurve.find((d) => d.tradingDate === fx.t[1]);
  assert.equal(snap.cashBalance, ENTRY_CASH_AFTER);
  assert.equal(snap.marketValue, 102000);
  assert.equal(snap.equity, ENTRY_CASH_AFTER + 102000);
});

test("GATE5K-L59 exit day snapshot", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const snap = result.dailyEquityCurve.find((d) => d.tradingDate === fx.t[2]);
  assert.equal(snap.cashBalance, EXIT_CASH_AFTER);
  assert.equal(snap.marketValue, 0);
  assert.equal(snap.equity, EXIT_CASH_AFTER);
  assert.equal(snap.realizedPnl, NET_PNL);
});

test("GATE5K-L60 capitalConstraintApplied=true on success", () => {
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.capitalConstraintApplied, true);
  assertOperationalBlocked(result);
  assertPerformanceNull(result);
});

test("GATE5K-L61 missing sellTaxTotal 차단", () => {
  const fx = oneTradeFixture();
  delete fx.input.closedTrades[0].sellTaxTotal;
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.MISSING_REQUIRED_FIELD), true);
  assert.equal(result.errors.some((e) => e.field === "sellTaxTotal"), true);
});

test("GATE5K-L62 explicit zero commission allowed", () => {
  const fx = oneTradeFixture({
    trade: {
      entryCommission: 0,
      entryCost: 0,
      exitCommission: 0,
      sellTaxTotal: 0,
      exitCost: 0,
      netPnl: GROSS_PNL,
    },
  });
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.portfolioStatus, PORTFOLIO_STATUS.COMPLETED);
  assert.equal(result.cumulativeFees, 0);
  assert.equal(result.finalCash, INITIAL_CAPITAL + GROSS_PNL);
});

test("GATE5K-L63 non-object input", () => {
  const result = runPortfolioLedger(null);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(result.capitalConstraintApplied, false);
});

test("GATE5K-L64 invalid quantity", () => {
  const fx = oneTradeFixture({ trade: { quantity: 0, entryCommission: 0, entryCost: 0, exitCommission: 0, sellTaxTotal: 0, exitCost: 0, netPnl: 0 } });
  fx.input.closedTrades[0].quantity = 0;
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_QUANTITY), true);
});

test("GATE5K-L65 integer equality no float tolerance", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "lib", "backtest", "portfolio-ledger.js"),
    "utf8",
  );
  assert.equal(src.includes("0.001"), false);
  assert.equal(src.includes("Math.abs"), false);
  const fx = oneTradeFixture();
  const result = runPortfolioLedger(fx.input);
  assert.equal(result.finalCash, INITIAL_CAPITAL + NET_PNL);
  assert.equal(result.finalCash === INITIAL_CAPITAL + NET_PNL, true);
});

test("GATE5K-L66 candles array immutability", () => {
  const fx = oneTradeFixture();
  const snap = JSON.stringify(fx.input.candles);
  runPortfolioLedger(fx.input);
  assert.equal(JSON.stringify(fx.input.candles), snap);
});

test("GATE5K-L67 calendar days immutability", () => {
  const fx = oneTradeFixture();
  const snap = JSON.stringify(fx.input.calendar.days);
  runPortfolioLedger(fx.input);
  assert.equal(JSON.stringify(fx.input.calendar.days), snap);
});

test("GATE5K-L68 second trade uses post-exit cash", () => {
  const fx = twoTradeFixture();
  const result = runPortfolioLedger(fx.input);
  const entries = eventsOf(result, LEDGER_EVENT_TYPE.ENTRY);
  assert.equal(entries[1].cashBefore, EXIT_CASH_AFTER);
  assert.equal(entries[1].cashAfter, EXIT_CASH_AFTER - ENTRY_AMOUNT - ENTRY_COST);
});

test("GATE5K-L69 overlapping open positions blocked", () => {
  const fx = oneTradeFixture();
  const t = fx.t;
  fx.input.closedTrades = [
    canonicalClosedTrade(t, { tradeId: "T1", entryDate: t[1], exitDate: t[4] }),
    canonicalClosedTrade(t, { tradeId: "T2", entryDate: t[2], exitDate: t[5] }),
  ];
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.POSITION_LEDGER_INVARIANT_VIOLATION), true);
});

test("GATE5K-L70 fractional capital 차단", () => {
  const fx = oneTradeFixture({ initialCapital: 1000000.5 });
  const result = runPortfolioLedger(fx.input);
  assert.equal(hasCode(result, ERROR.INVALID_INITIAL_CAPITAL), true);
});
