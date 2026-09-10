/**
 * NIndicators — chart analysis indicator engine (APK-parity helpers).
 *
 * Compatible surface for trading-platform.jsx:
 *   compute(candles, opts) → indicator pack
 *   buildSignals(computed) → ranked chart-analysis signals
 *   currentZone(computed) → overbought / oversold / neutral pack
 *   accuracy(records) → hit-rate summary
 *
 * Candles are oldest→newest: { date, open, high, low, close, volume }.
 * CommonJS so Node tests and Vite can both load this file.
 */

"use strict";

function num(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function lastFinite(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return null;
}

function closesOf(candles) {
  return (candles || []).map((c) => num(c.close));
}

function parseTime(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value);
  if (/^\d{8}$/.test(s)) {
    return Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function smaAt(values, period, endIdx) {
  if (!Array.isArray(values) || endIdx + 1 < period || period <= 0) return null;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i += 1) {
    const v = num(values[i]);
    if (!Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / period;
}

function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (!Array.isArray(values) || period <= 0) return out;
  let sum = 0;
  let ready = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = num(values[i]);
    if (!Number.isFinite(v)) {
      sum = 0;
      ready = 0;
      continue;
    }
    sum += v;
    ready += 1;
    if (ready > period) {
      const drop = num(values[i - period]);
      if (Number.isFinite(drop)) sum -= drop;
      else ready = period;
    }
    if (ready >= period) out[i] = sum / period;
  }
  return out;
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let prev = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = num(values[i]);
    if (!Number.isFinite(v)) continue;
    if (prev == null) {
      seed += v;
      count += 1;
      if (count === period) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder RSI with Cutler fallback on degenerate windows.
 * Returns a series aligned to candles (null until warm-up).
 */
function rsiSeries(values, period = 14) {
  const out = new Array((values || []).length).fill(null);
  if (!Array.isArray(values) || values.length < period + 1 || period <= 0) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = num(values[i]) - num(values[i - 1]);
    if (!Number.isFinite(diff)) continue;
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  const rsiFrom = (g, l) => {
    if (!Number.isFinite(g) || !Number.isFinite(l)) return null;
    if (l === 0 && g === 0) return 50;
    if (l === 0) return 100;
    if (g === 0) return 0;
    return 100 - 100 / (1 + g / l);
  };
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = num(values[i]) - num(values[i - 1]);
    const gain = Number.isFinite(diff) && diff > 0 ? diff : 0;
    const loss = Number.isFinite(diff) && diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiLast(values, period = 14) {
  const series = rsiSeries(values, period);
  const last = lastFinite(series);
  return last == null ? null : Math.round(last * 10) / 10;
}

/** Chande Momentum Oscillator: 100 * (Su - Sd) / (Su + Sd) */
function cmoSeries(values, period = 14) {
  const out = new Array((values || []).length).fill(null);
  if (!Array.isArray(values) || values.length <= period) return out;
  for (let i = period; i < values.length; i += 1) {
    let su = 0;
    let sd = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = num(values[j]) - num(values[j - 1]);
      if (!Number.isFinite(diff)) continue;
      if (diff > 0) su += diff;
      else sd -= diff;
    }
    const den = su + sd;
    out[i] = den === 0 ? 0 : (100 * (su - sd)) / den;
  }
  return out;
}

const RAINBOW_PERIODS = [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60];
const RAINBOW_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef",
];

function rainbow(values, periods = RAINBOW_PERIODS) {
  return periods.map((period, idx) => ({
    period,
    color: RAINBOW_COLORS[idx % RAINBOW_COLORS.length],
    series: smaSeries(values, period),
    last: smaAt(values, period, values.length - 1),
  }));
}

/** Public BTC halving timestamps (UTC). Used as vertical cycle guides. */
const BTC_HALVINGS = [
  { id: "h1", date: "2012-11-28", t: Date.parse("2012-11-28T00:00:00Z"), reward: 25 },
  { id: "h2", date: "2016-07-09", t: Date.parse("2016-07-09T00:00:00Z"), reward: 12.5 },
  { id: "h3", date: "2020-05-11", t: Date.parse("2020-05-11T00:00:00Z"), reward: 6.25 },
  { id: "h4", date: "2024-04-19", t: Date.parse("2024-04-19T00:00:00Z"), reward: 3.125 },
];

function halvingGuides(now = Date.now(), extra = []) {
  const events = [...BTC_HALVINGS, ...extra].filter((e) => Number.isFinite(e.t));
  events.sort((a, b) => a.t - b.t);
  let last = events[0] || null;
  let next = null;
  for (const ev of events) {
    if (ev.t <= now) last = ev;
    if (ev.t > now && !next) next = ev;
  }
  const weeksSince = last ? Math.floor((now - last.t) / (7 * 86400000)) : null;
  let phase = "unknown";
  let label = "반감기 정보 부족";
  if (weeksSince != null) {
    if (weeksSince < 40) {
      phase = "early";
      label = "반감기 초반 — 기반 구축";
    } else if (weeksSince < 80) {
      phase = "mid";
      label = "반감기 중반 — 추세 확인";
    } else if (weeksSince < 135) {
      phase = "late";
      label = "후반 — 변동성·이익실현 구간";
    } else {
      phase = "dca";
      label = "사이클 후반 — 장기 적립 관찰";
    }
  }
  return {
    events,
    last,
    next,
    weeksSince,
    phase,
    label,
    guides: [
      { weeks: 40, name: "이익실현 관찰 시작" },
      { weeks: 80, name: "후반 콜 구간" },
      { weeks: 135, name: "DCA 관찰 시작" },
    ],
  };
}

/**
 * TD Sequential — setup (9) + countdown (13).
 * Setup: close < close[i-4] (buy) or close > close[i-4] (sell) for 9 bars.
 */
function tdSequential(candles) {
  const n = candles?.length || 0;
  const setup = new Array(n).fill(0);
  const countdown = new Array(n).fill(0);
  const events = [];
  if (n < 6) return { setup, countdown, events };

  let buySetup = 0;
  let sellSetup = 0;
  let buyCount = 0;
  let sellCount = 0;
  let buyArmed = false;
  let sellArmed = false;

  for (let i = 0; i < n; i += 1) {
    const close = num(candles[i].close);
    const close4 = i >= 4 ? num(candles[i - 4].close) : null;
    if (close4 != null && close < close4) {
      buySetup += 1;
      sellSetup = 0;
    } else if (close4 != null && close > close4) {
      sellSetup += 1;
      buySetup = 0;
    } else {
      buySetup = 0;
      sellSetup = 0;
    }
    if (buySetup === 9) {
      setup[i] = 9;
      buyArmed = true;
      buyCount = 0;
      events.push({ index: i, date: candles[i].date, type: "buy_setup", value: 9 });
      buySetup = 0;
    } else if (buySetup > 0) {
      setup[i] = buySetup;
    }
    if (sellSetup === 9) {
      setup[i] = -9;
      sellArmed = true;
      sellCount = 0;
      events.push({ index: i, date: candles[i].date, type: "sell_setup", value: 9 });
      sellSetup = 0;
    } else if (sellSetup > 0 && setup[i] === 0) {
      setup[i] = -sellSetup;
    }

    const close2 = i >= 2 ? num(candles[i - 2].close) : null;
    if (buyArmed && close2 != null && close <= close2) {
      buyCount += 1;
      countdown[i] = buyCount;
      if (buyCount >= 13) {
        events.push({ index: i, date: candles[i].date, type: "buy_countdown", value: 13 });
        buyArmed = false;
        buyCount = 0;
      }
    } else if (sellArmed && close2 != null && close >= close2) {
      sellCount += 1;
      countdown[i] = -sellCount;
      if (sellCount >= 13) {
        events.push({ index: i, date: candles[i].date, type: "sell_countdown", value: 13 });
        sellArmed = false;
        sellCount = 0;
      }
    }
  }

  const lastEvent = events[events.length - 1] || null;
  return { setup, countdown, events, lastEvent };
}

/**
 * Simple cycle helpers: autocorrelation dominant period + half-cycle.
 * Returns nulls when the window is too short or variance is degenerate.
 */
function cycleHelpers(values, { minPeriod = 8, maxPeriod = 80 } = {}) {
  const arr = (values || []).filter((v) => Number.isFinite(num(v))).map(num);
  const n = arr.length;
  if (n < minPeriod * 3) {
    return { dominantPeriod: null, halfCycle: null, strength: null, note: "사이클 추정 표본 부족" };
  }
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const centered = arr.map((v) => v - mean);
  const var0 = centered.reduce((a, b) => a + b * b, 0);
  if (var0 <= 1e-12) {
    return { dominantPeriod: null, halfCycle: null, strength: null, note: "변동성 부족" };
  }
  let bestLag = minPeriod;
  let bestCorr = -Infinity;
  const hi = Math.min(maxPeriod, Math.floor(n / 3));
  for (let lag = minPeriod; lag <= hi; lag += 1) {
    let acc = 0;
    for (let i = 0; i < n - lag; i += 1) acc += centered[i] * centered[i + lag];
    const corr = acc / var0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return {
    dominantPeriod: bestLag,
    halfCycle: Math.max(2, Math.round(bestLag / 2)),
    strength: Math.round(clamp(bestCorr, -1, 1) * 1000) / 1000,
    note: `추정 주기 ${bestLag}봉 · 반주기 ${Math.max(2, Math.round(bestLag / 2))}봉`,
  };
}

function macdPack(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);
  const line = values.map((_, i) => (
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  ));
  const compact = line.filter((v) => v != null);
  const signalCompact = emaSeries(compact, signalPeriod);
  const signal = new Array(values.length).fill(null);
  let k = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] == null) continue;
    signal[i] = signalCompact[k];
    k += 1;
  }
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist, last: lastFinite(line), lastSignal: lastFinite(signal), lastHist: lastFinite(hist) };
}

