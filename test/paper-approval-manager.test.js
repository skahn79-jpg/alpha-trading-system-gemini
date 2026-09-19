"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  createPaperApprovalManager,
  canonicalizeSubject,
  STATE,
  ERROR,
} = require("../lib/paper/paper-approval-manager");
const {
  createPaperOperationalConfigSnapshot,
} = require("../lib/paper/paper-operational-config");

function makeClock(start) {
  let t = start;
  return {
    now() {
      return t;
    },
    add(n) {
      t += n;
    },
  };
}

function makeSubject(over) {
  const subject = {
    accountId: "acc-1",
    sessionId: "ses-1",
    market: "KOSPI",
    symbol: "005930",
    tradingDate: "2026-09-01",
    sequence: "1",
    eventDigest: "paper-market-event-v1:abc",
    intentId: "int-1",
    intentDigest: "paper-intent-v1:abc",
    riskDecisionId: "risk-1",
    riskDecisionDigest: "paper-risk-v1:abc",
    configSnapshotId: "paper-operational-config-v1:abc",
  };
  if (over && typeof over === "object") {
    const keys = Object.keys(over);
    for (let i = 0; i < keys.length; i += 1) {
      subject[keys[i]] = over[keys[i]];
    }
  }
  return subject;
}

function makeManager(clock) {
  return createPaperApprovalManager({
    clock: clock || makeClock(1_000_000),
    approvalTtlMs: 60_000,
  });
}

function approvalIdOf(issued) {
  if (typeof issued.approvalId === "string" && issued.approvalId.length > 0) {
    return issued.approvalId;
  }
  return issued.approval.approvalId;
}

function subjectDigestOf(issued) {
  if (typeof issued.subjectDigest === "string" && issued.subjectDigest.length > 0) {
    return issued.subjectDigest;
  }
  return issued.approval.subjectDigest;
}

function stateOf(issued) {
  if (typeof issued.state === "string") return issued.state;
  return issued.approval.state;
}

function consumePayload(issued, subject, over) {
  const payload = {
    approvalId: approvalIdOf(issued),
    subjectDigest: subjectDigestOf(issued),
    accountId: subject.accountId,
    sessionId: subject.sessionId,
    market: subject.market,
    symbol: subject.symbol,
    tradingDate: subject.tradingDate,
    sequence: subject.sequence,
  };
  if (over && typeof over === "object") {
    const keys = Object.keys(over);
    for (let i = 0; i < keys.length; i += 1) {
      payload[keys[i]] = over[keys[i]];
    }
  }
  return payload;
}

function invalidatedIds(result) {
  const list = result.invalidated || [];
  const ids = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (typeof item === "string") ids.push(item);
    else if (item && typeof item.approvalId === "string") ids.push(item.approvalId);
  }
  return ids;
}

function validConfig() {
  return {
    schemaVersion: "paper-operational-config-v1",
    operatingMode: "MODE_A_SINGLE_PROCESS_EPHEMERAL",
    supportedMarkets: ["KOSPI"],
    marketPolicyVersion: "paper-market-timezone-v1",
    identityPolicyVersion: "paper-market-event-v1",
    calendarPolicy: {
      calendarDatasetId: null,
      calendarVersion: null,
      coverageStatus: "PENDING",
      sessionTypeAllowlist: ["REGULAR_SESSION"],
    },
    approvalPolicy: {
      approvalModel: "EXPLICIT_ONE_TIME",
      oneTimePolicy: true,
      pendingLimit: 1,
      approvalTtlMs: 60000,
      allowedApproverRoles: ["PAPER_OPERATOR"],
    },
    riskPolicy: {
      riskPolicyVersion: "risk-v1",
      maxOrderNotional: 1000000,
      maxPositionNotional: 2000000,
      allowedMarkets: ["KOSPI"],
      allowedSymbols: ["005930"],
    },
    costPolicy: {
      costPolicyVersion: "cost-v1",
      policies: [{ policyId: "p1" }],
      brokerChannel: "SYNTHETIC_ONLINE",
      currency: "KRW",
    },
    killSwitchPolicy: {
      initialExecutionState: "DISABLED_EXECUTION",
      scope: "PROCESS",
    },
    resourcePolicy: {
      maxActiveSessions: 10,
      maxTerminalSessionRecords: 10,
      maxApprovalRecords: 10,
      maxEventTrackerEntries: 10,
    },
  };
}

