/**
 * GATE 12P Paper approval manager v1.
 * Process-local EXPLICIT_ONE_TIME. Injected clock only. No HTTP/auth/financial mutation.
 */

"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { encodeCanonical, deepCloneOwn, setOwn } = require("./paper-persistence-canonical");
const {
  isPlainObject,
  hasOwnRecordKey,
} = require("./paper-account-state");

const DIGEST_PREFIX = "paper-approval-v1:";
const SEQUENCE_RE = /^(0|[1-9][0-9]*)$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATE = Object.freeze({
  ISSUED: "ISSUED",
  CONSUMED: "CONSUMED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  INVALIDATED: "INVALIDATED",
});

const ERROR = Object.freeze({
  PAPER_APPROVAL_INVALID_INPUT: "PAPER_APPROVAL_INVALID_INPUT",
  PAPER_APPROVAL_UNKNOWN_FIELD: "PAPER_APPROVAL_UNKNOWN_FIELD",
  PAPER_APPROVAL_MISSING_FIELD: "PAPER_APPROVAL_MISSING_FIELD",
  PAPER_APPROVAL_MISSING_CLOCK: "PAPER_APPROVAL_MISSING_CLOCK",
  PAPER_APPROVAL_INVALID_TTL: "PAPER_APPROVAL_INVALID_TTL",
  PAPER_APPROVAL_MISSING_PRINCIPAL: "PAPER_APPROVAL_MISSING_PRINCIPAL",
  PAPER_APPROVAL_CONFLICT: "PAPER_APPROVAL_CONFLICT",
  PAPER_APPROVAL_NOT_FOUND: "PAPER_APPROVAL_NOT_FOUND",
  PAPER_APPROVAL_NOT_ISSUED: "PAPER_APPROVAL_NOT_ISSUED",
  PAPER_APPROVAL_ALREADY_CONSUMED: "PAPER_APPROVAL_ALREADY_CONSUMED",
  PAPER_APPROVAL_REVOKED: "PAPER_APPROVAL_REVOKED",
  PAPER_APPROVAL_EXPIRED: "PAPER_APPROVAL_EXPIRED",
  PAPER_APPROVAL_INVALIDATED: "PAPER_APPROVAL_INVALIDATED",
  PAPER_APPROVAL_SUBJECT_MISMATCH: "PAPER_APPROVAL_SUBJECT_MISMATCH",
  PAPER_APPROVAL_IDENTITY_MISMATCH: "PAPER_APPROVAL_IDENTITY_MISMATCH",
  PAPER_APPROVAL_SEQUENCE_MISMATCH: "PAPER_APPROVAL_SEQUENCE_MISMATCH",
  PAPER_APPROVAL_NO_RESURRECTION: "PAPER_APPROVAL_NO_RESURRECTION",
  PAPER_APPROVAL_CANNOT_REVOKE: "PAPER_APPROVAL_CANNOT_REVOKE",
});

const SUBJECT_REQUIRED = Object.freeze([
  "accountId",
  "sessionId",
  "market",
  "symbol",
  "tradingDate",
  "sequence",
  "eventDigest",
  "intentId",
  "intentDigest",
  "riskDecisionId",
  "riskDecisionDigest",
  "configSnapshotId",
]);
const SUBJECT_OPTIONAL = Object.freeze(["validAfterEventSequence"]);
const SUBJECT_ALLOWED = new Set([...SUBJECT_REQUIRED, ...SUBJECT_OPTIONAL]);

const ISSUE_ALLOWED = new Set(["subject", "approvedByPrincipal"]);
const CONSUME_ALLOWED = new Set([
  "approvalId",
  "subjectDigest",
  "accountId",
  "sessionId",
  "market",
  "symbol",
  "tradingDate",
  "sequence",
]);
const INVALIDATE_ALLOWED = new Set(["market", "symbol", "newSequence"]);

function sha256Hex(utf8Text) {
  return createHash("sha256").update(utf8Text, "utf8").digest("hex");
}

function fail(code, field) {
  const out = { ok: false, code: code, approval: null };
  if (field !== undefined) out.field = field;
  return out;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function freezeOwnTree(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) freezeOwnTree(value[i]);
    return Object.freeze(value);
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) freezeOwnTree(value[keys[i]]);
  return Object.freeze(value);
}

function rejectUnknownOwn(record, allowed, fieldPrefix) {
  if (!isPlainObject(record)) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, fieldPrefix);
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    if (!allowed.has(keys[i])) {
      return fail(ERROR.PAPER_APPROVAL_UNKNOWN_FIELD, keys[i]);
    }
  }
  return null;
}

function nestedGet(root, keys) {
  let current = root;
  for (let i = 0; i < keys.length; i += 1) {
    if (current == null) return undefined;
    current = current.get(keys[i]);
  }
  return current;
}

