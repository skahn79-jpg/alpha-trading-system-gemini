"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createPaperRuntime,
  OPERATING_MODE,
  RUNTIME_ACTION,
} = require("../lib/paper/paper-runtime-loop");
const { evaluatePaperRisk } = require("../lib/paper/paper-risk-engine");
const {
  PERSISTENCE_ERROR,
  deepCloneOwn,
} = require("../lib/paper/paper-persistence-canonical");
const {
  createPaperPersistenceService,
} = require("../lib/paper/paper-persistence-service");
const {
  createInMemoryPaperRepository,
} = require("../lib/paper/in-memory-paper-repository");
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

function makeApproval(intent, overrides) {
  const i = intent || makeIntent();
  return {
    approvalId: "appr-1",
    intentId: i.intentId,
    riskDecisionId: "risk-1",
    approved: true,
    approvedQuantity: i.quantity,
    validAfterEventSequence: 10,
    ...(overrides || {}),
  };
}

function makeRiskConfig(intent) {
  const i = intent || makeIntent();
  return {
    maxOrderNotional: Number.MAX_SAFE_INTEGER,
    maxPositionNotional: Number.MAX_SAFE_INTEGER,
    allowedMarkets: [i.market],
    allowedSymbols: [i.symbol],
  };
}

function makeRuntimeConfig(accountId, overrides) {
  const extra = overrides || {};
  const intent = makeIntent();
  return {
    accountId: accountId,
    riskConfig: extra.riskConfig || makeRiskConfig(intent),
    costContext: extra.costContext || {
      policies: [makePolicy()],
      brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
      currency: CURRENCY.KRW,
    },
  };
}

function makeStepInput(accountId, overrides) {
  const extra = overrides || {};
  const intent = extra.orderIntent !== undefined ? extra.orderIntent : makeIntent();
  const event = extra.marketEvent !== undefined ? extra.marketEvent : makeEvent();
  const approval = extra.userApproval !== undefined ? extra.userApproval : makeApproval(intent);
  const out = {
    accountId: extra.accountId !== undefined ? extra.accountId : accountId,
    sessionToken: extra.sessionToken !== undefined ? extra.sessionToken : "sess-1",
    marketEvent: event,
    orderIntent: intent,
    userApproval: approval,
  };
  if (extra.sessionRef !== undefined) {
    delete out.sessionToken;
    out.sessionRef = extra.sessionRef;
  }
  const extras = extra.extraFields || {};
  const keys = Object.keys(extras);
  for (let i = 0; i < keys.length; i += 1) {
    out[keys[i]] = extras[keys[i]];
  }
  return out;
}

function persistErrorResult(code, extras) {
  const extra = extras || {};
  return {
    ok: false,
    persisted: false,
    replayed: false,
    persistenceError: { code: code },
    requestDigest: null,
    createDigest: null,
    executionId: null,
    revision: extra.revision === undefined ? 0 : extra.revision,
    domainResult: extra.domainResult === undefined ? null : extra.domainResult,
    accountState: null,
    aggregate: null,
  };
}

function persistOkResult(overrides) {
  const extra = overrides || {};
  return {
    ok: extra.ok === undefined ? true : extra.ok,
    persisted: extra.persisted === undefined ? true : extra.persisted,
    replayed: extra.replayed === true,
    persistenceError: extra.persistenceError === undefined ? null : extra.persistenceError,
    requestDigest: extra.requestDigest === undefined ? "paper-request-v1:test" : extra.requestDigest,
    createDigest: extra.createDigest === undefined ? "paper-account-create-v1:test" : extra.createDigest,
    executionId: extra.executionId === undefined ? "paper-exec-v1:test" : extra.executionId,
    revision: extra.revision === undefined ? 1 : extra.revision,
    domainResult: extra.domainResult === undefined
      ? { ok: true, paperStatus: PAPER_STATUS.FILLED, errors: [], errorCodes: [] }
      : extra.domainResult,
    accountState: extra.accountState === undefined ? null : extra.accountState,
    aggregate: extra.aggregate === undefined ? null : extra.aggregate,
  };
}

function counters() {
  return {
    execute: 0,
    createAccount: 0,
    risk: 0,
    telemetry: 0,
    lastExecuteInput: null,
  };
}

function mockPersistence(count, executeImpl) {
  return {
    execute(input) {
      count.execute += 1;
      count.lastExecuteInput = input;
      return executeImpl(input);
    },
    createAccount(input) {
      count.createAccount += 1;
      return input;
    },
  };
}

