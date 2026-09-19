"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERSISTENCE_ERROR,
  digestCreate,
  deepCloneOwn,
  setOwn,
} = require("../lib/paper/paper-persistence-canonical");
const {
  CREATE_STATUS,
  createInMemoryPaperRepository,
} = require("../lib/paper/in-memory-paper-repository");
const { createPaperAccountState } = require("../lib/paper/paper-account-state");

function emptyIdemp() {
  return {
    byEventId: Object.create(null),
    bySequence: Object.create(null),
    byIntentId: Object.create(null),
    byExecutionId: Object.create(null),
    byRequestDigest: Object.create(null),
  };
}

function makeAggregate(accountId, initialCash) {
  const created = digestCreate({ accountId, initialCash });
  return {
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
}

test("P19 create stores revision 0", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p19", 1000);
  const created = repo.createAccountIfAbsent({
    accountId: "acc-p19",
    createDigest: agg.createDigest,
    aggregate: agg,
  });
  assert.equal(created.ok, true);
  assert.equal(created.status, CREATE_STATUS.CREATED);
  assert.equal(created.aggregate.revision, 0);
  const loaded = repo.loadAccount("acc-p19");
  assert.equal(loaded.found, true);
  assert.equal(loaded.aggregate.revision, 0);
});

test("P20 same createDigest REPLAY, revision still 0", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p20", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p20", createDigest: agg.createDigest, aggregate: agg });
  const again = repo.createAccountIfAbsent({
    accountId: "acc-p20",
    createDigest: agg.createDigest,
    aggregate: makeAggregate("acc-p20", 1000),
  });
  assert.equal(again.ok, true);
  assert.equal(again.status, CREATE_STATUS.REPLAY);
  assert.equal(again.aggregate.revision, 0);
});

test("P21 different createDigest ACCOUNT_ALREADY_EXISTS_CONFLICT, no mutation", () => {
  const repo = createInMemoryPaperRepository();
  const first = makeAggregate("acc-p21", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p21", createDigest: first.createDigest, aggregate: first });
  const second = makeAggregate("acc-p21", 2000);
  const result = repo.createAccountIfAbsent({
    accountId: "acc-p21",
    createDigest: second.createDigest,
    aggregate: second,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT);
  const loaded = repo.loadAccount("acc-p21");
  assert.equal(loaded.aggregate.createDigest, first.createDigest);
  assert.equal(loaded.aggregate.accountState.initialCash, 1000);
});

test("P22 two createAccountIfAbsent same digest → count 1; first CREATED second REPLAY", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p22", 1000);
  const a = repo.createAccountIfAbsent({ accountId: "acc-p22", createDigest: agg.createDigest, aggregate: agg });
  const b = repo.createAccountIfAbsent({ accountId: "acc-p22", createDigest: agg.createDigest, aggregate: agg });
  assert.equal(a.status, CREATE_STATUS.CREATED);
  assert.equal(b.status, CREATE_STATUS.REPLAY);
  assert.equal(repo.testOnlyAccountCount(), 1);
});

test("P23 injectCreate FAILED → not written, load found=false", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p23", 1000);
  repo.injectCreate("acc-p23", "FAILED");
  const result = repo.createAccountIfAbsent({
    accountId: "acc-p23",
    createDigest: agg.createDigest,
    aggregate: agg,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
  assert.equal(repo.loadAccount("acc-p23").found, false);
});

test("P24 injectCreate UNKNOWN_COMMITTED → written but COMMIT_UNKNOWN", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p24", 1000);
  repo.injectCreate("acc-p24", "UNKNOWN_COMMITTED");
  const result = repo.createAccountIfAbsent({
    accountId: "acc-p24",
    createDigest: agg.createDigest,
    aggregate: agg,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(repo.loadAccount("acc-p24").found, true);
});

test("P25 after existing different digest, create returns CONFLICT", () => {
  const repo = createInMemoryPaperRepository();
  const first = makeAggregate("acc-p25", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p25", createDigest: first.createDigest, aggregate: first });
  repo.injectCreate("acc-p25", "FAILED");
  const second = makeAggregate("acc-p25", 3000);
  const result = repo.createAccountIfAbsent({
    accountId: "acc-p25",
    createDigest: second.createDigest,
    aggregate: second,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT);
  assert.equal(repo.loadAccount("acc-p25").aggregate.accountState.initialCash, 1000);
});

test("P26 injectCreate UNKNOWN_UNRESOLVED → not written, COMMIT_UNKNOWN", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p26", 1000);
  repo.injectCreate("acc-p26", "UNKNOWN_UNRESOLVED");
  const result = repo.createAccountIfAbsent({
    accountId: "acc-p26",
    createDigest: agg.createDigest,
    aggregate: agg,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(repo.loadAccount("acc-p26").found, false);
});

test("P27 commit success replaces clone", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p27", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p27", createDigest: agg.createDigest, aggregate: agg });
  const next = deepCloneOwn(agg);
  next.revision = 1;
  next.accountState.cash = 900;
  const committed = repo.commitAccount({
    accountId: "acc-p27",
    expectedRevision: 0,
    nextAggregate: next,
  });
  assert.equal(committed.ok, true);
  const loaded = repo.loadAccount("acc-p27");
  assert.equal(loaded.aggregate.revision, 1);
  assert.equal(loaded.aggregate.accountState.cash, 900);
});

test("P28 expectedRevision mismatch → REVISION_CONFLICT no write", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p28", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p28", createDigest: agg.createDigest, aggregate: agg });
  const next = deepCloneOwn(agg);
  next.revision = 1;
  const committed = repo.commitAccount({
    accountId: "acc-p28",
    expectedRevision: 7,
    nextAggregate: next,
  });
  assert.equal(committed.ok, false);
  assert.equal(committed.signal, "REVISION_CONFLICT");
  assert.equal(committed.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_REVISION_CONFLICT);
  assert.equal(repo.loadAccount("acc-p28").aggregate.revision, 0);
});

