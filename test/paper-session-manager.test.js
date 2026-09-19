"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createPaperSessionManager,
  SESSION_STATE,
  PAPER_SESSION_ERROR,
  OPERATING_MODE,
} = require("../lib/paper/paper-session-manager");

const MANAGER_SOURCE_PATH = path.join(__dirname, "..", "lib", "paper", "paper-session-manager.js");

function managerSource() {
  return fs.readFileSync(MANAGER_SOURCE_PATH, "utf8");
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

function okReader() {
  return { found: true, quarantined: false };
}

function makeManager(reader) {
  return createPaperSessionManager({
    accountStatusReader: typeof reader === "function" ? reader : okReader,
  });
}

function mutableReader(initial) {
  const state = {
    status: initial || { found: true, quarantined: false },
    calls: 0,
  };
  state.reader = function reader() {
    state.calls += 1;
    return state.status;
  };
  return state;
}

async function createdSession(manager, accountId) {
  const created = await manager.createSession(accountId);
  assert.equal(created.ok, true, "setup createSession must succeed");
  return created.session;
}

async function activeSession(manager, accountId) {
  const session = await createdSession(manager, accountId);
  const activated = await manager.activate(session.sessionId);
  assert.equal(activated.ok, true, "setup activate must succeed");
  assert.equal(activated.session.state, SESSION_STATE.ACTIVE);
  return activated.session;
}

function stateOf(manager, sessionId) {
  const got = manager.getSession(sessionId);
  assert.equal(got.ok, true, "getSession must succeed for stored session");
  return got.session.state;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MALFORMED_IDS = [
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  ["number", 1],
  ["boolean", true],
  ["object", {}],
  ["array", []],
  ["boxed String", new String("boxed")],
];

test("S01 create session", async () => {
  const manager = makeManager();
  const created = await manager.createSession("acc-s01");
  assert.equal(created.ok, true);
  assert.equal(created.rootError, null);
  assert.equal(created.session.accountId, "acc-s01");
  assert.equal(created.session.state, SESSION_STATE.CREATED);
  assert.equal(typeof created.session.sessionId, "string");
  assert.equal(created.session.sessionId.length > 0, true);
  assert.equal(UUID_RE.test(created.session.processGenerationId), true);
  assert.deepEqual(
    Object.keys(created.session).sort(),
    ["accountId", "processGenerationId", "sessionId", "state"],
  );
});

test("S02 activate valid CREATED", async () => {
  const manager = makeManager();
  const session = await createdSession(manager, "acc-s02");
  const activated = await manager.activate(session.sessionId);
  assert.equal(activated.ok, true);
  assert.equal(activated.rootError, null);
  assert.equal(activated.session.state, SESSION_STATE.ACTIVE);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("S03 only ACTIVE validates executable", async () => {
  const manager = makeManager();

  const created = await createdSession(manager, "acc-s03-created");
  const createdCheck = manager.validateActiveSession(created.sessionId, "acc-s03-created");
  assert.equal(createdCheck.ok, false);
  assert.equal(createdCheck.active, false);
  assert.equal(createdCheck.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);

  const active = await activeSession(manager, "acc-s03-active");
  const activeCheck = manager.validateActiveSession(active.sessionId, "acc-s03-active");
  assert.equal(activeCheck.ok, true);
  assert.equal(activeCheck.active, true);
  assert.equal(activeCheck.code, "OK");
  assert.equal(activeCheck.state, SESSION_STATE.ACTIVE);

  const paused = await activeSession(manager, "acc-s03-paused");
  await manager.pause(paused.sessionId);
  const pausedCheck = manager.validateActiveSession(paused.sessionId, "acc-s03-paused");
  assert.equal(pausedCheck.active, false);
  assert.equal(pausedCheck.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);

  const halted = await activeSession(manager, "acc-s03-halted");
  await manager.halt(halted.sessionId, "TEST_HALT");
  const haltedCheck = manager.validateActiveSession(halted.sessionId, "acc-s03-halted");
  assert.equal(haltedCheck.active, false);
  assert.equal(haltedCheck.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);

  const closed = await activeSession(manager, "acc-s03-closed");
  await manager.close(closed.sessionId);
  const closedCheck = manager.validateActiveSession(closed.sessionId, "acc-s03-closed");
  assert.equal(closedCheck.active, false);
  assert.equal(closedCheck.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);
});

test("S04 wrong account rejected", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s04-owner");
  const check = manager.validateActiveSession(session.sessionId, "acc-s04-other");
  assert.equal(check.ok, false);
  assert.equal(check.active, false);
  assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_MISMATCH);
  assert.equal(check.accountId, "acc-s04-owner");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("S05 stale generation rejected", async () => {
  const managerA = makeManager();
  const managerB = makeManager();
  const session = await activeSession(managerA, "acc-s05");

  const inA = managerA.validateActiveSession(session.sessionId, "acc-s05");
  assert.equal(inA.active, true);

  const inB = managerB.validateActiveSession(session.sessionId, "acc-s05");
  assert.equal(inB.ok, false);
  assert.equal(inB.active, false);
  assert.equal(inB.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);
  assert.notEqual(inB.processGenerationId, session.processGenerationId);
  assert.equal(UUID_RE.test(inB.processGenerationId), true);

  const gotInB = managerB.getSession(session.sessionId);
  assert.equal(gotInB.ok, false);
  assert.equal(gotInB.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);
});

test("S06 second non-terminal same account rejected", async () => {
  const manager = makeManager();
  const accountId = "acc-s06";
  const first = await createdSession(manager, accountId);

  const dupOnCreated = await manager.createSession(accountId);
  assert.equal(dupOnCreated.ok, false);
  assert.equal(dupOnCreated.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ALREADY_EXISTS);

  await manager.activate(first.sessionId);
  const dupOnActive = await manager.createSession(accountId);
  assert.equal(dupOnActive.ok, false);
  assert.equal(dupOnActive.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ALREADY_EXISTS);

  await manager.pause(first.sessionId);
  const dupOnPaused = await manager.createSession(accountId);
  assert.equal(dupOnPaused.ok, false);
  assert.equal(dupOnPaused.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ALREADY_EXISTS);

  await manager.halt(first.sessionId, "TEST_HALT");
  const afterHalt = await manager.createSession(accountId);
  assert.equal(afterHalt.ok, true);
  assert.notEqual(afterHalt.session.sessionId, first.sessionId);

  await manager.close(afterHalt.session.sessionId);
  const afterClose = await manager.createSession(accountId);
  assert.equal(afterClose.ok, true);
  assert.notEqual(afterClose.session.sessionId, afterHalt.session.sessionId);
});

test("S07 repeated activate behavior", async () => {
  const manager = makeManager();
  const session = await createdSession(manager, "acc-s07");
  const first = await manager.activate(session.sessionId);
  assert.equal(first.ok, true);
  const second = await manager.activate(session.sessionId);
  assert.equal(second.ok, false);
  assert.equal(second.session, null);
  assert.equal(second.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("S08 pause ACTIVE", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s08");
  const paused = await manager.pause(session.sessionId);
  assert.equal(paused.ok, true);
  assert.equal(paused.session.state, SESSION_STATE.PAUSED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);
});

test("S09 PAUSED not executable", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s09");
  await manager.pause(session.sessionId);
  const check = manager.validateActiveSession(session.sessionId, "acc-s09");
  assert.equal(check.ok, false);
  assert.equal(check.active, false);
  assert.equal(check.state, SESSION_STATE.PAUSED);
  assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);
});

test("S10 resume PAUSED", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s10");
  await manager.pause(session.sessionId);
  const resumed = await manager.resume(session.sessionId);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.session.state, SESSION_STATE.ACTIVE);
  assert.equal(manager.validateActiveSession(session.sessionId, "acc-s10").active, true);
});

test("S11 halt ACTIVE", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s11");
  const halted = await manager.halt(session.sessionId, "OPERATOR_HALT");
  assert.equal(halted.ok, true);
  assert.equal(halted.session.state, SESSION_STATE.HALTED);
  assert.equal(halted.session.haltCode, "OPERATOR_HALT");
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.HALTED);

  const defaultHalt = await activeSession(manager, "acc-s11-default");
  const haltedDefault = await manager.halt(defaultHalt.sessionId);
  assert.equal(haltedDefault.ok, true);
  assert.equal(haltedDefault.session.haltCode, "HALTED");
});

