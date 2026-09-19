/**
 * bti.js — 통합지표 (BTI: Bitcoin Top Indicator) — 비트코인(BTC-USD) 전용
 *   TradingView "BTI [Da_Prof]" 벤치마킹. 12개 사이클-천장 서브지표 각각의 "역사적 고점 대비 근접도"를
 *   캡처의 'within X% of top' 밴드로 판정 → 근접 지표 개수 = BTI 카운트(0~12), 평균 근접도 = Risk(0~1 색상).
 *   ⚠️ CoinAI는 가격(OHLCV)만 → 온체인(NUPL/MVRV-Z/CVDD/Puell)은 가격/시간 파생·회귀로 근사(원본 Pine도 동일).
 *   ⚠️ Yahoo BTC는 5년치만 → 절대 천장 캘리브레이션은 보유 데이터 범위 기준(2012~ 풀데이터와 차이 가능).
 *   window.BTI.compute(dailyCandles) → { keys, risk[], btiCount[], sub:{key:{val[],prox[],near[]}}, bandColor, PALETTE }
 */
(function (global) {
  'use strict';
  const PALETTE = ['#311b92', '#1f5f8b', '#2f80ed', '#2dd4bf', '#9caa52', '#a9772f', '#f0962b', '#f7e84e', '#f5524a', '#f3a3a0', '#f8d7d5'];
  function bandColor(risk) { const i = Math.max(0, Math.min(10, Math.round((isNaN(risk) ? 0 : risk) * 10))); return PALETTE[i]; }
  const HALVINGS = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20), Date.UTC(2028, 3, 1)];
  const GENESIS = Date.UTC(2009, 0, 3);
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  function sma(arr, n) { const o = Array(arr.length).fill(NaN); let s = 0, c = 0; for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!isNaN(v)) { s += v; c++; } if (i >= n) { const p = arr[i - n]; if (!isNaN(p)) { s -= p; c--; } } if (i >= n - 1 && c === n) o[i] = s / n; } return o; }
  function ema(arr, n) { const o = Array(arr.length).fill(NaN), k = 2 / (n + 1); let p = NaN; for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (isNaN(v)) { o[i] = p; continue; } p = isNaN(p) ? v : v * k + p * (1 - k); o[i] = p; } return o; }
  function rsi(C, n) { const o = Array(C.length).fill(NaN); if (C.length <= n) return o; let ag = 0, al = 0; for (let i = 1; i <= n; i++) { const ch = C[i] - C[i - 1]; ag += Math.max(ch, 0); al += Math.max(-ch, 0); } ag /= n; al /= n; o[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); for (let i = n + 1; i < C.length; i++) { const ch = C[i] - C[i - 1]; ag = (ag * (n - 1) + Math.max(ch, 0)) / n; al = (al * (n - 1) + Math.max(-ch, 0)) / n; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return o; }
  function rstd(arr, n) { const o = Array(arr.length).fill(NaN); for (let i = n - 1; i < arr.length; i++) { let m = 0, c = 0; for (let j = i - n + 1; j <= i; j++) if (!isNaN(arr[j])) { m += arr[j]; c++; } if (c < n) continue; m /= n; let s = 0; for (let j = i - n + 1; j <= i; j++) s += (arr[j] - m) ** 2; o[i] = Math.sqrt(s / n); } return o; }
  // 견고한 고점/저점 기준(상·하위 percentile) — 이상치 영향 줄임
  function refs(arr) { const f = arr.filter(v => !isNaN(v) && isFinite(v)).sort((a, b) => a - b); if (f.length < 10) return [NaN, NaN]; return [f[Math.floor(f.length * 0.02)], f[Math.floor(f.length * 0.98)]]; }

  function compute(candles) {
    const N = candles.length, empty = () => Array(N).fill(NaN);
    if (N < 120) return { keys: [], risk: empty(), btiCount: empty(), sub: {}, bandColor, PALETTE };
    const C = candles.map(c => c.close), H = candles.map(c => c.high), L = candles.map(c => c.low), T = candles.map(c => c.ts);
    const lnC = C.map(v => Math.log(v));
    const rpWin = Math.min(1400, Math.floor(N * 0.6));
    const realized = sma(C, rpWin);

    // ── 12개 서브지표 raw 값 (높을수록 천장) ──
    const raw = {};
    raw.PUELL = C.map((v, i) => v / sma(C, Math.min(365, rpWin))[i]);
    raw.RP = C.map((v, i) => v / realized[i]);
    raw.NUPL = C.map((v, i) => (v - realized[i]) / v);
    const sdC = rstd(C, Math.min(365, rpWin));
    raw.MVRVZ = C.map((v, i) => (v - realized[i]) / (sdC[i] || NaN));
    raw.CVDD = C.map((v, i) => v / sma(C, Math.min(1000, rpWin))[i]);
    const s111 = sma(C, 111), s350 = sma(C, 350);
    raw.PCTD = C.map((v, i) => s111[i] / (2 * s350[i]));
    const macdL = ema(lnC, 12).map((v, i) => v - ema(lnC, 26)[i]);
    raw.LMACD = macdL.map((v, i) => v - ema(macdL, 9)[i]);
    raw.RSIM = rsi(C, 30);
    const tr = empty(), pdm = empty();
    for (let i = 1; i < N; i++) { const up = H[i] - H[i - 1], dn = L[i - 1] - L[i]; pdm[i] = (up > dn && up > 0) ? up : 0; tr[i] = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])); }
    const atr = ema(tr, 14); raw.PDM = ema(pdm, 14).map((v, i) => 100 * v / (atr[i] || NaN));
    const x = T.map(t => Math.log(Math.max(1, (t - GENESIS) / 86400000)));
    let sx = 0, sy = 0, sxx = 0, sxy = 0, cn = 0; for (let i = 0; i < N; i++) { if (isNaN(lnC[i])) continue; sx += x[i]; sy += lnC[i]; sxx += x[i] * x[i]; sxy += x[i] * lnC[i]; cn++; }
    const pb = (cn * sxy - sx * sy) / (cn * sxx - sx * sx), pa = (sy - pb * sx) / cn;
    raw.PLR = lnC.map((v, i) => v - (pa + pb * x[i]));
    raw.CSI = T.map(t => { const d = new Date(t); const doy = Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000); const dist = Math.min(Math.abs(doy - 325), 365 - Math.abs(doy - 325)); return clamp((60 - dist) / 60, 0, 1); });
    raw.HSI = T.map(t => { let last = HALVINGS[0]; for (const h of HALVINGS) if (h <= t) last = h; return clamp((120 - Math.abs((t - last) / 86400000 - 538)) / 120, 0, 1); });

    // ── 캡처 'within X% of top' 천장 근접 임계 (proximity ≥ 1 - X%) ──
    const NEAR = { CVDD: 0.80, NUPL: 0.80, MVRVZ: 0.50, PUELL: 0.80, CSI: 0.90, HSI: 0.90, PLR: 0.80, RP: 0.80, PDM: 0.90, LMACD: 0.80, PCTD: 0.95, RSIM: 0.80 };
    // ── 사이클 '바닥' 근접 임계 (proximity ≤ BOT% — 자기 5년치 하위구간) ──
    const BOT = { CVDD: 0.12, NUPL: 0.12, MVRVZ: 0.10, PUELL: 0.12, CSI: 0.10, HSI: 0.10, PLR: 0.12, RP: 0.12, PDM: 0.15, LMACD: 0.15, PCTD: 0.10, RSIM: 0.18 };
    const keys = ['CVDD', 'NUPL', 'MVRVZ', 'PUELL', 'CSI', 'HSI', 'PLR', 'RP', 'PDM', 'LMACD', 'PCTD', 'RSIM'];

    const sub = {};
    keys.forEach(k => {
      const arr = raw[k];
      let lo, hi;
      if (k === 'CSI' || k === 'HSI') { lo = 0; hi = 1; }              // 계절성은 이미 0~1
      else { const r = refs(arr); lo = r[0]; hi = r[1]; }
      const prox = arr.map(v => (isNaN(v) || isNaN(hi) || hi === lo) ? NaN : clamp((v - lo) / (hi - lo), 0, 1));
      const near = prox.map(p => !isNaN(p) && p >= NEAR[k]);        // 고점 근접
      // 저점 근접 — CSI/HSI는 '고점 타이밍' 전용이라 저점 신호 제외
      const botOK = k !== 'CSI' && k !== 'HSI';
      const botNear = prox.map(p => botOK && !isNaN(p) && p <= BOT[k]);
      sub[k] = { val: arr, prox, near, botNear };
    });

    // ── 합성: 고점카운트=고점근접 수, 저점카운트=저점근접 수, Risk=평균 근접도 ──
    const risk = empty(), btiCount = empty(), botCount = empty();
    for (let i = 0; i < N; i++) {
      let sum = 0, c = 0, nt = 0, nb = 0;
      keys.forEach(k => { const p = sub[k].prox[i]; if (!isNaN(p)) { sum += p; c++; if (sub[k].near[i]) nt++; if (sub[k].botNear[i]) nb++; } });
      if (c >= 7) { risk[i] = sum / c; btiCount[i] = nt; botCount[i] = nb; }
    }
    return { keys, risk, btiCount, botCount, sub, bandColor, PALETTE };
  }

  global.BTI = { compute, bandColor, PALETTE };
})(typeof window !== 'undefined' ? window : globalThis);
