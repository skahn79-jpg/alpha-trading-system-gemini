"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PAPER_MODE,
  SIDE,
  ORDER_TYPE,
  ERROR,
} = require("../lib/paper/paper-result");
const {
  createPaperAccountState,
} = require("../lib/paper/paper-account-state");
const {
  evaluatePaperRisk,
  validatePaperRiskConfig,
} = require("../lib/paper/paper-risk-engine");
const {
  ROUNDING_MODE,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
} = require("../lib/backtest/cost-policy");

function hasReason(decision, code) {
  return Array.isArray(decision.reasonCodes) && decision.reasonCodes.indexOf(code) !== -1;
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

function emptyState() {
  return createPaperAccountState({
    accountId: "paper-acc-1",
    initialCash: 1_000_000,
  });
}

function makeIntent(overrides) {
  return {
    intentId: "intent-1",
    mode: PAPER_MODE.PAPER,
    market: MARKET.SYNTHETIC_KOSPI,
    symbol: "AAA",
    side: SIDE.BUY,
    quantity: 10,
    orderType: ORDER_TYPE.MARKET_OPEN,
    signalSequence: 10,
    ...(overrides || {}),
  };
}

function makeConfig(overrides) {
  const extra = overrides || {};
  return {
    maxOrderNotional: extra.maxOrderNotional !== undefined ? extra.maxOrderNotional : Number.MAX_SAFE_INTEGER,
    maxPositionNotional: extra.maxPositionNotional !== undefined ? extra.maxPositionNotional : Number.MAX_SAFE_INTEGER,
    allowedMarkets: extra.allowedMarkets !== undefined ? extra.allowedMarkets : [MARKET.SYNTHETIC_KOSPI],
    allowedSymbols: extra.allowedSymbols !== undefined ? extra.allowedSymbols : ["AAA"],
  };
}

function makeCostContext(overrides) {
  const extra = overrides || {};
  return {
    policies: extra.policies !== undefined ? extra.policies : [makePolicy()],
    brokerChannel: extra.brokerChannel !== undefined ? extra.brokerChannel : BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: extra.currency !== undefined ? extra.currency : CURRENCY.KRW,
    tradingDate: extra.tradingDate !== undefined ? extra.tradingDate : "2101-06-01",
  };
}

function evalRisk(overrides) {
  const extra = overrides || {};
  const intent = extra.intent !== undefined ? extra.intent : makeIntent();
  return evaluatePaperRisk({
    accountState: extra.accountState !== undefined ? extra.accountState : emptyState(),
    intent,
    riskReferencePrice: extra.riskReferencePrice !== undefined ? extra.riskReferencePrice : 50000,
    riskConfig: extra.riskConfig !== undefined ? extra.riskConfig : makeConfig(),
    costContext: extra.costContext !== undefined ? extra.costContext : makeCostContext(),
    riskDecisionId: extra.riskDecisionId !== undefined ? extra.riskDecisionId : "risk-1",
    validAfterEventSequence: extra.validAfterEventSequence !== undefined ? extra.validAfterEventSequence : 10,
  });
}

function stateWithPosition(quantity, costBasis, cash) {
  const state = emptyState();
  state.positions = {
    AAA: { symbol: "AAA", quantity, costBasis },
  };
  if (cash !== undefined) state.cash = cash;
  return state;
}

test("I01 BUY 10 @ 50000 commission 50 requiredCash 500050 maxOrder 500000 APPROVED if maxPos also passes", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 }),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.approvedQuantity, 10);
  assert.equal(decision.requestedQuantity, 10);
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.evaluatedNotional, 500000);
  assert.equal(decision.riskReferencePrice, 50000);
  assert.equal(decision.intentId, "intent-1");
  assert.equal(decision.riskDecisionId, "risk-1");
});

test("I02 maxOrder 500000 exact APPROVED", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: Number.MAX_SAFE_INTEGER }),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.evaluatedNotional, 500000);
  assert.deepEqual(decision.reasonCodes, []);
});

test("I03 maxOrder 499999 REJECT ORDER_NOTIONAL", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: 499999, maxPositionNotional: Number.MAX_SAFE_INTEGER }),
  });
  assert.equal(decision.approved, false);
  assert.equal(decision.approvedQuantity, 0);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED), true);
  assert.equal(decision.reasonCodes.indexOf(ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED) !== -1, true);
});