test("P29 injectCommit CONFLICT → REVISION_CONFLICT no write", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p29", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p29", createDigest: agg.createDigest, aggregate: agg });
  repo.injectCommit("acc-p29", "CONFLICT");
  const next = deepCloneOwn(agg);
  next.revision = 1;
  const committed = repo.commitAccount({
    accountId: "acc-p29",
    expectedRevision: 0,
    nextAggregate: next,
  });
  assert.equal(committed.ok, false);
  assert.equal(committed.signal, "REVISION_CONFLICT");
  assert.equal(repo.loadAccount("acc-p29").aggregate.revision, 0);
});

test("P30 injectCommit FAILED → not written", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p30", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p30", createDigest: agg.createDigest, aggregate: agg });
  repo.injectCommit("acc-p30", "FAILED");
  const next = deepCloneOwn(agg);
  next.revision = 1;
  const committed = repo.commitAccount({
    accountId: "acc-p30",
    expectedRevision: 0,
    nextAggregate: next,
  });
  assert.equal(committed.ok, false);
  assert.equal(committed.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_FAILED);
  assert.equal(repo.loadAccount("acc-p30").aggregate.revision, 0);
});

test("P31 injectCommit UNKNOWN_COMMITTED → written + COMMIT_UNKNOWN", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p31", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p31", createDigest: agg.createDigest, aggregate: agg });
  repo.injectCommit("acc-p31", "UNKNOWN_COMMITTED");
  const next = deepCloneOwn(agg);
  next.revision = 1;
  const committed = repo.commitAccount({
    accountId: "acc-p31",
    expectedRevision: 0,
    nextAggregate: next,
  });
  assert.equal(committed.ok, false);
  assert.equal(committed.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(repo.loadAccount("acc-p31").aggregate.revision, 1);
});

