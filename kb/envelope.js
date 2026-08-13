/**
 * KB증권 Open API — 요청/응답 공통 래퍼 & 값 변환 유틸
 *
 * 요청 래퍼(확보된 사양):
 *   { "dataHeader": { "ipAddr": "...", "macAddr": "..." },
 *     "dataBody":   { ...TR별 필드... } }
 *
 * 응답 래퍼는 dataHeader/dataBody 구조로 가정하되, **개별 응답 필드명은 미확보**이므로
 * 이 모듈은 필드 해석을 하지 않는다(구조 분해 + 안전 사본 생성까지만).
 */

"use strict";

const { maskSecret, maskAccount } = require("./config.js");

/** dataHeader 생성 — 미설정 항목은 빈 문자열 */
function buildDataHeader(cfg = {}) {
  return {
    ipAddr: typeof cfg.ipAddr === "string" ? cfg.ipAddr : "",
    macAddr: typeof cfg.macAddr === "string" ? cfg.macAddr : "",
  };
}

/** 표준 요청 바디 생성 */
function buildRequest(cfg = {}, body = {}) {
  return {
    dataHeader: buildDataHeader(cfg),
    dataBody: { ...(body || {}) },
  };
}

/** 키 이름 정규화(대소문자/구분자 제거) */
function normKey(k) {
  return String(k).toLowerCase().replace(/[_\-\s]/g, "");
}

/** 비밀값으로 취급할 키인가 */
function isSecretKey(k) {
  const n = normKey(k);
  return (
    n.includes("secret") ||
    n.includes("token") ||
    n.includes("password") ||
    n.includes("passwd") ||
    n === "appkey" ||
    n === "authorization" ||
    n === "apikey"
  );
}

/** 계좌번호로 취급할 키인가 */
function isAccountKey(k) {
  const n = normKey(k);
  return n.includes("acnt") || n.includes("account");
}

/**
 * 비밀값/계좌번호를 재귀적으로 마스킹한 안전 사본을 만든다.
 * 순환 참조 방어. 함수/심볼 등은 버린다.
 */
function sanitize(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 12) return "[depth-limit]";

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function" || t === "symbol") return undefined;

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map((v) => sanitize(v, seen, depth + 1));
  }

  if (t === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) {
        out[k] = v === null || v === undefined ? v : maskSecret(v);
      } else if (isAccountKey(k) && (typeof v === "string" || typeof v === "number")) {
        out[k] = maskAccount(v);
      } else {
        const s = sanitize(v, seen, depth + 1);
        if (s !== undefined) out[k] = s;
      }
    }
    return out;
  }
  return undefined;
}

/**
 * 응답 래퍼 분해.
 * @returns {{ header: any, body: any, rawSafe: any }}
 *   rawSafe = 비밀값/계좌번호가 제거·마스킹된 로그 안전 사본
 */
function unwrap(res) {
  const src = res && typeof res === "object" ? res : {};
  return {
    header: src.dataHeader !== undefined ? src.dataHeader : null,
    body: src.dataBody !== undefined ? src.dataBody : null,
    rawSafe: sanitize(src),
  };
}

/**
 * 문자열 숫자 → 정수.
 *  - "1,234,500" → 1234500
 *  - "" / null / undefined / 숫자 아님 → null (0 아님)
 *  - 부호 처리. 소수면 정수부만(Math.trunc 결과) 반환.
 */
function toInt(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return Number.isFinite(s) ? Math.trunc(s) : null;
  const str = String(s).replace(/,/g, "").replace(/\s+/g, "");
  if (str === "") return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(str)) return null;
  const n = Number(str);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * 금액 부동소수 오차 방지용 — 콤마/공백만 제거한 "문자열" 그대로 반환.
 * 숫자 변환하지 않는다. 빈값/null/undefined → null.
 */
function toDecimalString(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).replace(/,/g, "").replace(/\s+/g, "");
  return str === "" ? null : str;
}

module.exports = {
  buildDataHeader,
  buildRequest,
  unwrap,
  sanitize,
  toInt,
  toDecimalString,
};
