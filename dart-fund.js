/**
 * ALPHA TRADING SYSTEM - DART 실적(매출·영업이익) 모듈
 *
 * 1) 종목코드→DART corp_code 매핑 (corpCode.xml ZIP 자체 파싱, 7일 캐시)
 * 2) 3개년 연간 + 최근 4분기 매출·영업이익 + YoY/이익률 (24시간 캐시)
 * 3) 실적 모멘텀 점수(0~100)·등급 — 기술 점수와 별도 축
 * 4) 관심종목 실적 공시 감시 → APNs 푸시
 */

const axios = require("axios");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const KEY = () => process.env.DART_API_KEY;
const CORP_CACHE = path.join(__dirname, "data/corp-codes.json");
const SEEN_PATH = path.join(__dirname, "data/earnings-seen.json");
const WATCH_PATH = path.join(__dirname, "data/watchlist.json");

// ── 종목코드 → corp_code 매핑 ──
let corpMap = null; // { stockCode: { corp, name } }
let corpMapAt = 0;

/** DART corpCode ZIP에서 첫 엔트리(CORPCODE.xml)를 추출 — 외부 unzip 불필요 */
function unzipSingle(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("ZIP 형식이 아님");
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const compSize = buf.readUInt32LE(18);
  const data = compSize > 0 ? buf.slice(start, start + compSize) : buf.slice(start);
  if (method === 0) return data;
  return zlib.inflateRawSync(data);
}

async function loadCorpMap() {
  if (corpMap && Date.now() - corpMapAt < 7 * 86400000) return corpMap;
  // 파일 캐시 우선
  try {
    const saved = JSON.parse(fs.readFileSync(CORP_CACHE, "utf8"));
    if (saved && saved.at && Date.now() - saved.at < 7 * 86400000) {
      corpMap = saved.map;
      corpMapAt = saved.at;
      return corpMap;
    }
  } catch { /* 없음 */ }

  const { data } = await axios.get("https://opendart.fss.or.kr/api/corpCode.xml", {
    params: { crtfc_key: KEY() },
    responseType: "arraybuffer",
    timeout: 30000,
  });
  const xml = unzipSingle(Buffer.from(data)).toString("utf8");
  const map = {};
  const re = /<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>[\s\S]*?<stock_code>([0-9A-Z]*)<\/stock_code>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const stock = m[3].trim();
    if (stock.length === 6) map[stock] = { corp: m[1], name: m[2].trim() };
  }
  if (Object.keys(map).length < 1000) throw new Error("corp_code 매핑 파싱 실패");
  corpMap = map;
  corpMapAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(CORP_CACHE), { recursive: true });
    fs.writeFileSync(CORP_CACHE, JSON.stringify({ at: corpMapAt, map }));
  } catch { /* best effort */ }
  return corpMap;
}

// ── 재무제표 조회 ──
const fnCache = new Map(); // cacheKey → { at, rows }
async function fetchFnltt(corp, year, reprt) {
  const ck = `${corp}-${year}-${reprt}`;
  const hit = fnCache.get(ck);
  if (hit && Date.now() - hit.at < 24 * 3600000) return hit.rows;
  for (const fsDiv of ["CFS", "OFS"]) { // 연결 우선, 없으면 별도
    try {
      const { data } = await axios.get("https://opendart.fss.or.kr/api/fnlttSinglAcnt.json", {
        params: { crtfc_key: KEY(), corp_code: corp, bsns_year: year, reprt_code: reprt, fs_div: fsDiv },
        timeout: 15000,
      });
      if (data.status === "000" && Array.isArray(data.list) && data.list.length) {
        fnCache.set(ck, { at: Date.now(), rows: data.list });
        return data.list;
      }
    } catch { /* 다음 fs_div */ }
  }
  fnCache.set(ck, { at: Date.now(), rows: [] });
  return [];
}

