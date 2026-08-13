/**
 * KB증권 연동 모듈 테스트 — node:test 내장만 사용, 네트워크 호출 0회.
 *   실행: node --test test/
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../kb/config.js");
const envelope = require("../kb/envelope.js");
const token = require("../kb/token.js");
const broker = require("../kb/broker.js");
const diagnostic = require("../kb/diagnostic.js");

const APP_KEY = "AK-live-0123456789abcdef";
const APP_SECRET = "SEC-live-zzzz-9876543210-qwerty";

/** 테스트마다 env 를 저장/복원하기 위한 헬퍼 */
const ENV_KEYS = [
  "KBSEC_APP_KEY",
  "KBSEC_APP_SECRET",
  "KBSEC_BASE_URL",
  "KBSEC_IP_ADDR",
  "KBSEC_MAC_ADDR",
  "KBSEC_TRADING_ENABLED",
  "KBSEC_AUTO_TRADING_ENABLED",
];

function snapshotEnv() {
  const snap = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function setConfigured() {
  process.env.KBSEC_APP_KEY = APP_KEY;
  process.env.KBSEC_APP_SECRET = APP_SECRET;
  process.env.KBSEC_BASE_URL = "https://kb.example.test:32484";
  process.env.KBSEC_IP_ADDR = "10.0.0.9";
  process.env.KBSEC_MAC_ADDR = "AA-BB-CC-DD-EE-FF";
}

function clearConfigured() {
  delete process.env.KBSEC_APP_KEY;
  delete process.env.KBSEC_APP_SECRET;
}

/** 토큰 발급용 가짜 HTTP — 호출 횟수를 세어 반환 */
function installFakeToken() {
  const calls = { count: 0 };
  token.__setHttpForTest(async () => {
    calls.count += 1;
    return { access_token: "fake-access-token-value", token_type: "Bearer", expires_in: 86400 };
  });
  return calls;
}

/** 성공 응답 래퍼 */
function okEnvelope(dataBody) {
  return {
    dataHeader: {
      resultCode: "200",
      processCode: "0000",
      resultMessage: "정상",
      processMessage: "정상처리",
    },
    dataBody,
  };
}

function resetAll() {
  broker.__resetForTest(); // 토큰 캐시까지 초기화
  token.__setHttpForTest(null);
}

function axiosLike({ status, code, data, config } = {}) {
  const err = new Error(code || "axios error");
  if (code) err.code = code;
  if (status !== undefined) err.response = { status, data: data !== undefined ? data : {} };
  if (config) err.config = config;
  return err;
}

function stringifyLogArgs(args) {
  return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
}

function enumerableErrorJson(err) {
  return JSON.stringify({ ...err, message: err.message, stack: err.stack });
}

function assertNoSecrets(serialized) {
  assert.ok(!serialized.includes(APP_SECRET), "에러 직렬화에 appSecret 원문 금지");
  assert.ok(!serialized.includes(APP_KEY), "에러 직렬화에 appKey 원문 금지");
  assert.ok(!serialized.includes("fake-access-token-value"), "에러에 토큰 원문 금지");
}

/* ────────────────────────────────────────────────────────────────────
 * 1. 마스킹 / 비밀정보 비노출
 * ──────────────────────────────────────────────────────────────────── */
test("1. 마스킹: maskSecret/maskAccount 결과에 원문이 없다", () => {
  const masked = config.maskSecret(APP_SECRET);
  assert.notEqual(masked, APP_SECRET);
  assert.ok(!masked.includes(APP_SECRET));
  assert.ok(masked.startsWith("SE"));
  assert.ok(masked.endsWith("ty"));
  assert.equal(masked.length, APP_SECRET.length);

  const acct = "12345678901";
  const maskedAcct = config.maskAccount(acct);
  assert.equal(maskedAcct, "*******8901");
  assert.ok(!maskedAcct.includes(acct));

  // 짧은 값은 전부 마스킹
  assert.equal(config.maskSecret("abcd"), "****");
  assert.equal(config.maskAccount("12"), "**");
  assert.equal(config.maskSecret(""), "");
  assert.equal(config.maskSecret(null), "");
});

test("1b. describeConfig 직렬화에 appSecret/appKey 원문이 없다", () => {
  const snap = snapshotEnv();
  try {
    setConfigured();
    const cfg = config.getKbConfig();
    assert.equal(cfg.configured, true);
    const json = JSON.stringify(config.describeConfig(cfg));
    assert.ok(!json.includes(APP_SECRET), "appSecret 원문이 직렬화에 포함되면 안 됨");
    assert.ok(!json.includes(APP_KEY), "appKey 원문이 직렬화에 포함되면 안 됨");
    assert.ok(json.includes(config.maskSecret(APP_SECRET)));
  } finally {
    restoreEnv(snap);
  }
});

test("1c. sanitize 가 중첩 객체의 secret/token/account 키를 마스킹한다", () => {
  const input = {
    level1: {
      appSecret: APP_SECRET,
      accessToken: "tok-abcdefghijklmnop",
      acntNo: "12345678901",
      level2: { authorization: "Bearer xyz-1234567890", plain: "안전한값" },
    },
  };
  const out = envelope.sanitize(input);
  const json = JSON.stringify(out);
  assert.ok(!json.includes(APP_SECRET));
  assert.ok(!json.includes("tok-abcdefghijklmnop"));
  assert.ok(!json.includes("12345678901"));
  assert.ok(!json.includes("Bearer xyz-1234567890"));
  assert.equal(out.level1.level2.plain, "안전한값");
  assert.equal(out.level1.acntNo, "*******8901");
});

/* ────────────────────────────────────────────────────────────────────
 * 2. 요청/응답 래퍼 구조
 * ──────────────────────────────────────────────────────────────────── */
test("2. buildRequest / unwrap 래퍼 구조", () => {
  const cfg = { ipAddr: "10.0.0.9", macAddr: "AA-BB", appKey: "x" };
  const req = envelope.buildRequest(cfg, { shrt_cd: "005930", excg_clsf: "0" });

  assert.deepEqual(Object.keys(req).sort(), ["dataBody", "dataHeader"]);
  assert.deepEqual(req.dataHeader, { ipAddr: "10.0.0.9", macAddr: "AA-BB" });
  assert.deepEqual(req.dataBody, { shrt_cd: "005930", excg_clsf: "0" });

  // 미설정 항목은 빈 문자열
  assert.deepEqual(envelope.buildRequest({}, {}).dataHeader, { ipAddr: "", macAddr: "" });

  const { header, body } = envelope.unwrap(okEnvelope({ now_prc: "75,300" }));
  assert.equal(header.resultCode, "200");
  assert.equal(header.processCode, "0000");
  assert.deepEqual(body, { now_prc: "75,300" });

  const empty = envelope.unwrap(undefined);
  assert.equal(empty.header, null);
  assert.equal(empty.body, null);
});

/* ────────────────────────────────────────────────────────────────────
 * 3. 숫자 변환
 * ──────────────────────────────────────────────────────────────────── */
test("3. toInt / toNum 변환 규칙", () => {
  assert.equal(envelope.toInt("1,234,500"), 1234500);
  assert.equal(envelope.toInt(""), null);
  assert.equal(envelope.toInt(null), null);
  assert.equal(envelope.toInt(undefined), null);
  assert.equal(envelope.toInt("abc"), null);
  assert.equal(envelope.toInt("-1,200"), -1200);
  assert.equal(envelope.toInt("0"), 0);
  assert.equal(envelope.toInt("  7 "), 7);

  // 0 이 아니라 null 이어야 한다
  assert.notEqual(envelope.toInt(""), 0);

  assert.equal(broker.toNum("-1.57"), -1.57);
  assert.equal(broker.toNum("1,234.5"), 1234.5);
  assert.equal(broker.toNum(""), null);
  assert.equal(broker.toNum(null), null);
  assert.equal(broker.toNum("abc"), null);
});

/* ────────────────────────────────────────────────────────────────────
 * 4. 토큰: 선제 갱신 판정 + 동시 호출 1회 발급
 * ──────────────────────────────────────────────────────────────────── */
test("4a. isExpiring — 만료 5분 전부터 갱신 대상", () => {
  const now = Date.now();
  assert.equal(token.isExpiring(now + 4 * 60 * 1000, now), true, "만료 4분 후 → 갱신 필요");
  assert.equal(token.isExpiring(now + 10 * 60 * 1000, now), false, "만료 10분 후 → 유효");
  assert.equal(token.isExpiring(null, now), true);
  assert.equal(token.isExpiring(undefined, now), true);
  assert.equal(token.isExpiring(now - 1000, now), true);
});

test("4b. getAccessToken 동시 5회 호출 → HTTP 발급은 정확히 1회", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    const calls = installFakeToken();

    const results = await Promise.all([
      token.getAccessToken(),
      token.getAccessToken(),
      token.getAccessToken(),
      token.getAccessToken(),
      token.getAccessToken(),
    ]);

    assert.equal(calls.count, 1, "동시 호출 시 발급 HTTP 는 1회여야 한다");
    assert.equal(results.length, 5);
    for (const t of results) assert.equal(t, "fake-access-token-value");

    // 캐시 정보에도 원문 토큰이 노출되면 안 된다
    const info = token.getTokenCacheInfo();
    assert.equal(info.cached, true);
    assert.ok(!String(info.token).includes("fake-access-token-value"));
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

/* ────────────────────────────────────────────────────────────────────
 * 5. 미설정 시 네트워크 호출 없이 ConfigError
 * ──────────────────────────────────────────────────────────────────── */
test("5. 미설정: getAccessToken / broker.getQuote 모두 네트워크 없이 ConfigError", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    clearConfigured();

    let tokenHttpCalls = 0;
    let brokerHttpCalls = 0;
    token.__setHttpForTest(async () => {
      tokenHttpCalls += 1;
      return {};
    });
    broker.__setHttpForTest(async () => {
      brokerHttpCalls += 1;
      return okEnvelope({});
    });

    await assert.rejects(
      () => token.getAccessToken(),
      (err) => {
        assert.ok(err instanceof config.ConfigError);
        assert.equal(err.name, "ConfigError");
        assert.equal(err.code, "KB_NOT_CONFIGURED");
        assert.deepEqual(err.missing, ["KBSEC_APP_KEY", "KBSEC_APP_SECRET"]);
        return true;
      },
    );

    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.equal(err.name, "ConfigError");
        assert.equal(err.code, "KB_NOT_CONFIGURED");
        return true;
      },
    );

    assert.equal(tokenHttpCalls, 0, "미설정이면 토큰 HTTP 호출 0회");
    assert.equal(brokerHttpCalls, 0, "미설정이면 TR HTTP 호출 0회");
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

/* ────────────────────────────────────────────────────────────────────
 * 6. SSQM2341 nxt_key 연속조회 + maxPages 절단
 * ──────────────────────────────────────────────────────────────────── */
test("6. getExecutions — nxt_key 연속조회가 maxPages 에서 truncated 로 중단", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    let page = 0;
    const seenKeys = [];
    broker.__setHttpForTest(async (url, body, headers) => {
      page += 1;
      seenKeys.push(body.dataBody.nxt_key);
      assert.ok(url.endsWith("/api/v1/ssqm2341"));
      assert.equal(body.dataBody.ordr_dt, "20260813");
      assert.equal(body.dataBody.ccls_clsf, "0");
      assert.equal(headers.Authorization, "Bearer fake-access-token-value");
      return okEnvelope({
        nxt_key: `KEY-${page}`, // 항상 새로운 다음키 → 절대 끝나지 않음
        cn_clsf: "1",
        Record1: [
          {
            ordr_no: `100${page}`,
            stnd_is_no: "005930",
            hngl_shrt_nm: "삼성전자",
            ordr_q: "10",
            tl_ccls_q: "10",
            nccls_q: "0",
            ordr_uprc: "75,300",
            ccls_uprc: "75,300",
          },
        ],
      });
    });

    const res = await broker.getExecutions({ ordrDt: "20260813", maxPages: 3 });

    assert.equal(page, 3, "HTTP 호출은 maxPages(3)회");
    assert.equal(res.pages, 3);
    assert.equal(res.truncated, true);
    assert.equal(res.rows.length, 3, "페이지별 행이 누적되어야 한다");
    assert.equal(res.orderDate, "20260813");
    assert.deepEqual(seenKeys, ["", "KEY-1", "KEY-2"], "직전 응답의 nxt_key 를 다음 요청에 전달");
    assert.deepEqual(
      res.rows.map((r) => r.orderNo),
      ["1001", "1002", "1003"],
    );
    assert.equal(res.rows[0].status, broker.ORDER_STATUS.FILLED);
    assert.equal(res.rows[0].orderPrice, 75300);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("6b. getExecutions — nxt_key 가 비면 즉시 종료(truncated=false)", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    let calls = 0;
    broker.__setHttpForTest(async () => {
      calls += 1;
      return okEnvelope({
        nxt_key: "",
        Record1: {
          ordr_no: "2001",
          stnd_is_no: "000660",
          ordr_q: "5",
          tl_ccls_q: "2",
          nccls_q: "3",
        },
      });
    });

    const res = await broker.getExecutions({ ordrDt: "20260813" });
    assert.equal(calls, 1);
    assert.equal(res.truncated, false);
    assert.equal(res.pages, 1);
    assert.equal(res.rows.length, 1, "Record1 이 단일 객체여도 배열로 정규화");
    assert.equal(res.rows[0].status, broker.ORDER_STATUS.PARTIALLY_FILLED);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("6c. deriveStatus 파생 규칙", () => {
  const S = broker.ORDER_STATUS;
  assert.equal(broker.deriveStatus({ rejectReason: "잔고부족", filledQty: 0, unfilledQty: 0 }), S.REJECTED);
  assert.equal(broker.deriveStatus({ rejectReason: null, filledQty: 10, unfilledQty: 0 }), S.FILLED);
  assert.equal(broker.deriveStatus({ rejectReason: null, filledQty: 4, unfilledQty: 6 }), S.PARTIALLY_FILLED);
  assert.equal(broker.deriveStatus({ rejectReason: null, filledQty: 0, unfilledQty: 10 }), S.ACCEPTED);
  assert.equal(broker.deriveStatus({ rejectReason: null, filledQty: null, unfilledQty: 10 }), S.ACCEPTED);
  assert.equal(broker.deriveStatus({ rejectReason: null, filledQty: null, unfilledQty: null }), S.UNKNOWN);
});

/* ────────────────────────────────────────────────────────────────────
 * 7. IVU10140 매핑
 * ──────────────────────────────────────────────────────────────────── */
test("7. getQuote — IVU10140 spec 필드 → 내부표준 매핑", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    let seen = null;
    broker.__setHttpForTest(async (url, body, headers) => {
      seen = { url, body, headers };
      return okEnvelope({
        is_nm: "삼성전자",
        now_prc: "75,300",
        bdy_cmpr: "-1,200",
        up_dwn_r_p2: "-1.57",
        acml_vlm: "12,345,678",
        opn_prc: "76,000",
        hgh_prc: "76,500",
        lw_prc: "75,100",
        bdy_cls_prc: "76,500",
        ulmt_prc: "99,400",
        llmt_prc: "53,600",
        s_sq1_askprc: "75,400",
        b_sq1_askprc: "75,300",
        mkt_clsf_nm: "KOSPI",
      });
    });

    const q = await broker.getQuote("005930", "1");

    assert.equal(seen.url, "https://kb.example.test:32484/api/v1/ivu10140");
    assert.deepEqual(seen.body.dataBody, { excg_clsf: "1", shrt_cd: "005930" });
    assert.deepEqual(seen.body.dataHeader, { ipAddr: "10.0.0.9", macAddr: "AA-BB-CC-DD-EE-FF" });
    assert.equal(seen.headers.Authorization, "Bearer fake-access-token-value");

    assert.equal(q.symbol, "005930");
    assert.equal(q.name, "삼성전자");
    assert.equal(q.price, 75300);
    assert.equal(q.change, -1200);
    assert.equal(q.changeRate, -1.57);
    assert.equal(q.volume, 12345678);
    assert.equal(q.open, 76000);
    assert.equal(q.high, 76500);
    assert.equal(q.low, 75100);
    assert.equal(q.prevClose, 76500);
    assert.equal(q.upperLimit, 99400);
    assert.equal(q.lowerLimit, 53600);
    assert.equal(q.askPrice, 75400);
    assert.equal(q.bidPrice, 75300);
    assert.equal(q.marketName, "KOSPI");
    assert.equal(q.raw.now_prc, "75,300");

    // 스펙에 없는 필드를 만들어내지 않았는지
    assert.equal(q.isOpen, undefined);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("7b. getQuote — symbol 누락 시 네트워크 없이 인자 검증 에러", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();
    let calls = 0;
    broker.__setHttpForTest(async () => {
      calls += 1;
      return okEnvelope({});
    });

    await assert.rejects(
      () => broker.getQuote(""),
      (err) => err.code === "KB_INVALID_ARGUMENT",
    );
    assert.equal(calls, 0);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("7c. 주문(쓰기) 메서드는 항상 차단된다", async () => {
  for (const fn of [broker.placeOrder, broker.amendOrder, broker.cancelOrder]) {
    await assert.rejects(
      () => fn({ symbol: "005930", qty: 1 }),
      (err) => err.message === broker.TRADING_DISABLED_MSG,
    );
  }
});

/* ────────────────────────────────────────────────────────────────────
 * 8. 실패 응답 → KbDiagnosticError (비밀정보 미포함)
 * ──────────────────────────────────────────────────────────────────── */
test("8. 실패 응답(resultCode 500 / processCode 9999) → KbDiagnosticError", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    broker.__setHttpForTest(async () => ({
      dataHeader: {
        resultCode: "500",
        processCode: "9999",
        resultMessage: "서버오류",
        processMessage: "일시적인 오류가 발생했습니다",
      },
      dataBody: {},
    }));

    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.ok(err instanceof diagnostic.KbDiagnosticError);
        assert.equal(err.name, "KbDiagnosticError");
        assert.equal(err.message, "KB upstream request failed");
        assert.equal(err.stage, "quote");
        assert.equal(err.errorType, "kb-business");
        assert.equal(err.kbResultCode, "500");
        assertNoSecrets(enumerableErrorJson(err));
        return true;
      },
    );
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("8b. getMarketStatus resultCode 500 → market-status/kb-business", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();
    broker.__setHttpForTest(async () => ({
      dataHeader: { resultCode: "500", processCode: "9999", resultMessage: "서버오류" },
      dataBody: {},
    }));
    await assert.rejects(
      () => broker.getMarketStatus(),
      (err) => {
        assert.ok(err instanceof diagnostic.KbDiagnosticError);
        assert.equal(err.stage, "market-status");
        assert.equal(err.errorType, "kb-business");
        assert.equal(err.kbResultCode, "500");
        return true;
      },
    );
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

/* ────────────────────────────────────────────────────────────────────
 * 보강: 잔고/장운영상태 매핑 (스펙 필드만 사용)
 * ──────────────────────────────────────────────────────────────────── */
test("9. getBalanceExecuted / getPositions — SSQM2952 매핑", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    let seenBody = null;
    broker.__setHttpForTest(async (url, body) => {
      seenBody = body.dataBody;
      return okEnvelope({
        dy_tfnd: "1,000,000",
        ndy_tfnd: "1,000,000",
        nxt2_dy_tfnd: "1,000,000",
        nt_asts_val_amt: "5,300,000",
        scrts_nt_val_amt: "4,300,000",
        nt_byng_amt: "4,000,000",
        val_pl: "300,000",
        val_yld: "7.5",
        val_amt_sum: "4,300,000",
        val_pl_sum: "300,000",
        byng_amt_sum: "4,000,000",
        fncng_amt_sum: "",
        val_yld_sum: "7.5",
        ndy_o_amt_psbl_amt: "900,000",
        tl_data_cnt: "1",
        o_msg: "정상조회",
        Record1: [
          {
            clsf: "현금",
            crncy_cd: "KRW",
            is_cd: "005930",
            is_nm: "삼성전자",
            hld_q: "50",
            ordr_psbl_q: "50",
            nstmt_s_q: "0",
            nstmt_b_q: "0",
            ec_q: "50",
            byng_amt: "4,000,000",
            now_prc: "75,300",
            byng_avr_prc: "80,000",
            val_amt: "4,300,000",
            fncng_amt: "0",
            val_pl: "300,000",
            val_yld: "7.5",
          },
        ],
      });
    });

    const bal = await broker.getBalanceExecuted();
    assert.deepEqual(seenBody, { excg_mktpr_ccd: "A" });
    assert.equal(bal.depositToday, 1000000);
    assert.equal(bal.netAssetValue, 5300000);
    assert.equal(bal.evalYield, 7.5);
    assert.equal(bal.loanAmountSum, null, "빈 문자열은 0 이 아니라 null");
    assert.equal(bal.message, "정상조회");
    assert.equal(bal.positions.length, 1);
    assert.equal(bal.positions[0].symbol, "005930");
    assert.equal(bal.positions[0].quantity, 50);
    assert.equal(bal.positions[0].avgPrice, 80000);
    assert.equal(bal.positions[0].evalYield, 7.5);

    const summary = await broker.getBalance();
    assert.equal(summary.positions, undefined);
    assert.equal(summary.raw, undefined);
    assert.equal(summary.netAssetValue, 5300000);

    const positions = await broker.getPositions();
    assert.equal(positions.length, 1);
    assert.equal(positions[0].name, "삼성전자");
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("10. getBalanceSettled — SSQM2932 기본 INPUT 과 매핑", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    let seenBody = null;
    broker.__setHttpForTest(async (url, body) => {
      seenBody = body.dataBody;
      return okEnvelope({
        tfnd: "1,000,000",
        o_amt_psbl_amt: "900,000",
        ordr_psbl_csh: "950,000",
        byng_amt_sum: "4,000,000",
        pl_amt_sum: "300,000",
        val_amt_sum: "4,300,000",
        fncng_amt_sum: "0",
        yld_sum: "7.5",
        tl_data_cnt: "1",
        o_msg: "정상",
        Record1: {
          gds_typ: "주식",
          clsf: "현금",
          crncy_cd: "KRW",
          is_nm: "삼성전자",
          is_cd: "005930",
          blnc_q: "50",
          ordr_psbl_q: "50",
          now_prc: "75,300",
          byng_avr_prc: "80,000",
          pl_amt: "300,000",
          val_amt: "4,300,000",
          fncng_amt: "0",
          yld: "7.5",
          val_sgrvt_p2: "81.13",
        },
      });
    });

    const bal = await broker.getBalanceSettled();
    assert.deepEqual(seenBody, { inq_clsf: "1", excg_mktpr_ccd: "A" });
    assert.equal(bal.deposit, 1000000);
    assert.equal(bal.withdrawable, 900000);
    assert.equal(bal.yieldSum, 7.5);
    assert.equal(bal.positions.length, 1);
    assert.equal(bal.positions[0].productType, "주식");
    assert.equal(bal.positions[0].weight, 81.13);

    // input 으로 덮어쓰기 가능
    await broker.getBalanceSettled({ inq_clsf: "2", excg_mktpr_ccd: "K" });
    assert.deepEqual(seenBody, { inq_clsf: "2", excg_mktpr_ccd: "K" });
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("11. getMarketStatus / getOrderableAmount — INPUT 규약", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    let seenBody = null;
    broker.__setHttpForTest(async (url, body) => {
      seenBody = body.dataBody;
      if (url.endsWith("/api/v1/szqm0771")) {
        return okEnvelope({
          now_dt: "20260813",
          now_tm: "093000",
          std_bsnss_dt: "20260813",
          bfr_bsns_dt: "20260812",
          next_biz_dt: "20260814",
          ordr_std_dt: "20260813",
          wd: "목",
          wd_ccd: "5",
          on_clsng_f: "N",
          jb_clsng_f: "N",
          stk_mkoprt_ccd: "021",
          ksdq_mkoprt_ccd: "021",
          bnd_mkoprt_ccd: "21",
          fts_mkoprt_ccd: "021",
          opt_mkoprt_ccd: "021",
          o_msg: "정상",
        });
      }
      return okEnvelope({
        tfnd: "1,000,000",
        ordr_psbl_csh: "950,000",
        ordr_psbl_sbt: "0",
        ordr_psbl_tl_amt: "950,000",
        pcnt100_ordr_psbl_amt: "950,000",
        mx_ordr_psbl_amt: "2,850,000",
        do_psbl_csh: "900,000",
        sbt_tl_amt: "0",
        mx_ordr_psbl_amt_a_grp: "2,850,000",
        mx_ordr_psbl_amt_b_grp: "1,900,000",
        mx_ordr_psbl_amt_c_grp: "",
        o_msg: "정상",
      });
    });

    const ms = await broker.getMarketStatus();
    assert.deepEqual(seenBody, {}, "SZQM0771 은 INPUT 필드가 없다");
    assert.equal(ms.date, "20260813");
    assert.equal(ms.businessDate, "20260813");
    assert.equal(ms.stockMarketCode, "021");
    assert.equal(ms.isOpen, undefined, "코드 의미 미확보 → boolean 추측 금지");

    const oa = await broker.getOrderableAmount({ symbol: "005930" });
    assert.deepEqual(seenBody, { is_no: "005930" });
    assert.equal(oa.deposit, 1000000);
    assert.equal(oa.maxOrderableAmount, 2850000);
    assert.equal(oa.maxOrderableAmountC, null);
    assert.equal(oa.orderableQuantity, undefined, "명세에 없는 수량 필드는 만들지 않는다");

    await broker.getOrderableAmount();
    assert.deepEqual(seenBody, { is_no: "" }, "is_no 는 선택 항목");
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("12. toRecords / kstToday 헬퍼", () => {
  assert.deepEqual(broker.toRecords(null), []);
  assert.deepEqual(broker.toRecords({}), []);
  assert.deepEqual(broker.toRecords({ Record1: null }), []);
  assert.deepEqual(broker.toRecords({ Record1: { a: 1 } }), [{ a: 1 }]);
  assert.deepEqual(broker.toRecords({ record1: [{ a: 1 }, { b: 2 }] }), [{ a: 1 }, { b: 2 }]);

  // 2026-08-13 00:30 KST == 2026-08-12 15:30 UTC
  assert.equal(broker.kstToday(Date.UTC(2026, 7, 12, 15, 30, 0)), "20260813");
  assert.equal(broker.kstToday(Date.UTC(2026, 7, 12, 14, 30, 0)), "20260812");
});

test("13. axios 예외는 비밀정보 없는 KB_REQUEST_FAILED 로 감싼다", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    broker.__setHttpForTest(async () => {
      const err = axiosLike({
        status: 502,
        code: "ECONNREFUSED",
        data: { dataHeader: { appSecret: APP_SECRET }, dataBody: { token: "abc" } },
        config: { headers: { Authorization: "Bearer fake-access-token-value" } },
      });
      throw err;
    });

    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.ok(err instanceof diagnostic.KbDiagnosticError);
        assert.equal(err.stage, "quote");
        assert.equal(err.errorType, "http");
        assert.equal(err.code, "KB_REQUEST_FAILED");
        assert.equal(err.upstreamStatus, 502);
        assert.equal(err.config, undefined, "axios err.config 원문 전파 금지");
        const serialized = JSON.stringify({ ...err, message: err.message });
        assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(serialized), "cause"));
        assert.ok(!serialized.includes("cause"));
        assertNoSecrets(serialized);
        return true;
      },
    );
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

/* ────────────────────────────────────────────────────────────────────
 * 14+. 안전 진단 로그 (가짜 HTTP 만 사용)
 * ──────────────────────────────────────────────────────────────────── */

async function rejectOauth(httpImpl, check) {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    token.__setHttpForTest(httpImpl);
    await assert.rejects(() => token.getAccessToken(), check);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
}

test("14. OAuth HTTP 분류: 401/429/timeout/dns/tls/parsing", async () => {
  await rejectOauth(
    async () => {
      throw axiosLike({ status: 401 });
    },
    (err) => {
      assert.ok(err instanceof diagnostic.KbDiagnosticError);
      assert.equal(err.stage, "oauth");
      assert.equal(err.upstreamStatus, 401);
      assert.equal(err.errorType, "http");
      return true;
    },
  );

  await rejectOauth(
    async () => {
      throw axiosLike({ status: 429 });
    },
    (err) => {
      assert.equal(err.stage, "oauth");
      assert.equal(err.upstreamStatus, 429);
      assert.equal(err.errorType, "http");
      return true;
    },
  );

  await rejectOauth(
    async () => {
      throw axiosLike({ code: "ECONNABORTED" });
    },
    (err) => {
      assert.equal(err.stage, "oauth");
      assert.equal(err.errorType, "timeout");
      assert.equal(err.upstreamStatus, null);
      return true;
    },
  );

  await rejectOauth(
    async () => {
      throw axiosLike({ code: "ENOTFOUND" });
    },
    (err) => {
      assert.equal(err.stage, "oauth");
      assert.equal(err.errorType, "dns");
      return true;
    },
  );

  await rejectOauth(
    async () => {
      throw axiosLike({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    },
    (err) => {
      assert.equal(err.stage, "oauth");
      assert.equal(err.errorType, "tls");
      return true;
    },
  );

  await rejectOauth(
    async () => ({ token_type: "Bearer", expires_in: 86400 }),
    (err) => {
      assert.equal(err.stage, "oauth");
      assert.equal(err.errorType, "parsing");
      assert.equal(err.upstreamStatus, 200);
      return true;
    },
  );

  await rejectOauth(
    async () => ({ access_token: "fake-access-token-value", expires_in: "abc" }),
    (err) => {
      assert.equal(err.stage, "oauth");
      assert.equal(err.errorType, "parsing");
      assert.equal(err.upstreamStatus, 200);
      return true;
    },
  );
});

test("14b. access_token 만 있고 expires_in 없으면 ttl 600s 로 성공", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    const before = Date.now();
    token.__setHttpForTest(async () => ({
      access_token: "fake-access-token-value",
      token_type: "Bearer",
    }));
    const t = await token.getAccessToken();
    const after = Date.now();
    assert.equal(t, "fake-access-token-value");
    const info = token.getTokenCacheInfo();
    assert.equal(info.cached, true);
    assert.ok(info.expiresAt >= before + 600 * 1000 - 50);
    assert.ok(info.expiresAt <= after + 600 * 1000 + 50);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("15. getQuote 토큰 401 은 stage=oauth 유지, TR HTTP 미호출", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    token.__setHttpForTest(async () => {
      throw axiosLike({ status: 401 });
    });
    let brokerCalls = 0;
    broker.__setHttpForTest(async () => {
      brokerCalls += 1;
      return okEnvelope({});
    });
    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.ok(err instanceof diagnostic.KbDiagnosticError);
        assert.equal(err.stage, "oauth");
        assert.equal(err.errorType, "http");
        assert.equal(err.upstreamStatus, 401);
        return true;
      },
    );
    assert.equal(brokerCalls, 0);
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("16. IVU10140 HTTP 400 / header 누락 parsing, SZQM0771 HTTP 503", async () => {
  const snap = snapshotEnv();
  resetAll();
  try {
    setConfigured();
    installFakeToken();

    broker.__setHttpForTest(async () => {
      throw axiosLike({ status: 400 });
    });
    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.equal(err.stage, "quote");
        assert.equal(err.errorType, "http");
        assert.equal(err.upstreamStatus, 400);
        return true;
      },
    );

    resetAll();
    setConfigured();
    installFakeToken();
    broker.__setHttpForTest(async () => ({ dataBody: { now_prc: "1" } }));
    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.equal(err.stage, "quote");
        assert.equal(err.errorType, "parsing");
        assert.equal(err.kbResultCode, null);
        assert.equal(err.upstreamStatus, 200);
        return true;
      },
    );

    resetAll();
    setConfigured();
    installFakeToken();
    broker.__setHttpForTest(async () => ({
      dataHeader: { processCode: "0000" },
      dataBody: {},
    }));
    await assert.rejects(
      () => broker.getQuote("005930"),
      (err) => {
        assert.equal(err.stage, "quote");
        assert.equal(err.errorType, "parsing");
        assert.equal(err.kbResultCode, null);
        assert.equal(err.upstreamStatus, 200);
        return true;
      },
    );

    resetAll();
    setConfigured();
    installFakeToken();
    broker.__setHttpForTest(async () => {
      throw axiosLike({ status: 503 });
    });
    await assert.rejects(
      () => broker.getMarketStatus(),
      (err) => {
        assert.equal(err.stage, "market-status");
        assert.equal(err.errorType, "http");
        assert.equal(err.upstreamStatus, 503);
        return true;
      },
    );
  } finally {
    resetAll();
    restoreEnv(snap);
  }
});

test("17. sanitizeStage/sanitizeResultCode 와 클라이언트 JSON 안전성", () => {
  assert.equal(diagnostic.sanitizeStage("nope"), "unknown");
  assert.equal(diagnostic.sanitizeResultCode("일시적인 오류가 발생했습니다"), null);
  assert.equal(diagnostic.sanitizeResultCode("a".repeat(33)), null);
  assert.equal(diagnostic.KB_CLIENT_ERROR, "KB증권 조회에 실패했습니다.");

  const clientJson = { error: diagnostic.KB_CLIENT_ERROR };
  assert.deepEqual(Object.keys(clientJson), ["error"]);
  const s = JSON.stringify(clientJson);
  for (const key of ["stage", "upstreamStatus", "kbResultCode", "errorType", "durationMs", "retryCount"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(clientJson, key), false);
    assert.ok(!s.includes(`"${key}"`));
  }
});

test("18. toLogFields/logKbDiagnostic 은 허용 6필드만, 비밀값 미출력", () => {
  const orig = console.error;
  const logs = [];
  console.error = (...args) => {
    logs.push(args);
  };
  try {
    const err = new diagnostic.KbDiagnosticError({
      stage: "quote",
      errorType: "http",
      upstreamStatus: 400,
      kbResultCode: null,
      durationMs: 12,
      retryCount: 0,
    });
    err.appKey = APP_KEY;
    err.appSecret = APP_SECRET;
    err.access_token = "fake-access-token-value";
    err.Authorization = "Bearer fake-access-token-value";
    err.Cookie = "session=abc";
    err.requestBody = { appKey: APP_KEY, password: "x" };
    err.responseBody = { access_token: "fake-access-token-value" };
    err.config = { headers: { Authorization: "Bearer fake-access-token-value" } };

    const fields = diagnostic.toLogFields(err);
    assert.deepEqual(Object.keys(fields), [
      "stage",
      "upstreamStatus",
      "kbResultCode",
      "errorType",
      "durationMs",
      "retryCount",
    ]);
    const fieldJson = JSON.stringify(fields);
    assertNoSecrets(fieldJson);
    assert.ok(!fieldJson.includes("appKey"));
    assert.ok(!fieldJson.includes("appSecret"));
    assert.ok(!fieldJson.includes("access_token"));
    assert.ok(!fieldJson.includes("Authorization"));
    assert.ok(!fieldJson.includes("Cookie"));
    assert.ok(!fieldJson.includes("requestBody"));
    assert.ok(!fieldJson.includes("responseBody"));
    assert.ok(!fieldJson.includes("config"));

    diagnostic.logKbDiagnostic(err);
    assert.equal(logs.length, 1);
    const logged = stringifyLogArgs(logs[0]);
    assertNoSecrets(logged);
    assert.ok(!logged.includes("appKey"));
    assert.ok(!logged.includes("appSecret"));
    assert.ok(!logged.includes("access_token"));
    assert.ok(!logged.includes("Authorization"));
    assert.ok(!logged.includes("Cookie"));
    assert.ok(!logged.includes("requestBody"));
    assert.ok(!logged.includes("responseBody"));
    assert.ok(!logged.includes("request body"));
    assert.ok(!logged.includes("response body"));
    assert.ok(!logged.includes("axios config"));
    assert.ok(!logged.includes('"config"'));
  } finally {
    console.error = orig;
  }
});

test("19. getAccessToken/getQuote throw 는 console.error 하지 않고 log 는 1회만", async () => {
  const snap = snapshotEnv();
  resetAll();
  const orig = console.error;
  const logs = [];
  console.error = (...args) => {
    logs.push(args);
  };
  try {
    setConfigured();
    token.__setHttpForTest(async () => {
      throw axiosLike({ status: 401 });
    });
    let tokenErr = null;
    try {
      await token.getAccessToken();
    } catch (e) {
      tokenErr = e;
    }
    assert.ok(tokenErr instanceof diagnostic.KbDiagnosticError);
    assert.equal(logs.length, 0, "getAccessToken 은 진단 로그를 찍지 않는다");

    resetAll();
    setConfigured();
    installFakeToken();
    broker.__setHttpForTest(async () => ({
      dataHeader: { resultCode: "500", processCode: "9999" },
      dataBody: {},
    }));
    let quoteErr = null;
    try {
      await broker.getQuote("005930");
    } catch (e) {
      quoteErr = e;
    }
    assert.ok(quoteErr instanceof diagnostic.KbDiagnosticError);
    assert.equal(logs.length, 0, "getQuote 는 진단 로그를 찍지 않는다");

    diagnostic.logKbDiagnostic(quoteErr);
    assert.equal(logs.length, 1);
    diagnostic.logKbDiagnostic(quoteErr);
    assert.equal(logs.length, 1, "두 번째 logKbDiagnostic 은 추가 로그 없음");
    assert.equal(quoteErr.__kbDiagnosticLogged, true);
  } finally {
    console.error = orig;
    resetAll();
    restoreEnv(snap);
  }
});

test("20. tradingEnabled/autoTradingEnabled 는 env 가 정확히 true 가 아니면 false", () => {
  const snap = snapshotEnv();
  try {
    setConfigured();
    delete process.env.KBSEC_TRADING_ENABLED;
    delete process.env.KBSEC_AUTO_TRADING_ENABLED;
    let cfg = config.getKbConfig();
    assert.equal(cfg.tradingEnabled, false);
    assert.equal(cfg.autoTradingEnabled, false);

    process.env.KBSEC_TRADING_ENABLED = "TRUE";
    process.env.KBSEC_AUTO_TRADING_ENABLED = "1";
    cfg = config.getKbConfig();
    assert.equal(cfg.tradingEnabled, false);
    assert.equal(cfg.autoTradingEnabled, false);

    process.env.KBSEC_TRADING_ENABLED = "yes";
    process.env.KBSEC_AUTO_TRADING_ENABLED = "yes";
    cfg = config.getKbConfig();
    assert.equal(cfg.tradingEnabled, false);
    assert.equal(cfg.autoTradingEnabled, false);
  } finally {
    restoreEnv(snap);
  }
});
