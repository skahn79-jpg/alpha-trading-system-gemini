"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  canonicalizePaperMarketEvent,
  createPaperMarketEventTracker,
} = require("../lib/paper/paper-market-event-identity");
const {
  createPaperCalendarGate,
  validatePaperMarketCalendar,
  CONTROL,
  ERROR,
} = require("../lib/paper/paper-calendar-gate");

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

function canonical(overrides) {
  const result = canonicalizePaperMarketEvent(makeEvent(overrides));
  assert.equal(result.ok, true, result.code);
  return result.event;
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

test("C01 business day 09:00:00 pass", () => {
  const gate = createPaperCalendarGate({ calendarProvider: verifiedProvider() });
  const result = gate.validate(canonical());
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
  assert.equal(result.control, null);
  assert.equal(result.code, null);
});

test("C02 15:29:59 pass", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T15:29:59+09:00" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
  assert.equal(result.control, null);
  assert.equal(result.code, null);
});

test("C03 08:59:59 OUTSIDE_REGULAR_SESSION REJECT_EVENT", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T08:59:59+09:00" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION);
  assert.equal(result.control, CONTROL.REJECT_EVENT);
});

test("C04 15:30:00 OUTSIDE REJECT", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T15:30:00+09:00" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION);
  assert.equal(result.control, CONTROL.REJECT_EVENT);
});

test("C05 tradingDay false NOT_TRADING_DAY", () => {
  const result = validatePaperMarketCalendar(
    canonical(),
    verifiedProvider({ tradingDay: false }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_NOT_TRADING_DAY);
  assert.equal(result.control, CONTROL.REJECT_EVENT);
});

test("C06 coverageStatus PENDING PAUSE PAPER_CALENDAR_PENDING", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      return { coverageStatus: "PENDING" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_PENDING);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C07 verified false UNVERIFIED PAUSE", () => {
  const result = validatePaperMarketCalendar(
    canonical(),
    verifiedProvider({ verified: false }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNVERIFIED);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C08 lookup throw UNAVAILABLE PAUSE", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      throw new Error("boom");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C09 provider null/missing lookup UNAVAILABLE", () => {
  const asNull = validatePaperMarketCalendar(canonical(), null);
  assert.equal(asNull.ok, false);
  assert.equal(asNull.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
  assert.equal(asNull.control, CONTROL.PAUSE_STREAM);
  const missing = validatePaperMarketCalendar(canonical(), {});
  assert.equal(missing.ok, false);
  assert.equal(missing.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
  assert.equal(missing.control, CONTROL.PAUSE_STREAM);
});

test("C10 outOfRange true OUT_OF_RANGE", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      return { outOfRange: true, verified: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_OUT_OF_RANGE);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C11 date mismatch 2026-09-02T09:00:00+09:00 vs tradingDate 2026-09-01 HALT TRADING_DATE_MISMATCH", () => {
  const result = validatePaperMarketCalendar(
    canonical({
      tradingDate: "2026-09-01",
      exchangeEventTime: "2026-09-02T09:00:00+09:00",
    }),
    verifiedProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_TRADING_DATE_MISMATCH);
  assert.equal(result.control, CONTROL.HALT_STREAM);
});

test("C12 offset +08:00 HALT OFFSET_MISMATCH", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T09:00:00+08:00" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_OFFSET_MISMATCH);
  assert.equal(result.control, CONTROL.HALT_STREAM);
});

test("C13 receivedAt on event ignored", () => {
  const a = validatePaperMarketCalendar(canonical(), verifiedProvider());
  const b = validatePaperMarketCalendar(
    canonical({ receivedAt: "host-local" }),
    verifiedProvider(),
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.sessionType, b.sessionType);
  assert.equal(a.code, null);
  assert.equal(b.code, null);
});

test("C14 special hours 10:00-14:00: 09:00 reject, 10:00 pass, 14:00 reject", () => {
  const provider = verifiedProvider({
    sessions: [{ type: "REGULAR", start: "10:00:00", end: "14:00:00" }],
  });
  const at09 = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T09:00:00+09:00" }),
    provider,
  );
  assert.equal(at09.ok, false);
  assert.equal(at09.code, ERROR.PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION);
  const at10 = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T10:00:00+09:00" }),
    provider,
  );
  assert.equal(at10.ok, true);
  const at14 = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T14:00:00+09:00" }),
    provider,
  );
  assert.equal(at14.ok, false);
  assert.equal(at14.code, ERROR.PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION);
});

