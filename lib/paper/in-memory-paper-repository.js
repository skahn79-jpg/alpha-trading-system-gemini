/**
 * GATE 11O In-memory paper persistence repository.
 * Own-key maps only. No network. No fs.
 */

"use strict";

const { PERSISTENCE_ERROR, deepCloneOwn, setOwn } = require("./paper-persistence-canonical");
const { hasOwnRecordKey } = require("./paper-account-state");

const CREATE_STATUS = Object.freeze({ CREATED: "CREATED", REPLAY: "REPLAY" });

const CREATE_INJECT = Object.freeze({
  FAILED: "FAILED",
  UNKNOWN_COMMITTED: "UNKNOWN_COMMITTED",
  UNKNOWN_UNRESOLVED: "UNKNOWN_UNRESOLVED",
});

const COMMIT_INJECT = Object.freeze({
  FAILED: "FAILED",
  UNKNOWN_COMMITTED: "UNKNOWN_COMMITTED",
  UNKNOWN_UNRESOLVED: "UNKNOWN_UNRESOLVED",
  CONFLICT: "CONFLICT",
});

function emptyQueueMap() {
  return Object.create(null);
}

function enqueue(queues, accountId, kind) {
  if (!hasOwnRecordKey(queues, accountId)) {
    setOwn(queues, accountId, []);
  }
  queues[accountId].push(kind);
}

function dequeue(queues, accountId) {
  if (!hasOwnRecordKey(queues, accountId)) return undefined;
  const q = queues[accountId];
  if (!Array.isArray(q) || q.length === 0) return undefined;
  return q.shift();
}

function mapGetOwn(map, key) {
  if (!map || typeof key !== "string" || !hasOwnRecordKey(map, key)) return undefined;
  return map[key];
}

