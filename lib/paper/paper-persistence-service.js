/**
 * GATE 11O Paper persistence service. Account-scoped atomic CAS.
 * No network. No fs. No prune.
 */

"use strict";

const {
  PERSISTENCE_ERROR,
  deepCloneOwn,
  setOwn,
  digestRequest,
  digestCreate,
  deriveExecutionId,
} = require("./paper-persistence-canonical");
const { validatePaperPersistenceAggregate } = require("./paper-persistence-validator");
const { CREATE_STATUS } = require("./in-memory-paper-repository");
const { createPaperAccountState, isPlainObject, hasOwnRecordKey } = require("./paper-account-state");
const { executePaper } = require("./paper-execution-adapter");
const { PAPER_STATUS } = require("./paper-result");

const RESOURCE_CAPS = Object.freeze({
  MAX_EXECUTED_INTENT_IDS: 10000,
  MAX_CLOSED_TRADES: 10000,
  MAX_AUDIT_RECORDS: 20000,
  MAX_EXECUTION_RECORDS: 10000,
});

const KNOWN_CODES = Object.create(null);
(function initKnownCodes() {
  const keys = Object.keys(PERSISTENCE_ERROR);
  for (let i = 0; i < keys.length; i += 1) {
    const code = PERSISTENCE_ERROR[keys[i]];
    setOwn(KNOWN_CODES, code, true);
  }
}());

function emptyIdemp() {
  return {
    byEventId: Object.create(null),
    bySequence: Object.create(null),
    byIntentId: Object.create(null),
    byExecutionId: Object.create(null),
    byRequestDigest: Object.create(null),
  };
}

function makeResult(partial) {
  const src = partial && typeof partial === "object" ? partial : {};
  const out = {};
  setOwn(out, "ok", src.ok === true);
  setOwn(out, "persisted", src.persisted === true);
  setOwn(out, "replayed", src.replayed === true);
  setOwn(out, "persistenceError", src.persistenceError === undefined ? null : src.persistenceError);
  setOwn(out, "requestDigest", src.requestDigest === undefined ? null : src.requestDigest);
  setOwn(out, "createDigest", src.createDigest === undefined ? null : src.createDigest);
  setOwn(out, "executionId", src.executionId === undefined ? null : src.executionId);
  setOwn(out, "revision", src.revision === undefined ? null : src.revision);
  setOwn(out, "domainResult", src.domainResult === undefined ? null : src.domainResult);
  setOwn(out, "accountState", src.accountState === undefined ? null : src.accountState);
  setOwn(out, "aggregate", src.aggregate === undefined ? null : src.aggregate);
  return out;
}

function persistError(code, field, extras) {
  const error = field === undefined ? { code } : { code, field };
  const src = extras && typeof extras === "object" ? extras : {};
  return makeResult({
    ok: false,
    persisted: false,
    replayed: false,
    persistenceError: error,
    requestDigest: src.requestDigest === undefined ? null : src.requestDigest,
    createDigest: src.createDigest === undefined ? null : src.createDigest,
    executionId: src.executionId === undefined ? null : src.executionId,
    revision: src.revision === undefined ? null : src.revision,
    domainResult: src.domainResult === undefined ? null : src.domainResult,
    accountState: src.accountState === undefined ? null : src.accountState,
    aggregate: src.aggregate === undefined ? null : src.aggregate,
  });
}

function cloneOrNull(value) {
  if (value === undefined || value === null) return null;
  return deepCloneOwn(value);
}

function wrapRepoCall(fn) {
  try {
    return fn();
  } catch (err) {
    const code = err && err.code;
    if (typeof code === "string" && hasOwnRecordKey(KNOWN_CODES, code)) {
      return {
        ok: false,
        error: err.field === undefined ? { code } : { code, field: err.field },
      };
    }
    return {
      ok: false,
      error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED },
    };
  }
}

function mapGetOwn(map, key) {
  if (!map || typeof key !== "string" || !hasOwnRecordKey(map, key)) return undefined;
  return map[key];
}

function checkIdempotency(aggregate, identities) {
  const idemp = aggregate.idempotency;
  const requestDigest = identities.requestDigest;
  if (hasOwnRecordKey(idemp.byRequestDigest, requestDigest)) {
    return { replay: true, entry: idemp.byRequestDigest[requestDigest] };
  }

  const pairs = [
    [idemp.byEventId, identities.eventId],
    [idemp.bySequence, String(identities.sequence)],
    [idemp.byIntentId, identities.intentId],
    [idemp.byExecutionId, identities.executionId],
  ];
  for (let i = 0; i < pairs.length; i += 1) {
    const map = pairs[i][0];
    const key = pairs[i][1];
    if (key === undefined || key === null) continue;
    const storedDigest = mapGetOwn(map, String(key));
    if (storedDigest === undefined) continue;
    if (storedDigest !== requestDigest) {
      return { conflict: true };
    }
    if (hasOwnRecordKey(idemp.byRequestDigest, storedDigest)) {
      return { replay: true, entry: idemp.byRequestDigest[storedDigest] };
    }
  }
  return { miss: true };
}