function compute(candles, opts = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const closes = closesOf(rows);
  const rsiPeriod = opts.rsiPeriod || 14;
  const cmoPeriod = opts.cmoPeriod || 14;
  const rsi = rsiSeries(closes, rsiPeriod);
  const cmo = cmoSeries(closes, cmoPeriod);
  const ma5 = smaSeries(closes, 5);
  const ma20 = smaSeries(closes, 20);
  const ma50 = smaSeries(closes, 50);
  const ma100 = smaSeries(closes, 100);
  const ma200 = smaSeries(closes, 200);
  const macd = macdPack(closes);
  const td = tdSequential(rows);
  const bow = rainbow(closes, opts.rainbowPeriods);
  const cycle = cycleHelpers(closes, opts.cycle || {});
  const halvings = opts.includeHalving === false ? null : halvingGuides(opts.now, opts.extraHalvings);
  const lastClose = lastFinite(closes);
  return {
    candles: rows,
    closes,
    rsi,
    rsiLast: lastFinite(rsi),
    cmo,
    cmoLast: lastFinite(cmo),
    ma5,
    ma20,
    ma50,
    ma100,
    ma200,
    macd,
    rainbow: bow,
    td,
    cycle,
    halvings,
    lastClose,
    lastDate: rows.length ? rows[rows.length - 1].date : null,
  };
}

