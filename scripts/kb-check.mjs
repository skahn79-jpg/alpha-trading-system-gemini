#!/usr/bin/env node
/**
 * KB증권 Open API — 조회 전용 진단 스크립트
 *
 * 실행: npm run kb:check
 *
 * 하는 일 (순서대로, 실패 시 즉시 중단):
 *   1) 환경변수 존재 확인 (값 미출력, O/X 만)
 *   2) 액세스 토큰 발급 (토큰 원문 미출력, token_type / 남은 분만)
 *   3) IVU10140 로 삼성전자(005930) 현재가 조회
 *   4) SZQM0771 로 장운영상태 조회
 *
 * 안전 원칙
 *  - 이 스크립트는 읽기(조회)만 한다. 상태를 바꾸는 API 는 호출하지 않는다.
 *  - 앱키/시크릿/토큰 원문은 어떤 경로로도 출력하지 않는다.
 *  - 출력 전 kb/envelope.js 의 sanitize 를 통과시켜 비밀정보를 제거한다.
 *  - 필수 환경변수가 없으면 네트워크 호출을 전혀 하지 않고 안내 후 정상 종료(0)한다.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// .env 로딩 — dotenv 는 기존 의존성이다. 없거나 실패해도 진행한다.
try {
  require("dotenv").config();
} catch {
  /* .env 없이 실제 환경변수만으로 실행하는 경우 */
}

const axios = require("axios");
const { getKbConfig, REQUIRED_ENV, OPTIONAL_ENV } = require("../kb/config.js");
const { sanitize, unwrap } = require("../kb/envelope.js");
const token = require("../kb/token.js");
const broker = require("../kb/broker.js");

/** 진단 대상 종목 — 삼성전자 */
const SYMBOL = "005930";
/** 거래소구분 0:통합 */
const EXCG_CLSF = "0";

/* ── 출력 유틸 ─────────────────────────────────────────────────────── */

function log(msg = "") {
  console.log(msg);
}

function pad(name) {
  return String(name).padEnd(18, " ");
}

