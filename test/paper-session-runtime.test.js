"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createPaperSessionManager,
  SESSION_STATE,
  PAPER_SESSION_ERROR,
} = require("../lib/paper/paper-session-manager");
const {
  createPaperSessionRuntime,
  RUNTIME_ACTION,
} = require("../lib/paper/paper-session-runtime");

const LIB_DIR = path.join(__dirname, "..", "lib", "paper");
const WRAPPER_SOURCE_PATH = path.join(LIB_DIR, "paper-session-runtime.js");
const MANAGER_SOURCE_PATH = path.join(LIB_DIR, "paper-session-manager.js");

function wrapperSource() {
  return fs.readFileSync(WRAPPER_SOURCE_PATH, "utf8");
}

function managerSource() {
  return fs.readFileSync(MANAGER_SOURCE_PATH, "utf8");
}

function bothSources() {
  return [
    { name: "paper-session-runtime.js", src: wrapperSource() },
    { name: "paper-session-manager.js", src: managerSource() },
  ];
}

function requireSpecifiers(src) {
  const out = [];
  const re = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match = re.exec(src);
  while (match !== null) {
    out.push(match[1]);
    match = re.exec(src);
  }
  return out;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise(function wait(resolve) { setImmediate(resolve); });
}

function okReader() {
  return { found: true, quarantined: false };
}

function makeManager(reader) {
  return createPaperSessionManager({
    accountStatusReader: typeof reader === "function" ? reader : okReader,
  });
}

function makeFakeRuntime(control) {
  const c = control;
  c.callCount = 0;
  c.inputs = [];
  const runtime = {
    runStep: function runStep(input) {
      c.callCount += 1;
      c.inputs.push(input);
      if (typeof c.impl === "function") {
        return c.impl(input, c.callCount);
      }
      return advance();
    },
  };
  return runtime;
}

function makeWrapper(manager, control) {
  return createPaperSessionRuntime({
    sessionManager: manager,
    paperRuntime: makeFakeRuntime(control),
  });
}

async function createActiveSession(manager, accountId) {
  const created = await manager.createSession(accountId);
  assert.equal(created.ok, true, "setup createSession must succeed");
  const activated = await manager.activate(created.session.sessionId);
  assert.equal(activated.ok, true, "setup activate must succeed");
  assert.equal(activated.session.state, SESSION_STATE.ACTIVE);
  return activated.session;
}

function makeInput(accountId, sessionToken, extras) {
  const base = {
    accountId: accountId,
    sessionToken: sessionToken,
    eventId: "evt-1",
    sequence: 11,
  };
  if (!extras) return base;
  return Object.assign(base, extras);
}

function advance(overrides) {
  return Object.assign({ ok: true, runtimeAction: RUNTIME_ACTION.ADVANCE }, overrides || {});
}

function noop(overrides) {
  return Object.assign({ ok: true, runtimeAction: RUNTIME_ACTION.NOOP }, overrides || {});
}

function pauseAction(overrides) {
  return Object.assign({ ok: false, runtimeAction: RUNTIME_ACTION.PAUSE }, overrides || {});
}

function haltAccount(persistenceCode, overrides) {
  return Object.assign({
    ok: false,
    runtimeAction: RUNTIME_ACTION.HALT_ACCOUNT,
    persistenceCode: persistenceCode,
    rootError: { code: persistenceCode },
  }, overrides || {});
}

function haltSession(overrides) {
  return Object.assign({
    ok: false,
    runtimeAction: RUNTIME_ACTION.HALT_SESSION,
  }, overrides || {});
}

function stateOf(manager, sessionId) {
  const got = manager.getSession(sessionId);
  assert.equal(got.ok, true, "getSession must succeed for stored session");
  return got.session.state;
}

function haltCodeOf(manager, sessionId) {
  const got = manager.getSession(sessionId);
  assert.equal(got.ok, true);
  return got.session.haltCode;
}

const WRAPPER_RESULT_KEYS = [
  "accountId",
  "ok",
  "processGenerationId",
  "rootError",
  "runtimeInvoked",
  "runtimeResult",
  "sessionId",
  "sessionState",
];

test("S19 runtime ADVANCE leaves ACTIVE", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s19");

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-s19", session.sessionId));

  assert.equal(result.ok, true);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.ACTIVE);
  assert.equal(result.sessionId, session.sessionId);
  assert.equal(result.accountId, "acc-s19");
  assert.equal(result.processGenerationId, session.processGenerationId);
  assert.equal(result.rootError, null);
  assert.equal(control.callCount, 1);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
  assert.deepEqual(Object.keys(result).sort(), WRAPPER_RESULT_KEYS);
});

