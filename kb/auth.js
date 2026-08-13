/**
 * 단일 관리자 인증 — 서명된 세션 쿠키 (조회 단계)
 *
 * 원칙
 *  - 본 앱은 관리자 1인 전용. 회원가입·역할관리·비밀번호 찾기는 제공하지 않는다.
 *  - Render 무료 티어는 디스크가 휘발성이므로 조회 단계에서는 HMAC 서명 세션을 사용한다.
 *  - TODO(ORDER_PHASE): 실제 주문 단계 전에 영속 DB 기반 서버측 세션과 감사로그가 필요하다.
 *  - 환경변수는 "호출 시점"에 읽는다(모듈 로드 시 캐시 금지).
 *  - 비밀번호·시크릿·토큰 원문은 로그·에러메시지·클라이언트 응답에 절대 노출 금지.
 *  - 모든 비밀값 비교는 crypto.timingSafeEqual 로 수행한다.
 *  - SESSION_SECRET 미설정 시 보호 라우트를 개방하지 않는다(fail-closed → 401).
 *
 * 환경변수
 *  - ADMIN_LOGIN_ID        : 관리자 아이디
 *  - ADMIN_PASSWORD_HASH   : Argon2id 해시 (npm run auth:hash-password)
 *  - SESSION_SECRET        : 세션 HMAC 키
 *  - SESSION_TTL_MINUTES   : 세션 유효시간(분), 기본 60
 *  - ALLOWED_ORIGIN(S)     : CORS/CSRF allowlist (쉼표 구분 가능)
 *  - NODE_ENV              : production 일 때 __Host- 쿠키 + Secure
 */

"use strict";

const crypto = require("node:crypto");
const argon2 = require("argon2");

/** 운영 환경 쿠키 이름 — __Host- 접두사는 Secure + Path=/ + Domain 미설정을 강제한다. */
const PROD_COOKIE_NAME = "__Host-alpha_session";
/** 로컬/테스트용 쿠키 이름 (__Host- 는 Secure 필수라 HTTP 테스트에서 분리). */
const DEV_COOKIE_NAME = "alpha_session";
const TOKEN_VERSION = 1;
const DEFAULT_TTL_MIN = 60;
const ADMIN_DISPLAY_NAME = "안상균";
const SCRYPT_PREFIX = "scrypt";
const LOGIN_ERROR_MESSAGE = "로그인 정보가 올바르지 않습니다.";
const UNAUTHORIZED_MESSAGE = "인증이 필요합니다.";
const CSRF_ERROR_MESSAGE = "허용되지 않은 요청입니다.";
const RATE_LIMIT_MESSAGE = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.";

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

/** 로그아웃된 세션 jti → 만료시각(초). 프로세스 메모리 전용. */
const revokedJti = new Map();

let secretWarningShown = false;

/* ────────────────────────────── 환경변수 ───────────────────────────── */

function envStr(name) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function getSessionSecret() {
  return envStr("SESSION_SECRET");
}

function getAdminPasswordHash() {
  return envStr("ADMIN_PASSWORD_HASH");
}

function getAdminLoginId() {
  return envStr("ADMIN_LOGIN_ID");
}

function getSessionTtlMin() {
  const raw = envStr("SESSION_TTL_MINUTES") || envStr("SESSION_TTL_MIN");
  if (!raw) return DEFAULT_TTL_MIN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MIN;
  return n;
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getCookieName() {
  return isProduction() ? PROD_COOKIE_NAME : DEV_COOKIE_NAME;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isAuthConfigured() {
  return !!(getSessionSecret() && getAdminPasswordHash() && getAdminLoginId());
}

/* ────────────────────────────────── 유틸 ────────────────────────────────── */

function safeEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function safeStringEqual(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) {
    if (left.length > 0) safeEqual(left, left);
    return false;
  }
  if (left.length === 0) return false;
  return safeEqual(left, right);
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(String(str), "base64url");
}

function getClientIp(req) {
  if (!req || typeof req !== "object") return "unknown";
  if (typeof req.ip === "string" && req.ip) return req.ip;
  const xf = req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]);
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  if (req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress);
  return "unknown";
}

function logAuthEvent(event, req) {
  console.log(`[auth] ${event} ip=${getClientIp(req)}`);
}

/* ─────────────────────────────────── 비밀번호 ─────────────────────────────────── */

