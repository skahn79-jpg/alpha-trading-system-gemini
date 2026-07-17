/**
 * ALPHA TRADING SYSTEM - 예상 청산 분포(청산맵) 추정 엔진
 *
 * CoinGlass류 청산맵의 무료 추정 버전:
 * 최근 7일 1시간봉 거래량을 "그 가격대에서 열린 레버리지 포지션"의 대리 지표로 보고,
 * 레버리지 티어(10/25/50/100배)별 예상 청산가에 거래대금을 배분해
 * 현재가 위(숏 청산 존)·아래(롱 청산 존)의 청산 밀집 구간을 추정합니다.
 *
 * 데이터: OKX 공개 캔들 (키 불필요, KR/US 접근 가능)
 * 주의: 실제 미결제약정 데이터가 아닌 거래량 기반 추정치입니다.
 */

const axios = require("axios");

// 레버리지 티어별 가중치 — 고배율일수록 포지션 규모 비중은 작다고 가정
const TIERS = [
  { lev: 10, w: 0.40 },
  { lev: 25, w: 0.30 },
  { lev: 50, w: 0.20 },
  { lev: 100, w: 0.10 },
];
const MMR = 0.9; // 유지증거금 감안 계수: 청산가 = entry*(1 ± (1/lev)*MMR)
const RANGE_PCT = 0.18; // 현재가 ±18% 구간만 표시
const BUCKET_COUNT = 36; // 구간 수 (짝수 — 위/아래 18개씩)
const RECENCY_HALFLIFE_H = 72; // 시간 경과 감쇠 반감기(시간) — 오래된 포지션은 닫혔다고 가정
const OPEN_FRACTION = 0.06; // 거래대금 중 레버리지 미결제로 남는 비율 가정

const cache = new Map(); // symbol → { at, data }
const TTL_MS = 5 * 60 * 1000;

async function fetchOkxCandles(instId) {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1H&limit=168`;
  const { data } = await axios.get(url, { timeout: 12000 });
  if (data?.code !== "0" || !Array.isArray(data?.data)) {
    throw new Error(`OKX 캔들 조회 실패: ${data?.msg || "unknown"}`);
  }
  // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] — 최신순
  return data.data.map((r) => ({
    ts: Number(r[0]),
    close: Number(r[4]),
    volUsd: Number(r[7]) || Number(r[6]) || 0,
  })).filter((c) => Number.isFinite(c.close) && c.close > 0);
}

async function buildLiqMap(symbol = "BTC") {
  const key = String(symbol).toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const candles = await fetchOkxCandles(`${key}-USDT`);
  if (candles.length < 24) throw new Error("캔들 데이터 부족");

  const price = candles[0].close;
  const lo = price * (1 - RANGE_PCT);
  const hi = price * (1 + RANGE_PCT);
  const step = (hi - lo) / BUCKET_COUNT;

  const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    priceLow: lo + i * step,
    priceHigh: lo + (i + 1) * step,
    longUsd: 0, // 이 구간까지 하락 시 터질 롱 청산 추정액
    shortUsd: 0, // 이 구간까지 상승 시 터질 숏 청산 추정액
  }));

  const now = candles[0].ts;
  const add = (p, side, usd) => {
    if (p < lo || p >= hi || usd <= 0) return;
    const idx = Math.min(BUCKET_COUNT - 1, Math.floor((p - lo) / step));
    buckets[idx][side] += usd;
  };

  for (const c of candles) {
    const ageH = Math.max(0, (now - c.ts) / 3600000);
    const decay = Math.pow(0.5, ageH / RECENCY_HALFLIFE_H);
    const base = c.volUsd * OPEN_FRACTION * decay;
    if (!base) continue;
    for (const t of TIERS) {
      const notional = base * t.w;
      // 롱 포지션: entry 아래로 밀리면 청산 / 숏: entry 위로 오르면 청산
      const liqLong = c.close * (1 - (1 / t.lev) * MMR);
      const liqShort = c.close * (1 + (1 / t.lev) * MMR);
      // 이미 지나간 레벨(롱 청산가가 현재가 위)은 청산됐다고 보고 제외
      if (liqLong < price) add(liqLong, "longUsd", notional / 2);
      if (liqShort > price) add(liqShort, "shortUsd", notional / 2);
    }
  }

  const maxUsd = Math.max(1, ...buckets.map((b) => Math.max(b.longUsd, b.shortUsd)));
  const rows = buckets.map((b) => ({
    priceLow: Math.round(b.priceLow * 100) / 100,
    priceHigh: Math.round(b.priceHigh * 100) / 100,
    longUsd: Math.round(b.longUsd),
    shortUsd: Math.round(b.shortUsd),
    intensity: Math.round((Math.max(b.longUsd, b.shortUsd) / maxUsd) * 100),
  }));

  // 핵심 요약: 현재가 위/아래 최대 밀집 구간 (자석/지지 해석용)
  const below = rows.filter((b) => b.priceHigh <= price && b.longUsd > 0);
  const above = rows.filter((b) => b.priceLow >= price && b.shortUsd > 0);
  const maxBelow = below.sort((a, b) => b.longUsd - a.longUsd)[0] || null;
  const maxAbove = above.sort((a, b) => b.shortUsd - a.shortUsd)[0] || null;
  const totalLong = below.reduce((s, b) => s + b.longUsd, 0);
  const totalShort = above.reduce((s, b) => s + b.shortUsd, 0);

  const data = {
    ok: true,
    symbol: key,
    price,
    buckets: rows,
    summary: {
      totalLongUsd: totalLong,
      totalShortUsd: totalShort,
      // 상방 자석: 숏 청산 밀집 → 가격이 끌려 올라가며 연쇄 청산 유발 가능
      magnetUp: maxAbove ? { price: Math.round((maxAbove.priceLow + maxAbove.priceHigh) / 2), usd: maxAbove.shortUsd } : null,
      // 하방 리스크: 롱 청산 밀집 → 붕괴 시 연쇄 하락 가속 구간
      magnetDown: maxBelow ? { price: Math.round((maxBelow.priceLow + maxBelow.priceHigh) / 2), usd: maxBelow.longUsd } : null,
      bias: totalLong + totalShort > 0
        ? Math.round((totalShort / (totalLong + totalShort)) * 100) // % — 50 초과면 상방 청산 물량 우위
        : 50,
    },
    method: "거래량 가중 레버리지(10·25·50·100배) 청산가 추정 — 실제 미결제약정이 아닌 추정치",
    updatedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { buildLiqMap };