test("S20 runtime NOOP leaves ACTIVE", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s20");

  control.impl = function impl() { return noop(); };
  const result = await wrapper.runStep(makeInput("acc-s20", session.sessionId));

  assert.equal(result.ok, true);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.ACTIVE);
  assert.equal(control.callCount, 1);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);

  const again = await wrapper.runStep(makeInput("acc-s20", session.sessionId));
  assert.equal(again.runtimeInvoked, true);
  assert.equal(control.callCount, 2);
});

test("S21 runtime PAUSE pauses session and blocks further runtime calls", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s21");

  control.impl = function impl() { return pauseAction(); };
  const paused = await wrapper.runStep(makeInput("acc-s21", session.sessionId));
  assert.equal(paused.ok, false);
  assert.equal(paused.runtimeInvoked, true);
  assert.equal(paused.sessionState, SESSION_STATE.PAUSED);
  assert.equal(control.callCount, 1);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);

  control.impl = function implAdvance() { return advance(); };
  const blocked = await wrapper.runStep(makeInput("acc-s21", session.sessionId));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.runtimeInvoked, false);
  assert.equal(blocked.runtimeResult, null);
  assert.equal(blocked.sessionState, SESSION_STATE.PAUSED);
  assert.equal(blocked.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);
  assert.equal(control.callCount, 1, "runtime must not be invoked while PAUSED");

  const resumed = await manager.resume(session.sessionId);
  assert.equal(resumed.ok, true);
  const afterResume = await wrapper.runStep(makeInput("acc-s21", session.sessionId));
  assert.equal(afterResume.ok, true);
  assert.equal(afterResume.runtimeInvoked, true);
  assert.equal(control.callCount, 2);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("S22 runtime HALT_ACCOUNT halts session", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s22");

  control.impl = function impl() { return haltAccount("PAPER_PERSISTENCE_COMMIT_FAILED"); };
  const result = await wrapper.runStep(makeInput("acc-s22", session.sessionId));

  assert.equal(result.ok, false);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.HALTED);
  assert.equal(result.rootError.code, "PAPER_PERSISTENCE_COMMIT_FAILED");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.HALTED);
  assert.equal(haltCodeOf(manager, session.sessionId), "PAPER_PERSISTENCE_COMMIT_FAILED");
  assert.equal(control.callCount, 1);
});

test("S23 runtime HALT_SESSION halts session", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const bare = await createActiveSession(manager, "acc-s23-bare");

  control.impl = function impl() { return haltSession(); };
  const bareResult = await wrapper.runStep(makeInput("acc-s23-bare", bare.sessionId));
  assert.equal(bareResult.ok, false);
  assert.equal(bareResult.runtimeInvoked, true);
  assert.equal(bareResult.sessionState, SESSION_STATE.HALTED);
  assert.equal(stateOf(manager, bare.sessionId), SESSION_STATE.HALTED);
  assert.equal(haltCodeOf(manager, bare.sessionId), RUNTIME_ACTION.HALT_SESSION);

  const notFound = await createActiveSession(manager, "acc-s23-missing");
  control.impl = function implMissing() {
    return haltSession({
      persistenceCode: "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND",
      rootError: { code: "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND" },
    });
  };
  const missingResult = await wrapper.runStep(makeInput("acc-s23-missing", notFound.sessionId));
  assert.equal(missingResult.sessionState, SESSION_STATE.HALTED);
  assert.equal(missingResult.rootError.code, "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND");
  assert.equal(haltCodeOf(manager, notFound.sessionId), "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND");
  assert.equal(control.callCount, 2);
});

