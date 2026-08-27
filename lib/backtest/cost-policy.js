/**
 * GATE 5D 시장별·시행일별 합성 비용 정책 엔진. 순수 CommonJS. I/O 없음.
 * 실제 주문·브로커·외부 API 연동 없음. 항상 executionStatus=NOT_EXECUTED.
 * 6Q: makeSafeCostError is a thin adapter onto shared makeBacktestError.
 */

"use strict";

const { parseYmd } = require("./schemas");
const { makeBacktestError } = require("./make-error");

const POLICY_ENGINE_VERSION = "market-effective-cost-v0.1";
const PPM = 1000000n;
const PPM_NUMBER = 1000000;
const MIN_SYNTHETIC_YEAR = 2100;
const MAX_SYNTHETIC_YEAR = 2199;

const CALCULATION_MODE = Object.freeze({
  SYNTHETIC_UNIT_TEST_ONLY: "SYNTHETIC_UNIT_TEST_ONLY",
});

const CALCULATION_STATUS = Object.freeze({
  SIMULATED_CALCULATION_ONLY: "SIMULATED_CALCULATION_ONLY",
});

const COST_CALCULATION_STATUS = Object.freeze({
  CALCULATED_SYNTHETIC_ONLY: "CALCULATED_SYNTHETIC_ONLY",
});

const EXECUTION_STATUS = Object.freeze({
  NOT_EXECUTED: "NOT_EXECUTED",
});

const FIXTURE_TYPE = Object.freeze({
  SYNTHETIC: "SYNTHETIC",
});

const POLICY_STATUS = Object.freeze({
  TEST_VERIFIED: "TEST_VERIFIED",
  USER_APPROVAL_REQUIRED: "USER_APPROVAL_REQUIRED",
  VERIFIED: "VERIFIED",
  REVOKED: "REVOKED",
});

const MARKET = Object.freeze({
  SYNTHETIC_KOSPI: "SYNTHETIC_KOSPI",
  SYNTHETIC_KOSDAQ: "SYNTHETIC_KOSDAQ",
});

const CURRENCY = Object.freeze({
  KRW: "KRW",
});

const BROKER_CHANNEL = Object.freeze({
  SYNTHETIC_ONLINE: "SYNTHETIC_ONLINE",
});

const ROUNDING_MODE = Object.freeze({
  FLOOR: "FLOOR",
  CEIL: "CEIL",
  ROUND_HALF_UP: "ROUND_HALF_UP",
});

const ROUNDING_MODE_VALUES = new Set(Object.values(ROUNDING_MODE));
const POLICY_STATUS_VALUES = new Set(Object.values(POLICY_STATUS));
const MARKET_VALUES = new Set(Object.values(MARKET));

const MISSING_DATA = Object.freeze({
  PRODUCTION_COST_POLICY_NOT_CONFIGURED: "PRODUCTION_COST_POLICY_NOT_CONFIGURED",
  CALENDAR_VALIDATION_NOT_IMPLEMENTED: "CALENDAR_VALIDATION_NOT_IMPLEMENTED",
});

const ERROR = Object.freeze({
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_INPUT: "INVALID_INPUT",
  NOT_PLAIN_OBJECT: "NOT_PLAIN_OBJECT",
  UNSUPPORTED_POLICY_ENGINE_VERSION: "UNSUPPORTED_POLICY_ENGINE_VERSION",
  UNSUPPORTED_CALCULATION_MODE: "UNSUPPORTED_CALCULATION_MODE",
  SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION: "SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION",
  INVALID_POLICY_ID: "INVALID_POLICY_ID",
  INVALID_POLICY_VERSION: "INVALID_POLICY_VERSION",
  INVALID_POLICY_STATUS: "INVALID_POLICY_STATUS",
  INVALID_MARKET: "INVALID_MARKET",
  INVALID_CURRENCY: "INVALID_CURRENCY",
  INVALID_BROKER_CHANNEL: "INVALID_BROKER_CHANNEL",
  INVALID_EFFECTIVE_DATE: "INVALID_EFFECTIVE_DATE",
  INVALID_EFFECTIVE_RANGE: "INVALID_EFFECTIVE_RANGE",
  INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
  INVALID_DATE_VALUE: "INVALID_DATE_VALUE",
  INVALID_RATE_PPM: "INVALID_RATE_PPM",
  INVALID_ROUNDING_MODE: "INVALID_ROUNDING_MODE",
  INVALID_MONEY_AMOUNT: "INVALID_MONEY_AMOUNT",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  INVALID_PRICE: "INVALID_PRICE",
  ARITHMETIC_OVERFLOW: "ARITHMETIC_OVERFLOW",
  COST_POLICY_NOT_FOUND: "COST_POLICY_NOT_FOUND",
  COST_POLICY_GAP: "COST_POLICY_GAP",
  COST_POLICY_OVERLAP: "COST_POLICY_OVERLAP",
  COST_POLICY_MARKET_MISMATCH: "COST_POLICY_MARKET_MISMATCH",
  COST_POLICY_NOT_VERIFIED: "COST_POLICY_NOT_VERIFIED",
  COST_POLICY_REVOKED: "COST_POLICY_REVOKED",
  DUPLICATE_TAX_TYPE: "DUPLICATE_TAX_TYPE",
  PRODUCTION_COST_POLICY_NOT_CONFIGURED: "PRODUCTION_COST_POLICY_NOT_CONFIGURED",
  CALENDAR_VALIDATION_NOT_IMPLEMENTED: "CALENDAR_VALIDATION_NOT_IMPLEMENTED",
});