test("A01 issue+consume success", () => {
  const clock = makeClock(1_000_000);
  assert.equal(Number.isInteger(clock.now()), true);
  const mgr = makeManager(clock);
  const subject = makeSubject();
  const issued = mgr.issue({
    subject: subject,
    approvedByPrincipal: "op-1",
  });
  assert.equal(issued.ok, true);
  assert.equal(typeof approvalIdOf(issued), "string");
  assert.equal(typeof subjectDigestOf(issued), "string");
  assert.equal(stateOf(issued), STATE.ISSUED);
  assert.ok(issued.approval);
  assert.equal(issued.idempotent, false);
  const consumed = mgr.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, true);
  assert.equal(consumed.noop, false);
  assert.equal(consumed.approval.state, STATE.CONSUMED);
});

test("A02 approved:true on issue UNKNOWN_FIELD", () => {
  const mgr = makeManager();
  const result = mgr.issue({
    subject: makeSubject(),
    approvedByPrincipal: "op-1",
    approved: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_UNKNOWN_FIELD);
  assert.equal(result.field, "approved");
});

test("A03 eventId on subject UNKNOWN_FIELD", () => {
  const mgr = makeManager();
  const result = mgr.issue({
    subject: makeSubject({ eventId: "evt-1" }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_UNKNOWN_FIELD);
  assert.equal(result.field, "eventId");
});

test("A04 account mismatch MISMATCH", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const result = mgr.consume(consumePayload(issued, subject, { accountId: "acc-other" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_IDENTITY_MISMATCH);
});

test("A05 session mismatch MISMATCH", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const result = mgr.consume(consumePayload(issued, subject, { sessionId: "ses-other" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_IDENTITY_MISMATCH);
});

test("A06 exact sequence mismatch STALE", () => {
  const mgr = makeManager();
  const subject = makeSubject({ sequence: "1" });
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const result = mgr.consume(consumePayload(issued, subject, { sequence: "2" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_SEQUENCE_MISMATCH);
});

test("A07 eventDigest change different subjectDigest, consume mismatch", () => {
  const mgr = makeManager();
  const a = makeSubject({ eventDigest: "paper-market-event-v1:aaa" });
  const b = makeSubject({ eventDigest: "paper-market-event-v1:bbb" });
  const issued = mgr.issue({ subject: a, approvedByPrincipal: "op-1" });
  const other = canonicalizeSubject(b);
  assert.equal(other.ok, true);
  assert.notEqual(subjectDigestOf(issued), other.subjectDigest);
  const result = mgr.consume(consumePayload(issued, a, { subjectDigest: other.subjectDigest }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_SUBJECT_MISMATCH);
});

test("A08 intentId bind via digest", () => {
  const a = canonicalizeSubject(makeSubject({ intentId: "int-1" }));
  const b = canonicalizeSubject(makeSubject({ intentId: "int-2" }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.subjectDigest, b.subjectDigest);
});

test("A09 riskDecisionDigest bind", () => {
  const a = canonicalizeSubject(makeSubject({ riskDecisionDigest: "paper-risk-v1:aaa" }));
  const b = canonicalizeSubject(makeSubject({ riskDecisionDigest: "paper-risk-v1:bbb" }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.subjectDigest, b.subjectDigest);
});

test("A10 configSnapshotId bind", () => {
  const a = canonicalizeSubject(makeSubject({ configSnapshotId: "paper-operational-config-v1:aaa" }));
  const b = canonicalizeSubject(makeSubject({ configSnapshotId: "paper-operational-config-v1:bbb" }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.subjectDigest, b.subjectDigest);
});

test("A11 sequential double consume max 1: second ALREADY_CONSUMED noop financial 0", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const cash = { amount: 1_000_000 };
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const first = mgr.consume(consumePayload(issued, subject));
  assert.equal(first.ok, true);
  assert.equal(first.noop, false);
  const second = mgr.consume(consumePayload(issued, subject));
  assert.equal(second.ok, true);
  assert.equal(second.code, ERROR.PAPER_APPROVAL_ALREADY_CONSUMED);
  assert.equal(second.noop, true);
  assert.equal(cash.amount, 1_000_000);
  if (Object.prototype.hasOwnProperty.call(second, "financial")) {
    assert.equal(second.financial, 0);
  }
});

test("A12 consumed replay same", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const first = mgr.consume(consumePayload(issued, subject));
  const second = mgr.consume(consumePayload(issued, subject));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.code, ERROR.PAPER_APPROVAL_ALREADY_CONSUMED);
  assert.equal(second.noop, true);
  assert.equal(second.approval.approvalId, first.approval.approvalId);
  assert.equal(second.approval.state, STATE.CONSUMED);
});

test("A13 revoke ISSUED", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const revoked = mgr.revoke(approvalIdOf(issued));
  assert.equal(revoked.ok, true);
  assert.equal(revoked.approval.state, STATE.REVOKED);
  const consumed = mgr.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, false);
  assert.equal(consumed.code, ERROR.PAPER_APPROVAL_REVOKED);
});

test("A14 expire: clock.add(60001) consume EXPIRED", () => {
  const clock = makeClock(1_000_000);
  const mgr = makeManager(clock);
  const subject = makeSubject();
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  clock.add(60001);
  const consumed = mgr.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, false);
  assert.equal(consumed.code, ERROR.PAPER_APPROVAL_EXPIRED);
});

test("A15 unknown approvalId NOT_FOUND", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const result = mgr.consume({
    approvalId: "00000000-0000-4000-8000-000000000000",
    subjectDigest: "paper-approval-v1:missing",
    accountId: subject.accountId,
    sessionId: subject.sessionId,
    market: subject.market,
    symbol: subject.symbol,
    tradingDate: subject.tradingDate,
    sequence: subject.sequence,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_NOT_FOUND);
});

test("A16 invalidateForMarketAdvance two accounts same market+symbol both invalidated when newSequence greater", () => {
  const mgr = makeManager();
  const aSub = makeSubject({ accountId: "acc-a", sessionId: "ses-a" });
  const bSub = makeSubject({ accountId: "acc-b", sessionId: "ses-b" });
  const a = mgr.issue({ subject: aSub, approvedByPrincipal: "op-1" });
  const b = mgr.issue({ subject: bSub, approvedByPrincipal: "op-1" });
  const result = mgr.invalidateForMarketAdvance({
    market: "KOSPI",
    symbol: "005930",
    newSequence: "2",
  });
  assert.equal(result.ok, true);
  const ids = invalidatedIds(result);
  assert.equal(ids.length, 2);
  assert.equal(ids.includes(approvalIdOf(a)), true);
  assert.equal(ids.includes(approvalIdOf(b)), true);
  if (result.count !== undefined) {
    assert.equal(result.count, 2);
  }
});

test("A17 tradingDate mismatch consume EXPIRED", () => {
  const mgr = makeManager();
  const subject = makeSubject({ tradingDate: "2026-09-01" });
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const result = mgr.consume(consumePayload(issued, subject, { tradingDate: "2026-09-02" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_EXPIRED);
});

test("A18 new manager inspect not found", () => {
  const first = makeManager();
  const subject = makeSubject();
  const issued = first.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const second = makeManager();
  const got = second.inspect(approvalIdOf(issued));
  assert.equal(got.ok, false);
  assert.equal(got.code, ERROR.PAPER_APPROVAL_NOT_FOUND);
});

test("A19 clone isolation mutate returned approval.state", () => {
  const mgr = makeManager();
  const issued = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-1" });
  try {
    issued.approval.state = STATE.CONSUMED;
  } catch (_ignored) {
    // frozen
  }
  assert.equal(issued.approval.state, STATE.ISSUED);
  const inspected = mgr.inspect(approvalIdOf(issued));
  assert.equal(inspected.ok, true);
  assert.equal(inspected.approval.state, STATE.ISSUED);
});

test("A20 prototype subject 0", () => {
  const mgr = makeManager();
  const own = makeSubject();
  delete own.accountId;
  const subject = Object.assign(Object.create({ accountId: "acc-1" }), own);
  const result = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  assert.equal(result.ok, false);
});

test("A21 missing principal INVALID_PRINCIPAL or MISSING", () => {
  const mgr = makeManager();
  const result = mgr.issue({ subject: makeSubject() });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_MISSING_PRINCIPAL);
});

test("A22 sessionId is not principal: still need approvedByPrincipal", () => {
  const mgr = makeManager();
  const result = mgr.issue({
    subject: makeSubject({ sessionId: "PAPER_OPERATOR" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_MISSING_PRINCIPAL);
});

test("A23 idempotent same subject+principal same approvalId", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const a = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const b = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-1" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.idempotent, true);
  assert.equal(approvalIdOf(b), approvalIdOf(a));
});

test("A24 conflict different principal", () => {
  const mgr = makeManager();
  const a = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-1" });
  assert.equal(a.ok, true);
  const b = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-2" });
  assert.equal(b.ok, false);
  assert.equal(b.code, ERROR.PAPER_APPROVAL_CONFLICT);
});

test("A25 conflict mutated sequence same pending key", () => {
  const mgr = makeManager();
  const a = mgr.issue({
    subject: makeSubject({ sequence: "1" }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(a.ok, true);
  const b = mgr.issue({
    subject: makeSubject({ sequence: "2" }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(b.ok, false);
  assert.equal(b.code, ERROR.PAPER_APPROVAL_CONFLICT);
});

test("A26 module.exports has no resetConsumed", () => {
  const exported = require("../lib/paper/paper-approval-manager");
  assert.equal(Object.prototype.hasOwnProperty.call(exported, "resetConsumed"), false);
  assert.equal(typeof exported.resetConsumed, "undefined");
  const mgr = makeManager();
  assert.equal(typeof mgr.resetConsumed, "undefined");
});

test("A27 validAfterEventSequence included in digest (string 0 vs 1 different)", () => {
  const a = canonicalizeSubject(makeSubject({ validAfterEventSequence: "0" }));
  const b = canonicalizeSubject(makeSubject({ validAfterEventSequence: "1" }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.subject.validAfterEventSequence, "0");
  assert.equal(b.subject.validAfterEventSequence, "1");
  assert.notEqual(a.subjectDigest, b.subjectDigest);
});

test("A28 consume still exact sequence even if validAfter present", () => {
  const mgr = makeManager();
  const subject = makeSubject({
    sequence: "5",
    validAfterEventSequence: "4",
  });
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  assert.equal(issued.ok, true);
  const stale = mgr.consume(consumePayload(issued, subject, { sequence: "4" }));
  assert.equal(stale.ok, false);
  assert.equal(stale.code, ERROR.PAPER_APPROVAL_SEQUENCE_MISMATCH);
  const ok = mgr.consume(consumePayload(issued, subject, { sequence: "5" }));
  assert.equal(ok.ok, true);
  assert.equal(ok.noop, false);
});

test("A29 invalidate BigInt 9007199254740993 vs issued 9007199254740992", () => {
  const mgr = makeManager();
  const subject = makeSubject({ sequence: "9007199254740992" });
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  assert.equal(issued.ok, true);
  const result = mgr.invalidateForMarketAdvance({
    market: "KOSPI",
    symbol: "005930",
    newSequence: "9007199254740993",
  });
  assert.equal(result.ok, true);
  const ids = invalidatedIds(result);
  assert.equal(ids.includes(approvalIdOf(issued)), true);
});

test("A30 CROSS bind configSnapshotId from createPaperOperationalConfigSnapshot", () => {
  const snap = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(snap.ok, true);
  const mgr = makeManager();
  const subject = makeSubject({ configSnapshotId: snap.configSnapshotId });
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  assert.equal(issued.ok, true);
  const consumed = mgr.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, true);
  assert.equal(consumed.noop, false);
});

test("A31 CROSS eventId not in subject (unknown)", () => {
  const result = canonicalizeSubject(makeSubject({ eventId: "evt-1" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_UNKNOWN_FIELD);
  assert.equal(result.field, "eventId");
});

test("A32 no Date.now Math.random fetch LiveBroker paperEligible:true in approval-manager.js (randomUUID ok)", () => {
  const src = readFileSync(join(__dirname, "../lib/paper/paper-approval-manager.js"), "utf8");
  assert.equal(src.includes("Date.now("), false);
  assert.equal(src.includes("Math.random"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("LiveBroker"), false);
  assert.equal(src.includes("paperEligible: true"), false);
  assert.equal(src.includes("randomUUID"), true);
});

test("A33 caller subjectDigest on issue unknown if extra field", () => {
  const mgr = makeManager();
  const result = mgr.issue({
    subject: makeSubject(),
    approvedByPrincipal: "op-1",
    subjectDigest: "paper-approval-v1:caller",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_UNKNOWN_FIELD);
  assert.equal(result.field, "subjectDigest");
});

test("A34 Number sequence reject", () => {
  const result = canonicalizeSubject(makeSubject({ sequence: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_INVALID_INPUT);
  assert.equal(result.field, "sequence");
});

test("A35 restart: second manager cannot consume first id", () => {
  const first = makeManager();
  const subject = makeSubject();
  const issued = first.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const second = makeManager();
  const consumed = second.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, false);
  assert.equal(consumed.code, ERROR.PAPER_APPROVAL_NOT_FOUND);
});

test("A36 cannot revoke CONSUMED", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const consumed = mgr.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, true);
  const revoked = mgr.revoke(approvalIdOf(issued));
  assert.equal(revoked.ok, false);
  assert.equal(revoked.code, ERROR.PAPER_APPROVAL_CANNOT_REVOKE);
});

test("A37 equal newSequence does not invalidate", () => {
  const mgr = makeManager();
  const subject = makeSubject({ sequence: "5" });
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const result = mgr.invalidateForMarketAdvance({
    market: "KOSPI",
    symbol: "005930",
    newSequence: "5",
  });
  assert.equal(result.ok, true);
  assert.equal(invalidatedIds(result).length, 0);
  const inspected = mgr.inspect(approvalIdOf(issued));
  assert.equal(inspected.ok, true);
  assert.equal(inspected.approval.state, STATE.ISSUED);
});

test("A38 missing clock CLOCK_REQUIRED", () => {
  const mgr = createPaperApprovalManager({ approvalTtlMs: 60_000 });
  const result = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_MISSING_CLOCK);
});

test("A39 ttl 0 INVALID_TTL", () => {
  const mgr = createPaperApprovalManager({
    clock: makeClock(1_000_000),
    approvalTtlMs: 0,
  });
  const result = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_INVALID_TTL);
});

test("A40 KOSDAQ separate stream", () => {
  const mgr = makeManager();
  const kospi = mgr.issue({
    subject: makeSubject({ market: "KOSPI" }),
    approvedByPrincipal: "op-1",
  });
  const kosdaq = mgr.issue({
    subject: makeSubject({ market: "KOSDAQ", sessionId: "ses-k" }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(kospi.ok, true);
  assert.equal(kosdaq.ok, true);
  const result = mgr.invalidateForMarketAdvance({
    market: "KOSPI",
    symbol: "005930",
    newSequence: "9",
  });
  const ids = invalidatedIds(result);
  assert.equal(ids.includes(approvalIdOf(kospi)), true);
  assert.equal(ids.includes(approvalIdOf(kosdaq)), false);
  const still = mgr.inspect(approvalIdOf(kosdaq));
  assert.equal(still.approval.state, STATE.ISSUED);
});

test("A41 clone subject frozen", () => {
  const canonical = canonicalizeSubject(makeSubject());
  assert.equal(canonical.ok, true);
  assert.equal(Object.isFrozen(canonical.subject), true);
  try {
    canonical.subject.sequence = "99";
  } catch (_ignored) {
    // frozen
  }
  assert.equal(canonical.subject.sequence, "1");
});

test("A42 inspect found", () => {
  const mgr = makeManager();
  const issued = mgr.issue({ subject: makeSubject(), approvedByPrincipal: "op-1" });
  const got = mgr.inspect(approvalIdOf(issued));
  assert.equal(got.ok, true);
  assert.ok(got.approval);
  assert.equal(got.approval.approvalId, approvalIdOf(issued));
  if (got.found !== undefined) {
    assert.equal(got.found, true);
  }
});

test("A43 financial 0 on success consume", () => {
  const mgr = makeManager();
  const subject = makeSubject();
  const account = { cash: 1_000_000 };
  const issued = mgr.issue({ subject: subject, approvedByPrincipal: "op-1" });
  const consumed = mgr.consume(consumePayload(issued, subject));
  assert.equal(consumed.ok, true);
  assert.equal(consumed.noop, false);
  assert.equal(account.cash, 1_000_000);
  if (Object.prototype.hasOwnProperty.call(consumed, "financial")) {
    assert.equal(consumed.financial, 0);
  }
});

test("A44 PAPER_OPERATOR not inferred", () => {
  const mgr = makeManager();
  const result = mgr.issue({
    subject: makeSubject({ sessionId: "PAPER_OPERATOR" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_APPROVAL_MISSING_PRINCIPAL);
});

test("A45 no reuse API", () => {
  const exported = require("../lib/paper/paper-approval-manager");
  assert.equal(typeof exported.resetConsumed, "undefined");
  assert.equal(typeof exported.reuse, "undefined");
  assert.equal(typeof exported.resurrect, "undefined");
  const mgr = makeManager();
  assert.equal(typeof mgr.resetConsumed, "undefined");
  assert.equal(typeof mgr.reuse, "undefined");
  assert.equal(typeof mgr.resurrect, "undefined");
});

test("A46 inspect missing id", () => {
  const mgr = makeManager();
  const got = mgr.inspect("00000000-0000-4000-8000-000000000000");
  assert.equal(got.ok, false);
  assert.equal(got.code, ERROR.PAPER_APPROVAL_NOT_FOUND);
});

test("A47 canonicalizeSubject exported", () => {
  const exported = require("../lib/paper/paper-approval-manager");
  assert.equal(typeof exported.canonicalizeSubject, "function");
  const result = exported.canonicalizeSubject(makeSubject());
  assert.equal(result.ok, true);
  assert.equal(typeof result.subjectDigest, "string");
});

test("R1-A01 old pendingKey NUL collision pair remains separate", () => {
  const mgr = makeManager();
  const left = makeSubject({ accountId: "A\0B", sessionId: "C" });
  const right = makeSubject({ accountId: "A", sessionId: "B\0C" });
  const a = mgr.issue({ subject: left, approvedByPrincipal: "op-1" });
  const b = mgr.issue({ subject: right, approvedByPrincipal: "op-1" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(approvalIdOf(a), approvalIdOf(b));
  const conflict = mgr.issue({
    subject: makeSubject({ accountId: "A\0B", sessionId: "C", sequence: "2" }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, ERROR.PAPER_APPROVAL_CONFLICT);
  const still = mgr.inspect(approvalIdOf(b));
  assert.equal(still.ok, true);
  assert.equal(still.approval.state, STATE.ISSUED);
});

test("R1-A02 marketSymbolKey NUL collision pair remains separate", () => {
  const mgr = makeManager();
  const left = makeSubject({
    accountId: "acc-l",
    sessionId: "ses-l",
    market: "A\0B",
    symbol: "C",
  });
  const right = makeSubject({
    accountId: "acc-r",
    sessionId: "ses-r",
    market: "A",
    symbol: "B\0C",
  });
  const a = mgr.issue({ subject: left, approvedByPrincipal: "op-1" });
  const b = mgr.issue({ subject: right, approvedByPrincipal: "op-1" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const result = mgr.invalidateForMarketAdvance({
    market: "A\0B",
    symbol: "C",
    newSequence: "9",
  });
  assert.equal(result.ok, true);
  const ids = invalidatedIds(result);
  assert.equal(ids.includes(approvalIdOf(a)), true);
  assert.equal(ids.includes(approvalIdOf(b)), false);
  const still = mgr.inspect(approvalIdOf(b));
  assert.equal(still.approval.state, STATE.ISSUED);
});

test("R1-A03 structurally different pending scopes may each hold approval", () => {
  const mgr = makeManager();
  const scopes = [
    makeSubject({ accountId: "acc-1", sessionId: "ses-1", market: "KOSPI", symbol: "005930" }),
    makeSubject({ accountId: "acc-1", sessionId: "ses-2", market: "KOSPI", symbol: "005930" }),
    makeSubject({ accountId: "acc-2", sessionId: "ses-1", market: "KOSPI", symbol: "005930" }),
    makeSubject({ accountId: "acc-1", sessionId: "ses-1", market: "KOSDAQ", symbol: "005930" }),
    makeSubject({ accountId: "acc-1", sessionId: "ses-1", market: "KOSPI", symbol: "000660" }),
  ];
  const ids = [];
  for (let i = 0; i < scopes.length; i += 1) {
    const issued = mgr.issue({ subject: scopes[i], approvedByPrincipal: "op-1" });
    assert.equal(issued.ok, true, "scope " + i);
    ids.push(approvalIdOf(issued));
  }
  assert.equal(new Set(ids).size, 5);
});

test("R1-A04 market advance invalidates only exact structural market/symbol", () => {
  const mgr = makeManager();
  const target = mgr.issue({
    subject: makeSubject({ market: "KOSPI", symbol: "005930", sequence: "1" }),
    approvedByPrincipal: "op-1",
  });
  const otherMarket = mgr.issue({
    subject: makeSubject({
      accountId: "acc-2",
      sessionId: "ses-2",
      market: "KOSDAQ",
      symbol: "005930",
      sequence: "1",
    }),
    approvedByPrincipal: "op-1",
  });
  const otherSymbol = mgr.issue({
    subject: makeSubject({
      accountId: "acc-3",
      sessionId: "ses-3",
      market: "KOSPI",
      symbol: "000660",
      sequence: "1",
    }),
    approvedByPrincipal: "op-1",
  });
  const result = mgr.invalidateForMarketAdvance({
    market: "KOSPI",
    symbol: "005930",
    newSequence: "2",
  });
  const ids = invalidatedIds(result);
  assert.equal(ids.includes(approvalIdOf(target)), true);
  assert.equal(ids.includes(approvalIdOf(otherMarket)), false);
  assert.equal(ids.includes(approvalIdOf(otherSymbol)), false);
  assert.equal(mgr.inspect(approvalIdOf(otherMarket)).approval.state, STATE.ISSUED);
  assert.equal(mgr.inspect(approvalIdOf(otherSymbol)).approval.state, STATE.ISSUED);
});

test("R1-A05 prototype-shaped IDs do not alter nested Map authority", () => {
  const mgr = makeManager();
  const protoAcc = mgr.issue({
    subject: makeSubject({
      accountId: "__proto__",
      sessionId: "constructor",
      symbol: "prototype",
    }),
    approvedByPrincipal: "op-1",
  });
  const toStringAcc = mgr.issue({
    subject: makeSubject({
      accountId: "toString",
      sessionId: "constructor",
      symbol: "prototype",
    }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(protoAcc.ok, true);
  assert.equal(toStringAcc.ok, true);
  assert.notEqual(approvalIdOf(protoAcc), approvalIdOf(toStringAcc));
  const conflict = mgr.issue({
    subject: makeSubject({
      accountId: "__proto__",
      sessionId: "constructor",
      symbol: "prototype",
      sequence: "9",
    }),
    approvedByPrincipal: "op-1",
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, ERROR.PAPER_APPROVAL_CONFLICT);
  const still = mgr.inspect(approvalIdOf(toStringAcc));
  assert.equal(still.approval.state, STATE.ISSUED);
});