test("I04 held 10 BUY 5 @ 40000 projected 600000 maxPos 600000 APPROVED", () => {
  const intent = makeIntent({ quantity: 5 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
    riskReferencePrice: 40000,
    riskConfig: makeConfig({ maxOrderNotional: Number.MAX_SAFE_INTEGER, maxPositionNotional: 600000 }),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.evaluatedNotional, 200000);
  assert.deepEqual(decision.reasonCodes, []);
});

test("I05 held 10 BUY 5 @ 40000 projected 600000 maxPos 599999 REJECT POSITION", () => {
  const intent = makeIntent({ quantity: 5 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
    riskReferencePrice: 40000,
    riskConfig: makeConfig({ maxOrderNotional: Number.MAX_SAFE_INTEGER, maxPositionNotional: 599999 }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_POSITION_NOTIONAL_EXCEEDED), true);
});

test("I06 cash == requiredCash APPROVED", () => {
  const state = emptyState();
  state.cash = 500050;
  const decision = evalRisk({
    accountState: state,
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 }),
  });
  assert.equal(decision.approved, true);
  assert.deepEqual(decision.reasonCodes, []);
});

test("I07 cash short REJECT INSUFFICIENT_CASH", () => {
  const state = emptyState();
  state.cash = 500049;
  const decision = evalRisk({
    accountState: state,
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INSUFFICIENT_CASH), true);
});

test("I08 commission tips over REJECT INSUFFICIENT_CASH", () => {
  const state = emptyState();
  state.cash = 500000;
  const decision = evalRisk({
    accountState: state,
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INSUFFICIENT_CASH), true);
});

test("I09 missing allowedMarkets INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: {
      maxOrderNotional: 500000,
      maxPositionNotional: 500000,
      allowedSymbols: ["AAA"],
    },
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_MARKET_NOT_ALLOWED), false);
});

test("I10 empty allowedMarkets MARKET_NOT_ALLOWED", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ allowedMarkets: [] }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_MARKET_NOT_ALLOWED), true);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), false);
});

test("I11 empty allowedSymbols SYMBOL_NOT_ALLOWED", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ allowedSymbols: [] }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_SYMBOL_NOT_ALLOWED), true);
});

test("I12 missing allowedSymbols INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: {
      maxOrderNotional: 500000,
      maxPositionNotional: 500000,
      allowedMarkets: [MARKET.SYNTHETIC_KOSPI],
    },
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I13 maxOrder=0 reject positive BUY ORDER_NOTIONAL", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: 0, maxPositionNotional: Number.MAX_SAFE_INTEGER }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED), true);
});

test("I14 maxPos=0 reject positive BUY POSITION_NOTIONAL", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: Number.MAX_SAFE_INTEGER, maxPositionNotional: 0 }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_POSITION_NOTIONAL_EXCEEDED), true);
});

test("I15 zero caps allow reducing SELL", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 4 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
    riskConfig: makeConfig({ maxOrderNotional: 0, maxPositionNotional: 0 }),
  });
  assert.equal(decision.approved, true);
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.approvedQuantity, 4);
});

test("I16 negative config INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: -1 }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I17 NaN config INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: Number.NaN }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I18 Inf config INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxPositionNotional: Number.POSITIVE_INFINITY }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I19 string config INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: "500000" }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I20 boxed Number config INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: Object(500000) }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I21 qty 0 INVALID_INPUT", () => {
  const decision = evalRisk({ intent: makeIntent({ quantity: 0 }) });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED), false);
});

test("I22 qty negative INVALID_INPUT", () => {
  const decision = evalRisk({ intent: makeIntent({ quantity: -1 }) });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true);
});

test("I23 qty unsafe INVALID_INPUT", () => {
  const decision = evalRisk({ intent: makeIntent({ quantity: 2 ** 53 }) });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true);
});

test("I24 qty fractional string boxed INVALID_INPUT", () => {
  const cases = [1.5, "10", Object(10), Number.NaN, Number.POSITIVE_INFINITY];
  for (const quantity of cases) {
    const decision = evalRisk({ intent: makeIntent({ quantity }) });
    assert.equal(decision.approved, false, String(quantity));
    assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true, String(quantity));
  }
});

test("I25 overflow NONFINITE; cost helper fail NONFINITE", () => {
  const overflow = evalRisk({
    intent: makeIntent({ quantity: Number.MAX_SAFE_INTEGER }),
    riskReferencePrice: 2,
  });
  assert.equal(overflow.approved, false);
  assert.equal(hasReason(overflow, ERROR.PAPER_RISK_NONFINITE_CALCULATION), true);

  const costFail = evalRisk({
    costContext: {
      policies: [],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      tradingDate: "2101-06-01",
    },
  });
  assert.equal(costFail.approved, false);
  assert.equal(hasReason(costFail, ERROR.PAPER_RISK_NONFINITE_CALCULATION), true);
});

