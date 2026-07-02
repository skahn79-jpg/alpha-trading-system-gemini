/**
 * ALPHA TRADING SYSTEM - lightweight candle analysis module
 * CommonJS module used by server.js
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(0, period);
  return slice.reduce((a, b) => a + num(b), 0) / period;
}

function pct(a, b) {
  if (!b) return null;
  return ((a - b) / b) * 100;
}

function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i += 1) {
    const diff = num(closes[i]) - num(closes[i + 1]);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (!avgLoss) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - (100 / (1 + rs))) * 10) / 10;
}

function bollinger(closes, period = 20, mult = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const slice = closes.slice(0, period).map(num);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + ((b - mid) ** 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  return {
    upper: Math.round(upper),
    mid: Math.round(mid),
    lower: Math.round(lower),
    bandwidth: mid ? Math.round(((upper - lower) / mid) * 1000) / 10 : null,
    position: upper > lower ? Math.round(((num(closes[0]) - lower) / (upper - lower)) * 1000) / 10 : null,
  };
}

function signalBadge(score, rsiVal) {
  if (score >= 70 || (rsiVal !== null && rsiVal <= 30 && score >= 55)) return '매수';
  if (score <= 40 || (rsiVal !== null && rsiVal >= 70 && score <= 55)) return '매도';
  return '중립';
}

// ===== 강화 지표 =====
// closes는 최신순(newest first)으로 들어오므로 내부에서 과거→현재로 뒤집어 계산

function emaSeries(valuesOldestFirst, period) {
  if (!Array.isArray(valuesOldestFirst) || valuesOldestFirst.length < period) return null;
  const k = 2 / (period + 1);
  const out = [];
  let prev = valuesOldestFirst.slice(0, period).reduce((a, b) => a + num(b), 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < valuesOldestFirst.length; i += 1) {
    prev = num(valuesOldestFirst[i]) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function macd(closesNewestFirst, fast = 12, slow = 26, signalPeriod = 9) {
  const closes = [...closesNewestFirst].reverse().map(num);
  if (closes.length < slow + signalPeriod) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  if (!emaFast || !emaSlow) return null;
  const macdLine = [];
  for (let i = slow - 1; i < closes.length; i += 1) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }
  const signalSeries = emaSeries(macdLine, signalPeriod);
  if (!signalSeries) return null;
  const lastIdx = macdLine.length - 1;
  const macdVal = macdLine[lastIdx];
  const signalVal = signalSeries[lastIdx];
  const prevHist = lastIdx >= 1 && signalSeries[lastIdx - 1] != null
    ? macdLine[lastIdx - 1] - signalSeries[lastIdx - 1]
    : null;
  const hist = macdVal - signalVal;
  let cross = null;
  if (prevHist !== null) {
    if (prevHist <= 0 && hist > 0) cross = 'golden';
    else if (prevHist >= 0 && hist < 0) cross = 'dead';
  }
  return {
    macd: Math.round(macdVal * 100) / 100,
    signal: Math.round(signalVal * 100) / 100,
    histogram: Math.round(hist * 100) / 100,
    cross,
    trend: hist > 0 ? 'bullish' : hist < 0 ? 'bearish' : 'flat',
  };
}

function stochastic(candlesNewestFirst, kPeriod = 14, dPeriod = 3) {
  if (!Array.isArray(candlesNewestFirst) || candlesNewestFirst.length < kPeriod + dPeriod) return null;
  const kValues = [];
  for (let offset = 0; offset < dPeriod; offset += 1) {
    const window = candlesNewestFirst.slice(offset, offset + kPeriod);
    if (window.length < kPeriod) return null;
    const hi = Math.max(...window.map((c) => num(c.high)));
    const lo = Math.min(...window.map((c) => num(c.low)));
    const close = num(candlesNewestFirst[offset].close);
    kValues.push(hi > lo ? ((close - lo) / (hi - lo)) * 100 : 50);
  }
  const k = kValues[0];
  const d = kValues.reduce((a, b) => a + b, 0) / kValues.length;
  const status = k <= 20 ? 'oversold' : k >= 80 ? 'overbought' : 'neutral';
  return { k: Math.round(k * 10) / 10, d: Math.round(d * 10) / 10, status };
}

function detectPatterns(candlesNewestFirst) {
  const patterns = [];
  const c0 = candlesNewestFirst[0];
  const c1 = candlesNewestFirst[1];
  const c2 = candlesNewestFirst[2];
  if (!c0) return patterns;

  const open0 = num(c0.open); const close0 = num(c0.close);
  const high0 = num(c0.high); const low0 = num(c0.low);
  const body0 = Math.abs(close0 - open0);
  const range0 = high0 - low0 || 1;
  const upperWick0 = high0 - Math.max(open0, close0);
  const lowerWick0 = Math.min(open0, close0) - low0;
  const bull0 = close0 >= open0;

  // 도지: 몸통이 전체 범위의 10% 이하
  if (body0 / range0 <= 0.1) patterns.push({ name: '도지', type: 'neutral', note: '방향성 탐색 — 추세 전환 가능성 주시' });
  // 망치형: 아래꼬리가 몸통의 2배 이상 + 위꼬리 짧음
  if (lowerWick0 >= body0 * 2 && upperWick0 <= body0 * 0.5 && body0 / range0 <= 0.35) {
    patterns.push({ name: bull0 ? '망치형' : '교수형', type: bull0 ? 'bullish' : 'bearish', note: bull0 ? '하락 후 반등 시도 신호' : '상승 후 피로 신호' });
  }
  // 유성형(슈팅스타): 위꼬리가 몸통의 2배 이상 + 아래꼬리 짧음
  if (upperWick0 >= body0 * 2 && lowerWick0 <= body0 * 0.5 && body0 / range0 <= 0.35) {
    patterns.push({ name: '유성형', type: 'bearish', note: '고점 매도 압력 신호' });
  }

  if (c1) {
    const open1 = num(c1.open); const close1 = num(c1.close);
    const bull1 = close1 >= open1;
    // 장악형: 오늘 몸통이 어제 몸통을 완전히 감쌈
    if (!bull1 && bull0 && close0 >= open1 && open0 <= close1) {
      patterns.push({ name: '상승 장악형', type: 'bullish', note: '매수세가 전일 하락을 흡수' });
    }
    if (bull1 && !bull0 && open0 >= close1 && close0 <= open1) {
      patterns.push({ name: '하락 장악형', type: 'bearish', note: '매도세가 전일 상승을 흡수' });
    }
  }

  if (c1 && c2) {
    const bulls = [c2, c1, c0].map((c) => num(c.close) > num(c.open));
    const rising = num(c1.close) > num(c2.close) && num(c0.close) > num(c1.close);
    const falling = num(c1.close) < num(c2.close) && num(c0.close) < num(c1.close);
    if (bulls.every(Boolean) && rising) patterns.push({ name: '적삼병', type: 'bullish', note: '3일 연속 상승 양봉 — 상승 추세 강화' });
    if (bulls.every((b) => !b) && falling) patterns.push({ name: '흑삼병', type: 'bearish', note: '3일 연속 하락 음봉 — 하락 추세 강화' });
  }

  return patterns;
}

function supportResistance(candlesNewestFirst, lookback = 60) {
  const window = candlesNewestFirst.slice(0, Math.min(lookback, candlesNewestFirst.length));
  if (window.length < 10) return null;
  const close = num(window[0].close);
  const pivotHighs = [];
  const pivotLows = [];
  // 좌우 2봉보다 높/낮은 피벗 탐색 (최신 2봉 제외)
  for (let i = 2; i < window.length - 2; i += 1) {
    const hi = num(window[i].high);
    const lo = num(window[i].low);
    if (hi > num(window[i - 1].high) && hi > num(window[i - 2].high)
      && hi > num(window[i + 1].high) && hi > num(window[i + 2].high)) pivotHighs.push(hi);
    if (lo < num(window[i - 1].low) && lo < num(window[i - 2].low)
      && lo < num(window[i + 1].low) && lo < num(window[i + 2].low)) pivotLows.push(lo);
  }
  const resistance = pivotHighs.filter((p) => p > close).sort((a, b) => a - b)[0] ?? null;
  const support = pivotLows.filter((p) => p < close).sort((a, b) => b - a)[0] ?? null;
  return {
    support,
    resistance,
    supportDist: support ? Math.round(((close - support) / close) * 1000) / 10 : null,
    resistanceDist: resistance ? Math.round(((resistance - close) / close) * 1000) / 10 : null,
  };
}

function analyzeCandles(rawCandles = []) {
  const candles = [...rawCandles]
    .filter(c => c && Number.isFinite(num(c.close)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))); // newest first

  if (candles.length < 5) {
    return { grade: 'N/A', score: 0, summary: '분석 가능한 일봉 데이터가 부족합니다.', signals: [] };
  }

  const closes = candles.map(c => num(c.close));
  const volumes = candles.map(c => num(c.volume));
  const latest = candles[0];
  const close = num(latest.close);

  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ma120 = sma(closes, 120);
  const avgVol20 = sma(volumes, Math.min(20, volumes.length)) || 0;

  const dist20 = ma20 ? pct(close, ma20) : null;
  const dist60 = ma60 ? pct(close, ma60) : null;
  const volRatio = avgVol20 ? num(latest.volume) / avgVol20 : null;

  const isBullCandle = close >= num(latest.open);
  const lowerWick = Math.min(num(latest.open), close) - num(latest.low);
  const body = Math.abs(close - num(latest.open)) || 1;
  const longLowerWick = lowerWick / body >= 1.5;
  const aboveMa20 = ma20 ? close >= ma20 : false;
  const aboveMa60 = ma60 ? close >= ma60 : false;
  const normalAlignment = ma5 && ma20 && ma60 ? ma5 >= ma20 && ma20 >= ma60 : false;

  const signals = [];
  let score = 50;

  if (normalAlignment) { score += 12; signals.push('정배열 초기/유지'); }
  if (aboveMa20) { score += 8; signals.push('20일선 상단 유지'); }
  if (aboveMa60) { score += 8; signals.push('60일선 상단 유지'); }
  if (isBullCandle && longLowerWick) { score += 10; signals.push('긴 밑꼬리 양봉 지지 액션'); }
  if (volRatio && volRatio >= 1.5) { score += 8; signals.push(`거래량 증가 ${volRatio.toFixed(1)}배`); }
  if (dist20 !== null && dist20 > 10) { score -= 10; signals.push('20일선 이격 과열 주의'); }
  if (dist60 !== null && dist60 > 30) { score -= 15; signals.push('60일선 이격 30% 근접/초과 주의'); }
  if (ma20 && close < ma20) { score -= 8; signals.push('20일선 하단 이탈'); }
  if (ma60 && close < ma60) { score -= 10; signals.push('60일선 하단 이탈'); }

  const rsi14 = rsi(closes, 14);
  const bb = bollinger(closes, 20, 2);
  if (rsi14 !== null && rsi14 <= 30) { score += 5; signals.push(`RSI 과매도 ${rsi14}`); }
  if (rsi14 !== null && rsi14 >= 70) { score -= 5; signals.push(`RSI 과매수 ${rsi14}`); }
  if (bb && bb.position !== null && bb.position <= 15) { score += 4; signals.push('볼린저 하단 근접'); }
  if (bb && bb.position !== null && bb.position >= 85) { score -= 4; signals.push('볼린저 상단 근접'); }

  const macdData = macd(closes);
  if (macdData) {
    if (macdData.cross === 'golden') { score += 8; signals.push('MACD 골든크로스'); }
    if (macdData.cross === 'dead') { score -= 8; signals.push('MACD 데드크로스'); }
    if (macdData.cross === null && macdData.trend === 'bullish') { score += 3; signals.push('MACD 상승 흐름'); }
    if (macdData.cross === null && macdData.trend === 'bearish') { score -= 3; signals.push('MACD 하락 흐름'); }
  }

  const stoch = stochastic(candles);
  if (stoch) {
    if (stoch.status === 'oversold') { score += 4; signals.push(`스토캐스틱 과매도 ${stoch.k}`); }
    if (stoch.status === 'overbought') { score -= 4; signals.push(`스토캐스틱 과매수 ${stoch.k}`); }
  }

  const patterns = detectPatterns(candles);
  for (const p of patterns) {
    if (p.type === 'bullish') { score += 5; signals.push(`캔들패턴: ${p.name}`); }
    if (p.type === 'bearish') { score -= 5; signals.push(`캔들패턴: ${p.name}`); }
  }

  const sr = supportResistance(candles);
  if (sr) {
    if (sr.supportDist !== null && sr.supportDist <= 3) { score += 4; signals.push(`지지선 근접 (${sr.supportDist}%)`); }
    if (sr.resistanceDist !== null && sr.resistanceDist <= 3) { score -= 3; signals.push(`저항선 근접 (${sr.resistanceDist}%)`); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  const action = score >= 80 ? '관심 진입 후보' : score >= 65 ? '분할 관찰 후보' : score >= 50 ? '중립/대기' : '리스크 관리 우선';
  const badge = signalBadge(score, rsi14);

  const yearSlice = candles.slice(0, Math.min(252, candles.length));
  const w52High = yearSlice.length ? Math.max(...yearSlice.map((c) => num(c.high))) : null;
  const w52Low = yearSlice.length ? Math.min(...yearSlice.map((c) => num(c.low))) : null;
  const w52Position = w52High && w52Low && w52High > w52Low
    ? Math.round(((close - w52Low) / (w52High - w52Low)) * 1000) / 10
    : null;

  return {
    grade,
    score,
    action,
    signalBadge: badge,
    baseLine: ma20 ? '20일선' : ma5 ? '5일선' : '데이터 부족',
    movingAverages: { ma5, ma20, ma60, ma120 },
    distance: { ma20: dist20, ma60: dist60 },
    rsi: rsi14,
    bollinger: bb,
    macd: macdData,
    stochastic: stoch,
    patterns,
    supportResistance: sr,
    week52: { high: w52High, low: w52Low, position: w52Position },
    volume: { latest: num(latest.volume), avg20: avgVol20, ratio: volRatio },
    confluence: signals.length,
    signals,
    summary: `${badge} · ${action} · 점수 ${score}점 · 컨플루언스 ${signals.length}개${dist20 !== null ? ` · 20일선 이격 ${dist20.toFixed(1)}%` : ''}`,
  };
}

module.exports = { analyzeCandles, macd, stochastic, detectPatterns, supportResistance, rsi, bollinger, sma };