function zoneFromOsc(value, overbought = 70, oversold = 30) {
  if (!Number.isFinite(value)) return "neutral";
  if (value >= overbought) return "overbought";
  if (value <= oversold) return "oversold";
  return "neutral";
}

function currentZone(computed = {}) {
  const rsiZ = zoneFromOsc(computed.rsiLast, 70, 30);
  const cmoZ = zoneFromOsc(computed.cmoLast, 50, -50);
  const ma50 = lastFinite(computed.ma50);
  const ma200 = lastFinite(computed.ma200);
  let trend = "neutral";
  if (Number.isFinite(computed.lastClose) && Number.isFinite(ma50) && Number.isFinite(ma200)) {
    if (computed.lastClose >= ma50 && ma50 >= ma200) trend = "up";
    else if (computed.lastClose <= ma50 && ma50 <= ma200) trend = "down";
  }
  let zone = "neutral";
  if (rsiZ === "overbought" || cmoZ === "overbought") zone = "overbought";
  else if (rsiZ === "oversold" || cmoZ === "oversold") zone = "oversold";
  else if (trend === "up") zone = "uptrend";
  else if (trend === "down") zone = "downtrend";
  return {
    zone,
    rsi: rsiZ,
    cmo: cmoZ,
    trend,
    rsiValue: computed.rsiLast == null ? null : Math.round(computed.rsiLast * 10) / 10,
    cmoValue: computed.cmoLast == null ? null : Math.round(computed.cmoLast * 10) / 10,
  };
}

