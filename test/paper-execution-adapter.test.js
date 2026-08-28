"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PAPER_MODE,
  PAPER_STATUS,
  SIDE,
  ORDER_TYPE,
  ERROR,
} = require("../lib/paper/paper-result");
const {
  createPaperAccountState,
} = require("../lib/paper/paper-account-state");
const { executePaper } = require("../lib/paper/paper-execution-adapter");
const { evaluatePaperRisk } = require("../lib/paper/paper-risk-engine");
const executionModel = require("../lib/backtest/execution-model");
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

function deepFreezeSnapshot(value) {
  return jsonClone(value);
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

function makeEvent(overrides) {
  return {
    eventId: "evt-11",
    market: MARKET.SYNTHETIC_KOSPI,
    symbol: "AAA",
    tradingDate: "2101-06-01",
    sequence: 11,
    open: 50000,
    ...(overrides || {}),
  };
}

function makeRisk(intent, overrides) {
  const i = intent || makeIntent();
  return {
    riskDecisionId: "risk-1",
    intentId: i.intentId,
    approved: true,
    requestedQuantity: i.quantity,
    approvedQuantity: i.quantity,
    validAfterEventSequence: 10,
    ...(overrides || {}),
  };
}

function makeApproval(intent, risk, overrides) {
  const i = intent || makeIntent();
  const r = risk || makeRisk(i);
  return {
    approvalId: "appr-1",
    intentId: i.intentId,
    riskDecisionId: r.riskDecisionId,
    approved: true,
    approvedQuantity: i.quantity,
    validAfterEventSequence: 10,
    ...(overrides || {}),
  };
}

function makePermissiveRiskConfig(intent) {
  const i = intent || makeIntent();
  return {
    maxOrderNotional: Number.MAX_SAFE_INTEGER,
    maxPositionNotional: Number.MAX_SAFE_INTEGER,
    allowedMarkets: [i.market],
    allowedSymbols: [i.symbol],
  };
}

function makeInput(overrides) {
  const extra = overrides || {};
  const intent = extra.orderIntent !== undefined ? extra.orderIntent : makeIntent();
  const event = extra.marketEvent !== undefined ? extra.marketEvent : makeEvent();
  const risk = extra.riskDecision !== undefined ? extra.riskDecision : makeRisk(intent);
  const approval = extra.userApproval !== undefined ? extra.userApproval : makeApproval(intent, risk);
  const base = {
    accountState: extra.accountState || emptyState(),
    marketEvent: event,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    paperExecutionEnabled: true,
    executionId: "PAPER-exec-1",
    costContext: extra.costContext || {
      policies: [makePolicy()],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
    riskConfig: makePermissiveRiskConfig(intent),
  };
  return { ...base, ...extra, orderIntent: intent, marketEvent: event, riskDecision: risk, userApproval: approval };
}

function ledgerFields(state) {
  return {
    cash: state.cash,
    positions: jsonClone(state.positions),
    executedIntentIds: jsonClone(state.executedIntentIds),
    closedTrades: jsonClone(state.closedTrades),
    realizedPnl: state.realizedPnl,
  };
}

function paperSources() {
  const root = path.join(__dirname, "..", "lib", "paper");
  return [
    "paper-result.js",
    "paper-account-state.js",
    "paper-ledger-stepper.js",
    "paper-execution-adapter.js",
    "paper-risk-engine.js",
  ].map((name) => ({
    name,
    src: fs.readFileSync(path.join(root, name), "utf8"),
  }));
}

function buyFill() {
  return executePaper(makeInput());
}

test("C03 adapter BUY fill numbers", () => {
  const result = buyFill();
  assert.equal(result.ok, true);
  assert.equal(result.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(result.accountState.cash, 499950);
  assert.equal(result.accountState.positions.AAA.quantity, 10);
  assert.equal(result.accountState.positions.AAA.costBasis, 500050);
  const comm = calculateCommission({
    amount: 500000,
    ratePpm: 100,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(comm.amount, 50);
  assert.equal(result.executionRecord.cost.commission, comm.amount);
});

test("C04 adapter open position survives; result has no OPEN_POSITION_AT_END", () => {
  const result = buyFill();
  assert.equal(result.ok, true);
  assert.equal(result.accountState.positions.AAA.quantity > 0, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "OPEN_POSITION_AT_END"), false);
  assert.equal(JSON.stringify(result).includes("OPEN_POSITION_AT_END"), false);
});

function chainBuy() {
  const first = buyFill();
  const intent = makeIntent({ intentId: "intent-2", quantity: 5, signalSequence: 11 });
  const event = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const risk = makeRisk(intent, { riskDecisionId: "risk-2", validAfterEventSequence: 11 });
  const approval = makeApproval(intent, risk, { approvalId: "appr-2", validAfterEventSequence: 11 });
  return executePaper(makeInput({
    accountState: first.accountState,
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
    executionId: "PAPER-exec-2",
  }));
}

test("C05 adapter second BUY", () => {
  const result = chainBuy();
  assert.equal(result.ok, true);
  assert.equal(result.accountState.cash, 299930);
  assert.equal(result.accountState.positions.AAA.quantity, 15);
  assert.equal(result.accountState.positions.AAA.costBasis, 700070);
});

function chainPartialSell() {
  const bought = chainBuy();
  const intent = makeIntent({
    intentId: "intent-3",
    quantity: 4,
    side: SIDE.SELL,
    signalSequence: 12,
  });
  const event = makeEvent({ eventId: "evt-13", sequence: 13, open: 60000 });
  const risk = makeRisk(intent, { riskDecisionId: "risk-3", validAfterEventSequence: 12 });
  const approval = makeApproval(intent, risk, { approvalId: "appr-3", validAfterEventSequence: 12 });
  return executePaper(makeInput({
    accountState: bought.accountState,
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
    executionId: "PAPER-exec-3",
  }));
}

test("C06 C07 adapter partial SELL numbers and remaining position", () => {
  const result = chainPartialSell();
  assert.equal(result.ok, true);
  assert.equal(result.accountState.positions.AAA.quantity, 11);
  assert.equal(result.accountState.positions.AAA.costBasis, 513385);
  assert.equal(result.accountState.cash, 539666);
  assert.equal(result.accountState.realizedPnl, 53051);
  const comm = calculateCommission({
    amount: 240000,
    ratePpm: 100,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  const tax = calculateSellTaxes({
    amount: 240000,
    sellTaxes: makePolicy().sellTaxes,
  });
  assert.equal(result.executionRecord.cost.commission, comm.amount);
  assert.equal(result.executionRecord.cost.tax, tax.total);
});

test("C08 C09 C10 adapter full SELL closes book", () => {
  const partial = chainPartialSell();
  const intent = makeIntent({
    intentId: "intent-4",
    quantity: 11,
    side: SIDE.SELL,
    signalSequence: 13,
  });
  const event = makeEvent({ eventId: "evt-14", sequence: 14, open: 55000 });
  const risk = makeRisk(intent, { riskDecisionId: "risk-4", validAfterEventSequence: 13 });
  const approval = makeApproval(intent, risk, { approvalId: "appr-4", validAfterEventSequence: 13 });
  const result = executePaper(makeInput({
    accountState: partial.accountState,
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
    executionId: "PAPER-exec-4",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.accountState.positions.AAA, undefined);
  assert.deepEqual(result.accountState.positions, {});
  assert.equal(result.accountState.cash, 1144001);
  assert.equal(result.accountState.realizedPnl, 144001);
});

test("C11 insufficient cash consumes event, ledger unchanged except cursor", () => {
  const intent = makeIntent({ quantity: 100 });
  const input = makeInput({ orderIntent: intent, riskDecision: makeRisk(intent), userApproval: makeApproval(intent, makeRisk(intent)) });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(result.executionRecord, null);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_INSUFFICIENT_CASH), true);
  const fields = ledgerFields(result.accountState);
  const orig = ledgerFields(before);
  assert.deepEqual(fields, orig);
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.accountState.lastProcessedEventId, "evt-11");
});

test("C12 insufficient position consumes event, ledger unchanged except cursor", () => {
  const intent = makeIntent({ side: SIDE.SELL, quantity: 1 });
  const risk = makeRisk(intent);
  const input = makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: makeApproval(intent, risk),
  });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_INSUFFICIENT_POSITION), true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.executionRecord, null);
});

function assertQuantityBlocked(quantity, code) {
  const state = emptyState();
  const snap = jsonClone(state);
  const intent = makeIntent({ quantity });
  const result = executePaper(makeInput({
    accountState: state,
    orderIntent: intent,
    riskDecision: makeRisk(intent),
    userApproval: makeApproval(intent, makeRisk(intent)),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, code), true);
  assert.deepEqual(jsonClone(state), snap);
  assert.equal(result.accountState.lastProcessedSequence, null);
}

test("C13 quantity 0 blocked PAPER_ZERO_QUANTITY, no mutate", () => {
  assertQuantityBlocked(0, ERROR.PAPER_ZERO_QUANTITY);
});

test("C14 quantity negative blocked PAPER_ZERO_QUANTITY, no mutate", () => {
  assertQuantityBlocked(-1, ERROR.PAPER_ZERO_QUANTITY);
});

test("C15 quantity NaN blocked PAPER_INVALID_INPUT, no mutate", () => {
  assertQuantityBlocked(Number.NaN, ERROR.PAPER_INVALID_INPUT);
});

test("C16 quantity Infinity blocked PAPER_INVALID_INPUT, no mutate", () => {
  assertQuantityBlocked(Number.POSITIVE_INFINITY, ERROR.PAPER_INVALID_INPUT);
});

test("C17 quantity string blocked PAPER_INVALID_INPUT, no mutate", () => {
  assertQuantityBlocked("10", ERROR.PAPER_INVALID_INPUT);
});

test("C18 quantity boxed Number blocked PAPER_INVALID_INPUT, no mutate", () => {
  assertQuantityBlocked(Object(10), ERROR.PAPER_INVALID_INPUT);
});

test("C19 risk missing PAPER_INVALID_INPUT consume", () => {
  const input = makeInput({ riskDecision: null });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C20 risk approved false PAPER_RISK_REJECTED consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent, { approved: false });
  const input = makeInput({ orderIntent: intent, riskDecision: risk, userApproval: makeApproval(intent, risk) });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_REJECTED), true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C21 risk intentId mismatch PAPER_RISK_MISMATCH consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent, { intentId: "other-intent" });
  const input = makeInput({ orderIntent: intent, riskDecision: risk, userApproval: makeApproval(intent, risk) });
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C22 risk quantity mismatch PAPER_RISK_MISMATCH consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent, { approvedQuantity: 9, requestedQuantity: 9 });
  const input = makeInput({ orderIntent: intent, riskDecision: risk, userApproval: makeApproval(intent, risk) });
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C23 approval missing PAPER_APPROVAL_REQUIRED consume", () => {
  const input = makeInput({ userApproval: null });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_APPROVAL_REQUIRED), true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C24 approval approved false PAPER_APPROVAL_REQUIRED consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk, { approved: false });
  const result = executePaper(makeInput({ orderIntent: intent, riskDecision: risk, userApproval: approval }));
  assert.equal(hasCode(result, ERROR.PAPER_APPROVAL_REQUIRED), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C25 approval intentId mismatch PAPER_APPROVAL_MISMATCH consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk, { intentId: "other-intent" });
  const result = executePaper(makeInput({ orderIntent: intent, riskDecision: risk, userApproval: approval }));
  assert.equal(hasCode(result, ERROR.PAPER_APPROVAL_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C26 approval riskDecisionId mismatch PAPER_APPROVAL_MISMATCH consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk, { riskDecisionId: "risk-other" });
  const result = executePaper(makeInput({ orderIntent: intent, riskDecision: risk, userApproval: approval }));
  assert.equal(hasCode(result, ERROR.PAPER_APPROVAL_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C27 approval quantity mismatch PAPER_APPROVAL_MISMATCH consume", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk, { approvedQuantity: 9 });
  const result = executePaper(makeInput({ orderIntent: intent, riskDecision: risk, userApproval: approval }));
  assert.equal(hasCode(result, ERROR.PAPER_APPROVAL_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C28 kill false BLOCKED PAPER_KILL_SWITCH consume, no fill", () => {
  const input = makeInput({ paperExecutionEnabled: false });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_KILL_SWITCH), true);
  assert.equal(result.executionRecord, null);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C28 liveEnabled true with paperExecutionEnabled false still BLOCKED", () => {
  const input = makeInput({ paperExecutionEnabled: false });
  input.liveEnabled = true;
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_KILL_SWITCH), true);
});