test("S24 COMMIT_UNKNOWN halt blocks next event", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s24");
  const input = makeInput("acc-s24", session.sessionId);

  const entered = deferred();
  const gate = deferred();
  control.impl = function impl() {
    entered.resolve();
    return gate.promise.then(function afterBarrier() {
      return haltAccount("PAPER_PERSISTENCE_COMMIT_UNKNOWN");
    });
  };

  const first = wrapper.runStep(input);
  await entered.promise;
  assert.equal(control.callCount, 1);

  let firstSettled = false;
  first.then(function markFirst() { firstSettled = true; });
  const second = wrapper.runStep(input);
  let secondSettled = false;
  second.then(function markSecond() { secondSettled = true; });

  await flush();
  assert.equal(firstSettled, false, "first step must still hold the account lock");
  assert.equal(secondSettled, false, "second step must be queued behind the lock");
  assert.equal(control.callCount, 1, "second step must not reach the runtime while queued");

  gate.resolve();
  const firstResult = await first;
  const secondResult = await second;

  assert.equal(control.callCount, 1, "halted session must not invoke the runtime again");
  assert.equal(firstResult.runtimeInvoked, true);
  assert.equal(firstResult.sessionState, SESSION_STATE.HALTED);
  assert.equal(firstResult.rootError.code, "PAPER_PERSISTENCE_COMMIT_UNKNOWN");
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.runtimeInvoked, false);
  assert.equal(secondResult.runtimeResult, null);
  assert.equal(secondResult.sessionState, SESSION_STATE.HALTED);
  assert.equal(secondResult.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.HALTED);
  assert.equal(haltCodeOf(manager, session.sessionId), "PAPER_PERSISTENCE_COMMIT_UNKNOWN");
});

test("S25 CORRUPT_STATE halt blocks next event", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s25");
  const input = makeInput("acc-s25", session.sessionId);

  control.impl = function impl() { return haltAccount("PAPER_PERSISTENCE_CORRUPT_STATE"); };
  const first = await wrapper.runStep(input);
  assert.equal(first.runtimeInvoked, true);
  assert.equal(first.sessionState, SESSION_STATE.HALTED);
  assert.equal(first.rootError.code, "PAPER_PERSISTENCE_CORRUPT_STATE");
  assert.equal(haltCodeOf(manager, session.sessionId), "PAPER_PERSISTENCE_CORRUPT_STATE");
  assert.equal(control.callCount, 1);

  control.impl = function implAdvance() { return advance(); };
  const second = await wrapper.runStep(input);
  assert.equal(second.ok, false);
  assert.equal(second.runtimeInvoked, false);
  assert.equal(second.sessionState, SESSION_STATE.HALTED);
  assert.equal(second.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);
  assert.equal(control.callCount, 1);
});

test("S26 ACCOUNT_NOT_FOUND halt blocks next event", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s26");
  const input = makeInput("acc-s26", session.sessionId);

  control.impl = function impl() {
    return haltSession({
      persistenceCode: "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND",
      rootError: { code: "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND" },
    });
  };
  const first = await wrapper.runStep(input);
  assert.equal(first.runtimeInvoked, true);
  assert.equal(first.sessionState, SESSION_STATE.HALTED);
  assert.equal(first.rootError.code, "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND");
  assert.equal(haltCodeOf(manager, session.sessionId), "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND");
  assert.equal(control.callCount, 1);

  control.impl = function implAdvance() { return advance(); };
  const second = await wrapper.runStep(input);
  assert.equal(second.runtimeInvoked, false);
  assert.equal(second.sessionState, SESSION_STATE.HALTED);
  assert.equal(second.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);
  assert.equal(control.callCount, 1);
});

test("S28 pause/run race safe", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s28");

  const entered = deferred();
  const gate = deferred();
  const order = [];
  control.impl = function impl() {
    order.push("runtime-entered");
    entered.resolve();
    return gate.promise.then(function afterBarrier() { return advance(); });
  };

  const runPromise = wrapper.runStep(makeInput("acc-s28", session.sessionId))
    .then(function markRun(r) { order.push("run-settled"); return r; });

  await entered.promise;

  const pausePromise = manager.pause(session.sessionId)
    .then(function markPause(r) { order.push("pause-settled"); return r; });

  await flush();
  assert.deepEqual(order, ["runtime-entered"], "pause must not complete while the run holds the lock");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);

  gate.resolve();
  const runResult = await runPromise;
  const pauseResult = await pausePromise;

  assert.equal(control.callCount <= 1, true);
  assert.equal(control.callCount, 1, "run acquired the lock first, so the runtime ran exactly once");
  assert.deepEqual(order, ["runtime-entered", "run-settled", "pause-settled"]);
  assert.equal(runResult.runtimeInvoked, true);
  assert.equal(runResult.sessionState, SESSION_STATE.ACTIVE, "ADVANCE leaves the session ACTIVE");
  assert.equal(pauseResult.ok, true);
  assert.equal(pauseResult.session.state, SESSION_STATE.PAUSED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);

  control.impl = function implAdvance() { return advance(); };
  const afterPause = await wrapper.runStep(makeInput("acc-s28", session.sessionId));
  assert.equal(afterPause.runtimeInvoked, false, "no execution after pause completed");
  assert.equal(control.callCount, 1);
});

