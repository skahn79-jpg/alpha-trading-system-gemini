/**
 * GATE 5O + 5P + 5Q + 5R + 5X — Leakage-Free Train Selection / Frozen OOS Parameters.
 * 5R: pass embargoTradingDayCount into walk-forward windows. Tiling/freeze unchanged.
 * 5T: fold metadata includes postOosEmbargo*. Tiling/freeze unchanged.
 * 5X: one pipeline run per tile; dataset+calendar isolated to that tile's dates.
 * 5Y: each OOS tile benchmarkSeries is sliced to that tile's dates.
 * 5Z: featureWindow asOf = signalTradingDate; execution candles may include entry/exit.
 *     same-day signal fill fail-closed.
 * 6C: train and selection-OOS tile values, sums, and means must be finite (parity with 6B).
 * 6D: equal-weighted tile means go through shared finite-tile-mean helper.
 * 6E: fold-level equal-weighted aggregate also uses the same helper;
 *     helper failure maps to WALK_FORWARD_AGGREGATE_NONFINITE.
 * 6F: fold-aggregate error.field is meanOosTotalReturn / meanOosBenchmarkReturn / meanOosAlpha
 *     in both selection and standalone walk-forward.
 * 6G: freeze the 6B-6F finite-mean chapter. Helper usage, meanOos* fields, and
 *     overflow identities stay pinned. No helper reason/stage.
 * 6H: unify makeError via shared makeBacktestError. Severity default ERROR.
 *     Known extras only. No official codes in the helper.
 * 6I: freeze the 6H makeError unification. Shared helper, known extras,
 *     and overflow identities stay pinned. Other modules stay private.
 * 6U-R3: train pipeline non-complete keeps the nested root as error (clone
 *     via makeBacktestError extras; fill candidateId/foldId only if missing).
 *     Fold errorCodes uniqueCodes([root, TRAIN_CANDIDATE_EVALUATION_FAILED,
 *     TRAIN_SELECTION_STAGE_FAILED]). failedStage stays TRAIN_SELECTION.
 *     First-failure-wins unchanged. Do not cover nested root with cause.
 * 6V freeze: train nested root stays errorCodes[0]; TRAIN_CANDIDATE_EVALUATION_FAILED
 *     after the root; failedStage stays TRAIN_SELECTION; first-failure-wins stays.
 * 6W: OOS build-input failures keep the nested child as error (clone via
 *     makeBacktestError extras; fill foldId only if missing). Do not cover
 *     the child with OOS_FOLD_FAILED + cause.
 * 7K freeze: blockedSelectionResult slices folds/partialFoldResults (7H).
 *     completedSelectionResult shares one folds copy with officialFolds (7J).
 *     Do not unify blocked officialFolds=[] with completed shared copy.
 * 7M: foldBase copies embargoDates and postOosEmbargoDates from the window.
 * 7N freeze: pin 7L/7M foldBase embargoDates and postOosEmbargoDates copies.
 *     Do not also slice at generateWalkForwardWindows.
 * 순수 CommonJS. I/O / network / order 없음.
 */

"use strict";

const { parseYmd } = require("./schemas");
const syntheticPipeline = require("./synthetic-pipeline");
const { PIPELINE_STATUS } = syntheticPipeline;
const {
  EXACT_CALENDAR_MEMBERSHIP,
  computeDatasetContentChecksum,
  computeDatasetMetadataHash,
} = require("./data-validation");
const executionModel = require("./execution-model");
const { assertFiniteEqualWeightedMean } = require("./finite-tile-mean");
const { makeBacktestError: makeError } = require("./make-error");
const walkForward = require("./walk-forward-validation");
const leakageGuard = require("./leakage-guard");

const SELECTION_METRIC = "TRAIN_TOTAL_RETURN";
const SELECTION_TIE_BREAK = "CANDIDATE_ID_ASC";
const TILE_SIZE = walkForward.TILE_SIZE;
const MAX_COMPLETE_TILE_COUNT = walkForward.MAX_COMPLETE_TILE_COUNT;
const SELECTION_EVALUATION_POLICY = "NONOVERLAPPING_THREE_BAR_TILES";

const SELECTION_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_TRAIN_SELECTION",
  BLOCKED: "BLOCKED_TRAIN_SELECTION",
});

const FOLD_STATUS = Object.freeze({
  COMPLETED: "COMPLETED_OOS_FOLD",
  BLOCKED: "BLOCKED_OOS_FOLD",
});

const ERROR = Object.freeze({
  INVALID_PARAMETER_CANDIDATES: "INVALID_PARAMETER_CANDIDATES",
  TRAIN_CANDIDATE_EVALUATION_FAILED: "TRAIN_CANDIDATE_EVALUATION_FAILED",
  TRAIN_SELECTION_FAILED: "TRAIN_SELECTION_FAILED",
  TRAIN_SELECTION_NONFINITE: "TRAIN_SELECTION_NONFINITE",
  OOS_EVALUATION_NONFINITE: "OOS_EVALUATION_NONFINITE",
  PARAMETER_FREEZE_FAILED: "PARAMETER_FREEZE_FAILED",
  TRAIN_SELECTION_STAGE_FAILED: "TRAIN_SELECTION_STAGE_FAILED",
  INVALID_WALK_FORWARD_CONFIG: walkForward.ERROR.INVALID_WALK_FORWARD_CONFIG,
  INVALID_INPUT: walkForward.ERROR.INVALID_INPUT,
  INSUFFICIENT_WALK_FORWARD_DATA: walkForward.ERROR.INSUFFICIENT_WALK_FORWARD_DATA,
  INSUFFICIENT_WALK_FORWARD_FOLDS: walkForward.ERROR.INSUFFICIENT_WALK_FORWARD_FOLDS,
  WALK_FORWARD_DATE_MISMATCH: walkForward.ERROR.WALK_FORWARD_DATE_MISMATCH,
  WALK_FORWARD_OVERLAP_DETECTED: walkForward.ERROR.WALK_FORWARD_OVERLAP_DETECTED,
  OOS_FOLD_FAILED: walkForward.ERROR.OOS_FOLD_FAILED,
  WALK_FORWARD_STAGE_FAILED: walkForward.ERROR.WALK_FORWARD_STAGE_FAILED,
  WALK_FORWARD_AGGREGATE_NONFINITE: walkForward.ERROR.WALK_FORWARD_AGGREGATE_NONFINITE,
  PRODUCTION_MARKET_NOT_ALLOWED: walkForward.ERROR.PRODUCTION_MARKET_NOT_ALLOWED,
  LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE: walkForward.ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE,
});