function countingRisk(count) {
  return function wrapped(input) {
    count.risk += 1;
    return evaluatePaperRisk(input);
  };
}

function openKill() {
  return { isExecutionAllowed() { return true; } };
}

function closedKill() {
  return { isExecutionAllowed() { return false; } };
}

function openApproval() {
  return { isOpen() { return true; } };
}

function activeSession() {
  return function sessionValidator() {
    return { active: true };
  };
}

function inactiveSession() {
  return function sessionValidator() {
    return { active: false };
  };
}

function eligibleTrue() {
  return function eligibilityReader() {
    return true;
  };
}

function snapshotOf(state) {
  return function accountSnapshotReader() {
    return deepCloneOwn(state);
  };
}

function emptyAccount(accountId) {
  return createPaperAccountState({
    accountId: accountId,
    initialCash: 1000000,
  });
}

function hasOwnDep(extra, key) {
  return Object.prototype.hasOwnProperty.call(extra, key);
}

function makeExecutableRuntime(accountId, count, extras) {
  const extra = extras || {};
  const persistence = extra.persistence || mockPersistence(count, function defaultExec() {
    return persistOkResult();
  });
  return createPaperRuntime({
    persistenceService: persistence,
    evaluatePaperRisk: extra.evaluatePaperRisk || countingRisk(count),
    runtimeConfig: extra.runtimeConfig || makeRuntimeConfig(accountId),
    killSwitch: hasOwnDep(extra, "killSwitch") ? extra.killSwitch : openKill(),
    sessionValidator: hasOwnDep(extra, "sessionValidator") ? extra.sessionValidator : activeSession(),
    eligibilityReader: hasOwnDep(extra, "eligibilityReader") ? extra.eligibilityReader : eligibleTrue(),
    approvalPolicyAuthority: hasOwnDep(extra, "approvalPolicyAuthority")
      ? extra.approvalPolicyAuthority
      : openApproval(),
    accountSnapshotReader: hasOwnDep(extra, "accountSnapshotReader")
      ? extra.accountSnapshotReader
      : snapshotOf(emptyAccount(accountId)),
    telemetry: extra.telemetry || function onTelemetry() {
      count.telemetry += 1;
    },
  });
}

function runtimeSource() {
  return fs.readFileSync(
    path.join(__dirname, "..", "lib", "paper", "paper-runtime-loop.js"),
    "utf8"
  );
}

function makeRealHarness(accountId) {
  const count = counters();
  const repo = createInMemoryPaperRepository();
  const inner = createPaperPersistenceService(repo);
  const persistence = {
    execute(input) {
      count.execute += 1;
      count.lastExecuteInput = input;
      return inner.execute(input);
    },
    createAccount(input) {
      count.createAccount += 1;
      return inner.createAccount(input);
    },
  };
  function loadClone(id) {
    const loaded = repo.loadAccount(id);
    if (!loaded || loaded.found !== true || !loaded.aggregate) return null;
    return deepCloneOwn(loaded.aggregate.accountState);
  }
  return {
    count: count,
    repo: repo,
    inner: inner,
    persistence: persistence,
    loadClone: loadClone,
  };
}

