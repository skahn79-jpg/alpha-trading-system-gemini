/**
 * 캘린더 스냅샷 무결성·fail-closed 테스트.
 * 합성 fixture만 사용한다. 네트워크 없음.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  computeContentChecksum,
  computeMetadataHash,
  assertCompatibleVersion,
  withChecksums,
  CONTENT_CHECKSUM_MISMATCH,
  METADATA_HASH_MISMATCH,
  CALENDAR_VERSION_CONFLICT,
  CALENDAR_CANONICALIZATION_UNSUPPORTED,
} = require("../lib/calendar/calendar-checksum");
const {
  validateSnapshot,
  loadCalendarSnapshot,
  CALENDAR_SCHEMA_INVALID,
  CALENDAR_DUPLICATE_DATE,
  CALENDAR_WEEKEND_TRADING_DAY,
  CALENDAR_SESSION_CONFLICT,
} = require("../lib/calendar/calendar-snapshot");
const {
  TRADING_DAY_STATUS,
  createUnavailableCalendarProvider,
} = require("../lib/calendar/calendar-provider");
const { SESSION_TYPE, TIMEZONE_SEOUL } = require("../lib/calendar/session-schedule");
const {
  makeMainCompleteSnapshot,
  attachChecksums,
} = require("./fixtures/synthetic-calendar-snapshot");

const TEST_LOAD = { mode: "TEST", allowSyntheticFixture: true };
function load(snapshot) {
  const loaded = loadCalendarSnapshot(snapshot, TEST_LOAD);
  assert.equal(loaded.ok, true, loaded.error);
  return loaded.provider;
}

function stripChecksums(snapshot) {
  const copy = { ...snapshot };
  delete copy.contentChecksum;
  delete copy.metadataHash;
  delete copy.contentChecksumVerified;
  delete copy.metadataHashVerified;
  return copy;
}

test("6. tradingDays 주말은 CALENDAR_WEEKEND_TRADING_DAY", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  snap.tradingDays = [...snap.tradingDays, "2100-01-10"];
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CALENDAR_WEEKEND_TRADING_DAY);
  const st = loaded.provider.getTradingDayStatus("2100-01-05");
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.notEqual(st.tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
});

test("18. 휴장일 세션 예외는 CALENDAR_SESSION_CONFLICT", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  snap.sessionExceptions = [
    ...snap.sessionExceptions,
    {
      date: "2100-01-15",
      sessionType: SESSION_TYPE.DELAYED_OPEN_SESSION,
      marketOpenTime: null,
      marketCloseTime: null,
      timezone: TIMEZONE_SEOUL,
      sourceRef: "synthetic-fixture",
    },
  ];
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CALENDAR_SESSION_CONFLICT);
});

test("19. 중복 거래일은 CALENDAR_DUPLICATE_DATE", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  snap.tradingDays = [...snap.tradingDays, "2100-01-05"];
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CALENDAR_DUPLICATE_DATE);
});

test("20. 잘못된 coverage 는 CALENDAR_SCHEMA_INVALID", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  snap.coverage = { start: "2100-02-12", end: "2100-01-05", completeness: "COMPLETE" };
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CALENDAR_SCHEMA_INVALID);

  const missing = stripChecksums(makeMainCompleteSnapshot());
  delete missing.coverage;
  assert.equal(validateSnapshot(missing).code, CALENDAR_SCHEMA_INVALID);
});

test("21. content checksum 검증 성공", () => {
  const snap = makeMainCompleteSnapshot();
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, true);
  const expected = computeContentChecksum(snap);
  assert.equal(snap.contentChecksum, expected);
  assert.equal(loaded.provider.validateIntegrity().ok, true);
});

test("22. 키 순서·공백이 달라도 content checksum 동일", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  const pretty = JSON.parse(JSON.stringify(snap, null, 2));
  const compact = JSON.parse(JSON.stringify(snap));
  const reordered = {
    tradingDays: [...snap.tradingDays].reverse(),
    sessionExceptions: [...snap.sessionExceptions],
    coverage: {
      completeness: snap.coverage.completeness,
      end: snap.coverage.end,
      start: snap.coverage.start,
    },
    markets: [...snap.markets],
    calendarVersion: snap.calendarVersion,
    calendarId: snap.calendarId,
    canonicalizationVersion: snap.canonicalizationVersion,
    sources: [...snap.sources],
    verificationStatus: snap.verificationStatus,
    fixtureType: snap.fixtureType,
    notActualKrxCalendar: snap.notActualKrxCalendar,
    notProductionData: snap.notProductionData,
    productionEligible: snap.productionEligible,
  };
  const a = computeContentChecksum(pretty);
  const b = computeContentChecksum(compact);
  const c = computeContentChecksum(reordered);
  assert.equal(a, b);
  assert.equal(a, c);
});

test("23. 거래일 변경은 content checksum 을 바꾼다", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  const changed = {
    ...snap,
    tradingDays: snap.tradingDays.filter((d) => d !== "2100-01-06"),
  };
  assert.notEqual(computeContentChecksum(snap), computeContentChecksum(changed));
});

test("24. sources 변경은 contentChecksum 을 유지하고 metadataHash 를 바꾼다", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  const changed = {
    ...snap,
    sources: [{ sourceRef: "other-synthetic", name: "OTHER_SYNTHETIC" }],
  };
  assert.equal(computeContentChecksum(snap), computeContentChecksum(changed));
  assert.notEqual(computeMetadataHash(snap), computeMetadataHash(changed));
});

test("25. contentChecksum 불일치는 CONTENT_CHECKSUM_MISMATCH", () => {
  const snap = makeMainCompleteSnapshot();
  snap.contentChecksum = "a".repeat(64);
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CONTENT_CHECKSUM_MISMATCH);
  const st = loaded.provider.getTradingDayStatus("2100-01-05");
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.equal(st.code, CONTENT_CHECKSUM_MISMATCH);
  assert.equal(st.providerStatus, "UNAVAILABLE");
});

test("26. 지원하지 않는 canonicalizationVersion", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  snap.canonicalizationVersion = "calendar-c14n-v0";
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CALENDAR_CANONICALIZATION_UNSUPPORTED);
});

test("같은 calendarVersion 다른 content 는 CALENDAR_VERSION_CONFLICT", () => {
  const a = stripChecksums(makeMainCompleteSnapshot());
  const b = {
    ...a,
    tradingDays: a.tradingDays.filter((d) => d !== "2100-01-06"),
  };
  const result = assertCompatibleVersion(attachChecksums(b), attachChecksums(a));
  assert.equal(result.ok, false);
  assert.equal(result.code, CALENDAR_VERSION_CONFLICT);
});

test("load 실패는 fail-closed unavailable provider", () => {
  const loaded = loadCalendarSnapshot({ not: "a calendar" });
  assert.equal(loaded.ok, false);
  assert.equal(typeof loaded.provider.getTradingDayStatus, "function");
  const st = loaded.provider.getTradingDayStatus("2100-01-05");
  assert.equal(st.ok, false);
  assert.equal(st.tradingDayStatus, TRADING_DAY_STATUS.CALENDAR_PENDING);
  assert.notEqual(st.tradingDayStatus, TRADING_DAY_STATUS.TRADING_DAY);
  assert.equal(loaded.provider.getCoverage(), null);
  assert.equal(loaded.provider.productionCalendarStatus, "NOT_CONFIGURED");
});

test("손상 스냅샷을 빈 성공 캘린더로 바꾸지 않는다", () => {
  const unavailable = createUnavailableCalendarProvider({ code: CALENDAR_SCHEMA_INVALID });
  const st = unavailable.getTradingDayStatus("2100-01-05");
  assert.equal(st.ok, false);
  assert.equal(st.targetTradingDate, null);
  assert.deepEqual(unavailable.getTradingDaysBetween("2100-01-05", "2100-01-08").dates || [], []);
  assert.equal(unavailable.validateIntegrity().ok, false);
});

test("32. 캘린더 모듈은 kb/broker, axios, kis 를 require 하지 않는다", () => {
  const dir = path.join(__dirname, "../lib/calendar");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const requireRe = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    requireRe.lastIndex = 0;
    let m;
    while ((m = requireRe.exec(src))) {
      const mod = m[2];
      const lower = mod.toLowerCase();
      assert.notEqual(lower, "axios", `${file} requires axios`);
      assert.ok(!/(^|[\\/])axios([\\/]|$)/.test(lower), `${file} requires axios path`);
      assert.ok(!/(^|[\\/])kb([\\/]|$)/.test(lower), `${file} requires kb`);
      assert.ok(!/(^|[\\/])broker([\\/]|$)/.test(lower), `${file} requires broker`);
      assert.ok(!/(^|[\\/])kis([\\/]|$)/.test(lower), `${file} requires kis`);
    }
  }
});

test("sessionExceptions 변경은 contentChecksum 을 바꾼다", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  const changed = {
    ...snap,
    sessionExceptions: snap.sessionExceptions.map((ex, i) => (
      i === 0 ? { ...ex, sessionType: SESSION_TYPE.EARLY_CLOSE_SESSION } : ex
    )),
  };
  assert.notEqual(computeContentChecksum(snap), computeContentChecksum(changed));
});

test("metadataHash 불일치는 METADATA_HASH_MISMATCH 이고 unavailable code 를 보존한다", () => {
  const snap = makeMainCompleteSnapshot();
  snap.metadataHash = "b".repeat(64);
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, METADATA_HASH_MISMATCH);
  const st = loaded.provider.getTradingDayStatus("2100-01-05");
  assert.equal(st.code, METADATA_HASH_MISMATCH);
  assert.equal(st.providerStatus, "UNAVAILABLE");
  assert.equal(loaded.provider.validateIntegrity().code, METADATA_HASH_MISMATCH);
  assert.equal(loaded.providerStatus, "UNAVAILABLE");
});

test("withChecksums 결과는 provenanceChecksum 이 없다", () => {
  const raw = stripChecksums(makeMainCompleteSnapshot());
  raw.provenanceChecksum = "deadbeef";
  const summed = withChecksums(raw);
  assert.equal(summed.provenanceChecksum, undefined);
  assert.equal("provenanceChecksum" in summed, false);
  assert.equal(typeof summed.contentChecksum, "string");
  assert.equal(typeof summed.metadataHash, "string");
});

test("verifiedAt 변경은 contentChecksum 을 유지하고 metadataHash 를 바꾼다", () => {
  const snap = stripChecksums(makeMainCompleteSnapshot());
  const changed = { ...snap, verifiedAt: "2100-01-05T00:00:00Z" };
  assert.equal(computeContentChecksum(snap), computeContentChecksum(changed));
  assert.notEqual(computeMetadataHash(snap), computeMetadataHash(changed));
});

test("load 실패는 originalErrorCode / code 를 보존한다", () => {
  const snap = makeMainCompleteSnapshot();
  snap.contentChecksum = "c".repeat(64);
  const loaded = loadCalendarSnapshot(snap, TEST_LOAD);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, CONTENT_CHECKSUM_MISMATCH);
  const st = loaded.provider.getTradingDayStatus("2100-01-05");
  assert.equal(st.code, CONTENT_CHECKSUM_MISMATCH);
  assert.equal(st.originalErrorCode, CONTENT_CHECKSUM_MISMATCH);
  assert.equal(st.providerStatus, "UNAVAILABLE");
  const integrity = loaded.provider.validateIntegrity();
  assert.equal(integrity.ok, false);
  assert.equal(integrity.code, CONTENT_CHECKSUM_MISMATCH);
});