test("C29 S=E=11 blocked SAME_EVENT", () => {
  const intent = makeIntent({ signalSequence: 11 });
  const risk = makeRisk(intent, { validAfterEventSequence: 10 });
  const approval = makeApproval(intent, risk, { validAfterEventSequence: 10 });
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: makeEvent({ sequence: 11 }),
  }));
  assert.equal(hasCode(result, ERROR.PAPER_SAME_EVENT_EXECUTION), true);
  assert.equal(result.ok, false);
});

test("C30 A=E blocked SAME_EVENT", () => {
  const intent = makeIntent({ signalSequence: 10 });
  const risk = makeRisk(intent, { validAfterEventSequence: 10 });
  const approval = makeApproval(intent, risk, { validAfterEventSequence: 11 });
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: makeEvent({ sequence: 11 }),
  }));
  assert.equal(hasCode(result, ERROR.PAPER_SAME_EVENT_EXECUTION), true);
});

test("C31 R=E blocked SAME_EVENT", () => {
  const intent = makeIntent({ signalSequence: 10 });
  const risk = makeRisk(intent, { validAfterEventSequence: 11 });
  const approval = makeApproval(intent, risk, { validAfterEventSequence: 10 });
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: makeEvent({ sequence: 11 }),
  }));
  assert.equal(hasCode(result, ERROR.PAPER_SAME_EVENT_EXECUTION), true);
});

