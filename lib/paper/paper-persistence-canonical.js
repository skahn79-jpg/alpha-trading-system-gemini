/**
 * GATE 11O Paper persistence canonical digest and clone.
 * SHA-256 via node:crypto only. No network. No fs writes.
 */

"use strict";

const { createHash } = require("node:crypto");
const {
  isPlainObject,
  hasOwnRecordKey,
} = require("./paper-account-state");

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

const PERSISTENCE_ERROR = Object.freeze({
  PAPER_PERSISTENCE_INVALID_INPUT: "PAPER_PERSISTENCE_INVALID_INPUT",
  PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND: "PAPER_PERSISTENCE_ACCOUNT_NOT_FOUND",
  PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT: "PAPER_PERSISTENCE_ACCOUNT_ALREADY_EXISTS_CONFLICT",
  PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA: "PAPER_PERSISTENCE_UNSUPPORTED_SCHEMA",
  PAPER_PERSISTENCE_CORRUPT_STATE: "PAPER_PERSISTENCE_CORRUPT_STATE",
  PAPER_PERSISTENCE_IDENTITY_CONFLICT: "PAPER_PERSISTENCE_IDENTITY_CONFLICT",
  PAPER_PERSISTENCE_REVISION_CONFLICT: "PAPER_PERSISTENCE_REVISION_CONFLICT",
  PAPER_PERSISTENCE_RETRY_EXHAUSTED: "PAPER_PERSISTENCE_RETRY_EXHAUSTED",
  PAPER_PERSISTENCE_REVISION_OVERFLOW: "PAPER_PERSISTENCE_REVISION_OVERFLOW",
  PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED: "PAPER_PERSISTENCE_RESOURCE_LIMIT_EXCEEDED",
  PAPER_PERSISTENCE_COMMIT_FAILED: "PAPER_PERSISTENCE_COMMIT_FAILED",
  PAPER_PERSISTENCE_COMMIT_UNKNOWN: "PAPER_PERSISTENCE_COMMIT_UNKNOWN",
  PAPER_PERSISTENCE_QUARANTINED: "PAPER_PERSISTENCE_QUARANTINED",
});

const REQUEST_PREFIX = "paper-request-v1:";
const CREATE_PREFIX = "paper-account-create-v1:";
const EXEC_PREFIX = "paper-exec-v1:";

function setOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return record;
}

function isBoxedPrimitive(value) {
  return value instanceof Number
    || value instanceof String
    || value instanceof Boolean;
}

function rejectCanonical(field) {
  const err = new Error("canonical value rejected");
  err.code = PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT;
  if (field !== undefined) err.field = field;
  return err;
}

function encodeCanonical(value, field) {
  if (value === undefined) throw rejectCanonical(field);
  const valueType = typeof value;
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw rejectCanonical(field);
  }
  if (valueType === "number") {
    if (!Number.isFinite(value)) throw rejectCanonical(field);
    return JSON.stringify(value);
  }
  if (valueType === "boolean") return value ? "true" : "false";
  if (valueType === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (valueType !== "object") throw rejectCanonical(field);
  if (value instanceof Date) throw rejectCanonical(field);
  if (isBoxedPrimitive(value)) throw rejectCanonical(field);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i += 1) {
      parts.push(encodeCanonical(value[i], field));
    }
    return "[" + parts.join(",") + "]";
  }
  if (!isPlainObject(value)) throw rejectCanonical(field);
  const keys = Object.keys(value).slice();
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    parts.push(JSON.stringify(key) + ":" + encodeCanonical(value[key], key));
  }
  return "{" + parts.join(",") + "}";
}

function sha256Hex(utf8Text) {
  return createHash("sha256").update(utf8Text, "utf8").digest("hex");
}

function deepCloneOwn(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i += 1) {
      out.push(deepCloneOwn(value[i]));
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  const out = proto === null ? Object.create(null) : {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setOwn(out, key, deepCloneOwn(value[key]));
  }
  return out;
}

