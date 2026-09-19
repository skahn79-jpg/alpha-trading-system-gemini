/**
 * GATE 12P Paper operational config snapshot v1.
 * Startup-only immutable snapshot. No hot reload. No Live secrets.
 * Caller configSnapshotId / digest / enablement: 0.
 */

"use strict";

const { createHash } = require("node:crypto");
const { encodeCanonical, deepCloneOwn, setOwn } = require("./paper-persistence-canonical");
const {
  isPlainObject,
  hasOwnRecordKey,
  isPosSafeInt,
  isNonNegSafeInt,
} = require("./paper-account-state");
const { PAPER_MARKETS } = require("./paper-market-event-identity");

const SCHEMA_VERSION = "paper-operational-config-v1";
const DIGEST_PREFIX = "paper-operational-config-v1:";
const OPERATING_MODE = "MODE_A_SINGLE_PROCESS_EPHEMERAL";
const MARKET_POLICY_VERSION = "paper-market-timezone-v1";
const IDENTITY_POLICY_VERSION = "paper-market-event-v1";
const SESSION_ALLOWLIST = Object.freeze(["REGULAR_SESSION"]);
const APPROVAL_MODEL = "EXPLICIT_ONE_TIME";
const APPROVER_ROLE = "PAPER_OPERATOR";
const BROKER_CHANNEL = "SYNTHETIC_ONLINE";
const CURRENCY = "KRW";
const KILL_INITIAL = "DISABLED_EXECUTION";
const KILL_SCOPE = "PROCESS";
const MIN_TTL_MS = 1;
const MAX_TTL_MS = 86400000;
const MIN_RESOURCE = 1;
const MAX_RESOURCE = 10000;

const PAPER_MARKET_SET = new Set(PAPER_MARKETS);

const COVERAGE = Object.freeze({
  PENDING: "PENDING",
  UNAVAILABLE: "UNAVAILABLE",
  VERIFIED: "VERIFIED",
});
const COVERAGE_SET = new Set([COVERAGE.PENDING, COVERAGE.UNAVAILABLE, COVERAGE.VERIFIED]);

const SECRET_FIELDS = new Set([
  "kbApiKey",
  "kbSecret",
  "liveBrokerToken",
  "password",
  "accessToken",
]);

const FORBIDDEN_ENABLEMENT = new Set([
  "paperEligible",
  "liveEnabled",
  "liveEligible",
]);

const TOP_REQUIRED = Object.freeze([
  "schemaVersion",
  "operatingMode",
  "supportedMarkets",
  "marketPolicyVersion",
  "identityPolicyVersion",
  "calendarPolicy",
  "approvalPolicy",
  "riskPolicy",
  "costPolicy",
  "killSwitchPolicy",
  "resourcePolicy",
]);
const TOP_OPTIONAL = Object.freeze(["adapterPolicy"]);
const TOP_ALLOWED = new Set([...TOP_REQUIRED, ...TOP_OPTIONAL]);

const CALENDAR_KEYS = Object.freeze([
  "calendarDatasetId",
  "calendarVersion",
  "coverageStatus",
  "sessionTypeAllowlist",
]);
const APPROVAL_KEYS = Object.freeze([
  "approvalModel",
  "oneTimePolicy",
  "pendingLimit",
  "approvalTtlMs",
  "allowedApproverRoles",
]);
const RISK_KEYS = Object.freeze([
  "riskPolicyVersion",
  "maxOrderNotional",
  "maxPositionNotional",
  "allowedMarkets",
  "allowedSymbols",
]);
const COST_KEYS = Object.freeze([
  "costPolicyVersion",
  "policies",
  "brokerChannel",
  "currency",
]);
const KILL_KEYS = Object.freeze(["initialExecutionState", "scope"]);
const RESOURCE_KEYS = Object.freeze([
  "maxActiveSessions",
  "maxTerminalSessionRecords",
  "maxApprovalRecords",
  "maxEventTrackerEntries",
]);
const ADAPTER_KEYS = Object.freeze(["maxEventAgeMs", "maxReceiveLagMs"]);