test("C32 next event 11 after signal 10 fills", () => {
  const result = buyFill();
  assert.equal(result.ok, true);
  assert.equal(result.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(result.executionRecord.sequence, 11);
  assert.equal(result.accountState.executedIntentIds["intent-1"], "PAPER-exec-1");
});

test("C33 replay same event 11 after fill is DUPLICATE_EVENT, cash unchanged", () => {
  const filled = buyFill();
  const cash = filled.accountState.cash;
  const result = executePaper(makeInput({
    accountState: filled.accountState,
    executionId: "PAPER-exec-replay",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_DUPLICATE_EVENT), true);
  assert.equal(result.accountState.cash, cash);
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.executionRecord, null);
});

test("C34 same intentId later event 12 INTENT_ALREADY_EXECUTED, no second fill", () => {
  const filled = buyFill();
  const cash = filled.accountState.cash;
  const event = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const result = executePaper(makeInput({
    accountState: filled.accountState,
    marketEvent: event,
    executionId: "PAPER-exec-2",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INTENT_ALREADY_EXECUTED), true);
  assert.equal(result.accountState.cash, cash);
  assert.equal(result.accountState.lastProcessedSequence, 12);
  assert.equal(result.accountState.executedIntentIds["intent-1"], "PAPER-exec-1");
});

test("C35 last 12, incoming 11 OUT_OF_ORDER, no consume change", () => {
  const filled = buyFill();
  const intent2 = makeIntent({ intentId: "intent-2", quantity: 5, signalSequence: 11 });
  const event2 = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const risk2 = makeRisk(intent2, { riskDecisionId: "risk-2", validAfterEventSequence: 11 });
  const approval2 = makeApproval(intent2, risk2, { approvalId: "appr-2", validAfterEventSequence: 11 });
  const second = executePaper(makeInput({
    accountState: filled.accountState,
    orderIntent: intent2,
    marketEvent: event2,
    riskDecision: risk2,
    userApproval: approval2,
    executionId: "PAPER-exec-2",
  }));
  assert.equal(second.ok, true);
  const replay = executePaper(makeInput({
    accountState: second.accountState,
    marketEvent: makeEvent({ eventId: "evt-11", sequence: 11, open: 50000 }),
    orderIntent: makeIntent({ intentId: "intent-3" }),
  }));
  assert.equal(hasCode(replay, ERROR.PAPER_OUT_OF_ORDER_EVENT), true);
  assert.equal(replay.accountState.lastProcessedSequence, 12);
  assert.equal(replay.accountState.cash, second.accountState.cash);
});

test("C36 symbol mismatch no consume", () => {
  const input = makeInput({
    marketEvent: makeEvent({ symbol: "BBB" }),
  });
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_SYMBOL_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, null);
});

test("C37 market mismatch no consume", () => {
  const input = makeInput({
    marketEvent: makeEvent({ market: MARKET.SYNTHETIC_KOSDAQ }),
  });
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_MARKET_MISMATCH), true);
  assert.equal(result.accountState.lastProcessedSequence, null);
});

