/**
 * KB증권 Open API — OAuth2 액세스 토큰 관리
 *
 * 확보된 사양
 *   POST {baseUrl}/oauth2/token   (발급, grantType=client_credentials)
 *   POST {baseUrl}/oauth2/revoke  (폐기)
 *   요청 래퍼: { dataHeader: { ipAddr, macAddr }, dataBody: { appKey, appSecret, grantType } }
 *   expires_in 예시 86400(초)
 *
 * 정책
 *  - 메모리 캐시 + 만료 5분(300초) 전 선제 갱신
 *  - 동시 호출 시 발급은 1회만(inflight Promise 공유)
 *  - 미설정이면 네트워크 호출 없이 즉시 ConfigError
 *  - 에러 메시지·로그에 appKey/appSecret/token 원문 절대 미포함(maskSecret 사용)
 */

"use strict";

const axios = require("axios");
const { getKbConfig, maskSecret, ConfigError } = require("./config.js");
const { buildRequest, unwrap } = require("./envelope.js");

const TOKEN_PATH = "/oauth2/token";
const REVOKE_PATH = "/oauth2/revoke";
/** 만료 5분(300초) 전에 갱신 */
const REFRESH_MARGIN_MS = 300 * 1000;
const HTTP_TIMEOUT_MS = 10 * 1000;

/** @type {{ accessToken: string, expiresAt: number, tokenType: string } | null} */
let _cache = null;
/** @type {Promise<string> | null} */
let _inflight = null;
/** 테스트 주입용 HTTP 수행부 */
let _httpImpl = null;

/**
 * 순수 함수 — 갱신이 필요한가?
 * @param {number|null|undefined} expiresAt 만료 시각(ms epoch)
 * @param {number} nowMs 현재 시각(ms epoch)
 * @param {number} marginMs 선제 갱신 여유(기본 300초)
 */
function isExpiring(expiresAt, nowMs = Date.now(), marginMs = REFRESH_MARGIN_MS) {
  if (expiresAt === null || expiresAt === undefined) return true;
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return true;
  return nowMs >= exp - marginMs;
}

/**
 * 실제 HTTP POST. 테스트에서 __setHttpForTest 로 대체 가능.
 * @returns {Promise<any>} 응답 본문(JSON)
 */
async function _httpPost(url, body, headers = {}, timeout = HTTP_TIMEOUT_MS) {
  if (typeof _httpImpl === "function") {
    return _httpImpl(url, body, headers, timeout);
  }
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json", ...headers },
    timeout,
  });
  return res.data;
}

/** 응답에서 토큰/만료를 관대하게 추출 — 발견 못하면 명시적 에러(추측 금지) */
function extractTokenPayload(data) {
  const candidates = [];
  if (data && typeof data === "object") {
    candidates.push(data);
    if (data.dataBody && typeof data.dataBody === "object") candidates.push(data.dataBody);
    if (data.body && typeof data.body === "object") candidates.push(data.body);
  }
  for (const o of candidates) {
    const accessToken = o.access_token || o.accessToken || o.token || null;
    if (!accessToken) continue;
    const rawExpires =
      o.expires_in !== undefined ? o.expires_in
      : o.expiresIn !== undefined ? o.expiresIn
      : o.expire_in !== undefined ? o.expire_in
      : null;
    const expiresInSec = Number(rawExpires);
    return {
      accessToken: String(accessToken),
      tokenType: String(o.token_type || o.tokenType || "bearer"),
      expiresInSec: Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : null,
    };
  }
  return null;
}

