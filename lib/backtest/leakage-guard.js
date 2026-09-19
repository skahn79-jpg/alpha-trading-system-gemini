/**
 * 백테스트 누출 가드. 순수 CommonJS. I/O 없음.
 * 6L: makeError via shared makeBacktestError. Extra objects unchanged.
 * 7Q: createLeakageResult copies errors, missingData, and warnings.
 * 7R freeze: pin 7Q errors/missingData/warnings slices. Do not deep clone.
 */

"use strict";

const { parseYmd, parseKstDateTime, HORIZON_TYPE } = require("./schemas");
const { makeBacktestError: makeError } = require("./make-error");

const LEAKAGE_ERROR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
  INVALID_DATE_VALUE: "INVALID_DATE_VALUE",
  LOOKAHEAD_CANDLE_PRESENT: "LOOKAHEAD_CANDLE_PRESENT",
  SPLIT_OVERLAP: "SPLIT_OVERLAP",
  PURGE_UNIT_MISMATCH: "PURGE_UNIT_MISMATCH",
  PURGE_INSUFFICIENT: "PURGE_INSUFFICIENT",
  EMBARGO_NOT_CONFIGURED: "EMBARGO_NOT_CONFIGURED",
  FEATURE_AFTER_SIGNAL: "FEATURE_AFTER_SIGNAL",
  SIGNAL_NOT_BEFORE_EXECUTION: "SIGNAL_NOT_BEFORE_EXECUTION",
  SAME_DAY_EXECUTION: "SAME_DAY_EXECUTION",
  TARGET_NOT_AFTER_SIGNAL: "TARGET_NOT_AFTER_SIGNAL",
  TRAINING_CUTOFF_LEAKAGE: "TRAINING_CUTOFF_LEAKAGE",
  PUBLICATION_LEAKAGE: "PUBLICATION_LEAKAGE",
  UNIVERSE_MEMBERSHIP_LEAKAGE: "UNIVERSE_MEMBERSHIP_LEAKAGE",
});

const PURGE_UNIT = Object.freeze({
  CALENDAR_DAY: "CALENDAR_DAY",
  TRADING_DAY: "TRADING_DAY",
});

const PURGE_MIN = Object.freeze({
  [HORIZON_TYPE.LEGACY_7_CALENDAR_DAYS]: { unit: PURGE_UNIT.CALENDAR_DAY, min: 7 },
  [HORIZON_TYPE.ULTRA_SHORT]: { unit: PURGE_UNIT.TRADING_DAY, min: 1 },
  [HORIZON_TYPE.SHORT]: { unit: PURGE_UNIT.TRADING_DAY, min: 5 },
  [HORIZON_TYPE.MEDIUM]: { unit: PURGE_UNIT.TRADING_DAY, min: 20 },
  [HORIZON_TYPE.LONG]: { unit: PURGE_UNIT.TRADING_DAY, min: 60 },
});

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

function createLeakageResult(ok, errors, missingData, warnings) {
  // 7Q: copy arrays so callers cannot mutate the result arrays.
  const list = Array.isArray(errors) ? errors.slice() : [];
  const missing = Array.isArray(missingData) ? missingData.slice() : [];
  return {
    ok: ok === true,
    errors: list,
    errorCodes: uniqueCodes(list),
    missingData: missing,
    warnings: Array.isArray(warnings) ? warnings.slice() : [],
    backtestExecutionEligible: false,
    promotionEligible: false,
  };
}

function parseInstant(value) {
  if (value == null) return { ok: false, ms: null, code: LEAKAGE_ERROR.MISSING_FIELD };
  if (typeof value !== "string") {
    return { ok: false, ms: null, code: LEAKAGE_ERROR.INVALID_DATE_FORMAT };
  }
  const ymd = parseYmd(value);
  if (ymd.ok) {
    const ms = Date.parse(`${ymd.date}T00:00:00+09:00`);
    if (!Number.isFinite(ms)) {
      return { ok: false, ms: null, code: LEAKAGE_ERROR.INVALID_DATE_VALUE };
    }
    return { ok: true, ms, code: null };
  }
  const dt = parseKstDateTime(value);
  if (!dt.ok) {
    return { ok: false, ms: null, code: dt.code || LEAKAGE_ERROR.INVALID_DATE_FORMAT };
  }
  return { ok: true, ms: dt.ms, code: null };
}