test("C38 open NaN/0/-1/string blocked, no consume", () => {
  const cases = [Number.NaN, 0, -1, "50"];
  for (const open of cases) {
    const result = executePaper(makeInput({ marketEvent: makeEvent({ open }) }));
    assert.equal(result.ok, false, String(open));
    assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true, String(open));
    assert.equal(result.accountState.lastProcessedSequence, null, String(open));
    const fieldErr = result.errors.find((e) => e.field === "open");
    assert.equal(fieldErr != null, true, String(open));
  }
});

test("C39 cost fail policies [] BLOCKED PAPER_COST_FAILED consume", () => {
  const input = makeInput({
    costContext: {
      policies: [],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
  });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_NONFINITE_CALCULATION), true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C40-C44 JSON snapshot of inputs equal after success", () => {
  const input = makeInput();
  const snaps = {
    accountState: JSON.stringify(input.accountState),
    orderIntent: JSON.stringify(input.orderIntent),
    riskDecision: JSON.stringify(input.riskDecision),
    userApproval: JSON.stringify(input.userApproval),
    marketEvent: JSON.stringify(input.marketEvent),
  };
  const frozen = {
    accountState: deepFreezeSnapshot(input.accountState),
    orderIntent: deepFreezeSnapshot(input.orderIntent),
    riskDecision: deepFreezeSnapshot(input.riskDecision),
    userApproval: deepFreezeSnapshot(input.userApproval),
    marketEvent: deepFreezeSnapshot(input.marketEvent),
  };
  const result = executePaper(input);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(input.accountState), snaps.accountState);
  assert.equal(JSON.stringify(input.orderIntent), snaps.orderIntent);
  assert.equal(JSON.stringify(input.riskDecision), snaps.riskDecision);
  assert.equal(JSON.stringify(input.userApproval), snaps.userApproval);
  assert.equal(JSON.stringify(input.marketEvent), snaps.marketEvent);
  assert.deepEqual(jsonClone(input.accountState), frozen.accountState);
  assert.deepEqual(jsonClone(input.orderIntent), frozen.orderIntent);
});