/**
 * Argon2id 해시 생성. 원문을 반환하지 않는다.
 * @param {string} pw
 * @returns {Promise<string>}
 */
async function hashPassword(pw) {
  const password = typeof pw === "string" ? pw : String(pw == null ? "" : pw);
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * 저장된 해시와 평문 비밀번호를 비교한다.
 * Argon2id 를 기본으로 하고, 기존 scrypt$ 해시도 수용한다(이미 저장된 값이 있을 경우).
 * 어떤 경우에도 throw 하지 않고 false 를 반환한다.
 */
async function verifyPassword(pw, stored) {
  try {
    if (typeof pw !== "string" || typeof stored !== "string" || stored.length === 0) {
      return false;
    }
    if (stored.startsWith("$argon2id$") || stored.startsWith("$argon2i$") || stored.startsWith("$argon2d$")) {
      return await argon2.verify(stored, pw);
    }
    if (stored.startsWith(`${SCRYPT_PREFIX}$`)) {
      return verifyScryptPassword(pw, stored);
    }
    return false;
  } catch {
    return false;
  }
}

function verifyScryptPassword(pw, stored) {
  try {
    const parts = stored.split("$");
    if (parts.length !== 3) return false;
    const [scheme, saltB64, hashB64] = parts;
    if (scheme !== SCRYPT_PREFIX || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = crypto.scryptSync(pw, salt, expected.length);
    return safeEqual(derived, expected);
  } catch {
    return false;
  }
}

async function verifyAdminCredentials(loginId, password) {
  const expectedId = getAdminLoginId();
  const stored = getAdminPasswordHash();
  if (!expectedId || !stored || !getSessionSecret()) {
    return { ok: false, configured: false };
  }
  const idOk = safeStringEqual(loginId, expectedId);
  const pwOk = await verifyPassword(typeof password === "string" ? password : "", stored);
  return { ok: idOk && pwOk, configured: true };
}

/* ──────────────────────────────────── 토큰 ──────────────────────────────────── */

function notConfiguredError() {
  const err = new Error("인증이 설정되어 있지 않습니다.");
  err.code = "AUTH_NOT_CONFIGURED";
  return err;
}

function signPayload(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function pruneRevoked() {
  const now = nowSec();
  for (const [jti, exp] of revokedJti.entries()) {
    if (!Number.isFinite(exp) || exp <= now) revokedJti.delete(jti);
  }
}

function revokeJti(jti, exp) {
  if (typeof jti !== "string" || !jti) return;
  const until = Number.isFinite(exp) ? exp : nowSec() + getSessionTtlMin() * 60;
  revokedJti.set(jti, until);
  pruneRevoked();
}

function isRevoked(jti) {
  if (typeof jti !== "string" || !jti) return false;
  const exp = revokedJti.get(jti);
  if (exp === undefined) return false;
  if (exp <= nowSec()) {
    revokedJti.delete(jti);
    return false;
  }
  return true;
}

/**
 * 서명 토큰 발급. payload 예: { role: "admin" }
 * @returns {string}
 */
function issueToken(payload, opts) {
  const secret = getSessionSecret();
  if (!secret) throw notConfiguredError();

  const base = payload && typeof payload === "object" ? payload : {};
  const options = opts && typeof opts === "object" ? opts : {};
  const ttlMin =
    Number.isFinite(Number(options.ttlMin)) && Number(options.ttlMin) !== 0
      ? Number(options.ttlMin)
      : getSessionTtlMin();

  const iat = Number.isFinite(base.iat) ? base.iat : nowSec();
  const exp = Number.isFinite(base.exp) ? base.exp : iat + Math.round(ttlMin * 60);
  const v = Number.isInteger(base.v) ? base.v : TOKEN_VERSION;
  const jti = typeof base.jti === "string" && base.jti ? base.jti : crypto.randomBytes(16).toString("hex");
  const name = typeof base.name === "string" && base.name ? base.name : ADMIN_DISPLAY_NAME;
  const role = typeof base.role === "string" && base.role ? base.role : "admin";

  const body = { ...base, role, name, jti, iat, exp, v };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(body), "utf8"));
  const sigB64 = signPayload(payloadB64, secret);
  return `${payloadB64}.${sigB64}`;
}

function verifyToken(token) {
  const fail = { ok: false, reason: "INVALID" };
  try {
    const secret = getSessionSecret();
    if (!secret) return fail;
    if (typeof token !== "string" || token.length === 0) return fail;

    const dot = token.indexOf(".");
    if (dot <= 0 || dot !== token.lastIndexOf(".")) return fail;

    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    if (!payloadB64 || !sigB64) return fail;

    const expectedSig = signPayload(payloadB64, secret);
    if (!safeEqual(b64urlDecode(sigB64), b64urlDecode(expectedSig))) return fail;

    let payload;
    try {
      payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
    } catch {
      return fail;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail;
    if (payload.v !== TOKEN_VERSION) return fail;
    if (!Number.isFinite(payload.exp)) return fail;
    if (typeof payload.jti === "string" && isRevoked(payload.jti)) return fail;
    if (payload.exp <= nowSec()) return { ok: false, reason: "EXPIRED" };

    return { ok: true, payload };
  } catch {
    return fail;
  }
}

/* ─────────────────────────────── 쿠키 ─────────────────────────────── */

function parseCookies(header) {
  const out = {};
  if (typeof header !== "string" || header.length === 0) return out;

  for (const segment of header.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const name = segment.slice(0, eq).trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(out, name)) continue;

    const rawValue = segment.slice(eq + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    out[name] = value;
  }
  return out;
}

function readToken(req) {
  if (!req || typeof req !== "object") return null;
  const headers = req.headers && typeof req.headers === "object" ? req.headers : {};
  const cookies = parseCookies(headers.cookie);
  const prod = cookies[PROD_COOKIE_NAME];
  const dev = cookies[DEV_COOKIE_NAME];
  if (typeof prod === "string" && prod) return prod;
  if (typeof dev === "string" && dev) return dev;
  if (req.cookies && typeof req.cookies === "object") {
    const v = req.cookies[getCookieName()] || req.cookies[PROD_COOKIE_NAME] || req.cookies[DEV_COOKIE_NAME];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function optionalAuth(req) {
  try {
    const token = readToken(req);
    if (!token) return null;
    const result = verifyToken(token);
    return result.ok ? result.payload : null;
  } catch {
    return null;
  }
}

function cookieFlags() {
  const parts = ["Path=/", "HttpOnly", "SameSite=Strict"];
  if (isProduction()) parts.push("Secure");
  return parts;
}

function buildSessionCookie(token) {
  const value = typeof token === "string" ? token : "";
  const maxAge = Math.round(getSessionTtlMin() * 60);
  return [`${getCookieName()}=${value}`, ...cookieFlags(), `Max-Age=${maxAge}`].join("; ");
}

function buildClearCookie() {
  return [`${getCookieName()}=`, ...cookieFlags(), "Max-Age=0"].join("; ");
}

/* ────────────────────────────────── CORS / CSRF ────────────────────────────────── */

function getAllowedOrigins() {
  const extra = [];
  for (const name of ["ALLOWED_ORIGIN", "ALLOWED_ORIGINS"]) {
    const raw = envStr(name);
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const s = part.trim().replace(/\/+$/, "");
      if (s && s !== "*") extra.push(s);
    }
  }
  if (isProduction()) return [...new Set(extra)];
  return [
    ...new Set([
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3000",
      ...extra,
    ]),
  ];
}

function originFromValue(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function requestSelfOrigin(req) {
  if (!req || typeof req !== "object") return "";
  const headers = req.headers && typeof req.headers === "object" ? req.headers : {};
  const hostRaw = headers["x-forwarded-host"] || headers.host;
  if (typeof hostRaw !== "string" || !hostRaw.trim()) return "";
  const host = hostRaw.split(",")[0].trim();
  const xfProto = headers["x-forwarded-proto"];
  let proto = "http";
  if (typeof xfProto === "string" && xfProto.trim()) proto = xfProto.split(",")[0].trim();
  else if (req.secure) proto = "https";
  if (!/^https?$/i.test(proto)) proto = "http";
  return `${proto}://${host}`;
}

function isSameOrigin(origin, req) {
  const o = originFromValue(origin) || String(origin || "").trim();
  const self = requestSelfOrigin(req);
  return !!(o && self && o === self);
}

function isAllowedOrigin(origin, req) {
  const o = originFromValue(origin) || String(origin || "").trim();
  if (!o) return false;
  if (getAllowedOrigins().includes(o)) return true;
  return isSameOrigin(o, req);
}

function corsOriginDelegate(origin, cb) {
  if (!origin) return cb(null, true);
  if (isAllowedOrigin(origin)) return cb(null, origin);
  return cb(null, false);
}

function corsOptionsDelegate(req, callback) {
  const origin = req && req.headers ? req.headers.origin : "";
  if (!origin) return callback(null, { origin: true, credentials: true });
  if (isAllowedOrigin(origin, req)) return callback(null, { origin: true, credentials: true });
  return callback(null, { origin: false, credentials: true });
}

/**
 * 로그인·로그아웃 등 상태 변경 요청의 Origin/Referer 검증.
 * SameSite=Strict 만으로 CSRF 를 생략하지 않는다.
 * 동일 출처(프런트와 API가 같은 호스트)는 allowlist에 없어도 허용한다.
 */
function requireCsrf(req, res, next) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin) {
    if (isAllowedOrigin(origin, req)) return next();
    return res.status(403).json({ error: CSRF_ERROR_MESSAGE });
  }
  const referer = typeof req.headers.referer === "string" ? req.headers.referer : "";
  if (!referer) return next();
  if (isAllowedOrigin(originFromValue(referer), req)) return next();
  return res.status(403).json({ error: CSRF_ERROR_MESSAGE });
}

/* ────────────────────────────────── 미들웨어 ────────────────────────────────── */

function hasRole(payload, roles) {
  if (!roles || roles.length === 0) return true;
  if (!payload || typeof payload !== "object") return false;
  const owned = [];
  if (typeof payload.role === "string" && payload.role) owned.push(payload.role);
  if (Array.isArray(payload.roles)) {
    for (const r of payload.roles) if (typeof r === "string" && r) owned.push(r);
  }
  return owned.some((r) => roles.includes(r));
}

function sendUnauthorized(res) {
  return res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
}

/**
 * 보호 라우트용 Express 미들웨어.
 * 미인증·만료·변조·미설정 모두 401. KB 설정 확인보다 먼저 실행되어야 한다.
 */
function requireAuth(roles) {
  const wanted = Array.isArray(roles)
    ? roles.filter((r) => typeof r === "string" && r)
    : typeof roles === "string" && roles
      ? [roles]
      : [];

  return function requireAuthMiddleware(req, res, next) {
    if (!getSessionSecret()) {
      if (!secretWarningShown) {
        secretWarningShown = true;
        console.warn("[auth] SESSION_SECRET 미설정 — 보호 라우트는 401 로 차단됩니다.");
      }
      return sendUnauthorized(res);
    }

    const token = readToken(req);
    if (!token) return sendUnauthorized(res);

    const result = verifyToken(token);
    if (!result.ok) return sendUnauthorized(res);

    if (!hasRole(result.payload, wanted)) {
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }

    req.auth = result.payload;
    return next();
  };
}

function sessionPublicPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    user: { name: payload.name || ADMIN_DISPLAY_NAME },
    expiresAt: Number.isFinite(payload.exp) ? new Date(payload.exp * 1000).toISOString() : null,
  };
}

const loginRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: RATE_LIMIT_MESSAGE },
  handler: (req, res) => {
    logAuthEvent("login_blocked", req);
    res.status(429).json({ error: RATE_LIMIT_MESSAGE });
  },
};

function __resetForTest() {
  revokedJti.clear();
  secretWarningShown = false;
}

module.exports = {
  PROD_COOKIE_NAME,
  DEV_COOKIE_NAME,
  TOKEN_VERSION,
  DEFAULT_TTL_MIN,
  ADMIN_DISPLAY_NAME,
  LOGIN_ERROR_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  CSRF_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  getCookieName,
  getSessionTtlMin,
  getAdminPasswordHash,
  getAdminLoginId,
  isAuthConfigured,
  hashPassword,
  verifyPassword,
  verifyAdminCredentials,
  issueToken,
  verifyToken,
  readToken,
  parseCookies,
  optionalAuth,
  requireAuth,
  requireCsrf,
  getAllowedOrigins,
  isAllowedOrigin,
  isSameOrigin,
  requestSelfOrigin,
  corsOriginDelegate,
  corsOptionsDelegate,
  buildSessionCookie,
  buildClearCookie,
  sessionPublicPayload,
  revokeJti,
  logAuthEvent,
  loginRateLimitOptions,
  __resetForTest,
};