const CANDIDATE_ALLOWED_KEYS = new Set(["id", "stopLossPrice", "takeProfitPrice"]);
const ALLOWED_MARKETS = new Set(["SYNTHETIC_KOSPI", "SYNTHETIC_KOSDAQ"]);
const PRODUCTION_MARKETS = new Set(["KOSPI", "KOSDAQ", "KRX", "NASDAQ", "NYSE"]);
const AGGREGATE_DEFINITION = "EQUAL_WEIGHTED_FOLD_MEAN";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidPrice(value) {
  return isFiniteNumber(value) && value > 0;
}

function deepClonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreezePlain(value) {
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  for (const nested of Object.values(value)) {
    deepFreezePlain(nested);
  }
  return Object.freeze(value);
}

function captureFirstFailure(current, {
  foldId,
  rootError,
  failedStage,
  stageSummary,
}) {
  if (current) return current;
  const rootErrorSnapshot = deepFreezePlain(deepClonePlain(rootError));
  const stageSummarySnapshot = deepFreezePlain(deepClonePlain(stageSummary));
  return Object.freeze({
    foldId,
    rootError: rootErrorSnapshot,
    failedStage,
    stageSummary: stageSummarySnapshot,
  });
}

function cloneNestedRootError(nested, fallbackCode, fill) {
  const extra = isPlainObject(nested) ? Object.assign({}, nested) : {};
  if (isPlainObject(fill)) {
    for (const key of Object.keys(fill)) {
      if (extra[key] == null) extra[key] = fill[key];
    }
  }
  const code = nested && nested.code != null && String(nested.code).length > 0
    ? nested.code
    : fallbackCode;
  return makeError(code, extra);
}

function uniqueCodes(errors) {
  const out = [];
  const seen = new Set();
  for (const e of errors || []) {
    if (!e || e.code == null) continue;
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e.code);
  }
  return out;
}

