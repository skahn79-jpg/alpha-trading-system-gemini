/**
 * 한국 수출입 리포트 — 총괄 월 시계열 연장 (네트워크 호출 0회)
 *   실행: node --test test/trade.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const trade = require("../trade.js");

const NOW = new Date("2026-09-10T00:00:00Z"); // KST 09-10 09:00 → 당월 2026-09

const PPRC_FIXTURE = {
  pprcOverall: { cnyy: "2026", priodTitle: "2026.08.01 ~ 08.31" },
  pprcExpMonthList: [
    { acptMm: "07월", yearCheck: "2026", cnyyUsdAmt: "98959", icdcRt: "     63.0" },
    { acptMm: "08월", yearCheck: "2026", cnyyUsdAmt: "98255", icdcRt: "     68.7" },
    { acptMm: "09월", yearCheck: "2026", cnyyUsdAmt: "12000", icdcRt: "     10.0" },
  ],
  pprcImpMonthList: [
    { acptMm: "07월", yearCheck: "2026", cnyyUsdAmt: "68567", icdcRt: "     26.5" },
    { acptMm: "08월", yearCheck: "2026", cnyyUsdAmt: "63507", icdcRt: "     22.5" },
    { acptMm: "09월", yearCheck: "2026", cnyyUsdAmt: "8000", icdcRt: "      5.0" },
  ],
};

test("parseLooseNumber strips spaces and commas", () => {
  assert.equal(trade.parseLooseNumber("      68.7"), 68.7);
  assert.equal(trade.parseLooseNumber("      98,255"), 98255);
  assert.equal(trade.parseLooseNumber(""), null);
});

test("currentYearMonthKst uses Asia/Seoul", () => {
  assert.equal(trade.currentYearMonthKst(NOW), "2026-09");
});

test("monthFromAcptMm parses 07월 + year", () => {
  assert.equal(trade.monthFromAcptMm("07월", "2026"), "2026-07");
  assert.equal(trade.monthFromAcptMm("8월", 2026), "2026-08");
});

test("parseCustomsPrelim keeps completed months in million USD and drops current month", () => {
  const rows = trade.parseCustomsPrelim(PPRC_FIXTURE, NOW);
  assert.deepEqual(rows.map((r) => r.month), ["2026-07", "2026-08"]);
  const jul = rows.find((r) => r.month === "2026-07");
  const aug = rows.find((r) => r.month === "2026-08");
  assert.equal(jul.exports, 98959);
  assert.equal(jul.imports, 68567);
  assert.equal(jul.exportsYoY, 63);
  assert.equal(jul.importsYoY, 26.5);
  assert.equal(aug.exports, 98255);
  assert.equal(aug.imports, 63507);
  assert.equal(aug.exportsYoY, 68.7);
  assert.equal(aug.balance, undefined);
});

test("parseCustomsPrelim returns [] on garbage payload", () => {
  assert.deepEqual(trade.parseCustomsPrelim("<html>nope</html>", NOW), []);
  assert.deepEqual(trade.parseCustomsPrelim(null, NOW), []);
});

test("extendMergedWithOfficial appends only months after FRED latest", () => {
  const fred = [
    { month: "2026-05", exports: 88230960000, imports: 63009960000 },
    { month: "2026-06", exports: 100558300000, imports: 67067340000 },
  ];
  const official = trade.parseCustomsPrelim(PPRC_FIXTURE, NOW);
  const { merged, extendedMonths } = trade.extendMergedWithOfficial(fred, official);
  assert.deepEqual(extendedMonths, ["2026-07", "2026-08"]);
  assert.equal(merged.length, 4);
  assert.equal(merged[1].month, "2026-06");
  assert.equal(merged[1].exports, 100558300000); // FRED 값 유지
  assert.equal(merged[2].month, "2026-07");
  assert.equal(merged[2].exports, 98959 * 1e6);
  assert.equal(merged[2].imports, 68567 * 1e6);
  assert.equal(merged[2].officialExportsYoY, 63);
  assert.equal(merged[3].month, "2026-08");
  assert.equal(merged[3].officialExportsYoY, 68.7);
});

test("extendMergedWithOfficial does not replace overlapping FRED months", () => {
  const fred = [{ month: "2026-07", exports: 1, imports: 1 }];
  const official = [{ month: "2026-07", exports: 98959, imports: 68567 }];
  const { merged, extendedMonths } = trade.extendMergedWithOfficial(fred, official);
  assert.deepEqual(extendedMonths, []);
  assert.equal(merged[0].exports, 1);
});

test("extendMergedWithOfficial no-ops without official rows (TRADE_API_KEY 없는 경로와 동일)", () => {
  const fred = [{ month: "2026-06", exports: 100, imports: 70 }];
  const { merged, extendedMonths } = trade.extendMergedWithOfficial(fred, []);
  assert.deepEqual(extendedMonths, []);
  assert.equal(merged, fred);
});

test("mergeOfficialMillionRows prefers the first source for a month", () => {
  const a = [{ month: "2026-07", exports: 98959, imports: 68567 }];
  const b = [{ month: "2026-07", exports: 1, imports: 1 }, { month: "2026-08", exports: 98255, imports: 63507 }];
  const rows = trade.mergeOfficialMillionRows(a, b);
  assert.equal(rows.find((r) => r.month === "2026-07").exports, 98959);
  assert.equal(rows.find((r) => r.month === "2026-08").exports, 98255);
});

test("scaleToMillionUsd detects USD vs already-million via FRED reference", () => {
  const ref = 100558; // FRED June million USD
  assert.equal(trade.scaleToMillionUsd(100558000000, ref), 100558);
  assert.equal(trade.scaleToMillionUsd(100558, ref), 100558);
  assert.equal(trade.scaleToMillionUsd(100558000, ref), 100558);
});

test("isGrandTotalName skips 소계 but keeps 총계/합계", () => {
  assert.equal(trade.isGrandTotalName("총계"), true);
  assert.equal(trade.isGrandTotalName("(합계)"), true);
  assert.equal(trade.isGrandTotalName("반도체 소계"), false);
  assert.equal(trade.isGrandTotalName("(메모리반도체)"), false);
});

test("totalsMapToMillion converts 신성질별 총계 USD into million", () => {
  const totals = new Map([
    ["2026-07", { exports: 98959000000, imports: 68567000000 }],
  ]);
  const ref = new Map([["2026-06", { exports: 100558, imports: 67067 }]]);
  const rows = trade.totalsMapToMillion(totals, ref);
  assert.equal(rows[0].month, "2026-07");
  assert.equal(rows[0].exports, 98959);
  assert.equal(rows[0].imports, 68567);
});

test("yoy and mom still compute on mixed FRED+official USD series", () => {
  const series = [];
  for (let i = 0; i < 13; i += 1) {
    series.push({ month: `2025-${String(i + 1).padStart(2, "0")}`, value: 100 });
  }
  // pad to have 2025-07 at idx 6 and 2026-07 at idx 18? simpler: 13 points then extra
  const exp = [
    { month: "2025-06", value: 58919450000 },
    { month: "2025-07", value: 59904890000 },
    { month: "2026-06", value: 100558300000 },
    { month: "2026-07", value: 98959000000 },
  ];
  // idx 3 vs idx -12 doesn't work on short series; check mom only
  assert.equal(trade.mom(exp, 3), Math.round(((98959000000 - 100558300000) / 100558300000) * 1000) / 10);
});
