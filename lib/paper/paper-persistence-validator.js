/**
 * GATE 11O Paper persistence aggregate validator. Fail-closed. No I/O.
 */

"use strict";

const {
  isPlainObject,
  isSafeInteger,
  isNonNegSafeInt,
  hasOwnRecordKey,
  validatePaperAccountState,
} = require("./paper-account-state");
const { PAPER_STATUS } = require("./paper-result");
const {
  PERSISTENCE_ERROR,
  CREATE_PREFIX,
} = require("./paper-persistence-canonical");

function fail(code, field) {
  const error = field === undefined ? { code } : { code, field };
  return { ok: false, error };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isIdentityMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateIdentityMap(map, field) {
  if (!isIdentityMap(map)) return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, field);
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!hasOwnRecordKey(map, key)) continue;
    if (!isNonEmptyString(key) || !isNonEmptyString(map[key])) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, field);
    }
  }
  return { ok: true };
}

function mapGet(map, key) {
  if (!hasOwnRecordKey(map, key)) return undefined;
  return map[key];
}

function recordSeen(seen, key, field) {
  if (!isNonEmptyString(key)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, field);
  }
  if (hasOwnRecordKey(seen, key)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, field);
  }
  Object.defineProperty(seen, key, {
    value: true,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return { ok: true };
}

function validatePaperPersistenceAggregate(aggregate) {
  if (!isPlainObject(aggregate)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  }

  if (typeof aggregate.schemaVersion !== "number" || aggregate.schemaVersion !== 1) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA, "schemaVersion");
  }

  if (!isNonEmptyString(aggregate.accountId)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "accountId");
  }
  if (!isNonNegSafeInt(aggregate.revision)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "revision");
  }
  if (!isNonEmptyString(aggregate.createDigest) || aggregate.createDigest.indexOf(CREATE_PREFIX) !== 0) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "createDigest");
  }
  if (typeof aggregate.quarantine !== "boolean") {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "quarantine");
  }

  const stateVal = validatePaperAccountState(aggregate.accountState);
  if (!stateVal.ok) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "accountState");
  }
  const state = aggregate.accountState;
  if (state.accountId !== aggregate.accountId) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "accountId");
  }

  const seq = state.lastProcessedSequence;
  const eid = state.lastProcessedEventId;
  const seqSet = seq !== null;
  const eidSet = eid !== null;
  if (seqSet !== eidSet) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "cursor");
  }

  const idemp = aggregate.idempotency;
  if (!isPlainObject(idemp)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "idempotency");
  }
  const mapChecks = [
    ["byEventId", idemp.byEventId],
    ["bySequence", idemp.bySequence],
    ["byIntentId", idemp.byIntentId],
    ["byExecutionId", idemp.byExecutionId],
    ["byRequestDigest", idemp.byRequestDigest],
  ];
  for (let i = 0; i < mapChecks.length; i += 1) {
    const name = mapChecks[i][0];
    const map = mapChecks[i][1];
    if (name === "byRequestDigest") {
      if (!isIdentityMap(map)) {
        return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, name);
      }
      const keys = Object.keys(map);
      for (let k = 0; k < keys.length; k += 1) {
        const key = keys[k];
        if (!hasOwnRecordKey(map, key) || !isNonEmptyString(key)) {
          return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, name);
        }
        const entry = map[key];
        if (!isPlainObject(entry) || !isNonEmptyString(entry.requestDigest)) {
          return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, name);
        }
      }
    } else {
      const checked = validateIdentityMap(map, name);
      if (!checked.ok) return checked;
    }
  }

  if (!Array.isArray(aggregate.auditRecords) || !Array.isArray(aggregate.executionRecords)) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  }

  const seenEvent = Object.create(null);
  const seenSeq = Object.create(null);
  const seenIntent = Object.create(null);
  const seenDigest = Object.create(null);
  const seenExecAudit = Object.create(null);
  const filledExecIds = Object.create(null);

  for (let i = 0; i < aggregate.auditRecords.length; i += 1) {
    const audit = aggregate.auditRecords[i];
    if (!isPlainObject(audit)) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "auditRecords");
    }
    if (hasOwnRecordKey(audit, "accountId") && audit.accountId !== aggregate.accountId) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "accountId");
    }
    if (!isNonEmptyString(audit.requestDigest)
      || !isNonEmptyString(audit.eventId)
      || !isNonEmptyString(audit.intentId)
      || !isNonNegSafeInt(audit.sequence)) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "auditRecords");
    }
    const ev = recordSeen(seenEvent, audit.eventId, "eventId");
    if (!ev.ok) return ev;
    const sq = recordSeen(seenSeq, String(audit.sequence), "sequence");
    if (!sq.ok) return sq;
    const it = recordSeen(seenIntent, audit.intentId, "intentId");
    if (!it.ok) return it;
    const dg = recordSeen(seenDigest, audit.requestDigest, "requestDigest");
    if (!dg.ok) return dg;

    if (mapGet(idemp.byEventId, audit.eventId) !== audit.requestDigest) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "byEventId");
    }
    if (mapGet(idemp.bySequence, String(audit.sequence)) !== audit.requestDigest) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "bySequence");
    }
    if (mapGet(idemp.byIntentId, audit.intentId) !== audit.requestDigest) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "byIntentId");
    }
    if (!hasOwnRecordKey(idemp.byRequestDigest, audit.requestDigest)) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "byRequestDigest");
    }

    if (audit.paperStatus === PAPER_STATUS.FILLED) {
      if (!isNonEmptyString(audit.executionId)) {
        return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "executionId");
      }
      const ex = recordSeen(seenExecAudit, audit.executionId, "executionId");
      if (!ex.ok) return ex;
      Object.defineProperty(filledExecIds, audit.executionId, {
        value: true,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      if (mapGet(idemp.byExecutionId, audit.executionId) !== audit.requestDigest) {
        return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "byExecutionId");
      }
    } else if (audit.paperStatus === PAPER_STATUS.BLOCKED) {
      if (audit.executionId !== null) {
        return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "executionId");
      }
    } else {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "paperStatus");
    }
  }

  const execIds = Object.create(null);
  for (let i = 0; i < aggregate.executionRecords.length; i += 1) {
    const rec = aggregate.executionRecords[i];
    if (!isPlainObject(rec) || !isNonEmptyString(rec.executionId)) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "executionRecords");
    }
    if (hasOwnRecordKey(rec, "accountId") && rec.accountId !== aggregate.accountId) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "accountId");
    }
    if (hasOwnRecordKey(execIds, rec.executionId)) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "executionId");
    }
    Object.defineProperty(execIds, rec.executionId, {
      value: true,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    if (!hasOwnRecordKey(filledExecIds, rec.executionId)) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "executionRecords");
    }
  }

  const filledKeys = Object.keys(filledExecIds);
  for (let i = 0; i < filledKeys.length; i += 1) {
    if (!hasOwnRecordKey(execIds, filledKeys[i])) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "executionRecords");
    }
  }

  if (aggregate.auditRecords.length > 0) {
    const last = aggregate.auditRecords[aggregate.auditRecords.length - 1];
    if (last.eventId !== eid || last.sequence !== seq) {
      return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "cursor");
    }
  } else if (seqSet || eidSet) {
    return fail(PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE, "cursor");
  }

  return { ok: true, error: null };
}

module.exports = {
  PERSISTENCE_ERROR,
  validatePaperPersistenceAggregate,
};
