"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");

const {
  canonicalizePaperMarketEvent,
  createPaperMarketEventTracker,
  CLASSIFICATION,
  CONTROL,
  ERROR,
  PAPER_MARKETS,
  DIGEST_PREFIX,
} = require("../lib/paper/paper-market-event-identity");
const {
  createPaperCalendarGate,
} = require("../lib/paper/paper-calendar-gate");
const { encodeCanonical } = require("../lib/paper/paper-persistence-canonical");

function sha256Hex(utf8Text) {
  return createHash("sha256").update(utf8Text, "utf8").digest("hex");
}

function makeEvent(overrides) {
  const event = {
    eventId: "evt-1",
    sequence: "1",
    market: "KOSPI",
    symbol: "005930",
    tradingDate: "2026-09-01",
    exchangeEventTime: "2026-09-01T09:00:00+09:00",
    sourceGeneration: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    open: 50000,
  };
  if (overrides && typeof overrides === "object") {
    const keys = Object.keys(overrides);
    for (let i = 0; i < keys.length; i += 1) {
      event[keys[i]] = overrides[keys[i]];
    }
  }
  return event;
}

function verifiedProvider(overrides) {
  return {
    lookup(_query) {
      const result = {
        verified: true,
        tradingDay: true,
        timezone: "Asia/Seoul",
        sessions: [{ type: "REGULAR", start: "09:00:00", end: "15:30:00" }],
        version: "cal-v1",
      };
      if (overrides && typeof overrides === "object") {
        const keys = Object.keys(overrides);
        for (let i = 0; i < keys.length; i += 1) {
          result[keys[i]] = overrides[keys[i]];
        }
      }
      return result;
    },
  };
}

function inspectKey(tracker, raw) {
  return tracker.inspect({
    market: raw.market,
    symbol: raw.symbol,
    sourceGeneration: raw.sourceGeneration,
  });
}

function commitOk(tracker, raw) {
  const classified = tracker.classify(raw);
  assert.equal(classified.ok, true, classified.code);
  const committed = tracker.commit(classified);
  assert.equal(committed.ok, true, committed.code);
  return { classified, committed };
}

test("E01 valid canonicalize+digest prefix", () => {
  const result = canonicalizePaperMarketEvent(makeEvent());
  assert.equal(result.ok, true);
  assert.equal(result.code, null);
  assert.equal(result.event.eventId, "evt-1");
  assert.equal(result.event.sequence, "1");
  assert.equal(result.event.market, "KOSPI");
  assert.equal(result.event.symbol, "005930");
  assert.equal(result.event.open, 50000);
  assert.equal(typeof result.digest, "string");
  assert.equal(result.digest.startsWith(DIGEST_PREFIX), true);
  assert.equal(result.event.digest, result.digest);
  assert.equal(Object.isFrozen(result.event), true);
});

test("E02 missing field", () => {
  const raw = makeEvent();
  delete raw.eventId;
  const result = canonicalizePaperMarketEvent(raw);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_MISSING_FIELD);
  assert.equal(result.field, "eventId");
});

test("E03 unknown field", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ extra: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_UNKNOWN_FIELD);
  assert.equal(result.field, "extra");
});

test("E04 empty eventId", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ eventId: "" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_EVENT_ID);
  assert.equal(result.field, "eventId");
});

test("E05 sequences 01 +1 -1 1.0 1e3 padded empty Number BigInt reject INVALID_SEQUENCE", () => {
  const cases = ["01", "+1", "-1", "1.0", "1e3", " 1 ", ""];
  for (let i = 0; i < cases.length; i += 1) {
    const result = canonicalizePaperMarketEvent(makeEvent({ sequence: cases[i] }));
    assert.equal(result.ok, false, "sequence " + JSON.stringify(cases[i]));
    assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_SEQUENCE);
  }
  const asNumber = canonicalizePaperMarketEvent(makeEvent({ sequence: 1 }));
  assert.equal(asNumber.ok, false);
  assert.equal(asNumber.code, ERROR.PAPER_MARKET_EVENT_INVALID_SEQUENCE);
  const asBigInt = canonicalizePaperMarketEvent(makeEvent({ sequence: 1n }));
  assert.equal(asBigInt.ok, false);
  assert.equal(asBigInt.code, ERROR.PAPER_MARKET_EVENT_INVALID_SEQUENCE);
});