const SAFE_ERROR_KEYS = Object.freeze([
  "code",
  "severity",
  "field",
  "recordIndex",
  "policyId",
  "policyVersion",
  "market",
  "tradingDate",
  "brokerChannel",
  "currency",
  "taxType",
]);

const POLICY_FIELDS = Object.freeze([
  "policyId",
  "policyVersion",
  "policyStatus",
  "fixtureType",
  "notProductionData",
  "productionEligible",
  "market",
  "currency",
  "effectiveFrom",
  "effectiveTo",
  "brokerChannel",
  "commission",
  "sellTaxes",
  "sourceReference",
  "verifiedAt",
]);

const COMMISSION_FIELDS = Object.freeze([
  "buyRatePpm",
  "sellRatePpm",
  "minimumBuyAmount",
  "minimumSellAmount",
  "roundingMode",
]);

const SELL_TAX_FIELDS = Object.freeze(["taxType", "ratePpm", "roundingMode"]);

const TRADE_TOP_KEYS = Object.freeze([
  "calculationMode",
  "mode",
  "market",
  "currency",
  "brokerChannel",
  "quantity",
  "entryTradingDate",
  "exitTradingDate",
  "entryPrice",
  "exitPrice",
  "policies",
  "policyEngineVersion",
]);

const POLICY_FIELD_SET = new Set(POLICY_FIELDS);
const COMMISSION_FIELD_SET = new Set(COMMISSION_FIELDS);
const SELL_TAX_FIELD_SET = new Set(SELL_TAX_FIELDS);
const TRADE_TOP_KEY_SET = new Set(TRADE_TOP_KEYS);
const ROUNDING_MODE_SET = ROUNDING_MODE_VALUES;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

function makeSafeCostError(raw) {
  if (!isPlainObject(raw)) {
    return { severity: "ERROR" };
  }
  const extra = {};
  for (const key of SAFE_ERROR_KEYS) {
    if (key === "code" || key === "severity") continue;
    if (raw[key] !== undefined && raw[key] !== null) extra[key] = raw[key];
  }
  const err = makeBacktestError(raw.code, extra);
  if (raw.code == null) {
    delete err.code;
  }
  err.severity = raw.severity != null ? raw.severity : "ERROR";
  return err;
}

function defaultMissingData(extra) {
  const set = new Set([
    MISSING_DATA.PRODUCTION_COST_POLICY_NOT_CONFIGURED,
    MISSING_DATA.CALENDAR_VALIDATION_NOT_IMPLEMENTED,
  ]);
  if (Array.isArray(extra)) {
    for (const item of extra) {
      if (item != null) set.add(item);
    }
  }
  return Array.from(set);
}

// GATE 9E: leftover SUCCESS amounts copy finite primitive numbers only.
// Do not coerce strings. Do not treat 0 as missing. Invalid values stay null.
function copyCanonicalAmount(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createCostResult(partial) {
  const src = isPlainObject(partial) ? partial : {};
  const errors = Array.isArray(src.errors)
    ? src.errors.map((e) => makeSafeCostError(e))
    : [];
  const ok = src.ok === true;
  return {
    ok,
    policyEngineVersion: POLICY_ENGINE_VERSION,
    executionStatus: EXECUTION_STATUS.NOT_EXECUTED,
    calculationStatus: CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY,
    costCalculationStatus: src.costCalculationStatus != null ? src.costCalculationStatus : null,
    entryPolicyId: src.entryPolicyId != null ? src.entryPolicyId : null,
    entryPolicyVersion: src.entryPolicyVersion != null ? src.entryPolicyVersion : null,
    exitPolicyId: src.exitPolicyId != null ? src.exitPolicyId : null,
    exitPolicyVersion: src.exitPolicyVersion != null ? src.exitPolicyVersion : null,
    entryAmount: copyCanonicalAmount(src.entryAmount),
    exitAmount: copyCanonicalAmount(src.exitAmount),
    entryCommission: copyCanonicalAmount(src.entryCommission),
    exitCommission: copyCanonicalAmount(src.exitCommission),
    // GATE 8I freeze: inbound nested object-spread leftover class 8E-8H is closed.
    // Do not reopen. Do not unify the makeError fold with the sellTaxes copy.
    // GATE 8K freeze: leftover object-spread / extra-overwrite / array-copy chapters
    // are closed. Remaining spreads are 7F / allowlisted extras / spread-first overlay.
    // GATE 8G: copy sellTaxes taxType/amount only. Do not spread t.
    // GATE 8H freeze: sellTaxes copy is taxType/amount only. Do not spread t.
    sellTaxes: Array.isArray(src.sellTaxes) ? src.sellTaxes.map((t) => ({
      taxType: t && t.taxType,
      amount: t && t.amount,
    })) : null,
    sellTaxTotal: copyCanonicalAmount(src.sellTaxTotal),
    totalCost: copyCanonicalAmount(src.totalCost),
    grossProfit: copyCanonicalAmount(src.grossProfit),
    netProfit: copyCanonicalAmount(src.netProfit),
    costPolicyVerified: false,
    costCalculationEligible: ok && src.costCalculationEligible === true,
    backtestExecutionEligible: false,
    promotionEligible: false,
    paperEligible: false,
    liveEligible: false,
    totalReturn: null,
    cagr: null,
    mdd: null,
    winRate: null,
    profitFactor: null,
    errors,
    errorCodes: uniqueCodes(errors),
    warnings: Array.isArray(src.warnings) ? src.warnings.slice() : [],
    missingData: defaultMissingData(src.missingData),
  };
}

function collectUnknownKeys(obj, allowed, fieldPrefix, extra) {
  const errors = [];
  if (!isPlainObject(obj)) return errors;
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(makeSafeCostError({
        ...extra,
        code: ERROR.UNKNOWN_FIELD,
        field: fieldPrefix ? `${fieldPrefix}.${key}` : key,
      }));
    }
  }
  return errors;
}