test("C40-C44 JSON snapshot of inputs equal after failure", () => {
  const input = makeInput({ paperExecutionEnabled: false });
  const snaps = {
    accountState: JSON.stringify(input.accountState),
    orderIntent: JSON.stringify(input.orderIntent),
    riskDecision: JSON.stringify(input.riskDecision),
    userApproval: JSON.stringify(input.userApproval),
    marketEvent: JSON.stringify(input.marketEvent),
  };
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(input.accountState), snaps.accountState);
  assert.equal(JSON.stringify(input.orderIntent), snaps.orderIntent);
  assert.equal(JSON.stringify(input.riskDecision), snaps.riskDecision);
  assert.equal(JSON.stringify(input.userApproval), snaps.userApproval);
  assert.equal(JSON.stringify(input.marketEvent), snaps.marketEvent);
});

test("C45 record.mode PAPER", () => {
  const result = buyFill();
  assert.equal(result.executionRecord.mode, PAPER_MODE.PAPER);
  assert.equal(result.executionRecord.mode, "PAPER");
});

test("C46 record has no brokerOrderId/orderNo/kb order strings", () => {
  const result = buyFill();
  const record = result.executionRecord;
  assert.equal(record.brokerOrderId, undefined);
  assert.equal(record.orderNo, undefined);
  assert.equal(record.accountId, undefined);
  const text = JSON.stringify(record);
  assert.equal(text.includes("kb"), false);
  assert.equal(text.includes("orderNo"), false);
});

test("C47 execution-model paperEligible still false after fill; paper modules do not assign it", () => {
  const result = buyFill();
  assert.equal(result.ok, true);
  assert.equal(result.paperEligible, undefined);
  const sample = executionModel.createExecutionResult({});
  assert.equal(sample.paperEligible, false);
  for (const file of paperSources()) {
    assert.equal(/paperEligible\s*=/.test(file.src), false, file.name);
  }
});

test("C48 liveEligible false similarly", () => {
  const result = buyFill();
  assert.equal(result.ok, true);
  assert.equal(result.liveEligible, undefined);
  const sample = executionModel.createExecutionResult({});
  assert.equal(sample.liveEligible, false);
  for (const file of paperSources()) {
    assert.equal(/liveEligible\s*=/.test(file.src), false, file.name);
  }
});

test("C49 open position result ok; adapter source has no forbidden ledger strings", () => {
  const result = buyFill();
  assert.equal(result.ok, true);
  assert.equal(result.accountState.positions.AAA.quantity, 10);
  const adapter = fs.readFileSync(
    path.join(__dirname, "..", "lib", "paper", "paper-execution-adapter.js"),
    "utf8",
  );
  const stepper = fs.readFileSync(
    path.join(__dirname, "..", "lib", "paper", "paper-ledger-stepper.js"),
    "utf8",
  );
  assert.equal(adapter.includes("runPortfolioLedger"), false);
  assert.equal(adapter.includes("OPEN_POSITION_AT_END"), false);
  assert.equal(stepper.includes("runPortfolioLedger"), false);
  assert.equal(stepper.includes("OPEN_POSITION_AT_END"), false);
});

test("C50 paper production require graph has no LiveBroker or kb paths", () => {
  for (const file of paperSources()) {
    const requires = [...file.src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
    for (const req of requires) {
      assert.equal(req.includes("kb/"), false, `${file.name} ${req}`);
      assert.equal(req.includes("LiveBroker"), false, `${file.name} ${req}`);
      assert.equal(req.includes("kb"), false, `${file.name} ${req}`);
    }
  }
});

test("C51 no kb order strings in requires", () => {
  for (const file of paperSources()) {
    const requires = [...file.src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
    for (const req of requires) {
      assert.equal(/order/i.test(req) && /kb/i.test(req), false, req);
    }
  }
});

test("C67-ex-post A>=E blocked SAME_EVENT", () => {
  const intent = makeIntent({ signalSequence: 10 });
  const risk = makeRisk(intent, { validAfterEventSequence: 10 });
  const approval = makeApproval(intent, risk, { validAfterEventSequence: 11 });
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: makeEvent({ sequence: 11, eventId: "evt-11" }),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_SAME_EVENT_EXECUTION), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
});

test("C67-ex-post after blocked attempt, event 12 fills", () => {
  const intent = makeIntent({ signalSequence: 10 });
  const risk = makeRisk(intent, { validAfterEventSequence: 10 });
  const approval = makeApproval(intent, risk, { validAfterEventSequence: 11 });
  const first = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: makeEvent({ sequence: 11, eventId: "evt-11" }),
  }));
  assert.equal(first.ok, false);
  const second = executePaper(makeInput({
    accountState: first.accountState,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: makeEvent({ sequence: 12, eventId: "evt-12", open: 50000 }),
    executionId: "PAPER-exec-12",
  }));
  assert.equal(second.ok, true);
  assert.equal(second.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(second.accountState.cash, 499950);
  assert.equal(second.accountState.lastProcessedSequence, 12);
});