test("E06 commit seq 0 then seq 1 ACCEPTABLE", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "0", eventId: "e0" }));
  const next = tracker.classify(makeEvent({ sequence: "1", eventId: "e1", open: 50001 }));
  assert.equal(next.ok, true);
  assert.equal(next.classification, CLASSIFICATION.ACCEPTABLE);
  assert.equal(next.control, null);
  assert.equal(next.committable, true);
});

test("E07 NOOP_DUPLICATE commit advanced false", () => {
  const tracker = createPaperMarketEventTracker();
  const first = commitOk(tracker, makeEvent());
  const dup = tracker.classify(makeEvent());
  assert.equal(dup.classification, CLASSIFICATION.NOOP_DUPLICATE);
  assert.equal(dup.control, null);
  assert.equal(dup.committable, false);
  const committed = tracker.commit(dup);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED);
  const inspected = inspectKey(tracker, makeEvent());
  assert.equal(inspected.lastSequence, first.committed.lastSequence);
  assert.equal(inspected.lastDigest, first.committed.lastDigest);
});

test("E08 IDENTITY_CONFLICT HALT, commit not allowed", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ eventId: "e1" }));
  const conflict = tracker.classify(makeEvent({ eventId: "e2" }));
  assert.equal(conflict.classification, CLASSIFICATION.IDENTITY_CONFLICT);
  assert.equal(conflict.control, CONTROL.HALT_STREAM);
  assert.equal(conflict.committable, false);
  const committed = tracker.commit(conflict);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED);
});

test("E09 eventId not ordering", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "2", eventId: "zzz" }));
  const earlier = tracker.classify(makeEvent({ sequence: "1", eventId: "aaa" }));
  assert.equal(earlier.classification, CLASSIFICATION.OUT_OF_ORDER);
  assert.equal(earlier.control, CONTROL.PAUSE_STREAM);
});

test("E10 OUT_OF_ORDER PAUSE", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "2", eventId: "e2" }));
  const ooo = tracker.classify(makeEvent({ sequence: "1", eventId: "e1" }));
  assert.equal(ooo.classification, CLASSIFICATION.OUT_OF_ORDER);
  assert.equal(ooo.control, CONTROL.PAUSE_STREAM);
});

test("E11 SEQUENCE_GAP PAUSE", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "1" }));
  const gap = tracker.classify(makeEvent({ sequence: "10", eventId: "e10" }));
  assert.equal(gap.classification, CLASSIFICATION.SEQUENCE_GAP);
  assert.equal(gap.control, CONTROL.PAUSE_STREAM);
});

test("E12 first seq 5 BASELINE, inspect last null", () => {
  const tracker = createPaperMarketEventTracker();
  const raw = makeEvent({ sequence: "5" });
  const classified = tracker.classify(raw);
  assert.equal(classified.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(classified.control, null);
  const inspected = inspectKey(tracker, raw);
  assert.equal(inspected.lastSequence, null);
  assert.equal(inspected.lastDigest, null);
  assert.equal(inspected.keyRevision, 0);
});

test("E13 new sourceGeneration baseline", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "1", sourceGeneration: "gen-a" }));
  const next = tracker.classify(makeEvent({
    sequence: "1",
    eventId: "evt-2",
    sourceGeneration: "gen-b",
  }));
  assert.equal(next.classification, CLASSIFICATION.BASELINE_CANDIDATE);
});

test("E14 unknown market", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ market: "NYSE" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_MARKET);
  assert.equal(result.field, "market");
});

test("E15 different sourceGeneration different digest", () => {
  const a = canonicalizePaperMarketEvent(makeEvent({ sourceGeneration: "gen-a" }));
  const b = canonicalizePaperMarketEvent(makeEvent({ sourceGeneration: "gen-b" }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.digest, b.digest);
});

test("E16 empty symbol", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ symbol: "" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_SYMBOL);
  assert.equal(result.field, "symbol");
});

