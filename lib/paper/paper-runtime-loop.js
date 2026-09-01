/**
 * GATE 11W Paper runtime loop. MODE_A_SINGLE_PROCESS_EPHEMERAL.
 *
 * Coordinates one market event per runStep. Does not own financial truth.
 * Persistence service execute is the only state transition.
 *
 * Account state for evaluatePaperRisk is obtained only from a factory-injected
 * read-only accountSnapshotReader(accountId). Runtime does not import a
 * repository module and does not call write/commit/create APIs.
 * Persistence recheck inside execute remains authoritative.
 *
 * Default eligibility reader returns false. Approval policy authority must be
 * injected and open or runStep returns NOOP. userApproval alone does not grant
 * authority.
 */

"use strict";

const {
  PAPER_MODE,
  PAPER_STATUS,
  SIDE,
  ORDER_TYPE,
  ERROR,
} = require("./paper-result");
const {
  isPlainObject,
  isNonNegSafeInt,
  isPosSafeInt,
  isSafeInteger,
  hasOwnRecordKey,
} = require("./paper-account-state");
const {
  PERSISTENCE_ERROR,
  setOwn,
  deepCloneOwn,
} = require("./paper-persistence-canonical");
const { validatePaperRiskConfig } = require("./paper-risk-engine");

const OPERATING_MODE = Object.freeze({
  MODE_A_SINGLE_PROCESS_EPHEMERAL: "MODE_A_SINGLE_PROCESS_EPHEMERAL",
});

const RUNTIME_ACTION = Object.freeze({
  ADVANCE: "ADVANCE",
  PAUSE: "PAUSE",
  HALT_ACCOUNT: "HALT_ACCOUNT",
  HALT_SESSION: "HALT_SESSION",
  NOOP: "NOOP",
});

const ALLOWED_STEP_KEYS = Object.freeze([
  "accountId",
  "sessionToken",
  "sessionRef",
  "marketEvent",
  "orderIntent",
  "userApproval",
]);

const FORBIDDEN_STEP_KEYS = Object.freeze([
  "accountState",
  "revision",
  "riskConfig",
  "costContext",
  "paperExecutionEnabled",
  "allowedMarkets",
  "allowedSymbols",
  "executionId",
  "aggregate",
]);

const ALLOWED_CONFIG_KEYS = Object.freeze([
  "accountId",
  "riskConfig",
  "costContext",
]);

const ALLOWED_COST_KEYS = Object.freeze([
  "policies",
  "brokerChannel",
  "currency",
]);

const KNOWN_PERSISTENCE_CODES = Object.create(null);
(function initKnownPersistenceCodes() {
  const keys = Object.keys(PERSISTENCE_ERROR);
  for (let i = 0; i < keys.length; i += 1) {
    const code = PERSISTENCE_ERROR[keys[i]];
    setOwn(KNOWN_PERSISTENCE_CODES, code, true);
  }
}());

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function freezeOwnTree(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      freezeOwnTree(value[i]);
    }
    return Object.freeze(value);
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    freezeOwnTree(value[keys[i]]);
  }
  return Object.freeze(value);
}

function isThenable(value) {
  return value !== null && typeof value === "object" && typeof value.then === "function";
}

function hasOwnKey(record, key) {
  return isPlainObject(record) && hasOwnRecordKey(record, key);
}

function listOwnKeys(record) {
  return isPlainObject(record) ? Object.keys(record) : [];
}

function rootFromCode(code, field) {
  if (field === undefined) return { code: code };
  return { code: code, field: field };
}

function makeRuntimeResult(partial) {
  const src = partial && typeof partial === "object" ? partial : {};
  const out = {};
  setOwn(out, "ok", src.ok === true);
  setOwn(out, "accountId", src.accountId === undefined ? null : src.accountId);
  setOwn(out, "eventId", src.eventId === undefined ? null : src.eventId);
  setOwn(out, "sequence", src.sequence === undefined ? null : src.sequence);
  setOwn(out, "runtimeAction", src.runtimeAction);
  setOwn(out, "domainOutcome", src.domainOutcome === undefined ? null : src.domainOutcome);
  setOwn(out, "persistenceCode", src.persistenceCode === undefined ? null : src.persistenceCode);
  setOwn(out, "revision", src.revision === undefined ? null : src.revision);
  setOwn(out, "rootError", src.rootError === undefined ? null : src.rootError);
  setOwn(out, "persisted", src.persisted === true);
  setOwn(out, "replayed", src.replayed === true);
  return out;
}

