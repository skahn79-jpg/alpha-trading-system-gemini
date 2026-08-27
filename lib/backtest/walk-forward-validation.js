/**
 * GATE 5N + 5R Walk-Forward / OOS 검증. 순수 CommonJS. I/O 없음.
 * 5R: index-only embargoTradingDayCount gap between trainEnd and oosStart. Omitted=0.
 * 5S: stepSize === trainWindowSize + embargoTradingDayCount + oosWindowSize. All train/embargo/oos slices pairwise index-disjoint.
 * 5T: post-OOS embargo. stepSize === train + 2*embargo + oos. embargo=0 keeps 5S identity.
 * 5U: train/oos sizes must be positive TILE_SIZE (3) multiples and <= TILE_SIZE * MAX_COMPLETE_TILE_COUNT (300).
 * 5V: success requires droppedIncompleteTail=false (exact block coverage).
 * 5W: horizonType required; embargo must satisfy leakage-guard PURGE_MIN.
 * 5Y: each fold OOS benchmarkSeries is sliced to that fold's OOS dates.
 * 5Z: featureWindow asOf = signalTradingDate; execution candles may include entry/exit.
 *     same-day signal fill fail-closed.
 * 6B: standalone OOS uses nonoverlapping TILE_SIZE tiles (same as selection 5Q).
 *     fold metrics = equal-weighted mean of per-tile pipeline returns; no compounding.
 *     tile values, sums, and means of totalReturn/benchmarkReturn/alpha must be finite;
 *     overflow maps to OOS_FOLD_FAILED.
 * 6D: equal-weighted tile means go through shared finite-tile-mean helper.
 * 6E: fold-level equal-weighted aggregate also uses the same helper;
 *     helper failure maps to WALK_FORWARD_AGGREGATE_NONFINITE.
 * 6F: fold-aggregate error.field is meanOosTotalReturn / meanOosBenchmarkReturn / meanOosAlpha
 *     in both standalone walk-forward and selection.
 * 6G: freeze the 6B-6F finite-mean chapter. Helper usage, meanOos* fields, and
 *     overflow identities stay pinned. No helper reason/stage.
 * 6H: unify makeError via shared makeBacktestError. Severity default ERROR.
 *     Known extras only. No official codes in the helper.
 * 6I: freeze the 6H makeError unification. Shared helper, known extras,
 *     and overflow identities stay pinned. Other modules stay private.
 * 6U-R1: standalone fold errorCodes are uniqueCodes([root, OOS_FOLD_FAILED, ...extras])
 *     (root-first). Top-level walk-forward errors stay unchanged.
 * 6U-R2: copy pipeline.failedStage onto walk-forward blocked results. Config/local
 *     OOS failures stay failedStage WALK_FORWARD.
 * 6V freeze: fold errorCodes stay root-first uniqueCodes([root, OOS_FOLD_FAILED,
 *     extras]). Copy pipeline failedStage; config/local OOS stay WALK_FORWARD.
 */

"use strict";

const { parseYmd } = require("./schemas");
const leakageGuard = require("./leakage-guard");
const syntheticPipeline = require("./synthetic-pipeline");
const { PIPELINE_STATUS } = syntheticPipeline;
const {
  computeDatasetContentChecksum,
  computeDatasetMetadataHash,
  EXACT_CALENDAR_MEMBERSHIP,
} = require("./data-validation");
const executionModel = require("./execution-model");
const { assertFiniteEqualWeightedMean } = require("./finite-tile-mean");
const { makeBacktestError: makeError } = require("./make-error");

const WALK_FORWARD_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_WALK_FORWARD",
  BLOCKED: "BLOCKED_WALK_FORWARD",
});

const FOLD_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_OOS_FOLD",
  BLOCKED: "BLOCKED_OOS_FOLD",
});

const ERROR = Object.freeze({
  INVALID_WALK_FORWARD_CONFIG: "INVALID_WALK_FORWARD_CONFIG",
  INVALID_INPUT: "INVALID_INPUT",
  INSUFFICIENT_WALK_FORWARD_DATA: "INSUFFICIENT_WALK_FORWARD_DATA",
  INSUFFICIENT_WALK_FORWARD_FOLDS: "INSUFFICIENT_WALK_FORWARD_FOLDS",
  WALK_FORWARD_DATE_MISMATCH: "WALK_FORWARD_DATE_MISMATCH",
  WALK_FORWARD_OVERLAP_DETECTED: "WALK_FORWARD_OVERLAP_DETECTED",
  OOS_FOLD_FAILED: "OOS_FOLD_FAILED",
  WALK_FORWARD_STAGE_FAILED: "WALK_FORWARD_STAGE_FAILED",
  WALK_FORWARD_AGGREGATE_NONFINITE: "WALK_FORWARD_AGGREGATE_NONFINITE",
  PRODUCTION_MARKET_NOT_ALLOWED: "PRODUCTION_MARKET_NOT_ALLOWED",
  LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE: "LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE",
});

const AGGREGATE_DEFINITION = "EQUAL_WEIGHTED_FOLD_MEAN";
const TILE_SIZE = 3;
const MAX_COMPLETE_TILE_COUNT = 100;

