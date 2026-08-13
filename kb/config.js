/**
 * KB증권 Open API — 설정 로더 & 민감정보 마스킹
 *
 * 원칙
 *  - 환경변수는 "호출 시점"에 읽는다(모듈 로드 시 캐시 금지). 테스트에서 process.env를
 *    바꿔가며 검증할 수 있어야 하고, 런타임 재설정도 즉시 반영되어야 한다.
 *  - 앱키/시크릿/토큰/계좌번호는 로그·에러메시지에 절대 원문 노출 금지.
 *  - 설정이 없어도 예외를 던지지 않는다(= 앱 기동을 막지 않는다). configured=false 로만 알린다.
 */

"use strict";

const DEFAULT_BASE_URL = "https://developer.kbsec.com:32484";

/** 필수 환경변수 — 없으면 KB 기능 전체 비활성 */
const REQUIRED_ENV = ["KBSEC_APP_KEY", "KBSEC_APP_SECRET"];
/** 선택 환경변수 — 없어도 configured 판정에 영향 없음 (dataHeader 용) */
const OPTIONAL_ENV = ["KBSEC_IP_ADDR", "KBSEC_MAC_ADDR"];

/**
 * KB 설정 미비 시 사용하는 에러.
 * code = "KB_NOT_CONFIGURED", missing = 누락된 환경변수명 배열
 */
class ConfigError extends Error {
  constructor(missing = [], message) {
    const list = Array.isArray(missing) ? missing : [];
    super(message || `KB증권 연결 설정 필요 (누락: ${list.join(", ") || "-"})`);
    this.name = "ConfigError";
    this.code = "KB_NOT_CONFIGURED";
    this.missing = list;
  }
}

/**
 * 비밀값 마스킹: 앞 2자 · 뒤 2자만 노출, 나머지는 '*'.
 * 길이 4 이하 → 전부 마스킹. null/undefined/빈값 → "" (안전 처리).
 */
function maskSecret(s) {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (str.length === 0) return "";
  if (str.length <= 4) return "*".repeat(str.length);
  return `${str.slice(0, 2)}${"*".repeat(str.length - 4)}${str.slice(-2)}`;
}

/**
 * 계좌번호 마스킹: 마지막 4자리만 노출, 앞은 전부 '*'.
 * 길이 4 이하 → 전부 마스킹. null/undefined/빈값 → "".
 */
function maskAccount(no) {
  if (no === null || no === undefined) return "";
  const str = String(no);
  if (str.length === 0) return "";
  if (str.length <= 4) return "*".repeat(str.length);
  return `${"*".repeat(str.length - 4)}${str.slice(-4)}`;
}

function envStr(name) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

/** 문자열 "true" 일 때만 true. 그 외(미설정·"1"·"TRUE"·"yes" 등) 전부 false. */
function envFlag(name) {
  return envStr(name) === "true";
}

/**
 * 호출 시점의 환경변수를 읽어 KB 설정 스냅샷을 반환한다.
 * @returns {{
 *   configured: boolean, missing: string[], optionalMissing: string[],
 *   baseUrl: string, appKey: string, appSecret: string,
 *   ipAddr: string, macAddr: string,
 *   tradingEnabled: boolean, autoTradingEnabled: boolean
 * }}
 */
function getKbConfig() {
  const appKey = envStr("KBSEC_APP_KEY");
  const appSecret = envStr("KBSEC_APP_SECRET");
  const ipAddr = envStr("KBSEC_IP_ADDR");
  const macAddr = envStr("KBSEC_MAC_ADDR");
  const baseUrl = envStr("KBSEC_BASE_URL") || DEFAULT_BASE_URL;

  const missing = [];
  if (!appKey) missing.push("KBSEC_APP_KEY");
  if (!appSecret) missing.push("KBSEC_APP_SECRET");

  const optionalMissing = [];
  if (!ipAddr) optionalMissing.push("KBSEC_IP_ADDR");
  if (!macAddr) optionalMissing.push("KBSEC_MAC_ADDR");

  return {
    configured: missing.length === 0,
    missing,
    optionalMissing,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    appKey,
    appSecret,
    ipAddr,
    macAddr,
    // 주문 기능 플래그 — 기본 false. 현재 구현은 플래그와 무관하게 주문을 항상 차단한다.
    tradingEnabled: envFlag("KBSEC_TRADING_ENABLED"),
    autoTradingEnabled: envFlag("KBSEC_AUTO_TRADING_ENABLED"),
  };
}

/** 로그용 요약 — 원문 비밀값이 절대 포함되지 않는다. */
function describeConfig(cfg = getKbConfig()) {
  return {
    configured: cfg.configured,
    baseUrl: cfg.baseUrl,
    appKey: maskSecret(cfg.appKey),
    appSecret: maskSecret(cfg.appSecret),
    ipAddr: cfg.ipAddr ? maskSecret(cfg.ipAddr) : "",
    macAddr: cfg.macAddr ? maskSecret(cfg.macAddr) : "",
    missing: cfg.missing,
    optionalMissing: cfg.optionalMissing,
    tradingEnabled: cfg.tradingEnabled,
    autoTradingEnabled: cfg.autoTradingEnabled,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  REQUIRED_ENV,
  OPTIONAL_ENV,
  ConfigError,
  getKbConfig,
  describeConfig,
  maskSecret,
  maskAccount,
};