const ERROR = Object.freeze({
  PAPER_OPERATIONAL_CONFIG_INVALID_INPUT: "PAPER_OPERATIONAL_CONFIG_INVALID_INPUT",
  PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD: "PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD",
  PAPER_OPERATIONAL_CONFIG_MISSING_FIELD: "PAPER_OPERATIONAL_CONFIG_MISSING_FIELD",
  PAPER_OPERATIONAL_CONFIG_UNSUPPORTED_VERSION: "PAPER_OPERATIONAL_CONFIG_UNSUPPORTED_VERSION",
  PAPER_OPERATIONAL_CONFIG_INVALID_OPERATING_MODE: "PAPER_OPERATIONAL_CONFIG_INVALID_OPERATING_MODE",
  PAPER_OPERATIONAL_CONFIG_INVALID_MARKET: "PAPER_OPERATIONAL_CONFIG_INVALID_MARKET",
  PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY: "PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY",
  PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY: "PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY",
  PAPER_OPERATIONAL_CONFIG_INVALID_TTL: "PAPER_OPERATIONAL_CONFIG_INVALID_TTL",
  PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY: "PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY",
  PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY: "PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY",
  PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH: "PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH",
  PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY: "PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY",
  PAPER_OPERATIONAL_CONFIG_INVALID_ADAPTER_POLICY: "PAPER_OPERATIONAL_CONFIG_INVALID_ADAPTER_POLICY",
  PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN: "PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN",
  PAPER_OPERATIONAL_CONFIG_SNAPSHOT_REQUIRED: "PAPER_OPERATIONAL_CONFIG_SNAPSHOT_REQUIRED",
});

function sha256Hex(utf8Text) {
  return createHash("sha256").update(utf8Text, "utf8").digest("hex");
}

function fail(code, field) {
  const out = { ok: false, code: code, snapshot: null };
  if (field !== undefined) out.field = field;
  return out;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function freezeOwnTree(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) freezeOwnTree(value[i]);
    return Object.freeze(value);
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) freezeOwnTree(value[keys[i]]);
  return Object.freeze(value);
}

function rejectOwnKeys(record, allowed) {
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (SECRET_FIELDS.has(key)) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN, key);
    }
    if (FORBIDDEN_ENABLEMENT.has(key) || !allowed.has(key)) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD, key);
    }
  }
  return null;
}

function requireOwn(record, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    if (!hasOwnRecordKey(record, keys[i])) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_MISSING_FIELD, keys[i]);
    }
  }
  return null;
}

function isUniqueNonEmptyStringArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    if (!isNonEmptyString(value[i])) return false;
    if (seen.has(value[i])) return false;
    seen.add(value[i]);
  }
  return true;
}

function isNonEmptyStringArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isNonEmptyString(value[i])) return false;
  }
  return true;
}

function exactStringArray(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (value[i] !== expected[i]) return false;
  }
  return true;
}

function isResourceCap(value) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= MIN_RESOURCE
    && value <= MAX_RESOURCE;
}

function nullableString(value) {
  return value === null || isNonEmptyString(value);
}

function rejectForbiddenDeep(value) {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = rejectForbiddenDeep(value[i]);
      if (nested) return nested;
    }
    return null;
  }
  if (!isPlainObject(value)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_INPUT, "config");
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    if (SECRET_FIELDS.has(keys[i])) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN, keys[i]);
    }
    if (FORBIDDEN_ENABLEMENT.has(keys[i])) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD, keys[i]);
    }
    const nested = rejectForbiddenDeep(value[keys[i]]);
    if (nested) return nested;
  }
  return null;
}

function validateCalendarPolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY, "calendarPolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(CALENDAR_KEYS));
  if (unknown) return unknown;
  const missing = requireOwn(raw, CALENDAR_KEYS);
  if (missing) return missing;

  const coverageStatus = raw.coverageStatus;
  if (typeof coverageStatus !== "string" || !COVERAGE_SET.has(coverageStatus)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY, "coverageStatus");
  }
  if (!nullableString(raw.calendarDatasetId)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY, "calendarDatasetId");
  }
  if (!nullableString(raw.calendarVersion)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY, "calendarVersion");
  }
  if (coverageStatus === COVERAGE.VERIFIED && !isNonEmptyString(raw.calendarVersion)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY, "calendarVersion");
  }
  if (!exactStringArray(raw.sessionTypeAllowlist, SESSION_ALLOWLIST)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY, "sessionTypeAllowlist");
  }

  const out = {};
  setOwn(out, "calendarDatasetId", raw.calendarDatasetId);
  setOwn(out, "calendarVersion", raw.calendarVersion);
  setOwn(out, "coverageStatus", coverageStatus);
  setOwn(out, "sessionTypeAllowlist", raw.sessionTypeAllowlist.slice());
  return { ok: true, value: out };
}

function validateApprovalPolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY, "approvalPolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(APPROVAL_KEYS));
  if (unknown) return unknown;
  const missing = requireOwn(raw, APPROVAL_KEYS);
  if (missing) return missing;

  if (raw.approvalModel !== APPROVAL_MODEL) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY, "approvalModel");
  }
  if (raw.oneTimePolicy !== true) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY, "oneTimePolicy");
  }
  if (raw.pendingLimit !== 1) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY, "pendingLimit");
  }
  if (!isPosSafeInt(raw.approvalTtlMs)
    || raw.approvalTtlMs < MIN_TTL_MS
    || raw.approvalTtlMs > MAX_TTL_MS) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_TTL, "approvalTtlMs");
  }
  if (!isUniqueNonEmptyStringArray(raw.allowedApproverRoles)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY, "allowedApproverRoles");
  }
  for (let i = 0; i < raw.allowedApproverRoles.length; i += 1) {
    if (raw.allowedApproverRoles[i] !== APPROVER_ROLE) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY, "allowedApproverRoles");
    }
  }

  const out = {};
  setOwn(out, "approvalModel", APPROVAL_MODEL);
  setOwn(out, "oneTimePolicy", true);
  setOwn(out, "pendingLimit", 1);
  setOwn(out, "approvalTtlMs", raw.approvalTtlMs);
  setOwn(out, "allowedApproverRoles", raw.allowedApproverRoles.slice());
  return { ok: true, value: out };
}

function validateRiskPolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY, "riskPolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(RISK_KEYS));
  if (unknown) return unknown;
  const missing = requireOwn(raw, RISK_KEYS);
  if (missing) return missing;
  if (!isNonEmptyString(raw.riskPolicyVersion)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY, "riskPolicyVersion");
  }
  if (!isNonNegSafeInt(raw.maxOrderNotional)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY, "maxOrderNotional");
  }
  if (!isNonNegSafeInt(raw.maxPositionNotional)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY, "maxPositionNotional");
  }
  if (!isNonEmptyStringArray(raw.allowedMarkets)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY, "allowedMarkets");
  }
  if (!isNonEmptyStringArray(raw.allowedSymbols)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY, "allowedSymbols");
  }
  const out = {};
  setOwn(out, "riskPolicyVersion", raw.riskPolicyVersion);
  setOwn(out, "maxOrderNotional", raw.maxOrderNotional);
  setOwn(out, "maxPositionNotional", raw.maxPositionNotional);
  setOwn(out, "allowedMarkets", raw.allowedMarkets.slice());
  setOwn(out, "allowedSymbols", raw.allowedSymbols.slice());
  return { ok: true, value: out };
}

function validateCostPolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY, "costPolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(COST_KEYS));
  if (unknown) return unknown;
  const missing = requireOwn(raw, COST_KEYS);
  if (missing) return missing;
  if (!isNonEmptyString(raw.costPolicyVersion)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY, "costPolicyVersion");
  }
  if (!Array.isArray(raw.policies)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY, "policies");
  }
  const policies = [];
  for (let i = 0; i < raw.policies.length; i += 1) {
    const row = raw.policies[i];
    if (!isPlainObject(row)) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY, "policies");
    }
    const nested = rejectForbiddenDeep(row);
    if (nested) return nested;
    policies.push(deepCloneOwn(row));
  }
  if (raw.brokerChannel !== BROKER_CHANNEL) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY, "brokerChannel");
  }
  if (raw.currency !== CURRENCY) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY, "currency");
  }
  const out = {};
  setOwn(out, "costPolicyVersion", raw.costPolicyVersion);
  setOwn(out, "policies", policies);
  setOwn(out, "brokerChannel", BROKER_CHANNEL);
  setOwn(out, "currency", CURRENCY);
  return { ok: true, value: out };
}

function validateKillSwitchPolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH, "killSwitchPolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(KILL_KEYS));
  if (unknown) return unknown;
  const missing = requireOwn(raw, KILL_KEYS);
  if (missing) return missing;
  if (raw.initialExecutionState !== KILL_INITIAL) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH, "initialExecutionState");
  }
  if (raw.scope !== KILL_SCOPE) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH, "scope");
  }
  const out = {};
  setOwn(out, "initialExecutionState", KILL_INITIAL);
  setOwn(out, "scope", KILL_SCOPE);
  return { ok: true, value: out };
}

function validateResourcePolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY, "resourcePolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(RESOURCE_KEYS));
  if (unknown) return unknown;
  const missing = requireOwn(raw, RESOURCE_KEYS);
  if (missing) return missing;
  for (let i = 0; i < RESOURCE_KEYS.length; i += 1) {
    const key = RESOURCE_KEYS[i];
    if (!isResourceCap(raw[key])) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY, key);
    }
  }
  const out = {};
  for (let i = 0; i < RESOURCE_KEYS.length; i += 1) {
    setOwn(out, RESOURCE_KEYS[i], raw[RESOURCE_KEYS[i]]);
  }
  return { ok: true, value: out };
}