const ALLOWED_MARKETS = new Set(["SYNTHETIC_KOSPI", "SYNTHETIC_KOSDAQ"]);
const PRODUCTION_MARKETS = new Set(["KOSPI", "KOSDAQ", "KRX", "NASDAQ", "NYSE"]);

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function uniqueCodes(errors) {
  const seen = new Set();
  const out = [];
  for (const err of errors) {
    if (!err || err.code == null) continue;
    if (seen.has(err.code)) continue;
    seen.add(err.code);
    out.push(err.code);
  }
  return out;
}

function utcMsFromYmd(ymd) {
  const parsed = parseYmd(ymd);
  if (!parsed.ok) return null;
  const year = Number(parsed.date.slice(0, 4));
  const month = Number(parsed.date.slice(5, 7));
  const day = Number(parsed.date.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function formatFoldId(index) {
  return `WF-${String(index + 1).padStart(4, "0")}`;
}

function buildOosDateSet(oosDates) {
  const set = new Set();
  for (const raw of oosDates) {
    const parsed = parseYmd(raw);
    if (parsed.ok) set.add(parsed.date);
  }
  return set;
}

function isInOosDates(tradingDate, oosDateSet) {
  const parsed = parseYmd(tradingDate);
  if (!parsed.ok) return false;
  return oosDateSet.has(parsed.date);
}



function sliceFeatureWindow(candles, signalDate) {
  const parsedSignal = parseYmd(signalDate);
  if (!parsedSignal.ok) {
    return { ok: false, candles: [], error: makeError(ERROR.OOS_FOLD_FAILED, { field: "featureWindow" }) };
  }
  const out = [];
  for (const row of Array.isArray(candles) ? candles : []) {
    if (!row) continue;
    const parsed = parseYmd(row.tradingDate);
    if (!parsed.ok) continue;
    if (parsed.date <= parsedSignal.date) out.push(row);
  }
  return { ok: true, candles: out, error: null };
}

function assertCausalTradeTiming(tradeIntent, allowedDates, failCode, foldId) {
  const code = failCode;
  const extra = foldId != null ? { field: "tradeIntents", foldId } : { field: "tradeIntents" };
  if (!isPlainObject(tradeIntent) || !isPlainObject(tradeIntent.entryIntent)) {
    return { ok: false, error: makeError(code, extra) };
  }
  const allowed = buildOosDateSet(allowedDates);
  const signal = parseYmd(tradeIntent.entryIntent.signalTradingDate);
  const exec = parseYmd(tradeIntent.entryIntent.earliestExecutionTradingDate);
  const entry = parseYmd(tradeIntent.entryDate);
  const exit = parseYmd(tradeIntent.exitDate);
  if (!signal.ok || !exec.ok || !entry.ok || !exit.ok) {
    return { ok: false, error: makeError(code, extra) };
  }
  if (!allowed.has(signal.date) || !allowed.has(exec.date) || !allowed.has(entry.date) || !allowed.has(exit.date)) {
    return { ok: false, error: makeError(code, extra) };
  }
  if (!(signal.date < exec.date) || exec.date !== entry.date || !(entry.date <= exit.date)) {
    return { ok: false, error: makeError(code, extra) };
  }
  return { ok: true, error: null };
}

function sliceBenchmarkForDates(benchmarkSeries, allowedDates) {
  const allowed = buildOosDateSet(allowedDates);
  if (!Array.isArray(benchmarkSeries)) {
    return { ok: false, series: null, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "benchmarkSeries" }) };
  }
  const firstByDate = new Map();
  for (const row of benchmarkSeries) {
    if (!row) continue;
    const parsed = parseYmd(row.tradingDate);
    if (!parsed.ok) continue;
    if (!allowed.has(parsed.date)) continue;
    if (!firstByDate.has(parsed.date)) {
      firstByDate.set(parsed.date, row);
    }
  }
  const sliced = [];
  for (const date of allowedDates) {
    const parsed = parseYmd(date);
    if (!parsed.ok) continue;
    const row = firstByDate.get(parsed.date);
    if (row) sliced.push(row);
  }
  for (const row of sliced) {
    const parsed = parseYmd(row.tradingDate);
    if (!parsed.ok || !allowed.has(parsed.date)) {
      return { ok: false, series: null, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "benchmarkSeries" }) };
    }
  }
  if (sliced.length === 0) {
    return { ok: false, series: null, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "benchmarkSeries" }) };
  }
  return { ok: true, series: sliced, error: null };
}
function sanitizeDatasetEnvelope(dataset) {
  if (!isPlainObject(dataset)) return dataset;
  if (Object.hasOwn(dataset, "market")) {
    delete dataset.market;
  }
  return dataset;
}