async function _issueToken(cfg) {
  const url = `${cfg.baseUrl}${TOKEN_PATH}`;
  const payload = buildRequest(cfg, {
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    grantType: "client_credentials",
  });

  let data;
  try {
    data = await _httpPost(url, payload);
  } catch (err) {
    // 비밀값이 섞일 수 있는 axios err.config / 응답 원문은 절대 전파하지 않는다.
    const status = err && err.response ? err.response.status : null;
    const safe = new Error(
      `KB 토큰 발급 실패${status ? ` (HTTP ${status})` : ""} — appKey=${maskSecret(cfg.appKey)}`,
    );
    safe.code = "KB_TOKEN_ISSUE_FAILED";
    safe.status = status;
    // 응답 본문이 있으면 마스킹된 사본만 첨부
    if (err && err.response && err.response.data) {
      safe.responseSafe = unwrap(err.response.data).rawSafe;
    }
    console.error("[kb/token] 발급 실패:", safe.message);
    throw safe;
  }

  const parsed = extractTokenPayload(data);
  if (!parsed) {
    const safe = new Error(
      "KB 토큰 응답에서 access_token 을 찾지 못했습니다 — 응답 필드 명세 확인 필요",
    );
    safe.code = "KB_TOKEN_RESPONSE_UNPARSED";
    safe.responseSafe = unwrap(data).rawSafe;
    console.error("[kb/token]", safe.message);
    throw safe;
  }

  // expires_in 미제공 시 보수적으로 짧게(10분) 잡아 재발급을 유도한다.
  const ttlSec = parsed.expiresInSec === null ? 600 : parsed.expiresInSec;
  _cache = {
    accessToken: parsed.accessToken,
    tokenType: parsed.tokenType,
    expiresAt: Date.now() + ttlSec * 1000,
  };
  console.log(
    `[kb/token] 발급 완료 token=${maskSecret(parsed.accessToken)} ttl=${ttlSec}s`,
  );
  return _cache.accessToken;
}

/**
 * 액세스 토큰 획득(캐시 + 선제 갱신 + 동시 갱신 잠금).
 * 미설정이면 네트워크 호출 없이 ConfigError.
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<string>}
 */
async function getAccessToken(opts = {}) {
  const cfg = getKbConfig();
  if (!cfg.configured) throw new ConfigError(cfg.missing);

  if (!opts.force && _cache && !isExpiring(_cache.expiresAt)) {
    return _cache.accessToken;
  }
  if (_inflight) return _inflight;

  const p = _issueToken(cfg);
  _inflight = p;
  try {
    return await p;
  } finally {
    if (_inflight === p) _inflight = null;
  }
}

/**
 * 캐시된 토큰 폐기 + 캐시 초기화.
 * 캐시가 없으면 네트워크 호출 없이 초기화만 수행.
 * @returns {Promise<{ revoked: boolean, reason?: string }>}
 */
async function revokeToken() {
  const cfg = getKbConfig();
  if (!cfg.configured) throw new ConfigError(cfg.missing);

  const cached = _cache;
  _cache = null;
  _inflight = null;
  if (!cached || !cached.accessToken) return { revoked: false, reason: "no-cached-token" };

  const url = `${cfg.baseUrl}${REVOKE_PATH}`;
  // TODO(FIELD_SPEC): /oauth2/revoke 의 dataBody 필드명은 명세 미확보.
  // 현재는 발급과 동일한 자격증명 + token 을 실어 보낸다. 명세 확보 후 검증 필요.
  const payload = buildRequest(cfg, {
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    token: cached.accessToken,
  });
  try {
    await _httpPost(url, payload);
    console.log(`[kb/token] 폐기 완료 token=${maskSecret(cached.accessToken)}`);
    return { revoked: true };
  } catch (err) {
    const status = err && err.response ? err.response.status : null;
    const safe = new Error(`KB 토큰 폐기 실패${status ? ` (HTTP ${status})` : ""}`);
    safe.code = "KB_TOKEN_REVOKE_FAILED";
    safe.status = status;
    console.error("[kb/token]", safe.message);
    throw safe;
  }
}

/** 캐시 상태(비밀값 마스킹) — 디버깅/상태표시용 */
function getTokenCacheInfo() {
  if (!_cache) return { cached: false };
  return {
    cached: true,
    token: maskSecret(_cache.accessToken),
    expiresAt: _cache.expiresAt,
    expiring: isExpiring(_cache.expiresAt),
  };
}

/* ── 테스트 훅 (네트워크 없이 검증 가능하게) ─────────────────────── */
function __setHttpForTest(fn) {
  _httpImpl = typeof fn === "function" ? fn : null;
}
function __resetForTest() {
  _cache = null;
  _inflight = null;
  _httpImpl = null;
}

module.exports = {
  TOKEN_PATH,
  REVOKE_PATH,
  REFRESH_MARGIN_MS,
  HTTP_TIMEOUT_MS,
  isExpiring,
  getAccessToken,
  revokeToken,
  getTokenCacheInfo,
  extractTokenPayload,
  _httpPost,
  __setHttpForTest,
  __resetForTest,
};