function assertFeatureWindowNoLookAhead(input) {
  const payload = input && typeof input === "object" ? input : {};
  const errors = [];
  const missingData = [];
  const featureWindow = payload.featureWindow;
  const featureAsOfTradingDate = payload.featureAsOfTradingDate;
  const targetTradingDate = payload.targetTradingDate;

  if (!Array.isArray(featureWindow)) {
    errors.push(makeError(LEAKAGE_ERROR.INVALID_INPUT, { field: "featureWindow" }));
    return createLeakageResult(false, errors, missingData);
  }
  if (featureAsOfTradingDate == null) {
    missingData.push("featureAsOfTradingDate");
    return createLeakageResult(false, errors, missingData);
  }
  const asOf = parseYmd(featureAsOfTradingDate);
  if (!asOf.ok) {
    errors.push(makeError(asOf.code || LEAKAGE_ERROR.INVALID_DATE_FORMAT, { field: "featureAsOfTradingDate" }));
    return createLeakageResult(false, errors, missingData);
  }
  let target = null;
  if (targetTradingDate != null) {
    const parsedTarget = parseYmd(targetTradingDate);
    if (!parsedTarget.ok) {
      errors.push(makeError(parsedTarget.code || LEAKAGE_ERROR.INVALID_DATE_FORMAT, { field: "targetTradingDate" }));
    } else {
      target = parsedTarget.date;
    }
  }

  for (let i = 0; i < featureWindow.length; i += 1) {
    const row = featureWindow[i];
    const tradingDate = row && row.tradingDate;
    const parsed = parseYmd(tradingDate);
    if (!parsed.ok) {
      errors.push(makeError(parsed.code || LEAKAGE_ERROR.INVALID_DATE_FORMAT, {
        field: "tradingDate",
        recordIndex: i,
        symbol: row && row.symbol,
      }));
      continue;
    }
    if (parsed.date > asOf.date) {
      errors.push(makeError(LEAKAGE_ERROR.LOOKAHEAD_CANDLE_PRESENT, {
        field: "tradingDate",
        recordIndex: i,
        symbol: row && row.symbol,
        tradingDate: parsed.date,
      }));
    } else if (target != null && parsed.date === target) {
      errors.push(makeError(LEAKAGE_ERROR.LOOKAHEAD_CANDLE_PRESENT, {
        field: "tradingDate",
        recordIndex: i,
        symbol: row && row.symbol,
        tradingDate: parsed.date,
      }));
    }
  }

  return createLeakageResult(errors.length === 0, errors, missingData);
}

