"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PERSISTENCE_ERROR,
  setOwn,
  deepCloneOwn,
} = require("../lib/paper/paper-persistence-canonical");
const {
  createInMemoryPaperRepository,
} = require("../lib/paper/in-memory-paper-repository");
const {
  createPaperPersistenceService,
  RESOURCE_CAPS,
} = require("../lib/paper/paper-persistence-service");
const { createPaperAccountState } = require("../lib/paper/paper-account-state");
const {
  PAPER_MODE,
  PAPER_STATUS,
  SIDE,
  ORDER_TYPE,
  ERROR,
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

function makeExecArgs(accountId, overrides) {
  const extra = overrides || {};
  const intent = extra.orderIntent !== undefined ? extra.orderIntent : makeIntent();
  const event = extra.marketEvent !== undefined ? extra.marketEvent : makeEvent();
  const risk = extra.riskDecision !== undefined ? extra.riskDecision : makeRisk(intent);
  const approval = extra.userApproval !== undefined ? extra.userApproval : makeApproval(intent, risk);
  return {
    accountId,
    marketEvent: event,
    orderIntent: intent,
    riskDecision: risk,
    userApproval: approval,
    paperExecutionEnabled: extra.paperExecutionEnabled !== undefined ? extra.paperExecutionEnabled : true,
    costContext: extra.costContext || {
      policies: [makePolicy()],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
    riskConfig: extra.riskConfig || makePermissiveRiskConfig(intent),
    ...extra,
    orderIntent: intent,
    marketEvent: event,
    riskDecision: risk,
    userApproval: approval,
  };
}

function makeService() {
  const repo = createInMemoryPaperRepository();
  const service = createPaperPersistenceService(repo);
  return { repo, service };
}

function createFresh(service, accountId, initialCash) {
  return service.createAccount({
    accountId,
    initialCash: initialCash === undefined ? 1000000 : initialCash,
  });
}

function ownKeys(obj) {
  return obj ? Object.keys(obj) : [];
}

function assertNoEligibOwnKeys(obj) {
  const keys = ownKeys(obj);
  for (let i = 0; i < keys.length; i += 1) {
    assert.equal(/eligib/i.test(keys[i]), false, keys[i]);
  }
}

function nextBuyArgs(accountId, n) {
  const intent = makeIntent({
    intentId: "intent-" + n,
    quantity: 1,
    signalSequence: 10 + n,
  });
  const event = makeEvent({
    eventId: "evt-" + (11 + n),
    sequence: 11 + n,
    open: 1000,
  });
  const risk = makeRisk(intent, {
    riskDecisionId: "risk-" + n,
    validAfterEventSequence: 10 + n,
  });
  const approval = makeApproval(intent, risk, {
    approvalId: "appr-" + n,
    validAfterEventSequence: 10 + n,
  });
  return makeExecArgs(accountId, { orderIntent: intent, marketEvent: event, riskDecision: risk, userApproval: approval });
}

function padBlockedAuditsBeforeLast(aggregate, targetCount) {
  const records = aggregate.auditRecords;
  const need = targetCount - records.length;
  const pads = [];
  const idemp = aggregate.idempotency;
  for (let i = 0; i < need; i += 1) {
    const audit = {
      accountId: aggregate.accountId,
      requestDigest: "paper-request-v1:pad" + i,
      eventId: "pad-evt-" + i,
      sequence: 100000 + i,
      intentId: "pad-intent-" + i,
      executionId: null,
      paperStatus: PAPER_STATUS.BLOCKED,
      preRevision: 0,
      postRevision: 0,
    };
    pads.push(audit);
    setOwn(idemp.byEventId, audit.eventId, audit.requestDigest);
    setOwn(idemp.bySequence, String(audit.sequence), audit.requestDigest);
    setOwn(idemp.byIntentId, audit.intentId, audit.requestDigest);
    setOwn(idemp.byRequestDigest, audit.requestDigest, { requestDigest: audit.requestDigest });
  }
  aggregate.auditRecords = pads.concat(records);
}

function padExecutedIntentIds(aggregate, targetCount) {
  const map = aggregate.accountState.executedIntentIds;
  let i = 0;
  while (Object.keys(map).length < targetCount) {
    setOwn(map, "pad-intent-" + i, "pad-exec-" + i);
    i += 1;
  }
}

function padClosedTrades(aggregate, targetCount) {
  while (aggregate.accountState.closedTrades.length < targetCount) {
    aggregate.accountState.closedTrades.push({ symbol: "PAD" });
  }
}

function padFilledExecutionsBeforeLast(aggregate, targetExecCount) {
  const need = targetExecCount - aggregate.executionRecords.length;
  const lastAudit = aggregate.auditRecords[aggregate.auditRecords.length - 1];
  const before = aggregate.auditRecords.slice(0, -1);
  const padsAudit = [];
  const padsExec = [];
  const idemp = aggregate.idempotency;
  for (let i = 0; i < need; i += 1) {
    const executionId = "paper-exec-v1:fillpad" + i;
    const requestDigest = "paper-request-v1:fillpad" + i;
    const audit = {
      accountId: aggregate.accountId,
      requestDigest,
      eventId: "fill-evt-" + i,
      sequence: 200000 + i,
      intentId: "fill-intent-" + i,
      executionId,
      paperStatus: PAPER_STATUS.FILLED,
      preRevision: 0,
      postRevision: 0,
    };
    padsAudit.push(audit);
    padsExec.push({ executionId, accountId: aggregate.accountId });
    setOwn(idemp.byEventId, audit.eventId, requestDigest);
    setOwn(idemp.bySequence, String(audit.sequence), requestDigest);
    setOwn(idemp.byIntentId, audit.intentId, requestDigest);
    setOwn(idemp.byExecutionId, executionId, requestDigest);
    setOwn(idemp.byRequestDigest, requestDigest, { requestDigest });
  }
  aggregate.auditRecords = before.concat(padsAudit, lastAudit ? [lastAudit] : []);
  aggregate.executionRecords = padsExec.concat(aggregate.executionRecords);
}

function persistenceSources() {
  const root = path.join(__dirname, "..", "lib", "paper");
  return [
    "paper-persistence-canonical.js",
    "paper-persistence-validator.js",
    "in-memory-paper-repository.js",
    "paper-persistence-service.js",
  ].map((name) => ({
    name,
    src: fs.readFileSync(path.join(root, name), "utf8"),
  }));
}

function domainSources() {
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

test("ACCOUNT_NOT_FOUND if execute before create", () => {
  const { service } = makeService();
  const result = service.execute(makeExecArgs("acc-missing"));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND);
});

test("P18 caller executionId mismatch → INVALID_INPUT, persist nothing", () => {
  const { service } = makeService();
  createFresh(service, "acc-p18");
  const result = service.execute(makeExecArgs("acc-p18", { executionId: "caller-wrong-id" }));
  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT);
  assert.equal(result.persistenceError.field, "executionId");
  const loaded = service.execute(makeExecArgs("acc-p18"));
  assert.equal(loaded.revision, 1);
});

test("happy path FILLED persist revision 1", () => {
  const { service } = makeService();
  const created = createFresh(service, "acc-happy");
  assert.equal(created.ok, true);
  assert.equal(created.replayed, false);
  assert.equal(created.revision, 0);
  const result = service.execute(makeExecArgs("acc-happy"));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.replayed, false);
  assert.equal(result.domainResult.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(result.revision, 1);
  assert.equal(result.accountState.cash, 499950);
});

test("P36 same requestDigest replay, revision unchanged, same domain cash", () => {
  const { service } = makeService();
  createFresh(service, "acc-p36");
  const first = service.execute(makeExecArgs("acc-p36"));
  const second = service.execute(makeExecArgs("acc-p36"));
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.revision, first.revision);
  assert.equal(second.domainResult.accountState.cash, first.domainResult.accountState.cash);
  assert.equal(second.aggregate.auditRecords.length, 1);
});