function requireFields(obj, fields, fieldPrefix, extra) {
  const errors = [];
  for (const field of fields) {
    if (!Object.hasOwn(obj, field)) {
      errors.push(makeSafeCostError({
        ...extra,
        code: ERROR.MISSING_FIELD,
        field: fieldPrefix ? `${fieldPrefix}.${field}` : field,
      }));
    }
  }
  return errors;
}

function checkRequiredString(value, field, errors, extra) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    errors.push(makeSafeCostError({
      ...extra,
      code: field.includes("policyId") ? ERROR.INVALID_POLICY_ID : ERROR.INVALID_POLICY_VERSION,
      field,
    }));
    return false;
  }
  return true;
}

function parseSyntheticEffectiveDate(value, field, errors, extra) {
  const parsed = parseYmd(value);
  if (!parsed.ok) {
    errors.push(makeSafeCostError({
      ...extra,
      code: parsed.code === ERROR.INVALID_DATE_VALUE
        ? ERROR.INVALID_EFFECTIVE_DATE
        : ERROR.INVALID_EFFECTIVE_DATE,
      field,
    }));
    return null;
  }
  const year = Number(parsed.date.slice(0, 4));
  if (year < MIN_SYNTHETIC_YEAR || year > MAX_SYNTHETIC_YEAR) {
    errors.push(makeSafeCostError({
      ...extra,
      code: ERROR.INVALID_EFFECTIVE_DATE,
      field,
    }));
    return null;
  }
  return parsed.date;
}

function parseTradingDate(value, field, errors, extra) {
  const parsed = parseYmd(value);
  if (!parsed.ok) {
    errors.push(makeSafeCostError({
      ...extra,
      code: ERROR.INVALID_EFFECTIVE_DATE,
      field,
    }));
    return null;
  }
  const year = Number(parsed.date.slice(0, 4));
  if (year < MIN_SYNTHETIC_YEAR || year > MAX_SYNTHETIC_YEAR) {
    errors.push(makeSafeCostError({
      ...extra,
      code: ERROR.INVALID_EFFECTIVE_DATE,
      field,
    }));
    return null;
  }
  return parsed.date;
}

function addDaysYmd(ymd, days) {
  const parsed = parseYmd(ymd);
  if (!parsed.ok) return null;
  const year = Number(parsed.date.slice(0, 4));
  const month = Number(parsed.date.slice(5, 7));
  const day = Number(parsed.date.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function isValidRatePpm(value) {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value >= 0;
}

function isValidMoneyAmount(value) {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value >= 0
    && Number.isSafeInteger(value);
}

function isValidQuantity(value) {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value > 0
    && Number.isSafeInteger(value);
}

function isValidPrice(value) {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value > 0
    && Number.isSafeInteger(value);
}

function checkRatePpm(value, field, errors, extra) {
  if (!isValidRatePpm(value)) {
    // GATE 8N freeze: GATE 8M spread extra/taxExtra first so code/field win. Do not put extra last.
    // GATE 8U freeze: allowlist extra leftover class 8M-8T is closed. Do not reopen. Do not unify with 8I inbound-spread, 8D extra-overwrite, or 8L adapter.
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_RATE_PPM, field }));
    return false;
  }
  return true;
}

function checkRoundingMode(value, field, errors, extra) {
  if (typeof value !== "string" || !ROUNDING_MODE_SET.has(value)) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_ROUNDING_MODE, field }));
    return false;
  }
  return true;
}

function policyGroupKey(policy) {
  return `${policy.market}|${policy.brokerChannel}|${policy.currency}`;
}

function dateInRange(tradingDate, from, to) {
  if (tradingDate < from) return false;
  if (to != null && tradingDate > to) return false;
  return true;
}

function rangesOverlap(fromA, toA, fromB, toB) {
  const endA = toA == null ? "9999-12-31" : toA;
  const endB = toB == null ? "9999-12-31" : toB;
  return fromA <= endB && fromB <= endA;
}

function safeMultiply(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    return { ok: false, product: null, code: ERROR.ARITHMETIC_OVERFLOW };
  }
  if (a !== 0 && b !== 0) {
    if (Math.abs(a) > Math.floor(Number.MAX_SAFE_INTEGER / Math.abs(b))) {
      return { ok: false, product: null, code: ERROR.ARITHMETIC_OVERFLOW };
    }
  }
  return { ok: true, product: a * b, code: null };
}