function show(v) {
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

/** 각 단계 공통 출력 — HTTP 상태 + KB 공통 응답 헤더 (마스킹 후) */
function printResult(status, rawResponse) {
  const { header } = unwrap(rawResponse);
  const h = sanitize(header && typeof header === "object" ? header : {}) || {};
  log(`  HTTP 상태      : ${show(status)}`);
  log(`  resultCode     : ${show(h.resultCode)}`);
  log(`  processCode    : ${show(h.processCode)}`);
  log(`  processMessage : ${show(h.processMessage || h.resultMessage)}`);
}

/** 실패 시 공통 처리 — 남은 단계를 진행하지 않고 종료한다. */
function fail(stepName, err, status) {
  log("");
  log(`[실패] ${stepName}`);
  if (status !== undefined && status !== null) log(`  HTTP 상태 : ${status}`);
  const msg = err && err.message ? err.message : String(err);
  log(`  사유      : ${msg}`);
  if (err && err.code) log(`  코드      : ${err.code}`);
  if (err && err.resultCode !== undefined && err.resultCode !== null) {
    log(`  resultCode: ${err.resultCode}`);
  }
  if (err && err.responseSafe !== undefined) {
    log(`  응답(마스킹): ${JSON.stringify(sanitize(err.responseSafe))}`);
  }
  restoreHttp();
  process.exit(1);
}

/* ── HTTP 캡처 ─────────────────────────────────────────────────────── */

/**
 * kb 모듈의 HTTP 주입 훅에 끼워 넣어 HTTP 상태 코드와 원 응답을 캡처한다.
 * 동작 자체는 kb 모듈 기본 구현과 동일한 axios POST 이다.
 */
function makeCapture() {
  const state = { status: null, data: null };
  const impl = async (url, body, headers = {}, timeout = 10000) => {
    try {
      const res = await axios.post(url, body, {
        headers: { "Content-Type": "application/json", ...headers },
        timeout,
      });
      state.status = res.status;
      state.data = res.data;
      return res.data;
    } catch (err) {
      state.status = err && err.response ? err.response.status : null;
      state.data = err && err.response ? err.response.data : null;
      throw err;
    }
  };
  return { state, impl };
}

function restoreHttp() {
  try {
    token.__setHttpForTest(null);
    broker.__setHttpForTest(null);
  } catch {
    /* noop */
  }
}

/* ── 1) 환경변수 ───────────────────────────────────────────────────── */

function checkEnv() {
  log("[1/4] 환경변수 확인");
  const present = (name) => {
    const v = process.env[name];
    return typeof v === "string" && v.trim() !== "" ? "O" : "X";
  };
  for (const name of REQUIRED_ENV) log(`  ${pad(name)}: ${present(name)}  (필수)`);
  for (const name of OPTIONAL_ENV) log(`  ${pad(name)}: ${present(name)}  (선택)`);

  const cfg = getKbConfig();
  log(`  ${pad("baseUrl")}: ${cfg.baseUrl}`);

  if (!cfg.configured) {
    log("");
    log("환경변수 미설정 — 네트워크 호출 없이 종료합니다.");
    log(`  누락: ${cfg.missing.join(", ")}`);
    log("  .env 에 KBSEC_APP_KEY / KBSEC_APP_SECRET 를 설정한 뒤 다시 실행하세요.");
    log("  (선택 항목 KBSEC_IP_ADDR / KBSEC_MAC_ADDR 는 없어도 동작합니다.)");
    return false;
  }
  log("  → 필수 환경변수 모두 존재");
  return true;
}

/* ── 2) 토큰 ───────────────────────────────────────────────────────── */

async function checkToken() {
  log("");
  log("[2/4] 액세스 토큰 발급");
  log(`  경로           : ${token.TOKEN_PATH}`);
  const cap = makeCapture();
  token.__setHttpForTest(cap.impl);
  try {
    await token.getAccessToken({ force: true });
  } catch (err) {
    fail("토큰 발급", err, cap.state.status);
  }
  token.__setHttpForTest(null);

  printResult(cap.state.status, cap.state.data);

  // 토큰 원문은 출력하지 않는다. 타입과 만료까지 남은 "분"만 노출한다.
  const parsed = token.extractTokenPayload(cap.state.data);
  const info = token.getTokenCacheInfo();
  const remainMin =
    info && info.cached && Number.isFinite(Number(info.expiresAt)) ?
      Math.max(0, Math.round((Number(info.expiresAt) - Date.now()) / 60000))
    : null;
  log(`  token_type     : ${show(parsed && parsed.tokenType)}`);
  log(`  만료까지       : ${remainMin === null ? "-" : `${remainMin}분`}`);
}

/* ── 3) IVU10140 현재가 ────────────────────────────────────────────── */

async function checkQuote() {
  log("");
  log(`[3/4] 현재가 조회 (${SYMBOL} 삼성전자)`);
  log(`  TR ID          : ${broker.TR.QUOTE.code}`);
  log(`  경로           : ${broker.TR.QUOTE.path}`);

  const cap = makeCapture();
  broker.__setHttpForTest(cap.impl);
  let quote;
  try {
    quote = await broker.getQuote(SYMBOL, EXCG_CLSF);
  } catch (err) {
    fail(`현재가 조회 (${broker.TR.QUOTE.code})`, err, cap.state.status);
  }
  broker.__setHttpForTest(null);

  printResult(cap.state.status, cap.state.data);
  log(`  종목명         : ${show(quote.name)}`);
  log(`  현재가         : ${show(quote.price)}`);
  log(`  전일대비       : ${show(quote.change)}`);
  log(`  등락율(P2 원값): ${show(quote.changeRate)}`);
  log(`  누적거래량     : ${show(quote.volume)}`);
}

/* ── 4) SZQM0771 장운영상태 ────────────────────────────────────────── */

async function checkMarketStatus() {
  log("");
  log("[4/4] 장운영상태 조회");
  log(`  TR ID          : ${broker.TR.MARKET_STATUS.code}`);
  log(`  경로           : ${broker.TR.MARKET_STATUS.path}`);

  const cap = makeCapture();
  broker.__setHttpForTest(cap.impl);
  let status;
  try {
    status = await broker.getMarketStatus();
  } catch (err) {
    fail(`장운영상태 조회 (${broker.TR.MARKET_STATUS.code})`, err, cap.state.status);
  }
  broker.__setHttpForTest(null);

  printResult(cap.state.status, cap.state.data);
  log(`  기준영업일     : ${show(status.businessDate)}`);
  log(`  현재일시       : ${show(status.date)} ${show(status.time)}`);
  log(`  요일           : ${show(status.weekday)} (${show(status.weekdayCode)})`);
  log(`  유가증권구분   : ${show(status.stockMarketCode)}`);
  log(`  코스닥구분     : ${show(status.kosdaqMarketCode)}`);
  // 구분코드 값의 의미는 명세 미확보 → 원값 그대로만 보여준다(파생 판정 금지).
}

/* ── main ──────────────────────────────────────────────────────────── */

async function main() {
  log("=== KB증권 Open API 조회 전용 진단 ===");
  log("");

  if (!checkEnv()) {
    // 미설정은 오류가 아니라 안내다.
    process.exit(0);
  }

  await checkToken();
  await checkQuote();
  await checkMarketStatus();

  restoreHttp();
  log("");
  log("=== 전체 단계 정상 완료 ===");
}

main().catch((err) => {
  restoreHttp();
  log("");
  log(`[실패] 예기치 못한 오류: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
