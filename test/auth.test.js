/**
 * 단일 관리자 인증 — 단위 테스트 (네트워크 호출 없음)
 */

"use strict";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret-value-32chars!!";
process.env.ADMIN_LOGIN_ID = "admin-test";
process.env.SESSION_TTL_MINUTES = "60";
process.env.ALLOWED_ORIGIN = "http://localhost:5173";
delete process.env.KBSEC_APP_KEY;
delete process.env.KBSEC_APP_SECRET;

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../kb/auth.js");

const PLAIN = "correct-password-value";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

test.before(() => {
  auth.__resetForTest();
});

test("argon2id hash verifies matching password and rejects mismatch", async () => {
  const hash = await auth.hashPassword(PLAIN);
  process.env.ADMIN_PASSWORD_HASH = hash;
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await auth.verifyPassword(PLAIN, hash), true);
  assert.equal(await auth.verifyPassword("wrong-password-value", hash), false);
  assert.equal(await auth.verifyPassword("", hash), false);
});

test("expired token is rejected", () => {
  const token = auth.issueToken({
    role: "admin",
    iat: nowSec() - 120,
    exp: nowSec() - 10,
  });
  const result = auth.verifyToken(token);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "EXPIRED");
});

test("tampered token is rejected", () => {
  const token = auth.issueToken({ role: "admin" });
  const tampered = `${token.slice(0, -4)}xxxx`;
  const result = auth.verifyToken(tampered);
  assert.equal(result.ok, false);
  assert.notEqual(result.reason, "EXPIRED");
});

test("revokeJti invalidates a previously valid token", () => {
  const token = auth.issueToken({ role: "admin" });
  const first = auth.verifyToken(token);
  assert.equal(first.ok, true);
  auth.revokeJti(first.payload.jti, first.payload.exp);
  const second = auth.verifyToken(token);
  assert.equal(second.ok, false);
});

test("production cookie flags use __Host- name with HttpOnly Secure SameSite=Strict Path=/", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const cookie = auth.buildSessionCookie("dummy-session-token");
    assert.match(cookie, /^__Host-alpha_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//);
    assert.equal(auth.getCookieName(), "__Host-alpha_session");
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("origin allowlist rejects an evil origin", () => {
  assert.equal(auth.isAllowedOrigin("http://localhost:5173"), true);
  assert.equal(auth.isAllowedOrigin("https://evil.example"), false);
  assert.equal(auth.isAllowedOrigin("https://evil.example.com"), false);
});
