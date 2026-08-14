/**
 * 백테스트 역사 일봉 데이터셋 검증. 순수 CommonJS.
 * crypto builtin과 ./schemas 만 사용한다.
 */

"use strict";

const crypto = require("crypto");
const { parseYmd, parseKstDateTime } = require("./schemas");

const LOAD_MODE = Object.freeze({
  TEST: "TEST",
  PRODUCTION: "PRODUCTION",
});

const CANONICALIZATION_VERSION = "backtest-dataset-c14n-v1";

const SORT_ORDER = Object.freeze({
  ASCENDING_BY_TRADING_DATE: "ASCENDING_BY_TRADING_DATE",
});

const DATASET_TYPE = Object.freeze({
  HISTORICAL_DAILY_OHLCV: "HISTORICAL_DAILY_OHLCV",
});

const SOURCE_TYPE = Object.freeze({
  SYNTHETIC_FIXTURE: "SYNTHETIC_FIXTURE",
  LOCAL_VERIFIED_FILE: "LOCAL_VERIFIED_FILE",
  EXTERNAL_PROVIDER: "EXTERNAL_PROVIDER",
});

const FIXTURE_TYPE = Object.freeze({
  SYNTHETIC_BACKTEST_DATASET: "SYNTHETIC_BACKTEST_DATASET",
});

const VERIFICATION_STATUS = Object.freeze({
  TEST_VERIFIED: "TEST_VERIFIED",
  VERIFIED: "VERIFIED",
  PENDING: "PENDING",
});

const PRICE_ADJUSTMENT_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNKNOWN: "UNKNOWN",
  VERIFIED_ADJUSTED: "VERIFIED_ADJUSTED",
  VERIFIED_UNADJUSTED: "VERIFIED_UNADJUSTED",
});

const CORPORATE_ACTION_POLICY_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNKNOWN: "UNKNOWN",
});

const FINALITY = Object.freeze({
  FINAL: "FINAL",
  NOT_FINAL: "NOT_FINAL",
  UNKNOWN: "UNKNOWN",
});

const FINALITY_SOURCE = Object.freeze({
  EXPLICIT_FINAL_FLAG: "EXPLICIT_FINAL_FLAG",
  HISTORICAL_DATE: "HISTORICAL_DATE",
  TIME_HEURISTIC: "TIME_HEURISTIC",
});

const CANDLE_ADJUSTMENT = Object.freeze({
  UNKNOWN: "UNKNOWN",
  VERIFIED: "VERIFIED",
});

const STATUS = Object.freeze({
  BLOCKED_DATA_VALIDATION: "BLOCKED_DATA_VALIDATION",
  SCHEMA_VALID_DATA_UNVERIFIED: "SCHEMA_VALID_DATA_UNVERIFIED",
  SYNTHETIC_FIXTURE_NOT_ALLOWED: "SYNTHETIC_FIXTURE_NOT_ALLOWED",
});

const ERROR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_VOLUME: "INVALID_VOLUME",
  OHLC_INCONSISTENT: "OHLC_INCONSISTENT",
  INVALID_PRICE: "INVALID_PRICE",
  DUPLICATE_TRADING_DATE: "DUPLICATE_TRADING_DATE",
  NON_MONOTONIC_DATES: "NON_MONOTONIC_DATES",
  SORT_ORDER_INVALID: "SORT_ORDER_INVALID",
  COVERAGE_MISMATCH: "COVERAGE_MISMATCH",
  PER_SYMBOL_COVERAGE_MISMATCH: "PER_SYMBOL_COVERAGE_MISMATCH",
  TIME_HEURISTIC_NOT_ALLOWED: "TIME_HEURISTIC_NOT_ALLOWED",
  SYNTHETIC_FIXTURE_NOT_ALLOWED: "SYNTHETIC_FIXTURE_NOT_ALLOWED",
  CONTENT_CHECKSUM_MISMATCH: "CONTENT_CHECKSUM_MISMATCH",
  METADATA_HASH_MISMATCH: "METADATA_HASH_MISMATCH",
  CANONICALIZATION_UNSUPPORTED: "CANONICALIZATION_UNSUPPORTED",
  INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
  INVALID_DATE_VALUE: "INVALID_DATE_VALUE",
  CANDLE_NOT_FINAL: "CANDLE_NOT_FINAL",
  DATE_ALIAS_NOT_ALLOWED: "DATE_ALIAS_NOT_ALLOWED",
  SYMBOL_MARKET_MISMATCH: "SYMBOL_MARKET_MISMATCH",
  SOURCE_DATASET_ID_MISMATCH: "SOURCE_DATASET_ID_MISMATCH",
  ADJUSTMENT_POLICY_MISMATCH: "ADJUSTMENT_POLICY_MISMATCH",
  INVALID_SYMBOL_ID: "INVALID_SYMBOL_ID",
  INVALID_DATASET_ID: "INVALID_DATASET_ID",
  SYMBOLS_NOT_SORTED: "SYMBOLS_NOT_SORTED",
  MARKETS_NOT_SORTED: "MARKETS_NOT_SORTED",
  CANDLES_NOT_SORTED: "CANDLES_NOT_SORTED",
});

