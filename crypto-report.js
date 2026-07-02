/**
 * ALPHA TRADING SYSTEM - 암호화폐 관찰 리포트 + 뉴스 RSS 모듈
 *
 *  · 업황: 공포탐욕 지수(alternative.me, 키 불필요) + 글로벌 시총/도미넌스(CoinGecko, 실패 시 생략)
 *  · 규제 관찰: 구글 뉴스 RSS — CLARITY 법안 등 지정 키워드 지속 추적 (키 불필요)
 *  · 악시오스 뉴스: 공개 RSS
 *  차트 분석(analyzeCandles)은 server.js에서 Yahoo 캔들로 수행해 합칩니다.
 *
 * 투자 참고용 정보이며 투자 권유가 아닙니다.
 */

const axios = require("axios");

const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml, application/xml, text/xml, application/json" };

// ── RSS 파서 (의존성 없이 최소 구현) ──
function parseRssItems(xml, limit = 10) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`).exec(block);
      return r ? r[1].replace(/<[^>]*>/g, "").trim() : null;
    };
    const title = pick("title");
    const link = pick("link");
    const pubDate = pick("pubDate");
    const source = pick("source");
    if (title && link) {
      items.push({
        title,
        link,
        source: source || null,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
      });
    }
  }
  return items;
}

async function fetchGoogleNews(query, limit = 6) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const { data } = await axios.get(url, { timeout: 15000, headers: UA, responseType: "text" });
  return parseRssItems(data, limit);
}

async function fetchBingNews(query, limit = 6) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
  const { data } = await axios.get(url, { timeout: 15000, headers: UA, responseType: "text" });
  return parseRssItems(data, limit);
}

/** 구글 뉴스 우선, 실패/빈 결과 시 Bing 뉴스 폴백 (데이터센터 IP 차단 대비) */
async function fetchNewsWithFallback(query, limit = 6) {
  try {
    const items = await fetchGoogleNews(query, limit);
    if (items.length) return items;
  } catch {
    // 폴백으로
  }
  try {
    return await fetchBingNews(query, limit);
  } catch {
    return [];
  }
}

// ── 공포탐욕 지수 ──
async function fetchFearGreed() {
  const { data } = await axios.get("https://api.alternative.me/fng/?limit=30", { timeout: 15000, headers: UA });
  const rows = Array.isArray(data?.data) ? data.data : [];
  if (!rows.length) return null;
  const now = rows[0];
  return {
    value: Number(now.value),
    label: now.value_classification,
    labelKo: fngKo(now.value_classification),
    history: rows.slice(0, 30).map((r) => Number(r.value)).reverse(), // 과거→현재
  };
}

function fngKo(label) {
  switch (String(label || "").toLowerCase()) {
    case "extreme fear": return "극단적 공포";
    case "fear": return "공포";
    case "neutral": return "중립";
    case "greed": return "탐욕";
    case "extreme greed": return "극단적 탐욕";
    default: return label || "-";
  }
}

// ── 글로벌 시총/도미넌스 (실패 시 null) ──
async function fetchGlobalCrypto() {
  try {
    const { data } = await axios.get("https://api.coingecko.com/api/v3/global", { timeout: 15000, headers: UA });
    const d = data?.data;
    if (!d) return null;
    return {
      totalMarketCapT: Math.round((d.total_market_cap?.usd || 0) / 1e10) / 100, // 조 달러
      btcDominance: Math.round((d.market_cap_percentage?.btc || 0) * 10) / 10,
      ethDominance: Math.round((d.market_cap_percentage?.eth || 0) * 10) / 10,
      mcapChange24h: Math.round((d.market_cap_change_percentage_24h_usd || 0) * 10) / 10,
    };
  } catch {
    return null;
  }
}

// ── 규제/법안 관찰 (지속 추적 키워드) ──
const REGULATION_QUERIES = [
  { topic: "CLARITY 법안", query: "암호화폐 CLARITY 법안" },
  { topic: "스테이블코인 규제", query: "스테이블코인 법안 규제" },
  { topic: "국내 가상자산 규제", query: "가상자산 이용자보호법" },
];

async function fetchRegulationNews() {
  const out = [];
  for (const rq of REGULATION_QUERIES) {
    const items = await fetchNewsWithFallback(rq.query, 4);
    if (items.length) out.push({ topic: rq.topic, items });
  }
  return out;
}

// ── 악시오스 뉴스 ──
let axiosNewsCache = { at: 0, data: null };
async function fetchAxiosNews(limit = 8) {
  if (axiosNewsCache.data && Date.now() - axiosNewsCache.at < 15 * 60 * 1000) return axiosNewsCache.data;
  const { data } = await axios.get("https://api.axios.com/feed/", { timeout: 15000, headers: UA, responseType: "text" });
  const items = parseRssItems(data, limit);
  const result = { ok: items.length > 0, source: "Axios", items, updatedAt: new Date().toISOString() };
  if (result.ok) axiosNewsCache = { at: Date.now(), data: result };
  return result;
}

module.exports = { fetchFearGreed, fetchGlobalCrypto, fetchRegulationNews, fetchAxiosNews, fetchGoogleNews };