test("S12 HALTED cannot resume", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s12");
  await manager.pause(session.sessionId);
  await manager.halt(session.sessionId, "TEST_HALT");

  const resumed = await manager.resume(session.sessionId);
  assert.equal(resumed.ok, false);
  assert.equal(resumed.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);

  const reactivated = await manager.activate(session.sessionId);
  assert.equal(reactivated.ok, false);
  assert.equal(reactivated.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);

  const rehalted = await manager.halt(session.sessionId, "TEST_HALT_2");
  assert.equal(rehalted.ok, false);
  assert.equal(rehalted.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_HALTED);

  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.HALTED);
});

test("S13 close allowed states", async () => {
  const manager = makeManager();

  const fromCreated = await createdSession(manager, "acc-s13-created");
  const closedCreated = await manager.close(fromCreated.sessionId);
  assert.equal(closedCreated.ok, true);
  assert.equal(closedCreated.session.state, SESSION_STATE.CLOSED);

  const fromActive = await activeSession(manager, "acc-s13-active");
  const closedActive = await manager.close(fromActive.sessionId);
  assert.equal(closedActive.ok, true);
  assert.equal(closedActive.session.state, SESSION_STATE.CLOSED);

  const fromPaused = await activeSession(manager, "acc-s13-paused");
  await manager.pause(fromPaused.sessionId);
  const closedPaused = await manager.close(fromPaused.sessionId);
  assert.equal(closedPaused.ok, true);
  assert.equal(closedPaused.session.state, SESSION_STATE.CLOSED);

  const fromHalted = await activeSession(manager, "acc-s13-halted");
  await manager.halt(fromHalted.sessionId, "TEST_HALT");
  const closedHalted = await manager.close(fromHalted.sessionId);
  assert.equal(closedHalted.ok, true);
  assert.equal(closedHalted.session.state, SESSION_STATE.CLOSED);
});

