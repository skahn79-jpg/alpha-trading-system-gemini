"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SIDE,
  ERROR,
} = require("../lib/paper/paper-result");
const {
  createPaperAccountState,
  clonePaperAccountState,
} = require("../lib/paper/paper-account-state");
const { applyPaperFill } = require("../lib/paper/paper-ledger-stepper");
const {
  calculateCommission,
  calculateSellTaxes,
  ROUNDING_MODE,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
} = require("../lib/backtest/cost-policy");

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
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
  if (overrides.commission) {
    out.commission = { ...base.commission, ...overrides.commission };
  }
  if (overrides.sellTaxes) {
    out.sellTaxes = overrides.sellTaxes;
  }
  return out;
}

function buyCommission(amount) {
  const policy = makePolicy();
  return calculateCommission({
    amount,
    ratePpm: policy.commission.buyRatePpm,
    minimumAmount: policy.commission.minimumBuyAmount,
    roundingMode: policy.commission.roundingMode,
  }).amount;
}

function sellCosts(amount) {
  const policy = makePolicy();
  const commission = calculateCommission({
    amount,
    ratePpm: policy.commission.sellRatePpm,
    minimumAmount: policy.commission.minimumSellAmount,
    roundingMode: policy.commission.roundingMode,
  }).amount;
  const tax = calculateSellTaxes({
    amount,
    sellTaxes: policy.sellTaxes,
  }).total;
  return { commission, tax };
}

function emptyState() {
  return createPaperAccountState({
    accountId: "paper-acc-1",
    initialCash: 1_000_000,
  });
}

test("C03 BUY fill numbers and C69 cost parity", () => {
  const state = emptyState();
  const snap = jsonClone(state);
  const commission = buyCommission(500000);
  assert.equal(commission, 50);
  const result = applyPaperFill(state, {
    side: SIDE.BUY,
    symbol: "AAA",
    quantity: 10,
    fillPrice: 50000,
    commission,
    tax: 0,
    eventId: "evt-11",
    sequence: 11,
    intentId: "intent-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.cash, 499950);
  assert.equal(result.state.positions.AAA.quantity, 10);
  assert.equal(result.state.positions.AAA.costBasis, 500050);
  assert.equal(result.tradeEffect.commission, commission);
  assert.deepEqual(jsonClone(state), snap);
});

test("C04 open position survives return", () => {
  const commission = buyCommission(500000);
  const result = applyPaperFill(emptyState(), {
    side: SIDE.BUY,
    symbol: "AAA",
    quantity: 10,
    fillPrice: 50000,
    commission,
    tax: 0,
    eventId: "evt-11",
    sequence: 11,
    intentId: "intent-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.positions.AAA.quantity > 0, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "OPEN_POSITION_AT_END"), false);
  assert.equal(JSON.stringify(result).includes("OPEN_POSITION_AT_END"), false);
});

test("C05 second BUY accumulates quantity and costBasis", () => {
  const first = applyPaperFill(emptyState(), {
    side: SIDE.BUY,
    symbol: "AAA",
    quantity: 10,
    fillPrice: 50000,
    commission: 50,
    tax: 0,
    eventId: "evt-11",
    sequence: 11,
    intentId: "intent-1",
  });
  const commission = buyCommission(200000);
  assert.equal(commission, 20);
  const second = applyPaperFill(first.state, {
    side: SIDE.BUY,
    symbol: "AAA",
    quantity: 5,
    fillPrice: 40000,
    commission,
    tax: 0,
    eventId: "evt-12",
    sequence: 12,
    intentId: "intent-2",
  });
  assert.equal(second.ok, true);
  assert.equal(second.state.cash, 299930);
  assert.equal(second.state.positions.AAA.quantity, 15);
  assert.equal(second.state.positions.AAA.costBasis, 700070);
});

test("C06 C07 partial SELL lotCost and remaining position", () => {
  let state = emptyState();
  state = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "AAA", quantity: 10, fillPrice: 50000,
    commission: 50, tax: 0, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  }).state;
  state = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "AAA", quantity: 5, fillPrice: 40000,
    commission: 20, tax: 0, eventId: "evt-12", sequence: 12, intentId: "intent-2",
  }).state;
  const costs = sellCosts(240000);
  assert.equal(costs.commission, 24);
  assert.equal(costs.tax, 240);
  const result = applyPaperFill(state, {
    side: SIDE.SELL,
    symbol: "AAA",
    quantity: 4,
    fillPrice: 60000,
    commission: costs.commission,
    tax: costs.tax,
    eventId: "evt-13",
    sequence: 13,
    intentId: "intent-3",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.positions.AAA.quantity, 11);
  assert.equal(result.state.positions.AAA.costBasis, 513385);
  assert.equal(result.state.cash, 539666);
  assert.equal(result.state.realizedPnl, 53051);
  assert.equal(result.tradeEffect.lotCost, 186685);
  assert.equal(Math.floor(700070 * 4 / 15), 186685);
});

test("C08 C09 C10 full SELL closes position and realized pnl", () => {
  let state = emptyState();
  state = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "AAA", quantity: 10, fillPrice: 50000,
    commission: 50, tax: 0, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  }).state;
  state = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "AAA", quantity: 5, fillPrice: 40000,
    commission: 20, tax: 0, eventId: "evt-12", sequence: 12, intentId: "intent-2",
  }).state;
  state = applyPaperFill(state, {
    side: SIDE.SELL, symbol: "AAA", quantity: 4, fillPrice: 60000,
    commission: 24, tax: 240, eventId: "evt-13", sequence: 13, intentId: "intent-3",
  }).state;
  const costs = sellCosts(605000);
  assert.equal(costs.commission, 60);
  assert.equal(costs.tax, 605);
  const result = applyPaperFill(state, {
    side: SIDE.SELL,
    symbol: "AAA",
    quantity: 11,
    fillPrice: 55000,
    commission: costs.commission,
    tax: costs.tax,
    eventId: "evt-14",
    sequence: 14,
    intentId: "intent-4",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.positions.AAA, undefined);
  assert.deepEqual(result.state.positions, {});
  assert.equal(result.state.cash, 1144001);
  assert.equal(result.state.realizedPnl, 144001);
  assert.equal(result.tradeEffect.lotCost, 513385);
});

