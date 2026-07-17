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

// ===== 최신 분석 기법 =====

/** 일목균형표 — 전환선(9)/기준선(26)/구름(선행스팬 A·B) 대비 현재가 위치 */
function ichimoku(candlesNewestFirst) {
  const c = candlesNewestFirst;
  if (!Array.isArray(c) || c.length < 78) return null; // 52 + 26(선행) 필요

  const hl = (offset, period) => {
    const win = c.slice(offset, offset + period);
    if (win.length < period) return null;
    return (Math.max(...win.map((x) => num(x.high))) + Math.min(...win.map((x) => num(x.low)))) / 2;
  };

  const tenkan = hl(0, 9);
  const kijun = hl(0, 26);
  // 현재 캔들 위치의 구름 = 26일 전에 계산된 선행스팬
  const spanA = (() => {
    const t = hl(26, 9);
    const k = hl(26, 26);
    return t !== null && k !== null ? (t + k) / 2 : null;
  })();
  const spanB = hl(26, 52);
  if (tenkan === null || kijun === null || spanA === null || spanB === null) return null;

  const close = num(c[0].close);
  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);
  const status = close > cloudTop ? 'above_cloud' : close < cloudBottom ? 'below_cloud' : 'in_cloud';

  return {
    tenkan: Math.round(tenkan),
    kijun: Math.round(kijun),
    spanA: Math.round(spanA),
    spanB: Math.round(spanB),
    status,
    tkCross: tenkan > kijun ? 'bullish' : tenkan < kijun ? 'bearish' : 'flat',
  };
}

/** ADX(14) — 추세 강도 + 방향(DI) (Wilder) */
function adx(candlesNewestFirst, period = 14) {
  const c = [...candlesNewestFirst].reverse(); // 과거→현재
  if (c.length < period * 2 + 1) return null;

  const trs = []; const plusDMs = []; const minusDMs = [];
  for (let i = 1; i < c.length; i += 1) {
    const high = num(c[i].high); const low = num(c[i].low);
    const prevHigh = num(c[i - 1].high); const prevLow = num(c[i - 1].low);
    const prevClose = num(c[i - 1].close);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i += 1) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };

  const trS = smooth(trs); const pS = smooth(plusDMs); const mS = smooth(minusDMs);
  const dxs = [];
  for (let i = 0; i < trS.length; i += 1) {
    if (!trS[i]) continue;
    const pdi = (pS[i] / trS[i]) * 100;
    const mdi = (mS[i] / trS[i]) * 100;
    const sum = pdi + mdi;
    dxs.push(sum ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }
  if (dxs.length < period) return null;
  let adxVal = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i += 1) {
    adxVal = (adxVal * (period - 1) + dxs[i]) / period;
  }
  const last = trS.length - 1;
  const plusDI = trS[last] ? (pS[last] / trS[last]) * 100 : 0;
  const minusDI = trS[last] ? (mS[last] / trS[last]) * 100 : 0;

  return {
    adx: Math.round(adxVal * 10) / 10,
    plusDI: Math.round(plusDI * 10) / 10,
    minusDI: Math.round(minusDI * 10) / 10,
    strength: adxVal >= 40 ? 'very_strong' : adxVal >= 25 ? 'strong' : adxVal >= 20 ? 'moderate' : 'weak',
    direction: plusDI > minusDI ? 'up' : plusDI < minusDI ? 'down' : 'flat',
  };
}

/** OBV — 거래량 기반 자금 흐름 (20일 전 대비 추세) */
function obv(candlesNewestFirst, lookback = 20) {
  const c = [...candlesNewestFirst].reverse(); // 과거→현재
  if (c.length < lookback + 2) return null;
  let value = 0;
  const series = [0];
  for (let i = 1; i < c.length; i += 1) {
    const close = num(c[i].close); const prev = num(c[i - 1].close);
    if (close > prev) value += num(c[i].volume);
    else if (close < prev) value -= num(c[i].volume);
    series.push(value);
  }
  const nowVal = series[series.length - 1];
  const pastVal = series[series.length - 1 - lookback];
  const trend = nowVal > pastVal ? 'rising' : nowVal < pastVal ? 'falling' : 'flat';
  return { value: nowVal, changeOverPeriod: nowVal - pastVal, lookback, trend };
}