/** Deterministic string compare (code-unit ascending). */
function compareCandidateIdAsc(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

function padTileIndex(k) {
  if (!Number.isInteger(k) || k < 1) return null;
  if (k < 100) return "T" + String(k).padStart(2, "0");
  return "T" + String(k);
}

function buildTrainTiles(trainDates) {
  const dates = Array.isArray(trainDates) ? trainDates : [];
  const tiles = [];
  let i = 0;
  while (i + TILE_SIZE <= dates.length && tiles.length < MAX_COMPLETE_TILE_COUNT) {
    tiles.push([dates[i], dates[i + 1], dates[i + 2]]);
    i += TILE_SIZE;
  }
  const droppedDates = dates.slice(tiles.length * TILE_SIZE);
  return { tiles, droppedDates };
}

function sanitizeDatasetEnvelope(dataset) {
  if (!isPlainObject(dataset)) return dataset;
  if (Object.hasOwn(dataset, "market")) {
    delete dataset.market;
  }
  return dataset;
}

function buildDateSet(dates) {
  const set = new Set();
  for (const raw of dates) {
    const parsed = parseYmd(raw);
    if (parsed.ok) set.add(parsed.date);
  }
  return set;
}

function isInDateSet(tradingDate, dateSet) {
  const parsed = parseYmd(tradingDate);
  if (!parsed.ok) return false;
  return dateSet.has(parsed.date);
}



function sliceFeatureWindow(candles, signalDate) {
  const parsedSignal = parseYmd(signalDate);
  if (!parsedSignal.ok) {
    return { ok: false, candles: [], error: makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, { field: "featureWindow" }) };
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

function assertCausalTradeTiming(tradeIntent, allowedDates, failCode, tradeId) {
  const code = failCode;
  const extra = tradeId != null ? { field: "tradeIntents", tradeId } : { field: "tradeIntents" };
  if (!isPlainObject(tradeIntent) || !isPlainObject(tradeIntent.entryIntent)) {
    return { ok: false, error: makeError(code, extra) };
  }
  const allowed = buildDateSet(allowedDates);
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
  const allowed = buildDateSet(allowedDates);
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
function sliceDatasetForDates(dataset, periodDates) {
  const dateSet = buildDateSet(periodDates);
  const periodStart = periodDates.length > 0 ? periodDates[0] : null;
  const periodEnd = periodDates.length > 0 ? periodDates[periodDates.length - 1] : null;
  const cloned = sanitizeDatasetEnvelope(deepClonePlain(dataset));
  const candles = (cloned.candles || []).filter(
    (c) => c && isInDateSet(c.tradingDate, dateSet),
  );
  cloned.candles = candles;
  if (candles.length === 0) {
    cloned.coverage = { from: periodStart, to: periodEnd };
    if (cloned.perSymbolCoverage) {
      const next = {};
      for (const sym of Object.keys(cloned.perSymbolCoverage)) {
        next[sym] = { from: periodStart, to: periodEnd };
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

function sliceCalendarForDates(calendar, periodDates) {
  const cloned = deepClonePlain(calendar);
  const dateSet = buildDateSet(periodDates);
  const canonicalDates = [];
  for (const raw of periodDates) {
    const parsed = parseYmd(raw);
    if (parsed.ok && !canonicalDates.includes(parsed.date)) canonicalDates.push(parsed.date);
  }
  const periodStart = canonicalDates.length > 0 ? canonicalDates[0] : null;
  const periodEnd = canonicalDates.length > 0 ? canonicalDates[canonicalDates.length - 1] : null;

  const byDate = new Map();
  for (const d of cloned.days || []) {
    if (!d) continue;
    const parsed = parseYmd(d.tradingDate);
    if (!parsed.ok) continue;
    if (!dateSet.has(parsed.date)) continue;
    byDate.set(parsed.date, d);
  }

  // Synthesize deterministic TRADING_DAY only for missing canonical periodDates.
  for (const date of canonicalDates) {
    if (byDate.has(date)) continue;
    byDate.set(date, {
      tradingDate: date,
      dayStatus: "TRADING_DAY",
      sessionStatus: "FINAL",
      statusSource: "SYNTHETIC_EXPLICIT",
      market: cloned.market,
      calendarId: cloned.calendarId,
    });
  }

  cloned.days = canonicalDates.map((date) => byDate.get(date));
  cloned.coverage = { from: periodStart, to: periodEnd };
  Object.defineProperty(cloned, EXACT_CALENDAR_MEMBERSHIP, {
    value: true,
    enumerable: false,
  });
  return cloned;
}

function freezeSelectedParameters(parameters) {
  if (!isPlainObject(parameters)) {
    return { ok: false, error: makeError(ERROR.PARAMETER_FREEZE_FAILED, { field: "parameters" }) };
  }
  if (!isValidPrice(parameters.stopLossPrice) || !isValidPrice(parameters.takeProfitPrice)) {
    return { ok: false, error: makeError(ERROR.PARAMETER_FREEZE_FAILED, { field: "price" }) };
  }
  const snapshot = Object.freeze({
    stopLossPrice: parameters.stopLossPrice,
    takeProfitPrice: parameters.takeProfitPrice,
    intrabarConflictPolicy: "STOP_FIRST",
  });
  return { ok: true, snapshot };
}

/**
 * Validate explicit parameterCandidates. No auto-generation.
 * Minimum 2 candidates. Immutable copy returned on success.
 */
function validateParameterCandidates(parameterCandidates) {
  if (parameterCandidates == null) {
    return {
      ok: false,
      error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "parameterCandidates", reason: "MISSING" }),
    };
  }
  if (!Array.isArray(parameterCandidates)) {
    return {
      ok: false,
      error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "parameterCandidates", reason: "NOT_ARRAY" }),
    };
  }
  if (parameterCandidates.length === 0) {
    return {
      ok: false,
      error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "parameterCandidates", reason: "EMPTY" }),
    };
  }
  if (parameterCandidates.length < 2) {
    return {
      ok: false,
      error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "parameterCandidates", reason: "MIN_TWO" }),
    };
  }

  const seenIds = new Set();
  const normalized = [];

  for (let i = 0; i < parameterCandidates.length; i += 1) {
    const raw = parameterCandidates[i];
    if (!isPlainObject(raw)) {
      return {
        ok: false,
        error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "candidate", index: i, reason: "NOT_OBJECT" }),
      };
    }
    for (const key of Object.keys(raw)) {
      if (!CANDIDATE_ALLOWED_KEYS.has(key)) {
        return {
          ok: false,
          error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, {
            field: key,
            index: i,
            reason: "UNSUPPORTED_FIELD",
          }),
        };
      }
    }
    if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.trim() !== raw.id || raw.id.trim() === "") {
      return {
        ok: false,
        error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "id", index: i, reason: "BLANK_OR_INVALID_ID" }),
      };
    }
    if (seenIds.has(raw.id)) {
      return {
        ok: false,
        error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, { field: "id", index: i, reason: "DUPLICATE_ID" }),
      };
    }
    seenIds.add(raw.id);
    if (!isValidPrice(raw.stopLossPrice)) {
      return {
        ok: false,
        error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, {
          field: "stopLossPrice",
          index: i,
          reason: "INVALID_PRICE",
        }),
      };
    }
    if (!isValidPrice(raw.takeProfitPrice)) {
      return {
        ok: false,
        error: makeError(ERROR.INVALID_PARAMETER_CANDIDATES, {
          field: "takeProfitPrice",
          index: i,
          reason: "INVALID_PRICE",
        }),
      };
    }
    normalized.push({
      id: raw.id,
      stopLossPrice: raw.stopLossPrice,
      takeProfitPrice: raw.takeProfitPrice,
    });
  }

  return { ok: true, candidates: deepClonePlain(normalized) };
}

/**
 * Pure deterministic winner selection from completed train evaluations.
 * Does not use OOS / benchmark / alpha.
 */
function selectWinnerFromTrainEvaluations(evaluations) {
  if (!Array.isArray(evaluations) || evaluations.length === 0) {
    return {
      ok: false,
      error: makeError(ERROR.TRAIN_SELECTION_FAILED, { reason: "EMPTY_EVALUATIONS" }),
    };
  }

  for (const ev of evaluations) {
    if (!ev || ev.status !== "COMPLETED") {
      return {
        ok: false,
        error: makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, {
          candidateId: ev && ev.candidateId != null ? ev.candidateId : null,
        }),
      };
    }
    if (!isFiniteNumber(ev.trainTotalReturn)) {
      return {
        ok: false,
        error: makeError(ERROR.TRAIN_SELECTION_NONFINITE, {
          candidateId: ev.candidateId,
          field: "trainTotalReturn",
        }),
      };
    }
  }

  let winner = evaluations[0];
  for (let i = 1; i < evaluations.length; i += 1) {
    const ev = evaluations[i];
    if (ev.trainTotalReturn > winner.trainTotalReturn) {
      winner = ev;
    } else if (ev.trainTotalReturn === winner.trainTotalReturn) {
      if (compareCandidateIdAsc(ev.candidateId, winner.candidateId) < 0) {
        winner = ev;
      }
    }
  }

  const freezeResult = freezeSelectedParameters({
    stopLossPrice: winner.stopLossPrice,
    takeProfitPrice: winner.takeProfitPrice,
  });
  if (!freezeResult.ok) {
    return { ok: false, error: freezeResult.error };
  }

  const sortedEvidence = buildCandidateEvidence(evaluations);

  return {
    ok: true,
    selectedCandidateId: winner.candidateId,
    selectionScore: winner.trainTotalReturn,
    selectionMetric: SELECTION_METRIC,
    selectionTieBreak: SELECTION_TIE_BREAK,
    selectedParameters: freezeResult.snapshot,
    parameterFrozen: true,
    candidateEvaluations: sortedEvidence,
  };
}

