"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERSISTENCE_ERROR,
  POLICY_FIELDS,
  COMMISSION_FIELDS,
  SELL_TAX_FIELDS,
  REQUEST_PREFIX,
  CREATE_PREFIX,
  EXEC_PREFIX,
  encodeCanonical,
  digestRequest,
  digestCreate,
  deriveExecutionId,
  buildCanonicalRequest,
} = require("../lib/paper/paper-persistence-canonical");
const {
  PAPER_MODE,
  SIDE,
  ORDER_TYPE,
} = require("../lib/paper/paper-result");
const {
  ROUNDING_MODE,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
} = require("../lib/backtest/cost-policy");

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

function makeRequest(overrides) {
  const extra = overrides || {};
  const intent = extra.orderIntent !== undefined ? extra.orderIntent : makeIntent();
  const event = extra.marketEvent !== undefined ? extra.marketEvent : makeEvent();
  const risk = extra.riskDecision !== undefined ? extra.riskDecision : makeRisk(intent);
  const approval = extra.userApproval !== undefined ? extra.userApproval : makeApproval(intent, risk);
  return {
    accountId: extra.accountId !== undefined ? extra.accountId : "acc-canon",
    marketEvent: event,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    riskConfig: extra.riskConfig !== undefined ? extra.riskConfig : makePermissiveRiskConfig(intent),
    paperExecutionEnabled: extra.paperExecutionEnabled !== undefined ? extra.paperExecutionEnabled : true,
    costContext: extra.costContext !== undefined ? extra.costContext : {
      policies: [makePolicy()],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
    ...extra,
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
  };
}

test("P01 same semantic request same digest", () => {
  const a = digestRequest(makeRequest());
  const b = digestRequest(makeRequest());
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.digest, b.digest);
  assert.equal(a.digest.indexOf(REQUEST_PREFIX), 0);
});

test("P02 property insertion order independent", () => {
  const intent = makeIntent();
  const event = makeEvent();
  const risk = makeRisk(intent);
  const approval = makeApproval(intent, risk);
  const riskConfig = makePermissiveRiskConfig(intent);
  const costContext = {
    policies: [makePolicy()],
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
  };
  const first = {};
  first.accountId = "acc-order";
  first.marketEvent = event;
  first.orderIntent = intent;
  first.riskDecision = risk;
  first.userApproval = approval;
  first.riskConfig = riskConfig;
  first.paperExecutionEnabled = true;
  first.costContext = costContext;
  const second = {};
  second.costContext = costContext;
  second.paperExecutionEnabled = true;
  second.riskConfig = riskConfig;
  second.userApproval = approval;
  second.riskDecision = risk;
  second.orderIntent = intent;
  second.marketEvent = event;
  second.accountId = "acc-order";
  const evA = {};
  evA.open = 50000;
  evA.sequence = 11;
  evA.tradingDate = "2101-06-01";
  evA.symbol = "AAA";
  evA.market = MARKET.SYNTHETIC_KOSPI;
  evA.eventId = "evt-11";
  first.marketEvent = evA;
  second.marketEvent = makeEvent();
  const a = digestRequest(first);
  const b = digestRequest(second);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.digest, b.digest);
});