test("I26 price NaN INVALID_INPUT", () => {
  const decision = evalRisk({ riskReferencePrice: Number.NaN });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true);
});

test("I27 price Inf INVALID_INPUT", () => {
  const decision = evalRisk({ riskReferencePrice: Number.POSITIVE_INFINITY });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true);
});

test("I28 price <=0 INVALID_INPUT", () => {
  for (const price of [0, -1]) {
    const decision = evalRisk({ riskReferencePrice: price });
    assert.equal(decision.approved, false, String(price));
    assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true, String(price));
  }
});

test("I29 price string boxed INVALID_INPUT", () => {
  for (const price of ["50000", Object(50000)]) {
    const decision = evalRisk({ riskReferencePrice: price });
    assert.equal(decision.approved, false, String(price));
    assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_INPUT), true, String(price));
  }
});

test("I30 SELL <= held APPROVED", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 10 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.approvedQuantity, 10);
  assert.deepEqual(decision.reasonCodes, []);
});

test("I31 SELL > held REJECT INSUFFICIENT_POSITION", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 11 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INSUFFICIENT_POSITION), true);
});

test("I32 SELL 100 @ 100000 maxOrder 5e6 position notional 10e6 APPROVED exempt", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 100 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(100, 1, 1),
    riskReferencePrice: 100000,
    riskConfig: makeConfig({ maxOrderNotional: 5_000_000, maxPositionNotional: 10_000_000 }),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.evaluatedNotional, 10_000_000);
  assert.deepEqual(decision.reasonCodes, []);
});

test("I33 existing position above maxPosition can SELL reduce", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 3 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
    riskReferencePrice: 50000,
    riskConfig: makeConfig({ maxOrderNotional: 1, maxPositionNotional: 1 }),
  });
  assert.equal(decision.approved, true);
  assert.deepEqual(decision.reasonCodes, []);
});

test("I34 no mutation of config/state/intent", () => {
  const state = emptyState();
  const intent = makeIntent();
  const config = makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 });
  const costContext = makeCostContext();
  const snaps = {
    state: JSON.stringify(state),
    intent: JSON.stringify(intent),
    config: JSON.stringify(config),
    cost: JSON.stringify(costContext),
  };
  const frozenState = jsonClone(state);
  const frozenIntent = jsonClone(intent);
  const frozenConfig = jsonClone(config);
  const decision = evaluatePaperRisk({
    accountState: state,
    intent,
    riskReferencePrice: 50000,
    riskConfig: config,
    costContext,
    riskDecisionId: "risk-1",
    validAfterEventSequence: 10,
  });
  assert.equal(decision.approved, true);
  assert.equal(JSON.stringify(state), snaps.state);
  assert.equal(JSON.stringify(intent), snaps.intent);
  assert.equal(JSON.stringify(config), snaps.config);
  assert.equal(JSON.stringify(costContext), snaps.cost);
  assert.deepEqual(state, frozenState);
  assert.deepEqual(intent, frozenIntent);
  assert.deepEqual(config, frozenConfig);
  assert.notEqual(decision.reasonCodes, config.allowedMarkets);
  assert.notEqual(decision.reasonCodes, config.allowedSymbols);
});

test("I35 determinism same input same decision", () => {
  const input = {
    accountState: emptyState(),
    intent: makeIntent(),
    riskReferencePrice: 50000,
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 }),
    costContext: makeCostContext(),
    riskDecisionId: "risk-1",
    validAfterEventSequence: 10,
  };
  const a = evaluatePaperRisk(input);
  const b = evaluatePaperRisk(input);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.notEqual(a.reasonCodes, b.reasonCodes);
});

test("I36 unknown key allowEverything REJECT INVALID_CONFIG", () => {
  const config = makeConfig();
  config.allowEverything = true;
  const decision = evalRisk({ riskConfig: config });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED), false);
});

test("I37 allowedSymbols __proto__ indexOf safe", () => {
  const intent = makeIntent({ symbol: "__proto__" });
  const decision = evalRisk({
    intent,
    riskConfig: makeConfig({ allowedSymbols: ["__proto__"] }),
  });
  assert.equal(decision.approved, true);
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.intentId, "intent-1");
});

