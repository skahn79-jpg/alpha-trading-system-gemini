/**
 * ALPHA TRADING SYSTEM - AI 자동 학습 상승/하락 예측기
 *
 * 온라인 로지스틱 회귀(SGD):
 *  1) /api/ai/predict 호출 시 기술 지표 피처로 상승 확률 계산 + 예측 기록
 *  2) 예측이 만기되면 targetTradingDate의 확정 종가로 정답(상승/하락)을 매김
 *  3) 오차만큼 가중치를 자동 업데이트 → 호출이 쌓일수록 예측 정확도 개선
 *
 * 상태 파일: data/ai-model.json (가중치·성적), data/ai-predictions.json (예측 로그)
 * I/O는 StoragePort만 사용한다. 손상 JSON을 빈 배열로 덮어쓰지 않는다.
 * 주의: Render 무료 디스크는 재배포 시 초기화됨 — 모델은 런타임 동안 누적 학습.
 */

"use strict";

const crypto = require("crypto");
const path = require("path");
const { createJsonFileStore, StoreLockError } = require("./lib/storage");
const { formatKstDate, formatKstDateTimeIso } = require("./lib/calendar/kst");
const {
  parseTradingDate,
  normalizeTradingDate,
  resolveLegacyTarget,
  createUnavailableCalendar,
} = require("./lib/calendar/krx-calendar");

const HORIZON_DAYS = 7; // 달력일 기준 만기 (레거시 LEGACY_7_CALENDAR_DAYS)
const LEARNING_RATE = 0.05;
const MODEL_VERSION = "predictor-legacy-v1";
const FEATURE_VERSION = "features-v1";
const UNSPECIFIED_MODEL_VERSION = "unspecified";
const UNSPECIFIED_FEATURE_VERSION = "unspecified";
const LEGACY_HORIZON = "LEGACY_7_CALENDAR_DAYS";

const INVALID_BASE_TRADING_DATE = "INVALID_BASE_TRADING_DATE";
const INVALID_TARGET_TRADING_DATE = "INVALID_TARGET_TRADING_DATE";
const INVALID_HORIZON = "INVALID_HORIZON";
const INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT";
const CANDLE_NOT_FINAL = "CANDLE_NOT_FINAL";
const CALENDAR_PENDING_CODE = "CALENDAR_PENDING";

// 도메인 지식 기반 초기 가중치 (학습이 쌓이면 자동 보정됨)
const DEFAULT_WEIGHTS = {
  bias: 0,
  rsi: -0.3,          // RSI 높음(과매수) → 하락 방향
  bbPos: -0.2,
  dist20: -0.25,      // 20일선 과이격 → 되돌림
  dist60: -0.2,
  volRatio: 0.15,
  macdHist: 0.35,
  macdCross: 0.4,
  stochK: -0.2,
  alignment: 0.35,
  aboveMa20: 0.25,
  patternScore: 0.3,
  w52Pos: 0.1,
  nearSupport: 0.25,
  nearResistance: -0.25,
  ichimokuCloud: 0.3,
  adxTrend: 0.3,
  obvTrend: 0.25,
  atrPct: -0.1,
  supertrendDir: 0.35,
  stochSlowWell: 0.3,
  vixFixSpike: 0.25,
  mfiNorm: -0.2,
  mayerDev: -0.2,
  minerviniScore: 0.3,
  divergenceSig: 0.45,
  heatmapPaint: 0.3,
  painBottomDiv: 0.3,
  bbpZone: 0.25,
};

