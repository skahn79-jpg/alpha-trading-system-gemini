/**
 * predictor targetDateStatus 불변식. predictor-stage1 기대값은 바꾸지 않는다.
 * 합성 캘린더 + memory store. 네트워크 없음.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { createPredictor, readTargetDateStatus } = require("../predictor.js");
const { createMemoryStore } = require("../lib/storage");
const { loadCalendarSnapshot } = require("../lib/calendar/calendar-snapshot");
const {
  createCalendarProvider,
  TRADING_DAY_STATUS,
} = require("../lib/calendar/calendar-provider");
const {
  makeMainCompleteSnapshot,
  makeLongCompleteSnapshot,
} = require("./fixtures/synthetic-calendar-snapshot");

const TEST_LOAD = { mode: "TEST", allowSyntheticFixture: true };

const ANALYSIS = { signals: [], rsi: 50, score: 50, atr: { pct: 0 } };
const ENTRY = 70000;
const SYN_NOW = "2100-01-05T15:40:00+09:00";

function closedCandle(tradingDate = "2100-01-05") {
  return { tradingDate, isFinal: true, marketSession: "CLOSED" };
}

function loadProvider(snapshot) {
  const loaded = loadCalendarSnapshot(snapshot, TEST_LOAD);
  assert.equal(loaded.ok, true, loaded.error);
  return loaded.provider;
}

test("readTargetDateStatus 는 모듈에서 export 된다", () => {
  assert.equal(typeof readTargetDateStatus, "function");
  assert.equal(readTargetDateStatus(null), "UNKNOWN_LEGACY");
  assert.equal(readTargetDateStatus({}), "UNKNOWN_LEGACY");
  assert.equal(readTargetDateStatus({ targetDateStatus: null }), "UNKNOWN_LEGACY");
  assert.equal(readTargetDateStatus({ targetDateStatus: "" }), "UNKNOWN_LEGACY");
  assert.equal(readTargetDateStatus({ targetDateStatus: "CONFIRMED" }), "CONFIRMED");
});

test("27. targetDateStatus 불변식: CONFIRMED iff targetTradingDate != null", () => {
  const store = createMemoryStore();
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  const result = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar,
  });
  const rec = store.listPredictions()[0];
  assert.ok(rec.targetTradingDate);
  assert.equal(rec.targetDateStatus, "CONFIRMED");
  assert.equal(result.targetDateStatus, "CONFIRMED");
  assert.equal(rec.evaluationStatus, "PENDING");
  assert.notEqual(rec.evaluationStatus, "TARGET_DATE_CONFIRMED");
  assert.notEqual(result.evaluationStatus, "TARGET_DATE_CONFIRMED");
  assert.equal(rec.targetDateStatus === "CONFIRMED", rec.targetTradingDate != null);
});

test("27b. RANGE / PENDING / SOURCE_CONFLICT 는 evaluationStatus 가 아니다", () => {
  const store = createMemoryStore();
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: "2100-02-12T15:40:00+09:00",
    candle: closedCandle("2100-02-12"),
    calendar,
    baseTradingDate: "2100-02-12",
    horizonType: "SHORT",
    horizonTradingDays: 5,
  });
  const rangeRec = store.listPredictions()[0];
  assert.equal(rangeRec.targetTradingDate, null);
  assert.equal(rangeRec.targetDateStatus, "CALENDAR_RANGE_INSUFFICIENT");
  assert.equal(rangeRec.evaluationStatus, null);
  assert.notEqual(rangeRec.evaluationStatus, "CALENDAR_RANGE_INSUFFICIENT");
  assert.notEqual(rangeRec.evaluationStatus, "TARGET_DATE_CONFIRMED");

  const conflictSnap = makeMainCompleteSnapshot();
  conflictSnap.sourceConflict = true;
  const conflictCal = createCalendarProvider(conflictSnap, TEST_LOAD);
  const store2 = createMemoryStore();
  const predictor2 = createPredictor({ store: store2, calendar: conflictCal, nowFn: () => SYN_NOW });
  predictor2.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar: conflictCal,
  });
  const conflictRec = store2.listPredictions()[0];
  assert.equal(conflictRec.targetTradingDate, null);
  assert.equal(conflictRec.targetDateStatus, "CALENDAR_SOURCE_CONFLICT");
  assert.equal(conflictRec.evaluationStatus, null);
  assert.notEqual(conflictRec.evaluationStatus, "CALENDAR_SOURCE_CONFLICT");
});

test("28. 레거시 기록 missing/null targetDateStatus 는 UNKNOWN_LEGACY, 채점은 EVALUATED", async () => {
  const store = createMemoryStore({
    predictions: [{
      id: "legacy-1",
      predictionId: "legacy-1",
      code: "005930",
      symbol: "005930",
      date: "2100-01-05",
      baseTradingDate: "2100-01-05",
      targetTradingDate: "2100-01-12",
      entryPrice: ENTRY,
      baseClose: ENTRY,
      features: { bias: 1 },
      probUp: 0.6,
      status: "pending",
      evaluationStatus: "PENDING",
      horizonType: "LEGACY_7_CALENDAR_DAYS",
      horizonTradingDays: null,
    }],
  });
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({
    store,
    calendar,
    nowFn: () => "2100-01-12T15:40:00+09:00",
  });
  const result = await predictor.processMatured(async () => [
    { date: "2100-01-12", close: 71000, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2100-01-12" });
  const rec = store.listPredictions()[0];
  assert.equal(result.processed, 1);
  assert.equal(rec.evaluationStatus, "EVALUATED");
  assert.equal(readTargetDateStatus(rec), "UNKNOWN_LEGACY");
  assert.ok(rec.targetDateStatus == null || rec.targetDateStatus === "");
});

test("29. 신규 기록은 targetDateStatus 를 가진다", () => {
  const store = createMemoryStore();
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  const result = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar,
  });
  const rec = store.listPredictions()[0];
  assert.ok(rec.targetDateStatus);
  assert.equal(rec.targetDateStatus, "CONFIRMED");
  assert.equal(result.targetDateStatus, "CONFIRMED");
});

test("30. evaluationStatus 는 PENDING / EVALUATED / null 이고 RANGE 는 targetDateStatus 로만 간다", () => {
  const store = createMemoryStore();
  const calendar = loadProvider(makeLongCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  const pending = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar,
  });
  assert.equal(pending.evaluationStatus, "PENDING");
  const rec = store.listPredictions()[0];
  assert.equal(rec.evaluationStatus, "PENDING");

  const store2 = createMemoryStore();
  const predictor2 = createPredictor({ store: store2, calendar, nowFn: () => SYN_NOW });
  predictor2.predict("005930", ANALYSIS, ENTRY, {
    now: "2100-04-30T15:40:00+09:00",
    candle: closedCandle("2100-04-30"),
    calendar,
    baseTradingDate: "2100-04-30",
    horizonType: "SHORT",
    horizonTradingDays: 5,
  });
  const rangeRec = store2.listPredictions()[0];
  assert.equal(rangeRec.evaluationStatus, null);
  assert.equal(rangeRec.targetDateStatus, "CALENDAR_RANGE_INSUFFICIENT");
  assert.equal(rangeRec.targetTradingDate, null);
});

test("31. 기본 createPredictor 는 createUnavailableCalendar 이고 CALENDAR_PENDING", () => {
  const src = fs.readFileSync(path.join(__dirname, "../predictor.js"), "utf8");
  assert.match(src, /require\(["']\.\/lib\/calendar\/krx-calendar["']\)/);
  assert.match(src, /calendar:\s*createUnavailableCalendar\(\)/);
  const store = createMemoryStore();
  const predictor = createPredictor({ store, nowFn: () => SYN_NOW });
  const result = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
  });
  assert.equal(result.evaluationStatus, null);
  const rec = store.listPredictions()[0];
  assert.equal(rec.evaluationStatus, null);
  assert.equal(rec.targetTradingDate, null);
  assert.equal(rec.targetDateStatus, "CALENDAR_PENDING");
});

test("32. 캘린더 모듈 require 경로에 kis 단어 경계가 없다", () => {
  const dir = path.join(__dirname, "../lib/calendar");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const requireRe = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    requireRe.lastIndex = 0;
    let m;
    while ((m = requireRe.exec(src))) {
      const parts = m[2].toLowerCase().split(/[\\/]/);
      assert.ok(!parts.includes("kis"), `${file} require kis: ${m[2]}`);
      assert.ok(!parts.includes("axios"), `${file} require axios`);
      assert.ok(!parts.includes("broker"), `${file} require broker`);
    }
  }
});

test("duck-type getTradingDayStatus 캘린더로 레거시 목표일을 계산한다", () => {
  const duck = {
    getTradingDayStatus() {
      return { ok: true, tradingDayStatus: TRADING_DAY_STATUS.TRADING_DAY };
    },
    resolveLegacyTarget() {
      return {
        ok: true,
        targetTradingDate: "2100-01-12",
        evaluationStatus: "PENDING",
        targetDateStatus: "CONFIRMED",
        missingData: [],
        code: null,
      };
    },
    addTradingDays() {
      return {
        ok: true,
        targetTradingDate: "2100-01-12",
        evaluationStatus: "PENDING",
        missingData: [],
        code: null,
      };
    },
  };
  const store = createMemoryStore();
  const predictor = createPredictor({ store, calendar: duck, nowFn: () => SYN_NOW });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar: duck,
  });
  const rec = store.listPredictions()[0];
  assert.equal(rec.targetTradingDate, "2100-01-12");
  assert.equal(rec.targetDateStatus, "CONFIRMED");
  assert.equal(rec.evaluationStatus, "PENDING");
});

test("중복 매칭 시 readTargetDateStatus(matched) 를 반환한다", () => {
  const store = createMemoryStore();
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  const opts = { now: SYN_NOW, candle: closedCandle(), calendar };
  predictor.predict("005930", ANALYSIS, ENTRY, opts);
  const second = predictor.predict("005930", ANALYSIS, ENTRY, opts);
  assert.equal(store.listPredictions().length, 1);
  assert.equal(second.targetDateStatus, "CONFIRMED");
  assert.equal(readTargetDateStatus(store.listPredictions()[0]), "CONFIRMED");
});

test("processMatured 모델 실패 후 MODEL_UPDATE_PENDING + CONFIRMED", async () => {
  const store = createMemoryStore({ failNextModelWrite: true });
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar,
    horizonType: "SHORT",
    horizonTradingDays: 5,
  });
  const result = await predictor.processMatured(async () => [
    { date: "2100-01-12", close: 71000, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2100-01-12" });
  const rec = store.listPredictions()[0];
  assert.equal(result.modelSaveFailed, true);
  assert.equal(rec.evaluationStatus, "MODEL_UPDATE_PENDING");
  assert.equal(rec.targetDateStatus, "CONFIRMED");
  assert.equal(rec.targetTradingDate, "2100-01-12");
  assert.equal(rec.targetClose, 71000);
});

test("processMatured 성공 후 EVALUATED + CONFIRMED", async () => {
  const store = createMemoryStore();
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({ store, calendar, nowFn: () => SYN_NOW });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar,
    horizonType: "SHORT",
    horizonTradingDays: 5,
  });
  await predictor.processMatured(async () => [
    { date: "2100-01-12", close: 71000, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2100-01-12" });
  const rec = store.listPredictions()[0];
  assert.equal(rec.evaluationStatus, "EVALUATED");
  assert.equal(rec.targetDateStatus, "CONFIRMED");
  assert.equal(rec.targetTradingDate, "2100-01-12");
  assert.equal(rec.targetClose, 71000);
});

test("미확정 기록은 PENDING/EVALUATED 가 될 수 없다", async () => {
  const store = createMemoryStore();
  const predictor = createPredictor({ store, nowFn: () => SYN_NOW });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
  });
  const rec = store.listPredictions()[0];
  assert.equal(rec.evaluationStatus, null);
  assert.notEqual(rec.evaluationStatus, "PENDING");
  assert.notEqual(rec.evaluationStatus, "EVALUATED");
  await predictor.processMatured(async () => [
    { date: "2100-01-12", close: 71000, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2100-01-12" });
  const after = store.listPredictions()[0];
  assert.equal(after.evaluationStatus, null);
  assert.notEqual(after.evaluationStatus, "PENDING");
  assert.notEqual(after.evaluationStatus, "EVALUATED");
  assert.notEqual(after.evaluationStatus, "CALENDAR_PENDING");
});

test("targetClose 없으면 EVALUATED 가 될 수 없다", async () => {
  const store = createMemoryStore({
    predictions: [{
      id: "new-1",
      predictionId: "new-1",
      code: "005930",
      symbol: "005930",
      date: "2100-01-05",
      baseTradingDate: "2100-01-05",
      targetTradingDate: "2100-01-12",
      targetDateStatus: "CONFIRMED",
      entryPrice: ENTRY,
      baseClose: ENTRY,
      features: { bias: 1 },
      probUp: 0.6,
      status: "pending",
      evaluationStatus: "MODEL_UPDATE_PENDING",
      targetClose: null,
      horizonType: "SHORT",
      horizonTradingDays: 5,
    }],
  });
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor = createPredictor({
    store,
    calendar,
    nowFn: () => "2100-01-12T15:40:00+09:00",
  });
  await predictor.processMatured(async () => [
    { date: "2100-01-12", close: 71000, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2100-01-12" });
  const rec = store.listPredictions()[0];
  assert.notEqual(rec.evaluationStatus, "EVALUATED");
  assert.equal(rec.targetClose, null);
});

test("신규 기록 evaluationStatus 는 CALENDAR_PENDING 이 아니다", () => {
  const store = createMemoryStore();
  const predictor = createPredictor({ store, nowFn: () => SYN_NOW });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
  });
  const rec = store.listPredictions()[0];
  assert.notEqual(rec.evaluationStatus, "CALENDAR_PENDING");
  assert.equal(rec.evaluationStatus, null);
  assert.equal(rec.targetDateStatus, "CALENDAR_PENDING");

  const store2 = createMemoryStore();
  const calendar = loadProvider(makeMainCompleteSnapshot());
  const predictor2 = createPredictor({ store: store2, calendar, nowFn: () => SYN_NOW });
  predictor2.predict("005930", ANALYSIS, ENTRY, {
    now: SYN_NOW,
    candle: closedCandle(),
    calendar,
  });
  const confirmed = store2.listPredictions()[0];
  assert.notEqual(confirmed.evaluationStatus, "CALENDAR_PENDING");
  assert.equal(confirmed.evaluationStatus, "PENDING");
  assert.equal(confirmed.targetDateStatus, "CONFIRMED");
});
