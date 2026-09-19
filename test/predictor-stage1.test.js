/**
 * 단계 1 — 예측 식별키 / KRX 거래일 / processMatured / StoragePort
 * node:test, 네트워크 0회, fixture/mock만. data/ 운영 파일은 건드리지 않는다.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createPredictor,
  predict,
  processMatured,
  getModelStats,
  buildFeatures,
  trainFromHistory,
  UNSPECIFIED_MODEL_VERSION,
  UNSPECIFIED_FEATURE_VERSION,
  MODEL_VERSION,
  FEATURE_VERSION,
} = require("../predictor.js");
const {
  createMemoryStore,
  createJsonFileStore,
  CorruptedJsonError,
} = require("../lib/storage");
const {
  createTradingCalendar,
  createUnavailableCalendar,
} = require("../lib/calendar/krx-calendar");
const { buildPredictOptsFromCandles } = require("../lib/calendar/candle-meta");
const {
  TRADING_DAYS_2026_08,
  BASE_DATE,
  HOLIDAY_AWARE_TARGET,
  WEEKEND_ONLY_WRONG_TARGET,
  COMBINED_TRADING_DAYS,
  LEGACY_TARGET_FROM_0814,
  LEGACY_TARGET_FROM_0810,
  LEGACY_TARGET_FROM_0815,
  LEGACY_TARGET_FROM_0816,
  LEGACY_TARGET_FROM_1224,
} = require("./fixtures/krx-calendar");

const ANALYSIS = { signals: [], rsi: 50, score: 50, atr: { pct: 0 } };
const ENTRY = 70000;
const TARGET_CLOSE = 71000;
const LATEST_CLOSE = 99999;
const BASE_NOW = "2026-08-14T15:40:00+09:00";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alpha-pred-"));
}

function closedCandle(tradingDate = BASE_DATE) {
  return { tradingDate, isFinal: true, marketSession: "CLOSED" };
}

function makeCalendar(days) {
  return createTradingCalendar(days || TRADING_DAYS_2026_08);
}

function makePredictor(store, calendar, now = BASE_NOW) {
  return createPredictor({
    store,
    calendar: calendar || createUnavailableCalendar(),
    nowFn: () => now,
  });
}

function predictShort(predictor, code, calendar, now = BASE_NOW) {
  return predictor.predict(code, ANALYSIS, ENTRY, {
    horizonType: "SHORT",
    horizonTradingDays: 5,
    calendar,
    now,
    candle: closedCandle(),
  });
}

function predictLegacy(predictor, code, calendar, extra = {}) {
  return predictor.predict(code, ANALYSIS, ENTRY, {
    now: extra.now || BASE_NOW,
    calendar,
    candle: extra.candle || closedCandle(extra.baseTradingDate || BASE_DATE),
    baseTradingDate: extra.baseTradingDate,
    ...extra,
  });
}

function targetCandles(extra = []) {
  return [
    { date: "20260828", close: LATEST_CLOSE, isFinal: true, marketSession: "CLOSED" },
    { date: "2026-08-24", close: TARGET_CLOSE, isFinal: true, marketSession: "CLOSED" },
    { date: "20260814", close: ENTRY, isFinal: true, marketSession: "CLOSED" },
    { date: "2026-08-21", close: TARGET_CLOSE, isFinal: true, marketSession: "CLOSED" },
    { date: "2026-08-18", close: TARGET_CLOSE, isFinal: true, marketSession: "CLOSED" },
    { date: "2027-01-04", close: TARGET_CLOSE, isFinal: true, marketSession: "CLOSED" },
    ...extra,
  ];
}

function featuresForEval() {
  return { bias: 1, rsi: 0 };
}

test("1. 신규 UUID 중복 없음", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  for (let i = 0; i < 40; i++) {
    const code = String(i + 1).padStart(6, "0");
    predictor.predict(code, ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  }
  const preds = store.listPredictions();
  assert.equal(preds.length, 40);
  const ids = preds.map((p) => p.predictionId);
  assert.equal(new Set(ids).size, 40);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(id, preds.find((p) => p.predictionId === id).id);
  }
});

test("2. 레거시 {code}-{date} 로그 읽기 (getPrediction)", () => {
  const legacy = {
    id: "005930-2026-08-14",
    code: "005930",
    date: "2026-08-14",
    entryPrice: ENTRY,
    features: { bias: 1 },
    probUp: 0.5,
    status: "pending",
  };
  const mem = createMemoryStore({ predictions: [legacy] });
  const got = mem.getPrediction("005930-2026-08-14");
  assert.ok(got);
  assert.equal(got.code, "005930");
  assert.equal(got.id, "005930-2026-08-14");
  assert.equal(got.entryPrice, ENTRY);

  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  fs.writeFileSync(predictionsPath, JSON.stringify([legacy], null, 2));
  const fileStore = createJsonFileStore({ predictionsPath, modelPath });
  const fromFile = fileStore.getPrediction("005930-2026-08-14");
  assert.equal(fromFile.id, "005930-2026-08-14");
  assert.equal(fromFile.code, "005930");
});

test("3. 레거시와 신규 성과 분리 (horizonCounts)", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  predictShort(predictor, "005930", calendar);
  const stats = predictor.getModelStats();
  assert.ok(stats.horizonCounts);
  assert.equal(stats.horizonCounts.LEGACY_7_CALENDAR_DAYS.total, 1);
  assert.equal(stats.horizonCounts.SHORT.total, 1);
  assert.equal(stats.horizonCounts.combined, undefined);
  assert.equal(stats.shortPlusLegacy, undefined);
  assert.equal(stats.combinedHorizon, undefined);
  assert.equal(stats.SHORT_PLUS_LEGACY, undefined);
  assert.ok("weights" in stats);
  assert.ok("trained" in stats);
  assert.ok("wins" in stats);
  assert.ok("losses" in stats);
  assert.ok("accuracy" in stats);
  assert.ok("pendingPredictions" in stats);
  assert.ok("recentResolved" in stats);
  assert.ok("lastHistoryTrain" in stats);
  assert.ok("updatedAt" in stats);
});

test("4. KRX 거래일: 2026-08-14 + 5 = 2026-08-24", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  const result = predictShort(predictor, "005930", calendar);
  const p = store.listPredictions()[0];
  assert.equal(p.targetTradingDate, HOLIDAY_AWARE_TARGET);
  assert.equal(p.horizonType, "SHORT");
  assert.equal(p.horizonTradingDays, 5);
  assert.equal(p.evaluationStatus, "PENDING");
  assert.deepEqual(p.missingData, []);
  assert.equal(result.candleFinality, "FINAL");
  assert.equal(result.finalitySource, "EXPLICIT_FINAL_FLAG");
  assert.equal(p.candleFinality, "FINAL");
  assert.equal(p.finalitySource, "EXPLICIT_FINAL_FLAG");
});

test("5. 휴장일 포함 (08-17). 주말만 제외한 2026-08-21이 아님", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const p = store.listPredictions()[0];
  assert.equal(p.targetTradingDate, HOLIDAY_AWARE_TARGET);
  assert.notEqual(p.targetTradingDate, WEEKEND_ONLY_WRONG_TARGET);
});

test("6. 캘린더 미확정 CALENDAR_PENDING", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, createUnavailableCalendar());
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    horizonType: "SHORT",
    horizonTradingDays: 5,
    candle: closedCandle(),
  });
  const p = store.listPredictions()[0];
  assert.equal(p.targetTradingDate, null);
  assert.equal(p.evaluationStatus, null);
  assert.equal(p.targetDateStatus, "CALENDAR_PENDING");
  assert.deepEqual(p.missingData, ["krxTradingCalendar"]);
});

test("7. 목표일 미도래 PENDING (asOf < target, 캔들에 목표봉 있어도)", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const result = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-20" });
  const p = store.listPredictions()[0];
  assert.equal(p.evaluationStatus, "PENDING");
  assert.equal(p.status, "pending");
  assert.equal(p.targetClose, null);
  assert.equal(result.processed, 0);
  assert.equal(result.pending, 1);
  assert.equal(predictor.getModelStats().wins, 0);
});

test("8. 목표일 종가로만 채점", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const result = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  const p = store.listPredictions()[0];
  assert.equal(result.processed, 1);
  assert.equal(p.evaluationStatus, "EVALUATED");
  assert.equal(p.status, "resolved");
  assert.equal(p.targetClose, TARGET_CLOSE);
  assert.equal(p.finalPrice, TARGET_CLOSE);
  assert.equal(p.actualDirection, "UP");
  assert.equal(p.actual, "UP");
  assert.equal(p.correct, true);
  assert.ok(p.evaluatedAt);
  assert.ok(p.resolvedAt);
});

test("9. 평가 실행일 최신 종가 사용 금지 (최신 99999 vs 목표일 71000)", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  await predictor.processMatured(async () => [
    { date: "2026-08-28", close: LATEST_CLOSE, isFinal: true, marketSession: "CLOSED" },
    { date: "20260824", close: TARGET_CLOSE, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2026-08-28" });
  const p = store.listPredictions()[0];
  assert.equal(p.targetClose, TARGET_CLOSE);
  assert.equal(p.finalPrice, TARGET_CLOSE);
  assert.notEqual(p.targetClose, LATEST_CLOSE);
  assert.notEqual(p.finalPrice, LATEST_CLOSE);
});

test("10. 중복 채점 방지 (2회 실행, wins +1만)", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const fetch = async () => targetCandles();
  const first = await predictor.processMatured(fetch, { asOf: "2026-08-24" });
  const winsAfterFirst = predictor.getModelStats().wins;
  const second = await predictor.processMatured(fetch, { asOf: "2026-08-24" });
  const stats = predictor.getModelStats();
  assert.equal(first.processed, 1);
  assert.equal(first.skippedEvaluated, 0);
  assert.equal(second.processed, 0);
  assert.equal(second.skippedEvaluated, 1);
  assert.equal(winsAfterFirst, 1);
  assert.equal(stats.wins, 1);
  assert.equal(stats.trained, 1);
});

test("11. 저장 실패 시 기존 파일 보존 (fsModule writeFileSync throw)", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  const original = [{ id: "keep-me", code: "005930", date: BASE_DATE, status: "pending" }];
  fs.writeFileSync(predictionsPath, JSON.stringify(original, null, 2));
  fs.writeFileSync(modelPath, JSON.stringify({ weights: { bias: 0 }, trained: 0, wins: 0, losses: 0 }, null, 2));

  const store = createJsonFileStore({
    predictionsPath,
    modelPath,
    fsModule: {
      writeFileSync() {
        throw new Error("disk full");
      },
    },
  });

  await assert.rejects(() => store.savePrediction({
    id: "new-one",
    predictionId: "new-one",
    code: "000660",
    date: BASE_DATE,
  }));

  const raw = fs.readFileSync(predictionsPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "keep-me");

  await assert.rejects(() => store.commitMaturedBatch(
    [{ id: "replaced" }],
    { weights: { bias: 1 }, trained: 9, wins: 9, losses: 0 },
  ));
  const afterCommit = JSON.parse(fs.readFileSync(predictionsPath, "utf8"));
  const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  assert.equal(afterCommit[0].id, "keep-me");
  assert.equal(model.trained, 0);
});

test("12. 동시 저장 안전성 (Promise.all 두 건 모두 남음)", async () => {
  const dir = tmpDir();
  const store = createJsonFileStore({
    predictionsPath: path.join(dir, "ai-predictions.json"),
    modelPath: path.join(dir, "ai-model.json"),
  });
  await Promise.all([
    store.savePrediction({ id: "rec-a", predictionId: "rec-a", code: "000001", date: BASE_DATE }),
    store.savePrediction({ id: "rec-b", predictionId: "rec-b", code: "000002", date: BASE_DATE }),
  ]);
  const all = store.listPredictions();
  assert.equal(all.length, 2);
  assert.ok(all.some((p) => p.id === "rec-a"));
  assert.ok(all.some((p) => p.id === "rec-b"));
});

test("13. 손상 JSON 처리 (덮어쓰지 않고 throw CorruptedJsonError)", () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  const garbage = "{not-json";
  fs.writeFileSync(predictionsPath, garbage);
  const store = createJsonFileStore({ predictionsPath, modelPath });
  assert.throws(() => store.listPredictions(), (err) => {
    assert.equal(err.name, "CorruptedJsonError");
    assert.ok(err instanceof CorruptedJsonError);
    return true;
  });
  assert.equal(fs.readFileSync(predictionsPath, "utf8"), garbage);

  fs.writeFileSync(predictionsPath, JSON.stringify({ not: "array" }));
  assert.throws(() => store.listPredictions(), CorruptedJsonError);
  assert.match(fs.readFileSync(predictionsPath, "utf8"), /not/);

  fs.writeFileSync(modelPath, "null");
  assert.throws(() => store.getModel(), CorruptedJsonError);
  assert.equal(fs.readFileSync(modelPath, "utf8"), "null");
});

test("14. processMatured의 fetchCandles는 mock. predictor.js 소스에 kb/broker, axios, kbsec 호스트 미사용", async () => {
  const src = fs.readFileSync(path.join(__dirname, "../predictor.js"), "utf8");
  assert.equal(src.includes("kb/broker"), false);
  assert.equal(src.includes("axios"), false);
  assert.equal(src.toLowerCase().includes("kbsec"), false);

  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  let calls = 0;
  await predictor.processMatured(async (code, n) => {
    calls += 1;
    assert.equal(code, "005930");
    assert.equal(n, 30);
    return targetCandles();
  }, { asOf: "2026-08-24" });
  assert.equal(calls, 1);
  assert.equal(store.listPredictions()[0].evaluationStatus, "EVALUATED");
});

test("15. LEGACY+캘린더 → target 2026-08-21 PENDING. 5거래일 08-24 아님", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, calendar, candle: closedCandle() });
  const p = store.listPredictions()[0];
  assert.equal(p.horizonType, "LEGACY_7_CALENDAR_DAYS");
  assert.equal(p.horizonTradingDays, null);
  assert.equal(p.targetTradingDate, LEGACY_TARGET_FROM_0814);
  assert.notEqual(p.targetTradingDate, HOLIDAY_AWARE_TARGET);
  assert.equal(p.evaluationStatus, "PENDING");
});

test("16. 같은 symbol+date+horizonType 중복 저장 안 함, 다른 horizonType은 저장", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  const first = predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  const second = predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  predictShort(predictor, "005930", calendar);
  const preds = store.listPredictions();
  assert.equal(preds.length, 2);
  assert.equal(preds.filter((p) => p.horizonType === "LEGACY_7_CALENDAR_DAYS").length, 1);
  assert.equal(preds.filter((p) => p.horizonType === "SHORT").length, 1);
  assert.equal(first.direction, second.direction);
  const legacy = preds.find((p) => p.horizonType === "LEGACY_7_CALENDAR_DAYS");
  assert.ok(legacy.predictionId);
  assert.equal(legacy.code, "005930");
});

test("17. 목표일 봉 없으면 PENDING", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const result = await predictor.processMatured(async () => [
    { date: "20260814", close: ENTRY, isFinal: true, marketSession: "CLOSED" },
    { date: "20260828", close: 72000, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2026-08-28" });
  const p = store.listPredictions()[0];
  assert.equal(result.processed, 0);
  assert.equal(result.pending, 1);
  assert.equal(p.evaluationStatus, "PENDING");
  assert.equal(p.status, "pending");
  assert.equal(p.targetClose, null);
  assert.equal(predictor.getModelStats().wins, 0);
});

test("18. 기본 export predict/processMatured/getModelStats/buildFeatures/trainFromHistory 존재", () => {
  assert.equal(typeof predict, "function");
  assert.equal(typeof processMatured, "function");
  assert.equal(typeof getModelStats, "function");
  assert.equal(typeof buildFeatures, "function");
  assert.equal(typeof trainFromHistory, "function");
  assert.equal(typeof createPredictor, "function");
  assert.equal(UNSPECIFIED_MODEL_VERSION, "unspecified");
  assert.equal(UNSPECIFIED_FEATURE_VERSION, "unspecified");
  assert.equal(MODEL_VERSION, "predictor-legacy-v1");
  assert.equal(FEATURE_VERSION, "features-v1");
  const features = buildFeatures(ANALYSIS, ENTRY);
  assert.equal(features.bias, 1);
  assert.equal(features.rsi, 0);
});

test("19. 레거시 로그 CALENDAR_PENDING persist, 모델 파일 미생성", async () => {
  const legacy = {
    id: "005930-2026-08-14",
    code: "005930",
    date: "2026-08-14",
    entryPrice: ENTRY,
    features: { bias: 1 },
    probUp: 0.5,
    status: "pending",
  };

  const mem = createMemoryStore({ predictions: [legacy] });
  const memPredictor = makePredictor(mem);
  const memResult = await memPredictor.processMatured(async () => targetCandles());
  const memPred = mem.listPredictions()[0];
  assert.equal(memResult.processed, 0);
  assert.equal(memPred.evaluationStatus, "CALENDAR_PENDING");
  assert.ok(Array.isArray(memPred.missingData));
  assert.ok(memPred.missingData.includes("krxTradingCalendar"));
  assert.equal(memPred.targetTradingDate, null);
  assert.equal(memPred.id, "005930-2026-08-14");
  assert.equal(memPred.code, "005930");
  assert.equal(memPred.date, "2026-08-14");
  assert.deepEqual(memPred.features, { bias: 1 });
  assert.equal(memPred.entryPrice, ENTRY);
  assert.equal(memPred.probUp, 0.5);
  assert.equal(memPred.status, "pending");
  assert.equal(memPred.targetClose, undefined);
  assert.equal(memPredictor.getModelStats().wins, 0);

  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  fs.writeFileSync(predictionsPath, JSON.stringify([legacy], null, 2));
  assert.equal(fs.existsSync(modelPath), false);

  const fileStore = createJsonFileStore({ predictionsPath, modelPath });
  const filePredictor = makePredictor(fileStore);
  const fileResult = await filePredictor.processMatured(async () => targetCandles());
  const filePred = fileStore.listPredictions()[0];
  assert.equal(fileResult.processed, 0);
  assert.equal(filePred.evaluationStatus, "CALENDAR_PENDING");
  assert.ok(Array.isArray(filePred.missingData));
  assert.ok(filePred.missingData.includes("krxTradingCalendar"));
  assert.equal(filePred.targetTradingDate, null);
  assert.equal(filePred.id, "005930-2026-08-14");
  assert.equal(filePred.code, "005930");
  assert.equal(filePred.date, "2026-08-14");
  assert.deepEqual(filePred.features, { bias: 1 });
  assert.equal(filePred.entryPrice, ENTRY);
  assert.equal(filePred.probUp, 0.5);
  assert.equal(filePred.status, "pending");
  assert.equal(filePred.targetClose, undefined);
  assert.equal(filePredictor.getModelStats().wins, 0);

  const persisted = JSON.parse(fs.readFileSync(predictionsPath, "utf8"));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].evaluationStatus, "CALENDAR_PENDING");
  assert.ok(persisted[0].missingData.includes("krxTradingCalendar"));
  assert.equal(persisted[0].targetTradingDate, null);
  assert.equal(persisted[0].id, "005930-2026-08-14");
  assert.equal(persisted[0].code, "005930");
  assert.equal(persisted[0].date, "2026-08-14");
  assert.deepEqual(persisted[0].features, { bias: 1 });
  assert.equal(persisted[0].entryPrice, ENTRY);
  assert.equal(persisted[0].probUp, 0.5);
  assert.equal(persisted[0].status, "pending");
  assert.equal("targetClose" in persisted[0], false);
  assert.equal(fs.existsSync(modelPath), false);
});

test("20. 같은 6필드 중복 차단", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  assert.equal(store.listPredictions().length, 1);
});

test("21. 다른 modelVersion 별도 저장", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle(), modelVersion: "v-a" });
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle(), modelVersion: "v-b" });
  assert.equal(store.listPredictions().length, 2);
});

test("22. 다른 featureVersion 별도 저장", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle(), featureVersion: "f-a" });
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle(), featureVersion: "f-b" });
  assert.equal(store.listPredictions().length, 2);
});

test("23. 다른 horizonTradingDays 별도 저장", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW, candle: closedCandle(), calendar, horizonType: "SHORT", horizonTradingDays: 5,
  });
  predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW, candle: closedCandle(), calendar, horizonType: "SHORT", horizonTradingDays: 1,
  });
  assert.equal(store.listPredictions().length, 2);
});

test("24. unspecified ≠ predictor-legacy-v1 구 로그 공존", () => {
  const old = {
    id: "old",
    predictionId: "old",
    code: "005930",
    symbol: "005930",
    date: BASE_DATE,
    baseTradingDate: BASE_DATE,
    horizonType: "LEGACY_7_CALENDAR_DAYS",
    horizonTradingDays: null,
    status: "pending",
    entryPrice: ENTRY,
    features: { bias: 1 },
  };
  const store = createMemoryStore({ predictions: [old] });
  const predictor = makePredictor(store, makeCalendar());
  predictor.predict("005930", ANALYSIS, ENTRY, { now: BASE_NOW, candle: closedCandle() });
  const preds = store.listPredictions();
  assert.equal(preds.length, 2);
  assert.equal(preds.find((p) => p.id === "old").modelVersion, undefined);
  assert.equal(preds.find((p) => p.id !== "old").modelVersion, MODEL_VERSION);
});

test("25. INVALID_BASE_TRADING_DATE 저장 안 함", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  const r = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    candle: closedCandle("2026-08-18"),
  });
  assert.equal(r.recordError, "INVALID_BASE_TRADING_DATE");
  assert.ok(typeof r.probUp === "number");
  assert.equal(store.listPredictions().length, 0);
});

test("26. INVALID_DATE_FORMAT 저장 안 함", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  const r = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    baseTradingDate: "2026-02-30",
    candle: { tradingDate: "2026-02-30", isFinal: true, marketSession: "CLOSED" },
  });
  assert.equal(r.recordError, "INVALID_DATE_FORMAT");
  assert.equal(store.listPredictions().length, 0);
});

test("27. INVALID_HORIZON 저장 안 함", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  const r = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    candle: closedCandle(),
    horizonType: "SHORT",
    horizonTradingDays: 0,
  });
  assert.equal(r.recordError, "INVALID_HORIZON");
  assert.equal(store.listPredictions().length, 0);
});

test("28. CANDLE_NOT_FINAL isFinal false / OPEN", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  const a = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    candle: { tradingDate: BASE_DATE, isFinal: false, marketSession: "CLOSED" },
  });
  const b = predictor.predict("000660", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    candle: { tradingDate: BASE_DATE, isFinal: true, marketSession: "OPEN" },
  });
  assert.equal(a.recordError, "CANDLE_NOT_FINAL");
  assert.equal(b.recordError, "CANDLE_NOT_FINAL");
  assert.equal(store.listPredictions().length, 0);
});

test("29. INVALID_TARGET_TRADING_DATE 채점 안 함", async () => {
  const store = createMemoryStore({
    predictions: [{
      id: "bad-target",
      predictionId: "bad-target",
      code: "005930",
      symbol: "005930",
      date: BASE_DATE,
      baseTradingDate: BASE_DATE,
      baseClose: ENTRY,
      entryPrice: ENTRY,
      features: featuresForEval(),
      horizonType: "SHORT",
      horizonTradingDays: 5,
      targetTradingDate: "2026-08-14",
      evaluationStatus: "PENDING",
      status: "pending",
    }],
  });
  const predictor = makePredictor(store, makeCalendar());
  const result = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  const p = store.listPredictions()[0];
  assert.equal(result.processed, 0);
  assert.equal(p.evaluationStatus, "PENDING");
  assert.equal(p.targetClose, undefined);
  assert.equal(p.recordError, "INVALID_TARGET_TRADING_DATE");
});

test("30. 레거시 목표일 정상 거래일 08-14 → 08-21", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictLegacy(predictor, "005930", calendar);
  assert.equal(store.listPredictions()[0].targetTradingDate, LEGACY_TARGET_FROM_0814);
});

test("31. 레거시 목표일 공휴일 08-10 → 08-18", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictLegacy(predictor, "005930", calendar, {
    baseTradingDate: "2026-08-10",
    candle: closedCandle("2026-08-10"),
  });
  assert.equal(store.listPredictions()[0].targetTradingDate, LEGACY_TARGET_FROM_0810);
});

test("32. 레거시 목표일 토요일 08-15 → 08-24", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar, "2026-08-15T15:40:00+09:00");
  predictLegacy(predictor, "005930", calendar, {
    now: "2026-08-15T15:40:00+09:00",
    baseTradingDate: "2026-08-15",
    candle: closedCandle("2026-08-15"),
  });
  assert.equal(store.listPredictions()[0].targetTradingDate, LEGACY_TARGET_FROM_0815);
});

test("33. 레거시 목표일 일요일 08-16 → 08-24", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar, "2026-08-16T15:40:00+09:00");
  predictLegacy(predictor, "005930", calendar, {
    now: "2026-08-16T15:40:00+09:00",
    baseTradingDate: "2026-08-16",
    candle: closedCandle("2026-08-16"),
  });
  assert.equal(store.listPredictions()[0].targetTradingDate, LEGACY_TARGET_FROM_0816);
});

test("34. 레거시 목표일 연말 12-24 → 2027-01-04", () => {
  const store = createMemoryStore();
  const calendar = makeCalendar(COMBINED_TRADING_DAYS);
  const predictor = makePredictor(store, calendar, "2026-12-24T15:40:00+09:00");
  predictLegacy(predictor, "005930", calendar, {
    now: "2026-12-24T15:40:00+09:00",
    baseTradingDate: "2026-12-24",
    candle: closedCandle("2026-12-24"),
  });
  assert.equal(store.listPredictions()[0].targetTradingDate, LEGACY_TARGET_FROM_1224);
});

test("35. 레거시 캘린더 없음 CALENDAR_PENDING", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, createUnavailableCalendar());
  predictLegacy(predictor, "005930", createUnavailableCalendar());
  const p = store.listPredictions()[0];
  assert.equal(p.targetTradingDate, null);
  assert.equal(p.evaluationStatus, null);
  assert.equal(p.targetDateStatus, "CALENDAR_PENDING");
});

test("36. 레거시 목표일 종가 없으면 PENDING", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictLegacy(predictor, "005930", calendar);
  const result = await predictor.processMatured(async () => [
    { date: "2026-08-14", close: ENTRY, isFinal: true, marketSession: "CLOSED" },
  ], { asOf: "2026-08-28" });
  assert.equal(result.processed, 0);
  assert.equal(result.pending, 1);
  assert.equal(store.listPredictions()[0].evaluationStatus, "PENDING");
  assert.equal(predictor.getModelStats().wins, 0);
});

test("37. 모델 실패 → 가격 유지 MODEL_UPDATE_PENDING", async () => {
  const store = createMemoryStore({ failNextModelWrite: true });
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const result = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  const p = store.listPredictions()[0];
  assert.equal(result.modelSaveFailed, true);
  assert.equal(result.processed, 0);
  assert.equal(p.evaluationStatus, "MODEL_UPDATE_PENDING");
  assert.equal(p.targetClose, TARGET_CLOSE);
  assert.equal(p.finalPrice, TARGET_CLOSE);
  assert.equal(predictor.getModelStats().wins, 0);
});

test("38. 모델 성공 후 최종 예측 커밋 실패 → 재실행 SGD 없이 EVALUATED", async () => {
  const store = createMemoryStore({ failOnWrite: { predictions: 3 } });
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const first = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  const mid = store.listPredictions()[0];
  assert.equal(mid.evaluationStatus, "MODEL_UPDATE_PENDING");
  assert.equal(mid.targetClose, TARGET_CLOSE);
  assert.equal(first.processed, 0);
  const wins = predictor.getModelStats().wins;
  assert.equal(wins, 1);
  const second = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  const p = store.listPredictions()[0];
  assert.equal(p.evaluationStatus, "EVALUATED");
  assert.equal(second.processed, 1);
  assert.equal(predictor.getModelStats().wins, 1);
  assert.equal(predictor.getModelStats().trained, 1);
});

test("39. 두 번 평가 wins+1", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  assert.equal(predictor.getModelStats().wins, 1);
});

test("40. 재시작 후 MODEL_UPDATE_PENDING 복구", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "p.json");
  const modelPath = path.join(dir, "m.json");
  const store1 = createJsonFileStore({
    predictionsPath,
    modelPath,
    failOnWrite: { predictions: 3 },
  });
  const calendar = makeCalendar();
  const predictor1 = makePredictor(store1, calendar);
  predictShort(predictor1, "005930", calendar);
  await predictor1.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  assert.equal(store1.listPredictions()[0].evaluationStatus, "MODEL_UPDATE_PENDING");

  const store2 = createJsonFileStore({ predictionsPath, modelPath });
  const predictor2 = makePredictor(store2, calendar);
  const result = await predictor2.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  assert.equal(store2.listPredictions()[0].evaluationStatus, "EVALUATED");
  assert.equal(result.processed, 1);
  assert.equal(predictor2.getModelStats().wins, 1);
  assert.equal(predictor2.getModelStats().trained, 1);
});

test("41. 복구 중 다시 실패", async () => {
  const store = createMemoryStore({ failOnWrite: { model: 1 } });
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const first = await predictor.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  assert.equal(first.modelSaveFailed, true);
  assert.equal(store.listPredictions()[0].evaluationStatus, "MODEL_UPDATE_PENDING");
  const store2 = createMemoryStore({
    predictions: store.listPredictions(),
    model: store.getModel(),
    failNextModelWrite: true,
  });
  const predictor2 = makePredictor(store2, calendar);
  const second = await predictor2.processMatured(async () => targetCandles(), { asOf: "2026-08-24" });
  assert.equal(second.modelSaveFailed, true);
  assert.equal(store2.listPredictions()[0].evaluationStatus, "MODEL_UPDATE_PENDING");
  assert.equal(store2.listPredictions()[0].targetClose, TARGET_CLOSE);
});

test("42. 두 processMatured 동시 wins 1번", async () => {
  const store = createMemoryStore();
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  predictShort(predictor, "005930", calendar);
  const fetch = async () => targetCandles();
  const [a, b] = await Promise.all([
    predictor.processMatured(fetch, { asOf: "2026-08-24" }),
    predictor.processMatured(fetch, { asOf: "2026-08-24" }),
  ]);
  assert.equal(predictor.getModelStats().wins, 1);
  assert.equal(predictor.getModelStats().trained, 1);
  assert.equal(a.processed + b.processed, 1);
});

test("43. 기본 predict 당일 isFinal 없으면 로그 없음", () => {
  const store = createMemoryStore();
  const predictor = makePredictor(store, makeCalendar());
  const result = predictor.predict("005930", ANALYSIS, ENTRY);
  assert.ok(typeof result.probUp === "number");
  assert.equal(store.listPredictions().length, 0);
  assert.equal(result.recordError, "CANDLE_NOT_FINAL");
  assert.equal(result.candleFinality, "UNKNOWN");
  assert.equal(result.finalitySource, "UNKNOWN");
});
test("장중 OPEN 당일 15:39 — 로그 없음 CANDLE_NOT_FINAL", () => {
  const store = createMemoryStore();
  const now = new Date("2026-08-14T15:39:00+09:00");
  const predictor = makePredictor(store, makeCalendar(), now);
  const opts = buildPredictOptsFromCandles(
    [{ date: "2026-08-14", close: ENTRY }],
    now,
  );
  const result = predictor.predict("005930", ANALYSIS, ENTRY, opts);
  assert.equal(opts.candle.isFinal, false);
  assert.equal(opts.candle.marketSession, "OPEN");
  assert.equal(opts.candleFinality, "NOT_FINAL");
  assert.equal(opts.finalitySource, "TIME_HEURISTIC");
  assert.equal(result.recordError, "CANDLE_NOT_FINAL");
  assert.equal(typeof result.probUp, "number");
  assert.equal(typeof result.probDown, "number");
  assert.equal(store.listPredictions().length, 0);
  assert.equal(result.candleFinality, "NOT_FINAL");
  assert.equal(result.finalitySource, "TIME_HEURISTIC");
  assert.equal(result.candleTradingDate, "2026-08-14");
});

test("과거 봉 2026-08-13, now 2026-08-14 10:00 — 로그 저장", () => {
  const store = createMemoryStore();
  const now = new Date("2026-08-14T10:00:00+09:00");
  const predictor = makePredictor(store, makeCalendar(), now);
  const opts = buildPredictOptsFromCandles(
    [{ date: "2026-08-13", close: ENTRY }],
    now,
  );
  const result = predictor.predict("005930", ANALYSIS, ENTRY, opts);
  assert.equal(opts.candle.isFinal, true);
  assert.equal(opts.candle.marketSession, "CLOSED");
  assert.equal(opts.candleFinality, "FINAL");
  assert.equal(opts.finalitySource, "HISTORICAL_DATE");
  assert.equal(opts.candleTradingDate, "2026-08-13");
  assert.equal(result.recordError, null);
  assert.equal(store.listPredictions().length, 1);
  assert.equal(store.listPredictions()[0].baseTradingDate, "2026-08-13");
  assert.equal(result.candleFinality, "FINAL");
  assert.equal(result.finalitySource, "HISTORICAL_DATE");
  assert.equal(result.candleTradingDate, "2026-08-13");
  const rec = store.listPredictions()[0];
  assert.equal(rec.candleFinality, "FINAL");
  assert.equal(rec.finalitySource, "HISTORICAL_DATE");
  assert.equal(rec.candleTradingDate, "2026-08-13");
  assert.ok(rec.dataAsOf);
});

test("당일 15:40 이후 CLOSED — 로그 저장", () => {
  const store = createMemoryStore();
  const now = new Date("2026-08-14T15:40:00+09:00");
  const predictor = makePredictor(store, makeCalendar(), now);
  const opts = buildPredictOptsFromCandles(
    [{ date: "2026-08-14", close: ENTRY }],
    now,
  );
  const result = predictor.predict("005930", ANALYSIS, ENTRY, opts);
  assert.equal(opts.candle.isFinal, true);
  assert.equal(opts.candle.marketSession, "CLOSED");
  assert.equal(opts.candleFinality, "FINAL");
  assert.equal(opts.finalitySource, "TIME_HEURISTIC");
  assert.equal(result.recordError, null);
  assert.equal(store.listPredictions().length, 1);
  assert.equal(result.candleFinality, "FINAL");
  assert.equal(result.finalitySource, "TIME_HEURISTIC");
  const rec = store.listPredictions()[0];
  assert.equal(rec.candleFinality, "FINAL");
  assert.equal(rec.finalitySource, "TIME_HEURISTIC");
  assert.equal(rec.candleTradingDate, "2026-08-14");
});

test("불명확 봉 (빈 배열 / 파싱 실패) — CANDLE_NOT_FINAL", () => {
  const store = createMemoryStore();
  const now = new Date(BASE_NOW);
  const predictor = makePredictor(store, makeCalendar(), now);
  const empty = buildPredictOptsFromCandles([], now);
  const a = predictor.predict("005930", ANALYSIS, ENTRY, empty);
  assert.equal(empty.candleFinality, "UNKNOWN");
  assert.equal(empty.finalitySource, "UNKNOWN");
  assert.equal(a.recordError, "CANDLE_NOT_FINAL");
  assert.equal(typeof a.probUp, "number");
  assert.equal(a.candleFinality, "UNKNOWN");
  assert.equal(a.finalitySource, "UNKNOWN");
  const bad = buildPredictOptsFromCandles([{ date: "not-a-date" }], now);
  const b = predictor.predict("000660", ANALYSIS, ENTRY, bad);
  assert.equal(bad.candleFinality, "UNKNOWN");
  assert.equal(bad.finalitySource, "UNKNOWN");
  assert.equal(b.recordError, "CANDLE_NOT_FINAL");
  assert.equal(b.candleFinality, "UNKNOWN");
  assert.equal(b.finalitySource, "UNKNOWN");
  const invalid = buildPredictOptsFromCandles([{ date: "2026-02-30" }], now);
  const c = predictor.predict("000270", ANALYSIS, ENTRY, invalid);
  assert.equal(invalid.candleFinality, "UNKNOWN");
  assert.equal(invalid.finalitySource, "UNKNOWN");
  assert.equal(c.recordError, "CANDLE_NOT_FINAL");
  assert.equal(store.listPredictions().length, 0);
});

test("STORE_BUSY 살아 있는 lock — 확률 반환, 로그 없음, throw 없음", () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  const lockPath = `${predictionsPath}.lock`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    operationId: "live-lock",
  }));
  const store = createJsonFileStore({ predictionsPath, modelPath });
  const calendar = makeCalendar();
  const predictor = makePredictor(store, calendar);
  const result = predictor.predict("005930", ANALYSIS, ENTRY, {
    now: BASE_NOW,
    candle: closedCandle(),
    calendar,
  });
  assert.equal(result.recordError, "STORE_BUSY");
  assert.equal(typeof result.probUp, "number");
  assert.equal(typeof result.probDown, "number");
  assert.equal(store.listPredictions().length, 0);
});
