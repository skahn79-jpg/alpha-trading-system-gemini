/**
 * bubble.js — 거품지수 (Bubble) — 전 코인 공통 오실레이터 (CoinAI 전용)
 *   TradingView "Bubble Risk Indicator" © MADALGO 벤치마킹. MPL 2.0 (상업 이용 가능).
 *   원본: https://mozilla.org/MPL/2.0/
 *   핵심 = 20주 이동평균(SMA) 대비 종가 이격률(%). 위로 뜰수록 과열(거품), 0 아래는 저평가.
 *     dev% = (close − SMA20_weekly) / SMA20_weekly × 100
 *   원본 request.security(.., 'W', sma20) → CoinAI는 주봉 캔들(opts.weeklyCandles)에서 20-SMA 산출 후
 *     현재 봉(일/주/월) 타임스탬프에 "직전 완성 주봉 SMA"를 매핑. 주봉이 없으면 입력 캔들을 7일 버킷으로 리샘플.
 *   색상(원본 그라데이션 1:1 이식): 0+ 보라→주황(33)→빨강(66+), 0 아래 하늘→남색.
 *   window.BUBBLE.compute(candles, { weeklyCandles }) → { dev[], colors[], posn[], thr:{mid,high} }
 */
(function (global) {
  'use strict';
  const LEN = 20;                 // 20주 SMA
  const MID = 33, HIGH = 66;      // 과열/거품 임계(원본 색 전환점)
  // 원본 입력 색 (rgb)
  const LOW = [170, 66, 255];     // Low Risk (보라)
  const MED = [255, 165, 0];      // Medium Risk (주황)
  const HOT = [252, 61, 61];      // High Risk (빨강)
  const BLOW = [173, 216, 230];   // Below 0 Low (하늘)
  const BLOW_EX = [0, 0, 128];    // Below 0 Extreme (남색)
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => Math.round(a + t * (b - a));

  // 이격률 → 그라데이션 색 (원본 gradient_color 이식: colorTransition = sqrt(min(|dev|,100))/10)
  function bubbleColor(dev) {
    if (dev == null || isNaN(dev)) return '';
    let r, g, b;
    if (dev >= 0) {
      const t = Math.sqrt(Math.min(dev, 100)) / 10;
      if (dev < MID) { r = lerp(LOW[0], MED[0], t); g = lerp(LOW[1], MED[1], t); b = lerp(LOW[2], MED[2], t); }
      else if (dev < HIGH) { r = lerp(MED[0], HOT[0], t); g = lerp(MED[1], HOT[1], t); b = lerp(MED[2], HOT[2], t); }
      else { r = HOT[0]; g = HOT[1]; b = HOT[2]; }
    } else {
      const t = Math.sqrt(Math.min(Math.abs(dev), 100)) / 10;
      r = lerp(BLOW[0], BLOW_EX[0], t); g = lerp(BLOW[1], BLOW_EX[1], t); b = lerp(BLOW[2], BLOW_EX[2], t);
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function sma(arr, n) {
    const o = Array(arr.length).fill(NaN); let s = 0, c = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]; if (!isNaN(v)) { s += v; c++; }
      if (i >= n) { const p = arr[i - n]; if (!isNaN(p)) { s -= p; c--; } }
      if (i >= n - 1 && c === n) o[i] = s / n;
    }
    return o;
  }

  // 주봉 데이터가 없을 때: 입력 캔들을 7일(epoch) 버킷으로 묶어 주봉 근사 (종가=버킷 마지막 종가)
  function resampleWeekly(candles) {
    const WK = 7 * 86400000, out = []; let id = null, cur = null;
    for (const c of candles) {
      const bid = Math.floor(c.ts / WK);
      if (bid !== id) { if (cur) out.push(cur); cur = { ts: c.ts, close: c.close }; id = bid; }
      else cur.close = c.close;
    }
    if (cur) out.push(cur);
    return out;
  }

  function compute(candles, opts) {
    opts = opts || {};
    const N = candles.length, empty = () => Array(N).fill(NaN), cols = () => Array(N).fill('');
    if (N < 2) return { dev: empty(), colors: cols(), posn: empty(), thr: { mid: MID, high: HIGH } };

    // 1) 주봉 시리즈 + 20주 SMA
    let wk = opts.weeklyCandles;
    if (!Array.isArray(wk) || wk.length < LEN + 1) wk = resampleWeekly(candles);
    const wC = wk.map(c => c.close), wT = wk.map(c => c.ts);
    const wS = sma(wC, LEN);

    // 2) 각 봉 ts → 직전(포함) 주봉의 SMA20 매핑
    const dev = empty(), colors = cols();
    let j = 0;
    for (let i = 0; i < N; i++) {
      const t = candles[i].ts;
      while (j + 1 < wT.length && wT[j + 1] <= t) j++;
      const m = (wT[j] <= t) ? wS[j] : NaN;
      const c = candles[i].close;
      if (isNaN(m) || m === 0 || isNaN(c)) continue;
      const d = (c - m) / m * 100;
      dev[i] = d; colors[i] = bubbleColor(d);
    }

    // 3) posn: 자기 이력 내 0~100 위치 (참고용 게이지)
    const posn = empty();
    let mn = Infinity, mx = -Infinity;
    for (const d of dev) { if (isNaN(d)) continue; if (d < mn) mn = d; if (d > mx) mx = d; }
    const rng = (mx - mn) || 1;
    for (let i = 0; i < N; i++) if (!isNaN(dev[i])) posn[i] = clamp((dev[i] - mn) / rng, 0, 1) * 100;

    return { dev, colors, posn, thr: { mid: MID, high: HIGH } };
  }

  global.BUBBLE = { compute, bubbleColor };
})(typeof window !== 'undefined' ? window : globalThis);
