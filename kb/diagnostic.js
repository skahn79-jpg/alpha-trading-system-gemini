/**
 * KB 업스트림 실패용 안전 진단 로그.
 * 허용 필드만 기록한다. 비밀값·본문·axios 객체·cause 는 로그/직렬화에 넣지 않는다.
 */

"use strict";

const ALLOWED_STAGES = new Set(["oauth", "quote", "market-status"]);
const ALLOWED_ERROR_TYPES = new Set([
  "http",
  "timeout",
  "network",
  "tls",
  "dns",
  "parsing",
  "kb-business",
  "unknown",
]);

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "CERT_UNTRUSTED",
]);
const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

const RESULT_CODE_RE = /^[A-Za-z0-9_-]+$/;
const KEY_RE = /^[A-Za-z0-9_]+$/;
const RECORD_KEY_RE = /^(Record|record|output)\d*$/;
const SHAPE_TYPES = new Set(["null", "array", "object", "string", "number", "boolean", "unknown"]);
const FIELD_LOCATIONS = new Set(["present", "missing"]);
const MAX_KEYS = 20;
const MAX_KEY_LEN = 40;
const MAX_DEPTH = 3;
const MAX_RECORD_CONTAINERS = 8;
const MAX_RECORD_COUNT = 10000;
const KB_CLIENT_ERROR = "KB증권 조회에 실패했습니다.";

function sanitizeStage(value) {
  return ALLOWED_STAGES.has(value) ? value : "unknown";
}

function sanitizeErrorType(value) {
  return ALLOWED_ERROR_TYPES.has(value) ? value : "unknown";
}

function sanitizeResultCode(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (s.length === 0 || s.length > 32) return null;
  if (!RESULT_CODE_RE.test(s)) return null;
  return s;
}

function normalizeStatus(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 100 || n > 599) return null;
  return n;
}

function normalizeDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 600000 ? 600000 : Math.trunc(n);
}

function normalizeRetryCount(value) {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n > 10 ? 10 : n;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function payloadTypeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "unknown";
}

function safeKeys(value) {
  if (!isPlainObject(value)) return [];
  const keys = [];
  for (const key of Object.keys(value)) {
    if (typeof key !== "string") continue;
    if (key.length === 0 || key.length > MAX_KEY_LEN) continue;
    if (!KEY_RE.test(key)) continue;
    keys.push(key);
    if (keys.length >= MAX_KEYS) break;
  }
  return keys;
}

function sanitizeKeyList(list, max = MAX_KEYS) {
  if (!Array.isArray(list)) return [];
  const keys = [];
  for (const key of list) {
    if (typeof key !== "string") continue;
    if (key.length === 0 || key.length > MAX_KEY_LEN) continue;
    if (!KEY_RE.test(key)) continue;
    keys.push(key);
    if (keys.length >= max) break;
  }
  return keys;
}

function sanitizeRecordContainers(list) {
  if (!Array.isArray(list)) return [];
  const keys = [];
  for (const key of list) {
    if (typeof key !== "string") continue;
    if (key.length === 0 || key.length > MAX_KEY_LEN) continue;
    if (!KEY_RE.test(key) || !RECORD_KEY_RE.test(key)) continue;
    keys.push(key);
    if (keys.length >= MAX_RECORD_CONTAINERS) break;
  }
  return keys;
}

function sanitizeRecordCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n > MAX_RECORD_COUNT ? MAX_RECORD_COUNT : n;
}

function sanitizeExpectedFieldLocations(value) {
  const out = { is_nm: "missing", now_prc: "missing" };
  if (!isPlainObject(value)) return out;
  if (FIELD_LOCATIONS.has(value.is_nm)) out.is_nm = value.is_nm;
  if (FIELD_LOCATIONS.has(value.now_prc)) out.now_prc = value.now_prc;
  return out;
}

function sanitizeShapeType(value) {
  return SHAPE_TYPES.has(value) ? value : "unknown";
}

