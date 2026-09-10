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

/** 사전 오역이 잦은 고유명사 — 한글 음역/원문이 없으면 번역 실패로 본다 */
const BRAND_KEEP = [
  { en: /Anthropic/i, ok: /앤트로픽|Anthropic/i },
  { en: /OpenAI/i, ok: /오픈\s*AI|오픈에이아이|OpenAI/i },
  { en: /Obamacare/i, ok: /오바마케어|Obamacare/i },
];

const HEADLINE_PREFIXES = [
  { re: /^exclusive:\s*/i, ko: "특종" },
  { re: /^scoop:\s*/i, ko: "특종" },
  { re: /^breaking:\s*/i, ko: "속보" },
];

function prepareHeadlineForTranslate(en) {
  let body = String(en || "").trim();
  let prefixKo = "";
  for (const p of HEADLINE_PREFIXES) {
    if (p.re.test(body)) {
      prefixKo = p.ko;
      body = body.replace(p.re, "").trim();
      break;
    }
  }
  // `$ 500` 같은 번역 붕괴를 막기 위해 금액을 한국어 표기로 바꿔 보낸다
  body = body.replace(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g, (_, n) => `${n.replace(/,/g, "")}달러`);
  return { prefixKo, body };
}

function assembleKoHeadline(prefixKo, translatedBody) {
  const body = String(translatedBody || "").trim();
  if (!body) return null;
  return prefixKo ? `${prefixKo}: ${body}` : body;
}

/**
 * 헤드라인 번역 실패 징후:
 *  - `$ 500` 깨진 기호, `독점 :` 콜론 공백, Exclusive→독점 혜택
 *  - 한글 대비 영어 비율이 높은 혼용
 *  - Anthropic→인류 처럼 브랜드가 사전 뜻으로 바뀐 경우
 */
function isGarbledKoTranslation(ko, en) {
  const k = String(ko || "").trim();
  const e = String(en || "").trim();
  if (!k || k === e) return true;
  const hangul = (k.match(/[\uAC00-\uD7A3]/g) || []).length;
  const latin = (k.match(/[A-Za-z]/g) || []).length;
  if (hangul < 2) return true;
  if (latin + hangul > 0 && latin / (latin + hangul) > 0.35) return true;
  if (/\$\s+\d/.test(k)) return true;
  if (/[가-힣]\s+:/.test(k)) return true;
  if (/독점\s*혜택/.test(k)) return true;
  if (/스쿠프/.test(k) && /^scoop:/i.test(e)) return true;
  for (const b of BRAND_KEEP) {
    if (b.en.test(e) && !b.ok.test(k)) return true;
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

// ── 영→한 제목 번역 (키 불필요). gtx가 429면 MyMemory 폴백 ──
async function translateGtx(text) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q="
    + encodeURIComponent(text);
  const { data } = await axios.get(url, { timeout: 8000, headers: UA });
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const out = segments.map((s) => s?.[0] || "").join("").trim();
  if (!out) throw new Error("empty translation");
  return out;
}

async function translateMyMemory(text) {
  const url = "https://api.mymemory.translated.net/get?langpair=en|ko&q="
    + encodeURIComponent(text);
  const { data } = await axios.get(url, { timeout: 12000, headers: UA });
  const out = String(data?.responseData?.translatedText || "").trim();
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error("empty translation");
  return out.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function translateToKorean(text) {
  try {
    return await translateGtx(text);
  } catch {
    return await translateMyMemory(text);
  }
}

/** Axios 헤드라인: 특종 접두어/$금액을 보호해 번역하고, 품질이 낮으면 null (영어 유지) */
async function translateAxiosHeadline(en) {
  const { prefixKo, body } = prepareHeadlineForTranslate(en);
  const engines = [translateGtx, translateMyMemory];
  for (const engine of engines) {
    try {
      const translated = await engine(body);
      const assembled = assembleKoHeadline(prefixKo, translated);
      if (assembled && !isGarbledKoTranslation(assembled, en)) return assembled;
    } catch {
      // 다음 엔진
    }
  }
  return null;
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
  // 기본은 영어 원문(가독). 품질 통과한 한글만 title로 교체. 병렬 gtx는 429·오역을 키우므로 순차.
  for (const it of items) {
    const original = it.title;
    it.titleEn = original;
    it.title = original;
    try {
      const ko = await translateAxiosHeadline(original);
      if (ko) it.title = ko;
    } catch { /* 영어 원문 유지 */ }
  }
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
  prepareHeadlineForTranslate,
  assembleKoHeadline,
  isFreshNewsItem,
  __resetNewsCacheForTest,
};