test("S29 halt/run race safe", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s29");

  const entered = deferred();
  const gate = deferred();
  const order = [];
  control.impl = function impl() {
    order.push("runtime-entered");
    entered.resolve();
    return gate.promise.then(function afterBarrier() { return advance(); });
  };

  const runPromise = wrapper.runStep(makeInput("acc-s29", session.sessionId))
    .then(function markRun(r) { order.push("run-settled"); return r; });

  await entered.promise;

  const haltPromise = manager.halt(session.sessionId, "OPERATOR_HALT")
    .then(function markHalt(r) { order.push("halt-settled"); return r; });

  await flush();
  assert.deepEqual(order, ["runtime-entered"], "halt must not complete while the run holds the lock");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);

  gate.resolve();
  const runResult = await runPromise;
  const haltResult = await haltPromise;

  assert.equal(control.callCount, 1, "run acquired the lock first, so the runtime ran exactly once");
  assert.deepEqual(order, ["runtime-entered", "run-settled", "halt-settled"]);
  assert.equal(runResult.runtimeInvoked, true);
  assert.equal(runResult.sessionState, SESSION_STATE.ACTIVE);
  assert.equal(haltResult.ok, true);
  assert.equal(haltResult.session.state, SESSION_STATE.HALTED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.HALTED);

  const afterHalt = await wrapper.runStep(makeInput("acc-s29", session.sessionId));
  assert.equal(afterHalt.runtimeInvoked, false, "no execution after halt completed");
  assert.equal(afterHalt.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);
  assert.equal(control.callCount, 1);
});

test("S34 ACTIVE does not imply approval", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s34");

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-s34", session.sessionId));
  const record = manager.getSession(session.sessionId).session;
  const approvalKeys = ["approval", "approved", "approvalOpen", "approvalId", "approvalAuthority"];

  for (let i = 0; i < approvalKeys.length; i += 1) {
    assert.equal(Object.prototype.hasOwnProperty.call(record, approvalKeys[i]), false, approvalKeys[i]);
    assert.equal(Object.prototype.hasOwnProperty.call(result, approvalKeys[i]), false, approvalKeys[i]);
  }
  assert.deepEqual(Object.keys(result).sort(), WRAPPER_RESULT_KEYS);

  const sources = bothSources();
  for (let i = 0; i < sources.length; i += 1) {
    assert.equal(sources[i].src.includes("approval"), false, sources[i].name);
    assert.equal(sources[i].src.includes("approved"), false, sources[i].name);
  }
});

test("S35 ACTIVE does not bypass kill switch", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s35");

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-s35", session.sessionId));
  const record = manager.getSession(session.sessionId).session;
  const killKeys = ["killSwitchBypass", "isExecutionAllowed", "killSwitch", "bypassKillSwitch"];

  for (let i = 0; i < killKeys.length; i += 1) {
    assert.equal(Object.prototype.hasOwnProperty.call(record, killKeys[i]), false, killKeys[i]);
    assert.equal(Object.prototype.hasOwnProperty.call(result, killKeys[i]), false, killKeys[i]);
  }

  const sources = bothSources();
  for (let i = 0; i < sources.length; i += 1) {
    assert.equal(sources[i].src.includes("killSwitch"), false, sources[i].name);
    assert.equal(sources[i].src.includes("isExecutionAllowed"), false, sources[i].name);
  }
});

test("S36 ACTIVE does not imply market open", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s36");

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-s36", session.sessionId));
  const record = manager.getSession(session.sessionId).session;
  const marketKeys = ["marketOpen", "tradingOpen", "sessionOpen", "isMarketOpen"];

  for (let i = 0; i < marketKeys.length; i += 1) {
    assert.equal(Object.prototype.hasOwnProperty.call(record, marketKeys[i]), false, marketKeys[i]);
    assert.equal(Object.prototype.hasOwnProperty.call(result, marketKeys[i]), false, marketKeys[i]);
  }

  const sources = bothSources();
  for (let i = 0; i < sources.length; i += 1) {
    assert.equal(sources[i].src.includes("marketOpen"), false, sources[i].name);
    assert.equal(sources[i].src.includes("tradingOpen"), false, sources[i].name);
  }
});

