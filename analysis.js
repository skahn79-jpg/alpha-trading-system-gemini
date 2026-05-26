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

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  const action = score >= 80 ? '관심 진입 후보' : score >= 65 ? '분할 관찰 후보' : score >= 50 ? '중립/대기' : '리스크 관리 우선';

  return {
    grade,
    score,
    action,
    baseLine: ma20 ? '20일선' : ma5 ? '5일선' : '데이터 부족',
    movingAverages: { ma5, ma20, ma60, ma120 },
    distance: { ma20: dist20, ma60: dist60 },
    volume: { latest: num(latest.volume), avg20: avgVol20, ratio: volRatio },
    confluence: signals.length,
    signals,
    summary: `${action} · 점수 ${score}점 · 컨플루언스 ${signals.length}개${dist20 !== null ? ` · 20일선 이격 ${dist20.toFixed(1)}%` : ''}`,
  };
}

module.exports = { analyzeCandles };