function validateTradingDates(tradingDates) {
  const errors = [];
  if (!Array.isArray(tradingDates)) {
    errors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "tradingDates" }));
    return { ok: false, dates: [], errors };
  }
  const dates = [];
  const seen = new Set();
  let prevMs = null;
  for (let i = 0; i < tradingDates.length; i += 1) {
    const raw = tradingDates[i];
    const parsed = parseYmd(raw);
    if (!parsed.ok) {
      errors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, {
        field: "tradingDates",
        tradingDate: raw,
      }));
      continue;
    }
    if (seen.has(parsed.date)) {
      errors.push(makeError(ERROR.WALK_FORWARD_DATE_MISMATCH, { tradingDate: parsed.date }));
      continue;
    }
    seen.add(parsed.date);
    const ms = utcMsFromYmd(parsed.date);
    if (prevMs != null && ms <= prevMs) {
      errors.push(makeError(ERROR.WALK_FORWARD_DATE_MISMATCH, { tradingDate: parsed.date }));
    }
    prevMs = ms;
    dates.push(parsed.date);
  }
  if (errors.length > 0) {
    return { ok: false, dates: [], errors };
  }
  return { ok: true, dates, errors: [] };
}

function generateWalkForwardWindows(input) {
  const fail = (errorCodes, errors) => ({
    ok: false,
    windows: [],
    droppedIncompleteTail: false,
    errorCodes,
    errors,
  });

  if (!isPlainObject(input)) {
    const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG);
    return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
  }

  const {
    tradingDates,
    trainWindowSize,
    oosWindowSize,
    stepSize,
    minTrainWindowSize,
    embargoTradingDayCount: rawEmbargo,
  } = input;

  const configErrors = [];

  if (!isPositiveInteger(trainWindowSize)) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "trainWindowSize" }));
  }
  if (!isPositiveInteger(oosWindowSize)) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "oosWindowSize" }));
  }
  if (!isPositiveInteger(stepSize)) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "stepSize" }));
  }
  if (configErrors.length > 0) {
    return fail(uniqueCodes(configErrors), configErrors);
  }

  if (trainWindowSize % TILE_SIZE !== 0) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "trainWindowSize" }));
  }
  if (oosWindowSize % TILE_SIZE !== 0) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "oosWindowSize" }));
  }
  const maxWindowSize = TILE_SIZE * MAX_COMPLETE_TILE_COUNT;
  if (trainWindowSize > maxWindowSize) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "trainWindowSize" }));
  }
  if (oosWindowSize > maxWindowSize) {
    configErrors.push(makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "oosWindowSize" }));
  }
  if (configErrors.length > 0) {
    return fail(uniqueCodes(configErrors), configErrors);
  }

  let embargoTradingDayCount = 0;
  if (rawEmbargo !== undefined && rawEmbargo !== null) {
    if (!isNonNegativeInteger(rawEmbargo)) {
      const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "embargoTradingDayCount" });
      return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
    }
    embargoTradingDayCount = rawEmbargo;
  }

  const horizonType = input.horizonType;
  if (horizonType == null || horizonType === "") {
    const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "horizonType" });
    return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
  }
  const purgeResult = leakageGuard.validatePurgeEmbargo({
    horizonType,
    purgeUnit: leakageGuard.PURGE_UNIT.TRADING_DAY,
    embargoUnit: leakageGuard.PURGE_UNIT.TRADING_DAY,
    purgeLength: embargoTradingDayCount,
    embargoLength: embargoTradingDayCount,
  });
  if (!purgeResult.ok) {
    const codes = Array.isArray(purgeResult.errorCodes) ? purgeResult.errorCodes : [];
    let field = "embargoTradingDayCount";
    if (codes.includes(leakageGuard.LEAKAGE_ERROR.INVALID_INPUT)
      || codes.includes(leakageGuard.LEAKAGE_ERROR.PURGE_UNIT_MISMATCH)) {
      field = "horizonType";
    }
    const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field });
    return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
  }

  if (stepSize !== trainWindowSize + 2 * embargoTradingDayCount + oosWindowSize) {
    const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "stepSize" });
    return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
  }

  if (minTrainWindowSize !== undefined && minTrainWindowSize !== null) {
    if (!isPositiveInteger(minTrainWindowSize)) {
      const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "minTrainWindowSize" });
      return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
    }
    if (trainWindowSize < minTrainWindowSize) {
      const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "minTrainWindowSize" });
      return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
    }
  }

  const dateResult = validateTradingDates(tradingDates);
  if (!dateResult.ok) {
    return fail(uniqueCodes(dateResult.errors), dateResult.errors);
  }

  const dates = dateResult.dates;
  const n = dates.length;

  if (n < trainWindowSize + 2 * embargoTradingDayCount + oosWindowSize) {
    const err = makeError(ERROR.INSUFFICIENT_WALK_FORWARD_DATA);
    return fail([ERROR.INSUFFICIENT_WALK_FORWARD_DATA], [err]);
  }

  const windows = [];
  let droppedIncompleteTail = false;
  let trainStartIndex = 0;

  while (true) {
    const trainEndIndex = trainStartIndex + trainWindowSize - 1;
    const embargoStartIndex = trainEndIndex + 1;
    const oosStartIndex = trainEndIndex + 1 + embargoTradingDayCount;
    const oosEndIndex = oosStartIndex + oosWindowSize - 1;
    const postOosEmbargoStartIndex = oosEndIndex + 1;
    const postOosEmbargoEndIndex = oosEndIndex + embargoTradingDayCount;

    if (postOosEmbargoEndIndex >= n) {
      droppedIncompleteTail = trainStartIndex < n;
      break;
    }

    const trainStart = dates[trainStartIndex];
    const trainEnd = dates[trainEndIndex];
    const oosStart = dates[oosStartIndex];
    const oosEnd = dates[oosEndIndex];
    const embargoDates = dates.slice(embargoStartIndex, oosStartIndex);
    const embargoStart = embargoTradingDayCount > 0 ? embargoDates[0] : null;
    const embargoEnd = embargoTradingDayCount > 0 ? embargoDates[embargoDates.length - 1] : null;
    const postOosEmbargoDates = dates.slice(postOosEmbargoStartIndex, postOosEmbargoEndIndex + 1);
    const postOosEmbargoStart = embargoTradingDayCount > 0 ? postOosEmbargoDates[0] : null;
    const postOosEmbargoEnd = embargoTradingDayCount > 0 ? postOosEmbargoDates[postOosEmbargoDates.length - 1] : null;

    windows.push({
      foldId: formatFoldId(windows.length),
      trainStart,
      trainEnd,
      oosStart,
      oosEnd,
      trainTradingDayCount: trainWindowSize,
      oosTradingDayCount: oosWindowSize,
      embargoTradingDayCount,
      embargoDates,
      embargoStart,
      embargoEnd,
      postOosEmbargoTradingDayCount: embargoTradingDayCount,
      postOosEmbargoDates,
      postOosEmbargoStart,
      postOosEmbargoEnd,
      trainStartIndex,
      trainEndIndex,
      oosStartIndex,
      oosEndIndex,
    });

    trainStartIndex += stepSize;
  }

  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i];
    const trainEndMs = utcMsFromYmd(w.trainEnd);
    const oosStartMs = utcMsFromYmd(w.oosStart);
    if (trainEndMs == null || oosStartMs == null || trainEndMs >= oosStartMs) {
      const err = makeError(ERROR.WALK_FORWARD_DATE_MISMATCH, { foldId: w.foldId });
      return fail([ERROR.WALK_FORWARD_DATE_MISMATCH], [err]);
    }
    if (i > 0) {
      const prev = windows[i - 1];
      const prevOosEndMs = utcMsFromYmd(prev.oosEnd);
      const curOosStartMs = utcMsFromYmd(w.oosStart);
      if (prevOosEndMs != null && curOosStartMs != null && curOosStartMs <= prevOosEndMs) {
        const err = makeError(ERROR.WALK_FORWARD_OVERLAP_DETECTED, { foldId: w.foldId });
        return fail([ERROR.WALK_FORWARD_OVERLAP_DETECTED], [err]);
      }
    }
  }

  function indexRangeSet(start, end) {
    const set = new Set();
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      return set;
    }
    for (let idx = start; idx <= end; idx += 1) {
      set.add(idx);
    }
    return set;
  }

  function windowSlices(win) {
    return {
      train: indexRangeSet(win.trainStartIndex, win.trainEndIndex),
      embargo: indexRangeSet(win.trainEndIndex + 1, win.oosStartIndex - 1),
      oos: indexRangeSet(win.oosStartIndex, win.oosEndIndex),
      postOosEmbargo: indexRangeSet(win.oosEndIndex + 1, win.oosEndIndex + win.embargoTradingDayCount),
    };
  }

  function setsIntersect(left, right) {
    for (const value of left) {
      if (right.has(value)) {
        return true;
      }
    }
    return false;
  }

  const sliceKinds = ["train", "embargo", "oos", "postOosEmbargo"];
  for (let i = 0; i < windows.length; i += 1) {
    const current = windowSlices(windows[i]);
    for (let a = 0; a < sliceKinds.length; a += 1) {
      for (let b = a + 1; b < sliceKinds.length; b += 1) {
        if (setsIntersect(current[sliceKinds[a]], current[sliceKinds[b]])) {
          const err = makeError(ERROR.WALK_FORWARD_OVERLAP_DETECTED, { foldId: windows[i].foldId });
          return fail([ERROR.WALK_FORWARD_OVERLAP_DETECTED], [err]);
        }
      }
    }
    for (let j = 0; j < i; j += 1) {
      const earlier = windowSlices(windows[j]);
      for (let a = 0; a < sliceKinds.length; a += 1) {
        for (let b = 0; b < sliceKinds.length; b += 1) {
          if (setsIntersect(current[sliceKinds[a]], earlier[sliceKinds[b]])) {
            const err = makeError(ERROR.WALK_FORWARD_OVERLAP_DETECTED, { foldId: windows[i].foldId });
            return fail([ERROR.WALK_FORWARD_OVERLAP_DETECTED], [err]);
          }
        }
      }
    }
  }

  if (windows.length < 2) {
    const err = makeError(ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS);
    return fail([ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS], [err]);
  }

  if (droppedIncompleteTail) {
    const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "tradingDates" });
    return fail([ERROR.INVALID_WALK_FORWARD_CONFIG], [err]);
  }

  return {
    ok: true,
    windows,
    droppedIncompleteTail,
    errorCodes: [],
    errors: [],
  };
}

function deepClonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sliceDatasetForOos(dataset, oosDates) {
  const oosDateSet = buildOosDateSet(oosDates);
  const oosStart = oosDates.length > 0 ? oosDates[0] : null;
  const oosEnd = oosDates.length > 0 ? oosDates[oosDates.length - 1] : null;
  const cloned = sanitizeDatasetEnvelope(deepClonePlain(dataset));
  const candles = (cloned.candles || []).filter(
    (c) => c && isInOosDates(c.tradingDate, oosDateSet),
  );
  cloned.candles = candles;
  if (candles.length === 0) {
    cloned.coverage = { from: oosStart, to: oosEnd };
    if (cloned.perSymbolCoverage) {
      const next = {};
      for (const sym of Object.keys(cloned.perSymbolCoverage)) {
        next[sym] = { from: oosStart, to: oosEnd };
      }
      cloned.perSymbolCoverage = next;
    }
  } else {
    const dates = candles.map((c) => c.tradingDate);
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));
    cloned.coverage = { from, to };
    if (cloned.perSymbolCoverage) {
      const next = {};
      for (const sym of Object.keys(cloned.perSymbolCoverage)) {
        next[sym] = { from, to };
      }
      cloned.perSymbolCoverage = next;
    }
  }
  cloned.contentChecksum = computeDatasetContentChecksum(cloned);
  cloned.metadataHash = computeDatasetMetadataHash(cloned);
  return cloned;
}

