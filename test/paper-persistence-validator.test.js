"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERSISTENCE_ERROR,
  digestCreate,
  setOwn,
} = require("../lib/paper/paper-persistence-canonical");
const {
  validatePaperPersistenceAggregate,
} = require("../lib/paper/paper-persistence-validator");
const { createPaperAccountState } = require("../lib/paper/paper-account-state");
const { PAPER_STATUS } = require("../lib/paper/paper-result");

function emptyIdemp() {
  return {
    byEventId: Object.create(null),
    bySequence: Object.create(null),
    byIntentId: Object.create(null),
    byExecutionId: Object.create(null),
    byRequestDigest: Object.create(null),
  };
}

function makeValidAggregate(overrides) {
  const accountId = overrides && overrides.accountId ? overrides.accountId : "acc-val";
  const initialCash = 1000;
  const created = digestCreate({ accountId, initialCash });
  const base = {
    schemaVersion: 1,
    accountId,
    revision: 0,
    accountState: createPaperAccountState({ accountId, initialCash }),
    createDigest: created.digest,
    idempotency: emptyIdemp(),
    auditRecords: [],
    executionRecords: [],
    quarantine: false,
  };
  return Object.assign(base, overrides || {});
}

function indexAudit(idemp, audit) {
  setOwn(idemp.byEventId, audit.eventId, audit.requestDigest);
  setOwn(idemp.bySequence, String(audit.sequence), audit.requestDigest);
  setOwn(idemp.byIntentId, audit.intentId, audit.requestDigest);
  setOwn(idemp.byRequestDigest, audit.requestDigest, { requestDigest: audit.requestDigest });
  if (audit.paperStatus === PAPER_STATUS.FILLED && audit.executionId) {
    setOwn(idemp.byExecutionId, audit.executionId, audit.requestDigest);
  }
}

function makeFilledAggregate() {
  const accountId = "acc-filled";
  const initialCash = 1000;
  const created = digestCreate({ accountId, initialCash });
  const accountState = createPaperAccountState({ accountId, initialCash });
  accountState.lastProcessedSequence = 11;
  accountState.lastProcessedEventId = "evt-11";
  const idemp = emptyIdemp();
  const audit = {
    accountId,
    requestDigest: "paper-request-v1:filled1",
    eventId: "evt-11",
    sequence: 11,
    intentId: "intent-1",
    executionId: "paper-exec-v1:filled1",
    paperStatus: PAPER_STATUS.FILLED,
    preRevision: 0,
    postRevision: 1,
  };
  indexAudit(idemp, audit);
  return {
    schemaVersion: 1,
    accountId,
    revision: 1,
    accountState,
    createDigest: created.digest,
    idempotency: idemp,
    auditRecords: [audit],
    executionRecords: [{ executionId: audit.executionId, accountId }],
    quarantine: false,
  };
}

function makeBlockedAggregate() {
  const accountId = "acc-blocked";
  const initialCash = 1000;
  const created = digestCreate({ accountId, initialCash });
  const accountState = createPaperAccountState({ accountId, initialCash });
  accountState.lastProcessedSequence = 11;
  accountState.lastProcessedEventId = "evt-11";
  const idemp = emptyIdemp();
  const audit = {
    accountId,
    requestDigest: "paper-request-v1:blocked1",
    eventId: "evt-11",
    sequence: 11,
    intentId: "intent-1",
    executionId: null,
    paperStatus: PAPER_STATUS.BLOCKED,
    preRevision: 0,
    postRevision: 1,
  };
  indexAudit(idemp, audit);
  return {
    schemaVersion: 1,
    accountId,
    revision: 1,
    accountState,
    createDigest: created.digest,
    idempotency: idemp,
    auditRecords: [audit],
    executionRecords: [],
    quarantine: false,
  };
}

test("P56 unsupported schema: schemaVersion 2, \"1\", true", () => {
  const cases = [2, "1", true];
  for (let i = 0; i < cases.length; i += 1) {
    const agg = makeValidAggregate({ schemaVersion: cases[i] });
    const result = validatePaperPersistenceAggregate(agg);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA);
  }
});

test("P57 corrupt revision: -1, 1.5, \"0\"", () => {
  const cases = [-1, 1.5, "0"];
  for (let i = 0; i < cases.length; i += 1) {
    const agg = makeValidAggregate({ revision: cases[i] });
    const result = validatePaperPersistenceAggregate(agg);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
    assert.equal(result.error.field, "revision");
  }
});

