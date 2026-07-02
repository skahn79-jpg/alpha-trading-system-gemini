#!/usr/bin/env node
/**
 * KRX KIND 공개 상장법인 목록으로 종목 마스터를 전체 상장사로 확장합니다.
 * (API 키 불필요 — kind.krx.co.kr corpList 다운로드)
 *
 * - 기존 data/krx-master-merged.json의 큐레이션 항목(업종/태그/지수)은 그대로 유지하고 앞쪽에 배치
 *   (스크리너는 universe 상위 30개를 스캔하므로 주요 종목이 앞에 있어야 함)
 * - 신규 종목은 KIND의 업종(industry) 정보로 추가
 *
 * 사용: node scripts/update-krx-master.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MASTER_FILE = path.join(ROOT, "data", "krx-master-merged.json");

const MARKETS = [
  { type: "stockMkt", market: "KOSPI" },
  { type: "kosdaqMkt", market: "KOSDAQ" },
];

async function fetchMarketList({ type, market }) {
  const url = `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=${type}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`KIND 다운로드 실패 (${market}): HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const html = new TextDecoder("euc-kr").decode(buf);

  // HTML 테이블 파싱 — 헤더(th)에서 컬럼 위치를 동적으로 찾음
  // (KIND 컬럼: 회사명 | 시장구분 | 종목코드 | 업종 | 주요제품 | ... 순서가 바뀔 수 있음)
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let colIdx = null;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    // g-플래그 정규식은 lastIndex가 유지되므로 행마다 새로 생성
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g;
    const cells = [];
    let cell;
    while ((cell = cellRe.exec(tr[1])) !== null) {
      cells.push(cell[1].replace(/<[^>]*>/g, "").trim());
    }
    if (cells.length === 0) continue;

    if (colIdx === null && cells.some((c) => c.includes("종목코드"))) {
      colIdx = {
        name: cells.findIndex((c) => c.includes("회사명")),
        code: cells.findIndex((c) => c.includes("종목코드")),
        industry: cells.findIndex((c) => c.includes("업종")),
        products: cells.findIndex((c) => c.includes("주요제품")),
      };
      continue;
    }
    if (!colIdx) continue;

    const code = cells[colIdx.code];
    if (!/^\d{6}$/.test(code || "")) continue;
    rows.push({
      code,
      name: cells[colIdx.name] || "",
      industry: cells[colIdx.industry] || null,
      products: cells[colIdx.products] || null,
      market,
    });
  }
  return rows;
}

async function main() {
  const existing = fs.existsSync(MASTER_FILE)
    ? JSON.parse(fs.readFileSync(MASTER_FILE, "utf8"))
    : [];
  const existingByCode = new Map(existing.map((x) => [x.code, x]));
  console.log(`기존 마스터: ${existing.length}개`);

  const all = [];
  for (const m of MARKETS) {
    const rows = await fetchMarketList(m);
    console.log(`${m.market}: ${rows.length}개 다운로드`);
    all.push(...rows);
  }

  const newEntries = [];
  const seenNew = new Set(); // KIND 목록 자체의 중복 행 제거
  for (const row of all) {
    if (seenNew.has(row.code)) continue;
    seenNew.add(row.code);
    const cur = existingByCode.get(row.code);
    if (cur) {
      // 큐레이션 유지 + 시장 정보만 최신화
      cur.market = row.market;
      if (!cur.industry && row.industry) cur.industry = row.industry;
      continue;
    }
    newEntries.push({
      code: row.code,
      name: row.name,
      tag: row.industry || "기타",
      sector: row.industry || "기타",
      market: row.market,
      indexes: [],
      industry: row.industry || null,
    });
  }

  newEntries.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const merged = [...existing, ...newEntries];

  fs.writeFileSync(MASTER_FILE, JSON.stringify(merged, null, 2), "utf8");
  console.log(`병합 완료: 기존 ${existing.length} + 신규 ${newEntries.length} = 총 ${merged.length}개`);
  console.log(`저장: ${MASTER_FILE}`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