function coerceShape(shape) {
  if (!isPlainObject(shape)) return null;
  return {
    payloadType: sanitizeShapeType(shape.payloadType),
    topLevelKeys: sanitizeKeyList(shape.topLevelKeys),
    dataBodyType: sanitizeShapeType(shape.dataBodyType),
    dataBodyKeys: sanitizeKeyList(shape.dataBodyKeys),
    recordContainers: sanitizeRecordContainers(shape.recordContainers),
    recordCount: sanitizeRecordCount(shape.recordCount),
    expectedFieldLocations: sanitizeExpectedFieldLocations(shape.expectedFieldLocations),
  };
}

function findExpectedField(value, name, depth, seen) {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return findExpectedField(value[0], name, depth + 1, seen);
  }

  if (Object.prototype.hasOwnProperty.call(value, name)) return true;

  for (const key of Object.keys(value)) {
    if (findExpectedField(value[key], name, depth + 1, seen)) return true;
  }
  return false;
}

function collectRecordContainers(payload, dataBody) {
  const names = [];
  let recordCount = null;
  const sources = [];
  if (isPlainObject(payload)) sources.push(payload);
  if (isPlainObject(dataBody)) sources.push(dataBody);

  const seen = new Set();
  for (const src of sources) {
    for (const key of Object.keys(src)) {
      if (!RECORD_KEY_RE.test(key) || !KEY_RE.test(key) || key.length > MAX_KEY_LEN) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(key);
      if (recordCount === null && Array.isArray(src[key])) {
        recordCount = sanitizeRecordCount(src[key].length);
      }
      if (names.length >= MAX_RECORD_CONTAINERS) {
        return { recordContainers: names, recordCount };
      }
    }
  }
  return { recordContainers: names, recordCount };
}

function describeKbResponseShape(payload) {
  const payloadType = payloadTypeOf(payload);
  const topLevelKeys = safeKeys(payload);

  let dataBody;
  if (isPlainObject(payload) && Object.prototype.hasOwnProperty.call(payload, "dataBody")) {
    dataBody = payload.dataBody;
  }

  const dataBodyType = payloadTypeOf(dataBody);
  const dataBodyKeys = isPlainObject(dataBody) ? safeKeys(dataBody) : [];

  let recordCount = null;
  if (Array.isArray(dataBody)) {
    recordCount = sanitizeRecordCount(Math.min(dataBody.length, MAX_RECORD_COUNT));
  }

  const collected = collectRecordContainers(payload, dataBody);
  if (recordCount === null) recordCount = collected.recordCount;

  return {
    payloadType,
    topLevelKeys,
    dataBodyType,
    dataBodyKeys,
    recordContainers: collected.recordContainers,
    recordCount,
    expectedFieldLocations: {
      is_nm: findExpectedField(payload, "is_nm", 0, new WeakSet()) ? "present" : "missing",
      now_prc: findExpectedField(payload, "now_prc", 0, new WeakSet()) ? "present" : "missing",
    },
  };
}

