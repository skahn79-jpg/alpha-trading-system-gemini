/**
 * ALPHA TRADING SYSTEM - APNs 원격 푸시 모듈
 *
 * 토큰 인증(.p8) 방식 — 인증서 갱신 불필요.
 * 필요 환경변수:
 *   APNS_KEY_ID      = 개발자 포털 Keys에서 발급한 APNs 키 ID (예: 68F8234UMH)
 *   APNS_PRIVATE_KEY = .p8 파일 내용 전체 (-----BEGIN PRIVATE KEY----- 포함)
 *   APNS_TEAM_ID     = 팀 ID (기본 VWAZ3CVW5Z)
 *   APNS_TOPIC       = 번들 ID (기본 com.alpha.trading.ios)
 *   APNS_ENV         = production(기본, TestFlight/앱스토어) | development
 */

const http2 = require("http2");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TEAM_ID = process.env.APNS_TEAM_ID || "VWAZ3CVW5Z";
const TOPIC = process.env.APNS_TOPIC || "com.alpha.trading.ios";
const HOST = (process.env.APNS_ENV || "production") === "development"
  ? "https://api.sandbox.push.apple.com"
  : "https://api.push.apple.com";

function getKey() {
  const keyId = process.env.APNS_KEY_ID;
  let pem = process.env.APNS_PRIVATE_KEY;
  if (!pem && process.env.APNS_KEY_PATH && fs.existsSync(process.env.APNS_KEY_PATH)) {
    pem = fs.readFileSync(process.env.APNS_KEY_PATH, "utf8");
  }
  if (!keyId || !pem) return null;
  // Render 환경변수는 줄바꿈이 \n 문자열로 들어올 수 있음
  if (pem.includes("\\n")) pem = pem.replace(/\\n/g, "\n");
  return { keyId, pem };
}

// ES256 JWT — 40분 캐시 (APNs 권장: 20분~60분 사이 재발급)
let jwtCache = { token: null, at: 0 };
function makeJwt() {
  if (jwtCache.token && Date.now() - jwtCache.at < 40 * 60 * 1000) return jwtCache.token;
  const key = getKey();
  if (!key) throw new Error("APNS_KEY_ID / APNS_PRIVATE_KEY 환경변수가 없습니다");
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid: key.keyId })}.${b64({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: key.pem,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  jwtCache = { token: `${unsigned}.${signature}`, at: Date.now() };
  return jwtCache.token;
}

// ── 디바이스 토큰 저장 (메모리 + 파일 best-effort; 앱 실행 시마다 재등록됨) ──
const TOKENS_PATH = path.join(__dirname, "data/push-tokens.json");
let tokens = new Set();
try {
  const saved = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
  if (Array.isArray(saved)) tokens = new Set(saved);
} catch { /* 첫 실행 */ }

function saveTokens() {
  try {
    fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
    fs.writeFileSync(TOKENS_PATH, JSON.stringify([...tokens]));
  } catch (e) {
    console.warn("[apns] token save failed:", e.message);
  }
}

function registerToken(token) {
  const t = String(token || "").toLowerCase();
  if (!/^[0-9a-f]{64,200}$/.test(t)) throw new Error("잘못된 디바이스 토큰 형식");
  const isNew = !tokens.has(t);
  tokens.add(t);
  if (isNew) saveTokens();
  return { count: tokens.size, isNew };
}

function tokenCount() {
  return tokens.size;
}

function isConfigured() {
  return Boolean(getKey());
}

/** 단일 토큰 발송 — 410(Unregistered)이면 토큰 제거 */
function sendToToken(token, payload) {
  return new Promise((resolve) => {
    let client;
    try {
      client = http2.connect(HOST);
    } catch (e) {
      return resolve({ token, ok: false, error: e.message });
    }
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${makeJwt()}`,
      "apns-topic": TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
    });
    let body = "";
    let status = 0;
    req.setEncoding("utf8");
    req.on("response", (headers) => { status = headers[":status"]; });
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      client.close();
      if (status === 410 || (status === 400 && body.includes("BadDeviceToken"))) {
        tokens.delete(token);
        saveTokens();
      }
      resolve({ token: token.slice(0, 8) + "…", ok: status === 200, status, body: body || null });
    });
    req.on("error", (e) => {
      client.close();
      resolve({ token: token.slice(0, 8) + "…", ok: false, error: e.message });
    });
    req.setTimeout(10000, () => {
      req.close();
      client.close();
      resolve({ token: token.slice(0, 8) + "…", ok: false, error: "timeout" });
    });
    req.end(JSON.stringify(payload));
  });
}

/** 등록된 모든 기기로 알림 발송 */
async function sendPushToAll({ title, body, sound = "default" }) {
  if (!isConfigured()) return { ok: false, sent: 0, reason: "APNS_KEY_ID / APNS_PRIVATE_KEY 환경변수 미설정" };
  if (!tokens.size) return { ok: false, sent: 0, reason: "등록된 기기가 없습니다 (앱을 한 번 실행해 알림 권한을 허용하세요)" };
  const payload = { aps: { alert: { title, body }, sound } };
  const results = [];
  for (const t of [...tokens]) {
    results.push(await sendToToken(t, payload));
  }
  const sent = results.filter((r) => r.ok).length;
  return { ok: sent > 0, sent, total: results.length, results };
}

module.exports = { registerToken, sendPushToAll, tokenCount, isConfigured };