function validateSignalTiming(input) {
  const payload = input && typeof input === "object" ? input : {};
  const errors = [];
  const missingData = [];
  const required = [
    "featureDataAsOf",
    "signalCreatedAt",
    "executionTimestamp",
    "signalTradingDate",
    "earliestExecutionTradingDate",
    "targetTradingDate",
  ];
  for (const field of required) {
    if (payload[field] == null) missingData.push(field);
  }
  if (missingData.length > 0) {
    return createLeakageResult(false, errors, missingData);
  }

  const feature = parseInstant(payload.featureDataAsOf);
  const created = parseInstant(payload.signalCreatedAt);
  const execTs = parseInstant(payload.executionTimestamp);
  const signalDate = parseYmd(payload.signalTradingDate);
  const execDate = parseYmd(payload.earliestExecutionTradingDate);
  const targetDate = parseYmd(payload.targetTradingDate);

  const parsed = [
    [feature, "featureDataAsOf"],
    [created, "signalCreatedAt"],
    [execTs, "executionTimestamp"],
  ];
  for (const [result, field] of parsed) {
    if (!result.ok) errors.push(makeError(result.code, { field }));
  }
  if (!signalDate.ok) errors.push(makeError(signalDate.code, { field: "signalTradingDate" }));
  if (!execDate.ok) errors.push(makeError(execDate.code, { field: "earliestExecutionTradingDate" }));
  if (!targetDate.ok) errors.push(makeError(targetDate.code, { field: "targetTradingDate" }));

  if (feature.ok && created.ok && feature.ms > created.ms) {
    errors.push(makeError(LEAKAGE_ERROR.FEATURE_AFTER_SIGNAL, { field: "featureDataAsOf" }));
  }
  if (created.ok && execTs.ok && !(created.ms < execTs.ms)) {
    errors.push(makeError(LEAKAGE_ERROR.SIGNAL_NOT_BEFORE_EXECUTION, { field: "executionTimestamp" }));
  }
  if (signalDate.ok && execDate.ok && !(signalDate.date < execDate.date)) {
    errors.push(makeError(LEAKAGE_ERROR.SAME_DAY_EXECUTION, { field: "earliestExecutionTradingDate" }));
  }
  if (signalDate.ok && targetDate.ok && !(targetDate.date > signalDate.date)) {
    errors.push(makeError(LEAKAGE_ERROR.TARGET_NOT_AFTER_SIGNAL, { field: "targetTradingDate" }));
  }

  return createLeakageResult(errors.length === 0, errors, missingData);
}

function validatePointInTimeInputs(input) {
  const payload = input && typeof input === "object" ? input : {};
  const errors = [];
  const missingData = [];
  const required = [
    "featureDataAsOf",
    "signalCreatedAt",
    "modelTrainingCutoff",
    "corporateActionDataPublishedAt",
    "financialStatementPublishedAt",
    "newsPublishedAt",
    "universeMembershipAsOf",
  ];
  for (const field of required) {
    if (payload[field] == null) missingData.push(field);
  }
  if (missingData.length > 0) {
    return createLeakageResult(false, errors, missingData);
  }

  const feature = parseInstant(payload.featureDataAsOf);
  const created = parseInstant(payload.signalCreatedAt);
  const cutoff = parseInstant(payload.modelTrainingCutoff);
  const caPub = parseInstant(payload.corporateActionDataPublishedAt);
  const fsPub = parseInstant(payload.financialStatementPublishedAt);
  const newsPub = parseInstant(payload.newsPublishedAt);
  const universe = parseInstant(payload.universeMembershipAsOf);

  const pairs = [
    [feature, "featureDataAsOf"],
    [created, "signalCreatedAt"],
    [cutoff, "modelTrainingCutoff"],
    [caPub, "corporateActionDataPublishedAt"],
    [fsPub, "financialStatementPublishedAt"],
    [newsPub, "newsPublishedAt"],
    [universe, "universeMembershipAsOf"],
  ];
  for (const [result, field] of pairs) {
    if (!result.ok) errors.push(makeError(result.code, { field }));
  }

  if (feature.ok && cutoff.ok && cutoff.ms > feature.ms) {
    errors.push(makeError(LEAKAGE_ERROR.TRAINING_CUTOFF_LEAKAGE, { field: "modelTrainingCutoff" }));
  }
  if (feature.ok && caPub.ok && caPub.ms > feature.ms) {
    errors.push(makeError(LEAKAGE_ERROR.PUBLICATION_LEAKAGE, { field: "corporateActionDataPublishedAt" }));
  }
  if (feature.ok && fsPub.ok && fsPub.ms > feature.ms) {
    errors.push(makeError(LEAKAGE_ERROR.PUBLICATION_LEAKAGE, { field: "financialStatementPublishedAt" }));
  }
  if (feature.ok && newsPub.ok && newsPub.ms > feature.ms) {
    errors.push(makeError(LEAKAGE_ERROR.PUBLICATION_LEAKAGE, { field: "newsPublishedAt" }));
  }
  if (created.ok && universe.ok && universe.ms > created.ms) {
    errors.push(makeError(LEAKAGE_ERROR.UNIVERSE_MEMBERSHIP_LEAKAGE, { field: "universeMembershipAsOf" }));
  }

  return createLeakageResult(errors.length === 0, errors, missingData);
}

