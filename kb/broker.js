/**
 * KB증권 Open API — TR 호출 계층 (조회 전용)
 *
 * 확보된 사양: docs/kb/spec-extract.txt 의 6개 TR(INPUT/OUTPUT 항목명)만 사용한다.
 * **명세에 없는 필드는 만들어내지 않는다.** 미확정 항목은 TODO(FIELD_SPEC) 주석으로 남긴다.
 *
 * 미확정 항목 목록 (TODO(FIELD_SPEC))
 *  1) TR 코드(SZQM0771 등)를 요청에 어떻게 실어야 하는지 명세 미확보.
 *     현재는 path(/api/v1/xxx)가 TR을 식별한다고 보고 trCode 는 에러 표기용으로만 쓴다.
 *  2) 공통 응답 헤더(dataHeader)의 성공 판정 필드는 resultCode="200" & processCode="0000" 로
 *     지시받았으나, 코드 체계 전체 목록은 미확보.
 *  3) SZQM0771 의 장운영구분코드(stk_mkoprt_ccd / ksdq_mkoprt_ccd / bnd_mkoprt_ccd /
 *     fts_mkoprt_ccd / opt_mkoprt_ccd)와 마감여부 플래그(on_clsng_f, jb_clsng_f)의
 *     **코드값 의미가 명세에 없다** → isOpen 같은 boolean 파생값을 추측해 만들지 않는다.
 *  4) IVU10140 의 up_dwn_r_p2(등락율P2) 등 "P2/P3/P4/P6/P9" 접미 필드의 스케일(소수점 자리)이
 *     명세에 없다 → 원값을 그대로 숫자화해 노출한다(임의 나눗셈 금지).
 *  5) SSQM1802 는 "매수주문가능금액" API 설명에 수량/희망단가가 언급되지만
 *     INPUT/OUTPUT 항목표에는 주문가능"수량"·희망단가 필드가 존재하지 않는다 → 생성하지 않는다.
 *  6) SSQM2341 의 cn_clsf(연속구분) 코드값 의미 미확보 → 연속조회 판정은 nxt_key 존재 여부로만 한다.
 */

"use strict";

const axios = require("axios");
const { getKbConfig, ConfigError } = require("./config.js");
const { buildRequest, unwrap, toInt, toDecimalString } = require("./envelope.js");
const { getAccessToken } = require("./token.js");

const HTTP_TIMEOUT_MS = 10 * 1000;

/** 성공 판정 상수 */
const OK_RESULT_CODE = "200";
const OK_PROCESS_CODE = "0000";

/** TR 코드 → 경로 */
const TR = {
  MARKET_STATUS: { code: "SZQM0771", path: "/api/v1/szqm0771" },
  QUOTE: { code: "IVU10140", path: "/api/v1/ivu10140" },
  ORDERABLE_AMOUNT: { code: "SSQM1802", path: "/api/v1/ssqm1802" },
  BALANCE_SETTLED: { code: "SSQM2932", path: "/api/v1/ssqm2932" },
  BALANCE_EXECUTED: { code: "SSQM2952", path: "/api/v1/ssqm2952" },
  EXECUTIONS: { code: "SSQM2341", path: "/api/v1/ssqm2341" },
};

/** 주문 상태 표준값 */
const ORDER_STATUS = Object.freeze({
  CREATED: "CREATED",
  RISK_CHECKED: "RISK_CHECKED",
  SUBMITTING: "SUBMITTING",
  ACCEPTED: "ACCEPTED",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  AMEND_PENDING: "AMEND_PENDING",
  CANCEL_PENDING: "CANCEL_PENDING",
  CANCELED: "CANCELED",
  REJECTED: "REJECTED",
  UNKNOWN: "UNKNOWN",
});

/* ── 에러 ──────────────────────────────────────────────────────────── */

/**
 * KB API 업무 실패(HTTP 는 200 이지만 헤더가 실패를 알리는 경우).
 * **appKey/appSecret/token 등 비밀정보는 절대 담지 않는다.**
 */
class KbApiError extends Error {
  constructor(header, trCode) {
    const h = header && typeof header === "object" ? header : {};
    const msg =
      firstNonEmpty(h.processMessage, h.resultMessage) ||
      `KB API 호출 실패 (${trCode || "-"})`;
    super(String(msg));
    this.name = "KbApiError";
    this.code = h.processCode === undefined ? null : h.processCode;
    this.resultCode = h.resultCode === undefined ? null : h.resultCode;
    this.trCode = trCode || null;
  }
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s !== "") return s;
  }
  return "";
}

