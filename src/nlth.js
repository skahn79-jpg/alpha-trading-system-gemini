/*
 * lthsupply.js — 장기보유자 공급 (Long Term Holder Supply) 2차 스케일 오버레이 · BTC 전용
 *   bitcoinmagazinepro.com "Bitcoin: Long Term Holder Supply" 재현 — 155일+ 미이동 BTC 물량.
 *   강세장=분배(↓) · 약세장=매집(↑) → 사이클 바닥/천장 신호. 파란 면적(좌축 BTC 단위, 가격과 다른 스케일).
 *
 *   ⚠️ 진짜 LTH는 UTXO 연령 온체인 분석 → 무료 소스 없음(Glassnode/CoinMetrics Pro 유료).
 *      앱의 다른 온체인 지표(Puell/CVDD/NUPL/MVRV, bti.js)처럼 가격/시간 파생 프록시(오프라인·fetch 불필요):
 *        LTH ≈ 채굴공급량(반감기 일정으로 결정적) × 보유분율 f(t)
 *        · 채굴공급 = 발행 스케줄(50→25→12.5→6.25→3.125, 일평균 144블록) 누적 — 현재 ≈ 20.0M(실측 SplyCur 일치)
 *        · f(t) = 기준분율(시간상승 0.60→0.78, 네트워크 성숙·코인 소실) − 가격모멘텀(강세=분배로 ↓)
 *      값은 근사(실 LTH 아님). 검증: 현재 ≈ 15.6M (원본 ~15.5M 근접).
 */
(function (global) {
  'use strict';

  // 반감기 epoch [경계ms, 경계시점 누적공급, 블록보상]
  const EP = [
    [Date.UTC(2009, 0, 3), 0, 50],
    [Date.UTC(2012, 10, 28), 10500000, 25],
    [Date.UTC(2016, 6, 9), 15750000, 12.5],
    [Date.UTC(2020, 4, 11), 18375000, 6.25],
    [Date.UTC(2024, 3, 20), 19687500, 3.125],
  ];
  function mined(ms) {
    let e = EP[0]; for (let i = 0; i < EP.length; i++) if (ms >= EP[i][0]) e = EP[i];
    const days = (ms - e[0]) / 86400000;
    return Math.min(21e6, e[1] + e[2] * 144 * days);   // 발행 누적(일 144블록), 21M 상한
  }

  function compute(candles) {
    if (!candles || candles.length < 2) return null;
    const n = candles.length, ts = new Array(n), cl = new Array(n);
    for (let i = 0; i < n; i++) { let m = candles[i].ts; if (m < 1e12) m *= 1000; ts[i] = m; cl[i] = candles[i].close || (i > 0 ? cl[i - 1] : 0); }
    const data = new Array(n);
    for (let i = 0; i < n; i++) {
      const yr = 1970 + ts[i] / (365.2425 * 86400000);
      const base = Math.max(0.60, Math.min(0.78, 0.60 + (yr - 2011) * 0.011));   // 장기보유 비중 시간상승
      let j = i; while (j > 0 && ts[i] - ts[j] < 180 * 86400000) j--;            // ~180일 전 봉
      const mom = (cl[j] > 0) ? Math.log(cl[i] / cl[j]) : 0;                     // 가격 모멘텀
      const f = Math.max(0.55, Math.min(0.82, base - 0.05 * Math.tanh(mom * 0.7)));   // 강세 모멘텀↑ → 분율↓(분배)
      data[i] = mined(ts[i]) * f;
    }
    let now = NaN; for (let i = n - 1; i >= 0; i--) { if (isFinite(data[i])) { now = data[i]; break; } }
    return { data: data, now: now };
  }

  global.LTHSupply = { compute: compute };
})(typeof window !== 'undefined' ? window : this);