test("S14 CLOSED cannot reopen", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s14");
  await manager.close(session.sessionId);

  const reactivated = await manager.activate(session.sessionId);
  assert.equal(reactivated.ok, false);
  assert.equal(reactivated.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);

  const resumed = await manager.resume(session.sessionId);
  assert.equal(resumed.ok, false);
  assert.equal(resumed.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);

  const paused = await manager.pause(session.sessionId);
  assert.equal(paused.ok, false);
  assert.equal(paused.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);

  const halted = await manager.halt(session.sessionId, "TEST_HALT");
  assert.equal(halted.ok, false);
  assert.equal(halted.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);

  const reclosed = await manager.close(session.sessionId);
  assert.equal(reclosed.ok, false);
  assert.equal(reclosed.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED);

  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.CLOSED);
});

test("S15 session ID not reused", async () => {
  const manager = makeManager();
  const accountId = "acc-s15";
  const seen = new Set();
  let previousId = null;

  for (let i = 0; i < 5; i += 1) {
    const session = await createdSession(manager, accountId);
    assert.equal(seen.has(session.sessionId), false);
    seen.add(session.sessionId);
    if (previousId !== null) {
      assert.notEqual(session.sessionId, previousId);
      const retained = manager.getSession(previousId);
      assert.equal(retained.ok, true);
      assert.equal(retained.session.state, SESSION_STATE.CLOSED);
    }
    previousId = session.sessionId;
    await manager.close(session.sessionId);
  }

  assert.equal(seen.size, 5);
  const lastRecord = manager.getSession(previousId);
  assert.equal(lastRecord.ok, true);
  assert.equal(lastRecord.session.state, SESSION_STATE.CLOSED);
});

test("S16 account auto-create 0", async () => {
  const src = managerSource();
  assert.equal(src.includes("createAccount"), false);
  assert.equal(src.includes("ensureAccount"), false);
  assert.equal(src.includes("provisionAccount"), false);

  const reads = [];
  const manager = createPaperSessionManager({
    accountStatusReader: function reader(accountId) {
      reads.push(accountId);
      return { found: true, quarantined: false };
    },
  });
  const session = await createdSession(manager, "acc-s16");
  await manager.activate(session.sessionId);
  assert.deepEqual(reads, ["acc-s16", "acc-s16"]);
  assert.equal(typeof manager.createAccount, "undefined");
});