/** ATR(14) — 변동성 (가격 대비 %) */
function atr(candlesNewestFirst, period = 14) {
  const c = [...candlesNewestFirst].reverse();
  if (c.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < c.length; i += 1) {
    const high = num(c[i].high); const low = num(c[i].low); const prevClose = num(c[i - 1].close);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    val = (val * (period - 1) + trs[i]) / period;
  }
  const close = num(c[c.length - 1].close);
  return {
    value: Math.round(val),
    pct: close ? Math.round((val / close) * 1000) / 10 : null,
  };
}

/** 피보나치 되돌림 — 최근 스윙 고저 기준 주요 레벨과 현재가 근접 레벨 */
function fibonacci(candlesNewestFirst, lookback = 60) {
  const win = candlesNewestFirst.slice(0, Math.min(lookback, candlesNewestFirst.length));
  if (win.length < 20) return null;
  const high = Math.max(...win.map((c) => num(c.high)));
  const low = Math.min(...win.map((c) => num(c.low)));
  if (high <= low) return null;
  const range = high - low;
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = ratios.map((r) => ({ ratio: r, price: Math.round(high - range * r) }));
  const close = num(win[0].close);
  let nearest = null;
  for (const lv of levels) {
    const dist = Math.abs(close - lv.price) / close * 100;
    if (!nearest || dist < nearest.dist) nearest = { ratio: lv.ratio, price: lv.price, dist: Math.round(dist * 10) / 10 };
  }
  return { high, low, levels, nearest };
}

// ===== 스펙터 지표 시트 기반 추가 지표 =====

/** 스토캐스틱 슬로우 — 스펙터 69 시그널 설정 (Length 20, Smooth K 12, Smooth D 6). "우물" = 깊은 과매도 */
function stochasticSlow(candlesNewestFirst, kPeriod = 20, smoothK = 12, smoothD = 6) {
  const c = [...candlesNewestFirst].reverse(); // 과거→현재
  const need = kPeriod + smoothK + smoothD;
  if (c.length < need) return null;

  const rawK = [];
  for (let i = kPeriod - 1; i < c.length; i += 1) {
    const win = c.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...win.map((x) => num(x.high)));
    const lo = Math.min(...win.map((x) => num(x.low)));
    rawK.push(hi > lo ? ((num(c[i].close) - lo) / (hi - lo)) * 100 : 50);
  }
  const smooth = (arr, p) => {
    const out = [];
    for (let i = p - 1; i < arr.length; i += 1) {
      out.push(arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
    }
    return out;
  };
  const slowK = smooth(rawK, smoothK);
  const slowD = smooth(slowK, smoothD);
  if (!slowK.length || !slowD.length) return null;
  const k = slowK[slowK.length - 1];
  const d = slowD[slowD.length - 1];
  return {
    k: Math.round(k * 10) / 10,
    d: Math.round(d * 10) / 10,
    // 시트: "바닥에서는 스토캐스틱 슬로우가 우물로 들어감"
    inWell: k <= 20 && d <= 20,
    status: k <= 20 ? 'oversold' : k >= 80 ? 'overbought' : 'neutral',
  };
}

/** Mayer Multiple — 종가/200일선 배율 (시트: 사이클 변곡점 밴드) */
function mayerMultiple(closesNewestFirst, period = 200) {
  if (closesNewestFirst.length < period) return null;
  const ma = sma(closesNewestFirst, period);
  if (!ma) return null;
  const multiple = num(closesNewestFirst[0]) / ma;
  return {
    multiple: Math.round(multiple * 100) / 100,
    ma200: Math.round(ma),
    // 주식용 해석: 1 미만 = 200일선 아래(기회 구간 후보), 1.5+ = 과열 주의
    zone: multiple < 0.75 ? 'deep_value' : multiple < 1 ? 'below_ma' : multiple < 1.5 ? 'normal' : multiple < 2 ? 'hot' : 'extreme',
  };
}

/** Williams VixFix — 공포 스파이크로 바닥 포착 (CM_Williams_Vix_Fix) */
function williamsVixFix(candlesNewestFirst, period = 22, bbPeriod = 20, bbMult = 2) {
  const c = [...candlesNewestFirst].reverse();
  if (c.length < period + bbPeriod) return null;
  const wvf = [];
  for (let i = period - 1; i < c.length; i += 1) {
    const win = c.slice(i - period + 1, i + 1);
    const highestClose = Math.max(...win.map((x) => num(x.close)));
    wvf.push(highestClose ? ((highestClose - num(c[i].low)) / highestClose) * 100 : 0);
  }
  const recent = wvf.slice(-bbPeriod);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const std = Math.sqrt(recent.reduce((a, b) => a + ((b - mean) ** 2), 0) / recent.length);
  const upperBand = mean + bbMult * std;
  const value = wvf[wvf.length - 1];
  return {
    value: Math.round(value * 10) / 10,
    upperBand: Math.round(upperBand * 10) / 10,
    // 시트: "녹색이 급격히 튀어 오르면 바닥 혹은 큰 기회"
    spike: value >= upperBand,
  };
}