function validateSplitWindows(input) {
  const payload = input && typeof input === "object" ? input : {};
  const errors = [];
  const missingData = [];
  const names = ["train", "validation", "test"];
  const parsed = {};
  for (const name of names) {
    const win = payload[name];
    if (!win || typeof win !== "object") {
      missingData.push(name);
      continue;
    }
    const from = parseYmd(win.from);
    const to = parseYmd(win.to);
    if (!from.ok) errors.push(makeError(from.code, { field: `${name}.from` }));
    if (!to.ok) errors.push(makeError(to.code, { field: `${name}.to` }));
    if (from.ok && to.ok && from.date > to.date) {
      errors.push(makeError(LEAKAGE_ERROR.INVALID_DATE_VALUE, { field: `${name}.from` }));
    }
    if (from.ok && to.ok) parsed[name] = { from: from.date, to: to.date };
  }
  if (missingData.length > 0) {
    return createLeakageResult(false, errors, missingData);
  }
  if (parsed.train && parsed.validation && parsed.test) {
    const noOverlap = parsed.train.to < parsed.validation.from
      && parsed.validation.to < parsed.test.from;
    if (!noOverlap) {
      errors.push(makeError(LEAKAGE_ERROR.SPLIT_OVERLAP, { field: "validation" }));
    }
  }
  return createLeakageResult(errors.length === 0, errors, missingData);
}

function validatePurgeEmbargo(input) {
  const payload = input && typeof input === "object" ? input : {};
  const errors = [];
  const missingData = [];
  const horizonType = payload.horizonType;
  const spec = PURGE_MIN[horizonType];
  if (!spec) {
    errors.push(makeError(LEAKAGE_ERROR.INVALID_INPUT, { field: "horizonType" }));
    return createLeakageResult(false, errors, missingData);
  }
  if (payload.purgeUnit !== spec.unit) {
    errors.push(makeError(LEAKAGE_ERROR.PURGE_UNIT_MISMATCH, { field: "purgeUnit" }));
  }
  const purgeLength = payload.purgeLength;
  if (!Number.isInteger(purgeLength) || purgeLength < spec.min) {
    errors.push(makeError(LEAKAGE_ERROR.PURGE_INSUFFICIENT, { field: "purgeLength" }));
  }
  if (payload.embargoLength === null || payload.embargoLength === undefined) {
    errors.push(makeError(LEAKAGE_ERROR.EMBARGO_NOT_CONFIGURED, { field: "embargoLength" }));
  } else if (payload.embargoUnit !== spec.unit) {
    errors.push(makeError(LEAKAGE_ERROR.PURGE_UNIT_MISMATCH, { field: "embargoUnit" }));
  }
  return createLeakageResult(errors.length === 0, errors, missingData);
}

function assertSignalTiming(input) {
  return validateSignalTiming(input);
}

function assertPointInTimeInputs(input) {
  return validatePointInTimeInputs(input);
}

function assertSplitWindows(input) {
  return validateSplitWindows(input);
}

function assertPurgeEmbargo(input) {
  return validatePurgeEmbargo(input);
}

module.exports = {
  LEAKAGE_ERROR,
  PURGE_UNIT,
  createLeakageResult,
  assertFeatureWindowNoLookAhead,
  validateSignalTiming,
  validatePointInTimeInputs,
  validateSplitWindows,
  validatePurgeEmbargo,
  assertSignalTiming,
  assertPointInTimeInputs,
  assertSplitWindows,
  assertPurgeEmbargo,
};