test("C15 verified tradingDay sessions [] UNVERIFIED (do not fill 09:00-15:30)", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T09:00:00+09:00" }),
    verifiedProvider({ sessions: [] }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNVERIFIED);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C16 unknown market REJECT UNKNOWN_MARKET (raw object with own NYSE)", () => {
  const result = validatePaperMarketCalendar({
    market: "NYSE",
    tradingDate: "2026-09-01",
    exchangeEventTime: "2026-09-01T09:00:00+09:00",
  }, verifiedProvider());
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNKNOWN_MARKET);
  assert.equal(result.control, CONTROL.REJECT_EVENT);
});

test("C17 sessions only {type:PRE_MARKET} UNSUPPORTED_SESSION", () => {
  const result = validatePaperMarketCalendar(
    canonical(),
    verifiedProvider({
      sessions: [{ type: "PRE_MARKET", start: "08:00:00", end: "09:00:00" }],
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNSUPPORTED_SESSION);
  assert.equal(result.control, CONTROL.REJECT_EVENT);
});

test("C18 prototype inherited market/tradingDate/exchangeEventTime INVALID_INPUT PAUSE", () => {
  const proto = {
    market: "KOSPI",
    tradingDate: "2026-09-01",
    exchangeEventTime: "2026-09-01T09:00:00+09:00",
  };
  const event = Object.assign(Object.create(proto), { eventId: "evt-1" });
  const result = validatePaperMarketCalendar(event, verifiedProvider());
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_INVALID_INPUT);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C19 canonical fields used without transform: same market tradingDate exchangeEventTime", () => {
  const event = canonical();
  const market = event.market;
  const tradingDate = event.tradingDate;
  const exchangeEventTime = event.exchangeEventTime;
  const result = validatePaperMarketCalendar(event, verifiedProvider());
  assert.equal(result.ok, true);
  assert.equal(event.market, market);
  assert.equal(event.tradingDate, tradingDate);
  assert.equal(event.exchangeEventTime, exchangeEventTime);
  assert.equal(result.market, "KOSPI");
  assert.equal(result.tradingDate, "2026-09-01");
});

test("C20 source scan of calendar-gate.js: no require calendar fetch axios Date.now( Math.random LiveBroker", () => {
  const src = readFileSync(join(__dirname, "../lib/paper/paper-calendar-gate.js"), "utf8");
  assert.equal(src.includes("require(\"../calendar"), false);
  assert.equal(src.includes("require(\"./calendar"), false);
  assert.equal(src.includes("fetch("), false);
  assert.equal(src.includes("axios"), false);
  assert.equal(src.includes("Date.now("), false);
  assert.equal(src.includes("Math.random"), false);
  assert.equal(src.includes("LiveBroker"), false);
});

test("C21 host TZ independent: only +09:00 strings", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T09:00:00+09:00" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
  const src = readFileSync(join(__dirname, "../lib/paper/paper-calendar-gate.js"), "utf8");
  assert.equal(src.includes("toLocaleString"), false);
  assert.equal(src.includes("getTimezoneOffset"), false);
});

test("C22 weekend same as not trading day", () => {
  const result = validatePaperMarketCalendar(
    canonical({
      tradingDate: "2026-09-05",
      exchangeEventTime: "2026-09-05T09:00:00+09:00",
    }),
    verifiedProvider({ tradingDay: false }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_NOT_TRADING_DAY);
  assert.equal(result.control, CONTROL.REJECT_EVENT);
});

test("C23 coverage UNAVAILABLE PAUSE", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      return { coverageStatus: "UNAVAILABLE" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C24 malformed non-object lookup result MALFORMED PAUSE", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      return "not-an-object";
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_MALFORMED);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C25 timezone not Asia/Seoul when verified MALFORMED", () => {
  const result = validatePaperMarketCalendar(
    canonical(),
    verifiedProvider({ timezone: "UTC" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_MALFORMED);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C26 no tracker mutation: identity inspect last unchanged after validate", () => {
  const tracker = createPaperMarketEventTracker();
  const classified = tracker.classify(makeEvent());
  assert.equal(classified.ok, true);
  validatePaperMarketCalendar(classified.event, verifiedProvider());
  const inspected = tracker.inspect({
    market: "KOSPI",
    symbol: "005930",
    sourceGeneration: makeEvent().sourceGeneration,
  });
  assert.equal(inspected.lastSequence, null);
  assert.equal(inspected.lastDigest, null);
  assert.equal(inspected.keyRevision, 0);
});

test("C27 paperEligible true not in source", () => {
  const src = readFileSync(join(__dirname, "../lib/paper/paper-calendar-gate.js"), "utf8");
  assert.equal(src.includes("paperEligible: true"), false);
  assert.equal(/paperEligible\s*[:=]\s*true/.test(src), false);
});

test("C28 success sessionType REGULAR control null code null", () => {
  const result = validatePaperMarketCalendar(canonical(), verifiedProvider());
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
  assert.equal(result.control, null);
  assert.equal(result.code, null);
});

test("C29 09:00:00 inclusive", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T09:00:00+09:00" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
});

test("C30 15:29:59 inclusive end exclusive", () => {
  const last = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T15:29:59+09:00" }),
    verifiedProvider(),
  );
  assert.equal(last.ok, true);
  const end = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T15:30:00+09:00" }),
    verifiedProvider(),
  );
  assert.equal(end.ok, false);
  assert.equal(end.code, ERROR.PAPER_CALENDAR_OUTSIDE_REGULAR_SESSION);
});