test("S17 quarantined cannot create or activate", async () => {
  const quarantined = makeManager(function reader() {
    return { found: true, quarantined: true };
  });
  const denied = await quarantined.createSession("acc-s17-q");
  assert.equal(denied.ok, false);
  assert.equal(denied.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_QUARANTINED);
  assert.equal(denied.session, null);

  const flip = mutableReader({ found: true, quarantined: false });
  const manager = makeManager(flip.reader);
  const session = await createdSession(manager, "acc-s17-flip");
  flip.status = { found: true, quarantined: true };
  const activated = await manager.activate(session.sessionId);
  assert.equal(activated.ok, false);
  assert.equal(activated.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_QUARANTINED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.CREATED);
});

test("S18 missing account cannot create or activate", async () => {
  const missing = makeManager(function reader() {
    return { found: false, quarantined: false };
  });
  const denied = await missing.createSession("acc-s18-missing");
  assert.equal(denied.ok, false);
  assert.equal(denied.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_UNAVAILABLE);

  const flip = mutableReader({ found: true, quarantined: false });
  const manager = makeManager(flip.reader);
  const session = await createdSession(manager, "acc-s18-flip");
  flip.status = { found: false, quarantined: false };
  const activated = await manager.activate(session.sessionId);
  assert.equal(activated.ok, false);
  assert.equal(activated.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_UNAVAILABLE);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.CREATED);
});