function identityFields(input, configAccountId) {
  const src = isPlainObject(input) ? input : {};
  const event = isPlainObject(src.marketEvent) ? src.marketEvent : {};
  const accountId = isNonEmptyString(src.accountId) ? src.accountId : configAccountId;
  return {
    accountId: isNonEmptyString(accountId) ? accountId : null,
    eventId: isNonEmptyString(event.eventId) ? event.eventId : null,
    sequence: isNonNegSafeInt(event.sequence) ? event.sequence : null,
  };
}

function invalidInputResult(input, configAccountId, field) {
  const id = identityFields(input, configAccountId);
  return makeRuntimeResult({
    ok: false,
    accountId: id.accountId,
    eventId: id.eventId,
    sequence: id.sequence,
    runtimeAction: RUNTIME_ACTION.HALT_SESSION,
    domainOutcome: null,
    persistenceCode: null,
    revision: null,
    rootError: rootFromCode(ERROR.PAPER_INVALID_INPUT, field),
    persisted: false,
    replayed: false,
  });
}

function validateMarketEvent(event) {
  if (!isPlainObject(event)) {
    return { ok: false, field: "marketEvent" };
  }
  if (!isNonEmptyString(event.eventId)) {
    return { ok: false, field: "eventId" };
  }
  if (!isNonEmptyString(event.market)) {
    return { ok: false, field: "market" };
  }
  if (!isNonEmptyString(event.symbol)) {
    return { ok: false, field: "symbol" };
  }
  if (!isNonEmptyString(event.tradingDate)) {
    return { ok: false, field: "tradingDate" };
  }
  if (!isNonNegSafeInt(event.sequence)) {
    return { ok: false, field: "sequence" };
  }
  if (!isPosSafeInt(event.open)) {
    return { ok: false, field: "open" };
  }
  return { ok: true };
}

function validateOrderIntent(intent) {
  if (!isPlainObject(intent)) {
    return { ok: false, field: "orderIntent" };
  }
  if (!isNonEmptyString(intent.intentId)) {
    return { ok: false, field: "intentId" };
  }
  if (intent.mode !== PAPER_MODE.PAPER) {
    return { ok: false, field: "mode" };
  }
  if (!isNonEmptyString(intent.market)) {
    return { ok: false, field: "market" };
  }
  if (!isNonEmptyString(intent.symbol)) {
    return { ok: false, field: "symbol" };
  }
  if (intent.side !== SIDE.BUY && intent.side !== SIDE.SELL) {
    return { ok: false, field: "side" };
  }
  if (intent.orderType !== ORDER_TYPE.MARKET_OPEN) {
    return { ok: false, field: "orderType" };
  }
  if (!isNonNegSafeInt(intent.signalSequence)) {
    return { ok: false, field: "signalSequence" };
  }
  const quantity = intent.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return { ok: false, field: "quantity" };
  }
  if (quantity <= 0 || !isPosSafeInt(quantity)) {
    return { ok: false, field: "quantity" };
  }
  return { ok: true };
}

function validateUserApproval(approval) {
  if (!isPlainObject(approval)) {
    return { ok: false, field: "userApproval" };
  }
  if (!isNonEmptyString(approval.approvalId)) {
    return { ok: false, field: "approvalId" };
  }
  if (!isNonEmptyString(approval.intentId)) {
    return { ok: false, field: "intentId" };
  }
  if (!isNonEmptyString(approval.riskDecisionId)) {
    return { ok: false, field: "riskDecisionId" };
  }
  if (typeof approval.approved !== "boolean") {
    return { ok: false, field: "approved" };
  }
  if (!isSafeInteger(approval.approvedQuantity)) {
    return { ok: false, field: "approvedQuantity" };
  }
  if (!isNonNegSafeInt(approval.validAfterEventSequence)) {
    return { ok: false, field: "validAfterEventSequence" };
  }
  return { ok: true };
}