function nestedSet(root, keys, value) {
  let current = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    let next = current.get(keys[i]);
    if (next == null) {
      next = new Map();
      current.set(keys[i], next);
    }
    current = next;
  }
  current.set(keys[keys.length - 1], value);
}

function nestedDelete(root, keys) {
  const stack = [root];
  let current = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    current = current.get(keys[i]);
    if (current == null) return false;
    stack.push(current);
  }
  const deleted = current.delete(keys[keys.length - 1]);
  for (let i = keys.length - 1; i >= 1; i -= 1) {
    const child = stack[i];
    if (child.size !== 0) break;
    stack[i - 1].delete(keys[i - 1]);
  }
  return deleted;
}

function cloneApproval(record) {
  return freezeOwnTree(deepCloneOwn(record));
}

function canonicalizeSubject(rawSubject) {
  const unknown = rejectUnknownOwn(rawSubject, SUBJECT_ALLOWED, "subject");
  if (unknown) return unknown;

  for (let i = 0; i < SUBJECT_REQUIRED.length; i += 1) {
    const key = SUBJECT_REQUIRED[i];
    if (!hasOwnRecordKey(rawSubject, key)) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, key);
    }
  }

  const subject = {};
  for (let i = 0; i < SUBJECT_REQUIRED.length; i += 1) {
    const key = SUBJECT_REQUIRED[i];
    const value = rawSubject[key];
    if (key === "sequence") {
      if (typeof value !== "string" || !SEQUENCE_RE.test(value)) {
        return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "sequence");
      }
    } else if (key === "tradingDate") {
      if (typeof value !== "string" || !YMD_RE.test(value)) {
        return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "tradingDate");
      }
    } else if (!isNonEmptyString(value)) {
      return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, key);
    }
    setOwn(subject, key, value);
  }

  if (hasOwnRecordKey(rawSubject, "validAfterEventSequence")) {
    const audit = rawSubject.validAfterEventSequence;
    if (typeof audit === "string") {
      if (!SEQUENCE_RE.test(audit)) {
        return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "validAfterEventSequence");
      }
      setOwn(subject, "validAfterEventSequence", audit);
    } else if (typeof audit === "number" && Number.isSafeInteger(audit) && audit >= 0) {
      setOwn(subject, "validAfterEventSequence", audit);
    } else {
      return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "validAfterEventSequence");
    }
  }

  let subjectDigest;
  try {
    subjectDigest = DIGEST_PREFIX + sha256Hex(encodeCanonical(subject));
  } catch (_err) {
    return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "subject");
  }

  return { ok: true, subject: freezeOwnTree(subject), subjectDigest: subjectDigest };
}