test("stepper insufficient cash returns clone unchanged", () => {
  const state = emptyState();
  const snap = jsonClone(state);
  const result = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "AAA", quantity: 100, fillPrice: 50000,
    commission: 500, tax: 0, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INSUFFICIENT_CASH), true);
  assert.deepEqual(result.state, snap);
  assert.deepEqual(jsonClone(state), snap);
});

test("stepper insufficient position returns clone unchanged", () => {
  const state = emptyState();
  const snap = jsonClone(state);
  const result = applyPaperFill(state, {
    side: SIDE.SELL, symbol: "AAA", quantity: 1, fillPrice: 50000,
    commission: 5, tax: 50, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INSUFFICIENT_POSITION), true);
  assert.deepEqual(result.state, snap);
});

test("stepper BUY tax must be 0", () => {
  const result = applyPaperFill(emptyState(), {
    side: SIDE.BUY, symbol: "AAA", quantity: 10, fillPrice: 50000,
    commission: 50, tax: 1, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
});

test("C49 stepper source has no forbidden ledger call strings", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "paper", "paper-ledger-stepper.js"),
    "utf8",
  );
  assert.equal(src.includes("runPortfolioLedger"), false);
  assert.equal(src.includes("OPEN_POSITION_AT_END"), false);
});

test("11D-R1 symbol __proto__ BUY own position, SELL remaining, full close, prototype unchanged", () => {
  const protoObj = Object.prototype;
  const state = emptyState();
  const posProto = Object.getPrototypeOf(state.positions);
  const first = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "__proto__", quantity: 10, fillPrice: 50000,
    commission: 50, tax: 0, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  });
  assert.equal(first.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(first.state.positions, "__proto__"), true);
  assert.equal(first.state.positions["__proto__"].quantity, 10);
  assert.equal(Object.getPrototypeOf(first.state.positions), posProto);
  assert.equal(Object.getPrototypeOf({}) === protoObj, true);
  const partial = applyPaperFill(first.state, {
    side: SIDE.SELL, symbol: "__proto__", quantity: 4, fillPrice: 60000,
    commission: 24, tax: 240, eventId: "evt-13", sequence: 13, intentId: "intent-3",
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.state.positions["__proto__"].quantity, 6);
  const closed = applyPaperFill(partial.state, {
    side: SIDE.SELL, symbol: "__proto__", quantity: 6, fillPrice: 55000,
    commission: 33, tax: 330, eventId: "evt-14", sequence: 14, intentId: "intent-4",
  });
  assert.equal(closed.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(closed.state.positions, "__proto__"), false);
  assert.deepEqual(closed.state.positions, {});
  assert.equal(Object.getPrototypeOf(closed.state.positions), Object.prototype);
});

test("11D-R1 symbol constructor is not an inherited position; BUY creates own", () => {
  const state = emptyState();
  assert.equal(Object.prototype.hasOwnProperty.call(state.positions, "constructor"), false);
  const first = applyPaperFill(state, {
    side: SIDE.BUY, symbol: "constructor", quantity: 10, fillPrice: 50000,
    commission: 50, tax: 0, eventId: "evt-11", sequence: 11, intentId: "intent-1",
  });
  assert.equal(first.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(first.state.positions, "constructor"), true);
  assert.equal(first.state.positions.constructor.quantity, 10);
  const restored = JSON.parse(JSON.stringify(first.state));
  const second = applyPaperFill(restored, {
    side: SIDE.BUY, symbol: "constructor", quantity: 5, fillPrice: 40000,
    commission: 20, tax: 0, eventId: "evt-12", sequence: 12, intentId: "intent-2",
  });
  assert.equal(second.ok, true);
  assert.equal(second.state.positions.constructor.quantity, 15);
  assert.equal(Object.getPrototypeOf(second.state.positions), Object.prototype);
});