function buildSignals(computed = {}) {
  const signals = [];
  const zone = currentZone(computed);
  if (zone.rsi === "oversold") {
    signals.push({ key: "rsi_os", name: "RSI 과매도", score: 72, grade: "관심", action: "반등 관찰", detail: `RSI ${zone.rsiValue}` });
  } else if (zone.rsi === "overbought") {
    signals.push({ key: "rsi_ob", name: "RSI 과매수", score: 38, grade: "경계", action: "과열 관찰", detail: `RSI ${zone.rsiValue}` });
  }
  if (zone.cmo === "oversold") {
    signals.push({ key: "cmo_os", name: "CMO 과매도", score: 68, grade: "관심", action: "모멘텀 바닥 관찰", detail: `CMO ${zone.cmoValue}` });
  } else if (zone.cmo === "overbought") {
    signals.push({ key: "cmo_ob", name: "CMO 과매수", score: 40, grade: "경계", action: "모멘텀 과열 관찰", detail: `CMO ${zone.cmoValue}` });
  }
  const ma100 = lastFinite(computed.ma100);
  const ma200 = lastFinite(computed.ma200);
  if (Number.isFinite(ma100) && Number.isFinite(ma200)) {
    const cloudUp = ma100 >= ma200;
    signals.push({
      key: "ma_cloud",
      name: cloudUp ? "MA100/200 상승 구름" : "MA100/200 하락 구름",
      score: cloudUp ? 64 : 42,
      grade: cloudUp ? "우호" : "부담",
      action: "중기 추세 참고",
      detail: `MA100 ${Math.round(ma100)} / MA200 ${Math.round(ma200)}`,
    });
  }
  const tdEvent = computed.td?.lastEvent;
  if (tdEvent) {
    const bull = String(tdEvent.type).startsWith("buy");
    signals.push({
      key: `td_${tdEvent.type}`,
      name: bull ? "TD Sequential 매수 카운트" : "TD Sequential 매도 카운트",
      score: bull ? 70 : 36,
      grade: bull ? "관심" : "경계",
      action: "카운트 완성 여부 확인",
      detail: `${tdEvent.type} @ ${tdEvent.date || tdEvent.index}`,
    });
  }
  if (computed.cycle?.dominantPeriod) {
    signals.push({
      key: "cycle",
      name: "사이클 추정",
      score: 55,
      grade: "참고",
      action: "주기 대비 위치 확인",
      detail: computed.cycle.note,
    });
  }
  if (computed.halvings?.label) {
    signals.push({
      key: "halving",
      name: "반감기 가이드",
      score: 52,
      grade: "참고",
      action: "사이클 국면만 참고",
      detail: `${computed.halvings.label} (${computed.halvings.weeksSince ?? "-"}주)`,
    });
  }
  signals.sort((a, b) => b.score - a.score);
  return {
    ranked: signals,
    recommended: signals[0] || null,
    zone,
  };
}

/**
 * accuracy(records)
 * records: [{ expected: 'up'|'down'|'neutral', actual: 'up'|'down'|'neutral' }]
 */
function accuracy(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const judged = rows.filter((r) => r && r.expected != null && r.actual != null);
  const hits = judged.filter((r) => String(r.expected) === String(r.actual)).length;
  const total = judged.length;
  return {
    total,
    hits,
    misses: total - hits,
    rate: total ? Math.round((hits / total) * 1000) / 10 : null,
  };
}

function formatZonePrice(value) {
  const n = num(value);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 100) return String(Math.round(n));
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Pivot as used by nchart (`i`) and trading-platform (`index` / `value`). */
function gogoPivot(index, price, date) {
  return { i: index, index, price, value: price, date };
}

/**
 * findGoGoJeoTrend — APK / trading-platform.jsx reference.
 * ±2 pivot highs → 고점① = global highest → 고점② = later lower (tail high fallback).
 */
function findGoGoJeoTrend(data) {
  if (!data || data.length < 10) return null;
  const pivots = [];
  for (let i = 2; i < data.length - 2; i += 1) {
    const hi = num(data[i].high);
    if (
      Number.isFinite(hi) &&
      hi >= num(data[i - 1].high) &&
      hi >= num(data[i - 2].high) &&
      hi >= num(data[i + 1].high) &&
      hi >= num(data[i + 2].high)
    ) {
      pivots.push(gogoPivot(i, hi, data[i].date));
    }
  }
  if (!pivots.length) {
    let maxIndex = 0;
    for (let i = 1; i < data.length; i += 1) {
      if (num(data[i].high) > num(data[maxIndex].high)) maxIndex = i;
    }
    pivots.push(gogoPivot(maxIndex, num(data[maxIndex].high), data[maxIndex].date));
  }
  const highest = pivots.reduce((best, p) => (p.price > best.price ? p : best), pivots[0]);
  const after = pivots.filter((p) => p.index > highest.index + 3);
  let second = after.find((p) => p.price < highest.price);
  if (!second && after.length) second = after[0];
  if (!second) {
    const tailStart = Math.min(
      data.length - 1,
      highest.index + Math.max(5, Math.floor((data.length - highest.index) / 2))
    );
    let bestIdx = tailStart;
    for (let i = tailStart; i < data.length; i += 1) {
      if (num(data[i].high) > num(data[bestIdx].high)) bestIdx = i;
    }
    second = gogoPivot(bestIdx, num(data[bestIdx].high), data[bestIdx].date);
  }
  if (!second || second.index <= highest.index) return null;
  return { p1: highest, p2: second };
}

