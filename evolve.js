/**
 * ALPHA TRADING SYSTEM - 자체 기법 발굴·진화 엔진
 *
 * 앱이 스스로 "새로운 기법"을 만들어 검증하고 발전시키는 유전 알고리즘:
 *   1) 지표 조건 2~3개를 무작위 조합해 후보 기법(규칙)을 생성
 *   2) 과거 데이터(그날의 지표 → 7일 후 등락)로 적중률 백테스트
 *   3) 우수 기법은 살리고, 변형(돌연변이)·교배로 다음 세대 생성
 *   4) 6시간마다 세대를 이어가며 계속 진화 (부팅 시 처음부터 재진화)
 *
 * 발굴된 기법은 사람이 읽을 수 있는 한국어 이름/설명으로 노출되고,
 * 종목별로 "지금 어떤 발굴 기법이 발동 중인지" 조회할 수 있다.
 */

const fs = require("fs");
const path = require("path");
const { buildFeatures } = require("./predictor.js");

const STATE_PATH = path.join(__dirname, "data/evolve.json");
const POP_SIZE = 40;
const ELITE = 8;
const GENERATIONS_PER_CYCLE = 30;
const MIN_SIGNALS = 15; // 신호가 너무 드문 기법은 과적합으로 배제
const HORIZON_LABEL = "7일";

// 조건에 쓸 피처와 한국어 라벨/단위 (buildFeatures 출력 기준, bias 제외)
const FEATURE_DEFS = {
  rsi: { label: "RSI", fmt: (v) => `${Math.round(v * 100)}` , desc: "상대강도" },
  bbPos: { label: "볼린저 위치", fmt: (v) => `${Math.round(v * 100)}%`, desc: "밴드 내 위치" },
  dist20: { label: "20일선 이격", fmt: (v) => `${(v * 100).toFixed(1)}%`, desc: "20일선 대비" },
  dist60: { label: "60일선 이격", fmt: (v) => `${(v * 100).toFixed(1)}%`, desc: "60일선 대비" },
  volRatio: { label: "거래량 배율", fmt: (v) => `${v.toFixed(1)}배`, desc: "20일 평균 대비" },
  macdHist: { label: "MACD 히스토그램", fmt: (v) => v.toFixed(2), desc: "모멘텀" },
  stochK: { label: "스토캐스틱", fmt: (v) => `${Math.round(v * 100)}`, desc: "%K" },
  w52Pos: { label: "52주 위치", fmt: (v) => `${Math.round(v * 100)}%`, desc: "52주 범위 내" },
  atrPct: { label: "변동성(ATR)", fmt: (v) => `${(v * 100).toFixed(1)}%`, desc: "일변동폭" },
  mfiNorm: { label: "자금흐름(MFI)", fmt: (v) => `${Math.round(v * 100)}`, desc: "자금 유출입" },
  mayerDev: { label: "메이어 편차", fmt: (v) => v.toFixed(2), desc: "200일선 배율" },
  minerviniScore: { label: "미너비니 점수", fmt: (v) => `${Math.round(v * 8)}/8`, desc: "추세 템플릿" },
  supertrendDir: { label: "슈퍼트렌드", fmt: (v) => (v > 0 ? "상승" : "하락"), desc: "추세 방향" },
  adxTrend: { label: "ADX 추세", fmt: (v) => v.toFixed(1), desc: "추세 강도" },
  obvTrend: { label: "OBV 흐름", fmt: (v) => (v > 0 ? "유입" : "유출"), desc: "누적 거래량" },
  ichimokuCloud: { label: "일목 구름", fmt: (v) => (v > 0 ? "상단" : v < 0 ? "하단" : "내부"), desc: "구름 위치" },
  stochSlowWell: { label: "스토캐 저점권", fmt: (v) => (v > 0 ? "진입" : "아님"), desc: "슬로우 20-12-6" },
  vixFixSpike: { label: "공포 스파이크", fmt: (v) => (v > 0 ? "발생" : "없음"), desc: "Williams VixFix" },
  divergenceSig: { label: "다이버전스", fmt: (v) => (v > 0 ? "강세" : v < 0 ? "약세" : "없음"), desc: "지표 괴리" },
  heatmapPaint: { label: "히트맵 도배", fmt: (v) => (v > 0 ? "바닥" : v < 0 ? "고점" : "중립"), desc: "스토캐 히트맵" },
};
const FEATURE_KEYS = Object.keys(FEATURE_DEFS);

