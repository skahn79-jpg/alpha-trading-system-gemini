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
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 600000 ? 600000 : n;
}

function normalizeRetryCount(value) {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n > 10 ? 10 : n;
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
  return {
    stage: sanitizeStage(error && error.stage),
    upstreamStatus: normalizeStatus(error && error.upstreamStatus),
    kbResultCode: sanitizeResultCode(error && error.kbResultCode),
    errorType: sanitizeErrorType(error && error.errorType),
    durationMs: normalizeDuration(error && error.durationMs),
    retryCount: normalizeRetryCount(error && error.retryCount),
  };
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
  KB_CLIENT_ERROR,
};