test("E17 Number symbol reject", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ symbol: 5930 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_SYMBOL);
});

test("E18 tradingDate format", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ tradingDate: "2026/09/01" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_TRADING_DATE);
});

test("E19 2026-02-30", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({
    tradingDate: "2026-02-30",
    exchangeEventTime: "2026-02-30T09:00:00+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_TRADING_DATE);
});

test("E20 symbol 005930 preserved", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ symbol: "005930" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.symbol, "005930");
});

test("E21 Z reject", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({
    exchangeEventTime: "2026-09-01T00:00:00Z",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME);
});

test("E22 subseconds and offsetless", () => {
  const sub = canonicalizePaperMarketEvent(makeEvent({
    exchangeEventTime: "2026-09-01T09:00:00.123+09:00",
  }));
  assert.equal(sub.ok, false);
  assert.equal(sub.code, ERROR.PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME);
  const offsetless = canonicalizePaperMarketEvent(makeEvent({
    exchangeEventTime: "2026-09-01T09:00:00",
  }));
  assert.equal(offsetless.ok, false);
  assert.equal(offsetless.code, ERROR.PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME);
});

test("E23 deterministic digest vs encodeCanonical", () => {
  const a = canonicalizePaperMarketEvent(makeEvent());
  const b = canonicalizePaperMarketEvent(makeEvent());
  assert.equal(a.digest, b.digest);
  const identity = {
    eventId: "evt-1",
    sequence: "1",
    market: "KOSPI",
    symbol: "005930",
    tradingDate: "2026-09-01",
    exchangeEventTime: "2026-09-01T09:00:00+09:00",
    sourceGeneration: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    open: 50000,
  };
  const expected = DIGEST_PREFIX + sha256Hex(encodeCanonical(identity));
  assert.equal(a.digest, expected);
});

test("E24 insertion order", () => {
  const a = {
    open: 50000,
    sourceGeneration: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    exchangeEventTime: "2026-09-01T09:00:00+09:00",
    tradingDate: "2026-09-01",
    symbol: "005930",
    market: "KOSPI",
    sequence: "1",
    eventId: "evt-1",
  };
  const b = makeEvent();
  assert.equal(canonicalizePaperMarketEvent(a).digest, canonicalizePaperMarketEvent(b).digest);
});

test("E25 receivedAt excluded", () => {
  const without = canonicalizePaperMarketEvent(makeEvent());
  const withRecv = canonicalizePaperMarketEvent(makeEvent({ receivedAt: "host-now" }));
  assert.equal(without.ok, true);
  assert.equal(withRecv.ok, true);
  assert.equal(without.digest, withRecv.digest);
  assert.equal(withRecv.event.receivedAt, "host-now");
  assert.equal(without.event.receivedAt, undefined);
});

test("E26 clone isolation (frozen so assignment ignored)", () => {
  const raw = makeEvent();
  const result = canonicalizePaperMarketEvent(raw);
  raw.eventId = "mutated";
  raw.open = 1;
  assert.equal(result.event.eventId, "evt-1");
  assert.equal(result.event.open, 50000);
  try {
    result.event.open = 1;
  } catch (_ignored) {
    // frozen in strict mode throws; otherwise assignment is ignored
  }
  assert.equal(result.event.open, 50000);
});

test("E27 NaN", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ open: Number.NaN }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_OPEN);
});

test("E28 Infinity", () => {
  assert.equal(canonicalizePaperMarketEvent(makeEvent({ open: Infinity })).ok, false);
  assert.equal(canonicalizePaperMarketEvent(makeEvent({ open: -Infinity })).ok, false);
  assert.equal(
    canonicalizePaperMarketEvent(makeEvent({ open: Infinity })).code,
    ERROR.PAPER_MARKET_EVENT_INVALID_OPEN,
  );
});