test("P03 event.open changes digest", () => {
  const a = digestRequest(makeRequest());
  const b = digestRequest(makeRequest({ marketEvent: makeEvent({ open: 51000 }) }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("P04 quantity changes digest", () => {
  const intent = makeIntent({ quantity: 11 });
  const a = digestRequest(makeRequest());
  const b = digestRequest(makeRequest({
    orderIntent: intent,
    riskDecision: makeRisk(intent),
    userApproval: makeApproval(intent),
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("P05 approval changes digest", () => {
  const intent = makeIntent();
  const risk = makeRisk(intent);
  const a = digestRequest(makeRequest());
  const b = digestRequest(makeRequest({
    userApproval: makeApproval(intent, risk, { approvalId: "appr-other" }),
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("P06 riskConfig changes digest", () => {
  const a = digestRequest(makeRequest());
  const b = digestRequest(makeRequest({
    riskConfig: {
      ...makePermissiveRiskConfig(),
      maxOrderNotional: 1,
    },
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("P07 allowedMarkets/allowedSymbols order normalized", () => {
  const base = makePermissiveRiskConfig();
  const a = digestRequest(makeRequest({
    riskConfig: { ...base, allowedMarkets: ["B", "A"], allowedSymbols: ["Z", "Y"] },
  }));
  const b = digestRequest(makeRequest({
    riskConfig: { ...base, allowedMarkets: ["A", "B"], allowedSymbols: ["Y", "Z"] },
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.digest, b.digest);
});

test("P08 duplicate multiplicity retained", () => {
  const base = makePermissiveRiskConfig();
  const a = digestRequest(makeRequest({
    riskConfig: { ...base, allowedSymbols: ["A", "A"] },
  }));
  const b = digestRequest(makeRequest({
    riskConfig: { ...base, allowedSymbols: ["A"] },
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("P09 policy array order retained", () => {
  const p1 = makePolicy({ policyId: "pol-a" });
  const p2 = makePolicy({ policyId: "pol-b", commission: { buyRatePpm: 200 } });
  const a = digestRequest(makeRequest({
    costContext: {
      policies: [p1, p2],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
  }));
  const b = digestRequest(makeRequest({
    costContext: {
      policies: [p2, p1],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("P10 excluded fields do NOT change digest", () => {
  const a = digestRequest(makeRequest());
  const mutated = makeRequest({
    accountState: { cash: 1 },
    executionId: "caller-exec-other",
    costContext: {
      policies: [makePolicy()],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
      tradingDate: "2099-01-01",
    },
    riskDecision: {
      ...makeRisk(),
      reasonCodes: ["R"],
      evaluatedNotional: 999,
      riskReferencePrice: 1,
    },
  });
  const b = digestRequest(mutated);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.digest, b.digest);
});

test("P11 create digest deterministic; extra create fields ignored", () => {
  const a = digestCreate({ accountId: "acc-c", initialCash: 1000 });
  const b = digestCreate({ accountId: "acc-c", initialCash: 1000, extra: true, foo: 1 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.digest, b.digest);
  assert.equal(a.digest.indexOf(CREATE_PREFIX), 0);
});

test("P12 unsupported types rejected", () => {
  const cases = [
    ["undefined", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["BigInt", BigInt(1)],
    ["function", function fn() { return 1; }],
    ["symbol", Symbol("x")],
    ["boxed Number", new Number(1)],
    ["boxed String", new String("1")],
    ["boxed Boolean", new Boolean(true)],
    ["Date", new Date("2101-01-01T00:00:00.000Z")],
    ["Map", new Map()],
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const label = cases[i][0];
    const value = cases[i][1];
    const digested = digestRequest(makeRequest({ marketEvent: makeEvent({ open: value }) }));
    assert.equal(digested.ok, false, label);
    assert.equal(digested.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT, label);
  }
});

test("P13 executionId deterministic", () => {
  const input = { accountId: "acc-e", eventId: "evt-11", sequence: 11, intentId: "intent-1" };
  const a = deriveExecutionId(input);
  const b = deriveExecutionId(input);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.executionId, b.executionId);
  assert.equal(a.executionId.indexOf(EXEC_PREFIX), 0);
});

test("P14 different account differs", () => {
  const a = deriveExecutionId({ accountId: "acc-a", eventId: "evt-11", sequence: 11, intentId: "intent-1" });
  const b = deriveExecutionId({ accountId: "acc-b", eventId: "evt-11", sequence: 11, intentId: "intent-1" });
  assert.notEqual(a.executionId, b.executionId);
});

test("P15 different event differs", () => {
  const a = deriveExecutionId({ accountId: "acc-e", eventId: "evt-11", sequence: 11, intentId: "intent-1" });
  const b = deriveExecutionId({ accountId: "acc-e", eventId: "evt-12", sequence: 11, intentId: "intent-1" });
  assert.notEqual(a.executionId, b.executionId);
});

test("P16 different sequence differs", () => {
  const a = deriveExecutionId({ accountId: "acc-e", eventId: "evt-11", sequence: 11, intentId: "intent-1" });
  const b = deriveExecutionId({ accountId: "acc-e", eventId: "evt-11", sequence: 12, intentId: "intent-1" });
  assert.notEqual(a.executionId, b.executionId);
});

test("P17 different intent differs", () => {
  const a = deriveExecutionId({ accountId: "acc-e", eventId: "evt-11", sequence: 11, intentId: "intent-1" });
  const b = deriveExecutionId({ accountId: "acc-e", eventId: "evt-11", sequence: 11, intentId: "intent-2" });
  assert.notEqual(a.executionId, b.executionId);
});

test("P18 derived executionId !== arbitrary caller id and is not request digest", () => {
  const req = makeRequest();
  const digested = digestRequest(req);
  const derived = deriveExecutionId({
    accountId: req.accountId,
    eventId: req.marketEvent.eventId,
    sequence: req.marketEvent.sequence,
    intentId: req.orderIntent.intentId,
  });
  assert.equal(digested.ok, true);
  assert.equal(derived.ok, true);
  assert.notEqual(derived.executionId, "caller-arbitrary-id");
  assert.notEqual(derived.executionId, digested.digest);
  assert.equal(derived.canonical.version, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(derived.canonical, "quantity"), false);
});

test("POLICY_FIELDS COMMISSION_FIELDS SELL_TAX_FIELDS snapshot and extra policy field stripped", () => {
  assert.deepEqual(POLICY_FIELDS, [
    "policyId",
    "policyVersion",
    "policyStatus",
    "fixtureType",
    "notProductionData",
    "productionEligible",
    "market",
    "currency",
    "effectiveFrom",
    "effectiveTo",
    "brokerChannel",
    "commission",
    "sellTaxes",
    "sourceReference",
    "verifiedAt",
  ]);
  assert.deepEqual(COMMISSION_FIELDS, [
    "buyRatePpm",
    "sellRatePpm",
    "minimumBuyAmount",
    "minimumSellAmount",
    "roundingMode",
  ]);
  assert.deepEqual(SELL_TAX_FIELDS, ["taxType", "ratePpm", "roundingMode"]);
  const extraPolicy = makePolicy();
  extraPolicy.unexpectedExtra = "strip-me";
  const a = digestRequest(makeRequest());
  const b = digestRequest(makeRequest({
    costContext: {
      policies: [extraPolicy],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
  }));
  assert.equal(a.digest, b.digest);
});

test("encodeCanonical objects lex own-key order; same keys same bytes", () => {
  const a = encodeCanonical({ b: 1, a: 2 });
  const b = encodeCanonical({ a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1}');
});

test("allowed list sort uses string < not localeCompare", () => {
  const base = makePermissiveRiskConfig();
  const builtA = buildCanonicalRequest(makeRequest({
    riskConfig: { ...base, allowedSymbols: ["B", "A"] },
  }));
  const builtB = buildCanonicalRequest(makeRequest({
    riskConfig: { ...base, allowedSymbols: ["A", "B"] },
  }));
  assert.equal(builtA.ok, true);
  assert.equal(builtB.ok, true);
  assert.deepEqual(builtA.value.riskConfig.allowedSymbols, ["A", "B"]);
  assert.deepEqual(builtB.value.riskConfig.allowedSymbols, ["A", "B"]);
});