function projectGogoTrendValue(p1, p2, targetIndex) {
  if (!p1 || !p2) return null;
  const span = Math.max(1, p2.index - p1.index);
  const slope = (p2.price - p1.price) / span;
  return p1.price + slope * (targetIndex - p1.index);
}

function smaLast(data, period) {
  if (!data || data.length < period) return 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, d) => sum + num(d.close), 0) / period;
}

function avgVolumeLast(data, period = 20) {
  if (!data || !data.length) return 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, d) => sum + num(d.volume, 0), 0) / Math.max(1, slice.length);
}

/** Last-N simple RSI — matches trading-platform calcRSI (not Wilder). */
function calcGogoRSI(data, period = 14) {
  if (!data || data.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = data.length - period; i < data.length; i += 1) {
    const diff = num(data[i].close) - num(data[i - 1].close);
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function analyzeGogojeoLowStructure({ swingLows = [], lastIndex, low, close, ma20, isBreakout, trendLinePrice }) {
  const previousSwingLow = swingLows.filter((l) => l.index < lastIndex).slice(-2, -1)[0];
  const recentSwingLow = swingLows.filter((l) => l.index < lastIndex).slice(-1)[0];
  const lowChangeRate = previousSwingLow && recentSwingLow
    ? ((recentSwingLow.price - previousSwingLow.price) / previousSwingLow.price) * 100
    : 0;
  const isLowRising = Boolean(previousSwingLow && recentSwingLow && recentSwingLow.price > previousSwingLow.price);
  const isLowFlat = Boolean(previousSwingLow && recentSwingLow && Math.abs(lowChangeRate) <= 1.2);
  const isLowFalling = Boolean(previousSwingLow && recentSwingLow && recentSwingLow.price < previousSwingLow.price);
  const isLowProtected = recentSwingLow ? low > recentSwingLow.price : false;
  const isLowBreakdown = recentSwingLow ? low < recentSwingLow.price : false;
  const isCloseBelowRecentLow = recentSwingLow ? close < recentSwingLow.price : false;
  const isBelowMA20 = ma20 ? close < ma20 : false;
  const isBreakoutFailure = Boolean(isBreakout && isLowBreakdown);
  const isStrongRisk = Boolean(isLowBreakdown && isBelowMA20);

  let lowStructure = "저점 확인 필요";
  let lowSignal = "중립";
  let lowComment = "최근 저점 구조가 충분하지 않아 보조 확인이 필요합니다.";
  if (isBreakoutFailure) {
    lowStructure = "돌파 실패";
    lowSignal = "위험";
    lowComment = "고고저 돌파 이후 저점이 이탈되어 돌파 실패 가능성이 큽니다.";
  } else if (isStrongRisk || isCloseBelowRecentLow) {
    lowStructure = "저점 이탈";
    lowSignal = "강한 위험";
    lowComment = "최근 저점과 20일선 방어가 동시에 약해져 추가 하락 위험이 큽니다.";
  } else if (isLowBreakdown || isLowFalling) {
    lowStructure = "저점 하락";
    lowSignal = "위험";
    lowComment = "저점이 낮아지는 구조입니다. 매수세 방어 실패 가능성이 있어 관망이 우선입니다.";
  } else if (isLowRising && isLowProtected) {
    lowStructure = "저점 상승";
    lowSignal = "상승 전환";
    lowComment = "저점이 이전보다 높아져 매수세가 상단에서 유입되는 상승 전환 구조입니다.";
  } else if (isLowProtected) {
    lowStructure = "저점 보호";
    lowSignal = "관심";
    lowComment = "최근 저점은 방어 중입니다. 고고저 돌파와 거래량 동반 여부를 추가 확인합니다.";
  } else if (isLowFlat) {
    lowStructure = "저점 횡보";
    lowSignal = "관찰";
    lowComment = "저점이 크게 무너지지는 않았지만 상승 저점 구조는 아직 약합니다.";
  }
  return {
    previousSwingLow,
    recentSwingLow,
    lowChangeRate: Number(lowChangeRate.toFixed(2)),
    lowStructure,
    lowSignal,
    lowComment,
    isLowRising,
    isLowFlat,
    isLowFalling,
    isLowProtected,
    isLowBreakdown,
    isCloseBelowRecentLow,
    isBreakoutFailure,
    isStrongRisk,
    trendLinePrice,
  };
}

/** calcChartMethodSignals — closeBreak / freshBreak / lowHold / volume / RSI / MA. */
function calcGogoChartMethodSignals(data, p1, p2, swingLows) {
  const last = data[data.length - 1] || {};
  const prev = data[data.length - 2] || last;
  const currentClose = num(last.close, 0);
  const currentLow = num(last.low, 0);
  const prevClose = num(prev.close, 0);
  const ma20Last = smaLast(data, 20);
  const ma60Last = smaLast(data, 60);
  const volAvg20 = avgVolumeLast(data, 20);
  const volumeRatio = volAvg20 > 0 ? num(last.volume, 0) / volAvg20 : 0;
  const rsi14 = calcGogoRSI(data, 14);
  const trendLineNow = projectGogoTrendValue(p1, p2, data.length - 1);
  const trendLinePrev = projectGogoTrendValue(p1, p2, data.length - 2);
  const closeBreak = trendLineNow != null ? currentClose >= trendLineNow : false;
  const lowHold = trendLineNow != null ? currentLow >= trendLineNow : false;
  const prevBelow = trendLinePrev != null ? prevClose < trendLinePrev : false;
  const freshBreak = closeBreak && prevBelow;
  const distanceToGJ = trendLineNow ? ((currentClose - trendLineNow) / trendLineNow) * 100 : 0;
  const above20 = ma20Last ? currentClose >= ma20Last : false;
  const above60 = ma60Last ? currentClose >= ma60Last : false;
  const lowInfo = analyzeGogojeoLowStructure({
    swingLows,
    lastIndex: data.length - 1,
    low: currentLow,
    close: currentClose,
    ma20: ma20Last,
    isBreakout: closeBreak,
    trendLinePrice: trendLineNow,
  });

  let phase = "관찰";
  if (freshBreak && lowHold && volumeRatio >= 1.2) phase = "고고저 신규 돌파";
  else if (closeBreak && lowHold) phase = "돌파 후 유지";
  else if (distanceToGJ >= -2 && distanceToGJ < 0) phase = "돌파 임박";
  else if (above20 && !closeBreak) phase = "20선 지지 확인";
  else if (!above20) phase = "눌림 또는 약세";
  if (lowInfo.isBreakoutFailure) phase = "돌파 실패";

  return {
    closeBreak,
    lowHold,
    freshBreak,
    volumeRatio,
    rsi14,
    above20,
    above60,
    trendLineNow,
    distanceToGJ,
    phase,
    lowInfo,
    confirmedBreakout: Boolean(closeBreak && !lowInfo.isBreakoutFailure),
  };
}

function swingPivots(rows, kind) {
  const out = [];
  if (rows.length < 5) return out;
  for (let i = 2; i < rows.length - 2; i += 1) {
    const c = rows[i];
    if (kind === "high") {
      const hi = num(c.high);
      if (
        Number.isFinite(hi) &&
        hi >= num(rows[i - 1].high) && hi >= num(rows[i - 2].high) &&
        hi >= num(rows[i + 1].high) && hi >= num(rows[i + 2].high)
      ) {
        out.push(gogoPivot(i, hi, c.date));
      }
    } else {
      const lo = num(c.low);
      if (
        Number.isFinite(lo) &&
        lo <= num(rows[i - 1].low) && lo <= num(rows[i - 2].low) &&
        lo <= num(rows[i + 1].low) && lo <= num(rows[i + 2].low)
      ) {
        out.push(gogoPivot(i, lo, c.date));
      }
    }
  }
  return out;
}

/**
 * detectGogoZones — 고점대/저점대 overlay + 고고저 추세선.
 * Pair = findGoGoJeoTrend (highest then later lower). Breakout = calcChartMethodSignals.
 */
function detectGogoZones(candles = []) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 10) return null;
  const highs = swingPivots(rows, "high");
  const lows = swingPivots(rows, "low");
  const recentHighs = highs.slice(-3);
  const recentLows = lows.slice(-3);
  const trend = findGoGoJeoTrend(rows);
  if (!recentHighs.length && !trend) return null;

  const hiPrices = recentHighs.length ? recentHighs.map((x) => x.price) : highs.map((x) => x.price);
  const loSource = recentLows.length ? recentLows : rows.slice(-10).map((c, idx) => (
    gogoPivot(Math.max(0, rows.length - 10) + idx, num(c.low), c.date)
  ));
  const loPrices = loSource.map((x) => x.price);
  if (!hiPrices.length || !loPrices.length) return null;
  const highLow = Math.min(...hiPrices);
  const highHigh = Math.max(...hiPrices);
  const lowLow = Math.min(...loPrices);
  const lowHigh = Math.max(...loPrices);
  const declining = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[0].price;
  const risingLows = recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[0].price;

  const p1 = trend ? trend.p1 : null;
  const p2 = trend ? trend.p2 : null;
  const signals = p1 && p2 ? calcGogoChartMethodSignals(rows, p1, p2, lows) : null;
  const trendLinePrice = signals && Number.isFinite(signals.trendLineNow) ? signals.trendLineNow : null;
  const isBreakout = Boolean(signals && signals.closeBreak);

  let comment = `고점대 ${formatZonePrice(highLow)}~${formatZonePrice(highHigh)}, 저점대 ${formatZonePrice(lowLow)}~${formatZonePrice(lowHigh)}.`;
  if (p1 && p2) {
    comment += ` 고점① ${p1.date || ""} → 고점② ${p2.date || ""} (높은 고점 이후 낮은 고점).`;
  }
  if (declining && risingLows) comment += " 고점은 낮아지고 저점은 높아지는 고고저 수렴.";
  else if (declining) comment += " 하락 고점 구조 — 추세선 아래 압력.";
  else if (risingLows) comment += " 상승 저점 구조 — 지지가 우상향.";
  if (signals && Number.isFinite(trendLinePrice)) {
    const extras = [];
    if (signals.freshBreak) extras.push("신규(전일 종가 아래→오늘 위)");
    if (signals.lowHold) extras.push("저가 추세선 위 유지");
    if (signals.volumeRatio >= 1.2) extras.push(`거래량 ${signals.volumeRatio.toFixed(1)}배`);
    comment += ` ${signals.phase}. 종가 ${formatZonePrice(rows[rows.length - 1].close)} / 추세선 ${formatZonePrice(trendLinePrice)}.`;
    if (extras.length) comment += ` ${extras.join(" · ")}.`;
    if (signals.lowInfo && signals.lowInfo.lowComment) comment += ` ${signals.lowInfo.lowComment}`;
  }

  return {
    highLow,
    highHigh,
    lowLow,
    lowHigh,
    highDates: recentHighs.map((x) => x.date),
    lowDates: recentLows.map((x) => x.date),
    comment,
    zoneHigh: { low: highLow, high: highHigh },
    zoneLow: { low: lowLow, high: lowHigh },
    swingHighs: recentHighs,
    swingLows: recentLows,
    trendHigh1: p1,
    trendHigh2: p2,
    trendLinePrice,
    isBreakout,
    freshBreak: Boolean(signals && signals.freshBreak),
    lowHold: Boolean(signals && signals.lowHold),
    isBreakoutFailure: Boolean(signals && signals.lowInfo && signals.lowInfo.isBreakoutFailure),
    volumeRatio: signals ? signals.volumeRatio : 0,
    phase: signals ? signals.phase : "",
    confirmedBreakout: Boolean(signals && signals.confirmedBreakout),
    lowStructure: signals && signals.lowInfo ? signals.lowInfo.lowStructure : "",
    lowComment: signals && signals.lowInfo ? signals.lowInfo.lowComment : "",
  };
}