const FEATURE_LABELS = {
  rsi: "RSI",
  bbPos: "볼린저 위치",
  dist20: "20일선 이격",
  dist60: "60일선 이격",
  volRatio: "거래량 비율",
  macdHist: "MACD 히스토그램",
  macdCross: "MACD 교차",
  stochK: "스토캐스틱",
  alignment: "이동평균 정배열",
  aboveMa20: "20일선 상단",
  patternScore: "캔들 패턴",
  w52Pos: "52주 위치",
  nearSupport: "지지선 근접",
  nearResistance: "저항선 근접",
  ichimokuCloud: "일목 구름대",
  adxTrend: "ADX 추세",
  obvTrend: "OBV 자금 흐름",
  atrPct: "변동성(ATR)",
  supertrendDir: "SuperTrend",
  stochSlowWell: "스토캐스틱 슬로우 우물",
  vixFixSpike: "VixFix 공포 스파이크",
  mfiNorm: "MFI 자금흐름",
  mayerDev: "200일선 배율",
  minerviniScore: "미너비니 템플릿",
  divergenceSig: "다이버전스",
  heatmapPaint: "히트맵 도배",
  painBottomDiv: "고통지수 바닥",
  bbpZone: "파동 위치(BBP)",
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

/** analyzeCandles 결과 + 현재가로 정규화 피처 벡터 생성 */
function buildFeatures(analysis = {}, close = 0) {
  const rsi = Number.isFinite(analysis.rsi) ? analysis.rsi : 50;
  const bbPos = analysis.bollinger?.position ?? 50;
  const dist20 = analysis.distance?.ma20 ?? 0;
  const dist60 = analysis.distance?.ma60 ?? 0;
  const volRatio = analysis.volume?.ratio ?? 1;
  const macdHistRaw = analysis.macd?.histogram ?? 0;
  const macdCross = analysis.macd?.cross === "golden" ? 1 : analysis.macd?.cross === "dead" ? -1 : 0;
  const stochK = analysis.stochastic?.k ?? 50;
  const alignment = (analysis.signals || []).some((s) => s.includes("정배열")) ? 1 : 0;
  const aboveMa20 = (analysis.signals || []).some((s) => s.includes("20일선 상단")) ? 1
    : (analysis.signals || []).some((s) => s.includes("20일선 하단")) ? -1 : 0;
  const patterns = Array.isArray(analysis.patterns) ? analysis.patterns : [];
  const patternScore = clamp(
    patterns.reduce((a, p) => a + (p.type === "bullish" ? 1 : p.type === "bearish" ? -1 : 0), 0),
    -2, 2,
  );
  const w52Pos = analysis.week52?.position ?? 50;
  const sr = analysis.supportResistance || {};
  const nearSupport = sr.supportDist !== null && sr.supportDist !== undefined && sr.supportDist <= 3 ? 1 : 0;
  const nearResistance = sr.resistanceDist !== null && sr.resistanceDist !== undefined && sr.resistanceDist <= 3 ? 1 : 0;
  const ichimokuCloud = analysis.ichimoku?.status === "above_cloud" ? 1
    : analysis.ichimoku?.status === "below_cloud" ? -1 : 0;
  const adxDir = analysis.adx?.direction === "up" ? 1 : analysis.adx?.direction === "down" ? -1 : 0;
  const adxTrend = adxDir * clamp((analysis.adx?.adx ?? 0) / 40, 0, 1);
  const obvTrend = analysis.obv?.trend === "rising" ? 1 : analysis.obv?.trend === "falling" ? -1 : 0;
  const atrPct = clamp((analysis.atr?.pct ?? 2) / 5, 0, 2);
  const supertrendDir = analysis.supertrend?.direction === "up" ? 1
    : analysis.supertrend?.direction === "down" ? -1 : 0;
  const stochSlowWell = analysis.stochasticSlow?.inWell ? 1 : 0;
  const vixFixSpike = analysis.vixFix?.spike ? 1 : 0;
  const mfiNorm = ((analysis.mfi?.value ?? 50) - 50) / 50;
  const mayerDev = clamp((analysis.mayer?.multiple ?? 1) - 1, -1, 1.5);
  const minerviniScore = ((analysis.minervini?.passed ?? 4) - 4) / 4;
  const divergenceSig = analysis.divergence?.bullish ? 1 : analysis.divergence?.bearish ? -1 : 0;
  const heatmapPaint = analysis.stochHeatmap?.zone === "bottom_paint" ? 1
    : analysis.stochHeatmap?.zone === "top_paint" ? -1 : 0;
  const painBottomDiv = analysis.painMeter?.bullDiv ? 1 : 0;
  const bbpZone = analysis.bullBearPower?.zone === "wave_bottom" ? 1
    : analysis.bullBearPower?.zone === "wave_top" ? -1 : 0;

  return {
    bias: 1,
    rsi: (rsi - 50) / 50,
    bbPos: ((bbPos ?? 50) - 50) / 50,
    dist20: clamp((dist20 ?? 0) / 10, -2, 2),
    dist60: clamp((dist60 ?? 0) / 20, -2, 2),
    volRatio: clamp((volRatio ?? 1) - 1, -1, 3),
    macdHist: close > 0 ? clamp((macdHistRaw / close) * 100, -2, 2) : 0,
    macdCross,
    stochK: ((stochK ?? 50) - 50) / 50,
    alignment,
    aboveMa20,
    patternScore,
    w52Pos: ((w52Pos ?? 50) - 50) / 50,
    nearSupport,
    nearResistance,
    ichimokuCloud,
    adxTrend,
    obvTrend,
    atrPct,
    supertrendDir,
    stochSlowWell,
    vixFixSpike,
    mfiNorm,
    mayerDev,
    minerviniScore,
    divergenceSig,
    heatmapPaint,
    painBottomDiv,
    bbpZone,
  };
}

function predictProb(features, weights) {
  let z = 0;
  for (const [key, x] of Object.entries(features)) {
    z += (weights[key] ?? 0) * x;
  }
  return sigmoid(z);
}

function resolveNowValue(optsNow, nowFn) {
  return optsNow !== undefined && optsNow !== null ? optsNow : nowFn();
}

function recordHorizonType(p) {
  return p.horizonType || LEGACY_HORIZON;
}

function recordSymbol(p) {
  return p.symbol || p.code;
}

function recordBaseDate(p) {
  return p.baseTradingDate || p.date;
}

function recordHorizonDays(p) {
  return p.horizonTradingDays == null ? null : p.horizonTradingDays;
}

function recordModelVersion(p) {
  return p.modelVersion || UNSPECIFIED_MODEL_VERSION;
}

function recordFeatureVersion(p) {
  return p.featureVersion || UNSPECIFIED_FEATURE_VERSION;
}

function isSettled(p) {
  return p.evaluationStatus === "EVALUATED" || p.status === "resolved";
}

function missingDataEquals(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

function mergeMissing(base, extra) {
  const out = Array.isArray(base) ? [...base] : [];
  for (const item of extra || []) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

const FORBIDDEN_NEW_EVALUATION_STATUS = new Set([
  "CALENDAR_PENDING",
  "CALENDAR_RANGE_INSUFFICIENT",
  "CALENDAR_SOURCE_CONFLICT",
  "TARGET_DATE_CONFIRMED",
]);

function isLegacyRecord(p) {
  return p == null || p.targetDateStatus == null || p.targetDateStatus === "";
}

function sanitizeNewEvaluationStatus(evaluationStatus, targetDateStatus, targetClose) {
  if (FORBIDDEN_NEW_EVALUATION_STATUS.has(evaluationStatus)) return null;
  if (targetDateStatus !== "CONFIRMED") return null;
  if (
    (evaluationStatus === "PENDING"
      || evaluationStatus === "MODEL_UPDATE_PENDING"
      || evaluationStatus === "EVALUATED")
    && targetDateStatus !== "CONFIRMED"
  ) {
    return null;
  }
  if (
    (evaluationStatus === "MODEL_UPDATE_PENDING" || evaluationStatus === "EVALUATED")
    && targetClose == null
  ) {
    return null;
  }
  return evaluationStatus;
}

function enforceConfirmedIffTarget(targetTradingDate, targetDateStatus) {
  if (targetTradingDate != null) return "CONFIRMED";
  if (targetDateStatus === "CONFIRMED") return "CALENDAR_PENDING";
  return targetDateStatus;
}

/** 식별·피처 필드는 유지하고 캘린더 미확정 상태만 채운다. 실제로 바뀌면 true. */
function annotateCalendarPending(p, nextTargetDateStatus) {
  const legacy = isLegacyRecord(p);
  const prevStatus = p.evaluationStatus;
  const prevTarget = p.targetTradingDate;
  const prevMissing = p.missingData;
  const prevTargetDateStatus = p.targetDateStatus;
  p.targetTradingDate = null;
  p.missingData = mergeMissing(p.missingData, ["krxTradingCalendar"]);
  if (legacy) {
    p.evaluationStatus = "CALENDAR_PENDING";
  } else {
    p.evaluationStatus = null;
    if (nextTargetDateStatus != null && nextTargetDateStatus !== "") {
      p.targetDateStatus = nextTargetDateStatus;
    } else if (prevTargetDateStatus === "CONFIRMED") {
      p.targetDateStatus = "CALENDAR_PENDING";
    }
  }
  return prevStatus !== p.evaluationStatus
    || prevTarget !== p.targetTradingDate
    || !missingDataEquals(prevMissing, p.missingData)
    || prevTargetDateStatus !== p.targetDateStatus;
}

function assignIfChanged(obj, key, value) {
  if (obj[key] !== value) {
    obj[key] = value;
    return true;
  }
  return false;
}

function assignEvaluationStatus(p, next) {
  if (isLegacyRecord(p)) {
    return assignIfChanged(p, "evaluationStatus", next);
  }
  const value = sanitizeNewEvaluationStatus(next, p.targetDateStatus, p.targetClose);
  return assignIfChanged(p, "evaluationStatus", value);
}

function isDuplicate(preds, key) {
  return preds.some((p) =>
    recordSymbol(p) === key.symbol
    && recordBaseDate(p) === key.baseTradingDate
    && recordHorizonType(p) === key.horizonType
    && recordHorizonDays(p) === key.horizonTradingDays
    && recordModelVersion(p) === key.modelVersion
    && recordFeatureVersion(p) === key.featureVersion
  );
}

function emptyHorizonCounts() {
  return { total: 0, pending: 0, evaluated: 0, calendarPending: 0 };
}

function calendarHasList(cal) {
  return !!(cal && typeof cal.list === "function" && Array.isArray(cal.list()) && cal.list().length > 0);
}

function readTargetDateStatus(p) {
  if (p == null || p.targetDateStatus == null || p.targetDateStatus === "") {
    return "UNKNOWN_LEGACY";
  }
  return p.targetDateStatus;
}

function isCalendarProvider(cal) {
  return !!(cal && typeof cal.getTradingDayStatus === "function");
}

function mapTargetDateStatus(result) {
  if (result && result.targetTradingDate) return "CONFIRMED";
  if (result && result.targetDateStatus) {
    if (result.targetDateStatus === "CONFIRMED") return "CALENDAR_PENDING";
    return result.targetDateStatus;
  }
  const code = result && result.code;
  if (code === "CALENDAR_RANGE_INSUFFICIENT") return "CALENDAR_RANGE_INSUFFICIENT";
  if (code === "CALENDAR_SOURCE_CONFLICT") return "CALENDAR_SOURCE_CONFLICT";
  return "CALENDAR_PENDING";
}

function resolveCandleFinalityMeta(opts, candle, baseTradingDate, asOfDate) {
  const candleTradingDate = opts.candleTradingDate || baseTradingDate || null;
  if (opts.finalitySource && opts.candleFinality) {
    return {
      candleFinality: opts.candleFinality,
      finalitySource: opts.finalitySource,
      candleTradingDate,
    };
  }

  const preferHeuristic = opts.finalitySource === "TIME_HEURISTIC";

  if (candle && (candle.isFinal === true || candle.marketSession === "CLOSED")) {
    return {
      candleFinality: opts.candleFinality || "FINAL",
      finalitySource: opts.finalitySource || "EXPLICIT_FINAL_FLAG",
      candleTradingDate,
    };
  }
  if (candle && (candle.isFinal === false || candle.marketSession === "OPEN")) {
    return {
      candleFinality: opts.candleFinality || "NOT_FINAL",
      finalitySource: preferHeuristic ? "TIME_HEURISTIC" : (opts.finalitySource || "EXPLICIT_FINAL_FLAG"),
      candleTradingDate,
    };
  }
  if (baseTradingDate && asOfDate && baseTradingDate < asOfDate) {
    return {
      candleFinality: opts.candleFinality || "FINAL",
      finalitySource: opts.finalitySource || "HISTORICAL_DATE",
      candleTradingDate,
    };
  }
  return {
    candleFinality: opts.candleFinality || "UNKNOWN",
    finalitySource: opts.finalitySource || "UNKNOWN",
    candleTradingDate,
  };
}

function assessCandleFinality(candle, baseDate, asOfDate, cal) {
  if (candle && (candle.isFinal === false || candle.marketSession === "OPEN")) {
    return { ok: false, code: CANDLE_NOT_FINAL, missingData: ["isFinal"] };
  }
  if (candle && (candle.isFinal === true || candle.marketSession === "CLOSED")) {
    return { ok: true, missingData: [] };
  }

  if (!baseDate || !asOfDate) {
    return { ok: false, code: CANDLE_NOT_FINAL, missingData: ["isFinal"] };
  }
  if (baseDate < asOfDate) {
    if (calendarHasList(cal) && typeof cal.has === "function") {
      cal.has(baseDate);
    }
    return { ok: true, missingData: ["isFinal"] };
  }
  if (baseDate === asOfDate) {
    return { ok: false, code: CANDLE_NOT_FINAL, missingData: ["isFinal"] };
  }
  return { ok: false, code: CANDLE_NOT_FINAL, missingData: ["isFinal"] };
}

function assessTargetCandleFinality(candle, targetDate, asOfDate) {
  if (!candle) return { ok: false, notFinal: false, missing: true };
  if (candle.isFinal === false || candle.marketSession === "OPEN") {
    return { ok: false, notFinal: true };
  }
  if (candle.isFinal === true || candle.marketSession === "CLOSED") {
    return { ok: true, notFinal: false };
  }
  if (targetDate < asOfDate) {
    return { ok: true, notFinal: false, missingData: ["isFinal"] };
  }
  if (targetDate === asOfDate) {
    return { ok: false, notFinal: true, missingData: ["isFinal"] };
  }
  return { ok: false, notFinal: true, missingData: ["isFinal"] };
}

function createPredictor({ store, calendar, nowFn } = {}) {
  if (!store) throw new TypeError("store is required");
  const defaultCalendar = calendar || createUnavailableCalendar();
  const now = nowFn || (() => new Date());
  let modelUpdateChain = Promise.resolve();

  function withModelMutex(fn) {
    const run = modelUpdateChain.then(fn, fn);
    modelUpdateChain = run.then(() => undefined, () => undefined);
    return run;
  }

  function ensureModel() {
    const model = store.getModel();
    if (!model || !model.weights) {
      return {
        weights: { ...DEFAULT_WEIGHTS },
        trained: 0,
        wins: 0,
        losses: 0,
        updatedAt: null,
        appliedEvaluations: [],
      };
    }
    if (!Array.isArray(model.appliedEvaluations)) model.appliedEvaluations = [];
    return model;
  }

  function resolveTarget(horizonType, horizonTradingDays, baseTradingDate, cal) {
    const useProvider = isCalendarProvider(cal);

    if (horizonType === LEGACY_HORIZON) {
      const result = useProvider
        ? cal.resolveLegacyTarget(baseTradingDate)
        : resolveLegacyTarget(baseTradingDate, cal);
      if (!result || !result.ok) {
        return {
          targetTradingDate: null,
          evaluationStatus: null,
          targetDateStatus: mapTargetDateStatus(result),
          missingData: Array.isArray(result?.missingData) ? [...result.missingData] : ["krxTradingCalendar"],
          recordError: result?.code && result.code !== CALENDAR_PENDING_CODE ? result.code : CALENDAR_PENDING_CODE,
        };
      }
      return {
        targetTradingDate: result.targetTradingDate,
        evaluationStatus: "PENDING",
        targetDateStatus: "CONFIRMED",
        missingData: Array.isArray(result.missingData) ? [...result.missingData] : [],
        recordError: null,
      };
    }
    if (!Number.isInteger(horizonTradingDays) || horizonTradingDays < 1) {
      return {
        targetTradingDate: null,
        evaluationStatus: null,
        targetDateStatus: "CALENDAR_PENDING",
        missingData: [],
        recordError: INVALID_HORIZON,
      };
    }
    const result = cal.addTradingDays(baseTradingDate, horizonTradingDays);
    if (!result || !result.ok) {
      const code = result && result.code === INVALID_HORIZON ? INVALID_HORIZON : CALENDAR_PENDING_CODE;
      return {
        targetTradingDate: null,
        evaluationStatus: null,
        targetDateStatus: mapTargetDateStatus(result),
        missingData: Array.isArray(result?.missingData) ? [...result.missingData] : ["krxTradingCalendar"],
        recordError: result && result.code === INVALID_HORIZON
          ? INVALID_HORIZON
          : (result?.code && result.code !== CALENDAR_PENDING_CODE ? result.code : code),
      };
    }
    return {
      targetTradingDate: result.targetTradingDate,
      evaluationStatus: "PENDING",
      targetDateStatus: "CONFIRMED",
      missingData: Array.isArray(result.missingData) ? [...result.missingData] : [],
      recordError: null,
    };
  }

  function findTargetCandle(candles, targetDate) {
    for (const c of candles) {
      try {
        const date = normalizeTradingDate(c.date || c.tradingDate);
        if (date === targetDate) return c;
      } catch {
        continue;
      }
    }
    return null;
  }

  function alreadyApplied(model, predictionId) {
    if (!predictionId) return false;
    return (model.appliedEvaluations || []).some((e) => e.predictionId === predictionId);
  }

  async function applyModelUpdate(p, model, updated) {
    if (!isLegacyRecord(p)) {
      if (p.targetDateStatus !== "CONFIRMED" || p.targetClose == null) {
        return { evaluated: false };
      }
    }

    const predictionId = p.predictionId || p.id;
    const operationId = p.evaluationOperationId;
    const skipSgd = alreadyApplied(model, predictionId);

    if (!skipSgd) {
      const entry = Number(p.baseClose ?? p.entryPrice);
      const features = p.features && typeof p.features === "object" ? p.features : null;
      if (!features || !Number.isFinite(entry) || entry <= 0 || p.targetClose == null) {
        return { evaluated: false };
      }
      const label = p.targetClose > entry ? 1 : 0;
      const prob = predictProb(features, model.weights);
      const err = label - prob;
      for (const [key, x] of Object.entries(features)) {
        model.weights[key] = Number((((model.weights[key] ?? 0)) + LEARNING_RATE * err * x).toFixed(4));
      }
      model.trained += 1;
      const predictedUp = prob >= 0.5;
      const correct = (predictedUp && label === 1) || (!predictedUp && label === 0);
      if (correct) model.wins += 1;
      else model.losses += 1;
      p.correct = correct;
      model.appliedEvaluations = [
        ...(model.appliedEvaluations || []),
        { predictionId, operationId },
      ];
      model.updatedAt = formatKstDateTimeIso(now());

      try {
        await store.saveModel(model);
      } catch {
        return { evaluated: false, modelSaveFailed: true };
      }
    }

    const evaluatedAt = formatKstDateTimeIso(now());
    const prevStatus = p.evaluationStatus;
    const prevResolved = p.status;
    p.evaluationStatus = "EVALUATED";
    p.status = "resolved";
    p.evaluatedAt = evaluatedAt;
    p.resolvedAt = evaluatedAt;
    p.modelUpdateStatus = "APPLIED";
    p.modelUpdatedAt = evaluatedAt;

    try {
      await store.commitPredictions(updated);
      return { evaluated: true };
    } catch {
      p.evaluationStatus = prevStatus === "EVALUATED" ? "MODEL_UPDATE_PENDING" : (prevStatus || "MODEL_UPDATE_PENDING");
      p.status = prevResolved === "resolved" ? "pending" : (prevResolved || "pending");
      p.evaluatedAt = null;
      p.resolvedAt = null;
      p.modelUpdateStatus = "PENDING";
      return { evaluated: false, predictionCommitFailed: true };
    }
  }

  /** 예측 생성 + 기록. 6필드 키가 같으면 신규 저장하지 않음 */
  function predict(code, analysis, close, opts = {}) {
    const model = ensureModel();
    const features = buildFeatures(analysis, close);
    const probUp = predictProb(features, model.weights);

    const contributions = Object.entries(features)
      .filter(([k]) => k !== "bias")
      .map(([k, x]) => ({ key: k, label: FEATURE_LABELS[k] || k, impact: Number(((model.weights[k] ?? 0) * x).toFixed(3)) }))
      .filter((c) => Math.abs(c.impact) > 0.01)
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 5);

    const nowValue = resolveNowValue(opts.now, now);
    let dataAsOf;
    let createdAt;
    try {
      dataAsOf = opts.dataAsOf || formatKstDateTimeIso(nowValue);
      createdAt = formatKstDateTimeIso(nowValue);
    } catch {
      dataAsOf = opts.dataAsOf || null;
      createdAt = null;
    }

    const asOfParsed = dataAsOf ? parseTradingDate(dataAsOf) : { ok: false };
    const asOfDate = asOfParsed.ok ? asOfParsed.date : null;

    const baseRaw = (opts.candle && (opts.candle.tradingDate || opts.candle.date))
      || opts.tradingDate
      || opts.baseTradingDate;
    let baseParsed;
    if (baseRaw !== undefined && baseRaw !== null) {
      baseParsed = parseTradingDate(baseRaw);
    } else {
      try {
        baseParsed = { ok: true, date: formatKstDate(nowValue), code: null };
      } catch {
        baseParsed = { ok: false, date: null, code: INVALID_DATE_FORMAT };
      }
    }

    const horizonType = opts.horizonType || LEGACY_HORIZON;
    const horizonTradingDays = horizonType === LEGACY_HORIZON
      ? null
      : (opts.horizonTradingDays ?? null);
    const modelVersion = opts.modelVersion || MODEL_VERSION;
    const featureVersion = opts.featureVersion || FEATURE_VERSION;
    const cal = opts.calendar || defaultCalendar;
    const direction = probUp >= 0.5 ? "UP" : "DOWN";
    const upProbability = Number(probUp.toFixed(4));

    let recordError = null;
    let missingData = [];
    let evaluationStatus = "PENDING";
    let targetTradingDate = null;
    let targetDateStatus = "CALENDAR_PENDING";
    let allowSave = true;

    if (!baseParsed.ok) {
      recordError = INVALID_DATE_FORMAT;
      allowSave = false;
    }

    const baseTradingDate = baseParsed.ok ? baseParsed.date : null;
    const finalityMeta = resolveCandleFinalityMeta(opts, opts.candle, baseTradingDate, asOfDate);
    const candleFinality = finalityMeta.candleFinality;
    const finalitySource = finalityMeta.finalitySource;
    const candleTradingDate = finalityMeta.candleTradingDate;

    if (allowSave && asOfDate && baseTradingDate && baseTradingDate > asOfDate) {
      recordError = INVALID_BASE_TRADING_DATE;
      allowSave = false;
    }

    if (allowSave && horizonType !== LEGACY_HORIZON
      && (!Number.isInteger(horizonTradingDays) || horizonTradingDays < 1)) {
      recordError = INVALID_HORIZON;
      allowSave = false;
    }

    if (allowSave) {
      const finality = assessCandleFinality(opts.candle, baseTradingDate, asOfDate, cal);
      missingData = mergeMissing(missingData, finality.missingData);
      if (!finality.ok) {
        recordError = finality.code || CANDLE_NOT_FINAL;
        allowSave = false;
      }
    }

    if (candleFinality === "UNKNOWN" || candleFinality === "NOT_FINAL") {
      allowSave = false;
      if (!recordError) recordError = CANDLE_NOT_FINAL;
    }

    if (allowSave && baseTradingDate) {
      const target = resolveTarget(horizonType, horizonTradingDays, baseTradingDate, cal);
      missingData = mergeMissing(missingData, target.missingData);
      targetTradingDate = target.targetTradingDate;
      evaluationStatus = target.evaluationStatus;
      targetDateStatus = target.targetDateStatus
        || (targetTradingDate ? "CONFIRMED" : "CALENDAR_PENDING");
      if (target.recordError === INVALID_HORIZON) {
        recordError = INVALID_HORIZON;
        allowSave = false;
      } else if (target.recordError === INVALID_DATE_FORMAT) {
        recordError = INVALID_DATE_FORMAT;
        allowSave = false;
      } else if (targetTradingDate && baseTradingDate && targetTradingDate <= baseTradingDate) {
        recordError = INVALID_TARGET_TRADING_DATE;
        allowSave = false;
      } else if (target.recordError === CALENDAR_PENDING_CODE) {
        recordError = CALENDAR_PENDING_CODE;
      }
    }

    const preds = store.listPredictions();
    const dupKey = {
      symbol: code,
      baseTradingDate,
      horizonType,
      horizonTradingDays,
      modelVersion,
      featureVersion,
    };
    const exists = baseTradingDate ? isDuplicate(preds, dupKey) : false;
    if (!exists && allowSave && close > 0 && baseTradingDate) {
      targetDateStatus = enforceConfirmedIffTarget(targetTradingDate, targetDateStatus);
      evaluationStatus = sanitizeNewEvaluationStatus(evaluationStatus, targetDateStatus, null);
      const predictionId = crypto.randomUUID();
      try {
        const saved = store.savePrediction({
          id: predictionId,
          code,
          date: baseTradingDate,
          entryPrice: close,
          features,
          probUp: upProbability,
          status: "pending",
          predictionId,
          symbol: code,
          createdAt,
          baseTradingDate,
          baseClose: close,
          horizonType,
          horizonTradingDays,
          targetTradingDate,
          predictedDirection: direction,
          upProbability,
          modelVersion,
          featureVersion,
          dataAsOf,
          candleTradingDate,
          candleFinality,
          finalitySource,
          targetClose: null,
          actualReturnPct: null,
          actualDirection: null,
          evaluationStatus,
          targetDateStatus,
          evaluatedAt: null,
          missingData,
          priceEvaluatedAt: null,
          modelUpdateStatus: null,
          modelUpdatedAt: null,
          evaluationOperationId: null,
        });
        if (saved && typeof saved.catch === "function") {
          saved.catch(() => {});
        }
      } catch (err) {
        if (err instanceof StoreLockError || (err && err.code === "STORE_BUSY")) {
          recordError = "STORE_BUSY";
        } else {
          throw err;
        }
      }
    }

    const resolved = model.wins + model.losses;
    const pu = Math.round(probUp * 1000) / 10;
    const score = Number(analysis?.score);
    let context = null;
    let combined = null;
    if (Number.isFinite(score)) {
      if (score <= 45 && probUp >= 0.62) {
        context = "기술 점수는 낮은 약세·과매도 국면이지만, 과거 통계상 이런 구간에서 7일 내 반등 확률이 높았습니다.";
        combined = { badge: "반등 매수 후보", tone: "up", note: `약세 국면 + AI 상승 ${pu}%` };
      } else if (score >= 75 && probUp <= 0.42) {
        context = "기술 점수는 높은 강세·과열 국면이지만, 과거 통계상 단기 되돌림(차익실현) 확률이 높았습니다.";
        combined = { badge: "과열 조정 주의", tone: "down", note: `강세 국면 + AI 하락 ${Math.round((1 - probUp) * 1000) / 10}%` };
      } else if (score >= 65 && probUp >= 0.58) {
        combined = { badge: "추세 지속 매수", tone: "up", note: `강세 국면 + AI 상승 ${pu}%` };
      } else if (score <= 45 && probUp <= 0.42) {
        combined = { badge: "약세 지속 주의", tone: "down", note: `약세 국면 + AI 하락 ${Math.round((1 - probUp) * 1000) / 10}%` };
      }
    }

    const matched = exists
      ? preds.find((p) =>
        recordSymbol(p) === code
        && recordBaseDate(p) === baseTradingDate
        && recordHorizonType(p) === horizonType
        && recordHorizonDays(p) === horizonTradingDays
        && recordModelVersion(p) === modelVersion
        && recordFeatureVersion(p) === featureVersion)
      : null;

    return {
      probUp: pu,
      probDown: Math.round((1 - probUp) * 1000) / 10,
      direction,
      confidence: Math.abs(probUp - 0.5) >= 0.2 ? "high" : Math.abs(probUp - 0.5) >= 0.1 ? "medium" : "low",
      horizonDays: HORIZON_DAYS,
      horizonType,
      evaluationStatus: matched ? matched.evaluationStatus : evaluationStatus,
      targetDateStatus: matched ? readTargetDateStatus(matched) : targetDateStatus,
      context,
      combined,
      topFactors: contributions,
      model: {
        trained: model.trained,
        accuracy: resolved ? Math.round((model.wins / resolved) * 1000) / 10 : null,
        resolved,
      },
      recordError,
      missingData,
      dataAsOf,
      candleTradingDate,
      candleFinality,
      finalitySource,
    };
  }

  /**
   * 만기된 예측을 targetTradingDate의 확정 종가로만 채점하고 SGD로 가중치 업데이트.
   * fetchCandles(code, count) → [{date:'YYYYMMDD'|'YYYY-MM-DD', close}]
   * 평가일 최신 종가(sorted[0])는 사용하지 않는다.
   * commitMaturedBatch를 쓰지 않는다. 가격 커밋 → 모델 → EVALUATED 순.
   */
  async function processMatured(fetchCandles, { maxPerRun = 10, asOf } = {}) {
    return withModelMutex(async () => {
      const preds = store.listPredictions();
      const asOfRaw = asOf !== undefined && asOf !== null ? asOf : now();
      const asOfParsed = parseTradingDate(asOfRaw);
      let asOfDate;
      if (asOfParsed.ok) asOfDate = asOfParsed.date;
      else {
        try { asOfDate = formatKstDate(asOfRaw); } catch { asOfDate = null; }
      }

      let processed = 0;
      let calendarPending = 0;
      let pending = 0;
      let skippedEvaluated = 0;
      let fetchCount = 0;
      let modelSaveFailed = false;
      let dirty = false;

      const model = ensureModel();
      const updated = preds.map((p) => ({ ...p }));

      for (const p of updated) {
        if (isSettled(p)) {
          skippedEvaluated += 1;
          continue;
        }

        if (p.evaluationStatus === "PRICE_EVALUATED" || p.evaluationStatus === "MODEL_UPDATE_PENDING") {
          const applied = await applyModelUpdate(p, model, updated);
          if (applied.evaluated) processed += 1;
          if (applied.modelSaveFailed) {
            modelSaveFailed = true;
            return { processed, calendarPending, pending, skippedEvaluated, modelSaveFailed };
          }
          continue;
        }

        if (!p.targetTradingDate) {
          if (recordHorizonType(p) === LEGACY_HORIZON) {
            const base = recordBaseDate(p);
            if (!base) {
              if (annotateCalendarPending(p)) dirty = true;
              calendarPending += 1;
              continue;
            }
            const resolved = isCalendarProvider(defaultCalendar)
              ? defaultCalendar.resolveLegacyTarget(base)
              : resolveLegacyTarget(base, defaultCalendar);
            if (resolved && resolved.ok && resolved.targetTradingDate) {
              p.targetTradingDate = resolved.targetTradingDate;
              if (!isLegacyRecord(p)) {
                p.targetDateStatus = "CONFIRMED";
              }
              if (assignEvaluationStatus(p, "PENDING")) dirty = true;
              p.missingData = Array.isArray(resolved.missingData) ? [...resolved.missingData] : [];
              dirty = true;
            } else {
              if (annotateCalendarPending(p, mapTargetDateStatus(resolved))) dirty = true;
              calendarPending += 1;
              continue;
            }
          } else {
            if (annotateCalendarPending(p)) dirty = true;
            calendarPending += 1;
            continue;
          }
        }

        if (calendarHasList(defaultCalendar) && typeof defaultCalendar.has === "function"
          && !defaultCalendar.has(p.targetTradingDate)) {
          if (annotateCalendarPending(p)) dirty = true;
          calendarPending += 1;
          continue;
        }

        let targetDate;
        try {
          targetDate = normalizeTradingDate(p.targetTradingDate);
        } catch {
          if (annotateCalendarPending(p)) dirty = true;
          calendarPending += 1;
          continue;
        }

        const baseRaw = recordBaseDate(p);
        if (baseRaw) {
          const baseParsed = parseTradingDate(baseRaw);
          if (baseParsed.ok && targetDate <= baseParsed.date) {
            if (assignIfChanged(p, "recordError", INVALID_TARGET_TRADING_DATE)) dirty = true;
            pending += 1;
            continue;
          }
        }

        if (!asOfDate || asOfDate < targetDate) {
          if (assignEvaluationStatus(p, "PENDING")) dirty = true;
          pending += 1;
          continue;
        }

        if (fetchCount >= maxPerRun) {
          pending += 1;
          continue;
        }

        fetchCount += 1;
        try {
          const code = recordSymbol(p);
          const candles = await fetchCandles(code, 30);
          if (!Array.isArray(candles) || candles.length === 0) {
            if (assignEvaluationStatus(p, "PENDING")) dirty = true;
            pending += 1;
            continue;
          }

          const candle = findTargetCandle(candles, targetDate);
          if (!candle) {
            if (assignEvaluationStatus(p, "PENDING")) dirty = true;
            pending += 1;
            continue;
          }

          const finality = assessTargetCandleFinality(candle, targetDate, asOfDate);
          if (!finality.ok) {
            if (assignEvaluationStatus(p, "PENDING")) dirty = true;
            pending += 1;
            continue;
          }

          const targetClose = Number(candle.close);
          if (!Number.isFinite(targetClose) || targetClose <= 0) {
            if (assignEvaluationStatus(p, "PENDING")) dirty = true;
            pending += 1;
            continue;
          }

          const entry = Number(p.baseClose ?? p.entryPrice);
          const features = p.features && typeof p.features === "object" ? p.features : null;
          if (!features || !Number.isFinite(entry) || entry <= 0) {
            if (assignEvaluationStatus(p, "PENDING")) dirty = true;
            pending += 1;
            continue;
          }

          const label = targetClose > entry ? 1 : 0;
          const operationId = crypto.randomUUID();
          const priceEvaluatedAt = formatKstDateTimeIso(now());
          const prob = predictProb(features, model.weights);
          const predictedUp = prob >= 0.5;
          p.status = "pending";
          p.targetClose = targetClose;
          p.finalPrice = targetClose;
          p.actualReturnPct = ((targetClose - entry) / entry) * 100;
          p.actualDirection = label === 1 ? "UP" : "DOWN";
          p.actual = label === 1 ? "UP" : "DOWN";
          p.correct = (predictedUp && label === 1) || (!predictedUp && label === 0);
          p.priceEvaluatedAt = priceEvaluatedAt;
          p.evaluationOperationId = operationId;
          p.modelUpdateStatus = "PENDING";
          p.evaluatedAt = null;
          p.resolvedAt = null;
          assignEvaluationStatus(p, "MODEL_UPDATE_PENDING");

          try {
            await store.commitPredictions(updated);
          } catch {
            pending += 1;
            continue;
          }

          const applied = await applyModelUpdate(p, model, updated);
          if (applied.evaluated) processed += 1;
          if (applied.modelSaveFailed) {
            modelSaveFailed = true;
            return { processed, calendarPending, pending, skippedEvaluated, modelSaveFailed };
          }
        } catch {
          if (assignEvaluationStatus(p, "PENDING")) dirty = true;
          pending += 1;
        }
      }

      if (dirty) {
        try {
          await store.commitPredictions(updated);
        } catch {
          /* 상태 주석 커밋 실패는 다음 실행에서 재시도 */
        }
      }

      return { processed, calendarPending, pending, skippedEvaluated, modelSaveFailed };
    });
  }

  /**
   * 과거 캔들 백테스트 학습 — 무료 호스팅은 재시작마다 디스크가 초기화되어
   * 온라인 학습 기록이 소실되므로, 부팅 시 과거 데이터를 걸어가며
   * "그날의 지표 → HORIZON_DAYS일 후 실제 등락" 샘플로 즉시 재학습한다.
   * 이후 6시간 주기 재실행으로 최신 데이터가 계속 반영된다(지속 학습).
   * fetchCandles(code, n) → 캔들 배열, analyzeFn(newestFirst) → analysis
   */
  async function trainFromHistory(codes, fetchCandles, analyzeFn, opts = {}) {
    const { step = 5, minHistory = 80, maxSamplesPerCode = 30 } = opts;
    const model = ensureModel();
    if (model.lastHistoryTrain && Date.now() - new Date(model.lastHistoryTrain.at).getTime() < 24 * 3600000) {
      return { skipped: true, reason: "24시간 내 학습 완료", last: model.lastHistoryTrain };
    }
    let samples = 0;
    let wins = 0;
    for (const code of codes) {
      try {
        const raw = await fetchCandles(code, 300);
        if (!Array.isArray(raw) || raw.length < minHistory + HORIZON_DAYS) continue;
        const newestFirst = [...raw].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
        let count = 0;
        for (let off = HORIZON_DAYS; off + minHistory < newestFirst.length && count < maxSamplesPerCode; off += step) {
          const slice = newestFirst.slice(off);
          const close = Number(slice[0]?.close);
          const future = Number(newestFirst[off - HORIZON_DAYS]?.close);
          if (!Number.isFinite(close) || !Number.isFinite(future) || close <= 0) continue;
          const analysis = analyzeFn(slice);
          if (!analysis || !Array.isArray(analysis.signals)) continue;
          const features = buildFeatures(analysis, close);
          const label = future > close ? 1 : 0;
          const prob = predictProb(features, model.weights);
          if ((prob >= 0.5) === (label === 1)) wins += 1;
          const err = label - prob;
          for (const [key, x] of Object.entries(features)) {
            model.weights[key] = Number(((model.weights[key] ?? 0) + LEARNING_RATE * err * x).toFixed(4));
          }
          samples += 1;
          count += 1;
        }
      } catch { /* 종목 단위 실패는 건너뜀 */ }
    }
    if (samples > 0) {
      model.trained += samples;
      model.wins += wins;
      model.losses += samples - wins;
      model.updatedAt = new Date().toISOString();
      model.lastHistoryTrain = {
        at: new Date().toISOString(),
        samples,
        hitRate: Math.round((wins / samples) * 1000) / 10,
        codes: codes.length,
      };
      await store.saveModel(model);
    }
    return { samples, hitRate: samples ? Math.round((wins / samples) * 1000) / 10 : null };
  }

  function getModelStats() {
    const model = ensureModel();
    const preds = store.listPredictions();
    const pending = preds.filter((p) => !isSettled(p)).length;
    const recent = preds.filter((p) => isSettled(p)).slice(-20).map((p) => ({
      code: p.code || p.symbol,
      date: p.date || p.baseTradingDate,
      probUp: p.probUp ?? p.upProbability,
      actual: p.actual ?? p.actualDirection,
      correct: p.correct,
    }));
    const resolved = model.wins + model.losses;
    const horizonCounts = {};
    for (const p of preds) {
      const h = recordHorizonType(p);
      if (!horizonCounts[h]) horizonCounts[h] = emptyHorizonCounts();
      horizonCounts[h].total += 1;
      if (isSettled(p)) horizonCounts[h].evaluated += 1;
      else if (
        p.evaluationStatus === "CALENDAR_PENDING"
        || (p.evaluationStatus == null && !p.targetTradingDate)
        || !p.targetTradingDate
      ) horizonCounts[h].calendarPending += 1;
      else horizonCounts[h].pending += 1;
    }
    return {
      weights: model.weights,
      trained: model.trained,
      wins: model.wins,
      losses: model.losses,
      accuracy: resolved ? Math.round((model.wins / resolved) * 1000) / 10 : null,
      pendingPredictions: pending,
      recentResolved: recent,
      lastHistoryTrain: model.lastHistoryTrain || null,
      updatedAt: model.updatedAt,
      horizonCounts,
    };
  }

  return { predict, processMatured, getModelStats, trainFromHistory, buildFeatures };
}

const defaultStore = createJsonFileStore({
  predictionsPath: path.join(__dirname, "data", "ai-predictions.json"),
  modelPath: path.join(__dirname, "data", "ai-model.json"),
});

const defaultPredictor = createPredictor({
  store: defaultStore,
  calendar: createUnavailableCalendar(),
  nowFn: () => new Date(),
});

module.exports = {
  createPredictor,
  predict: (...args) => defaultPredictor.predict(...args),
  processMatured: (...args) => defaultPredictor.processMatured(...args),
  getModelStats: (...args) => defaultPredictor.getModelStats(...args),
  buildFeatures,
  trainFromHistory: (...args) => defaultPredictor.trainFromHistory(...args),
  readTargetDateStatus,
  UNSPECIFIED_MODEL_VERSION,
  UNSPECIFIED_FEATURE_VERSION,
  MODEL_VERSION,
  FEATURE_VERSION,
};
