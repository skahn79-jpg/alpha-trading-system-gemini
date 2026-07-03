/**
 * ALPHA TRADING SYSTEM - 비트코인 사이클 진단 엔진 (CoinAI 벤치마킹)
 *
 *  · 생산비용: 난이도(blockchain.info 공개 API) 기반 채굴 원가 지지선 (Charles Edwards 모델)
 *  · 멱법칙 코리도: 제네시스 이후 경과일 로그-로그 회귀 밴드 내 현재 위치
 *  · Pi Cycle Top/Bottom: 111일선 vs 2×350일선 (고점) · 150EMA vs 0.745×471일선 (바닥)
 *  · 200주 이동평균 히트맵: 시트 규칙 "200주선 아래 = 기회"
 *  · 반감기 사이클 국면: 40주 이익실현 시작 · 80주 마지막 콜 · 135주 DCA 시작
 *  · BTI형 통합 리스크: 사이클 지표들의 역사적 고점 근접도 집계
 *
 * 데이터: Yahoo BTC-USD 10년 일봉 + blockchain.info 난이도 (모두 키 불필요)
 * 투자 참고용 정보이며 투자 권유가 아닙니다.
 */

const axios = require("axios");

const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const GENESIS = Date.parse("2009-01-03T00:00:00Z");
const HALVING_4TH = Date.parse("2024-04-19T00:00:00Z");
const BLOCK_REWARD = 3.125; // 4차 반감기 이후
const MINER_J_PER_TH = 25.8; // S19급 평균 효율
const ELECTRICITY_USD_KWH = 0.05;

let cache = { at: 0, data: null };
const TTL_MS = 6 * 60 * 60 * 1000;

function sma(arr, period, endIdx) {
  if (endIdx + 1 < period) return null;
  let s = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i += 1) s += arr[i];
  return s / period;
}

function emaLast(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let e = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i += 1) e = arr[i] * k + e * (1 - k);
  return e;
}

async function fetchBtcDaily() {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=10y&interval=1d";
  const { data } = await axios.get(url, { timeout: 20000, headers: UA });
  const result = data?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i += 1) {
    const close = Number(q.close?.[i]);
    if (Number.isFinite(close) && close > 0) {
      rows.push({ t: ts[i] * 1000, close, high: Number(q.high?.[i]) || close, low: Number(q.low?.[i]) || close });
    }
  }
  return rows; // 과거→현재
}

async function fetchDifficulty() {
  try {
    const url = "https://api.blockchain.info/charts/difficulty?timespan=30days&format=json";
    const { data } = await axios.get(url, { timeout: 15000, headers: UA });
    const values = data?.values;
    return Array.isArray(values) && values.length ? Number(values[values.length - 1].y) : null;
  } catch {
    return null;
  }
}

/** 생산비용 = 난이도×2^32×(J/TH)×전기료 ÷ (1e12×3.6e6×블록보상) */
function productionCost(difficulty, price) {
  if (!difficulty || !price) return null;
  const kwhPerBlock = (difficulty * 2 ** 32 * MINER_J_PER_TH) / (1e12 * 3.6e6);
  const cost = Math.round((kwhPerBlock * ELECTRICITY_USD_KWH) / BLOCK_REWARD);
  return {
    cost,
    price: Math.round(price),
    aboveCost: price >= cost,
    premiumPct: Math.round(((price - cost) / cost) * 1000) / 10,
    note: "시트: 비트코인은 생산비용 아래로 오래 머문 적이 없음 — 채굴 원가 지지선",
  };
}

/** 멱법칙 코리도 — log10(가격) ~ a + b·log10(제네시스 후 경과일) 회귀 밴드 */
function powerLawCorridor(rows) {
  if (rows.length < 500) return null;
  const pts = rows.map((r) => ({
    x: Math.log10((r.t - GENESIS) / 86400000),
    y: Math.log10(r.close),
  }));
  const n = pts.length;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;

  let minRes = Infinity; let maxRes = -Infinity;
  for (const p of pts) {
    const res = p.y - (a + b * p.x);
    if (res < minRes) minRes = res;
    if (res > maxRes) maxRes = res;
  }
  const last = pts[pts.length - 1];
  const fitted = a + b * last.x;
  const res = last.y - fitted;
  const positionPct = Math.round(((res - minRes) / (maxRes - minRes)) * 100);

  return {
    positionPct, // 0 = 역사적 바닥 밴드, 100 = 역사적 천장 밴드
    support: Math.round(10 ** (fitted + minRes)),
    center: Math.round(10 ** fitted),
    top: Math.round(10 ** (fitted + maxRes)),
    exponent: Math.round(b * 100) / 100,
  };
}