function projectOwnFields(source, fields, fieldName) {
  if (!isPlainObject(source)) throw rejectCanonical(fieldName);
  const out = {};
  for (let i = 0; i < fields.length; i += 1) {
    const key = fields[i];
    if (!hasOwnRecordKey(source, key)) continue;
    setOwn(out, key, source[key]);
  }
  return out;
}

function projectPolicy(policy) {
  if (!isPlainObject(policy)) throw rejectCanonical("policies");
  const out = {};
  for (let i = 0; i < POLICY_FIELDS.length; i += 1) {
    const key = POLICY_FIELDS[i];
    if (!hasOwnRecordKey(policy, key)) continue;
    if (key === "commission") {
      setOwn(out, key, projectOwnFields(policy.commission, COMMISSION_FIELDS, "commission"));
    } else if (key === "sellTaxes") {
      const taxes = policy.sellTaxes;
      if (!Array.isArray(taxes)) throw rejectCanonical("sellTaxes");
      const projected = [];
      for (let t = 0; t < taxes.length; t += 1) {
        projected.push(projectOwnFields(taxes[t], SELL_TAX_FIELDS, "sellTaxes"));
      }
      setOwn(out, key, projected);
    } else {
      setOwn(out, key, policy[key]);
    }
  }
  return out;
}

function sortAllowedList(list, field) {
  if (!Array.isArray(list)) throw rejectCanonical(field);
  const copy = list.slice();
  for (let i = 0; i < copy.length; i += 1) {
    if (typeof copy[i] !== "string") throw rejectCanonical(field);
  }
  copy.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return copy;
}

function pickRequired(source, fields, fieldName) {
  if (!isPlainObject(source)) throw rejectCanonical(fieldName);
  const out = {};
  for (let i = 0; i < fields.length; i += 1) {
    const key = fields[i];
    if (!hasOwnRecordKey(source, key)) throw rejectCanonical(key);
    setOwn(out, key, source[key]);
  }
  return out;
}

function buildCanonicalRequest(input) {
  const src = isPlainObject(input) ? input : {};
  try {
    if (typeof src.accountId !== "string" || src.accountId.length === 0) {
      throw rejectCanonical("accountId");
    }
    if (typeof src.paperExecutionEnabled !== "boolean") {
      throw rejectCanonical("paperExecutionEnabled");
    }
    const marketEvent = pickRequired(src.marketEvent, [
      "eventId", "market", "symbol", "tradingDate", "sequence", "open",
    ], "marketEvent");
    const orderIntent = pickRequired(src.orderIntent, [
      "intentId", "mode", "market", "symbol", "side", "orderType", "quantity", "signalSequence",
    ], "orderIntent");
    const riskDecision = pickRequired(src.riskDecision, [
      "riskDecisionId", "intentId", "approved",
      "requestedQuantity", "approvedQuantity", "validAfterEventSequence",
    ], "riskDecision");
    const userApproval = pickRequired(src.userApproval, [
      "approvalId", "intentId", "riskDecisionId",
      "approved", "approvedQuantity", "validAfterEventSequence",
    ], "userApproval");
    const riskConfigSrc = isPlainObject(src.riskConfig) ? src.riskConfig : null;
    if (!riskConfigSrc) throw rejectCanonical("riskConfig");
    const riskConfig = {
      maxOrderNotional: riskConfigSrc.maxOrderNotional,
      maxPositionNotional: riskConfigSrc.maxPositionNotional,
      allowedMarkets: sortAllowedList(riskConfigSrc.allowedMarkets, "allowedMarkets"),
      allowedSymbols: sortAllowedList(riskConfigSrc.allowedSymbols, "allowedSymbols"),
    };
    if (!hasOwnRecordKey(riskConfigSrc, "maxOrderNotional")) throw rejectCanonical("maxOrderNotional");
    if (!hasOwnRecordKey(riskConfigSrc, "maxPositionNotional")) throw rejectCanonical("maxPositionNotional");
    const costSrc = isPlainObject(src.costContext) ? src.costContext : null;
    if (!costSrc) throw rejectCanonical("costContext");
    if (!hasOwnRecordKey(costSrc, "policies") || !Array.isArray(costSrc.policies)) {
      throw rejectCanonical("policies");
    }
    if (!hasOwnRecordKey(costSrc, "brokerChannel")) throw rejectCanonical("brokerChannel");
    if (!hasOwnRecordKey(costSrc, "currency")) throw rejectCanonical("currency");
    const policies = [];
    for (let i = 0; i < costSrc.policies.length; i += 1) {
      policies.push(projectPolicy(costSrc.policies[i]));
    }
    const value = {
      digestVersion: 1,
      accountId: src.accountId,
      marketEvent,
      orderIntent,
      riskDecision,
      userApproval,
      riskConfig,
      paperExecutionEnabled: src.paperExecutionEnabled,
      costContext: {
        policies,
        brokerChannel: costSrc.brokerChannel,
        currency: costSrc.currency,
      },
    };
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        field: err.field,
      },
    };
  }
}