test("E29 open 0 negative 1.5", () => {
  const zero = canonicalizePaperMarketEvent(makeEvent({ open: 0 }));
  assert.equal(zero.ok, false);
  assert.equal(zero.code, ERROR.PAPER_MARKET_EVENT_INVALID_OPEN);
  const negative = canonicalizePaperMarketEvent(makeEvent({ open: -1 }));
  assert.equal(negative.ok, false);
  assert.equal(negative.code, ERROR.PAPER_MARKET_EVENT_INVALID_OPEN);
  const fractional = canonicalizePaperMarketEvent(makeEvent({ open: 1.5 }));
  assert.equal(fractional.ok, false);
  assert.equal(fractional.code, ERROR.PAPER_MARKET_EVENT_INVALID_OPEN);
});

test("E30 caller digest unknown field", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({ digest: "caller" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_UNKNOWN_FIELD);
  assert.equal(result.field, "digest");
});

test("E31 Object.create proto 0 authority", () => {
  const own = makeEvent();
  delete own.market;
  const raw = Object.assign(Object.create({ market: "KOSPI" }), own);
  const result = canonicalizePaperMarketEvent(raw);
  assert.equal(result.ok, false);
});

test("E32 account not in key", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "1" }));
  const next = tracker.classify(makeEvent({ sequence: "2", eventId: "evt-2" }));
  assert.equal(next.classification, CLASSIFICATION.ACCEPTABLE);
  const inspected = inspectKey(tracker, makeEvent());
  assert.equal(inspected.lastSequence, "1");
});

test("E33 classify no advance", () => {
  const tracker = createPaperMarketEventTracker();
  const classified = tracker.classify(makeEvent());
  assert.equal(classified.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  const inspected = inspectKey(tracker, makeEvent());
  assert.equal(inspected.lastSequence, null);
  assert.equal(inspected.keyRevision, 0);
});

test("E34 commit advances", () => {
  const tracker = createPaperMarketEventTracker();
  const classified = tracker.classify(makeEvent());
  const committed = tracker.commit(classified);
  assert.equal(committed.ok, true);
  assert.equal(committed.advanced, true);
  const inspected = inspectKey(tracker, makeEvent());
  assert.equal(inspected.lastSequence, "1");
  assert.equal(inspected.lastDigest, classified.digest);
  assert.equal(inspected.keyRevision, 1);
});

test("E35 two baselines, second commit STALE", () => {
  const tracker = createPaperMarketEventTracker();
  const first = tracker.classify(makeEvent({ sequence: "1", eventId: "e1" }));
  const second = tracker.classify(makeEvent({ sequence: "1", eventId: "e1" }));
  assert.equal(first.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(second.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(tracker.commit(first).ok, true);
  const stale = tracker.commit(second);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, ERROR.PAPER_MARKET_EVENT_STALE_COMMIT);
});

test("E36 9007199254740992 then 993 ACCEPTABLE then 994 then 996 GAP", () => {
  const tracker = createPaperMarketEventTracker();
  const a = commitOk(tracker, makeEvent({
    sequence: "9007199254740992",
    eventId: "big-1",
  }));
  assert.equal(a.classified.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  const b = tracker.classify(makeEvent({
    sequence: "9007199254740993",
    eventId: "big-2",
    open: 50001,
  }));
  assert.equal(b.classification, CLASSIFICATION.ACCEPTABLE);
  assert.equal(tracker.commit(b).ok, true);
  const c = tracker.classify(makeEvent({
    sequence: "9007199254740994",
    eventId: "big-3",
    open: 50002,
  }));
  assert.equal(c.classification, CLASSIFICATION.ACCEPTABLE);
  assert.equal(tracker.commit(c).ok, true);
  const gap = tracker.classify(makeEvent({
    sequence: "9007199254740996",
    eventId: "big-5",
    open: 50003,
  }));
  assert.equal(gap.classification, CLASSIFICATION.SEQUENCE_GAP);
  assert.equal(gap.control, CONTROL.PAUSE_STREAM);
});

test("E37 :60 reject", () => {
  const result = canonicalizePaperMarketEvent(makeEvent({
    exchangeEventTime: "2026-09-01T09:00:60+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME);
});

test("E38 SYNTHETIC_KOSPI separate", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ market: "KOSPI", sequence: "1" }));
  const syn = tracker.classify(makeEvent({
    market: "SYNTHETIC_KOSPI",
    sequence: "1",
    eventId: "syn-1",
  }));
  assert.equal(syn.ok, true);
  assert.equal(syn.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.deepEqual(PAPER_MARKETS, [
    "KOSPI",
    "KOSDAQ",
    "SYNTHETIC_KOSPI",
    "SYNTHETIC_KOSDAQ",
  ]);
});

test("E39 source scan no LiveBroker fetch axios WebSocket Date.now( Math.random paperEligible: true", () => {
  const src = readFileSync(join(__dirname, "../lib/paper/paper-market-event-identity.js"), "utf8");
  assert.equal(src.includes("Date.now("), false);
  assert.equal(src.includes("Math.random"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("axios"), false);
  assert.equal(src.includes("WebSocket"), false);
  assert.equal(src.includes("LiveBroker"), false);
  assert.equal(src.includes("paperEligible: true"), false);
});

test("E40 no applyPaperFill executePaper", () => {
  const src = readFileSync(join(__dirname, "../lib/paper/paper-market-event-identity.js"), "utf8");
  assert.equal(src.includes("applyPaperFill"), false);
  assert.equal(src.includes("executePaper"), false);
});

test("R1-E01 forged plain classification rejected", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "1" }));
  const forged = {
    ok: true,
    classification: CLASSIFICATION.ACCEPTABLE,
    committable: true,
    digest: "paper-market-event-v1:forged",
    sequence: "999",
    commitToken: {
      streamKey: "KOSPI\0" + "005930\0" + makeEvent().sourceGeneration,
      sequence: "999",
      digest: "paper-market-event-v1:forged",
      classification: CLASSIFICATION.ACCEPTABLE,
      expectedLastSeq: "1",
      expectedLastDigest: inspectKey(tracker, makeEvent()).lastDigest,
      keyRevision: 1,
    },
  };
  const committed = tracker.commit(forged);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT);
  const inspected = inspectKey(tracker, makeEvent());
  assert.equal(inspected.lastSequence, "1");
  assert.equal(inspected.keyRevision, 1);
});