test("R01 FILLED → ADVANCE, risk 1, execute 1, createAccount 0", () => {
  const accountId = "acc-r01";
  const harness = makeRealHarness(accountId);
  harness.inner.createAccount({ accountId: accountId, initialCash: 1000000 });
  const runtime = makeExecutableRuntime(accountId, harness.count, {
    persistence: harness.persistence,
    accountSnapshotReader: harness.loadClone,
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(result.ok, true);
  assert.equal(result.domainOutcome, PAPER_STATUS.FILLED);
  assert.equal(result.revision, 1);
  assert.equal(result.accountId, accountId);
  assert.equal(result.eventId, "evt-11");
  assert.equal(result.sequence, 11);
  assert.equal(harness.count.risk, 1);
  assert.equal(harness.count.execute, 1);
  assert.equal(harness.count.createAccount, 0);
  assert.equal(result.rootError, null);
});

test("R02 consuming BLOCKED → ADVANCE", () => {
  const accountId = "acc-r02";
  const harness = makeRealHarness(accountId);
  harness.inner.createAccount({ accountId: accountId, initialCash: 1 });
  const runtime = makeExecutableRuntime(accountId, harness.count, {
    persistence: harness.persistence,
    accountSnapshotReader: harness.loadClone,
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(result.domainOutcome, PAPER_STATUS.BLOCKED);
  assert.equal(result.persisted, true);
  assert.equal(harness.count.risk, 1);
  assert.equal(harness.count.execute, 1);
  assert.equal(harness.count.createAccount, 0);
});

test("R03 pre-consumption invalid no persist", () => {
  const accountId = "acc-r03";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count);
  const badEvent = makeStepInput(accountId, {
    marketEvent: makeEvent({ sequence: Number.NaN }),
  });
  const result = runtime.runStep(badEvent);
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_SESSION);
  assert.equal(result.rootError.code, ERROR.PAPER_INVALID_INPUT);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
  assert.equal(count.createAccount, 0);

  const mismatch = runtime.runStep(makeStepInput(accountId, {
    marketEvent: makeEvent({ symbol: "BBB" }),
  }));
  assert.equal(mismatch.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(mismatch.rootError.code, ERROR.PAPER_SYMBOL_MISMATCH);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
});

test("R04 replay → NOOP", () => {
  const accountId = "acc-r04";
  const harness = makeRealHarness(accountId);
  harness.inner.createAccount({ accountId: accountId, initialCash: 1 });
  const runtime = makeExecutableRuntime(accountId, harness.count, {
    persistence: harness.persistence,
    accountSnapshotReader: harness.loadClone,
  });
  const first = runtime.runStep(makeStepInput(accountId));
  const second = runtime.runStep(makeStepInput(accountId));
  assert.equal(first.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(first.domainOutcome, PAPER_STATUS.BLOCKED);
  assert.equal(second.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(second.replayed, true);
  assert.equal(second.revision, first.revision);
  assert.equal(harness.count.execute, 2);
  assert.equal(harness.count.createAccount, 0);
});

test("R05 account missing → HALT_SESSION, createAccount 0", () => {
  const accountId = "acc-r05";
  const harness = makeRealHarness(accountId);
  const runtime = makeExecutableRuntime(accountId, harness.count, {
    persistence: harness.persistence,
    accountSnapshotReader: harness.loadClone,
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_SESSION);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND);
  assert.equal(result.rootError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND);
  assert.equal(harness.count.execute, 1);
  assert.equal(harness.count.risk, 0);
  assert.equal(harness.count.createAccount, 0);
});

test("R06 quarantined → HALT_ACCOUNT", () => {
  const accountId = "acc-r06";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function quarantined() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_QUARANTINED, { revision: 3 });
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_QUARANTINED);
  assert.equal(result.rootError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_QUARANTINED);
  assert.equal(count.execute, 1);
  assert.equal(count.createAccount, 0);
});

test("R07 corrupt → HALT_ACCOUNT", () => {
  const accountId = "acc-r07";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function corrupt() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  assert.equal(result.rootError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  assert.equal(count.execute, 1);
});

test("R08 unsupported schema → HALT_ACCOUNT", () => {
  const accountId = "acc-r08";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function unsupported() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA);
  assert.equal(count.execute, 1);
});

test("R09 identity conflict → HALT_ACCOUNT", () => {
  const accountId = "acc-r09";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function conflict() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT, { revision: 1 });
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT);
  assert.equal(result.rootError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT);
  assert.equal(count.execute, 1);
  assert.equal(count.createAccount, 0);
});

test("R10 revision overflow → HALT_ACCOUNT", () => {
  const accountId = "acc-r10";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function overflow() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_OVERFLOW);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_OVERFLOW);
  assert.equal(count.execute, 1);
});

test("R11 resource limit → HALT_ACCOUNT", () => {
  const accountId = "acc-r11";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function limit() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED);
  assert.equal(count.execute, 1);
});

test("R12 COMMIT_FAILED → HALT_ACCOUNT, retry 0", () => {
  const accountId = "acc-r12";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function failed() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
  assert.equal(result.rootError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
  assert.equal(count.execute, 1);
  assert.equal(count.createAccount, 0);
});

test("R13 COMMIT_UNKNOWN → HALT_ACCOUNT, retry 0", () => {
  const accountId = "acc-r13";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function unknown() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(result.rootError.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(count.execute, 1);
});

test("R14 RETRY_EXHAUSTED → HALT_ACCOUNT", () => {
  const accountId = "acc-r14";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function exhausted() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_RETRY_EXHAUSTED);
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, PERSISTENCE_ERROR.PAPER_PERSISTENCE_RETRY_EXHAUSTED);
  assert.equal(count.execute, 1);
});

