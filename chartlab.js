/**
 * ALPHA TRADING SYSTEM - 차트 랩 (집중 차트 분석)
 *
 *  1) 매물대(볼륨 프로파일): 가격 구간별 거래량 분포 → POC·상방 부담/하방 지지
 *  2) 과거 유사 패턴 전망: 최근 흐름과 상관관계 높은 과거 구간의 이후 수익률 통계
 *  3) 자동 해설: 전 지표를 종합한 전문가 스타일 해석 텍스트 (규칙 기반)
 *
 * 투자 참고용 정보이며 투자 권유가 아닙니다.
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 매물대 분석 — 가격 24구간 거래량 분포 (candles: 최신순) */
function volumeProfile(candlesNewestFirst, bins = 24) {
  const candles = candlesNewestFirst;
  if (!Array.isArray(candles) || candles.length < 30) return null;
  const lows = candles.map((c) => num(c.low));
  const highs = candles.map((c) => num(c.high));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  if (max <= min) return null;
  const step = (max - min) / bins;

  const profile = Array.from({ length: bins }, (_, i) => ({
    priceLow: Math.round(min + step * i),
    priceHigh: Math.round(min + step * (i + 1)),
    volume: 0,
  }));
  for (const c of candles) {
    const tp = (num(c.high) + num(c.low) + num(c.close)) / 3;
    let idx = Math.floor((tp - min) / step);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    profile[idx].volume += num(c.volume);
  }

  const totalVol = profile.reduce((a, b) => a + b.volume, 0) || 1;
  const close = num(candles[0].close);
  let poc = profile[0];
  for (const bin of profile) if (bin.volume > poc.volume) poc = bin;

  // 현재가 위/아래 매물 비중
  let above = 0; let below = 0;
  for (const bin of profile) {
    const mid = (bin.priceLow + bin.priceHigh) / 2;
    if (mid > close) above += bin.volume;
    else below += bin.volume;
  }

  // 고매물 구간(HVN) 상위 3개 — 지지/저항 후보
  const hvn = [...profile].sort((a, b) => b.volume - a.volume).slice(0, 3)
    .map((b) => ({ priceLow: b.priceLow, priceHigh: b.priceHigh, sharePct: Math.round((b.volume / totalVol) * 1000) / 10 }));

  return {
    bins: profile.map((b) => ({ ...b, sharePct: Math.round((b.volume / totalVol) * 1000) / 10 })),
    poc: { priceLow: poc.priceLow, priceHigh: poc.priceHigh, sharePct: Math.round((poc.volume / totalVol) * 1000) / 10 },
    abovePct: Math.round((above / totalVol) * 100),
    belowPct: Math.round((below / totalVol) * 100),
    hvn,
    pocPosition: close > poc.priceHigh ? 'above_poc' : close < poc.priceLow ? 'below_poc' : 'at_poc',
  };
}

/** 과거 유사 패턴 전망 — 최근 window봉과 상관 높은 과거 구간의 이후 horizon봉 수익률 통계 */
function patternOutlook(candlesNewestFirst, { window = 20, horizon = 10, topK = 5 } = {}) {
  const closes = [...candlesNewestFirst].reverse().map((c) => num(c.close)); // 과거→현재
  const N = closes.length;
  if (N < window * 2 + horizon + 30) return null;

  const returns = [];
  for (let i = 1; i < N; i += 1) returns.push(closes[i - 1] ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);

  const norm = (arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length) || 1e-9;
    return arr.map((v) => (v - mean) / std);
  };

  const target = norm(returns.slice(-window));
  const matches = [];
  // 최근 구간과 겹치지 않는 과거 윈도우 전수 비교
  for (let start = 0; start + window + horizon < returns.length - window; start += 1) {
    const seg = norm(returns.slice(start, start + window));
    let corr = 0;
    for (let i = 0; i < window; i += 1) corr += seg[i] * target[i];
    corr /= window;
    // 이후 horizon봉 수익률
    const entryIdx = start + window; // returns 인덱스 → closes[entryIdx] 가 진입가
    const entry = closes[entryIdx];
    const exit = closes[Math.min(entryIdx + horizon, closes.length - 1)];
    if (!entry) continue;
    matches.push({ start, corr, fwdReturn: ((exit - entry) / entry) * 100 });
  }
  if (matches.length < topK) return null;
  matches.sort((a, b) => b.corr - a.corr);
  const top = matches.slice(0, topK);
  const avg = top.reduce((a, b) => a + b.fwdReturn, 0) / top.length;
  const ups = top.filter((m) => m.fwdReturn > 0).length;

  return {
    window,
    horizon,
    samples: top.map((m) => ({ corr: Math.round(m.corr * 100) / 100, fwdReturn: Math.round(m.fwdReturn * 10) / 10 })),
    avgReturn: Math.round(avg * 10) / 10,
    upProbability: Math.round((ups / top.length) * 100),
    note: `과거 유사 흐름 ${top.length}건의 이후 ${horizon}일 수익률 통계 (표본이 적어 참고용)`,
  };
}

