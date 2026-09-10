/**
 * ALPHA TRADING SYSTEM - 암호화폐 관찰 리포트 + 뉴스 RSS 모듈
 *
 *  · 업황: 공포탐욕 지수(alternative.me, 키 불필요) + 글로벌 시총/도미넌스(CoinGecko, 실패 시 생략)
 *  · 규제 관찰: 구글 뉴스 RSS — CLARITY 법안 등 지정 키워드 지속 추적 (키 불필요)
 *  · 악시오스/트럼프 뉴스: 공개 RSS. 구글 뉴스는 when:7d + 14일 컷 + 최신순 (키 불필요)
 *  차트 분석(analyzeCandles)은 server.js에서 Yahoo 캔들로 수행해 합칩니다.
 *
 * 투자 참고용 정보이며 투자 권유가 아닙니다.
 */

const axios = require("axios");

const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml, application/xml, text/xml, application/json" };
const DEFAULT_NEWS_WHEN = "7d";
const DEFAULT_MAX_AGE_DAYS = 14;

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function toIsoPublishedAt(pubDate) {
  if (!pubDate) return null;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ── RSS 파서 (의존성 없이 최소 구현) ──
function parseRssItems(xml, limit = 10) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`).exec(block);
      return r ? decodeXmlEntities(r[1].replace(/<[^>]*>/g, "").trim()) : null;
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
        publishedAt: toIsoPublishedAt(pubDate),
      });
    }
  }
  return items;
}

/** 구글 뉴스 RSS `when:7d` 등. 이미 있으면 그대로 둔다. */
function withWhenFilter(query, when = DEFAULT_NEWS_WHEN) {
  const q = String(query || "").trim();
  if (!q || !when) return q;
  if (/\bwhen:\d+[hdwmy]\b/i.test(q)) return q;
  return `${q} when:${when}`;
}

function normalizeNewsLink(link) {
  return String(link || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
}

function normalizeNewsTitle(title) {
  return String(title || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isFreshNewsItem(item, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = Date.now()) {
  if (!item?.publishedAt) return false;
  const t = Date.parse(item.publishedAt);
  if (!Number.isFinite(t)) return false;
  return now - t <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function sortNewsByPublishedAtDesc(items) {
  return items.slice().sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
}

function dedupeNewsItems(items) {
  const seenLink = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const it of items || []) {
    const linkKey = normalizeNewsLink(it.link);
    const titleKey = normalizeNewsTitle(it.titleEn || it.title);
    if (linkKey && seenLink.has(linkKey)) continue;
    if (titleKey && seenTitle.has(titleKey)) continue;
    if (linkKey) seenLink.add(linkKey);
    if (titleKey) seenTitle.add(titleKey);
    out.push(it);
  }
  return out;
}

/** 최신순 정렬 → 오래된 항목 제거 → 링크/제목 중복 제거 → limit */
function finalizeNewsItems(items, { limit = 6, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const fresh = (items || []).filter((it) => isFreshNewsItem(it, maxAgeDays, now));
  return dedupeNewsItems(sortNewsByPublishedAtDesc(fresh)).slice(0, limit);
}

const TITLE_PROPER_STOP = /^(The|This|That|With|From|After|Before|Exclusive|Axios|Scoop|Report|House|White|Senate|President|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Over|Into|About|Could|Would|Should|Just|Will|Have|Been|They|Their|What|When|Your|New|News|Department|National|Federal|General|International|American|United|States|Price|Forecast|Market|Stock|Shares|Company|Video|Convention|Debate|Crisis|Court|Congress|Government|Energy|Diesel|World|Global|South|North|West|East|Korea|China|Japan|Russia|Ukraine|Israel|Iran|Europe)$/i;

/**
 * 구글 번역 헤드라인 실패 징후:
 *  - `$ 500` 같이 깨진 기호
 *  - `독점 :` 처럼 콜론 앞 공백
 *  - 문장 중간 고유명사(Anthropic 등)가 번역에서 사라짐
 *  - 한글 대비 영어 비율이 높은 어색한 혼용
 */
function isGarbledKoTranslation(ko, en) {
  const k = String(ko || "").trim();
  const e = String(en || "").trim();
  if (!k || k === e) return true;
  const hangul = (k.match(/[\uAC00-\uD7A3]/g) || []).length;
  const latin = (k.match(/[A-Za-z]/g) || []).length;
  if (hangul < 2) return true;
  if (latin + hangul > 0 && latin / (latin + hangul) > 0.5) return true;
  if (/\$\s+\d/.test(k)) return true;
  if (/[가-힣]\s+:/.test(k)) return true;
  const tokens = e.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    const w = tokens[i].replace(/[^A-Za-z]/g, "");
    if (w.length < 6 || !/^[A-Z]/.test(w) || TITLE_PROPER_STOP.test(w)) continue;
    if (k.includes(w) || k.toLowerCase().includes(w.toLowerCase())) continue;
    return true;
  }
  return false;
}

function preferNewsTitle(original, translated) {
  if (!translated || isGarbledKoTranslation(translated, original)) return original;
  return translated;
}

async function fetchGoogleNewsRaw(query, parseLimit = 24) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const { data } = await axios.get(url, { timeout: 15000, headers: UA, responseType: "text" });
  return parseRssItems(data, parseLimit);
}

async function fetchBingNewsRaw(query, parseLimit = 24) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
  const { data } = await axios.get(url, { timeout: 15000, headers: UA, responseType: "text" });
  return parseRssItems(data, parseLimit);
}

async function fetchGoogleNews(query, limit = 6, opts = {}) {
  const when = opts.when === false ? null : (opts.when || DEFAULT_NEWS_WHEN);
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const parseLimit = Math.max(limit * 4, 20);
  const q = when ? withWhenFilter(query, when) : query;
  let items = finalizeNewsItems(await fetchGoogleNewsRaw(q, parseLimit), { limit, maxAgeDays });
  // when: 필터가 비면 기간 없이 다시 받아 maxAgeDays로만 자른다 (빈 피드 대비)
  if (!items.length && when) {
    items = finalizeNewsItems(await fetchGoogleNewsRaw(query, parseLimit), { limit, maxAgeDays });
  }
  return items;
}

async function fetchBingNews(query, limit = 6, opts = {}) {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const parseLimit = Math.max(limit * 4, 20);
  return finalizeNewsItems(await fetchBingNewsRaw(query, parseLimit), { limit, maxAgeDays });
}

/** 구글 뉴스 우선, 실패/부족 시 Bing 뉴스 폴백 (데이터센터 IP 차단 대비) */
async function fetchNewsWithFallback(query, limit = 6, opts = {}) {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  let items = [];
  try {
    items = await fetchGoogleNews(query, limit, opts);
  } catch {
    // 폴백으로
  }
  if (items.length >= limit) return items;
  try {
    const bing = await fetchBingNews(query, limit, opts);
    return finalizeNewsItems(items.concat(bing), { limit, maxAgeDays });
  } catch {
    return items;
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

// ── 영→한 제목 번역 (구글 번역 공개 엔드포인트, 키 불필요) ──
async function translateToKorean(text) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q="
    + encodeURIComponent(text);
  const { data } = await axios.get(url, { timeout: 8000, headers: UA });
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const out = segments.map((s) => s?.[0] || "").join("").trim();
  if (!out) throw new Error("empty translation");
  return out;
}

// ── 악시오스 뉴스 ──
let axiosNewsCache = { at: 0, data: null };
async function fetchAxiosNews(limit = 8) {
  if (axiosNewsCache.data && Date.now() - axiosNewsCache.at < 15 * 60 * 1000) return axiosNewsCache.data;
  const { data } = await axios.get("https://api.axios.com/feed/", { timeout: 15000, headers: UA, responseType: "text" });
  const items = finalizeNewsItems(parseRssItems(data, Math.max(limit * 3, 20)), {
    limit,
    maxAgeDays: 7,
  });
  // 제목 한국어 번역 — 깨진 번역은 영어 원문을 유지
  await Promise.all(items.map(async (it) => {
    const original = it.title;
    it.titleEn = original;
    try {
      const ko = await translateToKorean(original);
      it.title = preferNewsTitle(original, ko);
      if (it.title === original && ko && ko !== original) it.titleKo = ko;
    } catch { /* 원문 유지 */ }
  }));
  const result = { ok: items.length > 0, source: "Axios", items, updatedAt: new Date().toISOString() };
  if (result.ok) axiosNewsCache = { at: Date.now(), data: result };
  return result;
}

function __resetNewsCacheForTest() {
  axiosNewsCache = { at: 0, data: null };
}

module.exports = {
  fetchFearGreed,
  fetchGlobalCrypto,
  fetchRegulationNews,
  fetchAxiosNews,
  fetchGoogleNews,
  fetchNewsWithFallback,
  parseRssItems,
  withWhenFilter,
  finalizeNewsItems,
  isGarbledKoTranslation,
  preferNewsTitle,
  isFreshNewsItem,
  __resetNewsCacheForTest,
};