const ENVELOPE_KEYS = Object.freeze([
  "datasetId",
  "datasetVersion",
  "datasetType",
  "sourceType",
  "symbols",
  "markets",
  "coverage",
  "perSymbolCoverage",
  "timezone",
  "sortOrder",
  "priceAdjustmentStatus",
  "corporateActionPolicyId",
  "corporateActionPolicyStatus",
  "universePolicyId",
  "survivorshipBiasControlled",
  "calendarVersion",
  "calendarVerificationStatus",
  "canonicalizationVersion",
  "contentChecksum",
  "metadataHash",
  "verificationStatus",
  "fixtureType",
  "notProductionData",
  "productionEligible",
  "candles",
  "sourceRefs",
  "verifiedAt",
  "generatedAt",
  "loaderTimestamp",
]);

const ENVELOPE_KEY_SET = new Set(ENVELOPE_KEYS);

const CANDLE_KEYS = Object.freeze([
  "symbol",
  "market",
  "tradingDate",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "isFinal",
  "candleFinality",
  "finalitySource",
  "adjustmentStatus",
  "dataAsOf",
  "sourceDatasetId",
]);

const CANDLE_KEY_SET = new Set(CANDLE_KEYS);

const CONTENT_CHECKSUM_KEYS = Object.freeze([
  "datasetId",
  "datasetVersion",
  "datasetType",
  "symbols",
  "markets",
  "coverage",
  "perSymbolCoverage",
  "timezone",
  "sortOrder",
  "priceAdjustmentStatus",
  "corporateActionPolicyId",
  "corporateActionPolicyStatus",
  "universePolicyId",
  "survivorshipBiasControlled",
  "calendarVersion",
  "calendarVerificationStatus",
  "canonicalizationVersion",
  "candles",
]);

const METADATA_HASH_KEYS = Object.freeze([
  "sourceType",
  "verificationStatus",
  "fixtureType",
  "notProductionData",
  "productionEligible",
  "sourceRefs",
  "verifiedAt",
]);

const REQUIRED_ENVELOPE_FIELDS = Object.freeze([
  "datasetId",
  "datasetVersion",
  "datasetType",
  "sourceType",
  "symbols",
  "markets",
  "coverage",
  "perSymbolCoverage",
  "timezone",
  "sortOrder",
  "priceAdjustmentStatus",
  "corporateActionPolicyId",
  "corporateActionPolicyStatus",
  "universePolicyId",
  "survivorshipBiasControlled",
  "calendarVersion",
  "calendarVerificationStatus",
  "canonicalizationVersion",
  "verificationStatus",
  "candles",
]);

const REQUIRED_CANDLE_FIELDS = Object.freeze([
  "symbol",
  "market",
  "tradingDate",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "isFinal",
  "candleFinality",
  "finalitySource",
  "adjustmentStatus",
  "dataAsOf",
  "sourceDatasetId",
]);