/** 규칙 기반 자동 해설 — 전 지표 종합 전문가 스타일 해석 */
function buildCommentary({ analysis = {}, profile = null, outlook = null, close = 0 }) {
  const parts = [];

  // 1) 추세 요약
  const trendBits = [];
  if (analysis.adx) {
    const dir = analysis.adx.direction === 'up' ? '상승' : analysis.adx.direction === 'down' ? '하락' : '중립';
    trendBits.push(`ADX ${analysis.adx.adx}로 추세 강도는 ${analysis.adx.strength === 'weak' ? '약한 편' : '뚜렷한 편'}이며 방향은 ${dir}입니다`);
  }
  if (analysis.ichimoku) {
    trendBits.push(`일목균형표 기준 주가는 ${analysis.ichimoku.status === 'above_cloud' ? '구름대 위(우호)' : analysis.ichimoku.status === 'below_cloud' ? '구름대 아래(부담)' : '구름대 내부(방향 탐색)'}에 있습니다`);
  }
  if (analysis.supertrend) {
    trendBits.push(`SuperTrend는 ${analysis.supertrend.direction === 'up' ? '상승' : '하락'} 상태${analysis.supertrend.flipped ? ' (직전 전환 발생!)' : ''}`);
  }
  if (trendBits.length) parts.push(`【추세】 ${trendBits.join('. ')}.`);

  // 2) 모멘텀
  const momBits = [];
  if (analysis.rsi !== null && analysis.rsi !== undefined) {
    momBits.push(`RSI ${analysis.rsi}${analysis.rsi >= 70 ? ' (과매수 — 단기 과열 주의)' : analysis.rsi <= 30 ? ' (과매도 — 반등 후보 구간)' : ''}`);
  }
  if (analysis.macd) {
    momBits.push(`MACD는 ${analysis.macd.cross === 'golden' ? '골든크로스 직후' : analysis.macd.cross === 'dead' ? '데드크로스 직후' : analysis.macd.trend === 'bullish' ? '상승 흐름' : '하락 흐름'}`);
  }
  if (analysis.stochasticSlow?.inWell) momBits.push('스토캐스틱 슬로우가 우물(바닥권)에 진입');
  if (analysis.mfi) momBits.push(`MFI ${analysis.mfi.value} (${analysis.mfi.status === 'oversold' ? '자금 유입 대기' : analysis.mfi.status === 'overbought' ? '단기 자금 과열' : '중립'})`);
  if (momBits.length) parts.push(`【모멘텀】 ${momBits.join(', ')}.`);

  // 3) 매물대
  if (profile) {
    const pocMid = Math.round((profile.poc.priceLow + profile.poc.priceHigh) / 2);
    let vpText = `최대 매물대(POC)는 ${pocMid.toLocaleString()}원 부근(거래 비중 ${profile.poc.sharePct}%)입니다. `;
    if (profile.pocPosition === 'above_poc') {
      vpText += `현재가가 POC 위에 있어 하방에 매물 지지(전체의 ${profile.belowPct}%)가 두터운 구조입니다.`;
    } else if (profile.pocPosition === 'below_poc') {
      vpText += `현재가 위로 매물 부담(전체의 ${profile.abovePct}%)이 있어 상승 시 매물 소화가 필요합니다.`;
    } else {
      vpText += '현재가가 최대 매물대 안에 있어 방향 결정 구간입니다.';
    }
    parts.push(`【매물대】 ${vpText}`);
  }

  // 4) 지지·저항 / 피보나치
  const srBits = [];
  if (analysis.supportResistance?.support) srBits.push(`피벗 지지선 ${Math.round(analysis.supportResistance.support).toLocaleString()}원 (이격 ${analysis.supportResistance.supportDist}%)`);
  if (analysis.supportResistance?.resistance) srBits.push(`저항선 ${Math.round(analysis.supportResistance.resistance).toLocaleString()}원 (여력 ${analysis.supportResistance.resistanceDist}%)`);
  if (analysis.fibonacci?.nearest) srBits.push(`피보나치 ${Math.round(analysis.fibonacci.nearest.ratio * 1000) / 10}% 레벨(${Math.round(analysis.fibonacci.nearest.price).toLocaleString()}원)에 근접`);
  if (srBits.length) parts.push(`【지지·저항】 ${srBits.join(', ')}.`);

  // 5) 특이 신호
  const sigBits = [];
  if (analysis.divergence?.bullish) sigBits.push(`강세 다이버전스(${analysis.divergence.bullish.indicators.join('·')}) — 가격 신저점 대비 지표 개선`);
  if (analysis.divergence?.bearish) sigBits.push(`약세 다이버전스(${analysis.divergence.bearish.indicators.join('·')}) — 고점 경계`);
  if (analysis.vixFix?.spike) sigBits.push('VixFix 공포 스파이크 — 역발상 기회 후보');
  if ((analysis.patterns || []).length) sigBits.push(`캔들 패턴: ${analysis.patterns.map((p) => p.name).join(', ')}`);
  if (analysis.minervini) sigBits.push(`미너비니 추세 템플릿 ${analysis.minervini.passed}/8 통과`);
  if (sigBits.length) parts.push(`【특이 신호】 ${sigBits.join('. ')}.`);

  // 6) 과거 패턴 전망
  if (outlook) {
    parts.push(`【과거 패턴 전망】 최근 ${outlook.window}일 흐름과 유사한 과거 구간 ${outlook.samples.length}건의 이후 ${outlook.horizon}일 평균 수익률은 ${outlook.avgReturn >= 0 ? '+' : ''}${outlook.avgReturn}%, 상승 확률은 ${outlook.upProbability}%였습니다. 표본이 제한적이므로 방향 참고용으로만 활용하세요.`);
  }

  // 7) 종합
  if (analysis.score !== undefined) {
    parts.push(`【종합】 기술적 종합 점수 ${analysis.score}점 (${analysis.grade}등급) · ${analysis.action || ''}. ${analysis.summary || ''}`);
  }

  // 8) 지표 간 상충 안내 — 기술 점수(추세·컨플루언스)와 과거 패턴 전망(평균회귀 성향 표본)은
  // 서로 다른 근거로 산출되므로, 방향이 반대일 때는 그 이유를 명시해 오해를 줄인다.
  if (analysis.score !== undefined && outlook) {
    const highScore = analysis.score >= 80;
    const lowScore = analysis.score <= 40;
    const bearishOutlook = outlook.avgReturn < 0 || outlook.upProbability < 40;
    const bullishOutlook = outlook.avgReturn > 0 || outlook.upProbability > 60;
    if (highScore && bearishOutlook) {
      parts.push(`【참고】 기술적 종합 점수(${analysis.score}점)는 추세·컨플루언스 기준으로 우호적이지만, 과거 유사 패턴 전망은 표본 기준 하락 우위입니다. 두 지표는 산출 근거가 달라 상반될 수 있으니 함께 참고하고 단일 지표만으로 판단하지 마세요.`);
    } else if (lowScore && bullishOutlook) {
      parts.push(`【참고】 기술적 종합 점수(${analysis.score}점)는 낮지만, 과거 유사 패턴 전망은 표본 기준 상승 우위입니다. 두 지표는 산출 근거가 달라 상반될 수 있으니 함께 참고하고 단일 지표만으로 판단하지 마세요.`);
    }
  }

  parts.push('본 해설은 규칙 기반 자동 생성 참고 정보이며 투자 권유가 아닙니다.');
  return parts;
}

module.exports = { volumeProfile, patternOutlook, buildCommentary };