test("R15 no busy retry around execute", () => {
  const src = runtimeSource();
  assert.equal(/while\s*\(.*execute/.test(src), false);
  assert.equal(/for\s*\(.*execute/.test(src), false);
  const count = counters();
  const runtime = makeExecutableRuntime("acc-r15", count, {
    persistence: mockPersistence(count, function failed() {
      return persistErrorResult(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
    }),
  });
  runtime.runStep(makeStepInput("acc-r15"));
  assert.equal(count.execute, 1);
});

test("R16 no direct executePaper bypass", () => {
  const src = runtimeSource();
  assert.equal(src.includes("executePaper"), false);
  assert.equal(src.includes("paper-execution-adapter"), false);
});

test("R17 no direct repository mutation", () => {
  const src = runtimeSource();
  assert.equal(src.includes("writeAccount"), false);
  assert.equal(src.includes("commitAccount"), false);
  assert.equal(src.includes("createAccountIfAbsent"), false);
  assert.equal(src.includes("in-memory-paper-repository"), false);
});

test("R18 caller accountState blocked", () => {
  const accountId = "acc-r18";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count);
  const result = runtime.runStep(makeStepInput(accountId, {
    extraFields: {
      accountState: emptyAccount(accountId),
    },
  }));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_SESSION);
  assert.equal(result.rootError.code, ERROR.PAPER_INVALID_INPUT);
  assert.equal(result.rootError.field, "accountState");
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
});

test("R19 caller config override blocked", () => {
  const accountId = "acc-r19";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count);
  const keys = [
    "riskConfig",
    "costContext",
    "paperExecutionEnabled",
    "allowedMarkets",
    "allowedSymbols",
    "revision",
    "executionId",
    "aggregate",
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const extraFields = {};
    extraFields[keys[i]] = keys[i] === "paperExecutionEnabled" ? true : { injected: true };
    const result = runtime.runStep(makeStepInput(accountId, { extraFields: extraFields }));
    assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_SESSION, keys[i]);
    assert.equal(result.rootError.code, ERROR.PAPER_INVALID_INPUT, keys[i]);
    assert.equal(result.rootError.field, keys[i], keys[i]);
    assert.equal(count.execute, 0, keys[i]);
    assert.equal(count.risk, 0, keys[i]);
  }
});

test("R20 risk engine invoked for executable path", () => {
  const accountId = "acc-r20";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count);
  runtime.runStep(makeStepInput(accountId));
  assert.equal(count.risk, 1);
  assert.equal(count.execute, 1);
});

test("R21 approval guard prevents unauthorized execution", () => {
  const accountId = "acc-r21";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    approvalPolicyAuthority: undefined,
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
  assert.equal(count.createAccount, 0);

  const closed = counters();
  const closedRuntime = makeExecutableRuntime(accountId, closed, {
    approvalPolicyAuthority: { isOpen() { return false; } },
  });
  const closedResult = closedRuntime.runStep(makeStepInput(accountId));
  assert.equal(closedResult.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(closed.execute, 0);
  assert.equal(closed.risk, 0);
});

test("R22 kill switch checked", () => {
  const accountId = "acc-r22";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    killSwitch: closedKill(),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
});

test("R23 authoritative costContext used", () => {
  const accountId = "acc-r23";
  const count = counters();
  const policy = makePolicy();
  const runtime = makeExecutableRuntime(accountId, count, {
    runtimeConfig: makeRuntimeConfig(accountId, {
      costContext: {
        policies: [policy],
        brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
        currency: CURRENCY.KRW,
      },
    }),
  });
  runtime.runStep(makeStepInput(accountId));
  assert.equal(count.execute, 1);
  const sent = count.lastExecuteInput.costContext;
  assert.equal(sent.tradingDate, "2101-06-01");
  assert.equal(sent.brokerChannel, BROKER_CHANNEL.SYNTHETIC_ONLINE);
  assert.equal(sent.currency, CURRENCY.KRW);
  assert.equal(Array.isArray(sent.policies), true);
  assert.equal(sent.policies[0].policyId, policy.policyId);
  assert.equal(count.lastExecuteInput.paperExecutionEnabled, true);
});

test("R24 deterministic event/intent binding", () => {
  const accountId = "acc-r24";
  const count = counters();
  const captured = [];
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function capture(input) {
      captured.push({
        eventId: input.marketEvent.eventId,
        sequence: input.marketEvent.sequence,
        intentId: input.orderIntent.intentId,
      });
      return persistOkResult();
    }),
  });
  runtime.runStep(makeStepInput(accountId));
  runtime.runStep(makeStepInput(accountId));
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0], captured[1]);
  assert.equal(captured[0].eventId, "evt-11");
  assert.equal(captured[0].sequence, 11);
  assert.equal(captured[0].intentId, "intent-1");
});