/**
 * personalAlerts — 급락 / 돌파 / 공포탐욕 / 뉴스 (분석 전용, 주문 없음)
 * Mirrors the iOS MarketSignalEngine thresholds for the web chart banner.
 */
function personalAlerts(input = {}) {
  const name = String(input.name || input.code || "");
  const code = String(input.code || "");
  const changeRate = num(input.changeRate, 0);
  const lastClose = num(input.lastClose);
  const recentHigh = num(input.recentHigh);
  const fearGreed = Number.isFinite(Number(input.fearGreed)) ? Number(input.fearGreed) : null;
  const titles = Array.isArray(input.newsTitles) ? input.newsTitles : [];
  const out = [];

  if (changeRate <= -5) {
    out.push({ kind: "crash", label: "급락", severity: "high", opportunity: false, title: `${name} 급락`, detail: `등락률 ${changeRate.toFixed(1)}%` });
  } else if (changeRate <= -3) {
    out.push({ kind: "crash", label: "급락", severity: "medium", opportunity: false, title: `${name} 급락`, detail: `등락률 ${changeRate.toFixed(1)}%` });
  }

  if (Number.isFinite(lastClose) && lastClose > 0 && Number.isFinite(recentHigh) && recentHigh > 0 && lastClose >= recentHigh * 1.002) {
    out.push({ kind: "breakout", label: "돌파", severity: "high", opportunity: true, title: `${name} 돌파`, detail: "최근 고점 상향 돌파" });
  }

  if (fearGreed != null) {
    if (fearGreed <= 22) {
      out.push({ kind: "fearGreed", label: "공포탐욕", severity: fearGreed <= 12 ? "high" : "medium", opportunity: true, title: "극단적 공포", detail: `공포탐욕 ${fearGreed}` });
    } else if (fearGreed >= 78) {
      out.push({ kind: "fearGreed", label: "공포탐욕", severity: fearGreed >= 88 ? "high" : "medium", opportunity: false, title: "극단적 탐욕", detail: `공포탐욕 ${fearGreed}` });
    }
  }

  const riskWords = ["급락", "적자", "수사", "리콜", "제재", "감소", "하향", "위험"];
  const oppWords = ["수주", "실적", "돌파", "승인", "계약", "흑자", "상향", "급등"];
  const hits = titles.filter((t) => {
    const s = String(t || "");
    return (name && s.includes(name)) || (code && s.includes(code));
  });
  if (hits.length) {
    const risk = hits.some((t) => riskWords.some((w) => t.includes(w)));
    const opp = hits.some((t) => oppWords.some((w) => t.includes(w)));
    if (risk || opp) {
      out.push({ kind: "news", label: "뉴스", severity: risk ? "high" : "medium", opportunity: opp && !risk, title: `${name} 뉴스`, detail: hits[0] });
    }
  }

  return out;
}

