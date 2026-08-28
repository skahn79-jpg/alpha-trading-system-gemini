/**
 * GATE 10M bounded OOS benchmark date index.
 * Pure CommonJS. No I/O. No global cache. No official error codes.
 * First-row-wins. Callers map { ok:false } to OOS_FOLD_FAILED field benchmarkSeries.
 */

"use strict";

const { parseYmd } = require("./schemas");

function buildBenchmarkDateIndex(benchmarkSeries) {
  const index = new Map();
  if (!Array.isArray(benchmarkSeries)) {
    return index;
  }
  for (const row of benchmarkSeries) {
    if (!row) continue;
    const parsed = parseYmd(row.tradingDate);
    if (!parsed.ok) continue;
    if (index.has(parsed.date)) continue;
    index.set(parsed.date, row);
  }
  return index;
}

function lookupIndexedRow(index, date) {
  if (index == null) return undefined;
  if (typeof index.get === "function") return index.get(date);
  if (typeof index === "object") return index[date];
  return undefined;
}

function sliceBenchmarkFromIndex(index, allowedDates) {
  const dates = Array.isArray(allowedDates) ? allowedDates : [];
  if (dates.length === 0) {
    return { ok: false, series: null };
  }
  if (dates.length > 3) {
    return { ok: false, series: null };
  }
  const series = [];
  for (let i = 0; i < dates.length; i += 1) {
    const parsed = parseYmd(dates[i]);
    if (!parsed.ok) {
      return { ok: false, series: null };
    }
    const row = lookupIndexedRow(index, parsed.date);
    if (!row) {
      return { ok: false, series: null };
    }
    series.push(row);
  }
  return { ok: true, series };
}

module.exports = {
  buildBenchmarkDateIndex,
  sliceBenchmarkFromIndex,
};