function createInMemoryPaperRepository() {
  const accounts = Object.create(null);
  const createInjects = emptyQueueMap();
  const commitInjects = emptyQueueMap();

  function storedAccount(accountId) {
    if (!hasOwnRecordKey(accounts, accountId)) return undefined;
    return accounts[accountId];
  }

  function writeAccount(accountId, aggregate) {
    setOwn(accounts, accountId, deepCloneOwn(aggregate));
  }

  function loadAccount(accountId) {
    const stored = storedAccount(accountId);
    if (stored === undefined) {
      return { found: false, aggregate: null };
    }
    return { found: true, aggregate: deepCloneOwn(stored) };
  }

  function createAccountIfAbsent(input) {
    const src = input && typeof input === "object" ? input : {};
    const accountId = src.accountId;
    const createDigest = src.createDigest;
    const existing = storedAccount(accountId);
    if (existing !== undefined) {
      if (existing.createDigest === createDigest) {
        return {
          ok: true,
          status: CREATE_STATUS.REPLAY,
          aggregate: deepCloneOwn(existing),
        };
      }
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT },
      };
    }

    const inject = dequeue(createInjects, accountId);
    if (inject === CREATE_INJECT.FAILED) {
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED },
      };
    }
    if (inject === CREATE_INJECT.UNKNOWN_UNRESOLVED) {
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN },
      };
    }
    if (inject === CREATE_INJECT.UNKNOWN_COMMITTED) {
      writeAccount(accountId, src.aggregate);
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN },
      };
    }

    writeAccount(accountId, src.aggregate);
    return {
      ok: true,
      status: CREATE_STATUS.CREATED,
      aggregate: deepCloneOwn(storedAccount(accountId)),
    };
  }

  function commitAccount(input) {
    const src = input && typeof input === "object" ? input : {};
    const accountId = src.accountId;
    const inject = dequeue(commitInjects, accountId);

    if (inject === COMMIT_INJECT.CONFLICT) {
      return {
        ok: false,
        signal: "REVISION_CONFLICT",
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_CONFLICT },
      };
    }
    if (inject === COMMIT_INJECT.FAILED) {
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED },
      };
    }
    if (inject === COMMIT_INJECT.UNKNOWN_UNRESOLVED) {
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN },
      };
    }

    const existing = storedAccount(accountId);
    if (existing === undefined || existing.revision !== src.expectedRevision) {
      return {
        ok: false,
        signal: "REVISION_CONFLICT",
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_CONFLICT },
      };
    }

    if (inject === COMMIT_INJECT.UNKNOWN_COMMITTED) {
      writeAccount(accountId, src.nextAggregate);
      return {
        ok: false,
        error: { code: PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN },
      };
    }

    writeAccount(accountId, src.nextAggregate);
    return { ok: true };
  }

  function lookupByIdentity(accountId, query) {
    const stored = storedAccount(accountId);
    if (stored === undefined) {
      return {
        found: false,
        match: false,
        conflict: false,
        reason: null,
        entry: null,
      };
    }
    const idemp = stored.idempotency && typeof stored.idempotency === "object"
      ? stored.idempotency
      : {};
    const q = query && typeof query === "object" ? query : {};
    const digestFromQuery = typeof q.requestDigest === "string" && q.requestDigest.length > 0
      ? q.requestDigest
      : null;

    const identityDigests = [];
    function pushIfPresent(map, key) {
      if (key === undefined || key === null) return;
      const storedDigest = mapGetOwn(map, String(key));
      if (storedDigest !== undefined) identityDigests.push(storedDigest);
    }
    pushIfPresent(idemp.byEventId, q.eventId);
    if (q.sequence !== undefined && q.sequence !== null) {
      pushIfPresent(idemp.bySequence, String(q.sequence));
    }
    pushIfPresent(idemp.byIntentId, q.intentId);
    pushIfPresent(idemp.byExecutionId, q.executionId);

    function entryFor(digest) {
      if (!digest || !hasOwnRecordKey(idemp.byRequestDigest, digest)) return null;
      return deepCloneOwn(idemp.byRequestDigest[digest]);
    }

    if (digestFromQuery) {
      for (let i = 0; i < identityDigests.length; i += 1) {
        if (identityDigests[i] !== digestFromQuery) {
          return {
            found: true,
            match: false,
            conflict: true,
            reason: "IDENTITY",
            entry: null,
          };
        }
      }
      if (hasOwnRecordKey(idemp.byRequestDigest, digestFromQuery)) {
        return {
          found: true,
          match: true,
          conflict: false,
          reason: null,
          entry: entryFor(digestFromQuery),
        };
      }
      if (identityDigests.length > 0) {
        return {
          found: true,
          match: true,
          conflict: false,
          reason: null,
          entry: entryFor(identityDigests[0]),
        };
      }
      return {
        found: true,
        match: false,
        conflict: false,
        reason: null,
        entry: null,
      };
    }

    if (identityDigests.length > 0) {
      const first = identityDigests[0];
      for (let i = 1; i < identityDigests.length; i += 1) {
        if (identityDigests[i] !== first) {
          return {
            found: true,
            match: false,
            conflict: true,
            reason: "IDENTITY",
            entry: null,
          };
        }
      }
      return {
        found: true,
        match: true,
        conflict: false,
        reason: null,
        entry: entryFor(first),
      };
    }

    return {
      found: true,
      match: false,
      conflict: false,
      reason: null,
      entry: null,
    };
  }

  function quarantineAccount(accountId) {
    const existing = storedAccount(accountId);
    if (existing === undefined) {
      return { ok: false, found: false };
    }
    const next = deepCloneOwn(existing);
    next.quarantine = true;
    writeAccount(accountId, next);
    return { ok: true, found: true };
  }

  function injectCommit(accountId, kind) {
    enqueue(commitInjects, accountId, kind);
  }

  function injectCreate(accountId, kind) {
    enqueue(createInjects, accountId, kind);
  }

  function testOnlyReplaceAggregate(accountId, aggregate) {
    writeAccount(accountId, aggregate);
  }

  function testOnlyAccountCount() {
    return Object.keys(accounts).length;
  }

  return {
    loadAccount,
    createAccountIfAbsent,
    commitAccount,
    lookupByIdentity,
    quarantineAccount,
    injectCommit,
    injectCreate,
    testOnlyReplaceAggregate,
    testOnlyAccountCount,
  };
}

module.exports = {
  PERSISTENCE_ERROR,
  CREATE_STATUS,
  createInMemoryPaperRepository,
};