const FORBIDDEN_DATASET_ID_PREFIXES = Object.freeze([
  "krx-",
  "kospi-",
  "kosdaq-",
  "production-",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function pickDefinedKeys(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const key of keys) {
    if (Object.hasOwn(obj, key)) out[key] = obj[key];
  }
  return out;
}

function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const next = canonicalize(value[key]);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function computeDatasetContentChecksum(dataset) {
  const picked = pickDefinedKeys(dataset, CONTENT_CHECKSUM_KEYS);
  return sha256Hex(JSON.stringify(canonicalize(picked)));
}

function computeDatasetMetadataHash(dataset) {
  const picked = pickDefinedKeys(dataset, METADATA_HASH_KEYS);
  return sha256Hex(JSON.stringify(canonicalize(picked)));
}

function makeError(code, extra) {
  const err = { code, severity: extra && extra.severity ? extra.severity : "ERROR" };
  const keys = [
    "field",
    "recordIndex",
    "symbol",
    "tradingDate",
    "datasetId",
    "datasetVersion",
    "contentChecksum",
    "metadataHash",
  ];
  const src = extra || {};
  for (const key of keys) {
    if (src[key] !== undefined && src[key] !== null) err[key] = src[key];
  }
  return err;
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

function createValidationResult(partial) {
  const errors = Array.isArray(partial.errors) ? partial.errors : [];
  const warnings = Array.isArray(partial.warnings) ? partial.warnings : [];
  const missingData = Array.isArray(partial.missingData) ? [...partial.missingData] : [];
  const schemaValid = partial.schemaValid === true;
  const datasetVerified = partial.datasetVerified === true && schemaValid;
  const backtestDataEligible = datasetVerified === true;
  let status = partial.status;
  if (!status) {
    if (errors.some((e) => e.code === ERROR.SYNTHETIC_FIXTURE_NOT_ALLOWED)) {
      status = STATUS.SYNTHETIC_FIXTURE_NOT_ALLOWED;
    } else if (!schemaValid) {
      status = STATUS.BLOCKED_DATA_VALIDATION;
    } else {
      status = STATUS.SCHEMA_VALID_DATA_UNVERIFIED;
    }
  }
  return {
    ok: schemaValid && datasetVerified,
    schemaValid,
    datasetVerified: false,
    backtestDataEligible: false,
    backtestExecutionEligible: false,
    promotionEligible: false,
    status,
    errors,
    errorCodes: uniqueCodes(errors),
    missingData,
    warnings,
    ...(datasetVerified ? { datasetVerified: true, backtestDataEligible: true } : {}),
  };
}

function isLexSortedUnique(arr) {
  if (!Array.isArray(arr)) return false;
  for (let i = 1; i < arr.length; i += 1) {
    if (String(arr[i - 1]) >= String(arr[i])) return false;
  }
  return true;
}

function isValidVolume(value) {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

function isValidPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function yearOfYmd(ymd) {
  if (typeof ymd !== "string" || ymd.length < 4) return null;
  const year = Number(ymd.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function hasCalendarProvider(provider) {
  return provider != null
    && typeof provider === "object"
    && typeof provider.getTradingDayStatus === "function";
}

function validateCandle(candle, context) {
  const errors = [];
  const ctx = context || {};
  if (!isPlainObject(candle)) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "candles", recordIndex: ctx.recordIndex }));
    return { ok: false, errors };
  }

  if (Object.hasOwn(candle, "date")) {
    errors.push(makeError(ERROR.DATE_ALIAS_NOT_ALLOWED, {
      field: "date",
      recordIndex: ctx.recordIndex,
      symbol: candle.symbol,
      tradingDate: candle.tradingDate,
    }));
  }

  for (const key of Object.keys(candle)) {
    if (key === "date") continue;
    if (!CANDLE_KEY_SET.has(key)) {
      errors.push(makeError(ERROR.UNKNOWN_FIELD, {
        field: key,
        recordIndex: ctx.recordIndex,
        symbol: candle.symbol,
        tradingDate: candle.tradingDate,
      }));
    }
  }

  for (const field of REQUIRED_CANDLE_FIELDS) {
    if (!Object.hasOwn(candle, field)) {
      errors.push(makeError(ERROR.MISSING_FIELD, {
        field,
        recordIndex: ctx.recordIndex,
        symbol: candle.symbol,
        tradingDate: candle.tradingDate,
      }));
    }
  }

  const loc = {
    recordIndex: ctx.recordIndex,
    symbol: candle.symbol,
    tradingDate: candle.tradingDate,
    datasetId: ctx.datasetId,
  };

  if (typeof candle.symbol === "string" && Array.isArray(ctx.symbols) && !ctx.symbols.includes(candle.symbol)) {
    errors.push(makeError(ERROR.SYMBOL_MARKET_MISMATCH, { ...loc, field: "symbol" }));
  }
  if (typeof candle.market === "string" && Array.isArray(ctx.markets) && !ctx.markets.includes(candle.market)) {
    errors.push(makeError(ERROR.SYMBOL_MARKET_MISMATCH, { ...loc, field: "market" }));
  }
  if (ctx.datasetId != null && candle.sourceDatasetId !== ctx.datasetId) {
    errors.push(makeError(ERROR.SOURCE_DATASET_ID_MISMATCH, { ...loc, field: "sourceDatasetId" }));
  }

  if (ctx.synthetic === true) {
    if (typeof candle.symbol !== "string" || !candle.symbol.startsWith("SYNTH")) {
      errors.push(makeError(ERROR.INVALID_SYMBOL_ID, { ...loc, field: "symbol" }));
    }
    if (candle.market !== "SYNTHETIC_MARKET") {
      errors.push(makeError(ERROR.SYMBOL_MARKET_MISMATCH, { ...loc, field: "market" }));
    }
  }

  const parsedDate = parseYmd(candle.tradingDate);
  if (!parsedDate.ok) {
    errors.push(makeError(parsedDate.code || ERROR.INVALID_DATE_FORMAT, { ...loc, field: "tradingDate" }));
  } else if (ctx.synthetic === true) {
    const year = yearOfYmd(parsedDate.date);
    if (year == null || year < 2100 || year >= 2200) {
      errors.push(makeError(ERROR.INVALID_DATE_VALUE, { ...loc, field: "tradingDate" }));
    }
  }

  const dataAsOf = parseKstDateTime(candle.dataAsOf);
  if (!dataAsOf.ok) {
    errors.push(makeError(dataAsOf.code || ERROR.INVALID_DATE_FORMAT, { ...loc, field: "dataAsOf" }));
  }

  if (!isValidVolume(candle.volume)) {
    errors.push(makeError(ERROR.INVALID_VOLUME, { ...loc, field: "volume" }));
  }

  const priceFields = ["open", "high", "low", "close"];
  let pricesOk = true;
  for (const field of priceFields) {
    if (!isValidPrice(candle[field])) {
      errors.push(makeError(ERROR.INVALID_PRICE, { ...loc, field }));
      pricesOk = false;
    }
  }
  if (pricesOk) {
    const { open, high, low, close } = candle;
    if (!(high >= open && high >= close && high >= low && low <= open && low <= close)) {
      errors.push(makeError(ERROR.OHLC_INCONSISTENT, { ...loc, field: "high" }));
    }
  }

  if (candle.isFinal !== true || candle.candleFinality !== FINALITY.FINAL) {
    errors.push(makeError(ERROR.CANDLE_NOT_FINAL, { ...loc, field: "candleFinality" }));
  }

  if (candle.finalitySource === FINALITY_SOURCE.TIME_HEURISTIC) {
    errors.push(makeError(ERROR.TIME_HEURISTIC_NOT_ALLOWED, { ...loc, field: "finalitySource" }));
  }

  if (
    ctx.datasetAdjustmentStatus != null
    && candle.adjustmentStatus != null
    && ctx.datasetAdjustmentStatus === PRICE_ADJUSTMENT_STATUS.VERIFIED
    && candle.adjustmentStatus !== CANDLE_ADJUSTMENT.VERIFIED
    && candle.adjustmentStatus !== PRICE_ADJUSTMENT_STATUS.VERIFIED
  ) {
    errors.push(makeError(ERROR.ADJUSTMENT_POLICY_MISMATCH, { ...loc, field: "adjustmentStatus" }));
  }

  return { ok: errors.length === 0, errors };
}

function validateHistoricalDataset(dataset, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const mode = options.mode == null ? LOAD_MODE.PRODUCTION : options.mode;
  const calendarProvider = Object.hasOwn(options, "calendarProvider") ? options.calendarProvider : null;
  const missingData = [];
  const warnings = [];
  const errors = [];

  if (!hasCalendarProvider(calendarProvider)) {
    missingData.push("CALENDAR_UNAVAILABLE");
  }
  missingData.push("CALENDAR_VALIDATION_NOT_IMPLEMENTED");

  if (!isPlainObject(dataset)) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: null }));
    return createValidationResult({ schemaValid: false, errors, missingData, warnings });
  }

  const meta = {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
  };

  for (const key of Object.keys(dataset)) {
    if (!ENVELOPE_KEY_SET.has(key)) {
      errors.push(makeError(ERROR.UNKNOWN_FIELD, { field: key, ...meta }));
    }
  }

  const syntheticLike = dataset.sourceType === SOURCE_TYPE.SYNTHETIC_FIXTURE
    || dataset.notProductionData === true
    || dataset.fixtureType === FIXTURE_TYPE.SYNTHETIC_BACKTEST_DATASET;

  if (mode === LOAD_MODE.PRODUCTION && syntheticLike) {
    errors.push(makeError(ERROR.SYNTHETIC_FIXTURE_NOT_ALLOWED, { field: "sourceType", ...meta }));
    return createValidationResult({
      schemaValid: false,
      errors,
      missingData,
      warnings,
      status: STATUS.SYNTHETIC_FIXTURE_NOT_ALLOWED,
    });
  }

  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    if (!Object.hasOwn(dataset, field)) {
      errors.push(makeError(ERROR.MISSING_FIELD, { field, ...meta }));
    }
  }

  if (dataset.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    errors.push(makeError(ERROR.CANONICALIZATION_UNSUPPORTED, { field: "canonicalizationVersion", ...meta }));
  }

  if (dataset.timezone !== "Asia/Seoul") {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "timezone", ...meta }));
  }
  if (dataset.sortOrder !== SORT_ORDER.ASCENDING_BY_TRADING_DATE) {
    errors.push(makeError(ERROR.SORT_ORDER_INVALID, { field: "sortOrder", ...meta }));
  }
  if (dataset.datasetType !== DATASET_TYPE.HISTORICAL_DAILY_OHLCV) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "datasetType", ...meta }));
  }

  const synthetic = dataset.sourceType === SOURCE_TYPE.SYNTHETIC_FIXTURE;
  if (synthetic) {
    if (typeof dataset.datasetId !== "string" || !dataset.datasetId.startsWith("synthetic-")) {
      errors.push(makeError(ERROR.INVALID_DATASET_ID, { field: "datasetId", ...meta }));
    }
    if (typeof dataset.datasetId === "string") {
      const lower = dataset.datasetId.toLowerCase();
      for (const prefix of FORBIDDEN_DATASET_ID_PREFIXES) {
        if (lower.startsWith(prefix)) {
          errors.push(makeError(ERROR.INVALID_DATASET_ID, { field: "datasetId", ...meta }));
          break;
        }
      }
    }
    if (dataset.fixtureType !== FIXTURE_TYPE.SYNTHETIC_BACKTEST_DATASET) {
      errors.push(makeError(ERROR.INVALID_INPUT, { field: "fixtureType", ...meta }));
    }
    if (dataset.verificationStatus !== VERIFICATION_STATUS.TEST_VERIFIED) {
      errors.push(makeError(ERROR.INVALID_INPUT, { field: "verificationStatus", ...meta }));
    }
    if (dataset.notProductionData !== true) {
      errors.push(makeError(ERROR.INVALID_INPUT, { field: "notProductionData", ...meta }));
    }
    if (dataset.productionEligible !== false) {
      errors.push(makeError(ERROR.INVALID_INPUT, { field: "productionEligible", ...meta }));
    }
    if (!Array.isArray(dataset.markets) || dataset.markets.some((m) => m !== "SYNTHETIC_MARKET")) {
      errors.push(makeError(ERROR.SYMBOL_MARKET_MISMATCH, { field: "markets", ...meta }));
    }
  }

  if (Array.isArray(dataset.symbols)) {
    if (!isLexSortedUnique(dataset.symbols)) {
      errors.push(makeError(ERROR.SYMBOLS_NOT_SORTED, { field: "symbols", ...meta }));
    }
  } else if (Object.hasOwn(dataset, "symbols")) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "symbols", ...meta }));
  }

  if (Array.isArray(dataset.markets)) {
    if (!isLexSortedUnique(dataset.markets)) {
      errors.push(makeError(ERROR.MARKETS_NOT_SORTED, { field: "markets", ...meta }));
    }
  } else if (Object.hasOwn(dataset, "markets")) {
    errors.push(makeError(ERROR.INVALID_INPUT, { field: "markets", ...meta }));
  }

  const candles = dataset.candles;
  if (!Array.isArray(candles)) {
    if (Object.hasOwn(dataset, "candles")) {
      errors.push(makeError(ERROR.INVALID_INPUT, { field: "candles", ...meta }));
    }
  } else {
    const seen = new Set();
    const lastDateBySymbol = new Map();
    const firstDateBySymbol = new Map();
    const adjustmentStatuses = new Set();
    let prevKey = null;
    let candlesSorted = true;

    for (let i = 0; i < candles.length; i += 1) {
      const candle = candles[i];
      const candleResult = validateCandle(candle, {
        recordIndex: i,
        datasetId: dataset.datasetId,
        symbols: dataset.symbols,
        markets: dataset.markets,
        synthetic,
        datasetAdjustmentStatus: dataset.priceAdjustmentStatus,
      });
      for (const err of candleResult.errors) {
        errors.push(err);
      }
      if (!isPlainObject(candle)) continue;
      if (candle.adjustmentStatus != null) {
        adjustmentStatuses.add(candle.adjustmentStatus);
      }

      const key = `${candle.symbol}\t${candle.tradingDate}`;
      if (prevKey != null && key < prevKey) {
        candlesSorted = false;
      }
      prevKey = key;

      if (seen.has(key)) {
        errors.push(makeError(ERROR.DUPLICATE_TRADING_DATE, {
          field: "tradingDate",
          recordIndex: i,
          symbol: candle.symbol,
          tradingDate: candle.tradingDate,
          ...meta,
        }));
      }
      seen.add(key);

      const parsed = parseYmd(candle.tradingDate);
      if (parsed.ok && typeof candle.symbol === "string") {
        const last = lastDateBySymbol.get(candle.symbol);
        if (last != null && parsed.date < last) {
          errors.push(makeError(ERROR.NON_MONOTONIC_DATES, {
            field: "tradingDate",
            recordIndex: i,
            symbol: candle.symbol,
            tradingDate: candle.tradingDate,
            ...meta,
          }));
        }
        if (!firstDateBySymbol.has(candle.symbol)) {
          firstDateBySymbol.set(candle.symbol, parsed.date);
        }
        lastDateBySymbol.set(candle.symbol, parsed.date);
      }
    }

    if (!candlesSorted) {
      errors.push(makeError(ERROR.CANDLES_NOT_SORTED, { field: "candles", ...meta }));
    }

    if (adjustmentStatuses.size > 1) {
      errors.push(makeError(ERROR.ADJUSTMENT_POLICY_MISMATCH, { field: "adjustmentStatus", ...meta }));
    }

    const firstDates = [...firstDateBySymbol.values()].sort();
    const lastDates = [...lastDateBySymbol.values()].sort();
    const expectedFrom = firstDates[0];
    const expectedTo = lastDates[lastDates.length - 1];
    const coverage = dataset.coverage;
    if (isPlainObject(coverage) && expectedFrom && expectedTo) {
      if (coverage.from !== expectedFrom || coverage.to !== expectedTo) {
        errors.push(makeError(ERROR.COVERAGE_MISMATCH, { field: "coverage", ...meta }));
      }
    } else if (Object.hasOwn(dataset, "coverage") && !isPlainObject(coverage)) {
      errors.push(makeError(ERROR.COVERAGE_MISMATCH, { field: "coverage", ...meta }));
    }

    const per = dataset.perSymbolCoverage;
    if (isPlainObject(per)) {
      for (const symbol of firstDateBySymbol.keys()) {
        const row = per[symbol];
        const from = firstDateBySymbol.get(symbol);
        const to = lastDateBySymbol.get(symbol);
        if (!isPlainObject(row) || row.from !== from || row.to !== to) {
          errors.push(makeError(ERROR.PER_SYMBOL_COVERAGE_MISMATCH, {
            field: "perSymbolCoverage",
            symbol,
            ...meta,
          }));
        }
      }
    } else if (Object.hasOwn(dataset, "perSymbolCoverage")) {
      errors.push(makeError(ERROR.PER_SYMBOL_COVERAGE_MISMATCH, { field: "perSymbolCoverage", ...meta }));
    }
  }

  const schemaErrorCodes = new Set([
    ERROR.INVALID_INPUT,
    ERROR.UNKNOWN_FIELD,
    ERROR.MISSING_FIELD,
    ERROR.INVALID_VOLUME,
    ERROR.OHLC_INCONSISTENT,
    ERROR.INVALID_PRICE,
    ERROR.DUPLICATE_TRADING_DATE,
    ERROR.NON_MONOTONIC_DATES,
    ERROR.SORT_ORDER_INVALID,
    ERROR.COVERAGE_MISMATCH,
    ERROR.PER_SYMBOL_COVERAGE_MISMATCH,
    ERROR.TIME_HEURISTIC_NOT_ALLOWED,
    ERROR.SYNTHETIC_FIXTURE_NOT_ALLOWED,
    ERROR.CANONICALIZATION_UNSUPPORTED,
    ERROR.INVALID_DATE_FORMAT,
    ERROR.INVALID_DATE_VALUE,
    ERROR.CANDLE_NOT_FINAL,
    ERROR.DATE_ALIAS_NOT_ALLOWED,
    ERROR.SYMBOL_MARKET_MISMATCH,
    ERROR.SOURCE_DATASET_ID_MISMATCH,
    ERROR.ADJUSTMENT_POLICY_MISMATCH,
    ERROR.INVALID_SYMBOL_ID,
    ERROR.INVALID_DATASET_ID,
    ERROR.SYMBOLS_NOT_SORTED,
    ERROR.MARKETS_NOT_SORTED,
    ERROR.CANDLES_NOT_SORTED,
  ]);

  if (dataset.canonicalizationVersion === CANONICALIZATION_VERSION) {
    if (typeof dataset.contentChecksum === "string") {
      const computed = computeDatasetContentChecksum(dataset);
      if (dataset.contentChecksum !== computed) {
        errors.push(makeError(ERROR.CONTENT_CHECKSUM_MISMATCH, {
          field: "contentChecksum",
          ...meta,
          contentChecksum: dataset.contentChecksum,
        }));
      }
    }
    if (typeof dataset.metadataHash === "string") {
      const computedMeta = computeDatasetMetadataHash(dataset);
      if (dataset.metadataHash !== computedMeta) {
        errors.push(makeError(ERROR.METADATA_HASH_MISMATCH, {
          field: "metadataHash",
          ...meta,
          metadataHash: dataset.metadataHash,
        }));
      }
    }
  }

  const schemaValid = !errors.some((err) => schemaErrorCodes.has(err.code));

  const checksumPresentAndMatch = typeof dataset.contentChecksum === "string"
    && dataset.contentChecksum === computeDatasetContentChecksum(dataset);
  const metadataPresentAndMatch = typeof dataset.metadataHash === "string"
    && dataset.metadataHash === computeDatasetMetadataHash(dataset);

  const candlesArr = Array.isArray(dataset.candles) ? dataset.candles : [];
  const explicitFinal = candlesArr.length > 0 && candlesArr.every((c) => (
    isPlainObject(c)
    && c.isFinal === true
    && c.candleFinality === FINALITY.FINAL
    && c.finalitySource === FINALITY_SOURCE.EXPLICIT_FINAL_FLAG
  ));

  const calendarValidationComplete = false;
  const datasetVerified = schemaValid
    && checksumPresentAndMatch
    && metadataPresentAndMatch
    && calendarValidationComplete
    && dataset.priceAdjustmentStatus === PRICE_ADJUSTMENT_STATUS.VERIFIED
    && dataset.corporateActionPolicyStatus === CORPORATE_ACTION_POLICY_STATUS.VERIFIED
    && dataset.survivorshipBiasControlled === true
    && explicitFinal
    && dataset.verificationStatus === VERIFICATION_STATUS.VERIFIED
    && dataset.notProductionData === false
    && dataset.productionEligible === true
    && mode === LOAD_MODE.PRODUCTION;

  return createValidationResult({
    schemaValid,
    datasetVerified,
    errors,
    missingData,
    warnings,
  });
}

module.exports = {
  LOAD_MODE,
  CANONICALIZATION_VERSION,
  SORT_ORDER,
  DATASET_TYPE,
  SOURCE_TYPE,
  FIXTURE_TYPE,
  VERIFICATION_STATUS,
  PRICE_ADJUSTMENT_STATUS,
  CORPORATE_ACTION_POLICY_STATUS,
  FINALITY,
  FINALITY_SOURCE,
  CANDLE_ADJUSTMENT,
  STATUS,
  ERROR,
  validateHistoricalDataset,
  validateCandle,
  computeDatasetContentChecksum,
  computeDatasetMetadataHash,
  createValidationResult,
};
