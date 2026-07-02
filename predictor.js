/**
 * ALPHA TRADING SYSTEM - AI 자동 학습 상승/하락 예측기
 *
 * 온라인 로지스틱 회귀(SGD):
 *  1) /api/ai/predict 호출 시 기술 지표 피처로 상승 확률 계산 + 예측 기록
 *  2) 예측이 만기(기본 5거래일 ≈ 7일)되면 실제 종가로 정답(상승/하락)을 매김
 *  3) 오차만큼 가중치를 자동 업데이트 → 호출이 쌓일수록 예측 정확도 개선
 *
 * 상태 파일: data/ai-model.json (가중치·성적), data/ai-predictions.json (예측 로그)
 * 주의: Render 무료 디스크는 재배포 시 초기화됨 — 모델은 런타임 동안 누적 학습.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const MODEL_FILE = path.join(DATA_DIR, "ai-model.json");
const PRED_FILE = path.join(DATA_DIR, "ai-predictions.json");

const HORIZON_DAYS = 7; // 달력일 기준 만기 (≈ 5거래일)
const LEARNING_RATE = 0.05;
const MAX_PREDICTION_LOG = 2000;

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
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadModel() {
  const model = readJson(MODEL_FILE, null);
  if (model && model.weights) return model;
  return { weights: { ...DEFAULT_WEIGHTS }, trained: 0, wins: 0, losses: 0, updatedAt: null };
}

function saveModel(model) {
  writeJson(MODEL_FILE, model);
}

function loadPredictions() {
  const preds = readJson(PRED_FILE, []);
  return Array.isArray(preds) ? preds : [];
}

function savePredictions(preds) {
  writeJson(PRED_FILE, preds.slice(-MAX_PREDICTION_LOG));
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
  };
}

function predictProb(features, weights) {
  let z = 0;
  for (const [key, x] of Object.entries(features)) {
    z += (weights[key] ?? 0) * x;
  }
  return sigmoid(z);
}

/** 예측 생성 + 기록 (code당 하루 1건만 기록) */
function predict(code, analysis, close) {
  const model = loadModel();
  const features = buildFeatures(analysis, close);
  const probUp = predictProb(features, model.weights);

  const contributions = Object.entries(features)
    .filter(([k]) => k !== "bias")
    .map(([k, x]) => ({ key: k, label: FEATURE_LABELS[k] || k, impact: Number(((model.weights[k] ?? 0) * x).toFixed(3)) }))
    .filter((c) => Math.abs(c.impact) > 0.01)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 5);

  const today = new Date().toISOString().slice(0, 10);
  const preds = loadPredictions();
  const exists = preds.some((p) => p.code === code && p.date === today);
  if (!exists && close > 0) {
    preds.push({
      id: `${code}-${today}`,
      code,
      date: today,
      entryPrice: close,
      features,
      probUp: Number(probUp.toFixed(4)),
      status: "pending",
    });
    savePredictions(preds);
  }

  const resolved = model.wins + model.losses;
  return {
    probUp: Math.round(probUp * 1000) / 10,
    probDown: Math.round((1 - probUp) * 1000) / 10,
    direction: probUp >= 0.5 ? "UP" : "DOWN",
    confidence: Math.abs(probUp - 0.5) >= 0.2 ? "high" : Math.abs(probUp - 0.5) >= 0.1 ? "medium" : "low",
    horizonDays: HORIZON_DAYS,
    topFactors: contributions,
    model: {
      trained: model.trained,
      accuracy: resolved ? Math.round((model.wins / resolved) * 1000) / 10 : null,
      resolved,
    },
  };
}

/**
 * 만기된 예측을 실제 캔들로 채점하고 SGD로 가중치 업데이트.
 * fetchCandles(code, count) → [{date:'YYYYMMDD'|'...', close}] (최신순 or 과거순 모두 허용)
 */
async function processMatured(fetchCandles, { maxPerRun = 10 } = {}) {
  const preds = loadPredictions();
  const now = Date.now();
  const pending = preds.filter(
    (p) => p.status === "pending" && now - new Date(p.date).getTime() >= HORIZON_DAYS * 86400000,
  ).slice(0, maxPerRun);
  if (pending.length === 0) return { processed: 0 };

  const model = loadModel();
  let processed = 0;

  for (const p of pending) {
    try {
      const candles = await fetchCandles(p.code, 30);
      if (!Array.isArray(candles) || candles.length === 0) continue;
      // 예측일 이후 첫 5거래일 뒤 종가 대신, 만기 시점의 최신 종가 사용 (최신순 정렬 가정)
      const sorted = [...candles].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      const latestClose = Number(sorted[0]?.close);
      if (!Number.isFinite(latestClose) || latestClose <= 0) continue;

      const label = latestClose > p.entryPrice ? 1 : 0;
      const prob = predictProb(p.features, model.weights);
      const err = label - prob; // SGD 업데이트
      for (const [key, x] of Object.entries(p.features)) {
        model.weights[key] = Number((((model.weights[key] ?? 0)) + LEARNING_RATE * err * x).toFixed(4));
      }
      model.trained += 1;
      const predictedUp = prob >= 0.5;
      if ((predictedUp && label === 1) || (!predictedUp && label === 0)) model.wins += 1;
      else model.losses += 1;

      p.status = "resolved";
      p.finalPrice = latestClose;
      p.actual = label === 1 ? "UP" : "DOWN";
      p.correct = (predictedUp && label === 1) || (!predictedUp && label === 0);
      p.resolvedAt = new Date().toISOString();
      processed += 1;
    } catch {
      // 네트워크 오류 등은 다음 기회에 재시도
    }
  }

  if (processed > 0) {
    model.updatedAt = new Date().toISOString();
    saveModel(model);
    savePredictions(preds);
  }
  return { processed };
}

function getModelStats() {
  const model = loadModel();
  const preds = loadPredictions();
  const pending = preds.filter((p) => p.status === "pending").length;
  const recent = preds.filter((p) => p.status === "resolved").slice(-20).map((p) => ({
    code: p.code,
    date: p.date,
    probUp: p.probUp,
    actual: p.actual,
    correct: p.correct,
  }));
  const resolved = model.wins + model.losses;
  return {
    weights: model.weights,
    trained: model.trained,
    wins: model.wins,
    losses: model.losses,
    accuracy: resolved ? Math.round((model.wins / resolved) * 1000) / 10 : null,
    pendingPredictions: pending,
    recentResolved: recent,
    updatedAt: model.updatedAt,
  };
}

module.exports = { predict, processMatured, getModelStats, buildFeatures };
