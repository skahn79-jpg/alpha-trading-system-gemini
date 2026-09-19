/**
 * cvdd.js — 파괴지수 (CVDD: Coin Value Days Destroyed) — 비트코인(BTC-USD) 전용
 *   TradingView "CVDD [Da_Prof]" 벤치마킹. overlay=true → 가격 캔들차트 위에 직접 표시.
 *   라인 3종: cvddTop(보라=천장확장 CVDD×top_factor) / cvddBottom(파랑=지지 CVDD×1.2) / cvddTeal(청록=CVDD).
 *   음영(핵심): 고점(천장)=빨강, 저점(바닥)=녹색 세로 음영.
 *   원본은 온체인(실현시총·총전송량) 필요하나 CoinAI는 가격만 → 가격 멱법칙 회귀 + 소스 top_factor 공식으로 근사.
 *   window.CVDD.compute(candles) → { atTop[], atBottom[], cvddTop[], cvddBottom[], cvddTeal[], posn[] }
 */
(function (global) {
  'use strict';
  const GENESIS = Date.UTC(2009, 0, 3);
  function topFactor(tMs) { return Math.pow(10, -8.1775e-13 * tMs + 1.965805965); }   // 소스 공식 (slope/intercept 100%)
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  function compute(candles) {
    const N = candles.length, empty = () => Array(N).fill(NaN), ef = () => Array(N).fill(false);
    if (N < 60) return { atTop: ef(), atBottom: ef(), cvddTop: empty(), cvddBottom: empty(), cvddTeal: empty(), posn: empty() };
    const C = candles.map(c => c.close), H = candles.map(c => c.high), L = candles.map(c => c.low), T = candles.map(c => c.ts);
    const lnC = C.map(v => Math.log(v));
    const x = T.map(t => Math.log(Math.max(1, (t - GENESIS) / 86400000)));   // ln(days since genesis)

    // 가격 멱법칙 회귀: lnC ~ a + b*x (사이클 중심선)
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let i = 0; i < N; i++) { if (isNaN(lnC[i])) continue; sx += x[i]; sy += lnC[i]; sxx += x[i] * x[i]; sxy += x[i] * lnC[i]; n++; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    const mid = x.map(xi => a + b * xi);
    const resid = lnC.map((v, i) => v - mid[i]);
    let maxR = -Infinity, minR = Infinity;
    for (const r of resid) { if (isNaN(r)) continue; if (r > maxR) maxR = r; if (r < minR) minR = r; }
    const topThr = 0.80 * maxR, botThr = 0.80 * minR;   // 천장/바닥 음영 임계(로그 잔차 백분위)

    const atTop = ef(), atBottom = ef(), cvddTop = empty(), cvddBottom = empty(), cvddTeal = empty(), posn = empty();
    for (let i = 0; i < N; i++) {
      if (isNaN(resid[i])) continue;
      const teal = Math.exp(mid[i] + minR);            // CVDD(청록) = 깊은 바닥 모델
      cvddTeal[i] = teal;
      cvddBottom[i] = teal * 1.2;                       // 지지(파랑) = CVDD×1.2 (소스 shift)
      cvddTop[i] = teal * topFactor(T[i]);             // 천장(보라) = CVDD×top_factor
      atTop[i] = maxR > 0 && resid[i] >= topThr;        // 고점 → 빨강 음영
      atBottom[i] = minR < 0 && resid[i] <= botThr;     // 저점 → 녹색 음영
      const rng = (maxR - minR) || 1;
      posn[i] = clamp((resid[i] - minR) / rng, 0, 1) * 100;   // 0=바닥 100=천장 (참고값)
    }
    return { atTop, atBottom, cvddTop, cvddBottom, cvddTeal, posn };
  }

  global.CVDD = { compute, topFactor };
})(typeof window !== 'undefined' ? window : globalThis);