function sliceCalendarForOos(calendar, oosDates) {
  const oosDateSet = buildOosDateSet(oosDates);
  const oosStart = oosDates.length > 0 ? oosDates[0] : null;
  const oosEnd = oosDates.length > 0 ? oosDates[oosDates.length - 1] : null;
  const cloned = deepClonePlain(calendar);
  const days = (cloned.days || []).filter(
    (d) => d && isInOosDates(d.tradingDate, oosDateSet),
  );
  cloned.days = days;
  if (days.length > 0) {
    const dates = days.map((d) => d.tradingDate);
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));
    cloned.coverage = { from, to };
  } else {
    cloned.coverage = { from: oosStart, to: oosEnd };
  }
  Object.defineProperty(cloned, EXACT_CALENDAR_MEMBERSHIP, {
    value: true,
    enumerable: false,
  });
  return cloned;
}

function padTileIndex(k) {
  if (!Number.isInteger(k) || k < 1) return null;
  if (k < 100) return "T" + String(k).padStart(2, "0");
  return "T" + String(k);
}

function buildOosTiles(oosDates) {
  const dates = Array.isArray(oosDates) ? oosDates : [];
  const tiles = [];
  let i = 0;
  while (i + TILE_SIZE <= dates.length && tiles.length < MAX_COMPLETE_TILE_COUNT) {
    tiles.push([dates[i], dates[i + 1], dates[i + 2]]);
    i += TILE_SIZE;
  }
  const droppedDates = dates.slice(tiles.length * TILE_SIZE);
  return { tiles, droppedDates };
}

function buildOosTradeIntent(oosDates, templateIntent, foldId, tradeId) {
  if (oosDates.length < 3) {
    return {
      ok: false,
      error: makeError(ERROR.OOS_FOLD_FAILED, { foldId, field: "tradeIntents" }),
    };
  }
  const signal = oosDates[0];
  const entry = oosDates[1];
  const exit = oosDates[oosDates.length - 1];
  const quantity = templateIntent && isFiniteNumber(templateIntent.quantity)
    ? templateIntent.quantity
    : 10;
  const entryIntent = templateIntent && isPlainObject(templateIntent.entryIntent)
    ? {
      ...deepClonePlain(templateIntent.entryIntent),
      signalTradingDate: signal,
      earliestExecutionTradingDate: entry,
    }
    : {
      orderType: "MARKET_OPEN",
      signalTradingDate: signal,
      earliestExecutionTradingDate: entry,
      limitPrice: null,
    };
  const exitPolicy = templateIntent && isPlainObject(templateIntent.exitPolicy)
    ? deepClonePlain(templateIntent.exitPolicy)
    : {
      stopLossPrice: 9500,
      takeProfitPrice: 11000,
      intrabarConflictPolicy: "STOP_FIRST",
    };
  return {
    ok: true,
    tradeIntent: {
      tradeId: tradeId != null ? tradeId : foldId,
      quantity,
      entryDate: entry,
      exitDate: exit,
      exitDateMode: "LATEST_ALLOWED",
      entryIntent,
      exitPolicy,
    },
  };
}