function applyRatePpm(amount, ratePpm, roundingMode) {
  if (!isValidMoneyAmount(amount)) {
    return { ok: false, amount: null, code: ERROR.INVALID_MONEY_AMOUNT };
  }
  if (!isValidRatePpm(ratePpm)) {
    return { ok: false, amount: null, code: ERROR.INVALID_RATE_PPM };
  }
  if (!ROUNDING_MODE_SET.has(roundingMode)) {
    return { ok: false, amount: null, code: ERROR.INVALID_ROUNDING_MODE };
  }

  const product = BigInt(amount) * BigInt(ratePpm);
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, amount: null, code: ERROR.ARITHMETIC_OVERFLOW };
  }

  const quotient = product / PPM;
  const remainder = product % PPM;
  let rounded;
  if (roundingMode === ROUNDING_MODE.FLOOR) {
    rounded = quotient;
  } else if (roundingMode === ROUNDING_MODE.CEIL) {
    rounded = remainder === 0n ? quotient : quotient + 1n;
  } else {
    rounded = remainder * 2n >= PPM ? quotient + 1n : quotient;
  }

  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    return { ok: false, amount: null, code: ERROR.ARITHMETIC_OVERFLOW };
  }
  return { ok: true, amount: result, code: null };
}

function calculateCommission(input) {
  if (!isPlainObject(input)) {
    return { ok: false, amount: null, code: ERROR.INVALID_INPUT };
  }
  const { amount, ratePpm, minimumAmount, roundingMode } = input;
  const rounded = applyRatePpm(amount, ratePpm, roundingMode);
  if (!rounded.ok) {
    return { ok: false, amount: null, code: rounded.code };
  }
  if (!isValidMoneyAmount(minimumAmount)) {
    return { ok: false, amount: null, code: ERROR.INVALID_MONEY_AMOUNT };
  }
  return { ok: true, amount: Math.max(rounded.amount, minimumAmount), code: null };
}

function calculateSellTaxes(input) {
  if (!isPlainObject(input)) {
    return { ok: false, taxes: [], total: null, code: ERROR.INVALID_INPUT };
  }
  const amount = input.amount;
  const sellTaxes = input.sellTaxes;
  if (!isValidMoneyAmount(amount)) {
    return { ok: false, taxes: [], total: null, code: ERROR.INVALID_MONEY_AMOUNT };
  }
  if (!Array.isArray(sellTaxes)) {
    return { ok: false, taxes: [], total: null, code: ERROR.INVALID_INPUT };
  }

  const taxes = [];
  let total = 0;
  for (let i = 0; i < sellTaxes.length; i += 1) {
    const tax = sellTaxes[i];
    if (!isPlainObject(tax)) {
      return { ok: false, taxes: [], total: null, code: ERROR.INVALID_INPUT };
    }
    const applied = applyRatePpm(amount, tax.ratePpm, tax.roundingMode);
    if (!applied.ok) {
      return { ok: false, taxes: [], total: null, code: applied.code };
    }
    taxes.push({ taxType: tax.taxType, amount: applied.amount });
    const sum = total + applied.amount;
    if (!Number.isSafeInteger(sum)) {
      return { ok: false, taxes: [], total: null, code: ERROR.ARITHMETIC_OVERFLOW };
    }
    total = sum;
  }
  return { ok: true, taxes, total, code: null };
}