function freezeEvidenceRow(ev) {
  return Object.freeze({
    candidateId: ev.candidateId,
    stopLossPrice: ev.stopLossPrice,
    takeProfitPrice: ev.takeProfitPrice,
    trainTotalReturn: ev.trainTotalReturn,
    status: ev.status,
  });
}

function buildCandidateEvidence(evaluations) {
  return Object.freeze(
    (evaluations || [])
      .slice()
      .sort((a, b) => compareCandidateIdAsc(a.candidateId, b.candidateId))
      .map((ev) => freezeEvidenceRow(ev)),
  );
}

function selectionEvaluationMeta(trainDates) {
  const built = buildTrainTiles(trainDates);
  const complete = built.tiles;
  const dropped = built.droppedDates;
  const has = complete.length >= 1;
  const lastTile = has ? complete[complete.length - 1] : null;
  return {
    selectionEvaluationPolicy: SELECTION_EVALUATION_POLICY,
    selectionTradeCount: complete.length,
    selectionEvaluationTradingDayCount: complete.length * TILE_SIZE,
    selectionEvaluationStart: has ? complete[0][0] : null,
    selectionEvaluationEnd: has ? lastTile[2] : null,
    selectionDroppedTailTradingDayCount: dropped.length,
    selectionDroppedTailDates: Object.freeze(dropped.slice()),
  };
}

function oosEvaluationMeta(oosDates) {
  const built = buildTrainTiles(oosDates);
  const complete = built.tiles;
  const dropped = built.droppedDates;
  const has = complete.length >= 1;
  const lastTile = has ? complete[complete.length - 1] : null;
  return {
    oosTradeCount: complete.length,
    oosEvaluationTradingDayCount: complete.length * TILE_SIZE,
    oosEvaluationStart: has ? complete[0][0] : null,
    oosEvaluationEnd: has ? lastTile[2] : null,
    oosDroppedTailTradingDayCount: dropped.length,
    oosDroppedTailDates: Object.freeze(dropped.slice()),
  };
}


function buildPeriodTradeIntent(periodDates, templateIntent, tradeId, exitPolicy, failCode) {
  const code = failCode || ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED;
  if (periodDates.length < 3) {
    return {
      ok: false,
      error: makeError(code, { field: "periodDates", tradeId }),
    };
  }
  // Fixed 3-bar evaluation: signal/entry/exitDate as latest-allowed deadline.
  // exitDate is a deadline; actual exit date/price come from authoritative execution
  // (early SL/TP accepted under EXIT_DATE_MODE.LATEST_ALLOWED).
  const signal = periodDates[0];
  const entry = periodDates[1];
  const exit = periodDates[2];
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
  return {
    ok: true,
    tradeIntent: {
      tradeId,
      quantity,
      entryDate: entry,
      exitDate: exit,
      exitDateMode: "LATEST_ALLOWED",
      entryIntent,
      exitPolicy: deepClonePlain(exitPolicy),
    },
  };
}

function buildPeriodPipelineInput(pipelineBase, periodDates, periodStart, periodEnd, exitPolicy, tradeId, initialCapital, failCode) {
  const code = failCode || ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED;
  const templateIntent = Array.isArray(pipelineBase.tradeIntents) && pipelineBase.tradeIntents.length > 0
    ? pipelineBase.tradeIntents[0]
    : null;
  const tradeResult = buildPeriodTradeIntent(periodDates, templateIntent, tradeId, exitPolicy, code);
  if (!tradeResult.ok) {
    return { ok: false, error: tradeResult.error };
  }

  const foldInput = deepClonePlain(pipelineBase);
  foldInput.dataset = sliceDatasetForDates(pipelineBase.dataset, periodDates);
  foldInput.calendar = sliceCalendarForDates(pipelineBase.calendar, periodDates);
  const timing = assertCausalTradeTiming(tradeResult.tradeIntent, periodDates, code, tradeId);
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
    const nested = Array.isArray(guard.errors) && guard.errors.length > 0
      ? guard.errors[0]
      : null;
    return {
      ok: false,
      error: cloneNestedRootError(nested, code, { field: "featureWindow", tradeId }),
    };
  }
  foldInput.calendarValidation = {
    ...(isPlainObject(pipelineBase.calendarValidation) ? deepClonePlain(pipelineBase.calendarValidation) : {}),
    requiredFrom: periodStart,
    requiredTo: periodEnd,
  };
  foldInput.tradeIntents = [tradeResult.tradeIntent];
  foldInput.initialCapital = initialCapital;
  if (Object.hasOwn(foldInput, "benchmark")) {
    delete foldInput.benchmark;
  }
  return { ok: true, foldInput };
}

function buildTrainPipelineInput(pipelineBase, trainDates, periodStart, periodEnd, exitPolicy, foldId, candidateId, initialCapital) {
  const templateIntent = Array.isArray(pipelineBase.tradeIntents) && pipelineBase.tradeIntents.length > 0
    ? pipelineBase.tradeIntents[0]
    : null;
  const built = buildTrainTiles(trainDates);
  if (built.tiles.length < 1) {
    return { ok: false, error: makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, { field: "tileCount", foldId, candidateId }) };
  }
  const tradeIntents = [];
  for (let k = 0; k < built.tiles.length; k += 1) {
    const tile = built.tiles[k];
    const pad = padTileIndex(k + 1);
    const tradeResult = buildPeriodTradeIntent(tile, templateIntent, foldId + ":" + candidateId + ":train:" + pad, exitPolicy);
    if (!tradeResult.ok) return { ok: false, error: tradeResult.error };
    tradeIntents.push(tradeResult.tradeIntent);
  }
  const seen = new Set();
  for (const intent of tradeIntents) {
    if (seen.has(intent.tradeId)) {
      return { ok: false, error: makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, { field: "tradeId", reason: "DUPLICATE" }) };
    }
    seen.add(intent.tradeId);
  }
  const foldInput = deepClonePlain(pipelineBase);
  foldInput.dataset = sliceDatasetForDates(pipelineBase.dataset, trainDates);
  foldInput.calendar = sliceCalendarForDates(pipelineBase.calendar, trainDates);
  foldInput.calendarValidation = {
    ...(isPlainObject(pipelineBase.calendarValidation) ? deepClonePlain(pipelineBase.calendarValidation) : {}),
    requiredFrom: periodStart,
    requiredTo: periodEnd,
  };
  foldInput.tradeIntents = tradeIntents;
  foldInput.initialCapital = initialCapital;
  if (Object.hasOwn(foldInput, "benchmark")) delete foldInput.benchmark;
  return { ok: true, foldInput };
}