function buildFoldPipelineInput(input, window, pipelineBase, periodDates, tradeId) {
  const { foldId } = window;
  const oosDates = Array.isArray(periodDates) ? periodDates : [];
  const periodStart = oosDates.length > 0 ? oosDates[0] : null;
  const periodEnd = oosDates.length > 0 ? oosDates[oosDates.length - 1] : null;

  const templateIntent = Array.isArray(pipelineBase.tradeIntents) && pipelineBase.tradeIntents.length > 0
    ? pipelineBase.tradeIntents[0]
    : null;
  const tradeResult = buildOosTradeIntent(oosDates, templateIntent, foldId, tradeId);
  if (!tradeResult.ok) {
    return { ok: false, error: tradeResult.error };
  }

  const foldInput = deepClonePlain(pipelineBase);
  foldInput.dataset = sliceDatasetForOos(pipelineBase.dataset, oosDates);
  foldInput.calendar = sliceCalendarForOos(pipelineBase.calendar, oosDates);
  foldInput.calendarValidation = {
    ...(isPlainObject(pipelineBase.calendarValidation) ? deepClonePlain(pipelineBase.calendarValidation) : {}),
    requiredFrom: periodStart,
    requiredTo: periodEnd,
  };
  foldInput.tradeIntents = [tradeResult.tradeIntent];
  foldInput.initialCapital = input.initialCapital;
  if (Object.hasOwn(foldInput, "benchmark")) {
    delete foldInput.benchmark;
  }

  const timing = assertCausalTradeTiming(tradeResult.tradeIntent, oosDates, ERROR.OOS_FOLD_FAILED, foldId);
  if (!timing.ok) {
    return { ok: false, error: timing.error };
  }
  const signalDate = tradeResult.tradeIntent.entryIntent.signalTradingDate;
  const featureSlice = sliceFeatureWindow(foldInput.dataset && foldInput.dataset.candles, signalDate);
  if (!featureSlice.ok) {
    return { ok: false, error: featureSlice.error };
  }
  const guard = leakageGuard.assertFeatureWindowNoLookAhead({
    featureWindow: featureSlice.candles,
    featureAsOfTradingDate: signalDate,
  });
  if (!guard.ok) {
    return { ok: false, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "featureWindow", foldId }) };
  }

  return { ok: true, foldInput };
}

function extractFoldMetrics(pipelineResult) {
  return {
    totalReturn: pipelineResult.totalReturn,
    benchmarkReturn: pipelineResult.benchmarkReturn,
    alpha: pipelineResult.alpha,
  };
}

function assertFiniteOosTriple(totalReturn, benchmarkReturn, alpha, foldId) {
  if (
    !isFiniteNumber(totalReturn)
    || !isFiniteNumber(benchmarkReturn)
    || !isFiniteNumber(alpha)
  ) {
    return makeError(ERROR.OOS_FOLD_FAILED, { foldId, field: "oosMetrics" });
  }
  return null;
}

function blockedStandaloneFold(foldBase, error, extraCodes, failedStage) {
  const objects = [error, makeError(ERROR.OOS_FOLD_FAILED)];
  if (Array.isArray(extraCodes)) {
    for (const code of extraCodes) {
      if (code) objects.push({ code });
    }
  }
  const codes = uniqueCodes(objects);
  return {
    ok: false,
    error,
    failedStage: typeof failedStage === "string" && failedStage.length > 0
      ? failedStage
      : "WALK_FORWARD",
    fold: {
      ...foldBase,
      status: FOLD_STATUS.BLOCKED,
      totalReturn: null,
      benchmarkReturn: null,
      alpha: null,
      errorCodes: codes,
    },
  };
}

function evaluateStandaloneOosFold(input, window, foldBase) {
  const oosDates = input.tradingDates.slice(window.oosStartIndex, window.oosEndIndex + 1);
  const built = buildOosTiles(oosDates);
  if (built.tiles.length < 1) {
    return blockedStandaloneFold(
      foldBase,
      makeError(ERROR.OOS_FOLD_FAILED, { field: "tileCount", foldId: window.foldId }),
    );
  }
  if (built.droppedDates.length > 0) {
    return blockedStandaloneFold(
      foldBase,
      makeError(ERROR.OOS_FOLD_FAILED, { field: "droppedIncompleteTail", foldId: window.foldId }),
    );
  }

  const tileTotals = [];
  const tileBench = [];
  const tileAlpha = [];
  for (let k = 0; k < built.tiles.length; k += 1) {
    const tile = built.tiles[k];
    const pad = padTileIndex(k + 1);
    const tradeId = window.foldId + ":oos:" + pad;
    const buildResult = buildFoldPipelineInput(input, window, input.pipelineBase, tile, tradeId);
    if (!buildResult.ok) {
      return blockedStandaloneFold(foldBase, buildResult.error);
    }

    const foldInput = buildResult.foldInput;
    const slicedBm = sliceBenchmarkForDates(input.benchmarkSeries, tile);
    if (!slicedBm.ok) {
      return blockedStandaloneFold(foldBase, slicedBm.error);
    }
    foldInput.benchmark = {
      market: input.market,
      benchmarkSeries: slicedBm.series,
    };

    const pipelineResult = syntheticPipeline.runSyntheticBenchmarkPipeline(foldInput);
    if (pipelineResult.pipelineStatus !== PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA) {
      const rootErr = Array.isArray(pipelineResult.errors) && pipelineResult.errors.length > 0
        ? pipelineResult.errors[0]
        : makeError(ERROR.OOS_FOLD_FAILED, { foldId: window.foldId });
      const extraCodes = Array.isArray(pipelineResult.errorCodes) ? pipelineResult.errorCodes : [];
      return blockedStandaloneFold(foldBase, rootErr, extraCodes, pipelineResult.failedStage);
    }

    const tileErr = assertFiniteOosTriple(
      pipelineResult.totalReturn,
      pipelineResult.benchmarkReturn,
      pipelineResult.alpha,
      window.foldId,
    );
    if (tileErr) {
      return blockedStandaloneFold(foldBase, tileErr);
    }
    tileTotals.push(pipelineResult.totalReturn);
    tileBench.push(pipelineResult.benchmarkReturn);
    tileAlpha.push(pipelineResult.alpha);
  }

  const meanTotal = assertFiniteEqualWeightedMean(tileTotals);
  const meanBench = assertFiniteEqualWeightedMean(tileBench);
  const meanAlpha = assertFiniteEqualWeightedMean(tileAlpha);
  if (!meanTotal.ok || !meanBench.ok || !meanAlpha.ok) {
    return blockedStandaloneFold(
      foldBase,
      makeError(ERROR.OOS_FOLD_FAILED, { foldId: window.foldId, field: "oosMetrics" }),
    );
  }

  return {
    ok: true,
    fold: {
      ...foldBase,
      status: FOLD_STATUS.COMPLETED,
      totalReturn: meanTotal.mean,
      benchmarkReturn: meanBench.mean,
      alpha: meanAlpha.mean,
      errorCodes: [],
    },
  };
}

