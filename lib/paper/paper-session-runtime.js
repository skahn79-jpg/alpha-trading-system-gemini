/**
 * GATE 12D Paper session-runtime wrapper (Integration C).
 *
 * Atomically: authoritative session validation → paperRuntime.runStep →
 * apply runtimeAction to session before returning to the caller.
 * Does not modify paper-runtime-loop.js. Does not own financial truth.
 */

"use strict";

const {
  SESSION_STATE,
  PAPER_SESSION_ERROR,
} = require("./paper-session-manager");

const RUNTIME_ACTION = Object.freeze({
  ADVANCE: "ADVANCE",
  PAUSE: "PAUSE",
  HALT_ACCOUNT: "HALT_ACCOUNT",
  HALT_SESSION: "HALT_SESSION",
  NOOP: "NOOP",
});

const PERSISTENCE_ACCOUNT_NOT_FOUND = "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND";
const PAPER_INVALID_INPUT = "PAPER_INVALID_INPUT";

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

function hasOwnKey(record, key) {
  return isPlainObject(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function rootError(code, field) {
  if (field === undefined) return { code: code };
  return { code: code, field: field };
}

function sessionTokenOf(input) {
  if (hasOwnKey(input, "sessionToken") && isNonEmptyPrimitiveString(input.sessionToken)) {
    return input.sessionToken;
  }
  if (hasOwnKey(input, "sessionRef") && isNonEmptyPrimitiveString(input.sessionRef)) {
    return input.sessionRef;
  }
  return null;
}

function accountIdOf(input) {
  if (hasOwnKey(input, "accountId") && isNonEmptyPrimitiveString(input.accountId)) {
    return input.accountId;
  }
  return null;
}

function makeWrapperResult(partial) {
  const src = partial && typeof partial === "object" ? partial : {};
  const out = Object.create(null);
  setOwn(out, "ok", src.ok === true);
  setOwn(out, "sessionId", src.sessionId === undefined ? null : src.sessionId);
  setOwn(out, "accountId", src.accountId === undefined ? null : src.accountId);
  setOwn(out, "sessionState", src.sessionState === undefined ? null : src.sessionState);
  setOwn(out, "processGenerationId", src.processGenerationId === undefined ? null : src.processGenerationId);
  setOwn(out, "runtimeInvoked", src.runtimeInvoked === true);
  setOwn(out, "runtimeResult", src.runtimeResult === undefined ? null : src.runtimeResult);
  setOwn(out, "rootError", src.rootError === undefined ? null : src.rootError);
  return out;
}

function currentSessionView(locked, sessionId) {
  const got = locked.getSession(sessionId);
  if (!got || got.ok !== true || !got.session) return null;
  return got.session;
}

function refuseInactive(validation, sessionView) {
  const state = validation && validation.state !== undefined && validation.state !== null
    ? validation.state
    : (sessionView ? sessionView.state : null);
  let code = PAPER_SESSION_ERROR.PAPER_SESSION_NOT_ACTIVE;
  if (validation && typeof validation.code === "string" && validation.code.length > 0) {
    code = validation.code;
  } else if (state === SESSION_STATE.HALTED) {
    code = PAPER_SESSION_ERROR.PAPER_SESSION_HALTED;
  } else if (state === SESSION_STATE.CLOSED) {
    code = PAPER_SESSION_ERROR.PAPER_SESSION_CLOSED;
  }
  return makeWrapperResult({
    ok: false,
    sessionId: validation && validation.sessionId !== undefined ? validation.sessionId : (sessionView ? sessionView.sessionId : null),
    accountId: validation && validation.accountId !== undefined ? validation.accountId : (sessionView ? sessionView.accountId : null),
    sessionState: state,
    processGenerationId: validation && validation.processGenerationId !== undefined
      ? validation.processGenerationId
      : (sessionView ? sessionView.processGenerationId : null),
    runtimeInvoked: false,
    runtimeResult: null,
    rootError: rootError(code),
  });
}

function shouldHaltOnHaltSession(runtimeResult) {
  const persistenceCode = runtimeResult && runtimeResult.persistenceCode;
  const err = runtimeResult && runtimeResult.rootError && typeof runtimeResult.rootError === "object"
    ? runtimeResult.rootError
    : null;
  const errCode = err && typeof err.code === "string" ? err.code : null;
  const errField = err && err.field !== undefined ? err.field : undefined;

  if (persistenceCode === PERSISTENCE_ACCOUNT_NOT_FOUND || errCode === PERSISTENCE_ACCOUNT_NOT_FOUND) {
    return true;
  }
  if (errCode === PAPER_INVALID_INPUT && errField !== "sessionToken") {
    return true;
  }
  if (errField === "sessionToken") {
    return false;
  }
  return true;
}

function applyRuntimeAction(locked, sessionId, preState, runtimeResult) {
  if (preState !== SESSION_STATE.ACTIVE) {
    return currentSessionView(locked, sessionId);
  }

  const action = runtimeResult && typeof runtimeResult.runtimeAction === "string"
    ? runtimeResult.runtimeAction
    : null;

  if (action === RUNTIME_ACTION.ADVANCE || action === RUNTIME_ACTION.NOOP) {
    return currentSessionView(locked, sessionId);
  }
  if (action === RUNTIME_ACTION.PAUSE) {
    locked.pause(sessionId);
    return currentSessionView(locked, sessionId);
  }
  if (action === RUNTIME_ACTION.HALT_ACCOUNT) {
    const haltCode = runtimeResult && isNonEmptyPrimitiveString(runtimeResult.persistenceCode)
      ? runtimeResult.persistenceCode
      : RUNTIME_ACTION.HALT_ACCOUNT;
    locked.halt(sessionId, haltCode);
    return currentSessionView(locked, sessionId);
  }
  if (action === RUNTIME_ACTION.HALT_SESSION) {
    if (shouldHaltOnHaltSession(runtimeResult) === true) {
      const haltCode = runtimeResult && isNonEmptyPrimitiveString(runtimeResult.persistenceCode)
        ? runtimeResult.persistenceCode
        : RUNTIME_ACTION.HALT_SESSION;
      locked.halt(sessionId, haltCode);
    }
    return currentSessionView(locked, sessionId);
  }

  locked.halt(sessionId, "UNKNOWN_RUNTIME_ACTION");
  return currentSessionView(locked, sessionId);
}

function createPaperSessionRuntime(deps) {
  const src = isPlainObject(deps) ? deps : {};
  const sessionManager = src.sessionManager;
  const paperRuntime = src.paperRuntime;
  if (!isPlainObject(sessionManager) || typeof sessionManager.runExclusive !== "function") {
    throw new Error("createPaperSessionRuntime requires sessionManager.runExclusive");
  }
  if (!isPlainObject(paperRuntime) || typeof paperRuntime.runStep !== "function") {
    throw new Error("createPaperSessionRuntime requires paperRuntime.runStep");
  }

  function runStep(input) {
    if (!isPlainObject(input)) {
      return Promise.resolve(makeWrapperResult({
        ok: false,
        runtimeInvoked: false,
        rootError: rootError(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "input"),
      }));
    }

    const accountId = accountIdOf(input);
    const sessionId = sessionTokenOf(input);
    if (accountId === null) {
      return Promise.resolve(makeWrapperResult({
        ok: false,
        runtimeInvoked: false,
        rootError: rootError(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "accountId"),
      }));
    }
    if (sessionId === null) {
      return Promise.resolve(makeWrapperResult({
        ok: false,
        sessionId: null,
        accountId: accountId,
        runtimeInvoked: false,
        rootError: rootError(PAPER_SESSION_ERROR.PAPER_SESSION_INVALID_INPUT, "sessionToken"),
      }));
    }

    const peeked = typeof sessionManager.getSession === "function"
      ? sessionManager.getSession(sessionId)
      : null;
    const lockAccountId = peeked && peeked.ok === true && peeked.session
      ? peeked.session.accountId
      : accountId;

    return sessionManager.runExclusive(lockAccountId, async function exclusiveStep(locked) {
      const validation = locked.validateActiveSession(sessionId, accountId);
      const sessionView = currentSessionView(locked, sessionId);
      const preState = sessionView ? sessionView.state : null;

      if (!validation || validation.active !== true) {
        return refuseInactive(validation, sessionView);
      }

      let runtimeResult;
      let invoked = false;
      try {
        invoked = true;
        const raw = paperRuntime.runStep(input);
        runtimeResult = isThenable(raw) ? await raw : raw;
      } catch (_err) {
        locked.halt(sessionId, "RUNTIME_THROW");
        const halted = currentSessionView(locked, sessionId);
        return makeWrapperResult({
          ok: false,
          sessionId: halted ? halted.sessionId : sessionId,
          accountId: halted ? halted.accountId : accountId,
          sessionState: halted ? halted.state : SESSION_STATE.HALTED,
          processGenerationId: halted ? halted.processGenerationId : null,
          runtimeInvoked: true,
          runtimeResult: null,
          rootError: rootError(PAPER_SESSION_ERROR.PAPER_SESSION_HALTED),
        });
      }

      const applied = applyRuntimeAction(locked, sessionId, preState, runtimeResult);
      const preservedRoot = runtimeResult && runtimeResult.rootError && typeof runtimeResult.rootError === "object"
        ? runtimeResult.rootError
        : null;
      return makeWrapperResult({
        ok: runtimeResult && runtimeResult.ok === true && applied && applied.state === SESSION_STATE.ACTIVE,
        sessionId: applied ? applied.sessionId : sessionId,
        accountId: applied ? applied.accountId : accountId,
        sessionState: applied ? applied.state : preState,
        processGenerationId: applied ? applied.processGenerationId : null,
        runtimeInvoked: invoked,
        runtimeResult: runtimeResult,
        rootError: preservedRoot,
      });
    });
  }

  const api = Object.create(null);
  setOwn(api, "runStep", runStep);
  return Object.freeze(api);
}

module.exports = {
  createPaperSessionRuntime,
  RUNTIME_ACTION,
};