test("R1-E02 spread clone rejected", () => {
  const tracker = createPaperMarketEventTracker();
  const genuine = tracker.classify(makeEvent());
  const spread = { ...genuine };
  assert.equal(tracker.commit(spread).ok, false);
  assert.equal(tracker.commit(spread).code, ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT);
  const assigned = Object.assign({}, genuine);
  assert.equal(tracker.commit(assigned).ok, false);
  const jsonClone = JSON.parse(JSON.stringify(genuine));
  assert.equal(tracker.commit(jsonClone).ok, false);
  if (typeof structuredClone === "function") {
    assert.equal(tracker.commit(structuredClone(genuine)).ok, false);
  }
  const committed = tracker.commit(genuine);
  assert.equal(committed.ok, true);
  assert.equal(committed.advanced, true);
});

test("R1-E03 Object.create(classification) rejected", () => {
  const tracker = createPaperMarketEventTracker();
  const genuine = tracker.classify(makeEvent());
  const proto = Object.create(genuine);
  const committed = tracker.commit(proto);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT);
  assert.equal(tracker.commit(genuine).ok, true);
});

test("R1-E04 candidate from another tracker rejected", () => {
  const trackerA = createPaperMarketEventTracker();
  const trackerB = createPaperMarketEventTracker();
  const candidate = trackerA.classify(makeEvent());
  const cross = trackerB.commit(candidate);
  assert.equal(cross.ok, false);
  assert.equal(cross.code, ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT);
  assert.equal(inspectKey(trackerB, makeEvent()).lastSequence, null);
  assert.equal(trackerA.commit(candidate).ok, true);
  assert.equal(inspectKey(trackerA, makeEvent()).lastSequence, "1");
});