test("R25 same-account single in-flight", async () => {
  const accountId = "acc-r25";
  const count = counters();
  let resolveExec;
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function delayed() {
      return new Promise(function wait(resolve) {
        resolveExec = resolve;
      });
    }),
  });
  const first = runtime.runStep(makeStepInput(accountId));
  assert.equal(typeof first.then, "function");
  assert.equal(count.execute, 1);
  const second = runtime.runStep(makeStepInput(accountId));
  assert.equal(second.runtimeAction, RUNTIME_ACTION.PAUSE);
  assert.equal(count.execute, 1);
  assert.equal(count.createAccount, 0);
  resolveExec(persistOkResult());
  const settled = await first;
  assert.equal(settled.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(count.execute, 1);
});

test("R26 restart-safe claim absent / MODE A explicit", () => {
  const src = runtimeSource();
  assert.equal(OPERATING_MODE.MODE_A_SINGLE_PROCESS_EPHEMERAL, "MODE_A_SINGLE_PROCESS_EPHEMERAL");
  assert.equal(src.includes("MODE_A_SINGLE_PROCESS_EPHEMERAL"), true);
  assert.equal(src.includes("restart-safe"), false);
  assert.equal(src.includes("multi-instance-safe"), false);
  const count = counters();
  const runtime = makeExecutableRuntime("acc-r26", count);
  assert.equal(runtime.OPERATING_MODE, OPERATING_MODE.MODE_A_SINGLE_PROCESS_EPHEMERAL);
});

test("R27 no Live/KB order reachability", () => {
  const src = runtimeSource();
  assert.equal(src.includes("LiveBroker"), false);
  assert.equal(src.includes("kb-order"), false);
  assert.equal(src.includes("placeOrder"), false);
  assert.equal(src.includes("submitOrder"), false);
  assert.equal(src.includes("require(\"http\")"), false);
  assert.equal(src.includes("require(\"node:http\")"), false);
  assert.equal(src.includes("require(\"fs\")"), false);
  assert.equal(src.includes("require(\"node:fs\")"), false);
  assert.equal(src.includes("Date.now"), false);
  assert.equal(src.includes("Math.random"), false);
});

test("R28 Paper/Live eligibility false", () => {
  const src = runtimeSource();
  assert.equal(src.includes("paperEligible: true"), false);
  assert.equal(src.includes("paperEligible:true"), false);
  assert.equal(src.includes("liveEligible: true"), false);
  assert.equal(src.includes("liveEligible:true"), false);
  const count = counters();
  const runtime = makeExecutableRuntime("acc-r28", count, {
    eligibilityReader: undefined,
  });
  const result = runtime.runStep(makeStepInput("acc-r28"));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
});

test("R29 inactive session → HALT_SESSION", () => {
  const accountId = "acc-r29";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    sessionValidator: inactiveSession(),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_SESSION);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
  assert.equal(count.createAccount, 0);
});

test("R30 paperEligible false → NOOP, risk 0, persist 0", () => {
  const accountId = "acc-r30";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    eligibilityReader: function falseReader() { return false; },
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(count.risk, 0);
  assert.equal(count.execute, 0);
});

test("R31 kill switch blocked → NOOP, persist 0", () => {
  const accountId = "acc-r31";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    killSwitch: { isOpen() { return false; } },
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(count.execute, 0);
  assert.equal(count.risk, 0);
});

test("R32 prototype-shaped account IDs safe", async () => {
  const ids = ["__proto__", "constructor", "prototype", "toString"];
  for (let i = 0; i < ids.length; i += 1) {
    const accountId = ids[i];
    const count = counters();
    let resolveExec;
    const runtime = makeExecutableRuntime(accountId, count, {
      persistence: mockPersistence(count, function delayed() {
        return new Promise(function wait(resolve) {
          resolveExec = resolve;
        });
      }),
    });
    const first = runtime.runStep(makeStepInput(accountId));
    const second = runtime.runStep(makeStepInput(accountId));
    assert.equal(second.runtimeAction, RUNTIME_ACTION.PAUSE, accountId);
    assert.equal(count.execute, 1, accountId);
    assert.equal(Object.prototype.polluted, undefined);
    resolveExec(persistOkResult());
    await first;
  }
  assert.equal(Object.prototype.hasOwnProperty("polluted"), false);
});