function blockedWalkForwardResult(partial) {
  const src = partial || {};
  const errors = Array.isArray(src.errors) ? src.errors.slice() : [];
  if (!errors.some((e) => e && e.code === ERROR.WALK_FORWARD_STAGE_FAILED)) {
    errors.push(makeError(ERROR.WALK_FORWARD_STAGE_FAILED));
  }
  // 7G: copy folds/partialFoldResults so callers cannot mutate the result arrays.
  const folds = Array.isArray(src.folds) ? src.folds.slice() : [];
  const partialFoldResults = Array.isArray(src.partialFoldResults) ? src.partialFoldResults.slice() : folds;
  return {
    walkForwardStatus: WALK_FORWARD_STATUS.BLOCKED,
    market: src.market != null ? src.market : null,
    foldCount: src.foldCount != null ? src.foldCount : 0,
    successfulFoldCount: src.successfulFoldCount != null ? src.successfulFoldCount : 0,
    failedFoldCount: src.failedFoldCount != null ? src.failedFoldCount : 0,
    meanOosTotalReturn: null,
    meanOosBenchmarkReturn: null,
    meanOosAlpha: null,
    aggregateDefinition: AGGREGATE_DEFINITION,
    oosCoverageStart: src.oosCoverageStart != null ? src.oosCoverageStart : null,
    oosCoverageEnd: src.oosCoverageEnd != null ? src.oosCoverageEnd : null,
    droppedIncompleteTail: src.droppedIncompleteTail === true,
    folds,
    officialFolds: [],
    partialFoldResults,
    failedStage: typeof src.failedStage === "string" && src.failedStage.length > 0
      ? src.failedStage
      : "WALK_FORWARD",
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    executionStatus: executionModel.STATUS.NOT_EXECUTED,
    calculationStatus: executionModel.CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    errors,
    errorCodes: uniqueCodes(errors),
  };
}

function completedWalkForwardResult(partial) {
  const src = partial || {};
  return {
    walkForwardStatus: WALK_FORWARD_STATUS.COMPLETED,
    market: src.market,
    foldCount: src.foldCount,
    successfulFoldCount: src.foldCount,
    failedFoldCount: 0,
    meanOosTotalReturn: src.meanOosTotalReturn,
    meanOosBenchmarkReturn: src.meanOosBenchmarkReturn,
    meanOosAlpha: src.meanOosAlpha,
    aggregateDefinition: AGGREGATE_DEFINITION,
    oosCoverageStart: src.oosCoverageStart,
    oosCoverageEnd: src.oosCoverageEnd,
    droppedIncompleteTail: src.droppedIncompleteTail === true,
    folds: src.folds,
    officialFolds: src.folds,
    partialFoldResults: [],
    failedStage: null,
    calendarVerified: false,
    datasetVerified: false,
    costPolicyVerified: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    executionStatus: executionModel.STATUS.NOT_EXECUTED,
    calculationStatus: executionModel.CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    errors: [],
    errorCodes: [],
  };
}

function validateMarket(market) {
  if (typeof market !== "string" || market.length === 0) {
    return makeError(ERROR.INVALID_INPUT, { field: "market" });
  }
  if (market === "SYNTHETIC_MARKET") {
    return makeError(ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE, { field: "market" });
  }
  if (PRODUCTION_MARKETS.has(market)) {
    return makeError(ERROR.PRODUCTION_MARKET_NOT_ALLOWED, { field: "market" });
  }
  if (!ALLOWED_MARKETS.has(market)) {
    return makeError(ERROR.INVALID_INPUT, { field: "market" });
  }
  return null;
}