function buildOosPipelineInput(pipelineBase, oosDates, periodStart, periodEnd, exitPolicy, foldId, initialCapital) {
  const templateIntent = Array.isArray(pipelineBase.tradeIntents) && pipelineBase.tradeIntents.length > 0
    ? pipelineBase.tradeIntents[0]
    : null;
  const built = buildTrainTiles(oosDates);
  if (built.tiles.length < 1) {
    return { ok: false, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "tileCount", foldId }) };
  }
  const tradeIntents = [];
  for (let k = 0; k < built.tiles.length; k += 1) {
    const tile = built.tiles[k];
    const pad = padTileIndex(k + 1);
    const tradeResult = buildPeriodTradeIntent(tile, templateIntent, foldId + ":oos:" + pad, exitPolicy);
    if (!tradeResult.ok) {
      return {
        ok: false,
        error: cloneNestedRootError(tradeResult.error, ERROR.OOS_FOLD_FAILED, { foldId }),
      };
    }
    tradeIntents.push(tradeResult.tradeIntent);
  }
  const seen = new Set();
  for (const intent of tradeIntents) {
    if (seen.has(intent.tradeId)) {
      return { ok: false, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "tradeId", reason: "DUPLICATE", foldId }) };
    }
    seen.add(intent.tradeId);
  }
  const foldInput = deepClonePlain(pipelineBase);
  foldInput.dataset = sliceDatasetForDates(pipelineBase.dataset, oosDates);
  foldInput.calendar = sliceCalendarForDates(pipelineBase.calendar, oosDates);
  foldInput.calendarValidation = {
    ...(isPlainObject(pipelineBase.calendarValidation) ? deepClonePlain(pipelineBase.calendarValidation) : {}),
    requiredFrom: periodStart,
    requiredTo: periodEnd,
  };
  foldInput.tradeIntents = tradeIntents;
  foldInput.initialCapital = initialCapital;
  if (Object.hasOwn(foldInput, "benchmark")) delete foldInput.benchmark;
  return { ok: true, foldInput };
}

function evaluateTrainCandidate(args) {
  const {
    candidate,
    trainDates,
    trainStart,
    trainEnd,
    pipelineBase,
    initialCapital,
    foldId,
    hooks,
  } = args;

  const exitPolicy = {
    stopLossPrice: candidate.stopLossPrice,
    takeProfitPrice: candidate.takeProfitPrice,
    intrabarConflictPolicy: "STOP_FIRST",
  };
  const blockedEval = {
    candidateId: candidate.id,
    trainTotalReturn: null,
    status: "BLOCKED",
    stopLossPrice: candidate.stopLossPrice,
    takeProfitPrice: candidate.takeProfitPrice,
  };
  const built = buildTrainTiles(trainDates);
  if (built.tiles.length < 1) {
    return {
      ok: false,
      evaluation: blockedEval,
      error: makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED, { field: "tileCount", foldId, candidateId: candidate.id }),
    };
  }

  if (hooks && typeof hooks.onTrainPipelineCall === "function") {
    hooks.onTrainPipelineCall({ foldId, candidateId: candidate.id });
  }

  const tileReturns = [];
  for (let k = 0; k < built.tiles.length; k += 1) {
    const tile = built.tiles[k];
    const pad = padTileIndex(k + 1);
    const tradeId = foldId + ":" + candidate.id + ":train:" + pad;
    const build = buildPeriodPipelineInput(
      pipelineBase,
      tile,
      tile[0],
      tile[2],
      exitPolicy,
      tradeId,
      initialCapital,
      ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED,
    );
    if (!build.ok) {
      return { ok: false, evaluation: blockedEval, error: build.error };
    }

    const pipelineResult = syntheticPipeline.runSyntheticPerformancePipeline(build.foldInput);
    if (pipelineResult.pipelineStatus !== PIPELINE_STATUS.COMPLETED_PERFORMANCE_METRICS) {
      const nested = Array.isArray(pipelineResult.errors) && pipelineResult.errors.length > 0
        ? pipelineResult.errors[0]
        : null;
      const extra = isPlainObject(nested) ? Object.assign({}, nested) : {};
      if (extra.candidateId == null) extra.candidateId = candidate.id;
      if (extra.foldId == null) extra.foldId = foldId;
      const code = nested && nested.code != null && String(nested.code).length > 0
        ? nested.code
        : ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED;
      return {
        ok: false,
        evaluation: blockedEval,
        error: makeError(code, extra),
      };
    }

    if (!isFiniteNumber(pipelineResult.totalReturn)) {
      // 7A: do not copy nonfinite tile return into candidate evidence.
      return {
        ok: false,
        evaluation: blockedEval,
        error: makeError(ERROR.TRAIN_SELECTION_NONFINITE, {
          candidateId: candidate.id,
          field: "trainTotalReturn",
        }),
      };
    }
    tileReturns.push(pipelineResult.totalReturn);
  }

  const meanResult = assertFiniteEqualWeightedMean(tileReturns);
  if (!meanResult.ok) {
    return {
      ok: false,
      evaluation: {
        candidateId: candidate.id,
        trainTotalReturn: null,
        status: "BLOCKED",
        stopLossPrice: candidate.stopLossPrice,
        takeProfitPrice: candidate.takeProfitPrice,
      },
      error: makeError(ERROR.TRAIN_SELECTION_NONFINITE, {
        candidateId: candidate.id,
        field: "trainTotalReturn",
      }),
    };
  }
  const trainTotalReturn = meanResult.mean;

  return {
    ok: true,
    evaluation: {
      candidateId: candidate.id,
      trainTotalReturn,
      status: "COMPLETED",
      stopLossPrice: candidate.stopLossPrice,
      takeProfitPrice: candidate.takeProfitPrice,
    },
  };
}