function validateRuntimeConfig(config) {
  if (!isPlainObject(config)) {
    return { ok: false, field: "runtimeConfig" };
  }
  const keys = listOwnKeys(config);
  for (let i = 0; i < keys.length; i += 1) {
    if (ALLOWED_CONFIG_KEYS.indexOf(keys[i]) === -1) {
      return { ok: false, field: keys[i] };
    }
  }
  if (!isNonEmptyString(config.accountId)) {
    return { ok: false, field: "accountId" };
  }
  const riskVal = validatePaperRiskConfig(config.riskConfig);
  if (!riskVal.ok) {
    return { ok: false, field: "riskConfig" };
  }
  const cost = config.costContext;
  if (!isPlainObject(cost)) {
    return { ok: false, field: "costContext" };
  }
  const costKeys = listOwnKeys(cost);
  for (let i = 0; i < costKeys.length; i += 1) {
    if (ALLOWED_COST_KEYS.indexOf(costKeys[i]) === -1) {
      return { ok: false, field: costKeys[i] };
    }
  }
  if (hasOwnKey(cost, "tradingDate")) {
    return { ok: false, field: "tradingDate" };
  }
  if (!hasOwnKey(cost, "policies") || !Array.isArray(cost.policies)) {
    return { ok: false, field: "policies" };
  }
  if (!isNonEmptyString(cost.brokerChannel)) {
    return { ok: false, field: "brokerChannel" };
  }
  if (!isNonEmptyString(cost.currency)) {
    return { ok: false, field: "currency" };
  }
  return { ok: true };
}

function rejectForbiddenStepKeys(input) {
  for (let i = 0; i < FORBIDDEN_STEP_KEYS.length; i += 1) {
    const key = FORBIDDEN_STEP_KEYS[i];
    if (hasOwnKey(input, key)) {
      return { ok: false, field: key };
    }
  }
  const keys = listOwnKeys(input);
  for (let i = 0; i < keys.length; i += 1) {
    if (ALLOWED_STEP_KEYS.indexOf(keys[i]) === -1) {
      return { ok: false, field: keys[i] };
    }
  }
  return { ok: true };
}

function isKillAllowed(killSwitch) {
  if (!isPlainObject(killSwitch)) return false;
  if (typeof killSwitch.isExecutionAllowed === "function") {
    return killSwitch.isExecutionAllowed() === true;
  }
  if (typeof killSwitch.isOpen === "function") {
    return killSwitch.isOpen() === true;
  }
  return false;
}

function isApprovalOpen(authority) {
  if (!isPlainObject(authority)) return false;
  if (typeof authority.isOpen === "function") {
    return authority.isOpen() === true;
  }
  return false;
}

function readEligibility(reader) {
  if (typeof reader !== "function") return false;
  try {
    return reader() === true;
  } catch (_err) {
    return false;
  }
}

function sessionTokenOf(input) {
  if (hasOwnKey(input, "sessionToken") && isNonEmptyString(input.sessionToken)) {
    return input.sessionToken;
  }
  if (hasOwnKey(input, "sessionRef") && isNonEmptyString(input.sessionRef)) {
    return input.sessionRef;
  }
  return null;
}

function domainCodesOf(domainResult) {
  const codes = [];
  const seen = Object.create(null);
  function add(code) {
    if (typeof code !== "string" || code.length === 0) return;
    if (hasOwnRecordKey(seen, code)) return;
    setOwn(seen, code, true);
    codes.push(code);
  }
  if (!domainResult || typeof domainResult !== "object") return codes;
  const listed = domainResult.errorCodes;
  if (Array.isArray(listed)) {
    for (let i = 0; i < listed.length; i += 1) {
      add(listed[i]);
    }
  }
  const errors = domainResult.errors;
  if (Array.isArray(errors)) {
    for (let i = 0; i < errors.length; i += 1) {
      const err = errors[i];
      if (err && typeof err === "object" && typeof err.code === "string") {
        add(err.code);
      }
    }
  }
  return codes;
}

function codesInclude(codes, code) {
  for (let i = 0; i < codes.length; i += 1) {
    if (codes[i] === code) return true;
  }
  return false;
}

function persistActionForError(code) {
  if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND) {
    return RUNTIME_ACTION.HALT_SESSION;
  }
  if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT) {
    return RUNTIME_ACTION.HALT_SESSION;
  }
  if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT) {
    return RUNTIME_ACTION.HALT_SESSION;
  }
  return RUNTIME_ACTION.HALT_ACCOUNT;
}