test("S27 concurrent same-account create max 1", async () => {
  const accountId = "acc-s27";
  const entered = deferred();
  const gate = deferred();
  let readerCalls = 0;

  const manager = makeManager(function reader() {
    readerCalls += 1;
    if (readerCalls === 1) {
      entered.resolve();
      return gate.promise.then(function afterBarrier() {
        return { found: true, quarantined: false };
      });
    }
    return { found: true, quarantined: false };
  });

  const first = manager.createSession(accountId);
  await entered.promise;

  let firstSettled = false;
  first.then(function markFirst() { firstSettled = true; });

  const second = manager.createSession(accountId);
  let secondSettled = false;
  second.then(function markSecond() { secondSettled = true; });

  await new Promise(function flush(resolve) { setImmediate(resolve); });
  assert.equal(firstSettled, false, "first create must still be inside the account lock");
  assert.equal(secondSettled, false, "second create must be queued behind the lock");
  assert.equal(readerCalls, 1, "second create must not read account status before the lock is free");

  gate.resolve();
  const results = await Promise.all([first, second]);
  const okResults = results.filter(function isOk(r) { return r.ok === true; });
  const failResults = results.filter(function isFail(r) { return r.ok === false; });

  assert.equal(okResults.length, 1);
  assert.equal(failResults.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(failResults[0].rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ALREADY_EXISTS);
  assert.equal(stateOf(manager, okResults[0].session.sessionId), SESSION_STATE.CREATED);
});

test("S30 prototype account IDs safe", async () => {
  const ids = ["__proto__", "constructor", "prototype", "toString"];
  const manager = makeManager();

  for (let i = 0; i < ids.length; i += 1) {
    const accountId = ids[i];
    const created = await manager.createSession(accountId);
    assert.equal(created.ok, true, accountId);
    assert.equal(created.session.accountId, accountId);

    const duplicate = await manager.createSession(accountId);
    assert.equal(duplicate.ok, false, accountId);
    assert.equal(duplicate.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ALREADY_EXISTS, accountId);

    const activated = await manager.activate(created.session.sessionId);
    assert.equal(activated.ok, true, accountId);
    assert.equal(manager.validateActiveSession(created.session.sessionId, accountId).active, true, accountId);
    assert.equal(manager.validateActiveSession(created.session.sessionId, "acc-other").code,
      PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_MISMATCH, accountId);
  }

  assert.equal(Object.prototype.hasOwnProperty("polluted"), false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("S31 prototype session IDs safe", async () => {
  const manager = makeManager();
  const real = await activeSession(manager, "acc-s31");
  const ids = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"];

  for (let i = 0; i < ids.length; i += 1) {
    const sessionId = ids[i];
    const check = manager.validateActiveSession(sessionId, "acc-s31");
    assert.equal(check.ok, false, sessionId);
    assert.equal(check.active, false, sessionId);
    assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND, sessionId);

    const got = manager.getSession(sessionId);
    assert.equal(got.ok, false, sessionId);
    assert.equal(got.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND, sessionId);

    const paused = await manager.pause(sessionId);
    assert.equal(paused.ok, false, sessionId);
    assert.equal(paused.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND, sessionId);
  }

  assert.equal(Object.prototype.hasOwnProperty("polluted"), false);
  assert.equal(stateOf(manager, real.sessionId), SESSION_STATE.ACTIVE);
});

test("S32 caller-forged ACTIVE ignored", async () => {
  const manager = makeManager();
  const session = await createdSession(manager, "acc-s32");

  const clone = manager.getSession(session.sessionId);
  assert.equal(clone.session.state, SESSION_STATE.CREATED);
  clone.session.state = SESSION_STATE.ACTIVE;
  clone.session.accountId = "acc-forged";
  clone.session.processGenerationId = "forged-generation";

  const fresh = manager.getSession(session.sessionId);
  assert.equal(fresh.session.state, SESSION_STATE.CREATED);
  assert.equal(fresh.session.accountId, "acc-s32");
  assert.equal(fresh.session.processGenerationId, session.processGenerationId);

  const check = manager.validateActiveSession(session.sessionId, "acc-s32");
  assert.equal(check.active, false);
  assert.equal(check.state, SESSION_STATE.CREATED);
  assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE);
});

test("S33 caller process-generation ignored", async () => {
  const forgedSessions = new Map();
  const forgedRecord = {
    sessionId: "forged-session",
    accountId: "acc-s33",
    processGenerationId: "forged-generation",
    state: SESSION_STATE.ACTIVE,
  };
  forgedSessions.set("forged-session", forgedRecord);

  const manager = createPaperSessionManager({
    accountStatusReader: okReader,
    processGenerationId: "forged-generation",
    sessions: forgedSessions,
    nonTerminalByAccount: new Map([["acc-s33", "forged-session"]]),
  });

  const forgedLookup = manager.getSession("forged-session");
  assert.equal(forgedLookup.ok, false);
  assert.equal(forgedLookup.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);

  const forgedValidation = manager.validateActiveSession("forged-session", "acc-s33");
  assert.equal(forgedValidation.active, false);
  assert.equal(forgedValidation.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);
  assert.notEqual(forgedValidation.processGenerationId, "forged-generation");
  assert.equal(UUID_RE.test(forgedValidation.processGenerationId), true);

  const created = await manager.createSession("acc-s33");
  assert.equal(created.ok, true, "injected nonTerminalByAccount must be ignored");
  assert.notEqual(created.session.processGenerationId, "forged-generation");
  assert.equal(UUID_RE.test(created.session.processGenerationId), true);
  assert.equal(forgedSessions.size, 1, "manager must not write into the injected Map");
  assert.equal(forgedSessions.has(created.session.sessionId), false);
});

test("S37 new manager invalidates old session", async () => {
  const oldManager = makeManager();
  const session = await activeSession(oldManager, "acc-s37");
  assert.equal(oldManager.validateActiveSession(session.sessionId, "acc-s37").active, true);

  const newManager = makeManager();
  const afterRestart = newManager.validateActiveSession(session.sessionId, "acc-s37");
  assert.equal(afterRestart.ok, false);
  assert.equal(afterRestart.active, false);
  assert.equal(afterRestart.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);
  assert.notEqual(afterRestart.processGenerationId, session.processGenerationId);

  const reborn = await newManager.createSession("acc-s37");
  assert.equal(reborn.ok, true, "old non-terminal session must not block the new manager");
  assert.notEqual(reborn.session.sessionId, session.sessionId);
  assert.equal(reborn.session.processGenerationId, afterRestart.processGenerationId);

  const paused = await newManager.pause(session.sessionId);
  assert.equal(paused.ok, false);
  assert.equal(paused.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND);
});

test("S40 manager stores no financial fields", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-s40");
  const record = manager.getSession(session.sessionId).session;
  const forbiddenKeys = [
    "cash",
    "cashBalance",
    "positions",
    "ledger",
    "riskConfig",
    "pnl",
    "equity",
    "orders",
    "fills",
  ];
  for (let i = 0; i < forbiddenKeys.length; i += 1) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(record, forbiddenKeys[i]),
      false,
      forbiddenKeys[i],
    );
  }
  assert.deepEqual(
    Object.keys(record).sort(),
    ["accountId", "processGenerationId", "sessionId", "state"],
  );

  const src = managerSource();
  assert.equal(src.includes("cash"), false);
  assert.equal(src.includes("positions"), false);
  assert.equal(src.includes("riskConfig"), false);

  const specs = requireSpecifiers(src);
  assert.deepEqual(specs, ["node:crypto"]);
});