function isFilled(domainResult) {
  return !!(domainResult && domainResult.paperStatus === PAPER_STATUS.FILLED);
}

function isConsuming(loadedState, nextState) {
  if (!nextState) return false;
  return loadedState.lastProcessedSequence !== nextState.lastProcessedSequence
    || loadedState.lastProcessedEventId !== nextState.lastProcessedEventId;
}

function indexNextIdemp(loadedIdemp, identities, entry) {
  const next = deepCloneOwn(loadedIdemp);
  setOwn(next.byEventId, identities.eventId, identities.requestDigest);
  setOwn(next.bySequence, String(identities.sequence), identities.requestDigest);
  setOwn(next.byIntentId, identities.intentId, identities.requestDigest);
  setOwn(next.byExecutionId, identities.executionId, identities.requestDigest);
  setOwn(next.byRequestDigest, identities.requestDigest, deepCloneOwn(entry));
  return next;
}

function createPaperPersistenceService(repo) {
  function replayFrom(aggregate, entry, extras) {
    const clonedAgg = cloneOrNull(aggregate);
    return makeResult({
      ok: true,
      persisted: true,
      replayed: true,
      persistenceError: null,
      requestDigest: extras.requestDigest,
      createDigest: clonedAgg ? clonedAgg.createDigest : null,
      executionId: entry && entry.executionId !== undefined ? entry.executionId : extras.executionId,
      revision: entry && entry.revision !== undefined ? entry.revision : (clonedAgg ? clonedAgg.revision : null),
      domainResult: entry && entry.domainResult !== undefined ? cloneOrNull(entry.domainResult) : null,
      accountState: clonedAgg ? cloneOrNull(clonedAgg.accountState) : null,
      aggregate: clonedAgg,
    });
  }

  function snapshotFromAggregate(aggregate, extras) {
    const clonedAgg = cloneOrNull(aggregate);
    return {
      requestDigest: extras.requestDigest === undefined ? null : extras.requestDigest,
      createDigest: clonedAgg ? clonedAgg.createDigest : (extras.createDigest === undefined ? null : extras.createDigest),
      executionId: extras.executionId === undefined ? null : extras.executionId,
      revision: clonedAgg ? clonedAgg.revision : null,
      accountState: clonedAgg ? cloneOrNull(clonedAgg.accountState) : null,
      aggregate: clonedAgg,
    };
  }

  function loadWrapped(accountId) {
    return wrapRepoCall(() => repo.loadAccount(accountId));
  }

  function createAccount(input) {
    const src = isPlainObject(input) ? input : {};
    if (typeof src.accountId !== "string" || src.accountId.length === 0) {
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT, "accountId");
    }
    if (typeof src.initialCash !== "number" || !Number.isSafeInteger(src.initialCash) || src.initialCash < 0) {
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT, "initialCash");
    }

    const digested = digestCreate({
      accountId: src.accountId,
      initialCash: src.initialCash,
    });
    if (!digested.ok) {
      return persistError(
        digested.error.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        digested.error.field,
        { createDigest: null }
      );
    }

    const accountState = createPaperAccountState({
      accountId: src.accountId,
      initialCash: src.initialCash,
    });
    const aggregate = {
      schemaVersion: 1,
      accountId: src.accountId,
      revision: 0,
      accountState,
      createDigest: digested.digest,
      idempotency: emptyIdemp(),
      auditRecords: [],
      executionRecords: [],
      quarantine: false,
    };
    const validated = validatePaperPersistenceAggregate(aggregate);
    if (!validated.ok) {
      return persistError(validated.error.code, validated.error.field, {
        createDigest: digested.digest,
      });
    }

    const created = wrapRepoCall(() => repo.createAccountIfAbsent({
      accountId: src.accountId,
      createDigest: digested.digest,
      aggregate,
    }));

    if (!created.ok) {
      const code = created.error && created.error.code;
      if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED) {
        return persistError(code, undefined, { createDigest: digested.digest });
      }
      if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT) {
        const loaded = loadWrapped(src.accountId);
        return persistError(code, undefined, snapshotFromAggregate(
          loaded && loaded.found ? loaded.aggregate : null,
          { createDigest: digested.digest }
        ));
      }
      if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN) {
        const loaded = loadWrapped(src.accountId);
        if (loaded && loaded.found && loaded.aggregate) {
          if (loaded.aggregate.createDigest === digested.digest) {
            const cloned = cloneOrNull(loaded.aggregate);
            return makeResult({
              ok: true,
              persisted: true,
              replayed: true,
              persistenceError: null,
              createDigest: digested.digest,
              revision: cloned.revision,
              accountState: cloneOrNull(cloned.accountState),
              aggregate: cloned,
            });
          }
          return persistError(
            PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT,
            undefined,
            snapshotFromAggregate(loaded.aggregate, { createDigest: digested.digest })
          );
        }
        return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN, undefined, {
          createDigest: digested.digest,
        });
      }
      return persistError(
        code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED,
        created.error && created.error.field,
        { createDigest: digested.digest }
      );
    }

    const stored = created.aggregate ? cloneOrNull(created.aggregate) : cloneOrNull(aggregate);
    const replayed = created.status === CREATE_STATUS.REPLAY;
    return makeResult({
      ok: true,
      persisted: true,
      replayed,
      persistenceError: null,
      createDigest: stored.createDigest,
      revision: stored.revision,
      accountState: cloneOrNull(stored.accountState),
      aggregate: stored,
    });
  }

  function runExecute(input, requestDigest, executionId, isRetry) {
    const extras = {
      requestDigest,
      executionId,
    };
    const loaded = loadWrapped(input.accountId);
    if (!loaded || loaded.found !== true || !loaded.aggregate) {
      if (loaded && loaded.error && loaded.error.code) {
        return persistError(loaded.error.code, loaded.error.field, extras);
      }
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND, undefined, extras);
    }

    const current = loaded.aggregate;
    extras.createDigest = current.createDigest;
    extras.revision = current.revision;
    extras.accountState = cloneOrNull(current.accountState);
    extras.aggregate = cloneOrNull(current);

    if (current.quarantine === true) {
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_QUARANTINED, undefined, extras);
    }

    const validated = validatePaperPersistenceAggregate(current);
    if (!validated.ok) {
      wrapRepoCall(() => repo.quarantineAccount(input.accountId));
      const after = loadWrapped(input.accountId);
      return persistError(validated.error.code, validated.error.field, snapshotFromAggregate(
        after && after.found ? after.aggregate : current,
        extras
      ));
    }

    const eventId = input.marketEvent.eventId;
    const sequence = input.marketEvent.sequence;
    const intentId = input.orderIntent.intentId;
    const identities = {
      eventId,
      sequence,
      intentId,
      executionId,
      requestDigest,
    };

    const idemp = checkIdempotency(current, identities);
    if (idemp.conflict) {
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT, undefined, extras);
    }
    if (idemp.replay) {
      return replayFrom(current, idemp.entry, extras);
    }

    const domainResult = executePaper({
      accountState: deepCloneOwn(current.accountState),
      marketEvent: input.marketEvent,
      orderIntent: input.orderIntent,
      riskDecision: input.riskDecision,
      userApproval: input.userApproval,
      riskConfig: input.riskConfig,
      paperExecutionEnabled: input.paperExecutionEnabled,
      costContext: input.costContext,
      executionId,
    });

    const nextState = domainResult && domainResult.accountState
      ? domainResult.accountState
      : null;
    if (!isConsuming(current.accountState, nextState)) {
      return makeResult({
        ok: true,
        persisted: false,
        replayed: false,
        persistenceError: null,
        requestDigest,
        createDigest: current.createDigest,
        executionId,
        revision: current.revision,
        domainResult: cloneOrNull(domainResult),
        accountState: cloneOrNull(current.accountState),
        aggregate: cloneOrNull(current),
      });
    }

    if (current.revision === Number.MAX_SAFE_INTEGER) {
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_OVERFLOW, undefined, extras);
    }

    const filled = isFilled(domainResult);
    const nextExecutedCount = Object.keys(nextState.executedIntentIds).length;
    const nextClosedCount = nextState.closedTrades.length;
    const nextAuditCount = current.auditRecords.length + 1;
    const nextExecCount = current.executionRecords.length + (filled ? 1 : 0);
    if (
      nextExecutedCount > RESOURCE_CAPS.MAX_EXECUTED_INTENT_IDS
      || nextClosedCount > RESOURCE_CAPS.MAX_CLOSED_TRADES
      || nextAuditCount > RESOURCE_CAPS.MAX_AUDIT_RECORDS
      || nextExecCount > RESOURCE_CAPS.MAX_EXECUTION_RECORDS
    ) {
      return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED, undefined, extras);
    }

    const postRevision = current.revision + 1;
    const paperStatus = domainResult.paperStatus;
    const auditRecord = {
      accountId: input.accountId,
      requestDigest,
      eventId,
      sequence,
      intentId,
      executionId: filled ? executionId : null,
      paperStatus,
      preRevision: current.revision,
      postRevision,
    };
    const nextAudit = current.auditRecords.slice();
    nextAudit.push(auditRecord);
    const nextExecRecords = current.executionRecords.slice();
    if (filled && domainResult.executionRecord) {
      const execRec = deepCloneOwn(domainResult.executionRecord);
      setOwn(execRec, "accountId", input.accountId);
      nextExecRecords.push(execRec);
    }

    const idempEntry = {
      requestDigest,
      executionId,
      revision: postRevision,
      domainResult: deepCloneOwn(domainResult),
      paperStatus,
    };
    const nextIdemp = indexNextIdemp(current.idempotency, identities, idempEntry);
    const nextAggregate = {
      schemaVersion: current.schemaVersion,
      accountId: current.accountId,
      revision: postRevision,
      accountState: deepCloneOwn(nextState),
      createDigest: current.createDigest,
      idempotency: nextIdemp,
      auditRecords: nextAudit,
      executionRecords: nextExecRecords,
      quarantine: current.quarantine,
    };

    const committed = wrapRepoCall(() => repo.commitAccount({
      accountId: input.accountId,
      expectedRevision: current.revision,
      nextAggregate,
    }));

    if (!committed.ok) {
      const code = committed.error && committed.error.code;
      const signal = committed.signal;
      if (
        signal === "REVISION_CONFLICT"
        || code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_CONFLICT
      ) {
        if (isRetry) {
          return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_RETRY_EXHAUSTED, undefined, extras);
        }
        return runExecute(input, requestDigest, executionId, true);
      }
      if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED) {
        return persistError(code, undefined, extras);
      }
      if (code === PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN) {
        const looked = wrapRepoCall(() => repo.lookupByIdentity(input.accountId, {
          eventId,
          sequence,
          intentId,
          executionId,
          requestDigest,
        }));
        if (looked && looked.conflict === true) {
          const afterConflict = loadWrapped(input.accountId);
          return persistError(
            PERSISTENCE_ERROR.PAPER_PERSISTENCE_IDENTITY_CONFLICT,
            undefined,
            snapshotFromAggregate(afterConflict && afterConflict.found ? afterConflict.aggregate : current, extras)
          );
        }
        if (looked && looked.match === true) {
          const afterMatch = loadWrapped(input.accountId);
          const agg = afterMatch && afterMatch.found ? afterMatch.aggregate : current;
          return replayFrom(agg, looked.entry, extras);
        }
        return persistError(PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN, undefined, extras);
      }
      return persistError(
        code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED,
        committed.error && committed.error.field,
        extras
      );
    }

    const after = loadWrapped(input.accountId);
    const stored = after && after.found && after.aggregate
      ? after.aggregate
      : nextAggregate;
    return makeResult({
      ok: true,
      persisted: true,
      replayed: false,
      persistenceError: null,
      requestDigest,
      createDigest: stored.createDigest,
      executionId,
      revision: stored.revision,
      domainResult: cloneOrNull(domainResult),
      accountState: cloneOrNull(stored.accountState),
      aggregate: cloneOrNull(stored),
    });
  }

  function execute(input) {
    const src = isPlainObject(input) ? input : {};
    const digested = digestRequest(src);
    if (!digested.ok) {
      return persistError(
        digested.error.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        digested.error.field
      );
    }
    const requestDigest = digested.digest;
    const derived = deriveExecutionId({
      accountId: src.accountId,
      eventId: src.marketEvent && src.marketEvent.eventId,
      sequence: src.marketEvent && src.marketEvent.sequence,
      intentId: src.orderIntent && src.orderIntent.intentId,
    });
    if (!derived.ok) {
      return persistError(
        derived.error.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        derived.error.field,
        { requestDigest }
      );
    }
    if (
      hasOwnRecordKey(src, "executionId")
      && typeof src.executionId === "string"
      && src.executionId.length > 0
      && src.executionId !== derived.executionId
    ) {
      return persistError(
        PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        "executionId",
        { requestDigest, executionId: derived.executionId }
      );
    }
    return runExecute(src, requestDigest, derived.executionId, false);
  }

  return {
    createAccount,
    execute,
  };
}

module.exports = {
  createPaperPersistenceService,
  PERSISTENCE_ERROR,
  RESOURCE_CAPS,
};
