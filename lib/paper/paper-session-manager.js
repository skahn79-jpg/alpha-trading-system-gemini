/**
 * GATE 12D Paper session lifecycle manager.
 * MODE_A_SINGLE_PROCESS_EPHEMERAL. Process-local authority only.
 *
 * Owns session records and processGenerationId. Does not own financial truth.
 * No persistence, ledger, risk, broker, network, or eligibility flip.
 */

"use strict";

const { randomUUID } = require("node:crypto");

const OPERATING_MODE = Object.freeze({
  MODE_A_SINGLE_PROCESS_EPHEMERAL: "MODE_A_SINGLE_PROCESS_EPHEMERAL",
});

const SESSION_STATE = Object.freeze({
  CREATED: "CREATED",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  HALTED: "HALTED",
  CLOSED: "CLOSED",
});

const PAPER_SESSION_ERROR = Object.freeze({
  PAPER_SESSION_INVALID_INPUT: "PAPER_SESSION_INVALID_INPUT",
  PAPER_SESSION_NOT_FOUND: "PAPER_SESSION_NOT_FOUND",
  PAPER_SESSION_ACCOUNT_MISMATCH: "PAPER_SESSION_ACCOUNT_MISMATCH",
  PAPER_SESSION_INVALID_TRANSITION: "PAPER_SESSION_INVALID_TRANSITION",
  PAPER_SESSION_ALREADY_EXISTS: "PAPER_SESSION_ALREADY_EXISTS",
  PAPER_SESSION_NOT_ACTIVE: "PAPER_SESSION_NOT_ACTIVE",
  PAPER_SESSION_HALTED: "PAPER_SESSION_HALTED",
  PAPER_SESSION_CLOSED: "PAPER_SESSION_CLOSED",
  PAPER_SESSION_ACCOUNT_UNAVAILABLE: "PAPER_SESSION_ACCOUNT_UNAVAILABLE",
  PAPER_SESSION_QUARANTINED: "PAPER_SESSION_QUARANTINED",
  PAPER_SESSION_STALE_GENERATION: "PAPER_SESSION_STALE_GENERATION",
});

const VALIDATOR_OK = "OK";

const NON_TERMINAL = Object.freeze({
  [SESSION_STATE.CREATED]: true,
  [SESSION_STATE.ACTIVE]: true,
  [SESSION_STATE.PAUSED]: true,
});

function setOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value: value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return record;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyPrimitiveString(value) {
  return typeof value === "string" && value.length > 0;
}

function isThenable(value) {
  return value !== null && typeof value === "object" && typeof value.then === "function";
}

function rootError(code, field) {
  if (field === undefined) return { code: code };
  return { code: code, field: field };
}

function failResult(code, field) {
  const out = Object.create(null);
  setOwn(out, "ok", false);
  setOwn(out, "session", null);
  setOwn(out, "rootError", rootError(code, field));
  return out;
}

function okResult(record) {
  const out = Object.create(null);
  setOwn(out, "ok", true);
  setOwn(out, "session", cloneRecord(record));
  setOwn(out, "rootError", null);
  return out;
}

function cloneRecord(record) {
  const out = Object.create(null);
  setOwn(out, "sessionId", record.sessionId);
  setOwn(out, "accountId", record.accountId);
  setOwn(out, "processGenerationId", record.processGenerationId);
  setOwn(out, "state", record.state);
  if (record.haltCode !== undefined && record.haltCode !== null) {
    setOwn(out, "haltCode", record.haltCode);
  }
  return structuredClone(out);
}

function makeValidatorResult(partial) {
  const src = partial && typeof partial === "object" ? partial : {};
  const out = Object.create(null);
  setOwn(out, "ok", src.ok === true);
  setOwn(out, "active", src.active === true);
  setOwn(out, "sessionId", src.sessionId === undefined ? null : src.sessionId);
  setOwn(out, "accountId", src.accountId === undefined ? null : src.accountId);
  setOwn(out, "state", src.state === undefined ? null : src.state);
  setOwn(out, "processGenerationId", src.processGenerationId === undefined ? null : src.processGenerationId);
  setOwn(out, "code", src.code);
  return out;
}

function invalidIdError(value, field) {
  if (value === undefined || value === null) {
    return rootError(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, field);
  }
  if (typeof value !== "string" || value.length === 0) {
    return rootError(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, field);
  }
  return null;
}