test("I38 inherited prototype not a position", () => {
  const intent = makeIntent({ side: SIDE.SELL, symbol: "constructor", quantity: 1 });
  const state = emptyState();
  assert.equal(Object.prototype.hasOwnProperty.call(state.positions, "constructor"), false);
  const decision = evalRisk({
    intent,
    accountState: state,
    riskConfig: makeConfig({ allowedSymbols: ["constructor"] }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INSUFFICIENT_POSITION), true);
});

test("I39 malformed account fail-closed no throw", () => {
  assert.doesNotThrow(() => evaluatePaperRisk(null));
  assert.doesNotThrow(() => evaluatePaperRisk(undefined));
  assert.doesNotThrow(() => evaluatePaperRisk("bad"));
  const malformed = evalRisk({ accountState: { cash: "nope" } });
  assert.equal(malformed.approved, false);
  assert.equal(hasReason(malformed, ERROR.PAPER_RISK_INVALID_INPUT), true);
  const none = evaluatePaperRisk(null);
  assert.equal(none.approved, false);
  assert.equal(hasReason(none, ERROR.PAPER_RISK_INVALID_INPUT), true);
});

test("I40 missing maxOrderNotional INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: {
      maxPositionNotional: 500000,
      allowedMarkets: [MARKET.SYNTHETIC_KOSPI],
      allowedSymbols: ["AAA"],
    },
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I41 missing maxPositionNotional INVALID_CONFIG", () => {
  const decision = evalRisk({
    riskConfig: {
      maxOrderNotional: 500000,
      allowedMarkets: [MARKET.SYNTHETIC_KOSPI],
      allowedSymbols: ["AAA"],
    },
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_INVALID_CONFIG), true);
});

test("I42 MARKET_NOT_ALLOWED other market", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ allowedMarkets: [MARKET.SYNTHETIC_KOSDAQ] }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_MARKET_NOT_ALLOWED), true);
});

test("I43 SYMBOL_NOT_ALLOWED other symbol", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ allowedSymbols: ["BBB"] }),
  });
  assert.equal(decision.approved, false);
  assert.equal(hasReason(decision, ERROR.PAPER_RISK_SYMBOL_NOT_ALLOWED), true);
});

test("I44 collect both MARKET and SYMBOL not allowed in order", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({
      allowedMarkets: [MARKET.SYNTHETIC_KOSDAQ],
      allowedSymbols: ["BBB"],
    }),
  });
  assert.equal(decision.approved, false);
  assert.deepEqual(decision.reasonCodes, [
    ERROR.PAPER_RISK_MARKET_NOT_ALLOWED,
    ERROR.PAPER_RISK_SYMBOL_NOT_ALLOWED,
  ]);
});

test("I45 BUY order and position both exceeded unique stable order", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: 1, maxPositionNotional: 1 }),
  });
  assert.equal(decision.approved, false);
  const codes = decision.reasonCodes;
  const orderIdx = codes.indexOf(ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED);
  const posIdx = codes.indexOf(ERROR.PAPER_RISK_POSITION_NOTIONAL_EXCEEDED);
  assert.equal(orderIdx !== -1, true);
  assert.equal(posIdx !== -1, true);
  assert.equal(orderIdx < posIdx, true);
  assert.equal(codes.filter((c) => c === ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED).length, 1);
});

test("I46 validatePaperRiskConfig extra key and 0 is not missing", () => {
  const extra = validatePaperRiskConfig({
    maxOrderNotional: 0,
    maxPositionNotional: 0,
    allowedMarkets: [],
    allowedSymbols: [],
    allowEverything: true,
  });
  assert.equal(extra.ok, false);
  const zeroOk = validatePaperRiskConfig({
    maxOrderNotional: 0,
    maxPositionNotional: 0,
    allowedMarkets: [],
    allowedSymbols: [],
  });
  assert.equal(zeroOk.ok, true);
  const missing = validatePaperRiskConfig({
    maxOrderNotional: 0,
    maxPositionNotional: 0,
    allowedMarkets: [],
  });
  assert.equal(missing.ok, false);
});

test("I47 approvedQuantity equals qty and reasonCodes empty on approve", () => {
  const decision = evalRisk({
    riskConfig: makeConfig({ maxOrderNotional: 500000, maxPositionNotional: 500000 }),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.approvedQuantity, 10);
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(Array.isArray(decision.reasonCodes), true);
  assert.equal(decision.validAfterEventSequence, 10);
});

test("I48 full exit SELL with zero caps not trapped", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 10 });
  const decision = evalRisk({
    intent,
    accountState: stateWithPosition(10, 500050, 499950),
    riskConfig: makeConfig({ maxOrderNotional: 0, maxPositionNotional: 0 }),
  });
  assert.equal(decision.approved, true);
  assert.equal(decision.approvedQuantity, 10);
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.evaluatedNotional, 500000);
});
