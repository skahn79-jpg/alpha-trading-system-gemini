/**
 * indicators.js — Strategy NASDAQ 핵심 지표 엔진
 *
 * Strategy BTC 의 computeAirblock / buildSignalHistory 수학을 종목 무관(symbol-agnostic)
 * 모듈로 이식. 암호화폐 전용(레버리지 청산선)만 제거하고 TA 지표는 전부 보존.
 *
 *  포함 지표:
 *   - 스토캐스틱 (Gram69), 골든/데드크로스, SMA100/200 돌파 매수
 *   - 저점구간(isAccum) / 고점구간(isLocalTop) / 강한매수(strongBuy)  ← 고점·저점 지표 핵심
 *   - N파동 예측(Elliott), StochRSI(각도기), MACD
 *
 *  사용:
 *   const ind  = Indicators.compute(dailyCandles, { weeklyCandles });
 *   const sigs = Indicators.buildSignals(dailyCandles, ind, '1d', { weeklyCandles });
 *   const zone = Indicators.currentZone(ind);   // {state:'저점'|'고점'|'중립', ...}
 *
 *  candle 형식: { ts, open, high, low, close, volume }
 */
(function (global) {
  'use strict';

  const STOCH_LEN = 20, SMOOTH_K = 12, SMOOTH_D = 6;

  // ── 헬퍼 수학 ─────────────────────────────────────
  // 단순이동평균 — 롤링합 O(N) (NaN 포함 윈도우는 NaN 반환, 원본 동작 유지)
  function smaFn(arr, n) {
    const out = Array(arr.length).fill(NaN);
    let s = 0, nan = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]; if (isNaN(v)) nan++; else s += v;
      if (i >= n) { const o = arr[i - n]; if (isNaN(o)) nan--; else s -= o; }
      if (i >= n - 1 && nan === 0) out[i] = s / n;
    }
    return out;
  }
  function stdevFn(arr, n) { return arr.map((_, i) => { if (i < n - 1) return NaN; let m = 0; for (let j = i - n + 1; j <= i; j++) m += arr[j]; m /= n; let s = 0; for (let j = i - n + 1; j <= i; j++) { const d = arr[j] - m; s += d * d; } return Math.sqrt(s / n); }); }
  function emaFn(arr, n) { const k = 2 / (n + 1), out = Array(arr.length).fill(NaN); let p = NaN; for (let i = 0; i < arr.length; i++) { if (isNaN(arr[i])) continue; if (isNaN(p)) { p = arr[i]; out[i] = p; continue; } p = arr[i] * k + p * (1 - k); out[i] = p; } return out; }
  function rolMin(arr, n) { return arr.map((_, i) => { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (arr[j] < m) m = arr[j]; return m; }); }
  function rolMax(arr, n) { return arr.map((_, i) => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (arr[j] > m) m = arr[j]; return m; }); }
  // RMA (Wilder, Pine ta.rma): 첫 유효값 = SMA(n) 시드 후 alpha=1/n 재귀. NaN 입력은 스킵.
  function rmaFn(arr, n) {
    const out = Array(arr.length).fill(NaN), alpha = 1 / n;
    let prev = NaN, sum = 0, count = 0, seeded = false;
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i]; if (isNaN(x)) continue;
      if (!seeded) { sum += x; count++; if (count === n) { prev = sum / n; out[i] = prev; seeded = true; } continue; }
      prev = alpha * x + (1 - alpha) * prev; out[i] = prev;
    }
    return out;
  }
  function tmaFn(arr, n) { return smaFn(smaFn(arr, n), n); }
  // 범용 이동평균 (Pine ma 함수: EMA/SMA/RMA/TMA)
  function maG(arr, n, type) {
    switch (type) { case 'EMA': return emaFn(arr, n); case 'SMA': return smaFn(arr, n); case 'TMA': return tmaFn(arr, n); case 'RMA': default: return rmaFn(arr, n); }
  }

  // ── Ultimate RSI (LuxAlgo, CC BY-NC-SA 4.0, © LuxAlgo) Pine v5 정확 포팅 ──
  //  증강 RSI: 신고가/신저가 돌파 시 range(r)로 모멘텀 강화 후 RMA 평활 → 0~100 정규화.
  function computeUltimateRSI(C, opts) {
    opts = opts || {};
    const L = opts.length || 14, smooth = opts.smooth || 14;
    const smo1 = opts.smoType1 || 'RMA', smo2 = opts.smoType2 || 'EMA';
    const upper = rolMax(C, L), lower = rolMin(C, L);
    const diff = C.map((c, i) => {
      if (i === 0) return 0;
      const r = upper[i] - lower[i];
      if (upper[i] > upper[i - 1]) return r;
      if (lower[i] < lower[i - 1]) return -r;
      return c - C[i - 1];
    });
    const num = maG(diff, L, smo1);
    const den = maG(diff.map(Math.abs), L, smo1);
    const uRsi = num.map((nv, i) => (isNaN(nv) || isNaN(den[i]) || den[i] === 0) ? NaN : nv / den[i] * 50 + 50);
    const uRsiSignal = maG(uRsi, smooth, smo2);
    // 시그널: uRSI가 시그널선 상향돌파(과매도권<50)=매수, 하향돌파(과매수권>50)=매도
    const uRsiBuy = uRsi.map((v, i) => i > 0 && !isNaN(v) && !isNaN(uRsi[i - 1]) && !isNaN(uRsiSignal[i]) && !isNaN(uRsiSignal[i - 1]) && uRsi[i - 1] <= uRsiSignal[i - 1] && v > uRsiSignal[i] && v < 50);
    const uRsiSell = uRsi.map((v, i) => i > 0 && !isNaN(v) && !isNaN(uRsi[i - 1]) && !isNaN(uRsiSignal[i]) && !isNaN(uRsiSignal[i - 1]) && uRsi[i - 1] >= uRsiSignal[i - 1] && v < uRsiSignal[i] && v > 50);
    return { uRsi, uRsiSignal, uRsiBuy, uRsiSell };
  }

  // ── 주봉 스토캐스틱 K 룩업 빌더 ──────────────────────
  //  주봉 캔들로부터 K 시계열을 만들고, 임의 시점 ts 의 직전 K 값을 돌려주는 함수 반환.
  function buildWeeklyKLookup(weeklyCandles) {
    if (!Array.isArray(weeklyCandles) || !weeklyCandles.length) {
      return () => 50; // 주봉 없으면 중립값 → 주봉K 게이트 통과/차단 영향 최소
    }
    const C = weeklyCandles.map(c => c.close), L = weeklyCandles.map(c => c.low), H = weeklyCandles.map(c => c.high);
    const loN = rolMin(L, STOCH_LEN), hiN = rolMax(H, STOCH_LEN);
    const rawK = C.map((c, i) => 100 * (c - loN[i]) / Math.max(hiN[i] - loN[i], 1e-10));
    const K = smaFn(rawK, SMOOTH_K);
    return function (ts) {
      let best = 50;
      for (let i = 0; i < weeklyCandles.length; i++) {
        if (weeklyCandles[i].ts <= ts && !isNaN(K[i])) best = K[i];
      }
      return best;
    };
  }


  // 💔 인간지표 (Pain Meter) — airblock Heeling Pine Script 변환 (Strategy BTC 이식)
  //   mloss = SMA(100*(h_max - low)/h_max, 5), h_max=직전 50봉 최고가 → "고점 대비 현재 저가 손실 %"
  //   bullDiv(황금 다이버전스) = 가격 신저점 + UO 상승 + UO<50 → 매수 기회 신호
  function computePainMeter(candles, opts) {
    opts = opts || {};
    const length = opts.length || 50, smooth = opts.smooth || 5, spacing = opts.spacing || 10, uoThr = opts.uoThreshold || 50;
    const N = candles.length;
    const mloss = Array(N).fill(NaN), uo = Array(N).fill(NaN), bullDiv = Array(N).fill(false), hMax = Array(N).fill(NaN);
    if (N < length + spacing * 2 + 2) return { mloss, bullDiv, hMax };
    // h_max 슬라이딩 (직전 length봉 최고가)
    for (let i = length - 1; i < N; i++) {
      let hm = -Infinity;
      for (let j = i - length + 1; j <= i; j++) if (candles[j].high > hm) hm = candles[j].high;
      hMax[i] = hm;
    }
    // raw loss % → 5봉 SMA
    const rawLoss = Array(N).fill(NaN);
    for (let i = length - 1; i < N; i++) { const hm = hMax[i]; if (hm > 0 && isFinite(hm)) rawLoss[i] = 100 * (hm - candles[i].low) / hm; }
    for (let i = smooth - 1; i < N; i++) { let s = 0, cnt = 0; for (let j = i - smooth + 1; j <= i; j++) { if (!isNaN(rawLoss[j])) { s += rawLoss[j]; cnt++; } } if (cnt === smooth) mloss[i] = s / smooth; }
    // Ultimate Oscillator (황금 다이버전스 판정용)
    const bp = Array(N).fill(NaN), tr = Array(N).fill(NaN);
    for (let i = 1; i < N; i++) { const pc = candles[i - 1].close, lo = Math.min(candles[i].low, pc), hi = Math.max(candles[i].high, pc); bp[i] = candles[i].close - lo; tr[i] = hi - lo; }
    const sma = (arr, p, i) => { if (i < p) return NaN; let s = 0; for (let k = i - p + 1; k <= i; k++) { if (isNaN(arr[k])) return NaN; s += arr[k]; } return s / p; };
    for (let i = 28; i < N; i++) { const b7 = sma(bp, 7, i), t7 = sma(tr, 7, i), b14 = sma(bp, 14, i), t14 = sma(tr, 14, i), b28 = sma(bp, 28, i), t28 = sma(tr, 28, i); if (t7 > 0 && t14 > 0 && t28 > 0) uo[i] = 100 * (4 * (b7 / t7) + 2 * (b14 / t14) + (b28 / t28)) / 7; }
    // Bullish Divergence: 가격 신저점 + UO 상승 + UO<threshold
    const closes = candles.map(c => c.close);
    const lowestN = (arr, p, end) => { let m = Infinity; for (let k = end - p + 1; k <= end; k++) if (k >= 0 && !isNaN(arr[k]) && arr[k] < m) m = arr[k]; return m; };
    for (let i = spacing * 3; i < N; i++) {
      const v1 = lowestN(closes, spacing, i), v2 = lowestN(closes, spacing, i - spacing), v3 = lowestN(closes, spacing, i - spacing * 2);
      const o1 = lowestN(uo, spacing, i), o2 = lowestN(uo, spacing, i - spacing), o3 = lowestN(uo, spacing, i - spacing * 2);
      if (v1 < v2 && v1 < v3 && o1 > o2 && o1 > o3 && o1 < uoThr) bullDiv[i] = true;
    }
    return { mloss, bullDiv, hMax };
  }

  // 📐 다이버전스 — 가격 swing(고점/저점) vs 보조지표(RSI·모멘텀·MACD) 비교
  //   Regular Bull: 가격 신저점(LL) + 지표 고저점(HL) → 추세전환 매수
  //   Hidden Bull : 가격 고저점(HL) + 지표 신저점(LL) → 추세지속 매수
  //   Bear는 고점 기준 대칭. pivot은 좌우 W봉보다 극단인 봉(확정에 W봉 후행).
  // 다이버전스 — LonesomeTheBlue "Divergence for Many Indicators v4" 이식 (© LonesomeTheBlue, MPL-2.0)
  //   11개 지표(MACD·Hist·RSI·Stoch·CCI·MOM·OBV·VWMACD·CMF·MFI; 거래량 없으면 OBV/VWMACD/CMF/MFI 자동 제외)
  //   종가 피벗(prd=5) 기준, 직전 최대 maxpp개 피벗을 maxbars 내에서 역탐색 + virtual-line 검증(중간 봉이 연결선을 안 넘어야 클린 다이버전스).
  //   원본 기본값 searchdiv="Regular" 채택 — Regular 다이버전스만(하단 노랑/상단 네이비). 출력: divBull[i2]/divBear[i2] = { count, names[], kind:'regular', src, i1, lines[](각도 라인용 이전 피벗들) }.
  function computeDivergence(candles, opts) {
    opts = opts || {};
    const prd = opts.prd || 5, maxpp = opts.maxpp || 10, maxbars = opts.maxbars || 100, showlimit = opts.showlimit || 1;
    const N = candles.length;
    const divBull = Array(N).fill(null), divBear = Array(N).fill(null), divList = [];
    if (N < prd * 2 + 6) return { divBull, divBear, divList };
    const C = candles.map(c => c.close), H = candles.map(c => c.high), L = candles.map(c => c.low), V = candles.map(c => +c.volume || 0);
    const hasVol = V.reduce((a, b) => a + b, 0) > 0;

    // ── 지표 계산 ──
    const rsiF = (src, n) => { const o = Array(src.length).fill(NaN); if (src.length <= n) return o; let ag = 0, al = 0; for (let i = 1; i <= n; i++) { const ch = src[i] - src[i - 1]; ag += Math.max(ch, 0); al += Math.max(-ch, 0); } ag /= n; al /= n; o[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); for (let i = n + 1; i < src.length; i++) { const ch = src[i] - src[i - 1]; ag = (ag * (n - 1) + Math.max(ch, 0)) / n; al = (al * (n - 1) + Math.max(-ch, 0)) / n; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return o; };
    const mF = emaFn(C, 12), mS = emaFn(C, 26), macdLine = mF.map((v, i) => v - mS[i]);
    const macdSigA = emaFn(macdLine, 9), deltamacd = macdLine.map((v, i) => v - macdSigA[i]);
    const rsi14 = rsiF(C, 14);
    const moment = C.map((c, i) => i >= 10 ? c - C[i - 10] : NaN);
    const tp = C.map((c, i) => (H[i] + L[i] + c) / 3), tpSma = smaFn(tp, 10);
    const cci = tp.map((v, i) => { if (isNaN(tpSma[i]) || i < 9) return NaN; let md = 0; for (let j = i - 9; j <= i; j++) md += Math.abs(tp[j] - tpSma[i]); md /= 10; return md === 0 ? 0 : (v - tpSma[i]) / (0.015 * md); });
    const llv = rolMin(L, 14), hhv = rolMax(H, 14);
    const stochRaw = C.map((c, i) => { const rng = hhv[i] - llv[i]; return rng < 1e-10 ? 0 : 100 * (c - llv[i]) / rng; });
    const stk = smaFn(stochRaw, 3);
    const inds = [
      { name: 'MACD', arr: macdLine }, { name: 'Hist', arr: deltamacd }, { name: 'RSI', arr: rsi14 },
      { name: 'Stoch', arr: stk }, { name: 'CCI', arr: cci }, { name: 'MOM', arr: moment }
    ];
    if (hasVol) {
      const obv = Array(N).fill(0); for (let i = 1; i < N; i++) obv[i] = obv[i - 1] + (C[i] > C[i - 1] ? V[i] : C[i] < C[i - 1] ? -V[i] : 0);
      const vwma = n => { const o = Array(N).fill(NaN); let sp = 0, sv = 0; for (let i = 0; i < N; i++) { sp += C[i] * V[i]; sv += V[i]; if (i >= n) { sp -= C[i - n] * V[i - n]; sv -= V[i - n]; } if (i >= n - 1) o[i] = sv ? sp / sv : NaN; } return o; };
      const vw12 = vwma(12), vw26 = vwma(26), vwmacd = vw12.map((v, i) => v - vw26[i]);
      const mfv = C.map((c, i) => { const rng = H[i] - L[i]; return rng === 0 ? 0 : (((c - L[i]) - (H[i] - c)) / rng) * V[i]; });
      const cmf = Array(N).fill(NaN); { let sf = 0, sv = 0; for (let i = 0; i < N; i++) { sf += mfv[i]; sv += V[i]; if (i >= 21) { sf -= mfv[i - 21]; sv -= V[i - 21]; } if (i >= 20) cmf[i] = sv ? sf / sv : NaN; } }
      const mfi = Array(N).fill(NaN); for (let i = 14; i < N; i++) { let pos = 0, neg = 0; for (let j = i - 13; j <= i; j++) { const t = (H[j] + L[j] + C[j]) / 3, tpr = (H[j - 1] + L[j - 1] + C[j - 1]) / 3, mf = t * V[j]; if (t > tpr) pos += mf; else if (t < tpr) neg += mf; } mfi[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg); }
      inds.push({ name: 'OBV', arr: obv }, { name: 'VWMACD', arr: vwmacd }, { name: 'CMF', arr: cmf }, { name: 'MFI', arr: mfi });
    }

    // ── 피벗(종가 기준) ──
    const pivLow = [], pivHigh = [];
    for (let i = prd; i < N - prd; i++) {
      let lo = true, hi = true;
      for (let j = i - prd; j <= i + prd; j++) { if (j === i) continue; if (C[j] <= C[i]) lo = false; if (C[j] >= C[i]) hi = false; }
      if (lo) pivLow.push(i); if (hi) pivHigh.push(i);
    }
    // virtual-line 검증: 두 점 사이 모든 봉이 연결선 위(up)/아래(dn)
    const cleanUp = (a, i1, i2) => { const sl = (a[i2] - a[i1]) / (i2 - i1); for (let y = i1 + 1; y < i2; y++) { if (isNaN(a[y]) || a[y] < a[i1] + sl * (y - i1)) return false; } return true; };
    const cleanDn = (a, i1, i2) => { const sl = (a[i2] - a[i1]) / (i2 - i1); for (let y = i1 + 1; y < i2; y++) { if (isNaN(a[y]) || a[y] > a[i1] + sl * (y - i1)) return false; } return true; };

    for (let p = 1; p < pivLow.length; p++) {     // BULL — 피벗 저점 (Regular: 가격 LL + 지표 HL)
      const i2 = pivLow[p], names = [], pivots = {};
      for (const ind of inds) {
        const a = ind.arr; if (isNaN(a[i2])) continue;
        for (let q = p - 1; q >= 0 && q >= p - maxpp; q--) {
          const i1 = pivLow[q], len = i2 - i1; if (len > maxbars) break; if (len <= prd || isNaN(a[i1])) continue;
          if (!(a[i2] > a[i1] && C[i2] < C[i1])) continue;                 // 가격 더 낮은 저점 + 지표 더 높은 저점
          if (!cleanUp(a, i1, i2)) continue;                                // 지표 클린(연결선 위) — 가격 클린은 미적용(급락 구간에도 최근 저점이 연결되도록)
          names.push(ind.name); pivots[i1] = 1; break;                      // 지표별 첫(최근) 매칭 피벗
        }
      }
      if (names.length >= showlimit) {
        const lines = Object.keys(pivots).map(Number).sort((x, y) => x - y);   // 매칭된 이전 저점들 → 각도 라인 다중
        divBull[i2] = { count: names.length, names, kind: 'regular', src: names.join(','), i1: lines[0], lines };
        divList.push({ ts: candles[i2].ts, type: 'bull', kind: 'regular', src: names.join(','), count: names.length });
      }
    }
    for (let p = 1; p < pivHigh.length; p++) {     // BEAR — 피벗 고점 (Regular: 가격 HH + 지표 LH)
      const i2 = pivHigh[p], names = [], pivots = {};
      for (const ind of inds) {
        const a = ind.arr; if (isNaN(a[i2])) continue;
        for (let q = p - 1; q >= 0 && q >= p - maxpp; q--) {
          const i1 = pivHigh[q], len = i2 - i1; if (len > maxbars) break; if (len <= prd || isNaN(a[i1])) continue;
          if (!(a[i2] < a[i1] && C[i2] > C[i1])) continue;                 // 가격 더 높은 고점 + 지표 더 낮은 고점
          if (!cleanDn(a, i1, i2)) continue;                                // 지표 클린(연결선 아래) — 가격 클린 미적용
          names.push(ind.name); pivots[i1] = 1; break;
        }
      }
      if (names.length >= showlimit) {
        const lines = Object.keys(pivots).map(Number).sort((x, y) => x - y);
        divBear[i2] = { count: names.length, names, kind: 'regular', src: names.join(','), i1: lines[0], lines };
        divList.push({ ts: candles[i2].ts, type: 'bear', kind: 'regular', src: names.join(','), count: names.length });
      }
    }
    // ── 현재 바까지 라인 연장 (원본 startpoint 동작) — 최근 일봉은 아직 피벗 미확정이라, 옛 피벗→현재 종가로 다이버전스 라인을 이어줌 ──
    const ci = N - 1;
    if (ci > prd * 2) {
      if (!divBull[ci]) {   // BULL live: 현재 종가가 옛 저점보다 낮고 지표는 높음
        const names = [], pivots = {};
        for (const ind of inds) {
          const a = ind.arr; if (isNaN(a[ci])) continue;
          for (let q = pivLow.length - 1; q >= 0 && q >= pivLow.length - maxpp; q--) {
            const i1 = pivLow[q], len = ci - i1; if (len > maxbars) break; if (len <= prd || isNaN(a[i1])) continue;
            if (!(a[ci] > a[i1] && C[ci] < C[i1])) continue;
            if (!cleanUp(a, i1, ci)) continue;
            names.push(ind.name); pivots[i1] = 1; break;
          }
        }
        if (names.length >= showlimit) { const lines = Object.keys(pivots).map(Number).sort((x, y) => x - y); divBull[ci] = { count: names.length, names, kind: 'regular', src: names.join(','), i1: lines[0], lines, live: true }; }
      }
      if (!divBear[ci]) {   // BEAR live: 현재 종가가 옛 고점보다 높고 지표는 낮음
        const names = [], pivots = {};
        for (const ind of inds) {
          const a = ind.arr; if (isNaN(a[ci])) continue;
          for (let q = pivHigh.length - 1; q >= 0 && q >= pivHigh.length - maxpp; q--) {
            const i1 = pivHigh[q], len = ci - i1; if (len > maxbars) break; if (len <= prd || isNaN(a[i1])) continue;
            if (!(a[ci] < a[i1] && C[ci] > C[i1])) continue;
            if (!cleanDn(a, i1, ci)) continue;
            names.push(ind.name); pivots[i1] = 1; break;
          }
        }
        if (names.length >= showlimit) { const lines = Object.keys(pivots).map(Number).sort((x, y) => x - y); divBear[ci] = { count: names.length, names, kind: 'regular', src: names.join(','), i1: lines[0], lines, live: true }; }
      }
    }
    return { divBull, divBear, divList };
  }

  // 수퍼트렌드 (Supertrend, TradingView KivancOzbilgic 이식) — ATR 채널 추세추종, 가격 오버레이.
  //   trend==1 상승(녹색 up선) / -1 하락(빨강 dn선), 추세전환 시 Buy/Sell. changeATR=true → atr()=RMA(tr).
  //   출력: { up[], dn[], trend[], buy[], sell[], line[] (활성 추세선) }
  function computeSupertrend(candles, opts) {
    opts = opts || {};
    const periods = opts.periods || 10, mult = opts.mult != null ? opts.mult : 3.0;
    const N = candles.length;
    const up = Array(N).fill(NaN), dn = Array(N).fill(NaN), trend = Array(N).fill(1), buy = Array(N).fill(false), sell = Array(N).fill(false), line = Array(N).fill(NaN);
    if (N < periods + 2) return { up, dn, trend, buy, sell, line };
    const H = candles.map(c => c.high), L = candles.map(c => c.low), C = candles.map(c => c.close);
    const src = H.map((h, i) => (h + L[i]) / 2);          // hl2
    const tr = Array(N).fill(NaN);
    for (let i = 0; i < N; i++) tr[i] = i === 0 ? (H[i] - L[i]) : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    const atr = rmaFn(tr, periods);                        // changeATR 기본 true → atr() = RMA
    for (let i = 0; i < N; i++) {
      const a = atr[i];
      const basicUp = src[i] - mult * a, basicDn = src[i] + mult * a;
      const up1 = (i > 0 && !isNaN(up[i - 1])) ? up[i - 1] : basicUp;
      up[i] = (i > 0 && C[i - 1] > up1) ? Math.max(basicUp, up1) : basicUp;
      const dn1 = (i > 0 && !isNaN(dn[i - 1])) ? dn[i - 1] : basicDn;
      dn[i] = (i > 0 && C[i - 1] < dn1) ? Math.min(basicDn, dn1) : basicDn;
      const pt = i > 0 ? trend[i - 1] : 1;
      trend[i] = (pt === -1 && C[i] > dn1) ? 1 : (pt === 1 && C[i] < up1) ? -1 : pt;
      if (i > 0) { buy[i] = trend[i] === 1 && trend[i - 1] === -1; sell[i] = trend[i] === -1 && trend[i - 1] === 1; }
      line[i] = isNaN(a) ? NaN : (trend[i] === 1 ? up[i] : dn[i]);
    }
    return { up, dn, trend, buy, sell, line };
  }

  // 구름대 (Ichimoku Cloud, TradingView 빌트인 이식) — 종목 무관 표준 TA, 가격 오버레이.
  //   전환선 donchian(9)·기준선 donchian(26)·선행A=(전환+기준)/2·선행B donchian(52).
  //   donchian(len) = (최근 len봉 최고가 + 최저가) / 2.
  //   ⚠️변위(displacement)는 렌더에서 적용 — 선행스팬(구름)은 +shift(미래) 변위.
  //     shift = disp-1 (제공 Pine의 offset=displacement-1 충실 재현). 배열엔 원시값 저장.
  //   출력: { conv[], base[], leadA[], leadB[], disp, shift }
  function computeIchimoku(candles, opts) {
    opts = opts || {};
    const pConv = opts.conv || 9, pBase = opts.base || 26, pSpanB = opts.spanB || 52, disp = opts.disp || 26;
    const N = candles.length;
    const conv = Array(N).fill(NaN), base = Array(N).fill(NaN), leadA = Array(N).fill(NaN), leadB = Array(N).fill(NaN);
    if (!N) return { conv, base, leadA, leadB, disp, shift: disp - 1 };
    const H = candles.map(c => c.high), L = candles.map(c => c.low);
    const hi9 = rolMax(H, pConv), lo9 = rolMin(L, pConv);
    const hi26 = rolMax(H, pBase), lo26 = rolMin(L, pBase);
    const hi52 = rolMax(H, pSpanB), lo52 = rolMin(L, pSpanB);
    for (let i = 0; i < N; i++) {
      if (i >= pConv - 1) conv[i] = (hi9[i] + lo9[i]) / 2;                          // 전환선 donchian(9)
      if (i >= pBase - 1) base[i] = (hi26[i] + lo26[i]) / 2;                        // 기준선 donchian(26)
      if (!isNaN(conv[i]) && !isNaN(base[i])) leadA[i] = (conv[i] + base[i]) / 2;   // 선행스팬 A
      if (i >= pSpanB - 1) leadB[i] = (hi52[i] + lo52[i]) / 2;                      // 선행스팬 B donchian(52)
    }
    return { conv, base, leadA, leadB, disp, shift: disp - 1 };
  }

  // 스토캐스틱 히트맵 (Stochastic Heat Map, © Violent, MPL-2.0) — 길이를 inc씩 늘린 plotNumber개 스토캐스틱 중
  //   '강세(≥50)'인 개수(0~plotNumber)를 집계 → 흰색(fast)·주황(slow) 카운트 오실레이터. 배경엔 가로 히트맵 라인(저점 파랑→고점 빨강).
  //   출력: { plotNumber, count[](강세 개수), fast[], slow[] }
  function computeStochHeatmap(candles, opts) {
    opts = opts || {};
    const inc = opts.inc || 10, smooth = opts.smooth || 2, smoothSlow = opts.smoothSlow || 21, plotNumber = opts.plotNumber || 28, maType = opts.ma || 'EMA';
    const N = candles.length;
    if (N < inc + smooth + 2) return { plotNumber, count: Array(N).fill(NaN), fast: [], slow: [] };
    const H = candles.map(c => c.high), L = candles.map(c => c.low), C = candles.map(c => c.close);
    const ma = (arr, n) => maType === 'SMA' ? smaFn(arr, n) : emaFn(arr, n);   // 기본 EMA (WMA는 EMA로 대체)
    const lines = [];
    for (let k = 0; k < plotNumber; k++) {
      const len = inc * (k + 1);
      if (len >= N) break;
      const llv = rolMin(L, len), hhv = rolMax(H, len);
      const raw = C.map((c, i) => { const rng = hhv[i] - llv[i]; return (isNaN(rng) || rng < 1e-10) ? NaN : 100 * (c - llv[i]) / rng; });
      lines.push(ma(raw, smooth));
    }
    // 강세(≥50) 스토캐스틱 개수 = 0~plotNumber
    const count = Array(N).fill(NaN);
    for (let i = 0; i < N; i++) { let c = 0, valid = 0; for (let k = 0; k < lines.length; k++) { const v = lines[k][i]; if (v != null && !isNaN(v)) { valid++; if (v >= 50) c++; } } if (valid > 0) count[i] = c; }
    // lines = 2D 히트맵용(행=길이별 스토캐스틱, 셀=값), count/fast/slow = 강세 개수 오실레이터
    return { plotNumber: lines.length, lines, count, fast: ma(count, smooth), slow: ma(count, smoothSlow) };
  }

  // ── 비트코인 파워로 (Power Law) — © JDK-Analysis, MPL 2.0. 가격오버레이 장기 가치 채널 ──
  //   price ≈ exp((const+shift) + coef·ln(제네시스 이후 연수)). 하단(녹)·상단(적) 밴드 + 중앙선.
  function computePowerLaw(candles) {
    const GEN = Date.UTC(2009, 9, 31, 2, 0, 0), MS_Y = 365.2425 * 86400000;   // 2009-10-31 02:00 UTC 제네시스
    const L1C = -15.6, L1K = 5.3, U1C = -10.7, U1K = 4.0, SHIFT = 11.9, UW = 0.5, LW = 0.4;
    const lower1 = [], lower1m = [], upper1 = [], upper1m = [], middle = [];
    for (let i = 0; i < candles.length; i++) {
      let ts = candles[i].ts; if (ts < 1e12) ts *= 1000;   // 초→ms 보정
      const x = Math.max((ts - GEN) / MS_Y, 1e-9), lx = Math.log(x);
      const l1 = Math.exp((L1C + SHIFT) + L1K * lx), u1 = Math.exp((U1C + SHIFT) + U1K * lx);
      lower1.push(l1); lower1m.push(l1 * (1 - LW)); upper1.push(u1); upper1m.push(u1 * (1 + UW)); middle.push(Math.sqrt(l1 * u1));
    }
    return { lower1: lower1, lower1m: lower1m, upper1: upper1, upper1m: upper1m, middle: middle };
  }

  // ── Puell Multiple (프록시) — © OperationHeadLessChicken, MPL 2.0. BTC 전용 오실레이터 ──
  //   온체인 채굴수익 미보유 → 프록시: 채굴수익 ≈ 블록보상(반감기 일정)×가격. Puell = 그값 / 365일 평균.
  //   (거래수수료 제외 근사. 임계: <0.5 저평가(매수), >4 고평가(매도))
  function computePuell(candles) {
    const H = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20)];   // 반감기 ts
    const subsidyAt = ts => { let s = 50; for (let k = 0; k < H.length; k++) if (ts >= H[k]) s /= 2; return s; };   // 50→25→12.5→6.25→3.125
    const rev = candles.map(c => { let ts = c.ts; if (ts < 1e12) ts *= 1000; return subsidyAt(ts) * c.close; });
    const span = candles.length > 1 ? Math.max(1, Math.round((candles[1].ts - candles[0].ts) / 86400000)) : 1;
    const period = Math.max(2, Math.round(365 / span));   // 봉 간격 기반 365일 상당
    const tms = i => { let t = candles[i].ts; return t < 1e12 ? t * 1000 : t; };
    const puell = [];
    for (let i = 0; i < rev.length; i++) {
      if (i < period - 1) { puell.push(NaN); continue; }
      let sum = 0; for (let j = i - period + 1; j <= i; j++) sum += rev[j];
      const ma = sum / period;
      puell.push(ma > 0 ? rev[i] / ma : NaN);
    }
    // 반감기 보정선: 차트 첫 반감기 이후 통과한 반감기마다 ×1.63 (발행량 감소 보정)
    const CF = 1.63, t0 = candles.length ? tms(0) : 0;
    const firstHalv = H.find(h => t0 <= h) || H[H.length - 1];
    const puellHalving = candles.map((c, i) => {
      if (isNaN(puell[i])) return NaN;
      let mult = 1; const t = tms(i);
      for (const h of H) { if (h < firstHalv) continue; if (t >= h) mult *= CF; }
      return puell[i] * mult;
    });
    // 반감기 발생 봉 표시(세로 마커)
    const halvingBars = candles.map((c, i) => { const t = tms(i), tp = i > 0 ? tms(i - 1) : -Infinity; return H.some(h => t >= h && tp < h); });
    // 과평가(빨강)/저평가(녹색) 세로 음영 — 원본처럼 극단만(상위~2%/하위~3%). 프록시 범위(0.44~2.12)에 보정.
    const OVER = 1.9, UNDER = 0.5;
    const overBars = puell.map(v => !isNaN(v) && v >= OVER);
    const underBars = puell.map(v => !isNaN(v) && v <= UNDER);
    return { puell: puell, puellHalving: puellHalving, halvingBars: halvingBars, overBars: overBars, underBars: underBars, over: OVER, under: UNDER, period: period };
  }

  // ── 각도기2 (MA Slope, aamonkey "Moving Average Slope" 개념 재구현) — 종목 무관 오실레이터 ──
  //   ohlc4의 EMA56 기울기 각도(도) = atan(ΔMA / ATR14)·180/π. 구간색: 아쿠아(>ft)/노랑(<fb)/회색.
  function computeMaSlope(candles, opts) {
    opts = opts || {};
    const len = opts.len || 56, ft = opts.ft != null ? opts.ft : 2, fb = opts.fb != null ? opts.fb : -2, atrLen = 14, R2D = 180 / Math.PI;
    const N = candles.length;
    const src = candles.map(c => (c.open + c.high + c.low + c.close) / 4);   // ohlc4
    const H = candles.map(c => c.high), L = candles.map(c => c.low), C = candles.map(c => c.close);
    const tr = Array(N).fill(NaN);
    for (let i = 0; i < N; i++) tr[i] = i === 0 ? (H[i] - L[i]) : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    const atr = rmaFn(tr, atrLen);
    const ma = emaFn(src, len);
    const slope = Array(N).fill(NaN), colors = Array(N).fill('#8b949e');
    for (let i = 1; i < N; i++) {
      const a = atr[i];
      if (isNaN(ma[i]) || isNaN(ma[i - 1]) || !a) continue;
      const ang = R2D * Math.atan((ma[i] - ma[i - 1]) / a);
      slope[i] = ang;
      colors[i] = ang > ft ? '#f85149' : ang < fb ? '#ffd60a' : '#8b949e';   // 아쿠아 / 노랑 / 회색
    }
    return { slope: slope, colors: colors, ft: ft, fb: fb };
  }

  // ── 다이버전스2 (UO Divergence Detector, blackdog6621 v0.1 이식) — 가격오버레이 녹색 세로음영 ──
  //   Ultimate Oscillator(7/14/28) 계산 후, spacing봉 세그먼트 2개 비교:
  //   가격 더 낮은 저점(LL) + UO 더 높은 저점(HL) = 강세(bullish) 다이버전스 → 녹색 배경.
  function computeUoDiv(candles, opts) {
    opts = opts || {};
    const spacing = opts.spacing || 4;   // 피벗 저점 윈도우·음영 폭(주봉 ~6밴드·일봉 ~23밴드로 원본 샘플 밀도 매칭)
    const N = candles.length;
    const bp = Array(N).fill(NaN), tr = Array(N).fill(NaN), uo = Array(N).fill(NaN);
    for (let i = 1; i < N; i++) {
      const pc = candles[i - 1].close, lo = Math.min(candles[i].low, pc), hi = Math.max(candles[i].high, pc);
      bp[i] = candles[i].close - lo; tr[i] = hi - lo;
    }
    const sumN = (arr, p, i) => { if (i < p) return NaN; let s = 0; for (let k = i - p + 1; k <= i; k++) { if (isNaN(arr[k])) return NaN; s += arr[k]; } return s; };
    for (let i = 28; i < N; i++) {
      const b7 = sumN(bp, 7, i), t7 = sumN(tr, 7, i), b14 = sumN(bp, 14, i), t14 = sumN(tr, 14, i), b28 = sumN(bp, 28, i), t28 = sumN(tr, 28, i);
      if (t7 > 0 && t14 > 0 && t28 > 0) uo[i] = 100 * (4 * (b7 / t7) + 2 * (b14 / t14) + (b28 / t28)) / 7;
    }
    const close = candles.map(c => c.close);
    // 가격 피벗 저점(좌우 spacing봉보다 낮은 확정 저점)만 추출 → 주요 저점에서만 선별 검출(상승장 눌림 제외)
    const pivots = [];
    for (let i = spacing; i < N - spacing; i++) {
      let isLow = true;
      for (let j = i - spacing; j <= i + spacing; j++) { if (j !== i && close[j] < close[i]) { isLow = false; break; } }
      if (isLow) pivots.push(i);
    }
    // 연속 피벗 저점 비교: 가격은 더 낮은 저점(LL) + UO는 더 높은 저점(HL) = 강세 다이버전스 → 두 저점 부근 음영
    const bullDiv = Array(N).fill(false);
    for (let k = 1; k < pivots.length; k++) {
      const p1 = pivots[k - 1], p2 = pivots[k];
      if (close[p2] < close[p1] && !isNaN(uo[p1]) && !isNaN(uo[p2]) && uo[p2] > uo[p1]) {
        for (let j = Math.max(0, p2 - spacing); j <= Math.min(N - 1, p2 + spacing); j++) bullDiv[j] = true;   // 후행 저점 중심 음영
      }
    }
    return { bullDiv: bullDiv, uo: uo };
  }

  // ── 파이사이클 (Pi Cycle, 고점+저점 통합 3라인) — BTC 전용·일봉 가격오버레이 ──
  //   3라인: ceil=SMA(350)×2 (빨강 천장) · mid=SMA(111) (노랑 점선·신호선) · floor=SMA(471)×0.745 (녹색 바닥).
  //   고점(매도): mid 가 ceil 위로 상향돌파 = 사이클 천장(검증 2017-12·2021-04, 정설 Pi Cycle Top).
  //   저점(매수): mid 가 floor 아래로 하향이탈 = 사이클 바닥(검증 2018-12·2022-07, ≈정설 Pi Cycle Bottom ±1일).
  //   ⚠️중간선을 SMA111 하나로 통일 — 양쪽 신호 모두 정확(EMA150은 2021 천장 놓침). 배수·기간이 BTC 캘리브레이션 → BTC·일봉 전용. 471봉 미만 NaN.
  function computePiCycle(candles) {
    const C = candles.map(c => c.close), N = C.length;
    const mid = smaFn(C, 111);                                          // SMA(111) 노랑 중간(신호선)
    const ceil = smaFn(C, 350).map(v => isNaN(v) ? NaN : v * 2);        // SMA(350)×2 빨강 천장
    const floor = smaFn(C, 471).map(v => isNaN(v) ? NaN : v * 0.745);   // SMA(471)×0.745 녹색 바닥
    // 고점: mid 가 ceil 상향돌파 / 저점: mid 가 floor 하향이탈 (둘 다 단봉 교차)
    const top = C.map((c, i) => i > 0 && !isNaN(mid[i]) && !isNaN(ceil[i]) && !isNaN(mid[i - 1]) && !isNaN(ceil[i - 1]) && mid[i - 1] <= ceil[i - 1] && mid[i] > ceil[i]);
    const bot = C.map((c, i) => i > 0 && !isNaN(mid[i]) && !isNaN(floor[i]) && !isNaN(mid[i - 1]) && !isNaN(floor[i - 1]) && mid[i - 1] >= floor[i - 1] && mid[i] < floor[i]);
    // 교차봉 ±1 음영 가시성
    const topBand = Array(N).fill(false), botBand = Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      if (top[i]) for (let j = Math.max(0, i - 1); j <= Math.min(N - 1, i + 1); j++) topBand[j] = true;
      if (bot[i]) for (let j = Math.max(0, i - 1); j <= Math.min(N - 1, i + 1); j++) botBand[j] = true;
    }
    return { mid: mid, ceil: ceil, floor: floor, top: top, bot: bot, topBand: topBand, botBand: botBand };
  }

  // ── 4년주기 사이클 (반감기 익절 사이클) — BTC 전용 ──────
  //  핵심: 음영/수직선을 "봉 오프셋"이 아니라 "절대 달력 날짜(반감기+N주)"로 정의 →
  //        일/주/월봉이 자동으로 같은 달력 시점에 그려진다(봉의 .ts가 범위 안인지만 판정).
  //  반환: zones(녹색 5단계 매도 그라데이션) · dcaBars(매집존) · vStart/vEnd(수직선=시그널)
  //        · marks(반감기선/Profit START·END/DCA 라벨 앵커, 라벨용)
  function computeCycle(candles) {
    const N = candles.length;
    const empty = { zones: [], dcaBars: [], vStart: [], vEnd: [], marks: [] };
    if (!N) return empty;
    const WK = 7 * 24 * 3600 * 1000;
    // 반감기(UTC). 2028은 예상치(데이터 밖이면 자동 미표시).
    const HALVINGS = [
      { ts: Date.UTC(2012, 10, 28), mdy: '11/28/2012' },
      { ts: Date.UTC(2016, 6, 9), mdy: '7/9/2016' },
      { ts: Date.UTC(2020, 4, 11), mdy: '5/11/2020' },
      { ts: Date.UTC(2024, 3, 19), mdy: '4/19/2024' },
      { ts: Date.UTC(2028, 3, 17), mdy: '4/17/2028' }
    ];
    // 익절 녹색 음영 5단계(주차 범위 → 알파). 색 진할수록 강한 매도(Last Call 근접).
    const STEPS = [
      { w0: 40, w1: 47, a: 0.10 },
      { w0: 47, w1: 54, a: 0.15 },
      { w0: 54, w1: 61, a: 0.20 },
      { w0: 61, w1: 72, a: 0.30 },
      { w0: 72, w1: 80, a: 0.45 }
    ];
    const DCA_W0 = 135, DCA_W1 = 152;          // DCA 매집존(반감기 +135~152주)
    const VL_START = 40, VL_END = 80;          // 수직선: Profit START(40주)·END(80주)
    // 봉 timestamp(ms 정규화)
    const tmsv = new Array(N);
    for (let i = 0; i < N; i++) { const t = candles[i].ts; tmsv[i] = t < 1e12 ? t * 1000 : t; }
    // 절대 시각 t를 "포함하는" 봉 인덱스(없으면 null) — 데이터 범위 밖이면 null
    function barAt(t) {
      if (t < tmsv[0] || t > tmsv[N - 1]) return null;
      let lo = 0, hi = N - 1, r = 0;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (tmsv[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
      return r;
    }
    const inRange = (i, a, b) => { const t = tmsv[i]; return t >= a && t < b; };
    // 녹색 5단계 음영 — 각 단계마다 per-bar boolean
    const zones = STEPS.map(s => {
      const bars = new Array(N).fill(false);
      for (let i = 0; i < N; i++) {
        for (let h = 0; h < HALVINGS.length; h++) {
          if (inRange(i, HALVINGS[h].ts + s.w0 * WK, HALVINGS[h].ts + s.w1 * WK)) { bars[i] = true; break; }
        }
      }
      return { bars: bars, alpha: s.a };
    });
    // DCA 매집존
    const dcaBars = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      for (let h = 0; h < HALVINGS.length; h++) {
        if (inRange(i, HALVINGS[h].ts + DCA_W0 * WK, HALVINGS[h].ts + DCA_W1 * WK)) { dcaBars[i] = true; break; }
      }
    }
    // 수직선(=시그널) + 라벨 마크
    const vStart = new Array(N).fill(false), vEnd = new Array(N).fill(false);
    const marks = [];
    HALVINGS.forEach(h => {
      const bh = barAt(h.ts); if (bh != null) marks.push({ barIdx: bh, kind: 'halving', ts: h.ts, mdy: h.mdy });
      const bs = barAt(h.ts + VL_START * WK); if (bs != null) { vStart[bs] = true; marks.push({ barIdx: bs, kind: 'start', ts: h.ts + VL_START * WK }); }
      const be = barAt(h.ts + VL_END * WK); if (be != null) { vEnd[be] = true; marks.push({ barIdx: be, kind: 'end', ts: h.ts + VL_END * WK }); }
      const bd = barAt(h.ts + DCA_W0 * WK); if (bd != null) marks.push({ barIdx: bd, kind: 'dca', ts: h.ts + DCA_W0 * WK });
    });
    return { zones: zones, dcaBars: dcaBars, vStart: vStart, vEnd: vEnd, marks: marks };
  }

  // ── 메인: 전체 지표 계산 ──────────────────────────────
  function compute(candles, opts) {
    opts = opts || {};
    const getWeeklyK = buildWeeklyKLookup(opts.weeklyCandles);
    const H = candles.map(c => c.high), L = candles.map(c => c.low), C = candles.map(c => c.close);
    const loN = rolMin(L, STOCH_LEN), hiN = rolMax(H, STOCH_LEN);
    const rawK = C.map((c, i) => 100 * (c - loN[i]) / Math.max(hiN[i] - loN[i], 1e-10));
    const K = smaFn(rawK, SMOOTH_K), D = smaFn(K.map(v => isNaN(v) ? 0 : v), SMOOTH_D);
    const stochBuy = K.map((kv, i) => i > 0 && K[i - 1] < D[i - 1] && kv >= D[i] && kv < 80);
    const stochSell = K.map((kv, i) => i > 0 && K[i - 1] > D[i - 1] && kv <= D[i] && kv > 20);
    const s20 = smaFn(C, 20), s50 = smaFn(C, 50), s100 = smaFn(C, 100), s200 = smaFn(C, 200);   // s20=볼린저밴드 중심선용
    // 골든/데드크로스 (SMA50 × SMA200) — 모멘텀 지표에서 이평선 라인 없이 화살표로만 표시
    const goldCross = C.map((c, i) => i > 0 && !isNaN(s50[i]) && !isNaN(s200[i]) && !isNaN(s50[i - 1]) && !isNaN(s200[i - 1]) && s50[i - 1] <= s200[i - 1] && s50[i] > s200[i]);
    const deadCross = C.map((c, i) => i > 0 && !isNaN(s50[i]) && !isNaN(s200[i]) && !isNaN(s50[i - 1]) && !isNaN(s200[i - 1]) && s50[i - 1] >= s200[i - 1] && s50[i] < s200[i]);
    const buyAbove200 = C.map((c, i) => {
      if (i < 2 || isNaN(s200[i]) || isNaN(s200[i - 1]) || isNaN(s200[i - 2])) return false;
      if (!(C[i - 2] < s200[i - 2] && C[i - 1] > s200[i - 1])) return false;
      if (c <= s200[i]) return false;
      return getWeeklyK(candles[i].ts) < 30;
    });
    const buyAbove100 = C.map((c, i) => {
      if (i < 2 || isNaN(s100[i]) || isNaN(s100[i - 1]) || isNaN(s100[i - 2])) return false;
      if (buyAbove200[i]) return false;
      if (!(C[i - 2] < s100[i - 2] && C[i - 1] > s100[i - 1])) return false;
      if (c <= s100[i]) return false;
      return getWeeklyK(candles[i].ts) < 30;
    });
    const e700 = emaFn(C, 700), e18 = emaFn(C, 18), e63 = emaFn(C, 63), e12 = emaFn(C, 12);
    const fM = emaFn(C, 168), sM = emaFn(C, 364), macdM = fM.map((v, i) => v - sM[i]), sigM = emaFn(macdM, 6);
    const fLT = emaFn(C, 9), sLT = emaFn(C, 19), macdLT = fLT.map((v, i) => v - sLT[i]), sigLT = emaFn(macdLT, 6);
    // 저점구간: MACD 시그널 상승전환 + 가격이 700-EMA 아래 (기관 매집 추정)
    const isAccum = C.map((c, i) => i > 0 && sigM[i - 1] < sigM[i] && c < e700[i]);
    // 고점구간: 단기EMA 꺾임 + 중기EMA 상승 + 700EMA 상승추세 + 장기MACD 둔화
    const isLocalTop = C.map((_, i) => i > 7 && !isNaN(e12[i]) && e12[i - 1] >= e12[i] && !isNaN(e18[i]) && e18[i] > e63[i] && !isNaN(e700[i]) && e700[i - 7] * 1.01 < e700[i] && !isNaN(sigLT[i]) && sigLT[i - 1] > sigLT[i]);
    const strongBuy = isAccum.map((acc, i) => acc && i > 0 && fLT[i - 1] <= sLT[i - 1] && fLT[i] > sLT[i]);

    // StochRSI (각도기)
    const RSI_LEN = 24, SRSI_LEN = 24, SRSI_K = 12, SRSI_D = 12;
    const rsiArr = Array(C.length).fill(NaN);
    if (C.length > RSI_LEN) {
      let avgG = 0, avgL = 0;
      for (let i = 1; i <= RSI_LEN; i++) { const ch = C[i] - C[i - 1]; avgG += Math.max(ch, 0); avgL += Math.max(-ch, 0); }
      avgG /= RSI_LEN; avgL /= RSI_LEN;
      rsiArr[RSI_LEN] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      for (let i = RSI_LEN + 1; i < C.length; i++) {
        const ch = C[i] - C[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0);
        avgG = (avgG * (RSI_LEN - 1) + g) / RSI_LEN; avgL = (avgL * (RSI_LEN - 1) + l) / RSI_LEN;
        rsiArr[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      }
    }
    const rsiLo = rolMin(rsiArr.map(v => isNaN(v) ? Infinity : v), SRSI_LEN);
    const rsiHi = rolMax(rsiArr.map(v => isNaN(v) ? -Infinity : v), SRSI_LEN);
    const stochRsi = rsiArr.map((v, i) => { if (isNaN(v) || !isFinite(rsiLo[i]) || !isFinite(rsiHi[i])) return NaN; const rng = rsiHi[i] - rsiLo[i]; return rng < 1e-10 ? 0 : 100 * (v - rsiLo[i]) / rng; });
    const rsiK = smaFn(stochRsi, SRSI_K);
    const rsiD = smaFn(rsiK.map(v => isNaN(v) ? 0 : v), SRSI_D);
    const rsiBuy = rsiK.map((kv, i) => { if (i < 1 || isNaN(rsiK[i]) || isNaN(rsiK[i - 1]) || isNaN(rsiD[i]) || isNaN(rsiD[i - 1])) return false; return rsiK[i - 1] <= rsiD[i - 1] && rsiK[i] > rsiD[i] && rsiK[i] < 20; });
    const rsiSell = rsiK.map((kv, i) => { if (i < 1 || isNaN(rsiK[i]) || isNaN(rsiK[i - 1]) || isNaN(rsiD[i]) || isNaN(rsiD[i - 1])) return false; return rsiK[i - 1] >= rsiD[i - 1] && rsiK[i] < rsiD[i] && rsiK[i] > 80; });

    // MACD (12,26,9)
    const macdFastA = emaFn(C, 12), macdSlowA = emaFn(C, 26);
    const macdLine = macdFastA.map((v, i) => (isNaN(v) || isNaN(macdSlowA[i])) ? NaN : v - macdSlowA[i]);
    const macdSig = emaFn(macdLine, 9);
    const macdHist = macdLine.map((v, i) => (isNaN(v) || isNaN(macdSig[i])) ? NaN : v - macdSig[i]);
    const macdBuy = macdHist.map((h, i) => i > 0 && !isNaN(macdHist[i - 1]) && !isNaN(h) && macdHist[i - 1] <= 0 && h > 0);
    const macdSell = macdHist.map((h, i) => i > 0 && !isNaN(macdHist[i - 1]) && !isNaN(h) && macdHist[i - 1] >= 0 && h < 0);
    const macdRevBuy = macdHist.map((h, i) => { if (i < 2 || isNaN(h) || isNaN(macdHist[i - 1]) || isNaN(macdHist[i - 2])) return false; return h < 0 && h > macdHist[i - 1] && macdHist[i - 1] <= macdHist[i - 2]; });
    const macdRevSell = macdHist.map((h, i) => { if (i < 2 || isNaN(h) || isNaN(macdHist[i - 1]) || isNaN(macdHist[i - 2])) return false; return h >= 0 && h <= macdHist[i - 1] && macdHist[i - 1] > macdHist[i - 2]; });


    // Ultimate RSI (LuxAlgo)
    const uRSI = computeUltimateRSI(C, { length: 14, smooth: 14 });

    // 💔 인간지표 (Pain Meter) — 고점 대비 손실% + 황금 다이버전스
    const pain = computePainMeter(candles, {});

    // 📐 다이버전스 (11개 지표 — LonesomeTheBlue v4)
    const div = computeDivergence(candles, {});

    // 거래량
    const vol = candles.map(c => c.volume || 0);
    const volMA = smaFn(vol, 20);
    const volUp = candles.map(c => c.close >= c.open);

    // 볼린저밴드 (20, 2σ) + %B (밴드 내 위치 0~100)
    const bbStd = stdevFn(C, 20);
    const bbUpper = s20.map((m, i) => (isNaN(m) || isNaN(bbStd[i])) ? NaN : m + 2 * bbStd[i]);
    const bbLower = s20.map((m, i) => (isNaN(m) || isNaN(bbStd[i])) ? NaN : m - 2 * bbStd[i]);
    const bbPctB = C.map((c, i) => { const u = bbUpper[i], l = bbLower[i]; return (isNaN(u) || isNaN(l) || u === l) ? NaN : (c - l) / (u - l) * 100; });

    return { K, D, stochBuy, stochSell, s50, s100, s200, goldCross, deadCross, buyAbove200, buyAbove100, isAccum, isLocalTop, strongBuy, rsiK, rsiD, rsiBuy, rsiSell, macdLine, macdSig, macdHist, macdBuy, macdSell, macdRevBuy, macdRevSell, vol, volMA, volUp, bbUpper, bbLower, bbPctB, painLoss: pain.mloss, painBull: pain.bullDiv, divBull: div.divBull, divBear: div.divBear, divList: div.divList, st: computeSupertrend(candles), shm: computeStochHeatmap(candles), ...uRSI, cvdd: (typeof window !== 'undefined' && window.CVDD) ? window.CVDD.compute(candles) : null, bti: (typeof window !== 'undefined' && window.BTI) ? window.BTI.compute(candles) : null, bubble: (typeof window !== 'undefined' && window.BUBBLE) ? window.BUBBLE.compute(candles, { weeklyCandles: opts.weeklyCandles }) : null, bbp: (typeof window !== 'undefined' && window.BBP) ? window.BBP.compute(candles) : null, powerlaw: computePowerLaw(candles), puell: computePuell(candles), maslope: computeMaSlope(candles), uodiv: computeUoDiv(candles), picycle: computePiCycle(candles), cycle: computeCycle(candles), ichimoku: computeIchimoku(candles), _getWeeklyK: getWeeklyK };
  }

  // ── 시그널 히스토리 빌드 (DOM/인박스 side-effect 없는 순수 함수) ──
  const LBL = {
    sma200: 'SMA200 돌파', sma100: 'SMA100 돌파',
    sb: '강한 매수신호', stochBuy: '모멘텀지수 매수', stochSell: '모멘텀지수 매도',
    rsiBuy: '각도기 매수', rsiSell: '각도기 매도', uRsiBuy: 'RSI 매수', uRsiSell: 'RSI 매도', macdBuy: 'MACD 매수', macdSell: 'MACD 매도',
    macdRevBuy: 'MACD 반전 매수', macdRevSell: 'MACD 반전 매도',
    divBull: '강세 다이버전스', divBullH: '히든 강세', divBear: '약세 다이버전스', divBearH: '히든 약세',
    piTop: '파이사이클 고점', piBot: '파이사이클 저점',
    cycleStart: '익절 시작 (4년주기)', cycleEnd: '익절 마감 · Last Call (4년주기)',
    stBuy: '수퍼트렌드 상승전환', stSell: '수퍼트렌드 하락전환',
    lossBull: '인간지표 바닥(황금)', uoDivBull: '다이버전스2 강세',
    bbpBuy: '불앤베어 저점', bbpSell: '불앤베어 고점',
    bubbleBuy: '거품지수 저평가', bubbleSell: '거품지수 과열',
    cvddBot: '파괴지수 바닥', cvddTop: '파괴지수 천장',
    puellUnder: 'Puell 저평가', puellOver: 'Puell 과열',
    btiBot: '통합지표 바닥', btiTop: '통합지표 천장',
    bbBuy: '볼린저 과매도탈출', shmBuy: '히트맵 매수', shmSell: '히트맵 매도', plBuy: '파워로 저평가', plSell: '파워로 고평가',
    ichBuy: '구름대 TK 골든', maslopeBuy: '각도기2 저점(노랑)', maslopeSell: '각도기2 고점(빨강)'
  };
  const LBL_EN = {
    sma200: 'SMA200 breakout', sma100: 'SMA100 breakout',
    sb: 'Strong Buy', stochBuy: 'Momentum buy', stochSell: 'Momentum sell',
    rsiBuy: 'Angle buy', rsiSell: 'Angle sell', uRsiBuy: 'RSI buy', uRsiSell: 'RSI sell', macdBuy: 'MACD buy', macdSell: 'MACD sell',
    macdRevBuy: 'MACD reversal buy', macdRevSell: 'MACD reversal sell',
    divBull: 'Bullish Divergence', divBullH: 'Hidden Bullish', divBear: 'Bearish Divergence', divBearH: 'Hidden Bearish',
    piTop: 'Pi Cycle Top', piBot: 'Pi Cycle Bottom',
    cycleStart: 'Profit START (4Y Cycle)', cycleEnd: 'Profit END · Last Call (4Y Cycle)',
    stBuy: 'Supertrend flips up', stSell: 'Supertrend flips down',
    lossBull: 'Human Index bottom', uoDivBull: 'Divergence2 bullish',
    bbpBuy: 'Bull&Bear bottom', bbpSell: 'Bull&Bear top',
    bubbleBuy: 'Bubble undervalued', bubbleSell: 'Bubble overheated',
    cvddBot: 'Destruction floor', cvddTop: 'Destruction ceiling',
    puellUnder: 'Puell undervalued', puellOver: 'Puell overheated',
    btiBot: 'Bottom Composite', btiTop: 'Top Composite',
    bbBuy: 'BB oversold exit', shmBuy: 'Heatmap buy', shmSell: 'Heatmap sell', plBuy: 'Power Law cheap', plSell: 'Power Law rich',
    ichBuy: 'Ichimoku TK cross', maslopeBuy: 'MA Slope bottom', maslopeSell: 'MA Slope top'
  };

  function buildSignals(candles, ind, tf, opts) {
    opts = opts || {};
    const getWeeklyK = ind._getWeeklyK || buildWeeklyKLookup(opts.weeklyCandles);
    const now = (opts.now || (candles.length ? candles[candles.length - 1].ts : 0));
    const dayMs = 24 * 60 * 60 * 1000;
    const winByTf = { '1d': 90 * dayMs, '1w': 365 * dayMs, '1M': 5 * 365 * dayMs };
    const calloutByTf = { '1d': 365 * dayMs, '1w': 2 * 365 * dayMs, '1M': 5 * 365 * dayMs };
    const threeM = winByTf[tf] || 90 * dayMs;
    const oneY = calloutByTf[tf] || 365 * dayMs;
    const isDWM = ['1d', '1w', '1M'].includes(tf);
    const isDW = tf === '1d' || tf === '1w';
    const list = [];
    const en = opts.lang === 'en';
    const LB = k => (en ? LBL_EN : LBL)[k];
    const T = (ko, eng) => en ? eng : ko;
    const isBtcD = opts.symbol === 'BTC-USD' && tf === '1d';   // 파이사이클 = BTC·일봉 전용
    const isBtcCycle = opts.symbol === 'BTC-USD' && isDWM;     // 4년주기 사이클 = BTC·일/주/월봉 공통
    const fmtP = v => (v >= 1000 ? '$' + Math.round(v).toLocaleString() : '$' + v.toFixed(2));

    candles.forEach((c, i) => {
      const age = now - c.ts;
      if (age > oneY) return;
      const dt = new Date(c.ts), ds = dt.getFullYear() + '.' + (dt.getMonth() + 1) + '.' + dt.getDate();
      const pr = fmtP(c.close);
      if (age > threeM) return;
      const wk = getWeeklyK(c.ts);
      if (ind.buyAbove200[i]) list.push({ type: 'buy', badge: 'sma200', label: LB('sma200'), cond: T('주봉K ' + wk.toFixed(0) + ' · 200일선 돌파 확정', 'Weekly K ' + wk.toFixed(0) + ' · SMA200 breakout'), date: ds, price: pr, ts: c.ts, indKey: 'sma200' });
      if (ind.buyAbove100[i]) list.push({ type: 'buy', badge: 'sma100', label: LB('sma100'), cond: T('주봉K ' + wk.toFixed(0) + ' · 100일선 돌파 확정', 'Weekly K ' + wk.toFixed(0) + ' · SMA100 breakout'), date: ds, price: pr, ts: c.ts, indKey: 'sma100' });
      if (ind.strongBuy[i]) list.push({ type: 'buy', badge: 'strong', label: LB('sb'), cond: T('저점구간 + 단기 모멘텀 전환', 'Low zone + short-term momentum turn'), date: ds, price: pr, ts: c.ts, indKey: 'strong' });
      if (isDWM && ind.stochBuy[i]) list.push({ type: 'buy', badge: 'stoch', label: LB('stochBuy'), cond: T('모멘텀지수 K>D 골든', 'Momentum K>D golden'), date: ds, price: pr, ts: c.ts, indKey: 'stoch' });
      if (isDWM && ind.stochSell[i]) list.push({ type: 'sell', badge: 'stoch', label: LB('stochSell'), cond: T('모멘텀지수 K<D 데드', 'Momentum K<D dead'), date: ds, price: pr, ts: c.ts, indKey: 'stoch' });
      if (isDWM && ind.rsiBuy[i]) list.push({ type: 'buy', badge: 'rsi', label: LB('rsiBuy'), cond: T('각도기 과매도 반등 (K' + ind.rsiK[i].toFixed(0) + ')', 'Angle oversold bounce (K' + ind.rsiK[i].toFixed(0) + ')'), date: ds, price: pr, ts: c.ts, indKey: 'rsi' });
      if (isDWM && ind.rsiSell[i]) list.push({ type: 'sell', badge: 'rsi', label: LB('rsiSell'), cond: T('각도기 과매수 꺾임 (K' + ind.rsiK[i].toFixed(0) + ')', 'Angle overbought rollover (K' + ind.rsiK[i].toFixed(0) + ')'), date: ds, price: pr, ts: c.ts, indKey: 'rsi' });
      if (isDWM && ind.uRsiBuy && ind.uRsiBuy[i]) list.push({ type: 'buy', badge: 'ursi', label: LB('uRsiBuy'), cond: 'RSI ' + ind.uRsi[i].toFixed(0) + T(' · 시그널선 상향', ' · cross above signal'), date: ds, price: pr, ts: c.ts, indKey: 'ursi' });
      if (isDWM && ind.uRsiSell && ind.uRsiSell[i]) list.push({ type: 'sell', badge: 'ursi', label: LB('uRsiSell'), cond: 'RSI ' + ind.uRsi[i].toFixed(0) + T(' · 시그널선 하향', ' · cross below signal'), date: ds, price: pr, ts: c.ts, indKey: 'ursi' });
      if (isDWM && ind.macdBuy[i]) list.push({ type: 'buy', badge: 'macd', label: LB('macdBuy'), cond: T('MACD 히스토그램 0선 상향', 'MACD hist crosses above 0'), date: ds, price: pr, ts: c.ts, indKey: 'macd' });
      if (isDWM && ind.macdSell[i]) list.push({ type: 'sell', badge: 'macd', label: LB('macdSell'), cond: T('MACD 히스토그램 0선 하향', 'MACD hist crosses below 0'), date: ds, price: pr, ts: c.ts, indKey: 'macd' });
      if (isDWM && ind.macdRevBuy[i]) list.push({ type: 'buy', badge: 'macd', label: LB('macdRevBuy'), cond: T('MACD 히스토그램 저점 반전', 'MACD hist bottom reversal'), date: ds, price: pr, ts: c.ts, indKey: 'macd' });
      if (isDWM && ind.macdRevSell[i]) list.push({ type: 'sell', badge: 'macd', label: LB('macdRevSell'), cond: T('MACD 히스토그램 고점 둔화', 'MACD hist top fading'), date: ds, price: pr, ts: c.ts, indKey: 'macd' });
      if (isDWM && ind.divBull && ind.divBull[i]) { const dv = ind.divBull[i]; const k = dv.kind === 'hidden' ? 'divBullH' : 'divBull'; list.push({ type: 'buy', badge: 'div', label: LB(k), cond: T(dv.src + ' · ' + (dv.kind === 'hidden' ? '가격 고저점 + 지표 저점 (추세지속)' : '가격 저점↓ + 지표 저점↑ (전환)'), dv.src + ' · ' + (dv.kind === 'hidden' ? 'price HL + ind LL' : 'price LL + ind HL')), date: ds, price: pr, ts: c.ts, indKey: 'div' }); }
      if (isDWM && ind.divBear && ind.divBear[i]) { const dv = ind.divBear[i]; const k = dv.kind === 'hidden' ? 'divBearH' : 'divBear'; list.push({ type: 'sell', badge: 'div', label: LB(k), cond: T(dv.src + ' · ' + (dv.kind === 'hidden' ? '가격 저고점 + 지표 고점 (추세지속)' : '가격 고점↑ + 지표 고점↓ (전환)'), dv.src + ' · ' + (dv.kind === 'hidden' ? 'price LH + ind HH' : 'price HH + ind LH')), date: ds, price: pr, ts: c.ts, indKey: 'div' }); }
      if (isBtcD && ind.picycle && ind.picycle.top && ind.picycle.top[i]) list.push({ type: 'sell', badge: 'pi', label: LB('piTop'), cond: T('SMA111 이 SMA350×2 상향돌파 (사이클 천장)', 'SMA111 crosses above SMA350×2 (cycle top)'), date: ds, price: pr, ts: c.ts, indKey: 'pi' });
      if (isBtcD && ind.picycle && ind.picycle.bot && ind.picycle.bot[i]) list.push({ type: 'buy', badge: 'pi', label: LB('piBot'), cond: T('SMA111 이 SMA471×0.745 하향이탈 (사이클 바닥)', 'SMA111 crosses below SMA471×0.745 (cycle bottom)'), date: ds, price: pr, ts: c.ts, indKey: 'pi' });
      if (isBtcCycle && ind.cycle && ind.cycle.vStart && ind.cycle.vStart[i]) list.push({ type: 'sell', badge: 'cycle', label: LB('cycleStart'), cond: T('반감기 +40주 · 익절 진입 구간 (분할 매도 시작)', 'Halving +40w · profit-taking zone begins'), date: ds, price: pr, ts: c.ts, indKey: 'cycle' });
      if (isBtcCycle && ind.cycle && ind.cycle.vEnd && ind.cycle.vEnd[i]) list.push({ type: 'sell', badge: 'cycle', label: LB('cycleEnd'), cond: T('반감기 +80주 · 약세장 전 마지막 매도 (Last Call)', 'Halving +80w · last call before bear market'), date: ds, price: pr, ts: c.ts, indKey: 'cycle' });
      // ── 고점/저점 지표 신호화(2026-06-19): 화면에만 뜨던 강력 지표를 시그널 히스토리에 포착. 전부 edge-trigger(중복 방지). ──
      // 수퍼트렌드(추세전환) — 전 종목·전 봉. buy/sell은 이미 flip 이벤트라 edge 불필요.
      if (isDWM && ind.st && ind.st.sell && ind.st.sell[i]) list.push({ type: 'sell', badge: 'st', label: LB('stSell'), cond: T('수퍼트렌드 하락 전환 (추세 꺾임)', 'Supertrend flips down (trend turns)'), date: ds, price: pr, ts: c.ts, indKey: 'st' });
      if (isDWM && ind.st && ind.st.buy && ind.st.buy[i]) list.push({ type: 'buy', badge: 'st', label: LB('stBuy'), cond: T('수퍼트렌드 상승 전환 (추세 반등)', 'Supertrend flips up (trend turns)'), date: ds, price: pr, ts: c.ts, indKey: 'st' });
      // 인간지표 황금 다이버전스(바닥권) — painBull 상승엣지
      if (isDWM && i > 0 && ind.painBull && ind.painBull[i] && !ind.painBull[i - 1]) list.push({ type: 'buy', badge: 'loss', label: LB('lossBull'), cond: T('인간지표 황금 다이버전스 (바닥권 매집)', 'Human Index golden divergence (bottom)'), date: ds, price: pr, ts: c.ts, indKey: 'loss' });
      // 다이버전스2 강세(UO 상승 다이버전스) — bullDiv 상승엣지
      if (isDWM && i > 0 && ind.uodiv && ind.uodiv.bullDiv && ind.uodiv.bullDiv[i] && !ind.uodiv.bullDiv[i - 1]) list.push({ type: 'buy', badge: 'uodiv', label: LB('uoDivBull'), cond: T('다이버전스2 강세 (UO 상승 다이버전스)', 'Divergence2 bullish (UO)'), date: ds, price: pr, ts: c.ts, indKey: 'uodiv' });
      // 불앤베어 — val이 기준선 thr 교차 (위=고점/아래=저점)
      if (isDWM && i > 0 && ind.bbp && ind.bbp.val) { const v = ind.bbp.val[i], pv = ind.bbp.val[i - 1], th = (ind.bbp.thr != null ? ind.bbp.thr : -2); if (v != null && pv != null && !isNaN(v) && !isNaN(pv)) { if (pv <= th && v > th) list.push({ type: 'sell', badge: 'bbp', label: LB('bbpSell'), cond: T('불앤베어 고점 파동 진입', 'Bull&Bear top wave'), date: ds, price: pr, ts: c.ts, indKey: 'bbp' }); else if (pv >= th && v < th) list.push({ type: 'buy', badge: 'bbp', label: LB('bbpBuy'), cond: T('불앤베어 저점 파동 진입', 'Bull&Bear bottom wave'), date: ds, price: pr, ts: c.ts, indKey: 'bbp' }); } }
      // 거품지수 — dev가 과열(high) 상향 / 저평가(-mid) 하향 교차
      if (isDWM && i > 0 && ind.bubble && ind.bubble.dev) { const v = ind.bubble.dev[i], pv = ind.bubble.dev[i - 1], H = (ind.bubble.thr && ind.bubble.thr.high) || 66, M = (ind.bubble.thr && ind.bubble.thr.mid) || 33; if (v != null && pv != null && !isNaN(v) && !isNaN(pv)) { if (pv < H && v >= H) list.push({ type: 'sell', badge: 'bubble', label: LB('bubbleSell'), cond: T('거품지수 과열권 진입', 'Bubble overheated zone'), date: ds, price: pr, ts: c.ts, indKey: 'bubble' }); else if (pv > -M && v <= -M) list.push({ type: 'buy', badge: 'bubble', label: LB('bubbleBuy'), cond: T('거품지수 저평가권 진입', 'Bubble undervalued zone'), date: ds, price: pr, ts: c.ts, indKey: 'bubble' }); } }
      // 파괴지수(BTC) — 천장/바닥 도달 상승엣지
      if (isBtcCycle && i > 0 && ind.cvdd && ind.cvdd.atTop && ind.cvdd.atTop[i] && !ind.cvdd.atTop[i - 1]) list.push({ type: 'sell', badge: 'cvdd', label: LB('cvddTop'), cond: T('파괴지수 천장 도달', 'Destruction Index ceiling'), date: ds, price: pr, ts: c.ts, indKey: 'cvdd' });
      if (isBtcCycle && i > 0 && ind.cvdd && ind.cvdd.atBottom && ind.cvdd.atBottom[i] && !ind.cvdd.atBottom[i - 1]) list.push({ type: 'buy', badge: 'cvdd', label: LB('cvddBot'), cond: T('파괴지수 바닥 도달', 'Destruction Index floor'), date: ds, price: pr, ts: c.ts, indKey: 'cvdd' });
      // Puell(BTC) — 과열/저평가 진입 상승엣지
      if (isBtcCycle && i > 0 && ind.puell && ind.puell.overBars && ind.puell.overBars[i] && !ind.puell.overBars[i - 1]) list.push({ type: 'sell', badge: 'puell', label: LB('puellOver'), cond: T('Puell 과열 (채굴수익 고점)', 'Puell overheated'), date: ds, price: pr, ts: c.ts, indKey: 'puell' });
      if (isBtcCycle && i > 0 && ind.puell && ind.puell.underBars && ind.puell.underBars[i] && !ind.puell.underBars[i - 1]) list.push({ type: 'buy', badge: 'puell', label: LB('puellUnder'), cond: T('Puell 저평가 (채굴수익 바닥)', 'Puell undervalued'), date: ds, price: pr, ts: c.ts, indKey: 'puell' });
      // BTI(BTC) — 천장/바닥 카운트 임계 상향 교차
      if (isBtcCycle && i > 0 && ind.bti && ind.bti.btiCount) { const v = ind.bti.btiCount[i], pv = ind.bti.btiCount[i - 1]; if (v != null && pv != null && pv < 6 && v >= 6) list.push({ type: 'sell', badge: 'bti', label: LB('btiTop'), cond: T('통합지표 천장 신호 다발', 'Top Composite cluster'), date: ds, price: pr, ts: c.ts, indKey: 'bti' }); }   // 천장 임계 8→6 튜닝(2026-06-19: 8은 발화 0)
      if (isBtcCycle && i > 0 && ind.bti && ind.bti.botCount) { const v = ind.bti.botCount[i], pv = ind.bti.botCount[i - 1]; if (v != null && pv != null && pv < 3 && v >= 3) list.push({ type: 'buy', badge: 'bti', label: LB('btiBot'), cond: T('통합지표 바닥 신호 다발', 'Bottom Composite cluster'), date: ds, price: pr, ts: c.ts, indKey: 'bti' }); }
      // 볼린저 %B 과매도 탈출(↓0 아래에서 위로) = 매수 (백테스트 63%, 매도측은 약해 제외)
      if (isDWM && i > 0 && ind.bbPctB) { const v = ind.bbPctB[i], pv = ind.bbPctB[i - 1]; if (v != null && pv != null && !isNaN(v) && !isNaN(pv) && pv <= 0 && v > 0) list.push({ type: 'buy', badge: 'bb', label: LB('bbBuy'), cond: T('볼린저 과매도 탈출 (%B>0)', 'BB oversold exit (%B>0)'), date: ds, price: pr, ts: c.ts, indKey: 'bb' }); }
      // 스토캐스틱 히트맵 fast×slow 교차 (백테스트 59%)
      if (isDWM && i > 0 && ind.shm && ind.shm.fast && ind.shm.slow) { const f = ind.shm.fast, s = ind.shm.slow; if (f[i] != null && s[i] != null && f[i - 1] != null && s[i - 1] != null) { if (f[i - 1] <= s[i - 1] && f[i] > s[i]) list.push({ type: 'buy', badge: 'shm', label: LB('shmBuy'), cond: T('히트맵 fast가 slow 상향', 'Heatmap fast crosses up'), date: ds, price: pr, ts: c.ts, indKey: 'shm' }); else if (f[i - 1] >= s[i - 1] && f[i] < s[i]) list.push({ type: 'sell', badge: 'shm', label: LB('shmSell'), cond: T('히트맵 fast가 slow 하향', 'Heatmap fast crosses down'), date: ds, price: pr, ts: c.ts, indKey: 'shm' }); } }
      // 각도기2(MA Slope) — 색상이 곧 신호(사용자 지정): 노랑(가파른 하락각)=저점 매수, 빨강(가파른 상승각)=고점 매도. 주봉·월봉 한정(일봉 노이즈).
      if ((tf === '1w' || tf === '1M') && i > 0 && ind.maslope && ind.maslope.colors) { const col = ind.maslope.colors; if (col[i] === '#ffd60a' && col[i - 1] !== '#ffd60a') list.push({ type: 'buy', badge: 'maslope', label: LB('maslopeBuy'), cond: T('각도기2 저점색(노랑) 진입 — 가파른 하락각', 'MA Slope yellow (steep down angle)'), date: ds, price: pr, ts: c.ts, indKey: 'maslope' }); else if (col[i] === '#f85149' && col[i - 1] !== '#f85149') list.push({ type: 'sell', badge: 'maslope', label: LB('maslopeSell'), cond: T('각도기2 고점색(빨강) 진입 — 가파른 상승각', 'MA Slope red (steep up angle)'), date: ds, price: pr, ts: c.ts, indKey: 'maslope' }); }
      // 구름대 전환선>기준선 TK 골든크로스 = 매수 (백테스트 60%, TK 데드는 49%로 제외)
      if (isDWM && i > 0 && ind.ichimoku && ind.ichimoku.conv && ind.ichimoku.base) { const cv = ind.ichimoku.conv, bs = ind.ichimoku.base; if (cv[i] != null && bs[i] != null && cv[i - 1] != null && bs[i - 1] != null && cv[i - 1] <= bs[i - 1] && cv[i] > bs[i]) list.push({ type: 'buy', badge: 'ich', label: LB('ichBuy'), cond: T('구름대 전환선>기준선 (TK 골든)', 'Tenkan crosses above Kijun'), date: ds, price: pr, ts: c.ts, indKey: 'ich' }); }
      // 파워로(BTC) close가 저평가밴드 이탈/고평가밴드 돌파 (백테스트 83~100%)
      if (isBtcCycle && i > 0 && ind.powerlaw && ind.powerlaw.lower1 && ind.powerlaw.upper1) { const pl = ind.powerlaw, l = pl.lower1, u = pl.upper1, c0 = c.close, c1 = candles[i - 1].close; if (l[i] != null && l[i - 1] != null && c1 >= l[i - 1] && c0 < l[i]) list.push({ type: 'buy', badge: 'powerlaw', label: LB('plBuy'), cond: T('파워로 저평가밴드 진입 (장기 바닥권)', 'Power Law undervalued band'), date: ds, price: pr, ts: c.ts, indKey: 'powerlaw' }); if (u[i] != null && u[i - 1] != null && c1 <= u[i - 1] && c0 > u[i]) list.push({ type: 'sell', badge: 'powerlaw', label: LB('plSell'), cond: T('파워로 고평가밴드 돌파 (장기 천장권)', 'Power Law overvalued band'), date: ds, price: pr, ts: c.ts, indKey: 'powerlaw' }); }
    });
    list.sort((a, b) => b.ts - a.ts);
    list.forEach(x => x.tf = tf);
    return list;
  }

  // ── 현재 고점/저점 구간 상태 (리스트 배지용) ─────────────
  //  최신 봉 기준. strongBuy > 저점 > 고점 > 중립 우선순위.
  function currentZone(ind) {
    if (!ind || !ind.isAccum || !ind.isAccum.length) return { state: '중립', cls: 'neutral' };
    const i = ind.isAccum.length - 1;
    if (ind.strongBuy[i]) return { state: '강한매수', cls: 'strong' };
    if (ind.isAccum[i]) return { state: '저점', cls: 'low' };
    if (ind.isLocalTop[i]) return { state: '고점', cls: 'high' };
    // 직전 며칠 내 구간 진입 여부도 반영 (최근 3봉)
    for (let k = Math.max(0, i - 2); k <= i; k++) {
      if (ind.isAccum[k]) return { state: '저점권', cls: 'low' };
      if (ind.isLocalTop[k]) return { state: '고점권', cls: 'high' };
    }
    return { state: '중립', cls: 'neutral' };
  }

  // ── 적중률 (같은 indKey 과거 시그널 N개 중 M개 적중) ──
  function accuracy(signals, candles, indKey, lookbackBars) {
    const same = signals.filter(x => x.indKey === indKey);
    if (same.length < 3) return null;
    let hits = 0, total = 0;
    const off = lookbackBars || 7;
    for (const sig of same) {
      const idx = candles.findIndex(c => c.ts === sig.ts);
      if (idx < 0 || idx + off >= candles.length) continue;
      const gain = (candles[idx + off].close - candles[idx].close) / candles[idx].close;
      if (sig.type === 'buy' ? gain > 0 : gain < 0) hits++;
      total++;
    }
    return total >= 3 ? { hits, total, pct: Math.round(hits / total * 100) } : null;
  }

  global.Indicators = { compute, buildSignals, currentZone, accuracy, smaFn, emaFn };
})(typeof window !== 'undefined' ? window : globalThis);