/** Pi Cycle — 고점: 111일선이 2×350일선 상향 돌파 / 바닥: 0.745×471일선이 150EMA 상향 돌파 */
function piCycle(closes) {
  const N = closes.length;
  if (N < 480) return null;
  const last = N - 1;
  const sma111 = sma(closes, 111, last);
  const sma350x2 = sma(closes, 350, last) * 2;
  const topRatio = sma111 / sma350x2;
  const prev111 = sma(closes, 111, last - 3);
  const prev350x2 = sma(closes, 350, last - 3) * 2;
  const topSignal = prev111 <= prev350x2 && sma111 > sma350x2; // 최근 상향 돌파 = 천장 신호

  const ema150 = emaLast(closes, 150);
  const sma471adj = sma(closes, 471, last) * 0.745;
  const bottomZone = sma471adj > ema150; // 조정선이 150EMA 위 = 바닥권 진행

  return {
    topRatio: Math.round(topRatio * 100) / 100,
    topSignal,
    topNote: topSignal ? "Pi Cycle 천장 신호 발생!" : topRatio >= 0.9 ? "천장 신호 근접 주의" : "천장 신호 미발생",
    bottomZone,
  };
}

/** 200주(1400일) 이동평균 히트맵 */
function ma200Week(closes) {
  const N = closes.length;
  if (N < 1400) return null;
  const ma = sma(closes, 1400, N - 1);
  const multiple = closes[N - 1] / ma;
  return {
    ma: Math.round(ma),
    multiple: Math.round(multiple * 100) / 100,
    zone: multiple < 1 ? "opportunity" : multiple < 2 ? "normal" : multiple < 3 ? "warm" : "hot",
    note: "시트: 200주선 아래로 오면 기회 — 이때부터 모아가면 된다",
  };
}

/** 거품지수 — 20주 SMA 대비 이격률% (CoinAI bubble.js / Bubble Risk Indicator 벤치마킹)
 *  0 이하 = 저평가, 33+ = 과열, 66+ = 거품 */
function bubbleIndex(rows) {
  if (rows.length < 160) return null;
  // 일봉 → 7일 버킷 리샘플로 주봉 종가 근사
  const weekly = [];
  for (let i = rows.length - 1; i >= 0; i -= 7) weekly.unshift(rows[i].close);
  if (weekly.length < 21) return null;
  const sma20w = weekly.slice(-21, -1).reduce((a, b) => a + b, 0) / 20; // 직전 완성 주봉 기준
  const close = rows[rows.length - 1].close;
  const dev = Math.round(((close - sma20w) / sma20w) * 1000) / 10;
  return {
    dev,
    zone: dev >= 66 ? "bubble" : dev >= 33 ? "hot" : dev >= 0 ? "normal" : "undervalued",
    note: "20주선 대비 이격률 — 66%+ 거품, 0 이하 저평가",
  };
}

/** Bitfinex 마진 롱/숏 (공개 API, 키 불필요) — 시트: "바닥에서 롱이 급증" */
async function fetchBitfinexMargin() {
  try {
    const get = async (side) => {
      const { data } = await axios.get(
        `https://api-pub.bitfinex.com/v2/stats1/pos.size:1m:tBTCUSD:${side}/last`,
        { timeout: 12000, headers: UA },
      );
      return Array.isArray(data) ? Number(data[1]) : null;
    };
    const [longSize, shortSize] = await Promise.all([get("long"), get("short")]);
    if (!longSize || !shortSize) return null;
    return {
      longBtc: Math.round(longSize),
      shortBtc: Math.round(shortSize),
      longShortRatio: Math.round((longSize / shortSize) * 10) / 10,
      note: "시트: 바닥에서 마진 롱 급증 = 고래 매집 신호",
    };
  } catch {
    return null;
  }
}

