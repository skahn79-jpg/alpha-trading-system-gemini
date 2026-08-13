/**
 * 단일 관리자 인증 — HTTP 통합 테스트 (KB 실호출 없음)
 */

"use strict";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret-value-32chars!!";
process.env.ADMIN_LOGIN_ID = "admin-test";
process.env.SESSION_TTL_MINUTES = "60";
process.env.ALLOWED_ORIGIN = "http://localhost:5173";
process.env.KBSEC_TRADING_ENABLED = "false";
process.env.KBSEC_AUTO_TRADING_ENABLED = "false";
delete process.env.KBSEC_APP_KEY;
delete process.env.KBSEC_APP_SECRET;
process.env.KBSEC_APP_KEY = "";
process.env.KBSEC_APP_SECRET = "";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../kb/auth.js");

const LOGIN_ID = "admin-test";
const PASSWORD = "correct-password-value";
const ORIGIN = "http://localhost:5173";
const LOGIN_ERROR = "로그인 정보가 올바르지 않습니다.";

let app;
let server;
let baseUrl;
let ipSeq = 20;

function nextIp() {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const v = res.headers.get("set-cookie");
  return v ? [v] : [];
}

function cookiePair(setCookies) {
  return setCookies
    .map((c) => String(c).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function assertNoSecrets(text) {
  const body = String(text || "");
  assert.equal(body.includes("KBSEC_APP_KEY"), false);
  assert.equal(body.includes("KBSEC_APP_SECRET"), false);
  assert.equal(body.includes(PASSWORD), false);
  assert.equal(body.includes("test-session-secret-value-32chars!!"), false);
}

async function api(method, path, { ip, cookie, origin, body } = {}) {
  const headers = {
    "X-Forwarded-For": ip || nextIp(),
  };
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, status: res.status, text, json, cookies: getSetCookies(res) };
}

async function login(ip, loginId = LOGIN_ID, password = PASSWORD) {
  return api("POST", "/api/auth/login", {
    ip,
    origin: ORIGIN,
    body: { loginId, password },
  });
}

before(async () => {
  process.env.ADMIN_PASSWORD_HASH = await auth.hashPassword(PASSWORD);
  delete process.env.KBSEC_APP_KEY;
  delete process.env.KBSEC_APP_SECRET;
  process.env.KBSEC_APP_KEY = "";
  process.env.KBSEC_APP_SECRET = "";
  app = require("../server.js");
  delete process.env.KBSEC_APP_KEY;
  delete process.env.KBSEC_APP_SECRET;
  process.env.KBSEC_APP_KEY = "";
  process.env.KBSEC_APP_SECRET = "";
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("login success: no token/password/hash in JSON; Set-Cookie HttpOnly SameSite=Strict Path=/", async () => {
  const { status, text, json, cookies } = await login(nextIp());
  assert.equal(status, 200);
  assert.ok(json);
  assert.equal(json.authenticated, true);
  assert.equal(json.token, undefined);
  assert.equal(json.password, undefined);
  assert.equal(json.hash, undefined);
  assert.equal(text.includes(PASSWORD), false);
  assert.equal(/\$argon2/i.test(text), false);
  const joined = cookies.join("\n");
  assert.match(joined, /HttpOnly/i);
  assert.match(joined, /SameSite=Strict/i);
  assert.match(joined, /Path=\//i);
  assertNoSecrets(text);
});

test("wrong id and wrong password share the same error body", async () => {
  const wrongId = await login(nextIp(), "not-the-admin", PASSWORD);
  const wrongPw = await login(nextIp(), LOGIN_ID, "wrong-password-value");
  assert.equal(wrongId.status, 401);
  assert.equal(wrongPw.status, 401);
  assert.deepEqual(wrongId.json, { error: LOGIN_ERROR });
  assert.deepEqual(wrongPw.json, { error: LOGIN_ERROR });
});

test("session unauthenticated returns authenticated false", async () => {
  const { status, json } = await api("GET", "/api/auth/session", { ip: nextIp() });
  assert.equal(status, 200);
  assert.equal(json.authenticated, false);
});

test("expired cookie is 401 on protected API", async () => {
  const token = auth.issueToken({
    role: "admin",
    iat: nowSec() - 120,
    exp: nowSec() - 5,
  });
  const { status, text } = await api("GET", "/api/broker/status", {
    ip: nextIp(),
    cookie: `alpha_session=${token}`,
  });
  assert.equal(status, 401);
  assertNoSecrets(text);
});

test("tampered cookie is 401 on protected API", async () => {
  const token = auth.issueToken({ role: "admin" });
  const tampered = `${token.slice(0, -4)}xxxx`;
  const { status, text } = await api("GET", "/api/broker/status", {
    ip: nextIp(),
    cookie: `alpha_session=${tampered}`,
  });
  assert.equal(status, 401);
  assertNoSecrets(text);
});

test("logout then reuse cookie is 401", async () => {
  const ip = nextIp();
  const loggedIn = await login(ip);
  assert.equal(loggedIn.status, 200);
  const cookie = cookiePair(loggedIn.cookies);
  assert.ok(cookie);
  const logout = await api("POST", "/api/auth/logout", {
    ip,
    origin: ORIGIN,
    cookie,
  });
  assert.equal(logout.status, 200);
  const reuse = await api("GET", "/api/broker/status", { ip: nextIp(), cookie });
  assert.equal(reuse.status, 401);
});

test("6 failed logins from the same IP return 429", async () => {
  const ip = "198.51.100.66";
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const r = await login(ip, LOGIN_ID, "wrong-password-value");
    statuses.push(r.status);
  }
  assert.equal(statuses[5], 429);
  assert.ok(statuses.slice(0, 5).every((s) => s === 401));
});

test("unauthenticated GET 401 for protected broker/trading routes without env names", async () => {
  const paths = [
    "/api/broker/status",
    "/api/trading/market-status",
    "/api/trading/quotes/005930",
    "/api/trading/balance",
    "/api/trading/positions",
    "/api/trading/orderable-amount",
    "/api/trading/orders",
    "/api/trading/executions",
  ];
  for (const path of paths) {
    const { status, text } = await api("GET", path, { ip: nextIp() });
    assert.equal(status, 401, path);
    assertNoSecrets(text);
    assert.equal(text.includes("KBSEC_APP_KEY"), false, path);
  }
});

test("unauthenticated + KB unset is 401 not 503", async () => {
  const { status, text } = await api("GET", "/api/trading/balance", { ip: nextIp() });
  assert.equal(status, 401);
  assert.notEqual(status, 503);
  assertNoSecrets(text);
});

test("auth + KB unset: broker/status 200 without env names", async () => {
  const loggedIn = await login(nextIp());
  assert.equal(loggedIn.status, 200);
  const cookie = cookiePair(loggedIn.cookies);
  const { status, json, text } = await api("GET", "/api/broker/status", {
    ip: nextIp(),
    cookie,
  });
  assert.equal(status, 200);
  assert.equal(json.configured, false);
  assert.equal(json.connection, "unverified");
  assert.equal(typeof json.tradingEnabled, "boolean");
  assert.equal(typeof json.autoTradingEnabled, "boolean");
  assert.equal("missing" in json, false);
  assert.equal("optionalMissing" in json, false);
  assertNoSecrets(text);
});

test("auth + KB unset: /api/trading/balance 503 generic, no KBSEC_APP_KEY", async () => {
  const loggedIn = await login(nextIp());
  const cookie = cookiePair(loggedIn.cookies);
  const { status, json, text } = await api("GET", "/api/trading/balance", {
    ip: nextIp(),
    cookie,
  });
  assert.equal(status, 503);
  assert.ok(json && json.error);
  assert.equal(text.includes("KBSEC_APP_KEY"), false);
  assertNoSecrets(text);
});

test("evil Origin on POST login is 403", async () => {
  const { status, json } = await api("POST", "/api/auth/login", {
    ip: nextIp(),
    origin: "https://evil.example",
    body: { loginId: LOGIN_ID, password: PASSWORD },
  });
  assert.equal(status, 403);
  assert.ok(json && json.error);
});

test("POST /api/trading/orders while authed and trading disabled is 403", async () => {
  const loggedIn = await login(nextIp());
  const cookie = cookiePair(loggedIn.cookies);
  const { status, json } = await api("POST", "/api/trading/orders", {
    ip: nextIp(),
    origin: ORIGIN,
    cookie,
    body: { symbol: "005930" },
  });
  assert.equal(status, 403);
  assert.ok(json && json.error);
});