function runWalkForwardValidation(input) {
  if (!isPlainObject(input)) {
    const err = makeError(ERROR.INVALID_INPUT);
    return blockedWalkForwardResult({ errors: [err] });
  }

  const marketError = validateMarket(input.market);
  if (marketError) {
    return blockedWalkForwardResult({ market: input.market, errors: [marketError] });
  }

  if (!isFiniteNumber(input.initialCapital) || input.initialCapital <= 0) {
    const err = makeError(ERROR.INVALID_INPUT, { field: "initialCapital" });
    return blockedWalkForwardResult({ market: input.market, errors: [err] });
  }

  if (!Array.isArray(input.benchmarkSeries)) {
    const err = makeError(ERROR.INVALID_INPUT, { field: "benchmarkSeries" });
    return blockedWalkForwardResult({ market: input.market, errors: [err] });
  }

  const windowResult = generateWalkForwardWindows({
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    minTrainWindowSize: input.minTrainWindowSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });

  if (!windowResult.ok) {
    return blockedWalkForwardResult({
      market: input.market,
      droppedIncompleteTail: windowResult.droppedIncompleteTail,
      errors: windowResult.errors.slice(),
    });
  }

  if (!isPlainObject(input.pipelineBase)) {
    const err = makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "pipelineBase" });
    return blockedWalkForwardResult({
      market: input.market,
      droppedIncompleteTail: windowResult.droppedIncompleteTail,
      oosCoverageStart: windowResult.windows[0].oosStart,
      oosCoverageEnd: windowResult.windows[windowResult.windows.length - 1].oosEnd,
      errors: [err],
    });
  }

  const folds = [];
  let firstFailureError = null;
  let firstFailureStage = null;

  for (const window of windowResult.windows) {
    const foldBase = {
      foldId: window.foldId,
      trainStart: window.trainStart,
      trainEnd: window.trainEnd,
      oosStart: window.oosStart,
      oosEnd: window.oosEnd,
      trainTradingDayCount: window.trainTradingDayCount,
      oosTradingDayCount: window.oosTradingDayCount,
      embargoTradingDayCount: window.embargoTradingDayCount,
      embargoDates: window.embargoDates,
      embargoStart: window.embargoStart,
      embargoEnd: window.embargoEnd,
      postOosEmbargoTradingDayCount: window.postOosEmbargoTradingDayCount,
      postOosEmbargoDates: window.postOosEmbargoDates,
      postOosEmbargoStart: window.postOosEmbargoStart,
      postOosEmbargoEnd: window.postOosEmbargoEnd,
    };

    const evalResult = evaluateStandaloneOosFold(input, window, foldBase);
    if (!evalResult.ok) {
      if (!firstFailureError) {
        firstFailureError = evalResult.error;
        firstFailureStage = evalResult.failedStage;
      }
      folds.push(evalResult.fold);
      continue;
    }
    folds.push(evalResult.fold);
  }

  const failedFolds = folds.filter((f) => f.status === FOLD_STATUS.BLOCKED);
  if (failedFolds.length > 0) {
    const errors = [];
    if (firstFailureError) errors.push(firstFailureError);
    errors.push(makeError(ERROR.OOS_FOLD_FAILED));
    return blockedWalkForwardResult({
      market: input.market,
      foldCount: folds.length,
      successfulFoldCount: folds.length - failedFolds.length,
      failedFoldCount: failedFolds.length,
      failedStage: firstFailureStage,
      droppedIncompleteTail: windowResult.droppedIncompleteTail,
      oosCoverageStart: windowResult.windows[0].oosStart,
      oosCoverageEnd: windowResult.windows[windowResult.windows.length - 1].oosEnd,
      folds,
      partialFoldResults: folds,
      errors,
    });
  }

  const aggregateBlockedResult = (field) => blockedWalkForwardResult({
    market: input.market,
    foldCount: folds.length,
    successfulFoldCount: folds.filter((f) => f.status === FOLD_STATUS.COMPLETED).length,
    failedFoldCount: 0,
    droppedIncompleteTail: windowResult.droppedIncompleteTail,
    oosCoverageStart: windowResult.windows[0].oosStart,
    oosCoverageEnd: windowResult.windows[windowResult.windows.length - 1].oosEnd,
    folds,
    partialFoldResults: folds,
    errors: [makeError(ERROR.WALK_FORWARD_AGGREGATE_NONFINITE, field != null ? { field } : undefined)],
  });

  const foldCount = folds.length;
  const meanTotal = assertFiniteEqualWeightedMean(folds.map((fold) => fold.totalReturn));
  const meanBench = assertFiniteEqualWeightedMean(folds.map((fold) => fold.benchmarkReturn));
  const meanAlpha = assertFiniteEqualWeightedMean(folds.map((fold) => fold.alpha));
  if (!meanTotal.ok) {
    return aggregateBlockedResult("meanOosTotalReturn");
  }
  if (!meanBench.ok) {
    return aggregateBlockedResult("meanOosBenchmarkReturn");
  }
  if (!meanAlpha.ok) {
    return aggregateBlockedResult("meanOosAlpha");
  }
  const meanOosTotalReturn = meanTotal.mean;
  const meanOosBenchmarkReturn = meanBench.mean;
  const meanOosAlpha = meanAlpha.mean;

  return completedWalkForwardResult({
    market: input.market,
    foldCount,
    meanOosTotalReturn,
    meanOosBenchmarkReturn,
    meanOosAlpha,
    oosCoverageStart: windowResult.windows[0].oosStart,
    oosCoverageEnd: windowResult.windows[windowResult.windows.length - 1].oosEnd,
    droppedIncompleteTail: windowResult.droppedIncompleteTail,
    folds,
  });
}

module.exports = {
  WALK_FORWARD_STATUS,
  FOLD_STATUS,
  ERROR,
  AGGREGATE_DEFINITION,
  TILE_SIZE,
  MAX_COMPLETE_TILE_COUNT,
  generateWalkForwardWindows,
  runWalkForwardValidation,
  blockedWalkForwardResult,
};