class KbDiagnosticError extends Error {
  constructor(opts = {}) {
    super("KB upstream request failed");
    this.name = "KbDiagnosticError";
    this.stage = sanitizeStage(opts.stage);
    this.upstreamStatus = normalizeStatus(opts.upstreamStatus);
    this.kbResultCode = sanitizeResultCode(opts.kbResultCode);
    this.errorType = sanitizeErrorType(opts.errorType);
    this.durationMs = normalizeDuration(opts.durationMs);
    this.retryCount = normalizeRetryCount(opts.retryCount);
    if (opts.code !== undefined && opts.code !== null) {
      this.code = opts.code;
    }
    const shape = coerceShape(opts.shape);
    if (shape) {
      Object.defineProperty(this, "shape", {
        value: shape,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
    if (Object.prototype.hasOwnProperty.call(opts, "cause")) {
      Object.defineProperty(this, "cause", {
        value: opts.cause,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
  }
}

function classifyAxiosFailure(err) {
  if (err && err.response && err.response.status !== undefined && err.response.status !== null) {
    return "http";
  }
  const code = err && err.code;
  if (TIMEOUT_CODES.has(code)) return "timeout";
  if (DNS_CODES.has(code)) return "dns";
  if (TLS_CODES.has(code) || (typeof code === "string" && code.startsWith("ERR_TLS"))) {
    return "tls";
  }
  if (NETWORK_CODES.has(code)) return "network";
  return "unknown";
}

function extractKbResultCode(data) {
  if (!data || typeof data !== "object") return null;
  const header = data.dataHeader;
  if (!header || typeof header !== "object") return null;
  return sanitizeResultCode(header.resultCode);
}

function toLogFields(error) {
  const fields = {
    stage: sanitizeStage(error && error.stage),
    upstreamStatus: normalizeStatus(error && error.upstreamStatus),
    kbResultCode: sanitizeResultCode(error && error.kbResultCode),
    errorType: sanitizeErrorType(error && error.errorType),
    durationMs: normalizeDuration(error && error.durationMs),
    retryCount: normalizeRetryCount(error && error.retryCount),
  };
  if (fields.errorType === "parsing" && error && error.shape) {
    const shape = coerceShape(error.shape);
    if (shape) {
      fields.payloadType = shape.payloadType;
      fields.topLevelKeys = shape.topLevelKeys;
      fields.dataBodyType = shape.dataBodyType;
      fields.dataBodyKeys = shape.dataBodyKeys;
      fields.recordContainers = shape.recordContainers;
      fields.recordCount = shape.recordCount;
      fields.expectedFieldLocations = shape.expectedFieldLocations;
    }
  }
  return fields;
}

function logKbDiagnostic(error) {
  if (error && typeof error === "object" && error.__kbDiagnosticLogged === true) {
    return;
  }
  if (error && typeof error === "object") {
    Object.defineProperty(error, "__kbDiagnosticLogged", {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  console.error("[kb-diagnostic]", toLogFields(error));
}

function durationFrom(startedAt) {
  if (startedAt === undefined || startedAt === null) return null;
  return normalizeDuration(Date.now() - Number(startedAt));
}

function wrapAxiosAsDiagnostic({ stage, err, startedAt, code } = {}) {
  const response = err && err.response && typeof err.response === "object" ? err.response : null;
  const status = response ? response.status : null;
  const data = response ? response.data : undefined;
  return new KbDiagnosticError({
    stage,
    upstreamStatus: status,
    kbResultCode: extractKbResultCode(data),
    errorType: classifyAxiosFailure(err),
    durationMs: durationFrom(startedAt),
    retryCount: 0,
    code,
  });
}

function wrapOauthAxios(err, startedAt) {
  return wrapAxiosAsDiagnostic({
    stage: "oauth",
    err,
    startedAt,
    code: "KB_TOKEN_ISSUE_FAILED",
  });
}

function oauthParsingError({ startedAt, upstreamStatus = 200 } = {}) {
  return new KbDiagnosticError({
    stage: "oauth",
    errorType: "parsing",
    upstreamStatus,
    kbResultCode: null,
    durationMs: durationFrom(startedAt),
    retryCount: 0,
    code: "KB_TOKEN_RESPONSE_UNPARSED",
  });
}

function isDiagnosticError(err) {
  return Boolean(err && (err instanceof KbDiagnosticError || err.name === "KbDiagnosticError"));
}

module.exports = {
  KbDiagnosticError,
  sanitizeStage,
  sanitizeErrorType,
  sanitizeResultCode,
  normalizeStatus,
  normalizeDuration,
  normalizeRetryCount,
  classifyAxiosFailure,
  extractKbResultCode,
  toLogFields,
  logKbDiagnostic,
  wrapAxiosAsDiagnostic,
  wrapOauthAxios,
  oauthParsingError,
  isDiagnosticError,
  describeKbResponseShape,
  safeKeys,
  payloadTypeOf,
  KB_CLIENT_ERROR,
};