test("S38 no Live/KB order reachability", () => {
  const forbidden = [
    "LiveBroker",
    "kb-order",
    "placeOrder",
    "submitOrder",
    "require(\"http\")",
    "require(\"node:http\")",
    "require(\"fs\")",
    "require(\"node:fs\")",
    "Date.now",
    "Math.random",
  ];
  const sources = bothSources();
  assert.equal(sources.length, 2);

  for (let i = 0; i < sources.length; i += 1) {
    const entry = sources[i];
    assert.equal(entry.src.length > 0, true, entry.name);
    for (let f = 0; f < forbidden.length; f += 1) {
      assert.equal(entry.src.includes(forbidden[f]), false, entry.name + " :: " + forbidden[f]);
    }
  }
});

test("S39 Paper/Live eligibility never flipped true", () => {
  const forbidden = [
    "paperEligible: true",
    "paperEligible:true",
    "paperEligible = true",
    "paperEligible=true",
    "liveEligible: true",
    "liveEligible:true",
    "liveEligible = true",
    "liveEligible=true",
  ];
  const sources = bothSources();
  for (let i = 0; i < sources.length; i += 1) {
    const entry = sources[i];
    for (let f = 0; f < forbidden.length; f += 1) {
      assert.equal(entry.src.includes(forbidden[f]), false, entry.name + " :: " + forbidden[f]);
    }
  }
});

test("S40 no financial mutation", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s40");

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-s40", session.sessionId));
  const record = manager.getSession(session.sessionId).session;

  assert.deepEqual(
    Object.keys(record).sort(),
    ["accountId", "processGenerationId", "sessionId", "state"],
  );
  const financialKeys = ["cash", "positions", "ledger", "balance", "pnl", "equity", "fills", "orders"];
  for (let i = 0; i < financialKeys.length; i += 1) {
    assert.equal(Object.prototype.hasOwnProperty.call(record, financialKeys[i]), false, financialKeys[i]);
    assert.equal(Object.prototype.hasOwnProperty.call(result, financialKeys[i]), false, financialKeys[i]);
  }

  assert.deepEqual(requireSpecifiers(wrapperSource()), ["./paper-session-manager"]);
  assert.deepEqual(requireSpecifiers(managerSource()), ["node:crypto"]);

  const sources = bothSources();
  const forbiddenTokens = ["cash", "positions", "executePaper", "portfolio-ledger", "paper-ledger-stepper"];
  for (let i = 0; i < sources.length; i += 1) {
    for (let f = 0; f < forbiddenTokens.length; f += 1) {
      assert.equal(
        sources[i].src.includes(forbiddenTokens[f]),
        false,
        sources[i].name + " :: " + forbiddenTokens[f],
      );
    }
  }
});

test("S41 validate + run + ADVANCE is one atomic lifecycle step", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s41");

  let stateSeenInsideRuntime = null;
  control.impl = function impl() {
    stateSeenInsideRuntime = stateOf(manager, session.sessionId);
    return advance();
  };

  const result = await wrapper.runStep(makeInput("acc-s41", session.sessionId));
  assert.equal(stateSeenInsideRuntime, SESSION_STATE.ACTIVE);
  assert.equal(result.ok, true);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.ACTIVE);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
  assert.equal(manager.validateActiveSession(session.sessionId, "acc-s41").active, true);
  assert.equal(control.callCount, 1);
});

test("S42 PAUSE is applied before the next validation", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s42");

  control.impl = function impl() { return pauseAction(); };
  const result = await wrapper.runStep(makeInput("acc-s42", session.sessionId));
  assert.equal(result.sessionState, SESSION_STATE.PAUSED);

  const check = manager.validateActiveSession(session.sessionId, "acc-s42");
  assert.equal(check.active, false);
  assert.equal(check.state, SESSION_STATE.PAUSED);
  assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);

  control.impl = function implAdvance() { return advance(); };
  const next = await wrapper.runStep(makeInput("acc-s42", session.sessionId));
  assert.equal(next.runtimeInvoked, false);
  assert.equal(next.sessionState, SESSION_STATE.PAUSED);
  assert.equal(control.callCount, 1);
});