test("P32 injectCommit UNKNOWN_UNRESOLVED → not written + COMMIT_UNKNOWN", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p32", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p32", createDigest: agg.createDigest, aggregate: agg });
  repo.injectCommit("acc-p32", "UNKNOWN_UNRESOLVED");
  const next = deepCloneOwn(agg);
  next.revision = 1;
  const committed = repo.commitAccount({
    accountId: "acc-p32",
    expectedRevision: 0,
    nextAggregate: next,
  });
  assert.equal(committed.ok, false);
  assert.equal(committed.error.code, PERSISTENCE_ERROR.PAPER_PERSISTENCE_COMMIT_UNKNOWN);
  assert.equal(repo.loadAccount("acc-p32").aggregate.revision, 0);
});

test("P33 inject queues are per-account isolated", () => {
  const repo = createInMemoryPaperRepository();
  const a = makeAggregate("acc-p33a", 1000);
  const b = makeAggregate("acc-p33b", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p33a", createDigest: a.createDigest, aggregate: a });
  repo.createAccountIfAbsent({ accountId: "acc-p33b", createDigest: b.createDigest, aggregate: b });
  repo.injectCommit("acc-p33a", "FAILED");
  const nextB = deepCloneOwn(b);
  nextB.revision = 1;
  const committedB = repo.commitAccount({
    accountId: "acc-p33b",
    expectedRevision: 0,
    nextAggregate: nextB,
  });
  assert.equal(committedB.ok, true);
  assert.equal(repo.loadAccount("acc-p33b").aggregate.revision, 1);
  assert.equal(repo.loadAccount("acc-p33a").aggregate.revision, 0);
});

test("P34 lookupByIdentity digest match", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p34", 1000);
  const digest = "paper-request-v1:match";
  setOwn(agg.idempotency.byRequestDigest, digest, { requestDigest: digest, revision: 1 });
  setOwn(agg.idempotency.byEventId, "evt-11", digest);
  repo.createAccountIfAbsent({ accountId: "acc-p34", createDigest: agg.createDigest, aggregate: agg });
  const looked = repo.lookupByIdentity("acc-p34", { requestDigest: digest, eventId: "evt-11" });
  assert.equal(looked.match, true);
  assert.equal(looked.conflict, false);
  assert.equal(looked.entry.requestDigest, digest);
});

test("P35 lookupByIdentity identity conflict", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p35", 1000);
  setOwn(agg.idempotency.byEventId, "evt-11", "paper-request-v1:original");
  setOwn(agg.idempotency.byRequestDigest, "paper-request-v1:original", {
    requestDigest: "paper-request-v1:original",
  });
  repo.createAccountIfAbsent({ accountId: "acc-p35", createDigest: agg.createDigest, aggregate: agg });
  const looked = repo.lookupByIdentity("acc-p35", {
    eventId: "evt-11",
    requestDigest: "paper-request-v1:other",
  });
  assert.equal(looked.conflict, true);
  assert.equal(looked.reason, "IDENTITY");
  assert.equal(looked.match, false);
});

test("P64 accountId __proto__ create/load safe, Object.prototype untouched", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("__proto__", 1000);
  const created = repo.createAccountIfAbsent({
    accountId: "__proto__",
    createDigest: agg.createDigest,
    aggregate: agg,
  });
  assert.equal(created.ok, true);
  const loaded = repo.loadAccount("__proto__");
  assert.equal(loaded.found, true);
  assert.equal(loaded.aggregate.accountId, "__proto__");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test("P65 intentId constructor as identity key via lookup", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p65", 1000);
  const digest = "paper-request-v1:ctor";
  setOwn(agg.idempotency.byIntentId, "constructor", digest);
  setOwn(agg.idempotency.byRequestDigest, digest, { requestDigest: digest });
  repo.createAccountIfAbsent({ accountId: "acc-p65", createDigest: agg.createDigest, aggregate: agg });
  const looked = repo.lookupByIdentity("acc-p65", { intentId: "constructor", requestDigest: digest });
  assert.equal(looked.match, true);
  assert.equal(looked.entry.requestDigest, digest);
});