/** SuperTrend(10, 3) — ATR 기반 추세 시그널 */
function supertrend(candlesNewestFirst, period = 10, mult = 3) {
  const c = [...candlesNewestFirst].reverse();
  if (c.length < period + 2) return null;

  const trs = [];
  for (let i = 1; i < c.length; i += 1) {
    const high = num(c[i].high); const low = num(c[i].low); const prevClose = num(c[i - 1].close);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const atrs = [atrVal];
  for (let i = period; i < trs.length; i += 1) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
    atrs.push(atrVal);
  }

  let direction = 1; // 1 상승 / -1 하락
  let upper = 0; let lower = 0;
  let flipped = false;
  for (let i = period; i < c.length; i += 1) {
    const mid = (num(c[i].high) + num(c[i].low)) / 2;
    const a = atrs[i - period];
    const basicUpper = mid + mult * a;
    const basicLower = mid - mult * a;
    const prevClose = num(c[i - 1].close);
    upper = basicUpper < upper || prevClose > upper ? basicUpper : upper || basicUpper;
    lower = basicLower > lower || prevClose < lower ? basicLower : lower || basicLower;
    const close = num(c[i].close);
    const prevDirection = direction;
    if (close > upper) direction = 1;
    else if (close < lower) direction = -1;
    flipped = i === c.length - 1 && direction !== prevDirection;
  }
  return {
    direction: direction === 1 ? 'up' : 'down',
    line: Math.round(direction === 1 ? lower : upper),
    flipped, // 마지막 봉에서 추세 전환 발생
  };
}

/** Elliott Wave Oscillator — SMA5-SMA35 (중간가격) */
function ewo(candlesNewestFirst) {
  if (candlesNewestFirst.length < 35) return null;
  const median = candlesNewestFirst.map((c) => (num(c.high) + num(c.low)) / 2);
  const s5 = sma(median, 5);
  const s35 = sma(median, 35);
  if (s5 === null || s35 === null) return null;
  const value = s5 - s35;
  const close = num(candlesNewestFirst[0].close);
  return {
    value: Math.round(value),
    pct: close ? Math.round((value / close) * 1000) / 10 : null,
    trend: value > 0 ? 'bullish' : value < 0 ? 'bearish' : 'flat',
  };
}

/** MFI(14) — 거래량 가중 RSI (시트: RSI+MFI 조합) */
function mfi(candlesNewestFirst, period = 14) {
  const c = [...candlesNewestFirst].reverse();
  if (c.length < period + 1) return null;
  let pos = 0; let neg = 0;
  for (let i = c.length - period; i < c.length; i += 1) {
    const tp = (num(c[i].high) + num(c[i].low) + num(c[i].close)) / 3;
    const prevTp = (num(c[i - 1].high) + num(c[i - 1].low) + num(c[i - 1].close)) / 3;
    const flow = tp * num(c[i].volume);
    if (tp > prevTp) pos += flow;
    else if (tp < prevTp) neg += flow;
  }
  if (!neg) return { value: 100, status: 'overbought' };
  const value = 100 - 100 / (1 + pos / neg);
  return {
    value: Math.round(value * 10) / 10,
    status: value <= 20 ? 'oversold' : value >= 80 ? 'overbought' : 'neutral',
  };
}

/** MA Slope — 20일선 기울기 각도 (시트: 단기 추세 판단) */
function maSlope(closesNewestFirst, period = 20, atrValue = null) {
  if (closesNewestFirst.length < period + 5) return null;
  const maNow = sma(closesNewestFirst, period);
  const maPrev = sma(closesNewestFirst.slice(5), period);
  if (maNow === null || maPrev === null) return null;
  const denom = atrValue || Math.abs(maNow) * 0.01 || 1;
  const angle = Math.atan((maNow - maPrev) / denom) * (180 / Math.PI);
  return {
    angle: Math.round(angle * 10) / 10,
    trend: angle > 10 ? 'rising' : angle < -10 ? 'falling' : 'flat',
  };
}