test("S43 HALT is applied before the next validation", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s43");

  control.impl = function impl() { return haltAccount("PAPER_PERSISTENCE_COMMIT_FAILED"); };
  const result = await wrapper.runStep(makeInput("acc-s43", session.sessionId));
  assert.equal(result.sessionState, SESSION_STATE.HALTED);

  const check = manager.validateActiveSession(session.sessionId, "acc-s43");
  assert.equal(check.active, false);
  assert.equal(check.state, SESSION_STATE.HALTED);
  assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);

  control.impl = function implAdvance() { return advance(); };
  const next = await wrapper.runStep(makeInput("acc-s43", session.sessionId));
  assert.equal(next.runtimeInvoked, false);
  assert.equal(next.sessionState, SESSION_STATE.HALTED);
  assert.equal(control.callCount, 1);
});

test("S44 unknown runtimeAction halts the session", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s44");

  control.impl = function impl() { return { ok: true, runtimeAction: "WEIRD" }; };
  const result = await wrapper.runStep(makeInput("acc-s44", session.sessionId));
  assert.equal(result.ok, false, "unknown action must not report success");
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.HALTED);
  assert.equal(haltCodeOf(manager, session.sessionId), "UNKNOWN_RUNTIME_ACTION");

  const next = await wrapper.runStep(makeInput("acc-s44", session.sessionId));
  assert.equal(next.runtimeInvoked, false);
  assert.equal(next.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);
  assert.equal(control.callCount, 1);

  const missingAction = await createActiveSession(manager, "acc-s44-missing");
  control.impl = function implMissing() { return { ok: true }; };
  const missingResult = await wrapper.runStep(makeInput("acc-s44-missing", missingAction.sessionId));
  assert.equal(missingResult.sessionState, SESSION_STATE.HALTED);
  assert.equal(haltCodeOf(manager, missingAction.sessionId), "UNKNOWN_RUNTIME_ACTION");
});

test("S45 runtime throw halts session and releases the lock", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-s45");

  control.impl = function impl() { throw new Error("runtime exploded"); };
  const result = await wrapper.runStep(makeInput("acc-s45", session.sessionId));
  assert.equal(result.ok, false);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.runtimeResult, null);
  assert.equal(result.sessionState, SESSION_STATE.HALTED);
  assert.equal(result.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);
  assert.equal(haltCodeOf(manager, session.sessionId), "RUNTIME_THROW");
  assert.equal(control.callCount, 1);

  const otherAccount = await manager.createSession("acc-s45-other");
  assert.equal(otherAccount.ok, true, "lock must be released for other accounts");
  const otherActive = await manager.activate(otherAccount.session.sessionId);
  assert.equal(otherActive.ok, true);
  const otherHalt = await manager.halt(otherAccount.session.sessionId, "OTHER_HALT");
  assert.equal(otherHalt.ok, true);

  control.impl = function implAdvance() { return advance(); };
  const blocked = await wrapper.runStep(makeInput("acc-s45", session.sessionId));
  assert.equal(blocked.runtimeInvoked, false);
  assert.equal(blocked.sessionState, SESSION_STATE.HALTED);
  assert.equal(control.callCount, 1);

  const reborn = await manager.createSession("acc-s45");
  assert.equal(reborn.ok, true, "lock must be released for the halted account too");
  assert.notEqual(reborn.session.sessionId, session.sessionId);
  const rebornActive = await manager.activate(reborn.session.sessionId);
  assert.equal(rebornActive.ok, true);
  const rebornRun = await wrapper.runStep(makeInput("acc-s45", reborn.session.sessionId));
  assert.equal(rebornRun.ok, true);
  assert.equal(rebornRun.runtimeInvoked, true);
  assert.equal(control.callCount, 2);
});

test("S46 different accounts can run concurrently", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const sessionA = await createActiveSession(manager, "acc-s46-a");
  const sessionB = await createActiveSession(manager, "acc-s46-b");

  const enteredA = deferred();
  const gateA = deferred();
  control.impl = function impl(input) {
    if (input.accountId === "acc-s46-a") {
      enteredA.resolve();
      return gateA.promise.then(function afterBarrier() { return advance(); });
    }
    return advance();
  };

  let aSettled = false;
  const promiseA = wrapper.runStep(makeInput("acc-s46-a", sessionA.sessionId))
    .then(function markA(r) { aSettled = true; return r; });

  await enteredA.promise;
  assert.equal(control.callCount, 1);

  const resultB = await wrapper.runStep(makeInput("acc-s46-b", sessionB.sessionId));
  assert.equal(control.callCount, 2, "account B must run while account A is still in flight");
  assert.equal(aSettled, false, "account A must still be in flight");
  assert.equal(resultB.ok, true);
  assert.equal(resultB.runtimeInvoked, true);
  assert.equal(resultB.sessionState, SESSION_STATE.ACTIVE);

  gateA.resolve();
  const resultA = await promiseA;
  assert.equal(aSettled, true);
  assert.equal(resultA.ok, true);
  assert.equal(resultA.runtimeInvoked, true);
  assert.equal(resultA.sessionState, SESSION_STATE.ACTIVE);
  assert.equal(control.callCount, 2);
});