test("operating mode is MODE_A_SINGLE_PROCESS_EPHEMERAL", () => {
  assert.equal(OPERATING_MODE.MODE_A_SINGLE_PROCESS_EPHEMERAL, "MODE_A_SINGLE_PROCESS_EPHEMERAL");
  const manager = makeManager();
  assert.equal(manager.OPERATING_MODE, OPERATING_MODE.MODE_A_SINGLE_PROCESS_EPHEMERAL);
  const src = managerSource();
  assert.equal(src.includes("MODE_A_SINGLE_PROCESS_EPHEMERAL"), true);
  assert.equal(src.includes("restart-safe"), false);
  assert.equal(src.includes("multi-instance-safe"), false);
});

test("getSession clone mutation isolation", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-clone");

  const a = manager.getSession(session.sessionId);
  const b = manager.getSession(session.sessionId);
  assert.notEqual(a.session, b.session);
  assert.deepEqual(a.session, b.session);

  a.session.state = SESSION_STATE.CLOSED;
  a.session.injected = "nope";
  delete a.session.accountId;

  const c = manager.getSession(session.sessionId);
  assert.equal(c.session.state, SESSION_STATE.ACTIVE);
  assert.equal(c.session.accountId, "acc-clone");
  assert.equal(Object.prototype.hasOwnProperty.call(c.session, "injected"), false);
  assert.equal(manager.validateActiveSession(session.sessionId, "acc-clone").active, true);
});

test("malformed accountId rejected without coercion", async () => {
  const manager = makeManager(function reader() {
    throw new Error("accountStatusReader must not be called for malformed accountId");
  });

  for (let i = 0; i < MALFORMED_IDS.length; i += 1) {
    const label = MALFORMED_IDS[i][0];
    const value = MALFORMED_IDS[i][1];
    const created = await manager.createSession(value);
    assert.equal(created.ok, false, label);
    assert.equal(created.session, null, label);
    assert.equal(created.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, label);
    assert.equal(created.rootError.field, "accountId", label);

    const check = manager.validateActiveSession("some-session", value);
    assert.equal(check.ok, false, label);
    assert.equal(check.active, false, label);
    assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, label);
  }
});

test("malformed sessionId rejected without coercion", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-malformed-session");

  for (let i = 0; i < MALFORMED_IDS.length; i += 1) {
    const label = MALFORMED_IDS[i][0];
    const value = MALFORMED_IDS[i][1];

    const got = manager.getSession(value);
    assert.equal(got.ok, false, label);
    assert.equal(got.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, label);
    assert.equal(got.rootError.field, "sessionId", label);

    const check = manager.validateActiveSession(value, "acc-malformed-session");
    assert.equal(check.active, false, label);
    assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, label);

    const mutations = await Promise.all([
      manager.activate(value),
      manager.pause(value),
      manager.resume(value),
      manager.halt(value, "TEST"),
      manager.close(value),
    ]);
    for (let m = 0; m < mutations.length; m += 1) {
      assert.equal(mutations[m].ok, false, label);
      assert.equal(mutations[m].rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, label);
      assert.equal(mutations[m].rootError.field, "sessionId", label);
    }
  }

  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("boxed String session id is not accepted as its primitive twin", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-boxed");
  const boxed = new String(session.sessionId);

  const got = manager.getSession(boxed);
  assert.equal(got.ok, false);
  assert.equal(got.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);

  const check = manager.validateActiveSession(boxed, "acc-boxed");
  assert.equal(check.active, false);
  assert.equal(check.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);

  const boxedAccount = manager.validateActiveSession(session.sessionId, new String("acc-boxed"));
  assert.equal(boxedAccount.active, false);
  assert.equal(boxedAccount.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);

  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("repeated pause on PAUSED rejected", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-repeat-pause");
  const first = await manager.pause(session.sessionId);
  assert.equal(first.ok, true);
  const second = await manager.pause(session.sessionId);
  assert.equal(second.ok, false);
  assert.equal(second.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);

  const created = await createdSession(manager, "acc-repeat-pause-created");
  const pausedCreated = await manager.pause(created.sessionId);
  assert.equal(pausedCreated.ok, false);
  assert.equal(pausedCreated.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION);
  assert.equal(stateOf(manager, created.sessionId), SESSION_STATE.CREATED);
});