/** chartlab-compatible volume profile. candles oldest→newest. */
function volumeProfile(candles = [], bins = 24) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 8) return null;
  const lo = Math.min(...rows.map((c) => num(c.low)));
  const hi = Math.max(...rows.map((c) => num(c.high)));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const step = (hi - lo) / bins;
  const vols = Array.from({ length: bins }, () => 0);
  for (const c of rows) {
    const tp = (num(c.high) + num(c.low) + num(c.close)) / 3;
    let idx = Math.floor((tp - lo) / step);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    vols[idx] += num(c.volume, 0);
  }
  const total = vols.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best = 0;
  for (let i = 1; i < vols.length; i += 1) if (vols[i] > vols[best]) best = i;
  const close = num(rows[rows.length - 1].close);
  let above = 0;
  let below = 0;
  const mids = vols.map((vol, i) => {
    const mid = lo + (i + 0.5) * step;
    if (mid > close) above += vol;
    else below += vol;
    return { mid, vol };
  });
  const poc = lo + (best + 0.5) * step;
  const hvn = [...mids].sort((a, b) => b.vol - a.vol).slice(0, 3).map((x) => x.mid);
  const abovePct = Math.round((above / total) * 100);
  const belowPct = Math.round((below / total) * 100);
  const pos = close > poc ? "최대 매물대 위 (하방 지지)" : close < poc ? "최대 매물대 아래 (상방 부담)" : "최대 매물대 내부";
  return {
    poc,
    hvn,
    abovePct,
    belowPct,
    comment: `매물대 POC ${formatZonePrice(poc)} · ${pos} · 상방 ${abovePct}% / 하방 ${belowPct}%`,
  };
}

const NIndicators = {
  smaSeries,
  emaSeries,
  rsiSeries,
  rsiLast,
  cmoSeries,
  rainbow,
  rainbowPeriods: RAINBOW_PERIODS,
  rainbowColors: RAINBOW_COLORS,
  halvingGuides,
  BTC_HALVINGS,
  tdSequential,
  cycleHelpers,
  compute,
  buildSignals,
  currentZone,
  accuracy,
  personalAlerts,
  detectGogoZones,
  findGoGoJeoTrend,
  volumeProfile,
};

export default NIndicators;
export {
  smaSeries,
  emaSeries,
  rsiSeries,
  rsiLast,
  cmoSeries,
  rainbow,
  halvingGuides,
  tdSequential,
  cycleHelpers,
  compute,
  buildSignals,
  currentZone,
  accuracy,
  personalAlerts,
  detectGogoZones,
  findGoGoJeoTrend,
  volumeProfile,
};