test("serializability JSON.stringify filled.accountState then parse deep equal, no bigint", () => {
  const result = buyFill();
  const raw = JSON.stringify(result.accountState);
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed, result.accountState);
  assert.equal(raw.includes("n,"), false);
});

test("structural dependency: paper production files have no forbidden imports", () => {
  for (const file of paperSources()) {
    const src = file.src;
    assert.equal(src.includes("/kb/"), false, file.name);
    assert.equal(src.includes("LiveBroker"), false, file.name);
    assert.equal(src.includes("node:http"), false, file.name);
    assert.equal(src.includes("node:https"), false, file.name);
    assert.equal(src.includes("node:fs"), false, file.name);
    assert.equal(src.includes("fetch("), false, file.name);
    assert.equal(src.includes("axios"), false, file.name);
    assert.equal(src.includes("net.Socket"), false, file.name);
    assert.equal(src.includes("Date.now"), false, file.name);
    assert.equal(src.includes("Math.random"), false, file.name);
  }
});

test("C69 adapter commission equals calculateCommission", () => {
  const result = buyFill();
  const expected = calculateCommission({
    amount: 500000,
    ratePpm: 100,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.executionRecord.cost.commission, expected.amount);
});

test("kill-switch not boolean is PAPER_INVALID_INPUT without consume", () => {
  const result = executePaper(makeInput({ paperExecutionEnabled: "true" }));
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
  assert.equal(result.accountState.lastProcessedSequence, null);
});

test("ERROR values equal keys", () => {
  for (const key of Object.keys(ERROR)) {
    assert.equal(ERROR[key], key);
  }
});

function runIntentTwice(intentId) {
  const intent = makeIntent({ intentId });
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk);
  const first = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    executionId: "PAPER-exec-proto-1",
  }));
  const event2 = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const second = executePaper(makeInput({
    accountState: first.accountState,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: event2,
    executionId: "PAPER-exec-proto-2",
  }));
  return { first, second, intent };
}

test("11D-R1 intentId __proto__ first FILLED own membership, second BLOCKED, prototype unchanged", () => {
  const { first, second } = runIntentTwice("__proto__");
  assert.equal(first.ok, true);
  assert.equal(first.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(Object.prototype.hasOwnProperty.call(first.accountState.executedIntentIds, "__proto__"), true);
  assert.equal(first.accountState.executedIntentIds["__proto__"], "PAPER-exec-proto-1");
  assert.equal(Object.getPrototypeOf(first.accountState.executedIntentIds), Object.prototype);
  assert.equal(Object.getPrototypeOf({}) === Object.prototype, true);
  assert.equal(second.ok, false);
  assert.equal(hasCode(second, ERROR.PAPER_INTENT_ALREADY_EXECUTED), true);
  assert.equal(second.accountState.cash, first.accountState.cash);
});

test("11D-R1 intentId constructor first FILLED, not inherited, second BLOCKED", () => {
  const empty = emptyState();
  assert.equal(Object.prototype.hasOwnProperty.call(empty.executedIntentIds, "constructor"), false);
  const { first, second } = runIntentTwice("constructor");
  assert.equal(first.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(first.accountState.executedIntentIds, "constructor"), true);
  assert.equal(second.ok, false);
  assert.equal(hasCode(second, ERROR.PAPER_INTENT_ALREADY_EXECUTED), true);
});

test("11D-R1 intentId toString first FILLED, second BLOCKED", () => {
  const { first, second } = runIntentTwice("toString");
  assert.equal(first.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(first.accountState.executedIntentIds, "toString"), true);
  assert.equal(second.ok, false);
  assert.equal(hasCode(second, ERROR.PAPER_INTENT_ALREADY_EXECUTED), true);
});

test("11D-R1 adapter symbol __proto__ BUY own position, prototype unchanged", () => {
  const intent = makeIntent({ symbol: "__proto__" });
  const event = makeEvent({ symbol: "__proto__" });
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk);
  const result = executePaper(makeInput({
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
  }));
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.accountState.positions, "__proto__"), true);
  assert.equal(result.accountState.positions["__proto__"].quantity, 10);
  assert.equal(Object.getPrototypeOf(result.accountState.positions), Object.prototype);
});

test("11D-R1 adapter symbol constructor BUY own position not inherited", () => {
  const intent = makeIntent({ symbol: "constructor" });
  const event = makeEvent({ symbol: "constructor" });
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk);
  const result = executePaper(makeInput({
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
  }));
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.accountState.positions, "constructor"), true);
  assert.equal(result.accountState.positions.constructor.quantity, 10);
});