test("P37 same eventId different digest → IDENTITY_CONFLICT", () => {
  const { service } = makeService();
  createFresh(service, "acc-p37");
  service.execute(makeExecArgs("acc-p37"));
  const intent = makeIntent({ quantity: 5 });
  const result = service.execute(makeExecArgs("acc-p37", {
    orderIntent: intent,
    riskDecision: makeRisk(intent),
    userApproval: makeApproval(intent),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT);
  assert.equal(result.revision, 1);
});

test("P38 same sequence different digest → IDENTITY_CONFLICT", () => {
  const { service } = makeService();
  createFresh(service, "acc-p38");
  service.execute(makeExecArgs("acc-p38"));
  const intent = makeIntent({ intentId: "intent-other" });
  const event = makeEvent({ eventId: "evt-other" });
  const result = service.execute(makeExecArgs("acc-p38", {
    orderIntent: intent,
    marketEvent: event,
    riskDecision: makeRisk(intent),
    userApproval: makeApproval(intent),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT);
});

test("P39 same intentId different event → IDENTITY_CONFLICT", () => {
  const { service } = makeService();
  createFresh(service, "acc-p39");
  service.execute(makeExecArgs("acc-p39"));
  const event = makeEvent({ eventId: "evt-99", sequence: 99 });
  const result = service.execute(makeExecArgs("acc-p39", { marketEvent: event }));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT);
});

test("P40 same executionId conflict via different approval", () => {
  const { service } = makeService();
  createFresh(service, "acc-p40");
  service.execute(makeExecArgs("acc-p40"));
  const intent = makeIntent();
  const risk = makeRisk(intent);
  const result = service.execute(makeExecArgs("acc-p40", {
    userApproval: makeApproval(intent, risk, { approvalId: "appr-other" }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT);
});

test("P41 replay no revision increment", () => {
  const { service } = makeService();
  createFresh(service, "acc-p41");
  const first = service.execute(makeExecArgs("acc-p41"));
  const second = service.execute(makeExecArgs("acc-p41"));
  assert.equal(second.replayed, true);
  assert.equal(second.revision, first.revision);
});

test("P42 replay no duplicate audit", () => {
  const { service } = makeService();
  createFresh(service, "acc-p42");
  service.execute(makeExecArgs("acc-p42"));
  const second = service.execute(makeExecArgs("acc-p42"));
  assert.equal(second.aggregate.auditRecords.length, 1);
});

test("P43 replay no duplicate execution", () => {
  const { service } = makeService();
  createFresh(service, "acc-p43");
  service.execute(makeExecArgs("acc-p43"));
  const second = service.execute(makeExecArgs("acc-p43"));
  assert.equal(second.aggregate.executionRecords.length, 1);
});

test("P44 FILLED atomic: state+audit+exec+rev together", () => {
  const { service } = makeService();
  createFresh(service, "acc-p44");
  const result = service.execute(makeExecArgs("acc-p44"));
  assert.equal(result.revision, 1);
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.aggregate.auditRecords.length, 1);
  assert.equal(result.aggregate.executionRecords.length, 1);
  assert.equal(result.aggregate.auditRecords[0].postRevision, 1);
});

test("P45 consuming BLOCKED persist kill switch", () => {
  const { service } = makeService();
  createFresh(service, "acc-p45");
  const result = service.execute(makeExecArgs("acc-p45", { paperExecutionEnabled: false }));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.revision, 1);
  assert.equal(result.domainResult.paperStatus, PAPER_STATUS.BLOCKED);
  assert.equal(result.domainResult.errorCodes.includes(ERROR.PAPER_KILL_SWITCH), true);
  assert.equal(result.accountState.lastProcessedSequence, 11);
  assert.equal(result.aggregate.auditRecords.length, 1);
  assert.equal(result.aggregate.executionRecords.length, 0);
});

test("P46 pre-consumption symbol mismatch persist nothing revision 0", () => {
  const { service } = makeService();
  createFresh(service, "acc-p46");
  const result = service.execute(makeExecArgs("acc-p46", {
    marketEvent: makeEvent({ symbol: "BBB" }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, false);
  assert.equal(result.revision, 0);
  assert.equal(result.domainResult.paperStatus, PAPER_STATUS.BLOCKED);
  assert.equal(result.aggregate.auditRecords.length, 0);
});

test("P47 BLOCKED no execution record", () => {
  const { service } = makeService();
  createFresh(service, "acc-p47");
  const result = service.execute(makeExecArgs("acc-p47", { paperExecutionEnabled: false }));
  assert.equal(result.aggregate.executionRecords.length, 0);
  assert.equal(result.aggregate.auditRecords[0].executionId, null);
});

test("P48 FILLED exactly one execution record", () => {
  const { service } = makeService();
  createFresh(service, "acc-p48");
  const result = service.execute(makeExecArgs("acc-p48"));
  assert.equal(result.aggregate.executionRecords.length, 1);
  assert.equal(result.aggregate.executionRecords[0].accountId, "acc-p48");
});

test("P49 cap boundary allowed at MAX for audit, executedIntentIds, closedTrades, executionRecords", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p49a");
  service.execute(makeExecArgs("acc-p49a"));
  const aggA = deepCloneOwn(repo.loadAccount("acc-p49a").aggregate);
  padBlockedAuditsBeforeLast(aggA, RESOURCE_CAPS.MAX_AUDIT_RECORDS - 1);
  repo.testOnlyReplaceAggregate("acc-p49a", aggA);
  const nextA = service.execute(nextBuyArgs("acc-p49a", 2));
  assert.equal(nextA.ok, true, "audit MAX allowed");
  assert.equal(nextA.aggregate.auditRecords.length, RESOURCE_CAPS.MAX_AUDIT_RECORDS);

  createFresh(service, "acc-p49b");
  service.execute(makeExecArgs("acc-p49b"));
  const aggB = deepCloneOwn(repo.loadAccount("acc-p49b").aggregate);
  padExecutedIntentIds(aggB, RESOURCE_CAPS.MAX_EXECUTED_INTENT_IDS - 1);
  repo.testOnlyReplaceAggregate("acc-p49b", aggB);
  const nextB = service.execute(nextBuyArgs("acc-p49b", 2));
  assert.equal(nextB.ok, true, "executedIntentIds MAX allowed");
  assert.equal(Object.keys(nextB.accountState.executedIntentIds).length, RESOURCE_CAPS.MAX_EXECUTED_INTENT_IDS);

  createFresh(service, "acc-p49c");
  service.execute(makeExecArgs("acc-p49c"));
  const aggC = deepCloneOwn(repo.loadAccount("acc-p49c").aggregate);
  padClosedTrades(aggC, RESOURCE_CAPS.MAX_CLOSED_TRADES - 1);
  repo.testOnlyReplaceAggregate("acc-p49c", aggC);
  const sellIntent = makeIntent({
    intentId: "intent-sell",
    side: SIDE.SELL,
    quantity: 10,
    signalSequence: 11,
  });
  const sellEvent = makeEvent({ eventId: "evt-12", sequence: 12, open: 50000 });
  const sellRisk = makeRisk(sellIntent, { riskDecisionId: "risk-sell", validAfterEventSequence: 11 });
  const sellAppr = makeApproval(sellIntent, sellRisk, { approvalId: "appr-sell", validAfterEventSequence: 11 });
  const nextC = service.execute(makeExecArgs("acc-p49c", {
    orderIntent: sellIntent,
    marketEvent: sellEvent,
    riskDecision: sellRisk,
    userApproval: sellAppr,
  }));
  assert.equal(nextC.ok, true, "closedTrades MAX allowed");
  assert.equal(nextC.accountState.closedTrades.length, RESOURCE_CAPS.MAX_CLOSED_TRADES);

  createFresh(service, "acc-p49d");
  service.execute(makeExecArgs("acc-p49d"));
  const aggD = deepCloneOwn(repo.loadAccount("acc-p49d").aggregate);
  padFilledExecutionsBeforeLast(aggD, RESOURCE_CAPS.MAX_EXECUTION_RECORDS - 1);
  repo.testOnlyReplaceAggregate("acc-p49d", aggD);
  const nextD = service.execute(nextBuyArgs("acc-p49d", 2));
  assert.equal(nextD.ok, true, "executionRecords MAX allowed");
  assert.equal(nextD.aggregate.executionRecords.length, RESOURCE_CAPS.MAX_EXECUTION_RECORDS);
});

test("P50 executedIntentIds at MAX, next NEW FILLED → RESOURCE_LIMIT", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p50");
  service.execute(makeExecArgs("acc-p50"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p50").aggregate);
  padExecutedIntentIds(agg, RESOURCE_CAPS.MAX_EXECUTED_INTENT_IDS);
  repo.testOnlyReplaceAggregate("acc-p50", agg);
  const result = service.execute(nextBuyArgs("acc-p50", 2));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED);
  assert.equal(result.domainResult, null);
});

test("P51 closedTrades at MAX, SELL that would append → RESOURCE_LIMIT", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p51");
  service.execute(makeExecArgs("acc-p51"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p51").aggregate);
  padClosedTrades(agg, RESOURCE_CAPS.MAX_CLOSED_TRADES);
  repo.testOnlyReplaceAggregate("acc-p51", agg);
  const sellIntent = makeIntent({
    intentId: "intent-sell",
    side: SIDE.SELL,
    quantity: 10,
    signalSequence: 11,
  });
  const sellEvent = makeEvent({ eventId: "evt-12", sequence: 12, open: 50000 });
  const sellRisk = makeRisk(sellIntent, { riskDecisionId: "risk-sell", validAfterEventSequence: 11 });
  const sellAppr = makeApproval(sellIntent, sellRisk, { approvalId: "appr-sell", validAfterEventSequence: 11 });
  const result = service.execute(makeExecArgs("acc-p51", {
    orderIntent: sellIntent,
    marketEvent: sellEvent,
    riskDecision: sellRisk,
    userApproval: sellAppr,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED);
});

test("P52 audit at MAX, next consuming → RESOURCE_LIMIT", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p52");
  service.execute(makeExecArgs("acc-p52"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p52").aggregate);
  padBlockedAuditsBeforeLast(agg, RESOURCE_CAPS.MAX_AUDIT_RECORDS);
  repo.testOnlyReplaceAggregate("acc-p52", agg);
  const result = service.execute(nextBuyArgs("acc-p52", 2));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED);
});

test("P53 executionRecords at MAX, next FILLED → RESOURCE_LIMIT", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p53");
  service.execute(makeExecArgs("acc-p53"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p53").aggregate);
  padFilledExecutionsBeforeLast(agg, RESOURCE_CAPS.MAX_EXECUTION_RECORDS);
  repo.testOnlyReplaceAggregate("acc-p53", agg);
  const result = service.execute(nextBuyArgs("acc-p53", 2));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED);
});

test("P54 resource failure persists nothing", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p54");
  const first = service.execute(makeExecArgs("acc-p54"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p54").aggregate);
  padBlockedAuditsBeforeLast(agg, RESOURCE_CAPS.MAX_AUDIT_RECORDS);
  repo.testOnlyReplaceAggregate("acc-p54", agg);
  service.execute(nextBuyArgs("acc-p54", 2));
  const loaded = repo.loadAccount("acc-p54");
  assert.equal(loaded.aggregate.revision, first.revision);
  assert.equal(loaded.aggregate.auditRecords.length, RESOURCE_CAPS.MAX_AUDIT_RECORDS);
});

test("P55 replay succeeds when already at cap", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p55");
  const first = service.execute(makeExecArgs("acc-p55"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p55").aggregate);
  padBlockedAuditsBeforeLast(agg, RESOURCE_CAPS.MAX_AUDIT_RECORDS);
  padExecutedIntentIds(agg, RESOURCE_CAPS.MAX_EXECUTED_INTENT_IDS);
  repo.testOnlyReplaceAggregate("acc-p55", agg);
  const replay = service.execute(makeExecArgs("acc-p55"));
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.requestDigest, first.requestDigest);
});

test("P56 service schemaVersion 2 → UNSUPPORTED_SCHEMA + quarantine", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p56s");
  const agg = deepCloneOwn(repo.loadAccount("acc-p56s").aggregate);
  agg.schemaVersion = 2;
  repo.testOnlyReplaceAggregate("acc-p56s", agg);
  const result = service.execute(makeExecArgs("acc-p56s"));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA);
  assert.equal(repo.loadAccount("acc-p56s").aggregate.quarantine, true);
});

test("P61 service corrupt non-quarantined → quarantine + CORRUPT_STATE", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p61s");
  const agg = deepCloneOwn(repo.loadAccount("acc-p61s").aggregate);
  agg.revision = -1;
  repo.testOnlyReplaceAggregate("acc-p61s", agg);
  const result = service.execute(makeExecArgs("acc-p61s"));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  assert.equal(repo.loadAccount("acc-p61s").aggregate.quarantine, true);
});

test("P62 already quarantined → QUARANTINED, no further mutation", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p62");
  const agg = deepCloneOwn(repo.loadAccount("acc-p62").aggregate);
  agg.quarantine = true;
  agg.revision = -1;
  repo.testOnlyReplaceAggregate("acc-p62", agg);
  const before = deepCloneOwn(repo.loadAccount("acc-p62").aggregate);
  const result = service.execute(makeExecArgs("acc-p62"));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_QUARANTINED);
  const after = repo.loadAccount("acc-p62");
  assert.equal(after.aggregate.revision, before.revision);
  assert.equal(after.aggregate.quarantine, true);
  assert.equal(after.aggregate.auditRecords.length, before.auditRecords.length);
});

test("P68 revision===MAX_SAFE_INTEGER consuming → REVISION_OVERFLOW no mutation", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p68");
  const agg = deepCloneOwn(repo.loadAccount("acc-p68").aggregate);
  agg.revision = Number.MAX_SAFE_INTEGER;
  repo.testOnlyReplaceAggregate("acc-p68", agg);
  const result = service.execute(makeExecArgs("acc-p68"));
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_OVERFLOW);
  assert.equal(result.domainResult, null);
  assert.equal(repo.loadAccount("acc-p68").aggregate.revision, Number.MAX_SAFE_INTEGER);
  assert.equal(repo.loadAccount("acc-p68").aggregate.auditRecords.length, 0);
});

test("P69 replay at MAX_SAFE_INTEGER still replay", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-p69");
  const first = service.execute(makeExecArgs("acc-p69"));
  const agg = deepCloneOwn(repo.loadAccount("acc-p69").aggregate);
  agg.revision = Number.MAX_SAFE_INTEGER;
  repo.testOnlyReplaceAggregate("acc-p69", agg);
  const replay = service.execute(makeExecArgs("acc-p69"));
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.requestDigest, first.requestDigest);
});

test("P76 P77 domain sources must not contain paper-persistence", () => {
  const files = domainSources();
  for (let i = 0; i < files.length; i += 1) {
    assert.equal(files[i].src.includes("paper-persistence"), false, files[i].name);
  }
});

test("P78 P79 persistence lib sources must not contain network/fs clients", () => {
  const forbidden = [
    'require("node:http")',
    'require("http")',
    'require("fs")',
    'require("node:fs")',
    "fs.write",
    'require("net")',
    'require("node:net")',
    "axios",
  ];
  const files = persistenceSources();
  for (let i = 0; i < files.length; i += 1) {
    for (let j = 0; j < forbidden.length; j += 1) {
      assert.equal(files[i].src.includes(forbidden[j]), false, files[i].name + " " + forbidden[j]);
    }
  }
});

test("P80 P81 create/execute result objects have no own keys matching /eligib/i", () => {
  const { service } = makeService();
  const created = createFresh(service, "acc-p80");
  const executed = service.execute(makeExecArgs("acc-p80"));
  assertNoEligibOwnKeys(created);
  assertNoEligibOwnKeys(executed);
});

test("P82 persistence lib sources must not contain Date.now or Math.random", () => {
  const files = persistenceSources();
  for (let i = 0; i < files.length; i += 1) {
    assert.equal(files[i].src.includes("Date.now"), false, files[i].name);
    assert.equal(files[i].src.includes("Math.random"), false, files[i].name);
  }
});

test("sequence 0 consuming kill switch on fresh account", () => {
  const { service } = makeService();
  createFresh(service, "acc-seq0");
  const result = service.execute(makeExecArgs("acc-seq0", {
    paperExecutionEnabled: false,
    marketEvent: makeEvent({ eventId: "evt-0", sequence: 0 }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.accountState.lastProcessedSequence, 0);
  assert.equal(result.accountState.lastProcessedEventId, "evt-0");
});

test("create replay same digest", () => {
  const { service } = makeService();
  const a = createFresh(service, "acc-create-replay");
  const b = createFresh(service, "acc-create-replay");
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.replayed, true);
  assert.equal(b.revision, 0);
});

test("create different initialCash conflicts", () => {
  const { service } = makeService();
  createFresh(service, "acc-create-conflict", 1000);
  const result = service.createAccount({ accountId: "acc-create-conflict", initialCash: 2000 });
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT);
});

test("service P29 injectCommit CONFLICT then success → retry once persist ok revision 1", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-svc-p29");
  repo.injectCommit("acc-svc-p29", "CONFLICT");
  const result = service.execute(makeExecArgs("acc-svc-p29"));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.replayed, false);
  assert.equal(result.revision, 1);
  assert.equal(result.domainResult.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(repo.loadAccount("acc-svc-p29").aggregate.revision, 1);
  assert.equal(repo.loadAccount("acc-svc-p29").aggregate.auditRecords.length, 1);
});

test("service P28 injectCommit CONFLICT twice → RETRY_EXHAUSTED persist nothing revision 0", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-svc-p28");
  repo.injectCommit("acc-svc-p28", "CONFLICT");
  repo.injectCommit("acc-svc-p28", "CONFLICT");
  const result = service.execute(makeExecArgs("acc-svc-p28"));
  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RETRY_EXHAUSTED);
  assert.equal(result.revision, 0);
  assert.equal(repo.loadAccount("acc-svc-p28").aggregate.revision, 0);
  assert.equal(repo.loadAccount("acc-svc-p28").aggregate.auditRecords.length, 0);
});