test("P66 eventId prototype own-key", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p66", 1000);
  const digest = "paper-request-v1:proto";
  setOwn(agg.idempotency.byEventId, "prototype", digest);
  setOwn(agg.idempotency.byRequestDigest, digest, { requestDigest: digest });
  repo.createAccountIfAbsent({ accountId: "acc-p66", createDigest: agg.createDigest, aggregate: agg });
  const looked = repo.lookupByIdentity("acc-p66", { eventId: "prototype", requestDigest: digest });
  assert.equal(looked.match, true);
});

test("P67 identity map own-key __proto__ via testOnlyReplace", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p67", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p67", createDigest: agg.createDigest, aggregate: agg });
  const replacement = deepCloneOwn(repo.loadAccount("acc-p67").aggregate);
  setOwn(replacement.idempotency.byEventId, "__proto__", "paper-request-v1:proto-key");
  repo.testOnlyReplaceAggregate("acc-p67", replacement);
  const loaded = repo.loadAccount("acc-p67");
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.aggregate.idempotency.byEventId, "__proto__"), true);
  assert.equal(loaded.aggregate.idempotency.byEventId["__proto__"], "paper-request-v1:proto-key");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test("P70 mutate loaded aggregate does not mutate store", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p70", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-p70", createDigest: agg.createDigest, aggregate: agg });
  const loaded = repo.loadAccount("acc-p70");
  loaded.aggregate.revision = 99;
  loaded.aggregate.accountState.cash = 1;
  const again = repo.loadAccount("acc-p70");
  assert.equal(again.aggregate.revision, 0);
  assert.equal(again.aggregate.accountState.cash, 1000);
});

test("P71 mutate loaded auditRecords does not mutate store", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p71", 1000);
  agg.auditRecords.push({ requestDigest: "paper-request-v1:keep" });
  repo.createAccountIfAbsent({ accountId: "acc-p71", createDigest: agg.createDigest, aggregate: agg });
  const loaded = repo.loadAccount("acc-p71");
  loaded.aggregate.auditRecords.push({ requestDigest: "paper-request-v1:mut" });
  const again = repo.loadAccount("acc-p71");
  assert.equal(again.aggregate.auditRecords.length, 1);
  assert.equal(again.aggregate.auditRecords[0].requestDigest, "paper-request-v1:keep");
});

test("P72 mutate loaded executionRecords does not mutate store", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-p72", 1000);
  agg.executionRecords.push({ executionId: "paper-exec-v1:keep" });
  repo.createAccountIfAbsent({ accountId: "acc-p72", createDigest: agg.createDigest, aggregate: agg });
  const loaded = repo.loadAccount("acc-p72");
  loaded.aggregate.executionRecords.push({ executionId: "paper-exec-v1:mut" });
  const again = repo.loadAccount("acc-p72");
  assert.equal(again.aggregate.executionRecords.length, 1);
  assert.equal(again.aggregate.executionRecords[0].executionId, "paper-exec-v1:keep");
});

test("testOnlyReplaceAggregate clones", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-replace", 1000);
  repo.createAccountIfAbsent({ accountId: "acc-replace", createDigest: agg.createDigest, aggregate: agg });
  const replacement = deepCloneOwn(repo.loadAccount("acc-replace").aggregate);
  replacement.revision = 4;
  repo.testOnlyReplaceAggregate("acc-replace", replacement);
  replacement.revision = 9;
  const loaded = repo.loadAccount("acc-replace");
  assert.equal(loaded.aggregate.revision, 4);
});

test("sequence 0 is a valid identity own-key", () => {
  const repo = createInMemoryPaperRepository();
  const agg = makeAggregate("acc-seq0", 1000);
  const digest = "paper-request-v1:seq0";
  setOwn(agg.idempotency.bySequence, "0", digest);
  setOwn(agg.idempotency.byRequestDigest, digest, { requestDigest: digest });
  repo.createAccountIfAbsent({ accountId: "acc-seq0", createDigest: agg.createDigest, aggregate: agg });
  const looked = repo.lookupByIdentity("acc-seq0", { sequence: 0, requestDigest: digest });
  assert.equal(looked.match, true);
});