test("repeated resume on ACTIVE rejected", async () => {
  const manager = makeManager();
  const session = await activeSession(manager, "acc-repeat-resume");
  const resumed = await manager.resume(session.sessionId);
  assert.equal(resumed.ok, false);
  assert.equal(resumed.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("accountStatusReader throw fails closed", async () => {
  const manager = makeManager(function reader() {
    throw new Error("reader exploded");
  });
  const created = await manager.createSession("acc-reader-throw");
  assert.equal(created.ok, false);
  assert.equal(created.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);
  assert.equal(created.rootError.field, "accountStatus");
});

test("accountStatusReader rejection fails closed", async () => {
  const manager = makeManager(function reader() {
    return Promise.reject(new Error("reader rejected"));
  });
  const created = await manager.createSession("acc-reader-reject");
  assert.equal(created.ok, false);
  assert.equal(created.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);
  assert.equal(created.rootError.field, "accountStatus");
});

test("malformed accountStatus fails closed", async () => {
  const malformed = [
    { found: "yes", quarantined: false },
    { found: true, quarantined: "no" },
    { found: true },
    {},
    null,
    undefined,
    "found",
    1,
    [],
  ];

  for (let i = 0; i < malformed.length; i += 1) {
    const status = malformed[i];
    const manager = makeManager(function reader() { return status; });
    const created = await manager.createSession("acc-malformed-status");
    assert.equal(created.ok, false, String(i));
    assert.equal(created.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, String(i));
    assert.equal(created.rootError.field, "accountStatus", String(i));
  }
});

test("thenable accountStatus is awaited", async () => {
  const manager = makeManager(function reader() {
    return Promise.resolve({ found: true, quarantined: false });
  });
  const created = await manager.createSession("acc-thenable");
  assert.equal(created.ok, true);
  assert.equal(created.session.state, SESSION_STATE.CREATED);
});

test("resume re-checks accountStatusReader", async () => {
  const flip = mutableReader({ found: true, quarantined: false });
  const manager = makeManager(flip.reader);
  const session = await activeSession(manager, "acc-resume-recheck");
  await manager.pause(session.sessionId);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);

  flip.status = { found: true, quarantined: true };
  const quarantinedResume = await manager.resume(session.sessionId);
  assert.equal(quarantinedResume.ok, false);
  assert.equal(quarantinedResume.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_QUARANTINED);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);

  flip.status = { found: false, quarantined: false };
  const missingResume = await manager.resume(session.sessionId);
  assert.equal(missingResume.ok, false);
  assert.equal(missingResume.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_UNAVAILABLE);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);

  flip.status = { found: true, quarantined: false };
  const okResume = await manager.resume(session.sessionId);
  assert.equal(okResume.ok, true);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.ACTIVE);
});