function buildCanonicalCreate(input) {
  const src = isPlainObject(input) ? input : {};
  try {
    if (typeof src.accountId !== "string" || src.accountId.length === 0) {
      throw rejectCanonical("accountId");
    }
    if (typeof src.initialCash !== "number" || !Number.isSafeInteger(src.initialCash) || src.initialCash < 0) {
      throw rejectCanonical("initialCash");
    }
    return {
      ok: true,
      value: {
        digestVersion: 1,
        accountId: src.accountId,
        initialCash: src.initialCash,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        field: err.field,
      },
    };
  }
}

function digestFromCanonical(prefix, built) {
  if (!built.ok) return built;
  try {
    const hex = sha256Hex(encodeCanonical(built.value));
    return { ok: true, digest: prefix + hex, canonical: built.value };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        field: err.field,
      },
    };
  }
}

function digestRequest(input) {
  return digestFromCanonical(REQUEST_PREFIX, buildCanonicalRequest(input));
}

function digestCreate(input) {
  return digestFromCanonical(CREATE_PREFIX, buildCanonicalCreate(input));
}

function deriveExecutionId(input) {
  const src = isPlainObject(input) ? input : {};
  try {
    if (typeof src.accountId !== "string" || src.accountId.length === 0) {
      throw rejectCanonical("accountId");
    }
    if (typeof src.eventId !== "string" || src.eventId.length === 0) {
      throw rejectCanonical("eventId");
    }
    if (typeof src.sequence !== "number" || !Number.isSafeInteger(src.sequence) || src.sequence < 0) {
      throw rejectCanonical("sequence");
    }
    if (typeof src.intentId !== "string" || src.intentId.length === 0) {
      throw rejectCanonical("intentId");
    }
    const value = {
      version: 1,
      accountId: src.accountId,
      eventId: src.eventId,
      sequence: src.sequence,
      intentId: src.intentId,
    };
    return { ok: true, executionId: EXEC_PREFIX + sha256Hex(encodeCanonical(value)), canonical: value };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err.code || PERSISTENCE_ERROR.PAPER_PERSISTENCE_INVALID_INPUT,
        field: err.field,
      },
    };
  }
}

module.exports = {
  PERSISTENCE_ERROR,
  POLICY_FIELDS,
  COMMISSION_FIELDS,
  SELL_TAX_FIELDS,
  REQUEST_PREFIX,
  CREATE_PREFIX,
  EXEC_PREFIX,
  encodeCanonical,
  deepCloneOwn,
  setOwn,
  buildCanonicalRequest,
  buildCanonicalCreate,
  digestRequest,
  digestCreate,
  deriveExecutionId,
};