test("R1-E05 successful candidate is one-shot", () => {
  const tracker = createPaperMarketEventTracker();
  const candidate = tracker.classify(makeEvent());
  assert.equal(tracker.commit(candidate).ok, true);
  const retry = tracker.commit(candidate);
  assert.equal(retry.ok, false);
  assert.equal(retry.code, ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT);
  assert.equal(inspectKey(tracker, makeEvent()).lastSequence, "1");
});

test("R1-E06 stale genuine candidate rejected after another commit", () => {
  const tracker = createPaperMarketEventTracker();
  const a = tracker.classify(makeEvent({ sequence: "101", eventId: "a" }));
  const b = tracker.classify(makeEvent({ sequence: "101", eventId: "a" }));
  assert.equal(a.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(b.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(inspectKey(tracker, makeEvent({ sequence: "101" })).lastSequence, null);
  assert.equal(tracker.commit(a).ok, true);
  const stale = tracker.commit(b);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, ERROR.PAPER_MARKET_EVENT_STALE_COMMIT);
  const probe = tracker.commit(b);
  assert.equal(probe.ok, false);
  assert.equal(probe.code, ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT);
  assert.equal(inspectKey(tracker, makeEvent({ sequence: "101" })).lastSequence, "101");
});

test("R1-E07 non-committable classifications cannot commit", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ sequence: "2", eventId: "e2" }));
  const noop = tracker.classify(makeEvent({ sequence: "2", eventId: "e2" }));
  const ooo = tracker.classify(makeEvent({ sequence: "1", eventId: "e1" }));
  const gap = tracker.classify(makeEvent({ sequence: "4", eventId: "e4" }));
  const conflict = tracker.classify(makeEvent({ sequence: "2", eventId: "other" }));
  assert.equal(noop.classification, CLASSIFICATION.NOOP_DUPLICATE);
  assert.equal(ooo.classification, CLASSIFICATION.OUT_OF_ORDER);
  assert.equal(gap.classification, CLASSIFICATION.SEQUENCE_GAP);
  assert.equal(conflict.classification, CLASSIFICATION.IDENTITY_CONFLICT);
  assert.equal(tracker.commit(noop).code, ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED);
  assert.equal(tracker.commit(ooo).code, ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED);
  assert.equal(tracker.commit(gap).code, ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED);
  assert.equal(tracker.commit(conflict).code, ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED);
  assert.equal(inspectKey(tracker, makeEvent()).lastSequence, "2");
});