function validateCostPolicy(policy, context) {
  const ctx = isPlainObject(context) ? context : {};
  const recordIndex = Number.isInteger(ctx.recordIndex) ? ctx.recordIndex : undefined;
  const extra = recordIndex != null ? { recordIndex } : {};
  const errors = [];

  if (!isPlainObject(policy)) {
    errors.push(makeSafeCostError({
      ...extra,
      code: ERROR.NOT_PLAIN_OBJECT,
      field: "policy",
    }));
    return { ok: false, errors };
  }

  errors.push(...collectUnknownKeys(policy, POLICY_FIELD_SET, null, extra));
  errors.push(...requireFields(policy, POLICY_FIELDS.filter((f) => f !== "sourceReference" && f !== "verifiedAt"), null, extra));

  if (Object.hasOwn(policy, "policyId")) {
    if (typeof policy.policyId !== "string" || !policy.policyId.startsWith("synthetic-cost-")) {
      errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_POLICY_ID, field: "policyId" }));
    }
  }

  if (Object.hasOwn(policy, "policyVersion")) {
    if (typeof policy.policyVersion !== "string" || policy.policyVersion.length === 0) {
      errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_POLICY_VERSION, field: "policyVersion" }));
    }
  }

  if (Object.hasOwn(policy, "policyStatus")) {
    if (!POLICY_STATUS_VALUES.has(policy.policyStatus)) {
      errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_POLICY_STATUS, field: "policyStatus" }));
    }
  }

  if (Object.hasOwn(policy, "fixtureType") && policy.fixtureType !== FIXTURE_TYPE.SYNTHETIC) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.UNKNOWN_FIELD, field: "fixtureType" }));
  }

  if (Object.hasOwn(policy, "notProductionData") && policy.notProductionData !== true) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_INPUT, field: "notProductionData" }));
  }

  if (Object.hasOwn(policy, "productionEligible") && policy.productionEligible !== false) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_INPUT, field: "productionEligible" }));
  }

  if (Object.hasOwn(policy, "market")) {
    if (!MARKET_VALUES.has(policy.market)) {
      errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_MARKET, field: "market" }));
    }
  }

  if (Object.hasOwn(policy, "currency") && policy.currency !== CURRENCY.KRW) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_CURRENCY, field: "currency" }));
  }

  if (Object.hasOwn(policy, "brokerChannel") && policy.brokerChannel !== BROKER_CHANNEL.SYNTHETIC_ONLINE) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_BROKER_CHANNEL, field: "brokerChannel" }));
  }

  let effectiveFrom = null;
  let effectiveTo = null;
  if (Object.hasOwn(policy, "effectiveFrom")) {
    effectiveFrom = parseSyntheticEffectiveDate(policy.effectiveFrom, "effectiveFrom", errors, extra);
  }
  if (Object.hasOwn(policy, "effectiveTo") && policy.effectiveTo != null) {
    effectiveTo = parseSyntheticEffectiveDate(policy.effectiveTo, "effectiveTo", errors, extra);
  }
  if (effectiveFrom != null && effectiveTo != null && effectiveFrom > effectiveTo) {
    errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_EFFECTIVE_RANGE, field: "effectiveFrom" }));
  }

  if (Object.hasOwn(policy, "commission")) {
    const commission = policy.commission;
    if (!isPlainObject(commission)) {
      errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_INPUT, field: "commission" }));
    } else {
      errors.push(...collectUnknownKeys(commission, COMMISSION_FIELD_SET, "commission", extra));
      errors.push(...requireFields(commission, COMMISSION_FIELDS, "commission", extra));
      if (Object.hasOwn(commission, "buyRatePpm")) {
        checkRatePpm(commission.buyRatePpm, "commission.buyRatePpm", errors, extra);
      }
      if (Object.hasOwn(commission, "sellRatePpm")) {
        checkRatePpm(commission.sellRatePpm, "commission.sellRatePpm", errors, extra);
      }
      if (Object.hasOwn(commission, "minimumBuyAmount")) {
        if (!isValidMoneyAmount(commission.minimumBuyAmount)) {
          errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_MONEY_AMOUNT, field: "commission.minimumBuyAmount" }));
        }
      }
      if (Object.hasOwn(commission, "minimumSellAmount")) {
        if (!isValidMoneyAmount(commission.minimumSellAmount)) {
          errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_MONEY_AMOUNT, field: "commission.minimumSellAmount" }));
        }
      }
      if (Object.hasOwn(commission, "roundingMode")) {
        checkRoundingMode(commission.roundingMode, "commission.roundingMode", errors, extra);
      }
    }
  }

  if (Object.hasOwn(policy, "sellTaxes")) {
    if (!Array.isArray(policy.sellTaxes)) {
      errors.push(makeSafeCostError({ ...extra, code: ERROR.INVALID_INPUT, field: "sellTaxes" }));
    } else {
      const seenTaxTypes = new Set();
      for (let i = 0; i < policy.sellTaxes.length; i += 1) {
        const tax = policy.sellTaxes[i];
        const taxExtra = { ...extra, recordIndex: recordIndex != null ? recordIndex : i };
        if (!isPlainObject(tax)) {
          errors.push(makeSafeCostError({ ...taxExtra, code: ERROR.INVALID_INPUT, field: `sellTaxes[${i}]` }));
          continue;
        }
        errors.push(...collectUnknownKeys(tax, SELL_TAX_FIELD_SET, `sellTaxes[${i}]`, taxExtra));
        errors.push(...requireFields(tax, SELL_TAX_FIELDS, `sellTaxes[${i}]`, taxExtra));
        if (Object.hasOwn(tax, "taxType")) {
          if (typeof tax.taxType !== "string" || tax.taxType.length === 0) {
            errors.push(makeSafeCostError({ ...taxExtra, code: ERROR.INVALID_INPUT, field: `sellTaxes[${i}].taxType` }));
          } else if (seenTaxTypes.has(tax.taxType)) {
            errors.push(makeSafeCostError({
              ...taxExtra,
              code: ERROR.DUPLICATE_TAX_TYPE,
              field: `sellTaxes[${i}].taxType`,
              taxType: tax.taxType,
            }));
          } else {
            seenTaxTypes.add(tax.taxType);
          }
        }
        if (Object.hasOwn(tax, "ratePpm")) {
          checkRatePpm(tax.ratePpm, `sellTaxes[${i}].ratePpm`, errors, taxExtra);
        }
        if (Object.hasOwn(tax, "roundingMode")) {
          checkRoundingMode(tax.roundingMode, `sellTaxes[${i}].roundingMode`, errors, taxExtra);
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

function validateCostPolicySet(policies) {
  if (!Array.isArray(policies)) {
    return {
      ok: false,
      errors: [makeSafeCostError({ code: ERROR.INVALID_INPUT, field: "policies" })],
    };
  }

  const errors = [];
  const validPolicies = [];

  for (let i = 0; i < policies.length; i += 1) {
    const result = validateCostPolicy(policies[i], { recordIndex: i });
    if (!result.ok) {
      errors.push(...result.errors);
    } else {
      validPolicies.push({ policy: policies[i], index: i });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const groups = new Map();
  for (const item of validPolicies) {
    const key = policyGroupKey(item.policy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const items of groups.values()) {
    const sorted = items.slice().sort((a, b) => {
      if (a.policy.effectiveFrom === b.policy.effectiveFrom) {
        return a.index - b.index;
      }
      return a.policy.effectiveFrom < b.policy.effectiveFrom ? -1 : 1;
    });

    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i].policy;
        const b = sorted[j].policy;
        if (rangesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)) {
          errors.push(makeSafeCostError({
            code: ERROR.COST_POLICY_OVERLAP,
            policyId: b.policyId,
            market: b.market,
            brokerChannel: b.brokerChannel,
            currency: b.currency,
          }));
          break;
        }
      }
    }

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i].policy;
      const next = sorted[i + 1].policy;
      if (current.effectiveTo == null) {
        errors.push(makeSafeCostError({
          code: ERROR.COST_POLICY_OVERLAP,
          policyId: next.policyId,
          market: next.market,
          brokerChannel: next.brokerChannel,
          currency: next.currency,
        }));
        continue;
      }
      if (next.effectiveFrom <= current.effectiveTo) {
        errors.push(makeSafeCostError({
          code: ERROR.COST_POLICY_OVERLAP,
          policyId: next.policyId,
          market: next.market,
          brokerChannel: next.brokerChannel,
          currency: next.currency,
        }));
        continue;
      }
      const expectedNext = addDaysYmd(current.effectiveTo, 1);
      if (expectedNext != null && next.effectiveFrom > expectedNext) {
        errors.push(makeSafeCostError({
          code: ERROR.COST_POLICY_GAP,
          policyId: next.policyId,
          market: next.market,
          brokerChannel: next.brokerChannel,
          currency: next.currency,
        }));
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

function checkPolicyCalculationStatus(policy, tradingDate) {
  if (policy.policyStatus === POLICY_STATUS.REVOKED) {
    return {
      ok: false,
      code: ERROR.COST_POLICY_REVOKED,
      error: makeSafeCostError({
        code: ERROR.COST_POLICY_REVOKED,
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        market: policy.market,
        tradingDate,
        brokerChannel: policy.brokerChannel,
        currency: policy.currency,
      }),
    };
  }
  if (policy.policyStatus !== POLICY_STATUS.TEST_VERIFIED) {
    const code = policy.policyStatus === POLICY_STATUS.USER_APPROVAL_REQUIRED
      ? ERROR.COST_POLICY_NOT_VERIFIED
      : ERROR.COST_POLICY_NOT_VERIFIED;
    return {
      ok: false,
      code,
      error: makeSafeCostError({
        code,
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        market: policy.market,
        tradingDate,
        brokerChannel: policy.brokerChannel,
        currency: policy.currency,
      }),
    };
  }
  return { ok: true, code: null, error: null };
}

function selectEffectiveCostPolicy(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      policy: null,
      code: ERROR.INVALID_INPUT,
      errors: [makeSafeCostError({ code: ERROR.INVALID_INPUT })],
    };
  }

  const {
    market,
    tradingDate,
    brokerChannel,
    currency,
    policies,
  } = input;

  const errors = [];
  if (!MARKET_VALUES.has(market)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_MARKET, field: "market", market }));
  }
  if (typeof tradingDate !== "string") {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_EFFECTIVE_DATE, field: "tradingDate", tradingDate }));
  }
  if (brokerChannel !== BROKER_CHANNEL.SYNTHETIC_ONLINE) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_BROKER_CHANNEL, field: "brokerChannel", brokerChannel }));
  }
  if (currency !== CURRENCY.KRW) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_CURRENCY, field: "currency", currency }));
  }
  if (!Array.isArray(policies)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_INPUT, field: "policies" }));
  }
  if (errors.length > 0) {
    return { ok: false, policy: null, code: errors[0].code, errors };
  }

  const matches = [];
  for (let i = 0; i < policies.length; i += 1) {
    const policy = policies[i];
    if (!isPlainObject(policy)) continue;
    if (policy.market !== market) continue;
    if (policy.brokerChannel !== brokerChannel) continue;
    if (policy.currency !== currency) continue;
    if (!dateInRange(tradingDate, policy.effectiveFrom, policy.effectiveTo)) continue;
    matches.push({ policy, index: i });
  }

  if (matches.length === 1) {
    return { ok: true, policy: matches[0].policy, code: null, errors: [] };
  }

  if (matches.length > 1) {
    const err = makeSafeCostError({
      code: ERROR.COST_POLICY_OVERLAP,
      market,
      tradingDate,
      brokerChannel,
      currency,
    });
    return { ok: false, policy: null, code: ERROR.COST_POLICY_OVERLAP, errors: [err] };
  }

  const sameChannelCurrency = policies.filter((policy) => isPlainObject(policy)
    && policy.brokerChannel === brokerChannel
    && policy.currency === currency);
  const hasOtherMarket = sameChannelCurrency.some((policy) => policy.market !== market);
  const code = hasOtherMarket ? ERROR.COST_POLICY_MARKET_MISMATCH : ERROR.COST_POLICY_NOT_FOUND;
  return {
    ok: false,
    policy: null,
    code,
    errors: [makeSafeCostError({ code, market, tradingDate, brokerChannel, currency })],
  };
}