function terminalCodeForState(state) {
  if (state === SESSION_STATE.HALTED) return PAPER_SESSION_ERROR.PAPER_SESSION_HALTED;
  if (state === SESSION_STATE.CLOSED) return PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED;
  if (state === SESSION_STATE.CREATED || state === SESSION_STATE.PAUSED) {
    return PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE;
  }
  if (state === SESSION_STATE.ACTIVE) return VALIDATOR_OK;
  return PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION;
}

function isNonTerminalState(state) {
  return NON_TERMINAL[state] === true;
}

function readAccountStatus(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, error: failResult(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "accountStatus") };
  }
  if (typeof raw.found !== "boolean" || typeof raw.quarantined !== "boolean") {
    return { ok: false, error: failResult(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "accountStatus") };
  }
  return { ok: true, found: raw.found, quarantined: raw.quarantined };
}

function createPaperSessionManager(deps) {
  const src = isPlainObject(deps) ? deps : {};
  const accountStatusReader = src.accountStatusReader;
  if (typeof accountStatusReader !== "function") {
    throw new Error("createPaperSessionManager requires accountStatusReader");
  }

  const processGenerationId = randomUUID();
  if (!isNonEmptyPrimitiveString(processGenerationId)) {
    throw new Error("createPaperSessionManager failed to allocate processGenerationId");
  }

  const sessions = new Map();
  const nonTerminalByAccount = new Map();
  const accountLocks = new Map();

  function withAccountLock(accountId, fn) {
    const prev = accountLocks.get(accountId) || Promise.resolve();
    const current = prev.then(function onPrevOk() {
      return fn();
    }, function onPrevErr() {
      return fn();
    });
    const done = current.then(function onOk() {
      return undefined;
    }, function onErr() {
      return undefined;
    });
    accountLocks.set(accountId, done);
    done.then(function onSettled() {
      if (accountLocks.get(accountId) === done) {
        accountLocks.delete(accountId);
      }
    });
    return current;
  }

  function allocateSessionId() {
    for (let i = 0; i < 8; i += 1) {
      const id = randomUUID();
      if (isNonEmptyPrimitiveString(id) && !sessions.has(id)) {
        return id;
      }
    }
    throw new Error("createPaperSessionManager failed to allocate sessionId");
  }

  async function loadAccountStatus(accountId) {
    let raw;
    try {
      raw = accountStatusReader(accountId);
      if (isThenable(raw)) {
        raw = await raw;
      }
    } catch (_err) {
      return { ok: false, error: failResult(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "accountStatus") };
    }
    return readAccountStatus(raw);
  }

  function denyIfUnavailable(status) {
    if (status.found !== true) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_UNAVAILABLE, "accountId");
    }
    if (status.quarantined === true) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_QUARANTINED, "accountId");
    }
    return null;
  }

  function clearNonTerminalIfCurrent(accountId, sessionId) {
    if (nonTerminalByAccount.get(accountId) === sessionId) {
      nonTerminalByAccount.delete(accountId);
    }
  }

  function validateActiveSession(sessionId, accountId) {
    const sessionErr = invalidIdError(sessionId, "sessionId");
    if (sessionErr) {
      return makeValidatorResult({
        ok: false,
        active: false,
        sessionId: null,
        accountId: null,
        state: null,
        processGenerationId: processGenerationId,
        code: sessionErr.code,
      });
    }
    const accountErr = invalidIdError(accountId, "accountId");
    if (accountErr) {
      return makeValidatorResult({
        ok: false,
        active: false,
        sessionId: null,
        accountId: null,
        state: null,
        processGenerationId: processGenerationId,
        code: accountErr.code,
      });
    }

    const rec = sessions.get(sessionId);
    if (!rec) {
      return makeValidatorResult({
        ok: false,
        active: false,
        sessionId: null,
        accountId: null,
        state: null,
        processGenerationId: processGenerationId,
        code: PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND,
      });
    }
    if (rec.processGenerationId !== processGenerationId) {
      return makeValidatorResult({
        ok: false,
        active: false,
        sessionId: null,
        accountId: null,
        state: null,
        processGenerationId: processGenerationId,
        code: PAPER_SESSION_ERROR.PAPER_SESSION_STALE_GENERATION,
      });
    }
    if (rec.accountId !== accountId) {
      return makeValidatorResult({
        ok: false,
        active: false,
        sessionId: rec.sessionId,
        accountId: rec.accountId,
        state: rec.state,
        processGenerationId: rec.processGenerationId,
        code: PAPER_SESSION_ERROR.PAPER_SESSION_ACCOUNT_MISMATCH,
      });
    }

    const active = rec.state === SESSION_STATE.ACTIVE;
    return makeValidatorResult({
      ok: active,
      active: active,
      sessionId: rec.sessionId,
      accountId: rec.accountId,
      state: rec.state,
      processGenerationId: rec.processGenerationId,
      code: terminalCodeForState(rec.state),
    });
  }

  function getSession(sessionId) {
    const sessionErr = invalidIdError(sessionId, "sessionId");
    if (sessionErr) {
      return failResult(sessionErr.code, sessionErr.field);
    }
    const rec = sessions.get(sessionId);
    if (!rec) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND, "sessionId");
    }
    return okResult(rec);
  }

  function requireRecord(sessionId) {
    const sessionErr = invalidIdError(sessionId, "sessionId");
    if (sessionErr) {
      return { ok: false, error: failResult(sessionErr.code, sessionErr.field) };
    }
    const rec = sessions.get(sessionId);
    if (!rec) {
      return { ok: false, error: failResult(PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND, "sessionId") };
    }
    if (rec.processGenerationId !== processGenerationId) {
      return { ok: false, error: failResult(PAPER_SESSION_ERROR.PAPER_SESSION_STALE_GENERATION, "sessionId") };
    }
    return { ok: true, record: rec };
  }

  function transitionDenied(rec, expectedFrom, toState) {
    if (rec.state === SESSION_STATE.HALTED && toState !== SESSION_STATE.CLOSED) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_HALTED, "state");
    }
    if (rec.state === SESSION_STATE.CLOSED) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED, "state");
    }
    if (expectedFrom !== undefined && rec.state !== expectedFrom) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION, "state");
    }
    return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_TRANSITION, "state");
  }

  function activateUnlocked(sessionId) {
    const loaded = requireRecord(sessionId);
    if (!loaded.ok) return loaded.error;
    const rec = loaded.record;
    if (rec.state !== SESSION_STATE.CREATED) {
      return transitionDenied(rec, SESSION_STATE.CREATED, SESSION_STATE.ACTIVE);
    }
    rec.state = SESSION_STATE.ACTIVE;
    return okResult(rec);
  }

  function pauseUnlocked(sessionId) {
    const loaded = requireRecord(sessionId);
    if (!loaded.ok) return loaded.error;
    const rec = loaded.record;
    if (rec.state !== SESSION_STATE.ACTIVE) {
      return transitionDenied(rec, SESSION_STATE.ACTIVE, SESSION_STATE.PAUSED);
    }
    rec.state = SESSION_STATE.PAUSED;
    return okResult(rec);
  }

  function resumeUnlocked(sessionId) {
    const loaded = requireRecord(sessionId);
    if (!loaded.ok) return loaded.error;
    const rec = loaded.record;
    if (rec.state !== SESSION_STATE.PAUSED) {
      return transitionDenied(rec, SESSION_STATE.PAUSED, SESSION_STATE.ACTIVE);
    }
    rec.state = SESSION_STATE.ACTIVE;
    return okResult(rec);
  }

  function haltUnlocked(sessionId, haltCode) {
    const loaded = requireRecord(sessionId);
    if (!loaded.ok) return loaded.error;
    const rec = loaded.record;
    if (!isNonTerminalState(rec.state)) {
      return transitionDenied(rec, undefined, SESSION_STATE.HALTED);
    }
    rec.state = SESSION_STATE.HALTED;
    rec.haltCode = isNonEmptyPrimitiveString(haltCode) ? haltCode : "HALTED";
    clearNonTerminalIfCurrent(rec.accountId, rec.sessionId);
    return okResult(rec);
  }

  function closeUnlocked(sessionId) {
    const loaded = requireRecord(sessionId);
    if (!loaded.ok) return loaded.error;
    const rec = loaded.record;
    if (rec.state === SESSION_STATE.CLOSED) {
      return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED, "state");
    }
    rec.state = SESSION_STATE.CLOSED;
    clearNonTerminalIfCurrent(rec.accountId, rec.sessionId);
    return okResult(rec);
  }

  async function createSession(accountId) {
    const accountErr = invalidIdError(accountId, "accountId");
    if (accountErr) {
      return failResult(accountErr.code, accountErr.field);
    }
    return withAccountLock(accountId, async function createLocked() {
      const status = await loadAccountStatus(accountId);
      if (!status.ok) return status.error;
      const denied = denyIfUnavailable(status);
      if (denied) return denied;
      if (nonTerminalByAccount.has(accountId)) {
        return failResult(PAPER_SESSION_ERROR.PAPER_SESSION_ALREADY_EXISTS, "accountId");
      }
      const sessionId = allocateSessionId();
      const rec = Object.create(null);
      setOwn(rec, "sessionId", sessionId);
      setOwn(rec, "accountId", accountId);
      setOwn(rec, "processGenerationId", processGenerationId);
      setOwn(rec, "state", SESSION_STATE.CREATED);
      setOwn(rec, "haltCode", null);
      sessions.set(sessionId, rec);
      nonTerminalByAccount.set(accountId, sessionId);
      return okResult(rec);
    });
  }

  function withSessionAccountLock(sessionId, fn) {
    const sessionErr = invalidIdError(sessionId, "sessionId");
    if (sessionErr) {
      return Promise.resolve(failResult(sessionErr.code, sessionErr.field));
    }
    const rec = sessions.get(sessionId);
    if (!rec) {
      return Promise.resolve(failResult(PAPER_SESSION_ERROR.PAPER_SESSION_NOT_FOUND, "sessionId"));
    }
    return withAccountLock(rec.accountId, fn);
  }

  function activate(sessionId) {
    return withSessionAccountLock(sessionId, async function activateLocked() {
      const loaded = requireRecord(sessionId);
      if (!loaded.ok) return loaded.error;
      const status = await loadAccountStatus(loaded.record.accountId);
      if (!status.ok) return status.error;
      const denied = denyIfUnavailable(status);
      if (denied) return denied;
      return activateUnlocked(sessionId);
    });
  }

  function pause(sessionId) {
    return withSessionAccountLock(sessionId, function pauseLocked() {
      return pauseUnlocked(sessionId);
    });
  }

  function resume(sessionId) {
    return withSessionAccountLock(sessionId, async function resumeLocked() {
      const loaded = requireRecord(sessionId);
      if (!loaded.ok) return loaded.error;
      const status = await loadAccountStatus(loaded.record.accountId);
      if (!status.ok) return status.error;
      const denied = denyIfUnavailable(status);
      if (denied) return denied;
      return resumeUnlocked(sessionId);
    });
  }

  function halt(sessionId, haltCode) {
    return withSessionAccountLock(sessionId, function haltLocked() {
      return haltUnlocked(sessionId, haltCode);
    });
  }

  function close(sessionId) {
    return withSessionAccountLock(sessionId, function closeLocked() {
      return closeUnlocked(sessionId);
    });
  }

  function runExclusive(accountId, fn) {
    const accountErr = invalidIdError(accountId, "accountId");
    if (accountErr) {
      return Promise.resolve(failResult(accountErr.code, accountErr.field));
    }
    if (typeof fn !== "function") {
      return Promise.resolve(failResult(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "fn"));
    }
    const locked = Object.create(null);
    setOwn(locked, "validateActiveSession", validateActiveSession);
    setOwn(locked, "getSession", getSession);
    setOwn(locked, "pause", pauseUnlocked);
    setOwn(locked, "halt", haltUnlocked);
    setOwn(locked, "close", closeUnlocked);
    setOwn(locked, "activate", activateUnlocked);
    setOwn(locked, "resume", resumeUnlocked);
    return withAccountLock(accountId, function exclusiveLocked() {
      return fn(locked);
    });
  }

  const api = Object.create(null);
  setOwn(api, "createSession", createSession);
  setOwn(api, "activate", activate);
  setOwn(api, "pause", pause);
  setOwn(api, "resume", resume);
  setOwn(api, "halt", halt);
  setOwn(api, "close", close);
  setOwn(api, "getSession", getSession);
  setOwn(api, "validateActiveSession", validateActiveSession);
  setOwn(api, "runExclusive", runExclusive);
  setOwn(api, "OPERATING_MODE", OPERATING_MODE.MODE_A_SINGLE_PROCESS_EPHEMERAL);
  return Object.freeze(api);
}

module.exports = {
  createPaperSessionManager,
  SESSION_STATE,
  PAPER_SESSION_ERROR,
  OPERATING_MODE,
};