test("P58 corrupt accountState bad cash and extra forbidden key", () => {
  const badCash = makeValidAggregate();
  badCash.accountState = Object.assign({}, badCash.accountState, { cash: -1 });
  const cashResult = validatePaperPersistenceAggregate(badCash);
  assert.equal(cashResult.ok, false);
  assert.equal(cashResult.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);

  const extra = makeValidAggregate();
  extra.accountState = Object.assign({}, extra.accountState, { equity: 1 });
  const extraResult = validatePaperPersistenceAggregate(extra);
  assert.equal(extraResult.ok, false);
  assert.equal(extraResult.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
});

test("P59 dangling execution without FILLED audit", () => {
  const agg = makeValidAggregate();
  agg.executionRecords = [{ executionId: "paper-exec-v1:orphan", accountId: agg.accountId }];
  const result = validatePaperPersistenceAggregate(agg);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
});

test("P60 duplicate identities two audits same eventId", () => {
  const agg = makeBlockedAggregate();
  const second = Object.assign({}, agg.auditRecords[0], {
    requestDigest: "paper-request-v1:blocked2",
    intentId: "intent-2",
    sequence: 12,
  });
  indexAudit(agg.idempotency, second);
  agg.auditRecords = [agg.auditRecords[0], second];
  agg.accountState.lastProcessedSequence = 12;
  agg.accountState.lastProcessedEventId = "evt-11";
  const result = validatePaperPersistenceAggregate(agg);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
});

test("P61 already-invalid stays invalid; no repair function exists", () => {
  assert.equal(typeof validatePaperPersistenceAggregate.repair, "undefined");
  const validatorMod = require("../lib/paper/paper-persistence-validator");
  assert.equal(typeof validatorMod.repairPaperPersistenceAggregate, "undefined");
  const bad = makeValidAggregate({ revision: -1 });
  const a = validatePaperPersistenceAggregate(bad);
  const b = validatePaperPersistenceAggregate(bad);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(a.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  assert.equal(b.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
});

test("P63 invalid aggregate is not repaired by a second validate", () => {
  const agg = makeValidAggregate({ schemaVersion: 2 });
  const first = validatePaperPersistenceAggregate(agg);
  assert.equal(first.ok, false);
  assert.equal(agg.schemaVersion, 2);
  const second = validatePaperPersistenceAggregate(agg);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA);
});

test("P73 FILLED audit without matching execution CORRUPT; matching exec ok", () => {
  const missing = makeFilledAggregate();
  missing.executionRecords = [];
  const missingResult = validatePaperPersistenceAggregate(missing);
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);

  const okAgg = makeFilledAggregate();
  const okResult = validatePaperPersistenceAggregate(okAgg);
  assert.equal(okResult.ok, true);
});

test("P74 BLOCKED audit with executionId set CORRUPT; BLOCKED with execution record CORRUPT", () => {
  const withExecId = makeBlockedAggregate();
  withExecId.auditRecords[0].executionId = "paper-exec-v1:blocked-bad";
  const idResult = validatePaperPersistenceAggregate(withExecId);
  assert.equal(idResult.ok, false);
  assert.equal(idResult.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);

  const withRec = makeBlockedAggregate();
  withRec.executionRecords = [{ executionId: "paper-exec-v1:blocked-rec", accountId: withRec.accountId }];
  const recResult = validatePaperPersistenceAggregate(withRec);
  assert.equal(recResult.ok, false);
  assert.equal(recResult.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
});

test("P75 cross-account refs CORRUPT", () => {
  const auditCross = makeFilledAggregate();
  auditCross.auditRecords[0].accountId = "other-account";
  const a = validatePaperPersistenceAggregate(auditCross);
  assert.equal(a.ok, false);
  assert.equal(a.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);

  const execCross = makeFilledAggregate();
  execCross.executionRecords[0].accountId = "other-account";
  const b = validatePaperPersistenceAggregate(execCross);
  assert.equal(b.ok, false);
  assert.equal(b.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
});

test("P12-adjacent bad cursor: seq set eid null; empty audits with cursor; last audit mismatch", () => {
  const seqOnly = makeValidAggregate();
  seqOnly.accountState.lastProcessedSequence = 0;
  seqOnly.accountState.lastProcessedEventId = null;
  const seqResult = validatePaperPersistenceAggregate(seqOnly);
  assert.equal(seqResult.ok, false);
  assert.equal(seqResult.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_CORRUPT_STATE);
  assert.equal(seqResult.error.field, "cursor");

  const emptyCursor = makeValidAggregate();
  emptyCursor.accountState.lastProcessedSequence = 11;
  emptyCursor.accountState.lastProcessedEventId = "evt-11";
  const emptyResult = validatePaperPersistenceAggregate(emptyCursor);
  assert.equal(emptyResult.ok, false);
  assert.equal(emptyResult.error.field, "cursor");

  const mismatch = makeFilledAggregate();
  mismatch.accountState.lastProcessedSequence = 99;
  mismatch.accountState.lastProcessedEventId = "evt-other";
  const mismatchResult = validatePaperPersistenceAggregate(mismatch);
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.error.field, "cursor");
});
