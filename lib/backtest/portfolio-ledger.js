/**
 * GATE 5K Cash/Position/Equity Ledger. 순수 CommonJS. I/O 없음.
 * runPortfolioLedger(input) → ledger 결과
 * 6K: makeError via shared makeBacktestError. Extra objects unchanged.
 * 7U: blockedResult copies errors via slice().
 */

"use strict";

const executionModel = require("./execution-model");
const dataValidation = require("./data-validation");
const { makeBacktestError: makeError } = require("./make-error");

const PORTFOLIO_LEDGER_VERSION = "portfolio-ledger-v0.1";

const PORTFOLIO_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_PORTFOLIO_LEDGER",
  BLOCKED: "BLOCKED_PORTFOLIO_LEDGER",
});

const LEDGER_EVENT_TYPE = Object.freeze({
  INITIAL: "INITIAL",
  ENTRY: "ENTRY",
  MARK_TO_MARKET: "MARK_TO_MARKET",
  EXIT: "EXIT",
});

const ERROR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_INITIAL_CAPITAL: "INVALID_INITIAL_CAPITAL",
  INSUFFICIENT_CASH: "INSUFFICIENT_CASH",
  LIFECYCLE_FAILED: "LIFECYCLE_FAILED",
  CASH_LEDGER_INVARIANT_VIOLATION: "CASH_LEDGER_INVARIANT_VIOLATION",
  EQUITY_LEDGER_INVARIANT_VIOLATION: "EQUITY_LEDGER_INVARIANT_VIOLATION",
  POSITION_LEDGER_INVARIANT_VIOLATION: "POSITION_LEDGER_INVARIANT_VIOLATION",
  OPEN_POSITION_AT_END: "OPEN_POSITION_AT_END",
  MTM_CANDLE_NOT_FOUND: "MTM_CANDLE_NOT_FOUND",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  EMPTY_CLOSED_TRADES: "EMPTY_CLOSED_TRADES",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE: "LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE",
  PRODUCTION_MARKET_NOT_ALLOWED: "PRODUCTION_MARKET_NOT_ALLOWED",
});

const CLOSED_TRADE_REQUIRED_FIELDS = Object.freeze([
  "tradeId",
  "quantity",
  "entryDate",
  "exitDate",
  "entryPrice",
  "exitPrice",
  "entryCost",
  "exitCost",
  "entryCommission",
  "exitCommission",
  "sellTaxTotal",
  "netPnl",
]);

const REAL_MARKET_NAMES = new Set(["KOSPI", "KOSDAQ", "KRX", "NASDAQ", "NYSE"]);
const ALLOWED_LEDGER_MARKETS = new Set([
  dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
  dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
]);

// ─── 유틸리티 ────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function uniqueCodes(errors) {
  const seen = new Set();
  const out = [];
  for (const e of errors) {
    if (!e || e.code == null || seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e.code);
  }
  return out;
}

function isSafeInt(v) {
  return typeof v === "number"
    && Number.isFinite(v)
    && Number.isSafeInteger(v);
}

function isPositiveSafeInt(v) {
  return isSafeInt(v) && v > 0;
}

function isNonNegSafeInt(v) {
  return isSafeInt(v) && v >= 0;
}

function isValidCapital(v) {
  return isPositiveSafeInt(v);
}

function addSafe(a, b) {
  if (!isSafeInt(a) || !isSafeInt(b)) return null;
  const s = a + b;
  if (!isSafeInt(s)) return null;
  return s;
}

function subSafe(a, b) {
  if (!isSafeInt(a) || !isSafeInt(b)) return null;
  const d = a - b;
  if (!isSafeInt(d)) return null;
  return d;
}

function mulSafe(a, b) {
  if (!isSafeInt(a) || !isSafeInt(b)) return null;
  const p = a * b;
  if (!isSafeInt(p)) return null;
  return p;
}