function validateAdapterPolicy(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_ADAPTER_POLICY, "adapterPolicy");
  }
  const unknown = rejectOwnKeys(raw, new Set(ADAPTER_KEYS));
  if (unknown) return unknown;
  const out = {};
  for (let i = 0; i < ADAPTER_KEYS.length; i += 1) {
    const key = ADAPTER_KEYS[i];
    if (!hasOwnRecordKey(raw, key)) continue;
    if (!isPosSafeInt(raw[key])) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_ADAPTER_POLICY, key);
    }
    setOwn(out, key, raw[key]);
  }
  return { ok: true, value: out };
}

function createPaperOperationalConfigSnapshot(raw) {
  if (raw == null) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_SNAPSHOT_REQUIRED, "config");
  }
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_INPUT, "config");
  }

  const ownKeys = Object.keys(raw);
  for (let i = 0; i < ownKeys.length; i += 1) {
    const key = ownKeys[i];
    if (SECRET_FIELDS.has(key)) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN, key);
    }
    if (FORBIDDEN_ENABLEMENT.has(key) || key === "configSnapshotId" || key === "digest") {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD, key);
    }
    if (!TOP_ALLOWED.has(key)) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD, key);
    }
  }

  const missing = requireOwn(raw, TOP_REQUIRED);
  if (missing) return missing;

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_INPUT, "schemaVersion");
  }
  if (raw.operatingMode !== OPERATING_MODE) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_OPERATING_MODE, "operatingMode");
  }
  if (!isUniqueNonEmptyStringArray(raw.supportedMarkets)) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_MARKET, "supportedMarkets");
  }
  for (let i = 0; i < raw.supportedMarkets.length; i += 1) {
    if (!PAPER_MARKET_SET.has(raw.supportedMarkets[i])) {
      return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_MARKET, "supportedMarkets");
    }
  }
  if (raw.marketPolicyVersion !== MARKET_POLICY_VERSION) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_INPUT, "marketPolicyVersion");
  }
  if (raw.identityPolicyVersion !== IDENTITY_POLICY_VERSION) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_INPUT, "identityPolicyVersion");
  }

  const calendar = validateCalendarPolicy(raw.calendarPolicy);
  if (!calendar.ok) return calendar;
  const approval = validateApprovalPolicy(raw.approvalPolicy);
  if (!approval.ok) return approval;
  const risk = validateRiskPolicy(raw.riskPolicy);
  if (!risk.ok) return risk;
  const cost = validateCostPolicy(raw.costPolicy);
  if (!cost.ok) return cost;
  const kill = validateKillSwitchPolicy(raw.killSwitchPolicy);
  if (!kill.ok) return kill;
  const resource = validateResourcePolicy(raw.resourcePolicy);
  if (!resource.ok) return resource;

  const canonical = {};
  setOwn(canonical, "schemaVersion", SCHEMA_VERSION);
  setOwn(canonical, "operatingMode", OPERATING_MODE);
  setOwn(canonical, "supportedMarkets", raw.supportedMarkets.slice());
  setOwn(canonical, "marketPolicyVersion", MARKET_POLICY_VERSION);
  setOwn(canonical, "identityPolicyVersion", IDENTITY_POLICY_VERSION);
  setOwn(canonical, "calendarPolicy", calendar.value);
  setOwn(canonical, "approvalPolicy", approval.value);
  setOwn(canonical, "riskPolicy", risk.value);
  setOwn(canonical, "costPolicy", cost.value);
  setOwn(canonical, "killSwitchPolicy", kill.value);
  setOwn(canonical, "resourcePolicy", resource.value);

  if (hasOwnRecordKey(raw, "adapterPolicy")) {
    const adapter = validateAdapterPolicy(raw.adapterPolicy);
    if (!adapter.ok) return adapter;
    setOwn(canonical, "adapterPolicy", adapter.value);
  }

  let configSnapshotId;
  try {
    configSnapshotId = DIGEST_PREFIX + sha256Hex(encodeCanonical(canonical));
  } catch (_err) {
    return fail(ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_INPUT, "config");
  }

  const snapshot = deepCloneOwn(canonical);
  setOwn(snapshot, "configSnapshotId", configSnapshotId);
  freezeOwnTree(snapshot);

  return {
    ok: true,
    snapshot: snapshot,
    configSnapshotId: configSnapshotId,
  };
}

module.exports = {
  createPaperOperationalConfigSnapshot,
  ERROR,
  SCHEMA_VERSION,
  OPERATING_MODE,
  DIGEST_PREFIX,
  COVERAGE,
};