test("11D-R1 JSON round-trip executed intent still BLOCKED as duplicate", () => {
  const filled = buyFill();
  const restored = JSON.parse(JSON.stringify(filled.accountState));
  const event = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const result = executePaper(makeInput({
    accountState: restored,
    marketEvent: event,
    executionId: "PAPER-exec-2",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INTENT_ALREADY_EXECUTED), true);
  assert.equal(result.accountState.cash, restored.cash);
});

test("11D-R1 JSON round-trip position then add BUY keeps own semantics", () => {
  const filled = buyFill();
  const restored = JSON.parse(JSON.stringify(filled.accountState));
  const intent = makeIntent({ intentId: "intent-2", quantity: 5, signalSequence: 11 });
  const event = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const risk = makeRisk(intent, { riskDecisionId: "risk-2", validAfterEventSequence: 11 });
  const approval = makeApproval(intent, risk, { approvalId: "appr-2", validAfterEventSequence: 11 });
  const result = executePaper(makeInput({
    accountState: restored,
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
    executionId: "PAPER-exec-2",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.accountState.positions.AAA.quantity, 15);
  assert.equal(result.accountState.positions.AAA.costBasis, 700070);
  assert.equal(Object.getPrototypeOf(result.accountState.positions), Object.prototype);
});

test("11D-R1 JSON round-trip unusual __proto__ keys remain own after later event block", () => {
  const { first } = runIntentTwice("__proto__");
  const restored = JSON.parse(JSON.stringify(first.accountState));
  assert.equal(Object.prototype.hasOwnProperty.call(restored.executedIntentIds, "__proto__"), true);
  const intent = makeIntent({ intentId: "__proto__" });
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk);
  const event = makeEvent({ eventId: "evt-12", sequence: 12, open: 40000 });
  const result = executePaper(makeInput({
    accountState: restored,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    marketEvent: event,
    executionId: "PAPER-exec-2",
  }));
  assert.equal(hasCode(result, ERROR.PAPER_INTENT_ALREADY_EXECUTED), true);
  assert.equal(Object.getPrototypeOf(result.accountState.executedIntentIds), Object.prototype);
});

function tightOrderConfig(maxOrderNotional, maxPositionNotional) {
  return {
    maxOrderNotional,
    maxPositionNotional,
    allowedMarkets: [MARKET.SYNTHETIC_KOSPI],
    allowedSymbols: ["AAA"],
  };
}

function engineCostContext() {
  return {
    policies: [makePolicy()],
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    tradingDate: "2101-06-01",
  };
}

test("I49 engine decision + approval + safe fill FILLED", () => {
  const intent = makeIntent();
  const riskConfig = makePermissiveRiskConfig(intent);
  const decision = evaluatePaperRisk({
    accountState: emptyState(),
    intent,
    riskReferencePrice: 50000,
    riskConfig,
    costContext: engineCostContext(),
    riskDecisionId: "risk-1",
    validAfterEventSequence: 10,
  });
  assert.equal(decision.approved, true);
  assert.deepEqual(decision.reasonCodes, []);
  const approval = makeApproval(intent, decision);
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: decision,
    userApproval: approval,
    riskConfig,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(result.accountState.cash, 499950);
  assert.equal(result.executionRecord.riskDecisionId, "risk-1");
});

test("I50 risk 50k approved, event.open 70k, maxOrder 500000 BLOCKED ORDER_NOTIONAL", () => {
  const intent = makeIntent();
  const riskConfig = tightOrderConfig(500000, Number.MAX_SAFE_INTEGER);
  const atFifty = evaluatePaperRisk({
    accountState: emptyState(),
    intent,
    riskReferencePrice: 50000,
    riskConfig,
    costContext: engineCostContext(),
    riskDecisionId: "risk-1",
    validAfterEventSequence: 10,
  });
  assert.equal(atFifty.approved, true);
  const input = makeInput({
    orderIntent: intent,
    riskDecision: makeRisk(intent),
    riskConfig,
    marketEvent: makeEvent({ open: 70000 }),
  });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(result.paperStatus, PAPER_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED), true);
  assert.equal(result.accountState.cash, before.cash);
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(Object.prototype.hasOwnProperty.call(result.accountState.executedIntentIds, intent.intentId), false);
  assert.equal(result.executionRecord, null);
});

test("I51 price gap maxPosition breach BLOCKED", () => {
  const intent = makeIntent();
  const riskConfig = tightOrderConfig(Number.MAX_SAFE_INTEGER, 500000);
  const atFifty = evaluatePaperRisk({
    accountState: emptyState(),
    intent,
    riskReferencePrice: 50000,
    riskConfig,
    costContext: engineCostContext(),
    riskDecisionId: "risk-1",
    validAfterEventSequence: 10,
  });
  assert.equal(atFifty.approved, true);
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskConfig,
    marketEvent: makeEvent({ open: 70000 }),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_POSITION_NOTIONAL_EXCEEDED), true);
  assert.equal(result.accountState.cash, 1_000_000);
  assert.equal(result.executionRecord, null);
});