test("R33 different accounts not globally locked", async () => {
  const countA = counters();
  const countB = counters();
  let resolveA;
  const runtimeA = makeExecutableRuntime("acc-a", countA, {
    persistence: mockPersistence(countA, function delayed() {
      return new Promise(function wait(resolve) {
        resolveA = resolve;
      });
    }),
  });
  const runtimeB = makeExecutableRuntime("acc-b", countB);
  const pendingA = runtimeA.runStep(makeStepInput("acc-a"));
  assert.equal(countA.execute, 1);
  const resultB = runtimeB.runStep(makeStepInput("acc-b"));
  assert.equal(resultB.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(countB.execute, 1);
  resolveA(persistOkResult());
  const resultA = await pendingA;
  assert.equal(resultA.runtimeAction, RUNTIME_ACTION.ADVANCE);
});

test("R34 unknown persistence code → HALT_ACCOUNT", () => {
  const accountId = "acc-r34";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function unknownCode() {
      return persistErrorResult("PAPER_PERSISTENCE_SOME_NEW_CODE");
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.HALT_ACCOUNT);
  assert.equal(result.persistenceCode, "PAPER_PERSISTENCE_SOME_NEW_CODE");
  assert.equal(result.rootError.code, "PAPER_PERSISTENCE_SOME_NEW_CODE");
  assert.equal(count.execute, 1);
});

test("pre-consumption duplicate → NOOP via PAPER_DUPLICATE_EVENT", () => {
  const accountId = "acc-dup";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function dup() {
      return persistOkResult({
        persisted: false,
        replayed: false,
        revision: 0,
        domainResult: {
          ok: false,
          paperStatus: PAPER_STATUS.BLOCKED,
          errors: [{ code: ERROR.PAPER_DUPLICATE_EVENT }],
          errorCodes: [ERROR.PAPER_DUPLICATE_EVENT],
        },
      });
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.NOOP);
  assert.equal(result.rootError.code, ERROR.PAPER_DUPLICATE_EVENT);
  assert.equal(result.persisted, false);
  assert.equal(count.execute, 1);
});

test("pre-consumption out-of-order → PAUSE via PAPER_OUT_OF_ORDER_EVENT", () => {
  const accountId = "acc-ooo";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    persistence: mockPersistence(count, function ooo() {
      return persistOkResult({
        persisted: false,
        replayed: false,
        revision: 4,
        domainResult: {
          ok: false,
          paperStatus: PAPER_STATUS.BLOCKED,
          errors: [{ code: ERROR.PAPER_OUT_OF_ORDER_EVENT }],
          errorCodes: [ERROR.PAPER_OUT_OF_ORDER_EVENT],
        },
      });
    }),
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.PAUSE);
  assert.equal(result.rootError.code, ERROR.PAPER_OUT_OF_ORDER_EVENT);
  assert.equal(result.persisted, false);
  assert.equal(count.execute, 1);
});

test("telemetry throw does not retry persistence", () => {
  const accountId = "acc-tel";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count, {
    telemetry: function boom() {
      count.telemetry += 1;
      throw new Error("telemetry failed");
    },
  });
  const result = runtime.runStep(makeStepInput(accountId));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(count.execute, 1);
  assert.equal(count.telemetry, 1);
});

test("sessionRef is accepted as session token alias", () => {
  const accountId = "acc-ref";
  const count = counters();
  const runtime = makeExecutableRuntime(accountId, count);
  const result = runtime.runStep(makeStepInput(accountId, { sessionRef: "ref-1" }));
  assert.equal(result.runtimeAction, RUNTIME_ACTION.ADVANCE);
  assert.equal(count.execute, 1);
});

test("no test-only backdoor identifiers in runtime source", () => {
  const src = runtimeSource();
  assert.equal(src.includes("allowUnsafePaperForTest"), false);
  assert.equal(src.includes("skipApproval"), false);
  assert.equal(src.includes("disableSafety"), false);
  assert.equal(src.includes("forceEligible"), false);
  assert.equal(src.includes(".only("), false);
  const testSrc = fs.readFileSync(__filename, "utf8");
  assert.equal(testSrc.includes("describe" + ".only("), false);
  assert.equal(testSrc.includes("test" + ".only("), false);
  assert.equal(new RegExp("\\btest\\.skip\\s*\\(").test(testSrc), false);
});