/** Minervini Trend Template — 8개 조건 체크리스트 */
function minervini(candlesNewestFirst) {
  const closes = candlesNewestFirst.map((c) => num(c.close));
  if (closes.length < 200) return null;
  const close = closes[0];
  const ma50 = sma(closes, 50);
  const ma150 = sma(closes, 150);
  const ma200 = sma(closes, 200);
  const ma200Month = closes.length >= 220 ? sma(closes.slice(20), 200) : null;
  const yearSlice = candlesNewestFirst.slice(0, Math.min(252, candlesNewestFirst.length));
  const w52High = Math.max(...yearSlice.map((c) => num(c.high)));
  const w52Low = Math.min(...yearSlice.map((c) => num(c.low)));

  const checks = [
    { name: '주가 > 150일선', pass: ma150 !== null && close > ma150 },
    { name: '주가 > 200일선', pass: ma200 !== null && close > ma200 },
    { name: '150일선 > 200일선', pass: ma150 !== null && ma200 !== null && ma150 > ma200 },
    { name: '200일선 상승 중', pass: ma200 !== null && ma200Month !== null && ma200 > ma200Month },
    { name: '50일선 > 150·200일선', pass: ma50 !== null && ma150 !== null && ma200 !== null && ma50 > ma150 && ma50 > ma200 },
    { name: '주가 > 50일선', pass: ma50 !== null && close > ma50 },
    { name: '52주 저가 대비 +25% 이상', pass: w52Low > 0 && close >= w52Low * 1.25 },
    { name: '52주 고가의 75% 이상', pass: w52High > 0 && close >= w52High * 0.75 },
  ];
  const passed = checks.filter((x) => x.pass).length;
  return {
    passed,
    total: checks.length,
    checks,
    verdict: passed >= 7 ? 'strong_uptrend' : passed >= 5 ? 'uptrend' : passed >= 3 ? 'mixed' : 'downtrend',
  };
}

// ===== 커뮤니티 앱(UsStockAI/CoinAI) 벤치마킹 지표 =====