test("wrapper on PAUSED session refuses without halting", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-paused-refuse");
  const paused = await manager.pause(session.sessionId);
  assert.equal(paused.ok, true);

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-paused-refuse", session.sessionId));
  assert.equal(result.ok, false);
  assert.equal(result.runtimeInvoked, false);
  assert.equal(result.sessionState, SESSION_STATE.PAUSED);
  assert.equal(result.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);
  assert.notEqual(result.sessionState, SESSION_STATE.HALTED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);
  assert.equal(control.callCount, 0);
});

test("wrapper on CREATED session refuses without mutating", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const created = await manager.createSession("acc-created-refuse");
  assert.equal(created.ok, true);

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep(makeInput("acc-created-refuse", created.session.sessionId));
  assert.equal(result.ok, false);
  assert.equal(result.runtimeInvoked, false);
  assert.equal(result.sessionState, SESSION_STATE.CREATED);
  assert.equal(result.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);
  assert.equal(stateOf(manager, created.session.sessionId), SESSION_STATE.CREATED);
  assert.equal(control.callCount, 0);
});

test("wrapper on CLOSED and unknown sessions refuses", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-closed-refuse");
  await manager.close(session.sessionId);

  control.impl = function impl() { return advance(); };
  const closed = await wrapper.runStep(makeInput("acc-closed-refuse", session.sessionId));
  assert.equal(closed.runtimeInvoked, false);
  assert.equal(closed.sessionState, SESSION_STATE.CLOSED);
  assert.equal(closed.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);

  const unknown = await wrapper.runStep(makeInput("acc-closed-refuse", "no-such-session"));
  assert.equal(unknown.runtimeInvoked, false);
  assert.equal(unknown.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);

  const mismatch = await createActiveSession(manager, "acc-mismatch-owner");
  const wrongAccount = await wrapper.runStep(makeInput("acc-other", mismatch.sessionId));
  assert.equal(wrongAccount.runtimeInvoked, false);
  assert.equal(wrongAccount.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_MISMATCH);
  assert.equal(stateOf(manager, mismatch.sessionId), SESSION_STATE.ACTIVE);

  assert.equal(control.callCount, 0);
});

test("HALT_SESSION with rootError.field sessionToken leaves the session ACTIVE", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-halt-session-token");

  control.impl = function impl() {
    return haltSession({ rootError: { code: "PAPER_INVALID_INPUT", field: "sessionToken" } });
  };
  const result = await wrapper.runStep(makeInput("acc-halt-session-token", session.sessionId));

  assert.equal(result.ok, false);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.ACTIVE);
  assert.equal(result.rootError.code, "PAPER_INVALID_INPUT");
  assert.equal(result.rootError.field, "sessionToken");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);

  control.impl = function implAdvance() { return advance(); };
  const next = await wrapper.runStep(makeInput("acc-halt-session-token", session.sessionId));
  assert.equal(next.ok, true);
  assert.equal(next.runtimeInvoked, true);
  assert.equal(control.callCount, 2);
});

test("MALFORMED_SESSION_INPUT: HALT_SESSION PAPER_INVALID_INPUT on a non-token field halts", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-malformed-session-input");

  control.impl = function impl() {
    return haltSession({ rootError: { code: "PAPER_INVALID_INPUT", field: "marketEvent" } });
  };
  const result = await wrapper.runStep(makeInput("acc-malformed-session-input", session.sessionId));

  assert.equal(result.ok, false);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionState, SESSION_STATE.HALTED);
  assert.equal(result.rootError.code, "PAPER_INVALID_INPUT");
  assert.equal(result.rootError.field, "marketEvent");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.HALTED);
  assert.equal(haltCodeOf(manager, session.sessionId), RUNTIME_ACTION.HALT_SESSION);

  const next = await wrapper.runStep(makeInput("acc-malformed-session-input", session.sessionId));
  assert.equal(next.runtimeInvoked, false);
  assert.equal(control.callCount, 1);
});