function unapprovedRiskDecision(intent, approval) {
  const quantity = intent && isPosSafeInt(intent.quantity) ? intent.quantity : 0;
  return {
    riskDecisionId: approval && isNonEmptyString(approval.riskDecisionId)
      ? approval.riskDecisionId
      : "",
    intentId: intent && isNonEmptyString(intent.intentId) ? intent.intentId : "",
    approved: false,
    requestedQuantity: quantity,
    approvedQuantity: 0,
    validAfterEventSequence: approval && isNonNegSafeInt(approval.validAfterEventSequence)
      ? approval.validAfterEventSequence
      : 0,
    reasonCodes: [ERROR.PAPER_RISK_INVALID_INPUT],
    evaluatedNotional: null,
    riskReferencePrice: null,
  };
}

function mapPersistenceResult(persistResult, ctx) {
  const identity = ctx.identity;
  if (!isPlainObject(persistResult)) {
    return makeRuntimeResult({
      ok: false,
      accountId: identity.accountId,
      eventId: identity.eventId,
      sequence: identity.sequence,
      runtimeAction: RUNTIME_ACTION.HALT_ACCOUNT,
      domainOutcome: null,
      persistenceCode: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED,
      revision: null,
      rootError: rootFromCode(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED),
      persisted: false,
      replayed: false,
    });
  }

  const domain = persistResult.domainResult;
  const domainOutcome = domain && typeof domain.paperStatus === "string"
    ? domain.paperStatus
    : null;
  const revision = persistResult.revision === undefined ? null : persistResult.revision;
  const pErr = persistResult.persistenceError;

  if (pErr && typeof pErr === "object" && typeof pErr.code === "string") {
    const code = pErr.code;
    const known = hasOwnRecordKey(KNOWN_PERSISTENCE_CODES, code);
    const action = known ? persistActionForError(code) : RUNTIME_ACTION.HALT_ACCOUNT;
    return makeRuntimeResult({
      ok: false,
      accountId: identity.accountId,
      eventId: identity.eventId,
      sequence: identity.sequence,
      runtimeAction: action,
      domainOutcome: domainOutcome,
      persistenceCode: code,
      revision: revision,
      rootError: pErr.field === undefined ? rootFromCode(code) : rootFromCode(code, pErr.field),
      persisted: persistResult.persisted === true,
      replayed: persistResult.replayed === true,
    });
  }

  if (persistResult.replayed === true) {
    return makeRuntimeResult({
      ok: true,
      accountId: identity.accountId,
      eventId: identity.eventId,
      sequence: identity.sequence,
      runtimeAction: RUNTIME_ACTION.NOOP,
      domainOutcome: domainOutcome,
      persistenceCode: null,
      revision: revision,
      rootError: null,
      persisted: persistResult.persisted === true,
      replayed: true,
    });
  }

  if (persistResult.ok === true && persistResult.persisted === true) {
    return makeRuntimeResult({
      ok: true,
      accountId: identity.accountId,
      eventId: identity.eventId,
      sequence: identity.sequence,
      runtimeAction: RUNTIME_ACTION.ADVANCE,
      domainOutcome: domainOutcome,
      persistenceCode: null,
      revision: revision,
      rootError: null,
      persisted: true,
      replayed: false,
    });
  }

  if (persistResult.ok === true && persistResult.persisted === false) {
    const codes = domainCodesOf(domain);
    if (codesInclude(codes, ERROR.PAPER_OUT_OF_ORDER_EVENT)) {
      return makeRuntimeResult({
        ok: false,
        accountId: identity.accountId,
        eventId: identity.eventId,
        sequence: identity.sequence,
        runtimeAction: RUNTIME_ACTION.PAUSE,
        domainOutcome: domainOutcome,
        persistenceCode: null,
        revision: revision,
        rootError: rootFromCode(ERROR.PAPER_OUT_OF_ORDER_EVENT),
        persisted: false,
        replayed: false,
      });
    }
    if (codesInclude(codes, ERROR.PAPER_DUPLICATE_EVENT)) {
      return makeRuntimeResult({
        ok: true,
        accountId: identity.accountId,
        eventId: identity.eventId,
        sequence: identity.sequence,
        runtimeAction: RUNTIME_ACTION.NOOP,
        domainOutcome: domainOutcome,
        persistenceCode: null,
        revision: revision,
        rootError: rootFromCode(ERROR.PAPER_DUPLICATE_EVENT),
        persisted: false,
        replayed: false,
      });
    }
    const first = codes.length > 0 ? codes[0] : ERROR.PAPER_INVALID_INPUT;
    return makeRuntimeResult({
      ok: true,
      accountId: identity.accountId,
      eventId: identity.eventId,
      sequence: identity.sequence,
      runtimeAction: RUNTIME_ACTION.NOOP,
      domainOutcome: domainOutcome,
      persistenceCode: null,
      revision: revision,
      rootError: rootFromCode(first),
      persisted: false,
      replayed: false,
    });
  }

  return makeRuntimeResult({
    ok: false,
    accountId: identity.accountId,
    eventId: identity.eventId,
    sequence: identity.sequence,
    runtimeAction: RUNTIME_ACTION.HALT_ACCOUNT,
    domainOutcome: domainOutcome,
    persistenceCode: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN,
    revision: revision,
    rootError: rootFromCode(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN),
    persisted: persistResult.persisted === true,
    replayed: persistResult.replayed === true,
  });
}

