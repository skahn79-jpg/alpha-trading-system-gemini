/**
 * bbp.js — 불앤베어 (Bull&Bear) — 전 코인 공통 오실레이터 (CoinAI)
 *   TradingView "BULL BEAR POWER TREND" (BBPT) © Dreadblitz 벤치마킹 — 원본의 "빨간 파동"만 사용.
 *   원본 빨간선:  BearTrend2 = -1 × (highest(high,50) − close) / atr(5)   (항상 0 이하)
 *     · 종가가 50봉 최고가에 근접 → 0 근처(파동 꼭대기)
 *     · 종가가 최고가에서 크게 하락 → 큰 음수(파동 바닥)
 *   ⚠ Pine atr(5) = Wilder RMA(5) (단순평균 아님) → 파동을 원본과 1:1로 맞추려면 RMA 필수.
 *
 *   커스텀 색(우리 목표): 수평선(임계 THR=-2) 기준 2색
 *     · val ≥ -2 → 🔴 빨강 = 고점권 (close가 최근 고점에 근접)
 *     · val < -2 → 🟢 녹색 = 저점권 (고점 대비 크게 하락)
 *   봉별 colors[] 를 만들어 chart.js gradArea 파이프라인(거품지수와 동일)이 칠한다.
 *
 *   window.BBP.compute(candles) → { val[], colors[], thr }
 */
(function (global) {
  'use strict';
  var HH_LEN = 50;          // highest(high, 50)
  var ATR_LEN = 5;          // atr(5) = RMA(TR, 5)
  var THR = -2;             // 수평선(임계) — 위=빨강(고점)/아래=녹색(저점). 원본 niv_22(-2) 레벨과 동일.
  var RED = 'rgb(248,81,73)';    // #f85149 고점권
  var GREEN = 'rgb(63,185,80)';  // #3fb950 저점권

  // Wilder RMA (Pine atr 기본)
  function rma(arr, n) {
    var o = new Array(arr.length).fill(NaN), s = 0, c = 0, prev = NaN;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (isNaN(v)) continue;
      if (isNaN(prev)) {
        s += v; c++;
        if (c === n) { prev = s / n; o[i] = prev; }
      } else {
        prev = (prev * (n - 1) + v) / n;
        o[i] = prev;
      }
    }
    return o;
  }

  function compute(candles) {
    var N = candles ? candles.length : 0;
    var val = new Array(N).fill(NaN), colors = new Array(N).fill('');
    if (N < HH_LEN + 1) return { val: val, colors: colors, thr: THR };

    var H = candles.map(function (c) { return c.high; });
    var L = candles.map(function (c) { return c.low; });
    var C = candles.map(function (c) { return c.close; });

    // True Range → ATR(5) (RMA)
    var tr = new Array(N).fill(NaN);
    for (var i = 0; i < N; i++) {
      tr[i] = i === 0 ? (H[i] - L[i])
        : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    }
    var atr = rma(tr, ATR_LEN);

    for (var j = 0; j < N; j++) {
      var a = atr[j];
      if (j < HH_LEN - 1 || !a || isNaN(a)) continue;   // 워밍업(highest 50 / atr 5)
      var hh = -Infinity;
      for (var k = j - HH_LEN + 1; k <= j; k++) { if (H[k] > hh) hh = H[k]; }
      var v = -1 * (hh - C[j]) / a;                      // 원본 빨간선 BearTrend2
      val[j] = v;
      colors[j] = (v >= THR) ? RED : GREEN;              // 커스텀 2색
    }

    return { val: val, colors: colors, thr: THR };
  }

  global.BBP = { compute: compute };
})(typeof window !== 'undefined' ? window : globalThis);