test("malformed wrapper input rejected without invoking the runtime", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-bad-input");
  control.impl = function impl() { return advance(); };

  const cases = [
    ["null input", null, "input"],
    ["undefined input", undefined, "input"],
    ["string input", "acc-bad-input", "input"],
    ["array input", [], "input"],
    ["missing accountId", { sessionToken: session.sessionId }, "accountId"],
    ["empty accountId", { accountId: "", sessionToken: session.sessionId }, "accountId"],
    ["numeric accountId", { accountId: 1, sessionToken: session.sessionId }, "accountId"],
    ["boxed accountId", { accountId: new String("acc-bad-input"), sessionToken: session.sessionId }, "accountId"],
    ["missing sessionToken", { accountId: "acc-bad-input" }, "sessionToken"],
    ["empty sessionToken", { accountId: "acc-bad-input", sessionToken: "" }, "sessionToken"],
    ["boxed sessionToken", { accountId: "acc-bad-input", sessionToken: new String(session.sessionId) }, "sessionToken"],
    ["numeric sessionToken", { accountId: "acc-bad-input", sessionToken: 7 }, "sessionToken"],
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const label = cases[i][0];
    const promise = wrapper.runStep(cases[i][1]);
    assert.equal(typeof promise.then, "function", label);
    const result = await promise;
    assert.equal(result.ok, false, label);
    assert.equal(result.runtimeInvoked, false, label);
    assert.equal(result.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, label);
    assert.equal(result.rootError.field, cases[i][2], label);
  }

  assert.equal(control.callCount, 0);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("sessionRef is accepted as a sessionToken alias", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-session-ref");

  control.impl = function impl() { return advance(); };
  const result = await wrapper.runStep({
    accountId: "acc-session-ref",
    sessionRef: session.sessionId,
    eventId: "evt-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.runtimeInvoked, true);
  assert.equal(result.sessionId, session.sessionId);
  assert.equal(control.callCount, 1);
});

test("runStep always returns a promise and forwards the caller input unchanged", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-forward");

  control.impl = function impl() { return advance(); };
  const input = makeInput("acc-forward", session.sessionId, { symbol: "AAA" });
  const promise = wrapper.runStep(input);
  assert.equal(typeof promise.then, "function");
  await promise;

  assert.equal(control.inputs.length, 1);
  assert.equal(control.inputs[0], input);
  assert.deepEqual(input, makeInput("acc-forward", session.sessionId, { symbol: "AAA" }));
});

test("wrapper preserves the runtime rootError instead of a generic code", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-root-error");

  control.impl = function impl() {
    return haltAccount("PAPER_PERSISTENCE_RETRY_EXHAUSTED", {
      rootError: { code: "PAPER_PERSISTENCE_RETRY_EXHAUSTED", field: "commit" },
    });
  };
  const result = await wrapper.runStep(makeInput("acc-root-error", session.sessionId));
  assert.equal(result.rootError.code, "PAPER_PERSISTENCE_RETRY_EXHAUSTED");
  assert.equal(result.rootError.field, "commit");
  assert.notEqual(result.rootError.code, "ERROR");
  assert.equal(result.runtimeResult.persistenceCode, "PAPER_PERSISTENCE_RETRY_EXHAUSTED");
});

test("thenable runtime results are awaited before the session state is applied", async () => {
  const manager = makeManager();
  const control = {};
  const wrapper = makeWrapper(manager, control);
  const session = await createActiveSession(manager, "acc-thenable");

  control.impl = function impl() { return Promise.resolve(pauseAction()); };
  const result = await wrapper.runStep(makeInput("acc-thenable", session.sessionId));
  assert.equal(result.sessionState, SESSION_STATE.PAUSED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);
});

test("factory validates its dependencies", () => {
  const manager = makeManager();
  assert.throws(function noDeps() { createPaperSessionRuntime(); }, /sessionManager/);
  assert.throws(function noRuntime() {
    createPaperSessionRuntime({ sessionManager: manager });
  }, /paperRuntime/);
  assert.throws(function badRuntime() {
    createPaperSessionRuntime({ sessionManager: manager, paperRuntime: { runStep: "nope" } });
  }, /paperRuntime/);
  assert.throws(function badManager() {
    createPaperSessionRuntime({ sessionManager: {}, paperRuntime: { runStep() { return advance(); } } });
  }, /sessionManager/);
});