function validateTradeCostInput(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [makeSafeCostError({ code: ERROR.NOT_PLAIN_OBJECT, field: null })],
    };
  }

  errors.push(...collectUnknownKeys(input, TRADE_TOP_KEY_SET, null, {}));

  const required = [
    "calculationMode",
    "market",
    "currency",
    "brokerChannel",
    "quantity",
    "entryTradingDate",
    "exitTradingDate",
    "entryPrice",
    "exitPrice",
    "policies",
  ];
  errors.push(...requireFields(input, required, null, {}));

  if (Object.hasOwn(input, "policyEngineVersion")) {
    if (input.policyEngineVersion !== POLICY_ENGINE_VERSION) {
      errors.push(makeSafeCostError({
        code: ERROR.UNSUPPORTED_POLICY_ENGINE_VERSION,
        field: "policyEngineVersion",
      }));
    }
  }

  if (Object.hasOwn(input, "calculationMode")
    && input.calculationMode !== CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY) {
    errors.push(makeSafeCostError({
      code: ERROR.UNSUPPORTED_CALCULATION_MODE,
      field: "calculationMode",
    }));
  }

  if (Object.hasOwn(input, "mode") && input.mode === "PRODUCTION") {
    errors.push(makeSafeCostError({
      code: ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION,
      field: "mode",
    }));
  }

  if (Object.hasOwn(input, "calculationMode") && input.calculationMode === "PRODUCTION") {
    errors.push(makeSafeCostError({
      code: ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION,
      field: "calculationMode",
    }));
  }

  if (Object.hasOwn(input, "market") && !MARKET_VALUES.has(input.market)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_MARKET, field: "market" }));
  }

  if (Object.hasOwn(input, "currency") && input.currency !== CURRENCY.KRW) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_CURRENCY, field: "currency" }));
  }

  if (Object.hasOwn(input, "brokerChannel") && input.brokerChannel !== BROKER_CHANNEL.SYNTHETIC_ONLINE) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_BROKER_CHANNEL, field: "brokerChannel" }));
  }

  if (Object.hasOwn(input, "quantity") && !isValidQuantity(input.quantity)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_QUANTITY, field: "quantity" }));
  }

  if (Object.hasOwn(input, "entryPrice") && !isValidPrice(input.entryPrice)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_PRICE, field: "entryPrice" }));
  }

  if (Object.hasOwn(input, "exitPrice") && !isValidPrice(input.exitPrice)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_PRICE, field: "exitPrice" }));
  }

  if (Object.hasOwn(input, "entryTradingDate")) {
    parseTradingDate(input.entryTradingDate, "entryTradingDate", errors, {});
  }
  if (Object.hasOwn(input, "exitTradingDate")) {
    parseTradingDate(input.exitTradingDate, "exitTradingDate", errors, {});
  }

  if (Object.hasOwn(input, "policies") && !Array.isArray(input.policies)) {
    errors.push(makeSafeCostError({ code: ERROR.INVALID_INPUT, field: "policies" }));
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

// GATE 7X: extra is allowlisted (warnings/missingData only). Do not spread src;
// that would overwrite ok/errors/flags and copy leftover amounts.
// GATE 7Y freeze: do not add leftover amounts or official flags on this helper.
// createCostResult keys stay ok, costCalculationEligible, errors, warnings, missingData.
// GATE 8D freeze: extra-overwrite leftover class 7X-8C is closed. Do not reopen.
// GATE 9B freeze: leftover-class audit after 8Z. Do not reopen 8D/8C.
function blockedCostResult(errors, extra) {
  const src = extra || {};
  return createCostResult({
    ok: false,
    costCalculationEligible: false,
    errors,
    warnings: src.warnings,
    missingData: src.missingData,
  });
}

function calculateSyntheticTradeCost(input) {
  const validated = validateTradeCostInput(input);
  if (!validated.ok) {
    return blockedCostResult(validated.errors);
  }

  if (input.calculationMode !== CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY) {
    return blockedCostResult([makeSafeCostError({
      code: ERROR.UNSUPPORTED_CALCULATION_MODE,
      field: "calculationMode",
    })]);
  }

  if (input.mode === "PRODUCTION" || input.calculationMode === "PRODUCTION") {
    return blockedCostResult([makeSafeCostError({
      code: ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION,
      field: "calculationMode",
    })]);
  }

  for (let i = 0; i < input.policies.length; i += 1) {
    const policy = input.policies[i];
    if (isPlainObject(policy)) {
      if (policy.productionEligible === true) {
        return blockedCostResult([makeSafeCostError({
          code: ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION,
          field: "policies",
          recordIndex: i,
          policyId: policy.policyId,
        })]);
      }
      if (policy.fixtureType !== FIXTURE_TYPE.SYNTHETIC) {
        return blockedCostResult([makeSafeCostError({
          code: ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION,
          field: "policies",
          recordIndex: i,
          policyId: policy.policyId,
        })]);
      }
    }
  }

  const setValidation = validateCostPolicySet(input.policies);
  if (!setValidation.ok) {
    return blockedCostResult(setValidation.errors);
  }

  const entryAmountMul = safeMultiply(input.quantity, input.entryPrice);
  if (!entryAmountMul.ok) {
    return blockedCostResult([makeSafeCostError({
      code: entryAmountMul.code,
      field: "entryPrice",
    })]);
  }
  const exitAmountMul = safeMultiply(input.quantity, input.exitPrice);
  if (!exitAmountMul.ok) {
    return blockedCostResult([makeSafeCostError({
      code: exitAmountMul.code,
      field: "exitPrice",
    })]);
  }
  const entryAmount = entryAmountMul.product;
  const exitAmount = exitAmountMul.product;
  // 7C: late BLOCKED omits leftover amounts so they stay null like early BLOCKED.

  const selectionBase = {
    market: input.market,
    brokerChannel: input.brokerChannel,
    currency: input.currency,
    policies: input.policies,
  };

  const entrySelection = selectEffectiveCostPolicy({
    ...selectionBase,
    tradingDate: input.entryTradingDate,
  });
  if (!entrySelection.ok) {
    return blockedCostResult(entrySelection.errors);
  }

  const exitSelection = selectEffectiveCostPolicy({
    ...selectionBase,
    tradingDate: input.exitTradingDate,
  });
  if (!exitSelection.ok) {
    return blockedCostResult(exitSelection.errors);
  }

  const entryPolicy = entrySelection.policy;
  const exitPolicy = exitSelection.policy;

  const entryStatus = checkPolicyCalculationStatus(entryPolicy, input.entryTradingDate);
  if (!entryStatus.ok) {
    return blockedCostResult([entryStatus.error]);
  }
  const exitStatus = checkPolicyCalculationStatus(exitPolicy, input.exitTradingDate);
  if (!exitStatus.ok) {
    return blockedCostResult([exitStatus.error]);
  }

  const entryCommissionResult = calculateCommission({
    amount: entryAmount,
    ratePpm: entryPolicy.commission.buyRatePpm,
    minimumAmount: entryPolicy.commission.minimumBuyAmount,
    roundingMode: entryPolicy.commission.roundingMode,
  });
  if (!entryCommissionResult.ok) {
    return blockedCostResult([makeSafeCostError({
      code: entryCommissionResult.code,
      field: "entryCommission",
      policyId: entryPolicy.policyId,
    })]);
  }

  const exitCommissionResult = calculateCommission({
    amount: exitAmount,
    ratePpm: exitPolicy.commission.sellRatePpm,
    minimumAmount: exitPolicy.commission.minimumSellAmount,
    roundingMode: exitPolicy.commission.roundingMode,
  });
  if (!exitCommissionResult.ok) {
    return blockedCostResult([makeSafeCostError({
      code: exitCommissionResult.code,
      field: "exitCommission",
      policyId: exitPolicy.policyId,
    })]);
  }

  const sellTaxesResult = calculateSellTaxes({
    amount: exitAmount,
    sellTaxes: exitPolicy.sellTaxes,
  });
  if (!sellTaxesResult.ok) {
    return blockedCostResult([makeSafeCostError({
      code: sellTaxesResult.code,
      field: "sellTaxes",
      policyId: exitPolicy.policyId,
    })]);
  }

  const entryCommission = entryCommissionResult.amount;
  const exitCommission = exitCommissionResult.amount;
  const sellTaxTotal = sellTaxesResult.total;
  const totalCostSum = entryCommission + exitCommission + sellTaxTotal;
  if (!Number.isSafeInteger(totalCostSum)) {
    return blockedCostResult([makeSafeCostError({ code: ERROR.ARITHMETIC_OVERFLOW, field: "totalCost" })]);
  }

  const grossProfit = exitAmount - entryAmount;
  const netProfit = grossProfit - totalCostSum;

  return createCostResult({
    ok: true,
    costCalculationEligible: true,
    costCalculationStatus: COST_CALCULATION_STATUS.CALCULATED_SYNTHETIC_ONLY,
    entryPolicyId: entryPolicy.policyId,
    entryPolicyVersion: entryPolicy.policyVersion,
    exitPolicyId: exitPolicy.policyId,
    exitPolicyVersion: exitPolicy.policyVersion,
    entryAmount,
    exitAmount,
    entryCommission,
    exitCommission,
    sellTaxes: sellTaxesResult.taxes,
    sellTaxTotal,
    totalCost: totalCostSum,
    grossProfit,
    netProfit,
  });
}

module.exports = {
  POLICY_ENGINE_VERSION,
  CALCULATION_MODE,
  CALCULATION_STATUS,
  COST_CALCULATION_STATUS,
  EXECUTION_STATUS,
  FIXTURE_TYPE,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
  ROUNDING_MODE,
  MISSING_DATA,
  ERROR,
  validateCostPolicy,
  validateCostPolicySet,
  validateTradeCostInput,
  selectEffectiveCostPolicy,
  applyRatePpm,
  calculateCommission,
  calculateSellTaxes,
  calculateSyntheticTradeCost,
  createCostResult,
  blockedCostResult,
  makeSafeCostError,
  SAFE_ERROR_KEYS,
};