let state = {
  generation: 0,
  population: [], // {conds:[{key,op,thr}], fitness, hitRate, signals}
  best: [],
  updatedAt: null,
  sampleCount: 0,
  bootAt: new Date().toISOString(),
};
try {
  const saved = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (saved && Array.isArray(saved.population)) state = saved;
} catch { /* 첫 실행 */ }

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch { /* 무료 호스팅 재시작 시 소실 허용 */ }
}

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function randomCond(quantiles) {
  const key = rnd(FEATURE_KEYS);
  const qs = quantiles[key] || [-0.5, 0, 0.5];
  return { key, op: Math.random() < 0.5 ? ">" : "<", thr: rnd(qs) };
}

function randomRule(quantiles) {
  const n = Math.random() < 0.5 ? 2 : 3;
  const conds = [];
  const used = new Set();
  while (conds.length < n) {
    const c = randomCond(quantiles);
    if (used.has(c.key)) continue;
    used.add(c.key);
    conds.push(c);
  }
  return { conds };
}

function fires(rule, f) {
  for (const c of rule.conds) {
    const v = f[c.key] ?? 0;
    if (c.op === ">" ? v <= c.thr : v >= c.thr) return false;
  }
  return true;
}

function evaluate(rule, samples) {
  let signals = 0;
  let ups = 0;
  for (const s of samples) {
    if (fires(rule, s.f)) {
      signals += 1;
      ups += s.label;
    }
  }
  if (signals < MIN_SIGNALS) return { fitness: 0, hitRate: null, signals };
  // 표본 대부분에서 발동하는 규칙은 "조건이 사실상 없음" — 퇴화로 배제
  if (signals > samples.length * 0.55) return { fitness: 0, hitRate: null, signals };
  const hitRate = ups / signals;
  // 상승 예측 기법 기준: 50% 초과분 × 신호 수 보정 (많이 맞을수록·자주 쓰일수록 우수)
  const fitness = (hitRate - 0.5) * Math.sqrt(Math.min(signals, 200));
  return { fitness: Math.round(fitness * 1000) / 1000, hitRate: Math.round(hitRate * 1000) / 10, signals };
}

function mutate(rule, quantiles) {
  const conds = rule.conds.map((c) => ({ ...c }));
  const r = Math.random();
  if (r < 0.4 && conds.length > 0) {
    // 임계값 이동
    const c = rnd(conds);
    const qs = quantiles[c.key] || [c.thr];
    c.thr = rnd(qs);
  } else if (r < 0.7) {
    // 조건 하나 교체
    conds[Math.floor(Math.random() * conds.length)] = randomCond(quantiles);
  } else if (r < 0.85 && conds.length < 3) {
    conds.push(randomCond(quantiles));
  } else if (conds.length > 2) {
    conds.splice(Math.floor(Math.random() * conds.length), 1);
  }
  return { conds };
}

function crossover(a, b) {
  const pool = [...a.conds, ...b.conds];
  const used = new Set();
  const conds = [];
  for (const c of pool.sort(() => Math.random() - 0.5)) {
    if (used.has(c.key) || conds.length >= 3) continue;
    used.add(c.key);
    conds.push({ ...c });
  }
  return { conds: conds.slice(0, Math.max(2, conds.length)) };
}

function describeRule(rule) {
  const parts = rule.conds.map((c) => {
    const def = FEATURE_DEFS[c.key];
    const dir = c.op === ">" ? "높음" : "낮음";
    return `${def.label} ${def.fmt(c.thr)} 대비 ${dir}`;
  });
  return parts.join(" + ");
}

function nameRule(rule, idx) {
  const keys = rule.conds.map((c) => FEATURE_DEFS[c.key].label.split("(")[0]);
  return `발굴기법 #${idx + 1} · ${keys.slice(0, 2).join("×")}`;
}

/** 피처 분위수 — 임계값 후보로 사용 (10/25/50/75/90 분위) */
function computeQuantiles(samples) {
  const out = {};
  for (const key of FEATURE_KEYS) {
    const vals = samples.map((s) => s.f[key] ?? 0).sort((a, b) => a - b);
    if (!vals.length) continue;
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
    out[key] = [...new Set([q(0.1), q(0.25), q(0.5), q(0.75), q(0.9)].map((v) => Math.round(v * 1000) / 1000))];
  }
  return out;
}

/**
 * 진화 1사이클 — 샘플 수집은 호출자가 제공 (predictor.trainFromHistory와 동일한 walk)
 * fetchCandles(code, n), analyzeFn(newestFirst)
 */