test("R1-E08 old NUL tuple collision pair is isolated", () => {
  const tracker = createPaperMarketEventTracker();
  const left = makeEvent({
    symbol: "A\0B",
    sourceGeneration: "C",
    sequence: "1",
    eventId: "nul-left",
  });
  const right = makeEvent({
    symbol: "A",
    sourceGeneration: "B\0C",
    sequence: "1",
    eventId: "nul-right",
  });
  commitOk(tracker, left);
  const classified = tracker.classify(right);
  assert.equal(classified.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(tracker.commit(classified).ok, true);
  assert.equal(inspectKey(tracker, left).lastSequence, "1");
  assert.equal(inspectKey(tracker, right).lastSequence, "1");
  const leftNext = tracker.classify(makeEvent({
    symbol: "A\0B",
    sourceGeneration: "C",
    sequence: "2",
    eventId: "nul-left-2",
    open: 50001,
  }));
  assert.equal(leftNext.classification, CLASSIFICATION.ACCEPTABLE);
  const rightGap = tracker.classify(makeEvent({
    symbol: "A",
    sourceGeneration: "B\0C",
    sequence: "3",
    eventId: "nul-right-3",
    open: 50002,
  }));
  assert.equal(rightGap.classification, CLASSIFICATION.SEQUENCE_GAP);
});

test("R1-E09 symbol/sourceGeneration structural tuple isolation", () => {
  const tracker = createPaperMarketEventTracker();
  commitOk(tracker, makeEvent({ symbol: "005930", sourceGeneration: "gen-a", sequence: "1" }));
  const sameGenOtherSymbol = tracker.classify(makeEvent({
    symbol: "000660",
    sourceGeneration: "gen-a",
    sequence: "1",
    eventId: "other-sym",
  }));
  assert.equal(sameGenOtherSymbol.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  const sameSymbolOtherGen = tracker.classify(makeEvent({
    symbol: "005930",
    sourceGeneration: "gen-b",
    sequence: "1",
    eventId: "other-gen",
  }));
  assert.equal(sameSymbolOtherGen.classification, CLASSIFICATION.BASELINE_CANDIDATE);
  assert.equal(tracker.commit(sameGenOtherSymbol).ok, true);
  assert.equal(tracker.commit(sameSymbolOtherGen).ok, true);
  assert.equal(inspectKey(tracker, makeEvent({ sourceGeneration: "gen-a" })).lastSequence, "1");
  assert.equal(inspectKey(tracker, makeEvent({ symbol: "000660", sourceGeneration: "gen-a" })).lastSequence, "1");
  assert.equal(inspectKey(tracker, makeEvent({ sourceGeneration: "gen-b" })).lastSequence, "1");
});

test("R1-E10 delimiter/prototype-shaped valid identities remain distinct", () => {
  const tracker = createPaperMarketEventTracker();
  const shapes = [" ", "|", ":", "\n", "__proto__", "constructor", "prototype", "toString"];
  for (let i = 0; i < shapes.length; i += 1) {
    const raw = makeEvent({
      symbol: shapes[i],
      sourceGeneration: shapes[i],
      sequence: "1",
      eventId: "shape-" + i,
    });
    const classified = tracker.classify(raw);
    assert.equal(classified.ok, true, "shape " + JSON.stringify(shapes[i]));
    assert.equal(classified.classification, CLASSIFICATION.BASELINE_CANDIDATE);
    assert.equal(tracker.commit(classified).ok, true);
  }
  for (let i = 0; i < shapes.length; i += 1) {
    const inspected = inspectKey(tracker, makeEvent({
      symbol: shapes[i],
      sourceGeneration: shapes[i],
    }));
    assert.equal(inspected.lastSequence, "1", "inspect " + JSON.stringify(shapes[i]));
    assert.equal(inspected.keyRevision, 1);
  }
  const crossed = tracker.classify(makeEvent({
    symbol: "__proto__",
    sourceGeneration: "constructor",
    sequence: "1",
    eventId: "cross-shape",
  }));
  assert.equal(crossed.classification, CLASSIFICATION.BASELINE_CANDIDATE);
});

test("E41 CROSS: commit seq 1, classify 2, calendar holiday reject, last stays 1, then pass calendar commit advances to 2", () => {
  const tracker = createPaperMarketEventTracker();
  const gen = makeEvent().sourceGeneration;
  commitOk(tracker, makeEvent({ sequence: "1", eventId: "e1" }));
  const classified = tracker.classify(makeEvent({
    sequence: "2",
    eventId: "e2",
    open: 51000,
  }));
  assert.equal(classified.ok, true);
  assert.equal(classified.classification, CLASSIFICATION.ACCEPTABLE);

  const holidayGate = createPaperCalendarGate({
    calendarProvider: verifiedProvider({ tradingDay: false }),
  });
  const holiday = holidayGate.validate(classified.event);
  assert.equal(holiday.ok, false);
  const still = tracker.inspect({
    market: "KOSPI",
    symbol: "005930",
    sourceGeneration: gen,
  });
  assert.equal(still.lastSequence, "1");

  const passGate = createPaperCalendarGate({ calendarProvider: verifiedProvider() });
  const passCal = passGate.validate(classified.event);
  assert.equal(passCal.ok, true);
  const committed = tracker.commit(classified);
  assert.equal(committed.ok, true);
  assert.equal(committed.advanced, true);
  assert.equal(committed.lastSequence, "2");
  const after = tracker.inspect({
    market: "KOSPI",
    symbol: "005930",
    sourceGeneration: gen,
  });
  assert.equal(after.lastSequence, "2");
});
