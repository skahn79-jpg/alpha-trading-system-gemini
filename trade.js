/**
 * ALPHA TRADING SYSTEM - 한국 수출입 리포트 모듈
 *
 * 총괄 수출입: FRED 공개 CSV (OECD MEI, 한국 월별 상품 수출/수입, USD) — API 키 불필요
 *   수출: XTEXVA01KRM667S / 수입: XTIMVA01KRM667S
 * 품목별(선택): 관세청 수출입무역통계 API — TRADE_API_KEY(data.go.kr) 설정 시 사용
 *
 * 투자 검토·종목 선정 참고용 정보이며 투자 권유가 아닙니다.
 */

const axios = require("axios");

const FRED_EXPORT_ID = "XTEXVA01KRM667S";
const FRED_IMPORT_ID = "XTIMVA01KRM667S";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

let cache = { at: 0, data: null };

// MOTIE 주요 수출 품목 → 앱 업종/대표 종목 매핑 (참고용)
const SECTOR_HINTS = [
  { category: "반도체", sector: "반도체", note: "수출 1위 품목 — 반도체 업황 직결", codes: ["005930", "000660"] },
  { category: "자동차", sector: "자동차", note: "완성차·부품 수출 비중 상위", codes: ["005380", "000270"] },
  { category: "석유제품", sector: "화학", note: "정유·화학 마진과 연동", codes: ["096770", "010950"] },
  { category: "선박", sector: "조선", note: "수주→인도 시차 존재", codes: ["329180", "009540"] },
  { category: "이차전지", sector: "2차전지", note: "전기차 수요와 연동", codes: ["373220", "051910"] },
  { category: "바이오헬스", sector: "바이오", note: "위탁생산(CDMO) 수출 포함", codes: ["207940", "068270"] },
  { category: "철강", sector: "철강", note: "글로벌 시황·관세 영향", codes: ["005490"] },
  { category: "디스플레이", sector: "IT", note: "패널 가격 사이클 참고", codes: ["034220"] },
  { category: "무선통신기기", sector: "IT", note: "스마트폰 부품 수출 포함", codes: ["005930"] },
  { category: "컴퓨터(SSD 등)", sector: "반도체", note: "메모리 업황과 연동", codes: ["000660"] },
];

function parseFredCsv(csvText) {
  const rows = String(csvText).trim().split("\n").slice(1); // 헤더 제거
  const out = [];
  for (const row of rows) {
    const [date, value] = row.split(",");
    const v = Number(value);
    if (date && Number.isFinite(v)) {
      out.push({ month: date.slice(0, 7), value: v });
    }
  }
  return out;
}

async function fetchFredSeries(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  const { data } = await axios.get(url, { timeout: 15000, responseType: "text" });
  return parseFredCsv(data);
}

function yoy(series, idx) {
  const cur = series[idx];
  const prev = series[idx - 12];
  if (!cur || !prev || !prev.value) return null;
  return Math.round(((cur.value - prev.value) / prev.value) * 1000) / 10;
}

function mom(series, idx) {
  const cur = series[idx];
  const prev = series[idx - 1];
  if (!cur || !prev || !prev.value) return null;
  return Math.round(((cur.value - prev.value) / prev.value) * 1000) / 10;
}

/** 관세청 품목별 수출입 (TRADE_API_KEY 있을 때만) */
async function fetchCategoryTrade() {
  const key = process.env.TRADE_API_KEY || process.env.DATA_GO_KR_KEY;
  if (!key) return null;
  try {
    const now = new Date();
    const end = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const start = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;
    const url = "https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList";
    const { data } = await axios.get(url, {
      timeout: 15000,
      params: { serviceKey: key, strtYymm: start, endYymm: end, type: "json", numOfRows: 100 },
    });
    const items = data?.response?.body?.items?.item;
    if (!Array.isArray(items)) return null;
    return items.map((it) => ({
      name: it.statKor || it.statCd,
      exports: Number(it.expDlr) || 0,
      imports: Number(it.impDlr) || 0,
      period: it.year || null,
    }));
  } catch {
    return null;
  }
}

async function buildTradeReport() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const [exportsSeries, importsSeries] = await Promise.all([
    fetchFredSeries(FRED_EXPORT_ID),
    fetchFredSeries(FRED_IMPORT_ID),
  ]);

  const importsByMonth = new Map(importsSeries.map((r) => [r.month, r.value]));
  const merged = exportsSeries
    .filter((r) => importsByMonth.has(r.month))
    .map((r) => ({ month: r.month, exports: r.value, imports: importsByMonth.get(r.month) }));

  const recentCount = Math.min(25, merged.length);
  const recent = merged.slice(-recentCount);

  const months = recent.map((row, i) => {
    const globalIdx = merged.length - recentCount + i;
    const expSeries = merged.map((m) => ({ month: m.month, value: m.exports }));
    const impSeries = merged.map((m) => ({ month: m.month, value: m.imports }));
    return {
      month: row.month,
      exports: Math.round(row.exports / 1e6), // 백만 달러 단위
      imports: Math.round(row.imports / 1e6),
      balance: Math.round((row.exports - row.imports) / 1e6),
      exportsYoY: yoy(expSeries, globalIdx),
      importsYoY: yoy(impSeries, globalIdx),
      exportsMoM: mom(expSeries, globalIdx),
    };
  }).slice(-13); // 최근 13개월 (YoY 계산 후)

  const latest = months[months.length - 1] || null;
  const prev = months[months.length - 2] || null;

  const trend = latest && latest.exportsYoY !== null
    ? (latest.exportsYoY > 2 ? "increase" : latest.exportsYoY < -2 ? "decrease" : "flat")
    : "unknown";

  const categories = await fetchCategoryTrade();

  const summaryParts = [];
  if (latest) {
    // 1억 달러 = 100 백만 달러
    summaryParts.push(`${latest.month} 수출 ${(latest.exports / 100).toFixed(1)}억달러(전년比 ${latest.exportsYoY ?? "-"}%)`);
    summaryParts.push(`수입 전년比 ${latest.importsYoY ?? "-"}%`);
    summaryParts.push(`무역수지 ${latest.balance >= 0 ? "+" : ""}${(latest.balance / 100).toFixed(1)}억달러`);
    if (prev && latest.exportsYoY !== null && prev.exportsYoY !== null) {
      summaryParts.push(latest.exportsYoY >= prev.exportsYoY ? "수출 증가율 확대" : "수출 증가율 둔화");
    }
  }

  const report = {
    ok: true,
    source: categories ? "FRED(OECD) + 관세청" : "FRED(OECD 월별 상품무역, USD)",
    unit: "백만 달러 (USD million)",
    updatedAt: new Date().toISOString(),
    trend,
    summary: summaryParts.join(" · ") || "데이터 없음",
    latest,
    months,
    categories: categories || [],
    categoriesNote: categories
      ? null
      : "품목별 상세는 TRADE_API_KEY(data.go.kr 관세청 수출입무역통계) 설정 시 제공됩니다.",
    sectorHints: SECTOR_HINTS,
    disclaimer: "본 리포트는 투자 참고용 정보이며 투자 권유가 아닙니다. 모든 투자 판단의 책임은 투자자 본인에게 있습니다.",
  };

  cache = { at: Date.now(), data: report };
  return report;
}

module.exports = { buildTradeReport };