function createPaperApprovalManager(input) {
  const src = isPlainObject(input) ? input : {};
  const clock = hasOwnRecordKey(src, "clock") ? src.clock : null;
  const approvalTtlMs = hasOwnRecordKey(src, "approvalTtlMs") ? src.approvalTtlMs : undefined;

  function blockedFactory(code, field) {
    const blocked = function blockedOp() {
      return fail(code, field);
    };
    return Object.freeze({
      issue: blocked,
      consume: blocked,
      revoke: blocked,
      invalidateForMarketAdvance: blocked,
      inspect: blocked,
    });
  }

  if (clock == null || !isPlainObject(clock) || typeof clock.now !== "function") {
    return blockedFactory(ERROR.PAPER_APPROVAL_MISSING_CLOCK, "clock");
  }
  if (!Number.isSafeInteger(approvalTtlMs) || approvalTtlMs < 1 || approvalTtlMs > 86400000) {
    return blockedFactory(ERROR.PAPER_APPROVAL_INVALID_TTL, "approvalTtlMs");
  }

  const byId = new Map();
  const pendingByTuple = new Map();
  const issuedByMarketSymbol = new Map();
  const bySubjectDigest = new Map();

  function pendingPath(subject) {
    return [subject.accountId, subject.sessionId, subject.market, subject.symbol];
  }

  function marketPath(market, symbol) {
    return [market, symbol];
  }

  function getPendingId(subject) {
    return nestedGet(pendingByTuple, pendingPath(subject));
  }

  function setPendingId(subject, approvalId) {
    nestedSet(pendingByTuple, pendingPath(subject), approvalId);
  }

  function clearPending(subject) {
    nestedDelete(pendingByTuple, pendingPath(subject));
  }

  function indexIssued(record) {
    const path = marketPath(record.subject.market, record.subject.symbol);
    let bucket = nestedGet(issuedByMarketSymbol, path);
    if (bucket == null) {
      bucket = new Set();
      nestedSet(issuedByMarketSymbol, path, bucket);
    }
    bucket.add(record);
  }

  function unindexIssued(record) {
    const path = marketPath(record.subject.market, record.subject.symbol);
    const bucket = nestedGet(issuedByMarketSymbol, path);
    if (bucket == null) return;
    bucket.delete(record);
    if (bucket.size === 0) nestedDelete(issuedByMarketSymbol, path);
  }

  function releaseIssued(record) {
    clearPending(record.subject);
    unindexIssued(record);
  }

  function nowMs() {
    const value = clock.now();
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
  }

  function expireIfNeeded(record, now) {
    if (record.state !== STATE.ISSUED) return record;
    if (now - record.issuedAt <= approvalTtlMs) return record;
    record.state = STATE.EXPIRED;
    releaseIssued(record);
    return record;
  }

  function issue(payload) {
    const unknown = rejectUnknownOwn(payload, ISSUE_ALLOWED, "issue");
    if (unknown) return unknown;
    if (!isPlainObject(payload) || !hasOwnRecordKey(payload, "subject")) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, "subject");
    }
    if (!hasOwnRecordKey(payload, "approvedByPrincipal")
      || !isNonEmptyString(payload.approvedByPrincipal)) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_PRINCIPAL, "approvedByPrincipal");
    }

    const canonical = canonicalizeSubject(payload.subject);
    if (!canonical.ok) return canonical;

    const now = nowMs();
    if (now == null) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "clock");

    const subject = canonical.subject;
    const subjectDigest = canonical.subjectDigest;
    const principal = payload.approvedByPrincipal;

    const existingDigestId = bySubjectDigest.get(subjectDigest);
    if (existingDigestId) {
      const existing = byId.get(existingDigestId);
      if (existing) {
        expireIfNeeded(existing, now);
        if (existing.state === STATE.ISSUED
          && existing.approvedByPrincipal === principal
          && existing.subjectDigest === subjectDigest) {
          return { ok: true, code: null, approval: cloneApproval(existing), idempotent: true };
        }
        if (existing.state !== STATE.ISSUED) {
          return fail(ERROR.PAPER_APPROVAL_NO_RESURRECTION, "subject");
        }
        return fail(ERROR.PAPER_APPROVAL_CONFLICT, "approvedByPrincipal");
      }
    }

    const pendingId = getPendingId(subject);
    if (pendingId) {
      const pending = byId.get(pendingId);
      if (pending) {
        expireIfNeeded(pending, now);
        if (pending.state === STATE.ISSUED) {
          if (pending.subjectDigest === subjectDigest && pending.approvedByPrincipal === principal) {
            return { ok: true, code: null, approval: cloneApproval(pending), idempotent: true };
          }
          return fail(ERROR.PAPER_APPROVAL_CONFLICT, "subject");
        }
      }
    }

    const approvalId = randomUUID();
    const record = {};
    setOwn(record, "approvalId", approvalId);
    setOwn(record, "state", STATE.ISSUED);
    setOwn(record, "subject", deepCloneOwn(subject));
    setOwn(record, "subjectDigest", subjectDigest);
    setOwn(record, "approvedByPrincipal", principal);
    setOwn(record, "issuedAt", now);
    setOwn(record, "approvalTtlMs", approvalTtlMs);
    setOwn(record, "sequence", subject.sequence);

    byId.set(approvalId, record);
    setPendingId(subject, approvalId);
    indexIssued(record);
    bySubjectDigest.set(subjectDigest, approvalId);

    return { ok: true, code: null, approval: cloneApproval(record), idempotent: false };
  }

  function consume(payload) {
    const unknown = rejectUnknownOwn(payload, CONSUME_ALLOWED, "consume");
    if (unknown) return unknown;
    if (!isPlainObject(payload)) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "consume");
    if (!hasOwnRecordKey(payload, "approvalId") || !isNonEmptyString(payload.approvalId)) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, "approvalId");
    }
    if (!hasOwnRecordKey(payload, "subjectDigest") || !isNonEmptyString(payload.subjectDigest)) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, "subjectDigest");
    }

    const identityFields = ["accountId", "sessionId", "market", "symbol", "tradingDate", "sequence"];
    for (let i = 0; i < identityFields.length; i += 1) {
      const key = identityFields[i];
      if (!hasOwnRecordKey(payload, key)) {
        return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, key);
      }
    }
    if (typeof payload.sequence !== "string" || !SEQUENCE_RE.test(payload.sequence)) {
      return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "sequence");
    }

    const record = byId.get(payload.approvalId);
    if (!record) return fail(ERROR.PAPER_APPROVAL_NOT_FOUND, "approvalId");

    const now = nowMs();
    if (now == null) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "clock");
    expireIfNeeded(record, now);

    if (record.state === STATE.CONSUMED) {
      return {
        ok: true,
        code: ERROR.PAPER_APPROVAL_ALREADY_CONSUMED,
        noop: true,
        financial: 0,
        approval: cloneApproval(record),
      };
    }
    if (record.state === STATE.REVOKED) return fail(ERROR.PAPER_APPROVAL_REVOKED, "approvalId");
    if (record.state === STATE.EXPIRED) return fail(ERROR.PAPER_APPROVAL_EXPIRED, "approvalId");
    if (record.state === STATE.INVALIDATED) return fail(ERROR.PAPER_APPROVAL_INVALIDATED, "approvalId");
    if (record.state !== STATE.ISSUED) return fail(ERROR.PAPER_APPROVAL_NOT_ISSUED, "approvalId");

    if (record.subjectDigest !== payload.subjectDigest) {
      return fail(ERROR.PAPER_APPROVAL_SUBJECT_MISMATCH, "subjectDigest");
    }

    const subject = record.subject;
    if (payload.accountId !== subject.accountId
      || payload.sessionId !== subject.sessionId
      || payload.market !== subject.market
      || payload.symbol !== subject.symbol) {
      return fail(ERROR.PAPER_APPROVAL_IDENTITY_MISMATCH, "execution");
    }

    if (payload.tradingDate !== subject.tradingDate) {
      record.state = STATE.EXPIRED;
      releaseIssued(record);
      return fail(ERROR.PAPER_APPROVAL_EXPIRED, "tradingDate");
    }

    if (payload.sequence !== subject.sequence) {
      return fail(ERROR.PAPER_APPROVAL_SEQUENCE_MISMATCH, "sequence");
    }

    record.state = STATE.CONSUMED;
    releaseIssued(record);
    return { ok: true, code: null, noop: false, financial: 0, approval: cloneApproval(record) };
  }

  function revoke(approvalId) {
    if (!isNonEmptyString(approvalId)) {
      return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "approvalId");
    }
    const record = byId.get(approvalId);
    if (!record) return fail(ERROR.PAPER_APPROVAL_NOT_FOUND, "approvalId");
    const now = nowMs();
    if (now == null) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "clock");
    expireIfNeeded(record, now);
    if (record.state !== STATE.ISSUED) {
      return fail(ERROR.PAPER_APPROVAL_CANNOT_REVOKE, "state");
    }
    record.state = STATE.REVOKED;
    releaseIssued(record);
    return { ok: true, code: null, approval: cloneApproval(record) };
  }

  function invalidateForMarketAdvance(payload) {
    const unknown = rejectUnknownOwn(payload, INVALIDATE_ALLOWED, "invalidate");
    if (unknown) return unknown;
    if (!isPlainObject(payload)) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "invalidate");
    if (!hasOwnRecordKey(payload, "market") || !isNonEmptyString(payload.market)) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, "market");
    }
    if (!hasOwnRecordKey(payload, "symbol") || !isNonEmptyString(payload.symbol)) {
      return fail(ERROR.PAPER_APPROVAL_MISSING_FIELD, "symbol");
    }
    if (!hasOwnRecordKey(payload, "newSequence")
      || typeof payload.newSequence !== "string"
      || !SEQUENCE_RE.test(payload.newSequence)) {
      return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "newSequence");
    }

    const newSeq = BigInt(payload.newSequence);
    const invalidated = [];
    const bucket = nestedGet(issuedByMarketSymbol, marketPath(payload.market, payload.symbol));
    if (bucket != null) {
      const snapshot = Array.from(bucket);
      for (let i = 0; i < snapshot.length; i += 1) {
        const record = snapshot[i];
        if (record.state !== STATE.ISSUED) continue;
        if (newSeq > BigInt(record.sequence)) {
          record.state = STATE.INVALIDATED;
          releaseIssued(record);
          invalidated.push(cloneApproval(record));
        }
      }
    }
    return { ok: true, code: null, invalidated: Object.freeze(invalidated), count: invalidated.length };
  }

  function inspect(approvalId) {
    if (!isNonEmptyString(approvalId)) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "approvalId");
    const record = byId.get(approvalId);
    if (!record) return fail(ERROR.PAPER_APPROVAL_NOT_FOUND, "approvalId");
    const now = nowMs();
    if (now == null) return fail(ERROR.PAPER_APPROVAL_INVALID_INPUT, "clock");
    expireIfNeeded(record, now);
    return { ok: true, found: true, approval: cloneApproval(record) };
  }

  return Object.freeze({
    issue: issue,
    consume: consume,
    revoke: revoke,
    invalidateForMarketAdvance: invalidateForMarketAdvance,
    inspect: inspect,
  });
}

module.exports = {
  createPaperApprovalManager,
  canonicalizeSubject,
  STATE,
  ERROR,
  DIGEST_PREFIX,
  SUBJECT_REQUIRED,
};