test("validateActiveSession never mutates", async () => {
  const manager = makeManager();
  const active = await activeSession(manager, "acc-no-mutate-active");
  const created = await createdSession(manager, "acc-no-mutate-created");
  const paused = await activeSession(manager, "acc-no-mutate-paused");
  await manager.pause(paused.sessionId);
  const halted = await activeSession(manager, "acc-no-mutate-halted");
  await manager.halt(halted.sessionId, "TEST_HALT");
  const closed = await activeSession(manager, "acc-no-mutate-closed");
  await manager.close(closed.sessionId);

  const before = [active, created, paused, halted, closed].map(function snapshot(s) {
    return manager.getSession(s.sessionId).session;
  });

  const probeAccounts = ["acc-no-mutate-active", "acc-wrong", "__proto__", "", null];
  for (let i = 0; i < before.length; i += 1) {
    for (let p = 0; p < probeAccounts.length; p += 1) {
      manager.validateActiveSession(before[i].sessionId, probeAccounts[p]);
      manager.validateActiveSession("missing-session", probeAccounts[p]);
    }
  }

  const after = [active, created, paused, halted, closed].map(function snapshot(s) {
    return manager.getSession(s.sessionId).session;
  });
  assert.deepEqual(after, before);
  assert.deepEqual(
    after.map(function pick(s) { return s.state; }),
    [
      SESSION_STATE.ACTIVE,
      SESSION_STATE.CREATED,
      SESSION_STATE.PAUSED,
      SESSION_STATE.HALTED,
      SESSION_STATE.CLOSED,
    ],
  );
});

test("runExclusive serializes same-account work and exposes unlocked handle", async () => {
  const manager = makeManager();
  const accountId = "acc-run-exclusive";
  const session = await activeSession(manager, accountId);

  const entered = deferred();
  const gate = deferred();
  const order = [];

  const first = manager.runExclusive(accountId, async function firstBody(locked) {
    order.push("first-enter");
    entered.resolve();
    await gate.promise;
    const check = locked.validateActiveSession(session.sessionId, accountId);
    assert.equal(check.active, true);
    locked.pause(session.sessionId);
    order.push("first-exit");
    return "first";
  });

  await entered.promise;
  const second = manager.runExclusive(accountId, function secondBody(locked) {
    order.push("second-enter");
    const check = locked.validateActiveSession(session.sessionId, accountId);
    assert.equal(check.active, false);
    assert.equal(check.state, SESSION_STATE.PAUSED);
    return "second";
  });

  let secondSettled = false;
  second.then(function markSecond() { secondSettled = true; });
  await new Promise(function flush(resolve) { setImmediate(resolve); });
  assert.equal(secondSettled, false);

  gate.resolve();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(order, ["first-enter", "first-exit", "second-enter"]);
  assert.equal(stateOf(manager, session.sessionId), SESSION_STATE.PAUSED);
});

test("runExclusive rejects malformed accountId and fn", async () => {
  const manager = makeManager();
  const badAccount = await manager.runExclusive(null, function noop() { return "x"; });
  assert.equal(badAccount.ok, false);
  assert.equal(badAccount.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);
  assert.equal(badAccount.rootError.field, "accountId");

  const badFn = await manager.runExclusive("acc-run-exclusive-bad", null);
  assert.equal(badFn.ok, false);
  assert.equal(badFn.rootError.code, PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT);
  assert.equal(badFn.rootError.field, "fn");
});

test("factory requires accountStatusReader", () => {
  assert.throws(function noDeps() { createPaperSessionManager(); }, /accountStatusReader/);
  assert.throws(function badReader() {
    createPaperSessionManager({ accountStatusReader: "nope" });
  }, /accountStatusReader/);
});

test("error code table is exact", () => {
  assert.deepEqual(Object.keys(PAPER_SESSION_ERROR).sort(), [
    "PAPER_SESSION_ACCOUNT_MISMATCH",
    "PAPER_SESSION_ACCOUNT_UNAVAILABLE",
    "PAPER_SESSION_ALREADY_EXISTS",
    "PAPER_SESSION_CLOSED",
    "PAPER_SESSION_HALTED",
    "PAPER_SESSION_INVALID_INPUT",
    "PAPER_SESSION_INVALID_TRANSITION",
    "PAPER_SESSION_NOT_ACTIVE",
    "PAPER_SESSION_NOT_FOUND",
    "PAPER_SESSION_QUARANTINED",
    "PAPER_SESSION_STALE_GENERATION",
  ]);
  const codes = Object.keys(PAPER_SESSION_ERROR);
  for (let i = 0; i < codes.length; i += 1) {
    assert.equal(PAPER_SESSION_ERROR[codes[i]], codes[i]);
  }
  assert.deepEqual(Object.keys(SESSION_STATE).sort(), [
    "ACTIVE",
    "CLOSED",
    "CREATED",
    "HALTED",
    "PAUSED",
  ]);
});