/* ── 값 변환 ───────────────────────────────────────────────────────── */

/**
 * 비율/소수 변환. 콤마 제거 후 Number.
 * 빈문자/null/undefined/비유한값 → null (0 아님).
 */
function toNum(s) {
  const str = toDecimalString(s);
  if (str === null) return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

/** 문자열 필드 정규화 — undefined/null 은 null, 그 외는 trim 된 문자열(빈문자는 null). */
function toStr(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  return str === "" ? null : str;
}

/**
 * 응답 body 의 Record1 을 배열로 정규화.
 * 없으면 [], 단일 객체면 [obj]. 대소문자 변형(record1)도 관대하게 수용.
 */
function toRecords(body) {
  if (!body || typeof body !== "object") return [];
  let v;
  if (body.Record1 !== undefined) v = body.Record1;
  else if (body.record1 !== undefined) v = body.record1;
  else {
    const key = Object.keys(body).find((k) => k.toLowerCase() === "record1");
    v = key === undefined ? undefined : body[key];
  }
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.filter((r) => r && typeof r === "object");
  if (typeof v === "object") return [v];
  return [];
}

/** KST(UTC+9) 기준 오늘 YYYYMMDD */
function kstToday(now = Date.now()) {
  const d = new Date(now + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/* ── HTTP (테스트 주입 가능) ───────────────────────────────────────── */

/** @type {((url:string, body:any, headers:object, timeout:number)=>Promise<any>)|null} */
let _httpImpl = null;

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

/**
 * 공통 TR 호출.
 *  1) 토큰 획득 (미설정이면 네트워크 호출 없이 ConfigError 전파)
 *  2) POST {baseUrl}{path}, Authorization: Bearer …, body = buildRequest(cfg, dataBody)
 *  3) unwrap 후 resultCode/processCode 로 성공 판정
 * @returns {Promise<{header:any, body:any}>}
 */
async function callTr(trCode, path, dataBody = {}) {
  // 미설정이면 여기서 ConfigError 가 그대로 전파된다(네트워크 호출 없음).
  const token = await getAccessToken();
  const cfg = getKbConfig();
  const url = `${cfg.baseUrl}${path}`;
  const payload = buildRequest(cfg, dataBody);

  let data;
  try {
    data = await _httpPost(
      url,
      payload,
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      HTTP_TIMEOUT_MS,
    );
  } catch (err) {
    // axios err.config/headers 에는 Authorization 등 비밀값이 섞인다 → 절대 전파 금지.
    const status = err && err.response ? err.response.status : null;
    const safe = new Error(
      `KB API 요청 실패 (${trCode})${status ? ` (HTTP ${status})` : ""}`,
    );
    safe.code = "KB_REQUEST_FAILED";
    safe.status = status;
    safe.trCode = trCode;
    if (err && err.response && err.response.data) {
      safe.responseSafe = unwrap(err.response.data).rawSafe;
    }
    throw safe;
  }

  const { header, body } = unwrap(data);
  const h = header && typeof header === "object" ? header : {};
  const ok =
    String(h.resultCode) === OK_RESULT_CODE && String(h.processCode) === OK_PROCESS_CODE;
  if (!ok) throw new KbApiError(h, trCode);

  return { header: h, body };
}

/* ── 1) SZQM0771 장운영상태 ────────────────────────────────────────── */

/**
 * 장운영상태 조회. INPUT 필드 없음.
 * TODO(FIELD_SPEC): 장운영구분코드 값의 의미가 명세에 없어 isOpen 등 boolean 파생 금지.
 */
async function getMarketStatus() {
  const { body } = await callTr(TR.MARKET_STATUS.code, TR.MARKET_STATUS.path, {});
  const b = body || {};
  return {
    date: toStr(b.now_dt),
    time: toStr(b.now_tm),
    businessDate: toStr(b.std_bsnss_dt),
    prevBusinessDate: toStr(b.bfr_bsns_dt),
    nextBusinessDate: toStr(b.next_biz_dt),
    orderBaseDate: toStr(b.ordr_std_dt),
    weekday: toStr(b.wd),
    weekdayCode: toStr(b.wd_ccd),
    onlineClosed: toStr(b.on_clsng_f),
    businessClosed: toStr(b.jb_clsng_f),
    stockMarketCode: toStr(b.stk_mkoprt_ccd),
    kosdaqMarketCode: toStr(b.ksdq_mkoprt_ccd),
    bondMarketCode: toStr(b.bnd_mkoprt_ccd),
    futuresMarketCode: toStr(b.fts_mkoprt_ccd),
    optionMarketCode: toStr(b.opt_mkoprt_ccd),
    message: toStr(b.o_msg),
    raw: body,
  };
}

/* ── 2) IVU10140 현재가 ────────────────────────────────────────────── */

/**
 * 현재가 조회.
 * @param {string} symbol 단축코드(shrt_cd)
 * @param {string} [excgClsf] 거래소구분 0:통합, 1:KRX, 2:NXT
 * TODO(FIELD_SPEC): up_dwn_r_p2 의 P2 스케일 미확보 → 원값 그대로 반환.
 */
async function getQuote(symbol, excgClsf = "0") {
  const code = toStr(symbol);
  if (!code) {
    const e = new Error("종목코드(symbol)가 필요합니다");
    e.code = "KB_INVALID_ARGUMENT";
    throw e;
  }
  const { body } = await callTr(TR.QUOTE.code, TR.QUOTE.path, {
    excg_clsf: toStr(excgClsf) || "0",
    shrt_cd: code,
  });
  const b = body || {};
  return {
    symbol: code,
    name: toStr(b.is_nm),
    price: toInt(b.now_prc),
    change: toInt(b.bdy_cmpr),
    changeRate: toNum(b.up_dwn_r_p2),
    volume: toInt(b.acml_vlm),
    open: toInt(b.opn_prc),
    high: toInt(b.hgh_prc),
    low: toInt(b.lw_prc),
    prevClose: toInt(b.bdy_cls_prc),
    upperLimit: toInt(b.ulmt_prc),
    lowerLimit: toInt(b.llmt_prc),
    askPrice: toInt(b.s_sq1_askprc),
    bidPrice: toInt(b.b_sq1_askprc),
    marketName: toStr(b.mkt_clsf_nm),
    raw: body,
  };
}

/* ── 3) SSQM1802 매수주문가능금액 ──────────────────────────────────── */

/**
 * 매수주문가능금액 조회. INPUT: is_no(종목번호, 필수여부 N).
 * TODO(FIELD_SPEC): 주문가능"수량"·희망단가는 INPUT/OUTPUT 명세에 존재하지 않는다 → 미구현.
 */
async function getOrderableAmount(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const isNo = toStr(src.symbol) || toStr(src.is_no) || "";
  const { body } = await callTr(TR.ORDERABLE_AMOUNT.code, TR.ORDERABLE_AMOUNT.path, {
    is_no: isNo,
  });
  const b = body || {};
  return {
    deposit: toInt(b.tfnd),
    orderableCash: toInt(b.ordr_psbl_csh),
    orderableSubstitute: toInt(b.ordr_psbl_sbt),
    orderableTotal: toInt(b.ordr_psbl_tl_amt),
    orderable100pct: toInt(b.pcnt100_ordr_psbl_amt),
    maxOrderableAmount: toInt(b.mx_ordr_psbl_amt),
    withdrawableCash: toInt(b.do_psbl_csh),
    substituteTotal: toInt(b.sbt_tl_amt),
    maxOrderableAmountA: toInt(b.mx_ordr_psbl_amt_a_grp),
    maxOrderableAmountB: toInt(b.mx_ordr_psbl_amt_b_grp),
    maxOrderableAmountC: toInt(b.mx_ordr_psbl_amt_c_grp),
    message: toStr(b.o_msg),
    raw: body,
  };
}

/* ── 4) SSQM2932 잔고현황(결제기준) ────────────────────────────────── */

/**
 * 잔고현황 조회(결제기준).
 * INPUT: inq_clsf(1:계좌별, 2:상품유형별), excg_mktpr_ccd(A:통합, K:KRX, N:NXT)
 */
async function getBalanceSettled(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const { body } = await callTr(TR.BALANCE_SETTLED.code, TR.BALANCE_SETTLED.path, {
    inq_clsf: toStr(src.inq_clsf) || "1",
    excg_mktpr_ccd: toStr(src.excg_mktpr_ccd) || "A",
  });
  const b = body || {};
  const positions = toRecords(b).map((r) => ({
    productType: toStr(r.gds_typ),
    classification: toStr(r.clsf),
    currency: toStr(r.crncy_cd),
    name: toStr(r.is_nm),
    symbol: toStr(r.is_cd),
    quantity: toInt(r.blnc_q),
    orderableQuantity: toInt(r.ordr_psbl_q),
    price: toInt(r.now_prc),
    avgPrice: toInt(r.byng_avr_prc),
    plAmount: toInt(r.pl_amt),
    evalAmount: toInt(r.val_amt),
    loanAmount: toInt(r.fncng_amt),
    yield: toNum(r.yld),
    weight: toNum(r.val_sgrvt_p2),
  }));

  return {
    deposit: toInt(b.tfnd),
    withdrawable: toInt(b.o_amt_psbl_amt),
    orderableCash: toInt(b.ordr_psbl_csh),
    buyAmountSum: toInt(b.byng_amt_sum),
    plAmountSum: toInt(b.pl_amt_sum),
    evalAmountSum: toInt(b.val_amt_sum),
    loanAmountSum: toInt(b.fncng_amt_sum),
    yieldSum: toNum(b.yld_sum),
    totalCount: toInt(b.tl_data_cnt),
    message: toStr(b.o_msg),
    positions,
    raw: body,
  };
}

/* ── 5) SSQM2952 잔고현황(체결기준) ────────────────────────────────── */

/** 체결기준 요약만 뽑아내는 내부 헬퍼 */
function mapExecutedSummary(b) {
  return {
    depositToday: toInt(b.dy_tfnd),
    depositNextDay: toInt(b.ndy_tfnd),
    depositNext2Day: toInt(b.nxt2_dy_tfnd),
    netAssetValue: toInt(b.nt_asts_val_amt),
    securitiesNetValue: toInt(b.scrts_nt_val_amt),
    netBuyAmount: toInt(b.nt_byng_amt),
    evalPl: toInt(b.val_pl),
    evalYield: toNum(b.val_yld),
    evalAmountSum: toInt(b.val_amt_sum),
    evalPlSum: toInt(b.val_pl_sum),
    buyAmountSum: toInt(b.byng_amt_sum),
    loanAmountSum: toInt(b.fncng_amt_sum),
    evalYieldSum: toNum(b.val_yld_sum),
    withdrawableNextDay: toInt(b.ndy_o_amt_psbl_amt),
    totalCount: toInt(b.tl_data_cnt),
    message: toStr(b.o_msg),
  };
}

/**
 * 잔고현황 조회(체결기준). INPUT: excg_mktpr_ccd(A:통합, K:KRX, N:NXT)
 */
async function getBalanceExecuted(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const { body } = await callTr(TR.BALANCE_EXECUTED.code, TR.BALANCE_EXECUTED.path, {
    excg_mktpr_ccd: toStr(src.excg_mktpr_ccd) || "A",
  });
  const b = body || {};
  const positions = toRecords(b).map((r) => ({
    classification: toStr(r.clsf),
    currency: toStr(r.crncy_cd),
    symbol: toStr(r.is_cd),
    name: toStr(r.is_nm),
    quantity: toInt(r.hld_q),
    orderableQuantity: toInt(r.ordr_psbl_q),
    unsettledSellQty: toInt(r.nstmt_s_q),
    unsettledBuyQty: toInt(r.nstmt_b_q),
    settledQty: toInt(r.ec_q),
    buyAmount: toInt(r.byng_amt),
    price: toInt(r.now_prc),
    avgPrice: toInt(r.byng_avr_prc),
    evalAmount: toInt(r.val_amt),
    loanAmount: toInt(r.fncng_amt),
    evalPl: toInt(r.val_pl),
    evalYield: toNum(r.val_yld),
  }));

  return { ...mapExecutedSummary(b), positions, raw: body };
}

/* ── 6) 표준 잔고 진입점 ───────────────────────────────────────────── */

/** 체결기준 잔고 요약(포지션 제외). */
async function getBalance(input = {}) {
  const res = await getBalanceExecuted(input);
  const { positions, raw, ...summary } = res; // eslint-disable-line no-unused-vars
  return summary;
}

/** 체결기준 보유종목 배열. */
async function getPositions(input = {}) {
  const res = await getBalanceExecuted(input);
  return res.positions;
}

/* ── 7) SSQM2341 체결/미체결 조회 (nxt_key 연속조회) ───────────────── */

/**
 * 주문 행에서 상태 파생 — **명세에 실제 존재하는 필드만** 사용한다.
 * (취소/정정 완료를 단정할 수 있는 상태 필드가 명세에 없어 CANCELED 는 파생하지 않는다.)
 */
function deriveStatus(row) {
  if (firstNonEmpty(row.rejectReason)) return ORDER_STATUS.REJECTED;
  const filled = row.filledQty;
  const unfilled = row.unfilledQty;
  if (filled !== null && filled > 0 && unfilled === 0) return ORDER_STATUS.FILLED;
  if (filled !== null && filled > 0 && unfilled !== null && unfilled > 0) {
    return ORDER_STATUS.PARTIALLY_FILLED;
  }
  if ((filled === 0 || filled === null) && unfilled !== null && unfilled > 0) {
    return ORDER_STATUS.ACCEPTED;
  }
  return ORDER_STATUS.UNKNOWN;
}

function mapExecutionRow(r) {
  const row = {
    orderNo: toStr(r.ordr_no),
    originalOrderNo: toStr(r.orgn_ordr_no),
    symbol: toStr(r.stnd_is_no),
    name: toStr(r.hngl_shrt_nm),
    orderQty: toInt(r.ordr_q),
    filledQty: toInt(r.tl_ccls_q),
    unfilledQty: toInt(r.nccls_q),
    orderPrice: toInt(r.ordr_uprc),
    fillPrice: toInt(r.ccls_uprc),
    tradeType: toStr(r.trd_dl_ccd_nm),
    orderType: toStr(r.ordr_typ_cd),
    orderTime: toStr(r.ordr_tm),
    orderCode: toStr(r.ordr_ccd),
    amendCancelCode: toStr(r.crct_cncl_ccd),
    rejectReason: toStr(r.rfsl_rsn_nm),
  };
  row.status = deriveStatus(row);
  return row;
}

/**
 * 체결/미체결 조회 (nxt_key 기반 연속조회).
 * @param {{ cclsClsf?: string, ordrDt?: string, maxPages?: number }} [query]
 *   cclsClsf 0:전체 1:체결 2:미체결 (기본 "0")
 *   ordrDt   YYYYMMDD (기본 KST 오늘)
 *   maxPages 최대 페이지 수 (기본 20)
 * TODO(FIELD_SPEC): cn_clsf(연속구분) 코드값 의미 미확보 → 판정은 nxt_key 존재 여부로만 한다.
 */
async function getExecutions(query = {}) {
  const q = query && typeof query === "object" ? query : {};
  const cclsClsf = toStr(q.cclsClsf) || "0";
  const ordrDt = toStr(q.ordrDt) || kstToday();
  const rawMax = Number(q.maxPages);
  const maxPages = Number.isFinite(rawMax) && rawMax >= 1 ? Math.trunc(rawMax) : 20;

  const rows = [];
  const seenKeys = new Set();
  let nextKey = "";
  let pages = 0;
  let truncated = false;
  let lastBody = null;

  while (pages < maxPages) {
    const { body } = await callTr(TR.EXECUTIONS.code, TR.EXECUTIONS.path, {
      ccls_clsf: cclsClsf,
      ordr_dt: ordrDt,
      nxt_key: nextKey,
    });
    pages += 1;
    lastBody = body;

    for (const r of toRecords(body)) rows.push(mapExecutionRow(r));

    const b = body || {};
    const key = firstNonEmpty(b.nxt_key);
    if (!key) break; // 연속조회 종료
    if (seenKeys.has(key)) {
      // 동일 키 반복 → 무한루프 방지
      truncated = true;
      break;
    }
    seenKeys.add(key);
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    nextKey = key;
  }

  return { rows, pages, truncated, orderDate: ordrDt, raw: lastBody };
}

/* ── 주문(쓰기) — 전면 비활성 ──────────────────────────────────────── */

const TRADING_DISABLED_MSG = "주문 기능 비활성 (KBSEC_TRADING_ENABLED=false)";

/* eslint-disable no-unused-vars */
async function placeOrder(order = {}) {
  throw new Error(TRADING_DISABLED_MSG);
}
async function amendOrder(order = {}) {
  throw new Error(TRADING_DISABLED_MSG);
}
async function cancelOrder(order = {}) {
  throw new Error(TRADING_DISABLED_MSG);
}
/* eslint-enable no-unused-vars */

/* ── 테스트 훅 ─────────────────────────────────────────────────────── */

function __setHttpForTest(fn) {
  _httpImpl = typeof fn === "function" ? fn : null;
}
function __resetForTest() {
  _httpImpl = null;
  // 토큰 캐시까지 초기화해야 테스트가 서로 간섭하지 않는다.
  try {
    require("./token.js").__resetForTest();
  } catch (_) {
    /* noop */
  }
}

module.exports = {
  TR,
  ORDER_STATUS,
  KbApiError,
  ConfigError,
  HTTP_TIMEOUT_MS,
  TRADING_DISABLED_MSG,
  toNum,
  toRecords,
  kstToday,
  deriveStatus,
  callTr,
  getMarketStatus,
  getQuote,
  getOrderableAmount,
  getBalanceSettled,
  getBalanceExecuted,
  getBalance,
  getPositions,
  getExecutions,
  placeOrder,
  amendOrder,
  cancelOrder,
  __setHttpForTest,
  __resetForTest,
};