const toNum = (s) => {
  const n = Number(String(s || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function pickAccount(rows, names) {
  for (const nm of names) {
    const row = rows.find((r) => String(r.account_nm || "").trim() === nm && r.sj_div === "IS");
    if (row) return row;
  }
  // 포괄손익계산서만 있는 경우
  for (const nm of names) {
    const row = rows.find((r) => String(r.account_nm || "").trim().startsWith(nm));
    if (row) return row;
  }
  return null;
}

const REV_NAMES = ["매출액", "수익(매출액)", "영업수익", "매출"];
const OP_NAMES = ["영업이익", "영업이익(손실)", "영업손익"];

const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null);
const toEok = (v) => (v === null ? null : Math.round(v / 1e8)); // 억원

// ── 종목 실적 요약 (3개년 + 최근 4분기) ──
const fundCache = new Map(); // code → { at, data }
async function getFundamentals(code) {
  if (!KEY()) return { ok: false, error: "DART_API_KEY 미설정" };
  const hit = fundCache.get(code);
  if (hit && Date.now() - hit.at < 24 * 3600000) return hit.data;

  const map = await loadCorpMap();
  const entry = map[code];
  if (!entry) return { ok: false, error: "DART에 없는 종목코드" };

  const nowY = new Date().getFullYear();

  // 3개년: 최신 사업보고서 1건에 당기/전기/전전기가 함께 옴
  let annualRows = await fetchFnltt(entry.corp, nowY - 1, "11011");
  let baseYear = nowY - 1;
  if (!annualRows.length) {
    annualRows = await fetchFnltt(entry.corp, nowY - 2, "11011");
    baseYear = nowY - 2;
  }
  const years = [];
  if (annualRows.length) {
    const rev = pickAccount(annualRows, REV_NAMES);
    const op = pickAccount(annualRows, OP_NAMES);
    const cols = [
      { y: baseYear, f: "thstrm_amount" },
      { y: baseYear - 1, f: "frmtrm_amount" },
      { y: baseYear - 2, f: "bfefrmtrm_amount" },
    ];
    for (const c of cols) {
      const r = toNum(rev?.[c.f]);
      const o = toNum(op?.[c.f]);
      if (r === null && o === null) continue;
      years.unshift({ year: String(c.y), revenue: toEok(r), op: toEok(o) });
    }
    for (let i = 0; i < years.length; i += 1) {
      const prev = years[i - 1];
      years[i].revenueYoY = prev ? pct(years[i].revenue, prev.revenue) : null;
      years[i].opYoY = prev ? pct(years[i].op, prev.op) : null;
      years[i].opMargin = years[i].revenue ? Math.round((years[i].op / years[i].revenue) * 1000) / 10 : null;
    }
  }

  // 최근 분기들: 분기·반기 보고서만 사용 — 연간(11011)은 누적치라 분기로 오인됨
  const qDefs = [
    ["11013", "1Q"], ["11012", "2Q"], ["11014", "3Q"],
  ];
  const candidates = [];
  for (const y of [nowY - 1, nowY]) {
    for (const [code_, label] of qDefs) candidates.push({ y, code: code_, label: `${String(y).slice(2)}년${label}` });
  }
  const latestAnnualRev = years.length ? years[years.length - 1].revenue : null;
  const quarters = [];
  for (const c of candidates) { // 과거→최신 순
    const rows = await fetchFnltt(entry.corp, c.y, c.code);
    if (!rows.length) continue;
    const rev = pickAccount(rows, REV_NAMES);
    const op = pickAccount(rows, OP_NAMES);
    // 분기·반기 보고서의 thstrm_amount는 해당 3개월 실적 (누적은 thstrm_add_amount)
    const r = toEok(toNum(rev?.thstrm_amount));
    const o = toEok(toNum(op?.thstrm_amount));
    if (r === null && o === null) continue;
    // 누적치가 섞인 응답 방어: 분기 매출이 연매출의 60%를 넘으면 배제
    if (latestAnnualRev && r !== null && r > latestAnnualRev * 0.6) continue;
    quarters.push({ label: c.label, revenue: r, op: o });
  }
  const recentQ = quarters.slice(-4);

  // 실적 모멘텀 점수 (기술 점수와 별도 축, 0~100)
  let fscore = 50;
  const notes = [];
  const lastY = years[years.length - 1];
  if (lastY) {
    if (lastY.revenueYoY !== null) { fscore += lastY.revenueYoY > 0 ? 10 : -5; notes.push(`연매출 ${lastY.revenueYoY > 0 ? "+" : ""}${lastY.revenueYoY}%`); }
    if (lastY.opYoY !== null) { fscore += lastY.opYoY > 0 ? 15 : -10; notes.push(`영업이익 ${lastY.opYoY > 0 ? "+" : ""}${lastY.opYoY}%`); }
    const prevY = years[years.length - 2];
    if (prevY && lastY.opMargin !== null && prevY.opMargin !== null && lastY.opMargin > prevY.opMargin) {
      fscore += 10;
      notes.push("이익률 개선");
    }
  }
  const lastQ = recentQ[recentQ.length - 1];
  const yoyQ = recentQ.length >= 4 ? pct(lastQ?.op, quarters[quarters.length - 5]?.op) : null;
  if (lastQ && lastQ.op !== null) {
    if (lastQ.op > 0) fscore += 5;
    if (yoyQ !== null && yoyQ > 0) { fscore += 10; notes.push(`최근분기 영업이익 +${yoyQ}%`); }
  }
  fscore = Math.max(0, Math.min(100, Math.round(fscore)));
  const fgrade = fscore >= 75 ? "A" : fscore >= 60 ? "B" : fscore >= 45 ? "C" : "D";

  const data = {
    ok: true,
    code,
    name: entry.name,
    unit: "억원",
    years,
    quarters: recentQ,
    fundamentalScore: fscore,
    fundamentalGrade: fgrade,
    note: notes.join(" · ") || "실적 데이터 일부만 확보됨",
    updatedAt: new Date().toISOString(),
  };
  fundCache.set(code, { at: Date.now(), data });
  return data;
}

// ── 관심종목 등록 + 실적 공시 감시 ──
let watchSet = new Set();
try {
  const saved = JSON.parse(fs.readFileSync(WATCH_PATH, "utf8"));
  if (Array.isArray(saved)) watchSet = new Set(saved);
} catch { /* 없음 */ }
let seen = new Set();
try {
  const saved = JSON.parse(fs.readFileSync(SEEN_PATH, "utf8"));
  if (Array.isArray(saved)) seen = new Set(saved);
} catch { /* 없음 */ }
let firstScanDone = false;

function registerWatchlist(codes) {
  let added = 0;
  for (const c of codes || []) {
    const t = String(c).trim();
    if (/^\d{6}$/.test(t) && !watchSet.has(t)) { watchSet.add(t); added += 1; }
  }
  if (added) {
    try {
      fs.mkdirSync(path.dirname(WATCH_PATH), { recursive: true });
      fs.writeFileSync(WATCH_PATH, JSON.stringify([...watchSet]));
    } catch { /* best effort */ }
  }
  return { count: watchSet.size, added };
}

const getWatchlist = () => [...watchSet];

/**
 * 관심종목의 신규 실적 공시(분기/반기/사업보고서) 스캔.
 * 반환: 새로 발견된 공시 목록. sendPush(title, body)는 호출자가 주입.
 */
async function scanEarnings(sendPush) {
  if (!KEY() || watchSet.size === 0) return { scanned: 0, found: 0 };
  const map = await loadCorpMap();
  const d = new Date(Date.now() - 3 * 86400000);
  const bgn = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let found = 0;
  for (const code of watchSet) {
    const entry = map[code];
    if (!entry) continue;
    try {
      const { data } = await axios.get("https://opendart.fss.or.kr/api/list.json", {
        params: { crtfc_key: KEY(), corp_code: entry.corp, bgn_de: bgn, pblntf_ty: "A", page_count: 20 },
        timeout: 15000,
      });
      for (const item of data.list || []) {
        if (!/(분기보고서|반기보고서|사업보고서)/.test(item.report_nm || "")) continue;
        if (seen.has(item.rcept_no)) continue;
        seen.add(item.rcept_no);
        found += 1;
        if (firstScanDone && typeof sendPush === "function") {
          fundCache.delete(code); // 새 공시 반영 위해 캐시 무효화
          const f = await getFundamentals(code).catch(() => null);
          const lastQ = f?.quarters?.[f.quarters.length - 1];
          const detail = lastQ
            ? `매출 ${lastQ.revenue?.toLocaleString() ?? "-"}억 · 영업이익 ${lastQ.op?.toLocaleString() ?? "-"}억`
            : item.report_nm;
          await sendPush(`📊 ${entry.name} 실적 발표`, `${item.report_nm} — ${detail}`);
        }
      }
    } catch { /* 종목 단위 실패 무시 */ }
  }
  firstScanDone = true;
  try {
    fs.writeFileSync(SEEN_PATH, JSON.stringify([...seen].slice(-500)));
  } catch { /* best effort */ }
  return { scanned: watchSet.size, found };
}

module.exports = { getFundamentals, registerWatchlist, getWatchlist, scanEarnings };