function runOosWithFrozenParameters(args) {
  const {
    selectedParameters,
    oosDates,
    oosStart,
    oosEnd,
    pipelineBase,
    initialCapital,
    market,
    benchmarkSeries,
    foldId,
    hooks,
  } = args;

  const built = buildTrainTiles(oosDates);
  if (built.tiles.length < 1) {
    return { ok: false, error: makeError(ERROR.OOS_FOLD_FAILED, { field: "tileCount", foldId }) };
  }

  if (hooks && typeof hooks.onOosPipelineCall === "function") {
    hooks.onOosPipelineCall({ foldId });
  }

  const tileTotals = [];
  const tileBench = [];
  const tileAlpha = [];
  for (let k = 0; k < built.tiles.length; k += 1) {
    const tile = built.tiles[k];
    const pad = padTileIndex(k + 1);
    const tradeId = foldId + ":oos:" + pad;
    const build = buildPeriodPipelineInput(
      pipelineBase,
      tile,
      tile[0],
      tile[2],
      selectedParameters,
      tradeId,
      initialCapital,
      ERROR.OOS_FOLD_FAILED,
    );
    if (!build.ok) {
      return {
        ok: false,
        error: cloneNestedRootError(build.error, ERROR.OOS_FOLD_FAILED, { foldId }),
      };
    }

    const foldInput = build.foldInput;
    const slicedBm = sliceBenchmarkForDates(benchmarkSeries, tile);
    if (!slicedBm.ok) {
      return { ok: false, error: slicedBm.error };
    }
    foldInput.benchmark = {
      market,
      benchmarkSeries: slicedBm.series,
    };

    const pipelineResult = syntheticPipeline.runSyntheticBenchmarkPipeline(foldInput);
    if (pipelineResult.pipelineStatus !== PIPELINE_STATUS.COMPLETED_BENCHMARK_ALPHA) {
      const rootErr = Array.isArray(pipelineResult.errors) && pipelineResult.errors.length > 0
        ? pipelineResult.errors[0]
        : makeError(ERROR.OOS_FOLD_FAILED, { foldId });
      return { ok: false, error: rootErr, pipelineResult };
    }

    if (
      !isFiniteNumber(pipelineResult.totalReturn)
      || !isFiniteNumber(pipelineResult.benchmarkReturn)
      || !isFiniteNumber(pipelineResult.alpha)
    ) {
      return {
        ok: false,
        error: makeError(ERROR.OOS_EVALUATION_NONFINITE, { foldId, field: "oosMetrics" }),
      };
    }
    tileTotals.push(pipelineResult.totalReturn);
    tileBench.push(pipelineResult.benchmarkReturn);
    tileAlpha.push(pipelineResult.alpha);
  }

  const meanTotal = assertFiniteEqualWeightedMean(tileTotals);
  const meanBench = assertFiniteEqualWeightedMean(tileBench);
  const meanAlpha = assertFiniteEqualWeightedMean(tileAlpha);
  if (!meanTotal.ok || !meanBench.ok || !meanAlpha.ok) {
    return {
      ok: false,
      error: makeError(ERROR.OOS_EVALUATION_NONFINITE, { foldId, field: "oosMetrics" }),
    };
  }

  return {
    ok: true,
    totalReturn: meanTotal.mean,
    benchmarkReturn: meanBench.mean,
    alpha: meanAlpha.mean,
  };
}