function wilderRsiSeries(closes, period = 14) {
  const out = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let ag = 0; let al = 0;
  for (let i = 1; i <= period; i += 1) {
    const ch = closes[i] - closes[i - 1];
    ag += Math.max(ch, 0); al += Math.max(-ch, 0);
  }
  ag /= period; al /= period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i += 1) {
    const ch = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(ch, 0)) / period;
    al = (al * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/**
 * 다중 지표 다이버전스 감지 — 피벗 저점/고점에서 가격과 지표(RSI·MACD·OBV·MFI)의 방향 불일치 검사.
 * 강세: 가격은 더 낮은 저점(LL)인데 지표는 더 높은 저점(HL) → 반전 상승 신호.
 */
function divergence(candlesNewestFirst, { pivot = 5, maxBars = 100, recentBars = 30 } = {}) {
  const c = [...candlesNewestFirst].reverse(); // 과거→현재
  const N = c.length;
  if (N < pivot * 4 + 30) return null;
  const C = c.map((x) => num(x.close));
  const H = c.map((x) => num(x.high));
  const L = c.map((x) => num(x.low));
  const V = c.map((x) => num(x.volume));

  // 지표 시리즈
  const rsiS = wilderRsiSeries(C, 14);
  const emaS = (arr, p) => {
    const k = 2 / (p + 1); const out = [arr[0]];
    for (let i = 1; i < arr.length; i += 1) out.push(arr[i] * k + out[i - 1] * (1 - k));
    return out;
  };
  const macdS = emaS(C, 12).map((v, i) => v - emaS(C, 26)[i]);
  const obvS = [0];
  for (let i = 1; i < N; i += 1) obvS.push(obvS[i - 1] + (C[i] > C[i - 1] ? V[i] : C[i] < C[i - 1] ? -V[i] : 0));
  const mfiS = Array(N).fill(null);
  for (let i = 14; i < N; i += 1) {
    let pos = 0; let neg = 0;
    for (let j = i - 13; j <= i; j += 1) {
      const tp = (H[j] + L[j] + C[j]) / 3; const prev = (H[j - 1] + L[j - 1] + C[j - 1]) / 3;
      const mf = tp * V[j];
      if (tp > prev) pos += mf; else if (tp < prev) neg += mf;
    }
    mfiS[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  const inds = [
    { name: 'RSI', arr: rsiS },
    { name: 'MACD', arr: macdS },
    { name: 'OBV', arr: obvS },
    { name: 'MFI', arr: mfiS },
  ];

  // 종가 피벗 (좌우 pivot봉 대비 극값, 최근 pivot봉은 미확정이라 제외)
  const pivLows = []; const pivHighs = [];
  for (let i = pivot; i < N - pivot; i += 1) {
    let lo = true; let hi = true;
    for (let j = i - pivot; j <= i + pivot; j += 1) {
      if (j === i) continue;
      if (C[j] <= C[i]) lo = false;
      if (C[j] >= C[i]) hi = false;
    }
    if (lo) pivLows.push(i);
    if (hi) pivHighs.push(i);
  }

  const detect = (pivots, isBull) => {
    if (pivots.length < 2) return null;
    const i2 = pivots[pivots.length - 1];
    if (N - 1 - i2 > recentBars) return null; // 최근 신호만
    const names = [];
    for (const ind of inds) {
      const a = ind.arr;
      if (a[i2] === null || Number.isNaN(a[i2])) continue;
      for (let q = pivots.length - 2; q >= 0; q -= 1) {
        const i1 = pivots[q];
        if (i2 - i1 > maxBars) break;
        if (i2 - i1 <= pivot || a[i1] === null || Number.isNaN(a[i1])) continue;
        const priceLL = C[i2] < C[i1];
        const indHL = a[i2] > a[i1];
        if (isBull ? (priceLL && indHL) : (!priceLL && !indHL && C[i2] > C[i1] && a[i2] < a[i1])) {
          names.push(ind.name);
          break;
        }
      }
    }
    return names.length >= 2 ? { indicators: names, barsAgo: N - 1 - i2 } : null;
  };

  return {
    bullish: detect(pivLows, true),
    bearish: detect(pivHighs, false),
  };
}

/**
 * 스토캐스틱 히트맵 — 길이 10~200의 스토캐스틱 20개 중 강세(≥50) 개수.
 * 시트 규칙: "파란색 도배 = 바닥, 빨간색 도배 = 고점"
 */
function stochHeatmap(candlesNewestFirst, { inc = 10, maxLines = 20 } = {}) {
  const c = [...candlesNewestFirst].reverse();
  const N = c.length;
  if (N < inc * 2 + 4) return null;
  const H = c.map((x) => num(x.high));
  const L = c.map((x) => num(x.low));
  const C = c.map((x) => num(x.close));

  let bullCount = 0; let valid = 0;
  for (let k = 0; k < maxLines; k += 1) {
    const len = inc * (k + 1);
    if (len >= N) break;
    let hi = -Infinity; let lo = Infinity;
    for (let j = N - len; j < N; j += 1) {
      if (H[j] > hi) hi = H[j];
      if (L[j] < lo) lo = L[j];
    }
    if (hi <= lo) continue;
    const v = ((C[N - 1] - lo) / (hi - lo)) * 100;
    valid += 1;
    if (v >= 50) bullCount += 1;
  }
  if (!valid) return null;
  const pct = Math.round((bullCount / valid) * 100);
  return {
    bullCount,
    total: valid,
    pct,
    zone: pct <= 15 ? 'bottom_paint' : pct >= 85 ? 'top_paint' : 'mixed',
  };
}

/**
 * 고통지수(Pain Meter) — 50봉 고점 대비 하락%(5봉 평균) + UO(7/14/28) 강세 다이버전스로 바닥 판정
 */
function painMeter(candlesNewestFirst, { length = 50, smooth = 5, spacing = 10 } = {}) {
  const c = [...candlesNewestFirst].reverse();
  const N = c.length;
  if (N < length + spacing * 3 + 2) return null;
  const C = c.map((x) => num(x.close));
  const H = c.map((x) => num(x.high));
  const L = c.map((x) => num(x.low));

  // 고점 대비 손실% (smooth봉 평균)
  let lossSum = 0;
  for (let s = 0; s < smooth; s += 1) {
    const i = N - 1 - s;
    let hm = -Infinity;
    for (let j = i - length + 1; j <= i; j += 1) if (H[j] > hm) hm = H[j];
    lossSum += hm > 0 ? (100 * (hm - L[i])) / hm : 0;
  }
  const loss = Math.round((lossSum / smooth) * 10) / 10;

  // Ultimate Oscillator
  const bp = Array(N).fill(0); const tr = Array(N).fill(0);
  for (let i = 1; i < N; i += 1) {
    const pc = C[i - 1]; const lo = Math.min(L[i], pc); const hi = Math.max(H[i], pc);
    bp[i] = C[i] - lo; tr[i] = hi - lo;
  }
  const sumN = (arr, p, i) => {
    let s = 0;
    for (let k = i - p + 1; k <= i; k += 1) s += arr[k];
    return s;
  };
  const uoAt = (i) => {
    const t7 = sumN(tr, 7, i); const t14 = sumN(tr, 14, i); const t28 = sumN(tr, 28, i);
    if (!(t7 > 0 && t14 > 0 && t28 > 0)) return null;
    return (100 * (4 * (sumN(bp, 7, i) / t7) + 2 * (sumN(bp, 14, i) / t14) + sumN(bp, 28, i) / t28)) / 7;
  };
  const lowestN = (arr, p, end) => {
    let m = Infinity;
    for (let k = end - p + 1; k <= end; k += 1) if (arr[k] < m) m = arr[k];
    return m;
  };
  const i = N - 1;
  const v1 = lowestN(C, spacing, i);
  const v2 = lowestN(C, spacing, i - spacing);
  const uoNow = uoAt(i); const uoPrev = uoAt(i - spacing);
  const bullDiv = uoNow !== null && uoPrev !== null && v1 < v2 && uoNow > uoPrev && uoNow < 50;

  return { loss, bullDiv };
}

/**
 * Bull&Bear Power Trend — BearTrend = -(50봉 최고가 - 종가)/ATR(5, Wilder RMA).
 * 0 근처 = 파동 꼭대기(고가 근접), 깊은 음수 = 파동 바닥. 히스토리 백분위로 구간 판정.
 */
function bullBearPower(candlesNewestFirst, { length = 50, atrPeriod = 5 } = {}) {
  const c = [...candlesNewestFirst].reverse();
  const N = c.length;
  if (N < length + atrPeriod + 10) return null;
  const C = c.map((x) => num(x.close));
  const H = c.map((x) => num(x.high));
  const L = c.map((x) => num(x.low));

  // Wilder RMA ATR(5) 시리즈
  const atrS = Array(N).fill(null);
  let a = 0;
  for (let i = 1; i <= atrPeriod; i += 1) {
    a += Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
  }
  a /= atrPeriod;
  atrS[atrPeriod] = a;
  for (let i = atrPeriod + 1; i < N; i += 1) {
    const trv = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    a = (a * (atrPeriod - 1) + trv) / atrPeriod;
    atrS[i] = a;
  }

  const series = [];
  for (let i = length - 1; i < N; i += 1) {
    if (!atrS[i]) continue;
    let hi = -Infinity;
    for (let j = i - length + 1; j <= i; j += 1) if (H[j] > hi) hi = H[j];
    series.push(-((hi - C[i]) / atrS[i]));
  }
  if (series.length < 20) return null;
  const value = series[series.length - 1];
  const rank = series.filter((v) => v <= value).length / series.length;
  return {
    value: Math.round(value * 100) / 100,
    percentile: Math.round(rank * 100),
    zone: rank >= 0.85 ? 'wave_top' : rank <= 0.15 ? 'wave_bottom' : 'mid',
  };
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

  const ichi = ichimoku(candles);
  if (ichi) {
    if (ichi.status === 'above_cloud') { score += 6; signals.push('일목 구름대 상단'); }
    if (ichi.status === 'below_cloud') { score -= 6; signals.push('일목 구름대 하단'); }
    if (ichi.tkCross === 'bullish' && ichi.status !== 'below_cloud') { score += 3; signals.push('전환선>기준선'); }
  }

  const adxData = adx(candles);
  if (adxData) {
    if (adxData.strength !== 'weak' && adxData.direction === 'up') { score += 5; signals.push(`ADX ${adxData.adx} 상승 추세`); }
    if (adxData.strength !== 'weak' && adxData.direction === 'down') { score -= 5; signals.push(`ADX ${adxData.adx} 하락 추세`); }
  }

  const obvData = obv(candles);
  if (obvData) {
    if (obvData.trend === 'rising') { score += 4; signals.push('OBV 자금 유입'); }
    if (obvData.trend === 'falling') { score -= 4; signals.push('OBV 자금 유출'); }
  }

  const atrData = atr(candles);
  if (atrData && atrData.pct !== null && atrData.pct >= 5) {
    score -= 2;
    signals.push(`변동성 높음 (ATR ${atrData.pct}%)`);
  }

  // 스펙터 지표 시트 기반
  const stochSlow = stochasticSlow(candles);
  if (stochSlow) {
    if (stochSlow.inWell) { score += 6; signals.push(`스토캐스틱 슬로우 우물 진입 (K ${stochSlow.k})`); }
    if (stochSlow.status === 'overbought') { score -= 4; signals.push(`스토캐스틱 슬로우 과매수 ${stochSlow.k}`); }
  }

  const mayer = mayerMultiple(closes);
  if (mayer) {
    if (mayer.zone === 'deep_value') { score += 5; signals.push(`200일선 대비 저평가 (Mayer ${mayer.multiple})`); }
    if (mayer.zone === 'below_ma') { score += 2; signals.push('200일선 하단 (기회 구간 후보)'); }
    if (mayer.zone === 'hot' || mayer.zone === 'extreme') { score -= 5; signals.push(`200일선 과열 (Mayer ${mayer.multiple})`); }
  }

  const vixFix = williamsVixFix(candles);
  if (vixFix && vixFix.spike) { score += 5; signals.push(`VixFix 공포 스파이크 ${vixFix.value} (바닥 신호 후보)`); }

  const st = supertrend(candles);
  if (st) {
    if (st.direction === 'up') { score += 4; signals.push(st.flipped ? 'SuperTrend 상승 전환!' : 'SuperTrend 상승 추세'); }
    else { score -= 4; signals.push(st.flipped ? 'SuperTrend 하락 전환!' : 'SuperTrend 하락 추세'); }
    if (st.flipped) score += st.direction === 'up' ? 3 : -3;
  }

  const ewoData = ewo(candles);
  if (ewoData) {
    if (ewoData.trend === 'bullish') { score += 2; signals.push('EWO 상승 모멘텀'); }
    if (ewoData.trend === 'bearish') { score -= 2; signals.push('EWO 하락 모멘텀'); }
  }

  const mfiData = mfi(candles);
  if (mfiData) {
    if (mfiData.status === 'oversold') { score += 4; signals.push(`MFI 과매도 ${mfiData.value} (자금 유입 대기)`); }
    if (mfiData.status === 'overbought') { score -= 4; signals.push(`MFI 과매수 ${mfiData.value}`); }
  }

  const slope = maSlope(closes, 20, atrData?.value);
  if (slope) {
    if (slope.trend === 'rising') { score += 3; signals.push(`20일선 기울기 상승 (${slope.angle}°)`); }
    if (slope.trend === 'falling') { score -= 3; signals.push(`20일선 기울기 하락 (${slope.angle}°)`); }
  }

  const minerviniData = minervini(candles);
  if (minerviniData) {
    if (minerviniData.verdict === 'strong_uptrend') { score += 6; signals.push(`미너비니 추세 템플릿 ${minerviniData.passed}/8 통과`); }
    else if (minerviniData.verdict === 'uptrend') { score += 3; signals.push(`미너비니 추세 템플릿 ${minerviniData.passed}/8`); }
    else if (minerviniData.verdict === 'downtrend') { score -= 4; signals.push(`미너비니 추세 템플릿 ${minerviniData.passed}/8 (하락 구조)`); }
  }

  // 커뮤니티 앱 벤치마킹 지표
  const div = divergence(candles);
  if (div?.bullish) { score += 8; signals.push(`강세 다이버전스 (${div.bullish.indicators.join('·')})`); }
  if (div?.bearish) { score -= 8; signals.push(`약세 다이버전스 (${div.bearish.indicators.join('·')})`); }

  const heatmap = stochHeatmap(candles);
  if (heatmap) {
    if (heatmap.zone === 'bottom_paint') { score += 6; signals.push(`히트맵 바닥 도배 (강세 ${heatmap.bullCount}/${heatmap.total})`); }
    if (heatmap.zone === 'top_paint') { score -= 6; signals.push(`히트맵 고점 도배 (강세 ${heatmap.bullCount}/${heatmap.total})`); }
  }

  const pain = painMeter(candles);
  if (pain?.bullDiv) { score += 5; signals.push(`고통지수 바닥 다이버전스 (하락폭 ${pain.loss}%)`); }

  const bbp = bullBearPower(candles);
  if (bbp) {
    if (bbp.zone === 'wave_bottom') { score += 4; signals.push(`파동 바닥권 (BBP ${bbp.value})`); }
    if (bbp.zone === 'wave_top') { score -= 3; signals.push(`파동 고점권 (BBP ${bbp.value})`); }
  }

  const fib = fibonacci(candles);

  // ── 골든/데드크로스 50/200일선 (KospiAI 이식) ──
  let goldenCross = null;
  if (closes.length >= 205) {
    const ma50Now = sma(closes, 50);
    const ma200Now = sma(closes, 200);
    const ma50Prev = sma(closes.slice(5), 50);
    const ma200Prev = sma(closes.slice(5), 200);
    if ([ma50Now, ma200Now, ma50Prev, ma200Prev].every((v) => Number.isFinite(v))) {
      const nowAbove = ma50Now > ma200Now;
      const prevAbove = ma50Prev > ma200Prev;
      const recentCross = nowAbove !== prevAbove ? (nowAbove ? 'golden' : 'dead') : null;
      goldenCross = {
        ma50: Math.round(ma50Now * 100) / 100,
        ma200: Math.round(ma200Now * 100) / 100,
        state: nowAbove ? 'above' : 'below',
        recentCross,
      };
      if (recentCross === 'golden') { score += 10; signals.push('골든크로스(50/200일선) 발생'); }
      else if (recentCross === 'dead') { score -= 10; signals.push('데드크로스(50/200일선) 발생'); }
      else if (nowAbove) { score += 3; signals.push('50일선>200일선 장기 상승 구조'); }
    }
  }

  // ── 인간지표: 고점 대비 손실률 구간 (KospiAI 이식) ──
  // 최근 1년 최고가 대비 현재가 낙폭으로 심리 구간을 판정
  let drawdown = null;
  {
    const ddSlice = candles.slice(0, Math.min(252, candles.length));
    const peak = ddSlice.length ? Math.max(...ddSlice.map((c) => num(c.high))) : null;
    if (peak && peak > 0) {
      const ddPct = Math.round(((close - peak) / peak) * 1000) / 10;
      let zone; let label;
      if (ddPct >= -5) { zone = 'peak'; label = '고점권 — 신규 진입 신중'; }
      else if (ddPct >= -15) { zone = 'pullback'; label = '조정 구간'; }
      else if (ddPct >= -30) { zone = 'accumulate'; label = '저점 접근 — 분할 매수 관찰'; }
      else if (ddPct >= -45) { zone = 'bottom'; label = '저점 구간 — 강한 매수 후보'; }
      else { zone = 'capitulation'; label = '투매 구간 — 추세 확인 필수'; }
      drawdown = { peak, pct: ddPct, zone, label };
      if (zone === 'bottom') { score += 5; signals.push(`고점 대비 ${Math.abs(ddPct)}% 하락 — 저점 구간`); }
      if (zone === 'capitulation') { signals.push(`고점 대비 ${Math.abs(ddPct)}% 하락 — 투매 구간`); }
    }
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
    ichimoku: ichi,
    adx: adxData,
    obv: obvData,
    atr: atrData,
    fibonacci: fib,
    stochasticSlow: stochSlow,
    mayer,
    vixFix,
    supertrend: st,
    ewo: ewoData,
    mfi: mfiData,
    maSlope: slope,
    minervini: minerviniData,
    divergence: div,
    stochHeatmap: heatmap,
    painMeter: pain,
    bullBearPower: bbp,
    week52: { high: w52High, low: w52Low, position: w52Position },
    goldenCross,
    drawdown,
    volume: { latest: num(latest.volume), avg20: avgVol20, ratio: volRatio },
    confluence: signals.length,
    signals,
    summary: `${badge} · ${action} · 점수 ${score}점 · 컨플루언스 ${signals.length}개${dist20 !== null ? ` · 20일선 이격 ${dist20.toFixed(1)}%` : ''}`,
  };
}

module.exports = {
  analyzeCandles, macd, stochastic, detectPatterns, supportResistance,
  ichimoku, adx, obv, atr, fibonacci, rsi, bollinger, sma,
  stochasticSlow, mayerMultiple, williamsVixFix, supertrend, ewo, mfi, maSlope, minervini,
  divergence, stochHeatmap, painMeter, bullBearPower,
};