test("I52 price gap + commission cash breach BLOCKED", () => {
  const intent = makeIntent();
  const state = emptyState();
  state.cash = 700000;
  const riskConfig = tightOrderConfig(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const result = executePaper(makeInput({
    accountState: state,
    orderIntent: intent,
    riskConfig,
    marketEvent: makeEvent({ open: 70000 }),
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_INSUFFICIENT_CASH), true);
  assert.equal(result.accountState.cash, 700000);
  assert.equal(result.executionRecord, null);
});

test("I53 forged approved:true cannot fill past limits", () => {
  const intent = makeIntent();
  const forged = makeRisk(intent, { approved: true, requestedQuantity: 10, approvedQuantity: 10 });
  const riskConfig = tightOrderConfig(500000, 500000);
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskDecision: forged,
    userApproval: makeApproval(intent, forged),
    riskConfig,
    marketEvent: makeEvent({ open: 70000 }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.paperStatus, PAPER_STATUS.BLOCKED);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED), true);
  assert.equal(result.executionRecord, null);
  assert.equal(result.accountState.cash, 1_000_000);
});

test("I54 recheck fail cash unchanged", () => {
  const intent = makeIntent();
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskConfig: tightOrderConfig(500000, Number.MAX_SAFE_INTEGER),
    marketEvent: makeEvent({ open: 70000 }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.accountState.cash, 1_000_000);
  assert.deepEqual(result.accountState.positions, {});
});

test("I55 recheck fail cursor advances to event.sequence", () => {
  const event = makeEvent({ open: 70000, sequence: 11, eventId: "evt-11" });
  const result = executePaper(makeInput({
    riskConfig: tightOrderConfig(500000, Number.MAX_SAFE_INTEGER),
    marketEvent: event,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.accountState.lastProcessedSequence, event.sequence);
  assert.equal(result.accountState.lastProcessedEventId, event.eventId);
});

test("I56 recheck fail intent not in executedIntentIds", () => {
  const intent = makeIntent({ intentId: "intent-1" });
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskConfig: tightOrderConfig(500000, Number.MAX_SAFE_INTEGER),
    marketEvent: makeEvent({ open: 70000 }),
  }));
  assert.equal(result.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.accountState.executedIntentIds, "intent-1"), false);
  assert.deepEqual(result.accountState.executedIntentIds, {});
});

test("I57 recheck fail no FILLED executionRecord null", () => {
  const result = executePaper(makeInput({
    riskConfig: tightOrderConfig(500000, Number.MAX_SAFE_INTEGER),
    marketEvent: makeEvent({ open: 70000 }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.paperStatus, PAPER_STATUS.BLOCKED);
  assert.equal(result.executionRecord, null);
  assert.equal(result.paperStatus === PAPER_STATUS.FILLED, false);
});

test("I58 SELL full exit allowed despite caps at event.open", () => {
  const state = emptyState();
  state.cash = 499950;
  state.positions = { AAA: { symbol: "AAA", quantity: 10, costBasis: 500050 } };
  const intent = makeIntent({ side: SIDE.SELL, quantity: 10, intentId: "intent-sell-exit" });
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk);
  const result = executePaper(makeInput({
    accountState: state,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    executionId: "PAPER-exec-sell",
    riskConfig: tightOrderConfig(0, 0),
    marketEvent: makeEvent({ open: 90000 }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(result.accountState.positions.AAA, undefined);
  assert.deepEqual(result.accountState.positions, {});
});

test("I59 missing riskConfig BLOCKED", () => {
  const input = makeInput({ riskConfig: undefined });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_INVALID_CONFIG), true);
  const fieldErr = result.errors.find((e) => e.field === "riskConfig");
  assert.equal(fieldErr != null, true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.executionRecord, null);
});

test("I60 invalid riskConfig BLOCKED", () => {
  const input = makeInput({
    riskConfig: { allowEverything: true },
  });
  const before = jsonClone(input.accountState);
  const result = executePaper(input);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_RISK_INVALID_CONFIG), true);
  assert.deepEqual(ledgerFields(result.accountState), ledgerFields(before));
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.executionRecord, null);
});

test("I61 existing C03-style fill still works with explicit permissive config", () => {
  const intent = makeIntent();
  const result = executePaper(makeInput({
    orderIntent: intent,
    riskConfig: makePermissiveRiskConfig(intent),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(result.accountState.cash, 499950);
  assert.equal(result.accountState.positions.AAA.quantity, 10);
  assert.equal(result.accountState.positions.AAA.costBasis, 500050);
  const comm = calculateCommission({
    amount: 500000,
    ratePpm: 100,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(comm.amount, 50);
  assert.equal(result.executionRecord.cost.commission, comm.amount);
});