test("service P33 injectCommit FAILED → COMMIT_FAILED no retry revision 0 no audit", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-svc-p33");
  repo.injectCommit("acc-svc-p33", "FAILED");
  const result = service.execute(makeExecArgs("acc-svc-p33"));
  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
  assert.equal(result.revision, 0);
  assert.equal(result.aggregate.auditRecords.length, 0);
  assert.equal(repo.loadAccount("acc-svc-p33").aggregate.revision, 0);
  assert.equal(repo.loadAccount("acc-svc-p33").aggregate.auditRecords.length, 0);
});

test("service P31 P34 injectCommit UNKNOWN_COMMITTED → lookup original ok persisted revision 1 FILLED", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-svc-p31");
  repo.injectCommit("acc-svc-p31", "UNKNOWN_COMMITTED");
  const result = service.execute(makeExecArgs("acc-svc-p31"));
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.revision, 1);
  assert.equal(result.domainResult.paperStatus, PAPER_STATUS.FILLED);
  assert.equal(repo.loadAccount("acc-svc-p31").aggregate.revision, 1);
  assert.equal(repo.loadAccount("acc-svc-p31").aggregate.auditRecords.length, 1);
});

test("service P32 P35 injectCommit UNKNOWN_UNRESOLVED → COMMIT_UNKNOWN persist nothing", () => {
  const { repo, service } = makeService();
  createFresh(service, "acc-svc-p32");
  repo.injectCommit("acc-svc-p32", "UNKNOWN_UNRESOLVED");
  const result = service.execute(makeExecArgs("acc-svc-p32"));
  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(result.revision, 0);
  assert.equal(repo.loadAccount("acc-svc-p32").aggregate.revision, 0);
  assert.equal(repo.loadAccount("acc-svc-p32").aggregate.auditRecords.length, 0);
});

