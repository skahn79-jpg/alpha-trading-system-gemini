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

/**
 * 관세청 품목별 수출입 (TRADE_API_KEY 있을 때만) — 최근 14개월 시리즈를 받아
 * 품목별 월별 증감(MoM·YoY)과 분기별 집계(QoQ)까지 계산합니다.
 */
let categoryLastError = null;

/** data.go.kr 표준 XML에서 <item> 블록들을 {태그: 값} 객체 배열로 파싱 */
function parseDataGoKrXml(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const obj = {};
    const tagRe = /<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g;
    let t;
    while ((t = tagRe.exec(m[1])) !== null) obj[t[1]] = t[2].trim();
    items.push(obj);
  }
  return items;
}

async function fetchCategoryTrade() {
  const key = process.env.TRADE_API_KEY || process.env.DATA_GO_KR_KEY;
  categoryLastError = null;
  if (!key) {
    categoryLastError = "TRADE_API_KEY 미설정";
    return null;
  }
  try {
    // 조회기간 1년 제한 → 12개월 창 2개(최근 12개월 + 그 이전 12개월)로 나눠
    // 전년 동월비 계산용 24개월 확보
    const ym = (offsetMonths) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - offsetMonths);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    };
    // 월 단위 24개 창 — 범위를 넓게 잡으면 응답이 수만 행이 되어
    // 페이지 파라미터가 무시될 경우 무료 인스턴스 메모리를 초과하므로
    // 한 달씩 잘라 응답 크기를 원천적으로 제한
    const windows = [];
    for (let i = 23; i >= 0; i -= 1) windows.push({ start: ym(i), end: ym(i) });

    // 관세청_신성질별 수출입실적: newtempertrade/getNewtempertradeList (XML 전용)
    // imexTpcd: 1=수출, 2=수입
    // 전체 응답이 수만 행이면 무료 인스턴스 메모리를 초과하므로
    // 999행 페이지 단위로 받고 페이지 수에 상한을 둠
    const call = async (imexTpcd, win, pageNo, useRawKey) => {
      const base = "https://apis.data.go.kr/1220000/newtempertrade/getNewtempertradeList";
      const sk = useRawKey ? key : encodeURIComponent(key);
      const url = `${base}?serviceKey=${sk}&strtYymm=${win.start}&endYymm=${win.end}&imexTpcd=${imexTpcd}&numOfRows=999&pageNo=${pageNo}`;
      const { data } = await axios.get(url, {
        timeout: 25000,
        responseType: "text",
        // 페이지 파라미터가 무시된 초대형 응답이 오면 OOM 대신 오류로 드러나게 함
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
      });
      return String(data);
    };

    const MAX_PAGES = 6; // 창당 최대 ~6,000행

    // 항목 구조 자동 감지: 이름(…Nm/…Kor), 기간(6자리 년월), 금액(달러 필드)
    let nameKey = null;
    let periodKey = null;
    let amountKey = null;
    const detectKeys = (sample) => {
      const keys = Object.keys(sample);
      nameKey = keys.find((k) => /nm$|kor$/i.test(k) && isNaN(Number(sample[k])))
        || keys.find((k) => isNaN(Number(sample[k])) && !/^(year|yymm|priod)/i.test(k));
      periodKey = keys.find((k) => /^(year|yymm|priod|baseYymm)/i.test(k))
        || keys.find((k) => /^\d{6}(\.\d{2})?$/.test(String(sample[k]).replace(/[^0-9.]/g, "")));
      amountKey = keys.find((k) => /dlr|usd|dollar|amt/i.test(k) && !isNaN(Number(sample[k])));
      if (!nameKey || !periodKey || !amountKey) {
        throw new Error("관세청 응답 구조 미인식 — 필드: " + keys.join(","));
      }
    };

    // (품목, 월)별 수출/수입 병합 — 페이지를 받는 즉시 집계하고 원본 행은 버려
    // 무료 인스턴스(512MB)에서 수만 행을 들고 있지 않도록 함
    const byName = new Map();
    let totalRows = 0;
    const ingest = (items, side) => {
      for (const it of items) {
        const name = String(it[nameKey] || "").trim();
        const period = String(it[periodKey] || "").replace(/[^0-9]/g, "");
        if (!name || period.length < 6 || name.includes("총계") || name.includes("합계")) continue;
        const month = `${period.slice(0, 4)}-${period.slice(4, 6)}`;
        if (!byName.has(name)) byName.set(name, new Map());
        const cur = byName.get(name).get(month) || { exports: 0, imports: 0 };
        cur[side] += Number(it[amountKey]) || 0;
        byName.get(name).set(month, cur);
      }
    };

    // 수출·수입을 순차로 수집해 피크 메모리/동시 부하를 낮춤
    for (const { imexTpcd, side } of [{ imexTpcd: 1, side: "exports" }, { imexTpcd: 2, side: "imports" }]) {
      for (const win of windows) {
        for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
          let xml = await call(imexTpcd, win, pageNo, false);
          if (xml.includes("SERVICE_KEY") || xml.includes("SERVICE KEY")) {
            xml = await call(imexTpcd, win, pageNo, true); // 인코딩된 키로 재시도
          }
          const authErr = /<returnAuthMsg>([^<]+)<\/returnAuthMsg>/.exec(xml)?.[1];
          if (authErr) throw new Error("관세청 API 인증 오류: " + authErr);
          const resultMsg = /<resultCode>(\d+)<\/resultCode>[\s\S]*?<resultMsg>([^<]*)<\/resultMsg>/.exec(xml);
          if (resultMsg && resultMsg[1] !== "00" && resultMsg[1] !== "0") {
            throw new Error(`관세청 API 응답 코드 ${resultMsg[1]}: ${resultMsg[2]}`);
          }
          const parsed = parseDataGoKrXml(xml);
          if (parsed.length && !nameKey) detectKeys(parsed[0]);
          if (parsed.length) ingest(parsed, side);
          totalRows += parsed.length;
          if (parsed.length < 999) break; // 마지막 페이지 (페이지 미지원 서비스도 여기서 종료)
        }
      }
    }

    if (!totalRows) {
      categoryLastError = "관세청 API 응답에 품목 데이터 없음 (기간 내 데이터 미제공 가능)";
      return null;
    }

    const pctChange = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
    const quarterOf = (month) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;

    const categories = [];
    for (const [name, monthMap] of byName) {
      const months = [...monthMap.entries()]
        .map(([month, v]) => ({ month, exports: v.exports, imports: v.imports }))
        .sort((a, b) => a.month.localeCompare(b.month));
      if (months.length < 2) continue;

      // 월별 증감 (최근 6개월 반환)
      const monthly = months.map((m, i) => {
        const prev = months[i - 1];
        const yearAgo = months.find((x) => {
          const [y, mm] = m.month.split("-");
          return x.month === `${Number(y) - 1}-${mm}`;
        });
        return {
          month: m.month,
          exports: m.exports,
          imports: m.imports,
          exportsMoM: prev ? pctChange(m.exports, prev.exports) : null,
          exportsYoY: yearAgo ? pctChange(m.exports, yearAgo.exports) : null,
          importsYoY: yearAgo ? pctChange(m.imports, yearAgo.imports) : null,
        };
      });

      // 분기별 집계 (완결 여부 무관, 최근 5분기)
      const qMap = new Map();
      for (const m of months) {
        const q = quarterOf(m.month);
        const cur = qMap.get(q) || { exports: 0, imports: 0, months: 0 };
        cur.exports += m.exports;
        cur.imports += m.imports;
        cur.months += 1;
        qMap.set(q, cur);
      }
      const quarters = [...qMap.entries()]
        .map(([quarter, v]) => ({ quarter, ...v, partial: v.months < 3 }))
        .sort((a, b) => a.quarter.localeCompare(b.quarter))
        .map((q, i, arr) => ({
          ...q,
          exportsQoQ: i > 0 && !q.partial && !arr[i - 1].partial ? pctChange(q.exports, arr[i - 1].exports) : null,
        }))
        .slice(-5);

      const latest = monthly[monthly.length - 1];

      // 연속 증감 추세 판정 (전월比 기준 연속 개월 수)
      let streak = 0;
      let streakDir = 0;
      for (let i = monthly.length - 1; i > 0; i -= 1) {
        const mom = monthly[i].exportsMoM;
        if (mom === null) break;
        const dir = mom > 0 ? 1 : mom < 0 ? -1 : 0;
        if (streak === 0) { streakDir = dir; streak = dir === 0 ? 0 : 1; if (dir === 0) break; }
        else if (dir === streakDir) streak += 1;
        else break;
      }
      const momentumNote = streak >= 2
        ? `${streak}개월 연속 ${streakDir > 0 ? "증가" : "감소"}`
        : null;

      categories.push({
        name,
        latestMonth: latest.month,
        exports: latest.exports,
        imports: latest.imports,
        exportsMoM: latest.exportsMoM,
        exportsYoY: latest.exportsYoY,
        importsYoY: latest.importsYoY,
        trend: latest.exportsYoY === null ? "unknown" : latest.exportsYoY > 2 ? "increase" : latest.exportsYoY < -2 ? "decrease" : "flat",
        momentumNote,
        monthly: monthly.slice(-12),
        quarters,
      });
    }

    categories.sort((a, b) => b.exports - a.exports);
    return categories.slice(0, 20);
  } catch (e) {
    const status = e.response?.status;
    if (status === 403) {
      categoryLastError = "관세청 API 403 — 키는 유효하나 '신성질별 수출입실적' 활용신청 승인이 아직 반영되지 않았습니다 (신청 후 최대 1시간 소요, 자동 재시도 중)";
    } else if (status === 401) {
      categoryLastError = "관세청 API 401 — 인증키가 올바르지 않습니다. data.go.kr 마이페이지의 일반 인증키(Decoding)를 확인하세요";
    } else {
      categoryLastError = "관세청 API 호출 실패: " + e.message;
    }
    console.error("[trade-category]", categoryLastError);
    return null;
  }
}

