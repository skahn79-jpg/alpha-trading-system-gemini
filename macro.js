/**
 * ALPHA TRADING SYSTEM - 거시경제(매크로) 지표 모듈
 *
 * UsStockAI 앱의 물가/경제지표 탭 벤치마킹 — FRED 공개 CSV (API 키 불필요).
 * 지표 시트의 유동성 규칙 반영:
 *   RRPONTSYD(연준 역레포)·WTREGEN(재무부 잔고): 하락 = 유동성 공급 = 주가 상승 우호
 *
 * 투자 참고용 정보이며 투자 권유가 아닙니다.
 */

const axios = require("axios");

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 (월간/주간 거시 데이터)
let cache = { at: 0, data: null };

// FRED 시리즈 정의 — direction: 값 상승이 위험자산에 미치는 방향(+1 우호 / -1 부담 / 0 중립정보)
const SERIES = [
  { id: "CPIAUCSL", name: "미국 CPI", unit: "YoY %", type: "yoy", direction: -1, note: "소비자물가 — 상승 시 긴축 압력" },
  { id: "CPILFESL", name: "근원 CPI", unit: "YoY %", type: "yoy", direction: -1, note: "식품·에너지 제외" },
  { id: "DFF", name: "연준 기준금리", unit: "%", type: "level", direction: -1, note: "실효 연방기금금리" },
  { id: "DGS10", name: "미 10년물 금리", unit: "%", type: "level", direction: -1, note: "장기 할인율 — 급등 시 성장주 부담" },
  { id: "WALCL", name: "연준 총자산", unit: "조$", type: "level", scale: 1e6, direction: 1, note: "상승 = 유동성 공급" },
  { id: "RRPONTSYD", name: "연준 역레포", unit: "십억$", type: "level", scale: 1e3, direction: -1, note: "시트: 하락 = 유동성 공급 = 주가상승" },
  { id: "WTREGEN", name: "재무부 잔고(TGA)", unit: "십억$", type: "level", scale: 1e3, direction: -1, note: "시트: 하락 = 돈풀기 = 주가상승" },
  { id: "VIXCLS", name: "VIX 변동성", unit: "pt", type: "level", direction: -1, note: "공포지수 — 급등 시 위험회피" },
  { id: "DTWEXBGS", name: "달러 인덱스", unit: "지수", type: "level", direction: -1, note: "달러 강세 = 신흥국·원화자산 부담" },
];

function parseFredCsv(text) {
  const rows = String(text).trim().split("\n").slice(1);
  const out = [];
  for (const row of rows) {
    const [date, value] = row.split(",");
    const v = Number(value);
    if (date && Number.isFinite(v)) out.push({ date, value: v });
  }
  return out;
}

async function fetchSeries(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  const { data } = await axios.get(url, { timeout: 15000, responseType: "text" });
  return parseFredCsv(data);
}

function buildIndicator(def, series) {
  if (!series.length) return null;
  const latest = series[series.length - 1];
  let value; let change = null;

  if (def.type === "yoy") {
    // 월간 지수 → 전년 동월 대비 %
    const idx = series.length - 1;
    const prevYear = series[idx - 12];
    if (!prevYear) return null;
    value = Math.round(((latest.value - prevYear.value) / prevYear.value) * 1000) / 10;
    const prev = series[idx - 1] && series[idx - 13]
      ? Math.round(((series[idx - 1].value - series[idx - 13].value) / series[idx - 13].value) * 1000) / 10
      : null;
    change = prev !== null ? Math.round((value - prev) * 10) / 10 : null;
  } else {
    const scale = def.scale || 1;
    value = Math.round((latest.value / scale) * 100) / 100;
    // 약 1개월 전 대비 변화율
    const monthAgo = series[Math.max(0, series.length - 1 - (series.length > 200 ? 21 : 4))];
    if (monthAgo && monthAgo.value) {
      change = Math.round(((latest.value - monthAgo.value) / Math.abs(monthAgo.value)) * 1000) / 10;
    }
  }

  // 최근 12포인트 미니 추세
  const spark = series.slice(-12).map((r) => Math.round((r.value / (def.scale || 1)) * 100) / 100);

  // 유동성/부담 판정
  let stance = "neutral";
  if (change !== null && Math.abs(change) >= 0.1) {
    const rising = change > 0;
    stance = (rising ? 1 : -1) * def.direction > 0 ? "supportive" : "headwind";
  }

  return {
    id: def.id,
    name: def.name,
    unit: def.unit,
    value,
    change,
    date: latest.date,
    note: def.note,
    stance, // supportive = 위험자산 우호 / headwind = 부담
    spark,
  };
}

async function buildMacroReport() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const results = [];
  for (const def of SERIES) {
    try {
      const series = await fetchSeries(def.id);
      const ind = buildIndicator(def, series);
      if (ind) results.push(ind);
    } catch {
      // 개별 시리즈 실패는 건너뜀
    }
  }

  const supportive = results.filter((r) => r.stance === "supportive").length;
  const headwind = results.filter((r) => r.stance === "headwind").length;
  const mood = supportive > headwind + 1 ? "risk_on" : headwind > supportive + 1 ? "risk_off" : "mixed";

  const report = {
    ok: results.length > 0,
    source: "FRED (세인트루이스 연준 공개 데이터)",
    updatedAt: new Date().toISOString(),
    mood,
    moodLabel: mood === "risk_on" ? "유동성 우호" : mood === "risk_off" ? "유동성 부담" : "혼조",
    supportive,
    headwind,
    indicators: results,
    disclaimer: "본 지표는 투자 참고용 정보이며 투자 권유가 아닙니다.",
  };

  if (report.ok) cache = { at: Date.now(), data: report };
  return report;
}

module.exports = { buildMacroReport };