function defaultSafetyFields() {
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

function blockedResult(errors) {
  // 7U: copy so callers cannot mutate the result errors array.
  const list = Array.isArray(errors) ? errors.slice() : [];
  return {
    portfolioStatus: PORTFOLIO_STATUS.BLOCKED,
    ledgerVersion: PORTFOLIO_LEDGER_VERSION,
    initialCapital: null,
    finalCash: null,
    finalEquity: null,
    realizedPnl: 0,
    cumulativeFees: 0,
    cumulativeTaxes: 0,
    cumulativeTotalCost: 0,
    ledgerEvents: [],
    dailyEquityCurve: [],
    capitalConstraintApplied: false,
    ...defaultSafetyFields(),
    ...defaultPerformanceFields(),
    errorCodes: uniqueCodes(list),
    errors: list,
  };
}

function compareClosedTrades(a, b) {
  if (a.entryDate < b.entryDate) return -1;
  if (a.entryDate > b.entryDate) return 1;
  if (a.exitDate < b.exitDate) return -1;
  if (a.exitDate > b.exitDate) return 1;
  const ta = String(a.tradeId);
  const tb = String(b.tradeId);
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

function rejectClosedTradeMarket(market, tradeId) {
  if (market == null) return null;
  if (REAL_MARKET_NAMES.has(market)) {
    return makeError(ERROR.PRODUCTION_MARKET_NOT_ALLOWED, { field: "market", tradeId });
  }
  if (market === dataValidation.SYNTHETIC_MARKETS.SYNTHETIC_MARKET) {
    return makeError(ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE, { field: "market", tradeId });
  }
  if (!ALLOWED_LEDGER_MARKETS.has(market)) {
    return makeError(ERROR.INVALID_INPUT, { field: "market", tradeId });
  }
  return null;
}

function buildCandleMap(candles) {
  const map = new Map();
  if (!Array.isArray(candles)) return { ok: false, error: makeError(ERROR.INVALID_INPUT, { field: "candles" }) };
  for (const c of candles) {
    if (!isPlainObject(c) || c.tradingDate == null) continue;
    if (map.has(c.tradingDate)) {
      return {
        ok: false,
        error: makeError(ERROR.INVALID_INPUT, { field: "candles.tradingDate", tradingDate: c.tradingDate }),
      };
    }
    map.set(c.tradingDate, c);
  }
  return { ok: true, map };
}

function readClosePrice(candle, tradingDate) {
  if (!isPlainObject(candle) || !Object.hasOwn(candle, "close")) {
    return { ok: false, error: makeError(ERROR.MTM_CANDLE_NOT_FOUND, { tradingDate }) };
  }
  if (!isNonNegSafeInt(candle.close)) {
    return { ok: false, error: makeError(ERROR.INVALID_INPUT, { field: "close", tradingDate }) };
  }
  return { ok: true, close: candle.close };
}

// ─── 메인 함수 ───────────────────────────────────────────────────────────────

function runPortfolioLedger(input) {
  if (!isPlainObject(input)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT)]);
  }

  const errors = [];

  const requiredFields = ["initialCapital", "closedTrades", "candles", "calendar"];
  for (const f of requiredFields) {
    if (!Object.hasOwn(input, f)) {
      errors.push(makeError(ERROR.MISSING_REQUIRED_FIELD, { field: f }));
    }
  }
  if (errors.length > 0) return blockedResult(errors);

  if (!isValidCapital(input.initialCapital)) {
    return blockedResult([makeError(ERROR.INVALID_INITIAL_CAPITAL, { field: "initialCapital" })]);
  }

  if (!Array.isArray(input.closedTrades)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "closedTrades" })]);
  }
  if (input.closedTrades.length === 0) {
    return blockedResult([makeError(ERROR.EMPTY_CLOSED_TRADES, { field: "closedTrades" })]);
  }

  if (!Array.isArray(input.candles)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "candles" })]);
  }
  if (!isPlainObject(input.calendar) || !Array.isArray(input.calendar.days)) {
    return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "calendar" })]);
  }

  const { initialCapital } = input;
  const closedTrades = input.closedTrades.slice();
  const candles = input.candles.slice();
  const calendarDays = input.calendar.days.slice();

  const fieldErrors = [];
  for (let i = 0; i < closedTrades.length; i++) {
    const ct = closedTrades[i];
    if (!isPlainObject(ct)) {
      return blockedResult([makeError(ERROR.INVALID_INPUT, { field: `closedTrades[${i}]` })]);
    }
    for (const f of CLOSED_TRADE_REQUIRED_FIELDS) {
      if (!Object.hasOwn(ct, f)) {
        fieldErrors.push(makeError(ERROR.MISSING_REQUIRED_FIELD, {
          field: f,
          tradeId: ct.tradeId,
        }));
      }
    }
    const qty = ct.quantity;
    if (typeof qty !== "number" || !Number.isInteger(qty) || !Number.isFinite(qty) || qty <= 0 || !Number.isSafeInteger(qty)) {
      return blockedResult([makeError(ERROR.INVALID_QUANTITY, { field: "quantity", tradeId: ct.tradeId })]);
    }
    if (Object.hasOwn(ct, "entryPrice") && !isPositiveSafeInt(ct.entryPrice)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "entryPrice", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "exitPrice") && !isPositiveSafeInt(ct.exitPrice)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "exitPrice", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "entryCost") && !isNonNegSafeInt(ct.entryCost)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "entryCost", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "exitCost") && !isNonNegSafeInt(ct.exitCost)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "exitCost", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "entryCommission") && !isNonNegSafeInt(ct.entryCommission)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "entryCommission", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "exitCommission") && !isNonNegSafeInt(ct.exitCommission)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "exitCommission", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "sellTaxTotal") && !isNonNegSafeInt(ct.sellTaxTotal)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "sellTaxTotal", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "netPnl") && !isSafeInt(ct.netPnl)) {
      fieldErrors.push(makeError(ERROR.INVALID_INPUT, { field: "netPnl", tradeId: ct.tradeId }));
    }
    if (Object.hasOwn(ct, "market")) {
      const marketErr = rejectClosedTradeMarket(ct.market, ct.tradeId);
      if (marketErr) fieldErrors.push(marketErr);
    }
  }
  if (fieldErrors.length > 0) return blockedResult(fieldErrors);

  for (const ct of closedTrades) {
    const exitCostFromParts = addSafe(ct.exitCommission, ct.sellTaxTotal);
    if (exitCostFromParts == null || ct.exitCost !== exitCostFromParts) {
      return blockedResult([makeError(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
        field: "exitCost",
        tradeId: ct.tradeId,
      })]);
    }
    if (ct.entryCost !== ct.entryCommission) {
      return blockedResult([makeError(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
        field: "entryCost",
        tradeId: ct.tradeId,
      })]);
    }
    const gross = mulSafe(subSafe(ct.exitPrice, ct.entryPrice), ct.quantity);
    const netExpected = gross == null ? null : subSafe(subSafe(gross, ct.entryCost), ct.exitCost);
    if (netExpected == null || ct.netPnl !== netExpected) {
      return blockedResult([makeError(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
        field: "netPnl",
        tradeId: ct.tradeId,
      })]);
    }
  }

  const candleBuilt = buildCandleMap(candles);
  if (!candleBuilt.ok) return blockedResult([candleBuilt.error]);
  const candleMap = candleBuilt.map;

  const tradingDates = calendarDays
    .filter((d) => isPlainObject(d) && d.dayStatus === "TRADING_DAY")
    .map((d) => d.tradingDate)
    .slice();
  tradingDates.sort();

  const seenDates = new Set();
  for (const td of tradingDates) {
    if (seenDates.has(td)) {
      return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "calendar.days", tradingDate: td })]);
    }
    seenDates.add(td);
  }

  const tradingDateSet = new Set(tradingDates);
  for (const ct of closedTrades) {
    if (!tradingDateSet.has(ct.entryDate)) {
      return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "entryDate", tradeId: ct.tradeId })]);
    }
    if (ct.exitDate < ct.entryDate) {
      return blockedResult([makeError(ERROR.INVALID_INPUT, { field: "exitDate", tradeId: ct.tradeId })]);
    }
  }

  const trades = closedTrades.slice();
  trades.sort(compareClosedTrades);

  let seq = 0;
  let cashBalance = initialCapital;
  let positionQuantity = 0;
  let positionCostBasis = 0;
  let averageEntryPrice = 0;
  let realizedPnl = 0;
  let cumulativeFees = 0;
  let cumulativeTaxes = 0;
  let cumulativeTotalCost = 0;

  const ledgerEvents = [];

  const initialEvent = {
    sequence: seq++,
    tradingDate: null,
    eventType: LEDGER_EVENT_TYPE.INITIAL,
    tradeId: null,
    cashBefore: 0,
    cashAfter: initialCapital,
    positionQuantityBefore: 0,
    positionQuantityAfter: 0,
    marketPrice: null,
    marketValue: 0,
    entryAmount: null,
    exitAmount: null,
    cost: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cumulativeFees: 0,
    cumulativeTaxes: 0,
    equity: initialCapital,
  };
  ledgerEvents.push(initialEvent);

  const tradeByEntry = new Map();
  const tradeByExit = new Map();
  for (const ct of trades) {
    if (!tradeByEntry.has(ct.entryDate)) tradeByEntry.set(ct.entryDate, []);
    tradeByEntry.get(ct.entryDate).push(ct);
    if (!tradeByExit.has(ct.exitDate)) tradeByExit.set(ct.exitDate, []);
    tradeByExit.get(ct.exitDate).push(ct);
  }

  let currentTrade = null;
  const dailyEquityCurve = [];

  function failInvariant(code, extra) {
    return blockedResult([makeError(code, extra)]);
  }

  function assertCashNonNegative(tradeId, tradingDate) {
    if (!isNonNegSafeInt(cashBalance)) {
      return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { tradeId, tradingDate });
    }
    return null;
  }

  function assertEquity(cash, marketValue, equity, extra) {
    const expected = addSafe(cash, marketValue);
    if (expected == null || equity !== expected) {
      return failInvariant(ERROR.EQUITY_LEDGER_INVARIANT_VIOLATION, extra);
    }
    return null;
  }

  for (const td of tradingDates) {
    const entriesOnDate = tradeByEntry.get(td) || [];
    const exitsOnDate = tradeByExit.get(td) || [];

    for (const ct of entriesOnDate) {
      if (positionQuantity !== 0 || currentTrade != null) {
        return failInvariant(ERROR.POSITION_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }

      const cashBefore = cashBalance;
      const qty = ct.quantity;
      const entryPrice = ct.entryPrice;
      const entryAmount = mulSafe(entryPrice, qty);
      const entryCost = ct.entryCost;
      if (entryAmount == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }
      const requiredCash = addSafe(entryAmount, entryCost);
      if (requiredCash == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }

      if (cashBalance < requiredCash) {
        return blockedResult([makeError(ERROR.INSUFFICIENT_CASH, {
          tradeId: ct.tradeId,
          tradingDate: td,
        })]);
      }

      const afterEntry = subSafe(subSafe(cashBalance, entryAmount), entryCost);
      if (afterEntry == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }
      cashBalance = afterEntry;
      positionQuantity = qty;
      positionCostBasis = entryAmount;
      averageEntryPrice = entryPrice;

      const nextFees = addSafe(cumulativeFees, entryCost);
      const nextTotal = addSafe(cumulativeTotalCost, entryCost);
      if (nextFees == null || nextTotal == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }
      cumulativeFees = nextFees;
      cumulativeTotalCost = nextTotal;

      const marketValue = entryAmount;
      const equity = addSafe(cashBalance, marketValue);
      if (equity == null) {
        return failInvariant(ERROR.EQUITY_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }

      const cashFail = assertCashNonNegative(ct.tradeId, td);
      if (cashFail) return cashFail;
      const eqFail = assertEquity(cashBalance, marketValue, equity, {
        tradeId: ct.tradeId,
        tradingDate: td,
      });
      if (eqFail) return eqFail;

      ledgerEvents.push({
        sequence: seq++,
        tradingDate: td,
        eventType: LEDGER_EVENT_TYPE.ENTRY,
        tradeId: ct.tradeId,
        cashBefore,
        cashAfter: cashBalance,
        positionQuantityBefore: 0,
        positionQuantityAfter: positionQuantity,
        marketPrice: entryPrice,
        marketValue,
        entryAmount,
        exitAmount: null,
        cost: entryCost,
        realizedPnl,
        unrealizedPnl: 0,
        cumulativeFees,
        cumulativeTaxes,
        equity,
      });

      currentTrade = ct;
    }

    if (positionQuantity > 0 && currentTrade != null) {
      const candle = candleMap.get(td);
      if (!candle) {
        return blockedResult([makeError(ERROR.MTM_CANDLE_NOT_FOUND, { tradingDate: td })]);
      }
      const closeRead = readClosePrice(candle, td);
      if (!closeRead.ok) return blockedResult([closeRead.error]);
      const marketPrice = closeRead.close;
      const marketValue = mulSafe(positionQuantity, marketPrice);
      if (marketValue == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
      }
      const unrealizedPnl = subSafe(marketValue, positionCostBasis);
      if (unrealizedPnl == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
      }
      const equity = addSafe(cashBalance, marketValue);
      if (equity == null) {
        return failInvariant(ERROR.EQUITY_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
      }
      const eqFail = assertEquity(cashBalance, marketValue, equity, { tradingDate: td });
      if (eqFail) return eqFail;
      if (positionQuantity <= 0 || averageEntryPrice <= 0) {
        return failInvariant(ERROR.POSITION_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
      }

      ledgerEvents.push({
        sequence: seq++,
        tradingDate: td,
        eventType: LEDGER_EVENT_TYPE.MARK_TO_MARKET,
        tradeId: currentTrade.tradeId,
        cashBefore: cashBalance,
        cashAfter: cashBalance,
        positionQuantityBefore: positionQuantity,
        positionQuantityAfter: positionQuantity,
        marketPrice,
        marketValue,
        entryAmount: null,
        exitAmount: null,
        cost: 0,
        realizedPnl,
        unrealizedPnl,
        cumulativeFees,
        cumulativeTaxes,
        equity,
      });
    }

    for (const ct of exitsOnDate) {
      if (positionQuantity <= 0 || currentTrade == null || currentTrade.tradeId !== ct.tradeId) {
        return failInvariant(ERROR.POSITION_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }

      const cashBefore = cashBalance;
      const qty = ct.quantity;
      const exitPrice = ct.exitPrice;
      const exitAmount = mulSafe(exitPrice, qty);
      const exitCost = ct.exitCost;
      const exitCommission = ct.exitCommission;
      const sellTaxTotal = ct.sellTaxTotal;
      if (exitAmount == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }

      const afterExit = subSafe(addSafe(cashBalance, exitAmount), exitCost);
      if (afterExit == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }
      cashBalance = afterExit;
      positionQuantity = 0;
      positionCostBasis = 0;
      averageEntryPrice = 0;

      const nextRealized = addSafe(realizedPnl, ct.netPnl);
      const nextFees = addSafe(cumulativeFees, exitCommission);
      const nextTaxes = addSafe(cumulativeTaxes, sellTaxTotal);
      const nextTotal = addSafe(cumulativeTotalCost, exitCost);
      if (nextRealized == null || nextFees == null || nextTaxes == null || nextTotal == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, {
          tradeId: ct.tradeId,
          tradingDate: td,
        });
      }
      realizedPnl = nextRealized;
      cumulativeFees = nextFees;
      cumulativeTaxes = nextTaxes;
      cumulativeTotalCost = nextTotal;

      const marketValue = 0;
      const equity = cashBalance;

      const cashFail = assertCashNonNegative(ct.tradeId, td);
      if (cashFail) return cashFail;
      const eqFail = assertEquity(cashBalance, marketValue, equity, {
        tradeId: ct.tradeId,
        tradingDate: td,
      });
      if (eqFail) return eqFail;

      ledgerEvents.push({
        sequence: seq++,
        tradingDate: td,
        eventType: LEDGER_EVENT_TYPE.EXIT,
        tradeId: ct.tradeId,
        cashBefore,
        cashAfter: cashBalance,
        positionQuantityBefore: qty,
        positionQuantityAfter: 0,
        marketPrice: exitPrice,
        marketValue: 0,
        entryAmount: null,
        exitAmount,
        cost: exitCost,
        realizedPnl,
        unrealizedPnl: 0,
        cumulativeFees,
        cumulativeTaxes,
        equity,
      });

      currentTrade = null;
    }

    let marketValue = 0;
    let unrealizedPnl = 0;
    if (positionQuantity > 0) {
      const candle = candleMap.get(td);
      if (!candle) {
        return blockedResult([makeError(ERROR.MTM_CANDLE_NOT_FOUND, { tradingDate: td })]);
      }
      const closeRead = readClosePrice(candle, td);
      if (!closeRead.ok) return blockedResult([closeRead.error]);
      const mv = mulSafe(positionQuantity, closeRead.close);
      if (mv == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
      }
      marketValue = mv;
      const u = subSafe(marketValue, positionCostBasis);
      if (u == null) {
        return failInvariant(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
      }
      unrealizedPnl = u;
    } else if (marketValue !== 0 || unrealizedPnl !== 0 || positionQuantity !== 0) {
      return failInvariant(ERROR.POSITION_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
    }

    const equity = addSafe(cashBalance, marketValue);
    if (equity == null) {
      return failInvariant(ERROR.EQUITY_LEDGER_INVARIANT_VIOLATION, { tradingDate: td });
    }
    const eqFail = assertEquity(cashBalance, marketValue, equity, { tradingDate: td });
    if (eqFail) return eqFail;

    dailyEquityCurve.push({
      tradingDate: td,
      cashBalance,
      marketValue,
      equity,
      realizedPnl,
      unrealizedPnl,
    });
  }

  if (positionQuantity > 0 || currentTrade != null) {
    return blockedResult([makeError(ERROR.OPEN_POSITION_AT_END)]);
  }

  let expectedFinalCash = initialCapital;
  for (const ct of trades) {
    expectedFinalCash = addSafe(expectedFinalCash, ct.netPnl);
    if (expectedFinalCash == null) {
      return blockedResult([makeError(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { field: "finalCash" })]);
    }
  }
  if (cashBalance !== expectedFinalCash) {
    return blockedResult([makeError(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { field: "finalCash" })]);
  }

  const feeTaxSum = addSafe(cumulativeFees, cumulativeTaxes);
  if (feeTaxSum == null || feeTaxSum !== cumulativeTotalCost) {
    return blockedResult([makeError(ERROR.CASH_LEDGER_INVARIANT_VIOLATION, { field: "cumulativeTotalCost" })]);
  }

  const finalEquity = cashBalance;

  return {
    portfolioStatus: PORTFOLIO_STATUS.COMPLETED,
    ledgerVersion: PORTFOLIO_LEDGER_VERSION,
    initialCapital,
    finalCash: cashBalance,
    finalEquity,
    realizedPnl,
    cumulativeFees,
    cumulativeTaxes,
    cumulativeTotalCost,
    ledgerEvents,
    dailyEquityCurve,
    capitalConstraintApplied: true,
    ...defaultSafetyFields(),
    ...defaultPerformanceFields(),
    errorCodes: [],
    errors: [],
  };
}

module.exports = {
  PORTFOLIO_LEDGER_VERSION,
  PORTFOLIO_STATUS,
  LEDGER_EVENT_TYPE,
  ERROR,
  runPortfolioLedger,
  blockedResult,
};