/** 반감기 사이클 국면 — Halving Cycle Profit 모델 (40주/80주/135주) */
function halvingPhase() {
  const weeks = Math.floor((Date.now() - HALVING_4TH) / (7 * 86400000));
  let phase; let label; let guide;
  if (weeks < 40) {
    phase = "accumulation_bull"; label = "상승 초·중기";
    guide = "모델 기준 이익실현 구간(40주) 이전";
  } else if (weeks < 80) {
    phase = "profit_zone"; label = "이익실현 구간";
    guide = "모델 기준 40~80주 = 최적 이익실현 구간";
  } else if (weeks < 135) {
    phase = "bear_transition"; label = "사이클 후반·약세 전환";
    guide = "80주(마지막 콜) 경과 — 135주부터 DCA 매집 권장 구간";
  } else {
    phase = "dca_zone"; label = "DCA 매집 구간";
    guide = "모델 기준 135주 이후 = 분할 매수 최적 구간";
  }
  return { weeksSinceHalving: weeks, phase, label, guide, halvingDate: "2024-04-19" };
}

/** BTI형 통합 리스크 — 사이클 지표들의 역사적 고점 근접도 */
function btiRisk(rows, extras) {
  const closes = rows.map((r) => r.close);
  const N = closes.length;
  const subs = [];

  // 각 지표의 현재값 / 역사적 최대값 = 근접도(0~1)
  const proxOf = (series) => {
    const valid = series.filter((v) => v !== null && Number.isFinite(v));
    if (valid.length < 100) return null;
    const max = Math.max(...valid);
    const cur = valid[valid.length - 1];
    return max > 0 ? cur / max : null;
  };

  // 1) Mayer(200일 배율) 시리즈
  const mayerSeries = [];
  for (let i = 0; i < N; i += 1) {
    const m = i >= 199 ? closes[i] / sma(closes, 200, i) : null;
    mayerSeries.push(m);
  }
  const mayerProx = proxOf(mayerSeries);
  if (mayerProx !== null) subs.push({ key: "mayer", label: "200일선 배율", prox: mayerProx });

  // 2) ATH 근접도
  subs.push({ key: "ath", label: "역대 최고가 대비", prox: closes[N - 1] / Math.max(...closes) });

  // 3) Pi Cycle 비율
  if (extras.pi) subs.push({ key: "pi", label: "Pi Cycle 비율", prox: Math.min(extras.pi.topRatio, 1) });

  // 4) 멱법칙 위치
  if (extras.pl) subs.push({ key: "powerlaw", label: "멱법칙 밴드 위치", prox: extras.pl.positionPct / 100 });

  // 5) 200주선 배율
  if (extras.w200) {
    const histMax = 4; // 역사적으로 200주선 3.5~4배 부근이 사이클 천장
    subs.push({ key: "ma200w", label: "200주선 배율", prox: Math.min(extras.w200.multiple / histMax, 1) });
  }

  // 6) 거품지수 (20주선 이격 66%+ = 거품)
  if (extras.bubble) {
    subs.push({ key: "bubble", label: "거품지수", prox: Math.max(0, Math.min(extras.bubble.dev / 66, 1)) });
  }

  const nearTop = subs.filter((s) => s.prox >= 0.85).length;
  const risk = subs.reduce((a, b) => a + b.prox, 0) / subs.length;
  const riskPct = Math.round(risk * 100);

  return {
    count: nearTop,
    total: subs.length,
    riskPct,
    verdict: riskPct >= 80 ? "고점권 위험" : riskPct >= 60 ? "상단 주의" : riskPct >= 40 ? "중립" : "바닥권 근접",
    subs: subs.map((s) => ({ ...s, prox: Math.round(s.prox * 100) / 100 })),
  };
}

async function buildBtcCycle() {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

  const [rows, difficulty, margin] = await Promise.all([
    fetchBtcDaily(),
    fetchDifficulty(),
    fetchBitfinexMargin(),
  ]);
  if (!rows.length) return null;
  const closes = rows.map((r) => r.close);
  const price = closes[closes.length - 1];

  const pl = powerLawCorridor(rows);
  const pi = piCycle(closes);
  const w200 = ma200Week(closes);
  const bubble = bubbleIndex(rows);

  const result = {
    updatedAt: new Date().toISOString(),
    price: Math.round(price),
    productionCost: productionCost(difficulty, price),
    powerLaw: pl,
    piCycle: pi,
    ma200w: w200,
    bubble,
    margin,
    halving: halvingPhase(),
    bti: btiRisk(rows, { pi, pl, w200, bubble }),
  };
  cache = { at: Date.now(), data: result };
  return result;
}

module.exports = { buildBtcCycle };