function defaultEligibilityReader() {
  return false;
}

function createPaperRuntime(deps) {
  const src = isPlainObject(deps) ? deps : {};
  const persistenceService = src.persistenceService;
  if (!isPlainObject(persistenceService) || typeof persistenceService.execute !== "function") {
    throw new Error("createPaperRuntime requires persistenceService.execute");
  }
  const evaluatePaperRisk = src.evaluatePaperRisk;
  if (typeof evaluatePaperRisk !== "function") {
    throw new Error("createPaperRuntime requires evaluatePaperRisk");
  }

  const configVal = validateRuntimeConfig(src.runtimeConfig);
  if (!configVal.ok) {
    throw new Error("createPaperRuntime invalid runtimeConfig");
  }
  const runtimeConfig = freezeOwnTree(deepCloneOwn(src.runtimeConfig));

  const killSwitch = src.killSwitch;
  const sessionValidator = src.sessionValidator;
  const eligibilityReader = typeof src.eligibilityReader === "function"
    ? src.eligibilityReader
    : defaultEligibilityReader;
  const approvalPolicyAuthority = src.approvalPolicyAuthority;
  const telemetry = typeof src.telemetry === "function" ? src.telemetry : null;
  const accountSnapshotReader = typeof src.accountSnapshotReader === "function"
    ? src.accountSnapshotReader
    : null;

  const inFlight = Object.create(null);

  function isLocked(accountId) {
    return hasOwnRecordKey(inFlight, accountId) && inFlight[accountId] === true;
  }

  function acquireLock(accountId) {
    setOwn(inFlight, accountId, true);
  }

  function releaseLock(accountId) {
    if (hasOwnRecordKey(inFlight, accountId)) {
      delete inFlight[accountId];
    }
  }

  function emitTelemetry(result) {
    if (typeof telemetry !== "function") return;
    try {
      telemetry(result);
    } catch (_err) {
      return;
    }
  }

  function gatedResult(action, input, extras) {
    const extra = extras && typeof extras === "object" ? extras : {};
    const id = identityFields(input, runtimeConfig.accountId);
    return makeRuntimeResult({
      ok: action === RUNTIME_ACTION.NOOP,
      accountId: id.accountId,
      eventId: id.eventId,
      sequence: id.sequence,
      runtimeAction: action,
      domainOutcome: null,
      persistenceCode: null,
      revision: null,
      rootError: extra.rootError === undefined ? null : extra.rootError,
      persisted: false,
      replayed: false,
    });
  }

  function runExecutable(event, intent, approval, paperExecutionEnabled) {
    const identity = {
      accountId: runtimeConfig.accountId,
      eventId: event.eventId,
      sequence: event.sequence,
    };
    const costContext = {
      policies: runtimeConfig.costContext.policies,
      brokerChannel: runtimeConfig.costContext.brokerChannel,
      currency: runtimeConfig.costContext.currency,
      tradingDate: event.tradingDate,
    };

    let snapshot = null;
    if (typeof accountSnapshotReader === "function") {
      snapshot = accountSnapshotReader(runtimeConfig.accountId);
      if (snapshot !== undefined && snapshot !== null) {
        snapshot = deepCloneOwn(snapshot);
      } else {
        snapshot = null;
      }
    }

    let riskDecision;
    if (snapshot !== null) {
      riskDecision = evaluatePaperRisk({
        accountState: snapshot,
        intent: intent,
        riskReferencePrice: event.open,
        riskConfig: runtimeConfig.riskConfig,
        costContext: costContext,
        riskDecisionId: approval.riskDecisionId,
        validAfterEventSequence: approval.validAfterEventSequence,
      });
    } else {
      riskDecision = unapprovedRiskDecision(intent, approval);
    }

    const persistInput = {};
    setOwn(persistInput, "accountId", runtimeConfig.accountId);
    setOwn(persistInput, "marketEvent", event);
    setOwn(persistInput, "orderIntent", intent);
    setOwn(persistInput, "riskDecision", riskDecision);
    setOwn(persistInput, "userApproval", approval);
    setOwn(persistInput, "riskConfig", runtimeConfig.riskConfig);
    setOwn(persistInput, "paperExecutionEnabled", paperExecutionEnabled);
    setOwn(persistInput, "costContext", costContext);

    const persistOut = persistenceService.execute(persistInput);
    if (isThenable(persistOut)) {
      return persistOut.then(function onPersistResolved(resolved) {
        return mapPersistenceResult(resolved, { identity: identity });
      }, function onPersistRejected(err) {
        const code = err && typeof err.code === "string" && hasOwnRecordKey(KNOWN_PERSISTENCE_CODES, err.code)
          ? err.code
          : PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED;
        return makeRuntimeResult({
          ok: false,
          accountId: identity.accountId,
          eventId: identity.eventId,
          sequence: identity.sequence,
          runtimeAction: persistActionForError(code),
          domainOutcome: null,
          persistenceCode: code,
          revision: null,
          rootError: rootFromCode(code),
          persisted: false,
          replayed: false,
        });
      });
    }
    return mapPersistenceResult(persistOut, { identity: identity });
  }

  function runStep(input) {
    if (!isPlainObject(input)) {
      return invalidInputResult({}, runtimeConfig.accountId, "input");
    }

    const eventCheck = validateMarketEvent(input.marketEvent);
    if (!eventCheck.ok) {
      return invalidInputResult(input, runtimeConfig.accountId, eventCheck.field);
    }
    const intentCheck = validateOrderIntent(input.orderIntent);
    if (!intentCheck.ok) {
      return invalidInputResult(input, runtimeConfig.accountId, intentCheck.field);
    }

    const event = deepCloneOwn(input.marketEvent);
    const intent = deepCloneOwn(input.orderIntent);
    if (event.symbol !== intent.symbol) {
      const id = identityFields(input, runtimeConfig.accountId);
      return makeRuntimeResult({
        ok: true,
        accountId: id.accountId,
        eventId: id.eventId,
        sequence: id.sequence,
        runtimeAction: RUNTIME_ACTION.NOOP,
        domainOutcome: null,
        persistenceCode: null,
        revision: null,
        rootError: rootFromCode(ERROR.PAPER_SYMBOL_MISMATCH, "symbol"),
        persisted: false,
        replayed: false,
      });
    }
    if (event.market !== intent.market) {
      const id = identityFields(input, runtimeConfig.accountId);
      return makeRuntimeResult({
        ok: true,
        accountId: id.accountId,
        eventId: id.eventId,
        sequence: id.sequence,
        runtimeAction: RUNTIME_ACTION.NOOP,
        domainOutcome: null,
        persistenceCode: null,
        revision: null,
        rootError: rootFromCode(ERROR.PAPER_MARKET_MISMATCH, "market"),
        persisted: false,
        replayed: false,
      });
    }

    const forbidden = rejectForbiddenStepKeys(input);
    if (!forbidden.ok) {
      return invalidInputResult(input, runtimeConfig.accountId, forbidden.field);
    }

    if (hasOwnKey(input, "accountId") && input.accountId !== runtimeConfig.accountId) {
      return invalidInputResult(input, runtimeConfig.accountId, "accountId");
    }

    const accountId = runtimeConfig.accountId;
    if (isLocked(accountId)) {
      return gatedResult(RUNTIME_ACTION.PAUSE, input, {
        rootError: rootFromCode(ERROR.PAPER_INVALID_INPUT, "accountId"),
      });
    }
    acquireLock(accountId);

    let asyncPending = false;
    function afterResult(result) {
      emitTelemetry(result);
      return result;
    }

    try {
      if (typeof sessionValidator !== "function") {
        return afterResult(gatedResult(RUNTIME_ACTION.HALT_SESSION, input, {
          rootError: rootFromCode(ERROR.PAPER_INVALID_INPUT, "sessionToken"),
        }));
      }
      const token = sessionTokenOf(input);
      if (token === null) {
        return afterResult(gatedResult(RUNTIME_ACTION.HALT_SESSION, input, {
          rootError: rootFromCode(ERROR.PAPER_INVALID_INPUT, "sessionToken"),
        }));
      }
      let session;
      try {
        session = sessionValidator(token, accountId);
      } catch (_err) {
        return afterResult(gatedResult(RUNTIME_ACTION.HALT_SESSION, input, {
          rootError: rootFromCode(ERROR.PAPER_INVALID_INPUT, "sessionToken"),
        }));
      }
      if (!isPlainObject(session) || session.active !== true) {
        return afterResult(gatedResult(RUNTIME_ACTION.HALT_SESSION, input, {
          rootError: rootFromCode(ERROR.PAPER_INVALID_INPUT, "sessionToken"),
        }));
      }

      const eligible = readEligibility(eligibilityReader);
      const killAllows = isKillAllowed(killSwitch);
      const approvalOpen = isApprovalOpen(approvalPolicyAuthority);
      if (eligible !== true) {
        return afterResult(gatedResult(RUNTIME_ACTION.NOOP, input));
      }
      if (killAllows !== true) {
        return afterResult(gatedResult(RUNTIME_ACTION.NOOP, input));
      }
      if (approvalOpen !== true) {
        return afterResult(gatedResult(RUNTIME_ACTION.NOOP, input));
      }

      const approvalCheck = validateUserApproval(input.userApproval);
      if (!approvalCheck.ok) {
        return afterResult(invalidInputResult(input, runtimeConfig.accountId, approvalCheck.field));
      }
      const approval = deepCloneOwn(input.userApproval);
      const paperExecutionEnabled = eligible === true
        && killAllows === true
        && approvalOpen === true;

      const executableOut = runExecutable(event, intent, approval, paperExecutionEnabled);
      if (isThenable(executableOut)) {
        asyncPending = true;
        return executableOut.then(function onOk(result) {
          releaseLock(accountId);
          return afterResult(result);
        }, function onErr(err) {
          releaseLock(accountId);
          const code = err && typeof err.code === "string" && hasOwnRecordKey(KNOWN_PERSISTENCE_CODES, err.code)
            ? err.code
            : PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED;
          return afterResult(makeRuntimeResult({
            ok: false,
            accountId: accountId,
            eventId: event.eventId,
            sequence: event.sequence,
            runtimeAction: persistActionForError(code),
            domainOutcome: null,
            persistenceCode: code,
            revision: null,
            rootError: rootFromCode(code),
            persisted: false,
            replayed: false,
          }));
        });
      }
      return afterResult(executableOut);
    } catch (_err) {
      return afterResult(makeRuntimeResult({
        ok: false,
        accountId: accountId,
        eventId: event.eventId,
        sequence: event.sequence,
        runtimeAction: RUNTIME_ACTION.HALT_ACCOUNT,
        domainOutcome: null,
        persistenceCode: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED,
        revision: null,
        rootError: rootFromCode(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED),
        persisted: false,
        replayed: false,
      }));
    } finally {
      if (!asyncPending) {
        releaseLock(accountId);
      }
    }
  }

  const api = {};
  setOwn(api, "runStep", runStep);
  setOwn(api, "OPERATING_MODE", OPERATING_MODE.MODE_A_SINGLE_PROCESS_EPHEMERAL);
  return Object.freeze(api);
}

module.exports = {
  createPaperRuntime,
  OPERATING_MODE,
  RUNTIME_ACTION,
};