test("C31 malformed exchange time", () => {
  const result = validatePaperMarketCalendar({
    market: "KOSPI",
    tradingDate: "2026-09-01",
    exchangeEventTime: "not-a-time",
  }, verifiedProvider());
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_MALFORMED);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C32 missing own tradingDate", () => {
  const result = validatePaperMarketCalendar({
    market: "KOSPI",
    exchangeEventTime: "2026-09-01T09:00:00+09:00",
  }, verifiedProvider());
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_INVALID_INPUT);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C33 KOSDAQ pass with same Seoul provider", () => {
  const result = validatePaperMarketCalendar(
    canonical({ market: "KOSDAQ" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
  assert.equal(result.market, "KOSDAQ");
});

test("C34 SYNTHETIC_KOSPI pass with same Seoul provider", () => {
  const result = validatePaperMarketCalendar(
    canonical({ market: "SYNTHETIC_KOSPI" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
});

test("C35 SYNTHETIC_KOSDAQ pass with same Seoul provider", () => {
  const result = validatePaperMarketCalendar(
    canonical({ market: "SYNTHETIC_KOSDAQ" }),
    verifiedProvider(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
});

test("C36 version echoed as calendarVersion", () => {
  const result = validatePaperMarketCalendar(canonical(), verifiedProvider());
  assert.equal(result.ok, true);
  assert.equal(result.calendarVersion, "cal-v1");
});

test("C37 createPaperCalendarGate validate and validatePaperMarketCalendar", () => {
  const gate = createPaperCalendarGate({ calendarProvider: verifiedProvider() });
  const result = gate.validate(canonical());
  assert.equal(result.ok, true);
  assert.equal(gate.validatePaperMarketCalendar(canonical()).ok, true);
});

test("C38 lookup null UNAVAILABLE", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      return null;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
});

test("C39 lookup missing function PAUSE", () => {
  const result = validatePaperMarketCalendar(canonical(), {});
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C40 mixed PRE_MARKET among REGULAR uses REGULAR", () => {
  const result = validatePaperMarketCalendar(
    canonical(),
    verifiedProvider({
      sessions: [
        { type: "PRE_MARKET", start: "08:00:00", end: "09:00:00" },
        { type: "REGULAR", start: "09:00:00", end: "15:30:00" },
      ],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.sessionType, "REGULAR");
});

test("C41 do not recanonicalize sequence/digest", () => {
  const event = canonical();
  const seq = event.sequence;
  const digest = event.digest;
  validatePaperMarketCalendar(event, verifiedProvider());
  assert.equal(event.sequence, seq);
  assert.equal(event.digest, digest);
});

test("C42 gate without provider PAUSE", () => {
  const gate = createPaperCalendarGate({});
  const result = gate.validate(canonical());
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNAVAILABLE);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});

test("C43 malformed session times UNVERIFIED", () => {
  const result = validatePaperMarketCalendar(
    canonical(),
    verifiedProvider({
      sessions: [{ type: "REGULAR", start: "9:00", end: "15:30" }],
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNVERIFIED);
});

test("C44 sessions null no 09:00-15:30 global fill", () => {
  const result = validatePaperMarketCalendar(
    canonical({ exchangeEventTime: "2026-09-01T09:00:00+09:00" }),
    verifiedProvider({ sessions: null }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_UNVERIFIED);
});

test("C45 provider result number MALFORMED", () => {
  const result = validatePaperMarketCalendar(canonical(), {
    lookup() {
      return 1;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_CALENDAR_MALFORMED);
  assert.equal(result.control, CONTROL.PAUSE_STREAM);
});