async function evolveCycle(codes, fetchCandles, analyzeFn, opts = {}) {
  const { step = 4, minHistory = 80, maxPerCode = 35, horizonDays = 7 } = opts;

  // 1) 학습 샘플 수집
  const samples = [];
  for (const code of codes) {
    try {
      const raw = await fetchCandles(code, 300);
      if (!Array.isArray(raw) || raw.length < minHistory + horizonDays) continue;
      const newestFirst = [...raw].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      let count = 0;
      for (let off = horizonDays; off + minHistory < newestFirst.length && count < maxPerCode; off += step) {
        const slice = newestFirst.slice(off);
        const close = Number(slice[0]?.close);
        const future = Number(newestFirst[off - horizonDays]?.close);
        if (!Number.isFinite(close) || !Number.isFinite(future) || close <= 0) continue;
        const analysis = analyzeFn(slice);
        if (!analysis || !Array.isArray(analysis.signals)) continue;
        samples.push({ f: buildFeatures(analysis, close), label: future > close ? 1 : 0 });
        count += 1;
      }
    } catch { /* 종목 실패 무시 */ }
  }
  if (samples.length < 100) return { ok: false, reason: `샘플 부족 (${samples.length})` };

  const quantiles = computeQuantiles(samples);

  // 2) 개체군 준비 (이어서 진화하거나 새로 시작)
  let pop = (state.population || []).map((p) => ({ conds: p.conds }));
  while (pop.length < POP_SIZE) pop.push(randomRule(quantiles));

  // 3) 세대 반복: 평가 → 엘리트 보존 → 교배·변이
  let evaluated = [];
  for (let gen = 0; gen < GENERATIONS_PER_CYCLE; gen += 1) {
    evaluated = pop
      .map((r) => ({ ...r, ...evaluate(r, samples) }))
      .sort((a, b) => b.fitness - a.fitness);
    const elites = evaluated.slice(0, ELITE);
    const next = elites.map((e) => ({ conds: e.conds }));
    while (next.length < POP_SIZE) {
      const roll = Math.random();
      if (roll < 0.45) next.push(mutate(rnd(elites), quantiles));
      else if (roll < 0.75) next.push(crossover(rnd(elites), rnd(elites)));
      else next.push(randomRule(quantiles));
    }
    pop = next;
    state.generation += 1;
  }

  // 4) 최종 평가 후 우수 기법 저장
  evaluated = pop
    .map((r) => ({ ...r, ...evaluate(r, samples) }))
    .sort((a, b) => b.fitness - a.fitness);
  state.population = evaluated.slice(0, POP_SIZE).map(({ conds, fitness, hitRate, signals }) => ({ conds, fitness, hitRate, signals }));
  // 동일 조건 조합 중복 제거 (조건 정렬 서명 기준)
  const seen = new Set();
  const unique = evaluated.filter((r) => {
    if (r.fitness <= 0) return false;
    const sig = r.conds
      .map((c) => `${c.key}${c.op}${c.thr}`)
      .sort()
      .join("|");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  state.best = unique
    .slice(0, 6)
    .map((r, i) => ({
      name: nameRule(r, i),
      desc: describeRule(r),
      conds: r.conds,
      hitRate: r.hitRate,
      signals: r.signals,
      fitness: r.fitness,
    }));
  state.sampleCount = samples.length;
  state.updatedAt = new Date().toISOString();
  saveState();
  return { ok: true, generation: state.generation, best: state.best.length, samples: samples.length };
}

function getStrategies() {
  return {
    ok: true,
    generation: state.generation,
    sampleCount: state.sampleCount,
    horizon: HORIZON_LABEL,
    strategies: state.best,
    bootAt: state.bootAt,
    updatedAt: state.updatedAt,
    method: "유전 알고리즘 — 지표 조건을 무작위 조합·검증·교배하며 세대마다 진화하는 자체 발굴 기법 (교육·참고용)",
  };
}

/** 특정 종목의 현재 지표로 발동 중인 발굴 기법 조회 */
function applyToAnalysis(analysis, close) {
  if (!state.best.length) return { ok: true, fired: [], generation: state.generation };
  const f = buildFeatures(analysis, close);
  const fired = state.best
    .filter((r) => fires(r, f))
    .map((r) => ({ name: r.name, desc: r.desc, hitRate: r.hitRate, signals: r.signals }));
  return { ok: true, fired, total: state.best.length, generation: state.generation };
}

module.exports = { evolveCycle, getStrategies, applyToAnalysis };