// GATE 9I freeze: selection public result uses walkForwardStatus plus selectionStatus. Do not add generic ok.
function blockedSelectionResult(partial) {
  const src = partial || {};
  const errors = Array.isArray(src.errors) ? src.errors.slice() : [];
  const failedStage = src.failedStage != null ? src.failedStage : "TRAIN_SELECTION";
  if (
    failedStage === "TRAIN_SELECTION"
    && !errors.some((e) => e && e.code === ERROR.TRAIN_SELECTION_STAGE_FAILED)
  ) {
    errors.push(makeError(ERROR.TRAIN_SELECTION_STAGE_FAILED));
  }
  if (!errors.some((e) => e && e.code === ERROR.WALK_FORWARD_STAGE_FAILED)) {
    errors.push(makeError(ERROR.WALK_FORWARD_STAGE_FAILED));
  }
  // 7H: copy folds/partialFoldResults so callers cannot mutate the result arrays.
  const folds = Array.isArray(src.folds) ? src.folds.slice() : [];
  const partialFoldResults = Array.isArray(src.partialFoldResults) ? src.partialFoldResults.slice() : folds;
  return {
    walkForwardStatus: walkForward.WALK_FORWARD_STATUS.BLOCKED,
    selectionStatus: SELECTION_STATUS.BLOCKED,
    market: src.market != null ? src.market : null,
    foldCount: src.foldCount != null ? src.foldCount : 0,
    successfulFoldCount: src.successfulFoldCount != null ? src.successfulFoldCount : 0,
    failedFoldCount: src.failedFoldCount != null ? src.failedFoldCount : 0,
    meanOosTotalReturn: null,
    meanOosBenchmarkReturn: null,
    meanOosAlpha: null,
    aggregateDefinition: AGGREGATE_DEFINITION,
    selectionMetric: SELECTION_METRIC,
    selectionTieBreak: SELECTION_TIE_BREAK,
    oosCoverageStart: src.oosCoverageStart != null ? src.oosCoverageStart : null,
    oosCoverageEnd: src.oosCoverageEnd != null ? src.oosCoverageEnd : null,
    droppedIncompleteTail: src.droppedIncompleteTail === true,
    folds,
    officialFolds: [],
    partialFoldResults,
    failedStage,
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

function completedSelectionResult(partial) {
  const src = partial || {};
  // 7J: copy folds/officialFolds so callers cannot mutate the result arrays.
  const folds = Array.isArray(src.folds) ? src.folds.slice() : [];
  return {
    walkForwardStatus: walkForward.WALK_FORWARD_STATUS.COMPLETED,
    selectionStatus: SELECTION_STATUS.COMPLETED,
    market: src.market,
    foldCount: src.foldCount,
    successfulFoldCount: src.foldCount,
    failedFoldCount: 0,
    meanOosTotalReturn: src.meanOosTotalReturn,
    meanOosBenchmarkReturn: src.meanOosBenchmarkReturn,
    meanOosAlpha: src.meanOosAlpha,
    aggregateDefinition: AGGREGATE_DEFINITION,
    selectionMetric: SELECTION_METRIC,
    selectionTieBreak: SELECTION_TIE_BREAK,
    oosCoverageStart: src.oosCoverageStart,
    oosCoverageEnd: src.oosCoverageEnd,
    droppedIncompleteTail: src.droppedIncompleteTail === true,
    folds,
    officialFolds: folds,
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
    return { ok: false, error: makeError(ERROR.INVALID_INPUT, { field: "market" }) };
  }
  if (market === "SYNTHETIC_MARKET") {
    return { ok: false, error: makeError(ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_PIPELINE, { field: "market" }) };
  }
  if (PRODUCTION_MARKETS.has(market)) {
    return { ok: false, error: makeError(ERROR.PRODUCTION_MARKET_NOT_ALLOWED, { field: "market" }) };
  }
  if (!ALLOWED_MARKETS.has(market)) {
    return { ok: false, error: makeError(ERROR.INVALID_INPUT, { field: "market" }) };
  }
  return { ok: true };
}

/**
 * Walk-forward with per-fold train-only selection and frozen OOS.
 * N × Train + 1 × OOS per fold. No OOS feedback / no warm-start.
 */
function runWalkForwardTrainParameterSelection(input) {
  if (!isPlainObject(input)) {
    return blockedSelectionResult({
      errors: [makeError(ERROR.INVALID_INPUT)],
    });
  }

  const marketCheck = validateMarket(input.market);
  if (!marketCheck.ok) {
    return blockedSelectionResult({ market: input.market, errors: [marketCheck.error] });
  }

  if (!isFiniteNumber(input.initialCapital) || input.initialCapital <= 0) {
    return blockedSelectionResult({
      market: input.market,
      errors: [makeError(ERROR.INVALID_INPUT, { field: "initialCapital" })],
    });
  }

  if (!Array.isArray(input.benchmarkSeries)) {
    return blockedSelectionResult({
      market: input.market,
      errors: [makeError(ERROR.INVALID_INPUT, { field: "benchmarkSeries" })],
    });
  }

  if (!isPlainObject(input.pipelineBase)) {
    return blockedSelectionResult({
      market: input.market,
      errors: [makeError(ERROR.INVALID_WALK_FORWARD_CONFIG, { field: "pipelineBase" })],
    });
  }

  const candidateResult = validateParameterCandidates(input.parameterCandidates);
  if (!candidateResult.ok) {
    return blockedSelectionResult({
      market: input.market,
      errors: [candidateResult.error],
      failedStage: "TRAIN_SELECTION",
    });
  }
  const candidates = candidateResult.candidates;
  const hooks = isPlainObject(input.hooks) ? input.hooks : null;

  const windowResult = walkForward.generateWalkForwardWindows({
    tradingDates: input.tradingDates,
    trainWindowSize: input.trainWindowSize,
    oosWindowSize: input.oosWindowSize,
    stepSize: input.stepSize,
    minTrainWindowSize: input.minTrainWindowSize,
    embargoTradingDayCount: input.embargoTradingDayCount,
    horizonType: input.horizonType,
  });

  if (!windowResult.ok) {
    return blockedSelectionResult({
      market: input.market,
      droppedIncompleteTail: windowResult.droppedIncompleteTail,
      errors: windowResult.errors.slice(),
      failedStage: "WALK_FORWARD",
    });
  }

  const folds = [];
  let firstFailure = null;

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
      embargoDates: Array.isArray(window.embargoDates) ? window.embargoDates.slice() : [],
      embargoStart: window.embargoStart,
      embargoEnd: window.embargoEnd,
      postOosEmbargoTradingDayCount: window.postOosEmbargoTradingDayCount,
      postOosEmbargoDates: Array.isArray(window.postOosEmbargoDates) ? window.postOosEmbargoDates.slice() : [],
      postOosEmbargoStart: window.postOosEmbargoStart,
      postOosEmbargoEnd: window.postOosEmbargoEnd,
      candidateCount: candidates.length,
    };

    const trainDates = input.tradingDates.slice(window.trainStartIndex, window.trainEndIndex + 1);
    const oosDates = input.tradingDates.slice(window.oosStartIndex, window.oosEndIndex + 1);
    const evalMeta = selectionEvaluationMeta(trainDates);
    const oosMeta = oosEvaluationMeta(oosDates);

    const evaluations = [];
    let trainEvalFailed = false;
    let trainEvalError = null;
    const orderedCandidates = candidates.slice().sort((a, b) => compareCandidateIdAsc(a.id, b.id));

    for (const candidate of orderedCandidates) {
      const evalResult = evaluateTrainCandidate({
        candidate,
        trainDates,
        trainStart: window.trainStart,
        trainEnd: window.trainEnd,
        pipelineBase: input.pipelineBase,
        initialCapital: input.initialCapital,
        foldId: window.foldId,
        hooks,
      });
      evaluations.push(evalResult.evaluation);
      if (!evalResult.ok) {
        trainEvalFailed = true;
        if (!trainEvalError) trainEvalError = evalResult.error;
        // Continue collecting evidence but will fail-closed (no silent skip of universe).
      }
    }

    if (trainEvalFailed) {
      firstFailure = captureFirstFailure(firstFailure, {
        foldId: window.foldId,
        rootError: trainEvalError,
        failedStage: "TRAIN_SELECTION",
        stageSummary: makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED),
      });
      folds.push({
        ...foldBase,
        ...evalMeta,
        ...oosMeta,
        status: FOLD_STATUS.BLOCKED,
        candidateEvaluations: buildCandidateEvidence(evaluations),
        selectedCandidateId: null,
        selectedParameters: null,
        selectionMetric: SELECTION_METRIC,
        selectionScore: null,
        selectionTieBreak: SELECTION_TIE_BREAK,
        parameterFrozen: false,
        oosStatus: FOLD_STATUS.BLOCKED,
        oosTotalReturn: null,
        oosBenchmarkReturn: null,
        oosAlpha: null,
        errorCodes: uniqueCodes([
          trainEvalError,
          makeError(ERROR.TRAIN_CANDIDATE_EVALUATION_FAILED),
          makeError(ERROR.TRAIN_SELECTION_STAGE_FAILED),
        ]),
      });
      continue;
    }

    const selection = selectWinnerFromTrainEvaluations(evaluations);
    if (!selection.ok) {
      firstFailure = captureFirstFailure(firstFailure, {
        foldId: window.foldId,
        rootError: selection.error,
        failedStage: "TRAIN_SELECTION",
        stageSummary: makeError(ERROR.TRAIN_SELECTION_STAGE_FAILED),
      });
      folds.push({
        ...foldBase,
        ...evalMeta,
        ...oosMeta,
        status: FOLD_STATUS.BLOCKED,
        candidateEvaluations: buildCandidateEvidence(evaluations),
        selectedCandidateId: null,
        selectedParameters: null,
        selectionMetric: SELECTION_METRIC,
        selectionScore: null,
        selectionTieBreak: SELECTION_TIE_BREAK,
        parameterFrozen: false,
        oosStatus: FOLD_STATUS.BLOCKED,
        oosTotalReturn: null,
        oosBenchmarkReturn: null,
        oosAlpha: null,
        errorCodes: uniqueCodes([selection.error, makeError(ERROR.TRAIN_SELECTION_STAGE_FAILED)]),
      });
      continue;
    }

    const oosResult = runOosWithFrozenParameters({
      selectedParameters: selection.selectedParameters,
      oosDates,
      oosStart: window.oosStart,
      oosEnd: window.oosEnd,
      pipelineBase: input.pipelineBase,
      initialCapital: input.initialCapital,
      market: input.market,
      benchmarkSeries: input.benchmarkSeries,
      foldId: window.foldId,
      hooks,
    });

    if (!oosResult.ok) {
      firstFailure = captureFirstFailure(firstFailure, {
        foldId: window.foldId,
        rootError: oosResult.error,
        failedStage: "WALK_FORWARD",
        stageSummary: makeError(ERROR.OOS_FOLD_FAILED),
      });
      folds.push({
        ...foldBase,
        ...evalMeta,
        ...oosMeta,
        status: FOLD_STATUS.BLOCKED,
        candidateEvaluations: selection.candidateEvaluations,
        selectedCandidateId: selection.selectedCandidateId,
        selectedParameters: selection.selectedParameters,
        selectionMetric: selection.selectionMetric,
        selectionScore: selection.selectionScore,
        selectionTieBreak: selection.selectionTieBreak,
        parameterFrozen: true,
        oosStatus: FOLD_STATUS.BLOCKED,
        oosTotalReturn: null,
        oosBenchmarkReturn: null,
        oosAlpha: null,
        errorCodes: uniqueCodes([oosResult.error, makeError(ERROR.OOS_FOLD_FAILED)]),
      });
      continue;
    }

    folds.push({
      ...foldBase,
      ...evalMeta,
      ...oosMeta,
      status: FOLD_STATUS.COMPLETED,
      candidateEvaluations: selection.candidateEvaluations,
      selectedCandidateId: selection.selectedCandidateId,
      selectedParameters: selection.selectedParameters,
      selectionMetric: selection.selectionMetric,
      selectionScore: selection.selectionScore,
      selectionTieBreak: selection.selectionTieBreak,
      parameterFrozen: true,
      oosStatus: FOLD_STATUS.COMPLETED,
      oosTotalReturn: oosResult.totalReturn,
      oosBenchmarkReturn: oosResult.benchmarkReturn,
      oosAlpha: oosResult.alpha,
      // GATE 5N fold metric aliases for aggregate compatibility
      totalReturn: oosResult.totalReturn,
      benchmarkReturn: oosResult.benchmarkReturn,
      alpha: oosResult.alpha,
      errorCodes: [],
    });
  }

  const failedFolds = folds.filter((f) => f.status === FOLD_STATUS.BLOCKED);
  if (failedFolds.length > 0) {
    const errors = [];
    if (firstFailure) {
      errors.push(firstFailure.rootError);
      errors.push(firstFailure.stageSummary);
    }
    return blockedSelectionResult({
      market: input.market,
      foldCount: folds.length,
      successfulFoldCount: folds.length - failedFolds.length,
      failedFoldCount: failedFolds.length,
      droppedIncompleteTail: windowResult.droppedIncompleteTail,
      oosCoverageStart: windowResult.windows[0].oosStart,
      oosCoverageEnd: windowResult.windows[windowResult.windows.length - 1].oosEnd,
      folds,
      partialFoldResults: folds,
      failedStage: firstFailure ? firstFailure.failedStage : "TRAIN_SELECTION",
      errors,
    });
  }

  const aggregateBlockedResult = (field) => blockedSelectionResult({
    market: input.market,
    foldCount: folds.length,
    successfulFoldCount: folds.filter((f) => f.status === FOLD_STATUS.COMPLETED).length,
    failedFoldCount: 0,
    droppedIncompleteTail: windowResult.droppedIncompleteTail,
    oosCoverageStart: windowResult.windows[0].oosStart,
    oosCoverageEnd: windowResult.windows[windowResult.windows.length - 1].oosEnd,
    folds,
    partialFoldResults: folds,
    failedStage: "WALK_FORWARD",
    errors: [makeError(ERROR.WALK_FORWARD_AGGREGATE_NONFINITE, field != null ? { field } : undefined)],
  });

  const n = folds.length;
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

  return completedSelectionResult({
    market: input.market,
    foldCount: n,
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
  SELECTION_METRIC,
  SELECTION_TIE_BREAK,
  SELECTION_EVALUATION_POLICY,
  TILE_SIZE,
  MAX_COMPLETE_TILE_COUNT,
  padTileIndex,
  buildTrainTiles,
  SELECTION_STATUS,
  FOLD_STATUS,
  ERROR,
  AGGREGATE_DEFINITION,
  compareCandidateIdAsc,
  validateParameterCandidates,
  freezeSelectedParameters,
  selectWinnerFromTrainEvaluations,
  runWalkForwardTrainParameterSelection,
  sliceFeatureWindow,
  assertCausalTradeTiming,
  blockedSelectionResult,
  completedSelectionResult,
};