// 품목별 수집은 관세청 호출이 최대 24회라 리포트 요청을 블로킹하지 않도록 백그라운드 빌드
const categoriesCache = { at: 0, data: null, building: false };
const CATEGORIES_TTL_MS = 6 * 60 * 60 * 1000;

function kickCategoryBuild() {
  if (categoriesCache.building) return;
  if (categoriesCache.data && Date.now() - categoriesCache.at < CATEGORIES_TTL_MS) return;
  categoriesCache.building = true;
  fetchCategoryTrade()
    .then((cats) => {
      if (cats && cats.length) {
        categoriesCache.data = cats;
        categoriesCache.at = Date.now();
      }
    })
    .catch((e) => {
      categoryLastError = "관세청 수집 실패: " + e.message;
      console.error("[trade-category]", categoryLastError);
    })
    .finally(() => { categoriesCache.building = false; });
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

  // 연도별 집계 (완결 연도 + 진행 중 올해, 최근 15년)
  const byYear = new Map();
  for (const row of merged) {
    const year = row.month.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, { exports: 0, imports: 0, months: 0 });
    const y = byYear.get(year);
    y.exports += row.exports;
    y.imports += row.imports;
    y.months += 1;
  }
  const yearKeys = [...byYear.keys()].sort();
  const years = yearKeys.slice(-15).map((year) => {
    const y = byYear.get(year);
    const prevY = byYear.get(String(Number(year) - 1));
    const yoyComparable = prevY && prevY.months === 12 && y.months === 12;
    return {
      year,
      exports: Math.round(y.exports / 1e6),
      imports: Math.round(y.imports / 1e6),
      balance: Math.round((y.exports - y.imports) / 1e6),
      monthsCounted: y.months,
      partial: y.months < 12,
      exportsYoY: yoyComparable
        ? Math.round(((y.exports - prevY.exports) / prevY.exports) * 1000) / 10
        : null,
    };
  });

  const latest = months[months.length - 1] || null;
  const prev = months[months.length - 2] || null;

  const trend = latest && latest.exportsYoY !== null
    ? (latest.exportsYoY > 2 ? "increase" : latest.exportsYoY < -2 ? "decrease" : "flat")
    : "unknown";

  kickCategoryBuild();
  const categories = categoriesCache.data;

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
    years,
    categories: categories || [],
    categoriesNote: categories
      ? null
      : (categoryLastError && categoryLastError !== "TRADE_API_KEY 미설정"
        ? `품목별 데이터 조회 실패 — ${categoryLastError}${categoriesCache.building ? " (재시도 중)" : ""}`
        : (categoriesCache.building
          ? "품목별 데이터 수집 중입니다 — 1~2분 후 아래로 당겨 새로고침하세요."
          : "품목별 월별·분기별 증감은 무료 API 키 설정 시 제공됩니다: data.go.kr에서 '관세청_신성질별 수출입실적' 활용신청 → Render 환경변수 TRADE_API_KEY에 인증키 입력")),
    categoriesDebug: {
      lastError: categoryLastError,
      building: categoriesCache.building,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    sectorHints: SECTOR_HINTS,
    disclaimer: "본 리포트는 투자 참고용 정보이며 투자 권유가 아닙니다. 모든 투자 판단의 책임은 투자자 본인에게 있습니다.",
  };

  // 품목별 조회 실패 시 5분만 캐시 → 키 반영·API 활성화 후 곧 재시도
  const cacheAt = categories ? Date.now() : Date.now() - CACHE_TTL_MS + 5 * 60 * 1000;
  cache = { at: cacheAt, data: report };
  return report;
}

module.exports = { buildTradeReport };