test("service P23 injectCreate FAILED → COMMIT_FAILED load not found", () => {
  const { repo, service } = makeService();
  repo.injectCreate("acc-svc-p23", "FAILED");
  const result = service.createAccount({ accountId: "acc-svc-p23", initialCash: 1000000 });
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
  assert.equal(repo.loadAccount("acc-svc-p23").found, false);
});

test("service P24 injectCreate UNKNOWN_COMMITTED → replayed true revision 0 account exists", () => {
  const { repo, service } = makeService();
  repo.injectCreate("acc-svc-p24", "UNKNOWN_COMMITTED");
  const result = service.createAccount({ accountId: "acc-svc-p24", initialCash: 1000000 });
  assert.equal(result.ok, true);
  assert.equal(result.replayed, true);
  assert.equal(result.revision, 0);
  assert.equal(repo.loadAccount("acc-svc-p24").found, true);
  assert.equal(repo.loadAccount("acc-svc-p24").aggregate.revision, 0);
});

test("service P26 injectCreate UNKNOWN_UNRESOLVED → COMMIT_UNKNOWN account not found", () => {
  const { repo, service } = makeService();
  repo.injectCreate("acc-svc-p26", "UNKNOWN_UNRESOLVED");
  const result = service.createAccount({ accountId: "acc-svc-p26", initialCash: 1000000 });
  assert.equal(result.ok, false);
  assert.equal(result.persistenceError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(repo.loadAccount("acc-svc-p26").found, false);
});

void createPaperAccountState;
