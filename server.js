/**
 * ALPHA TRADING SYSTEM - 한국투자증권 시세 + 분석 프록시 서버
 * 
 * 변경점 (v2):
 *  - 경제명탐정 4·5주차 + 독개미 자동 분석 모듈 통합
 *  - /api/quote/:code: 별도 일봉 호출 후 analysis 필드 첨부
 *  - /api/chart/:code: 차트 데이터에 analysis 필드 첨부
 *  - /api/analyze/:code: 진단 결과만 빠르게 받는 신규 엔드포인트
 * 
 * 실행 방법:
 *   1. npm install express cors axios dotenv
 *   2. .env 파일에 API 키 입력
 *   3. node server.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { analyzeCandles } = require("./analysis.js");
const { fetchNpsChanges, fetchNpsForStock } = require("./dart.js");
const { judgeBatch, computeStats, computeWeights, scoreSignal } = require("./simulation.js");

const app = express();
// CORS: Firebase Hosting URL + 로컬 개발 모두 허용
const ALLOWED_ORIGINS = [
  "http://localhost:5173",   // Vite 개발 서버
  "http://localhost:3000",   // CRA 개발 서버
  // Firebase Hosting URL — .env에 ALLOWED_ORIGIN=https://xxx.web.app 형태로 추가
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
  // 추가 도메인이 있으면 여기에 직접 추가
];
app.use(cors({
  origin: (origin, cb) => {
    // origin이 없으면 같은 서버(서버사이드 렌더링, curl 등) — 허용
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com")) {
      return cb(null, true);
    }
    // 개발 중에는 전체 허용 (NODE_ENV=development)
    if (process.env.NODE_ENV !== "production") return cb(null, true);
    cb(new Error(`CORS 차단: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

const KIS_BASE = process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443"; // 실전투자

let ACCESS_TOKEN = null;
let TOKEN_EXPIRES_AT = null;

function buildKisErrorPayload(err, label = "KIS") {
  return {
    ok: false,
    label,
    error: err.message,
    status: err.response?.status || 500,
    kisError: err.response?.data || null,
    url: err.config?.url || null,
    params: err.config?.params || null,
    method: err.config?.method || null,
    hint:
      err.response?.status === 403
        ? "KIS 403 오류입니다. APP_KEY/APP_SECRET, 실전·모의 URL, TR_ID, 요청 파라미터, 계정 권한을 확인하세요."
        : "KIS 요청 중 오류가 발생했습니다.",
  };
}

function buildSafeQuoteFallback(code, err) {
  const payload = buildKisErrorPayload(err, "KIS_QUOTE");
  return {
    ok: false,
    fallback: true,
    code,
    name: code,
    price: null,
    change: 0,
    changeRate: 0,
    changeStr: "-",
    open: null,
    high: null,
    low: null,
    volume: null,
    per: null,
    pbr: null,
    eps: null,
    w52High: null,
    w52Low: null,
    ma5: null,
    ma20: null,
    ma60: null,
    ma120: null,
    up: true,
    analysis: null,
    error: payload.error,
    kisStatus: payload.status,
    kisError: payload.kisError,
    hint: "KIS 개별 종목 조회 실패로 화면 보호용 빈 시세를 반환했습니다. 종목코드, 거래소 구분, API 권한을 확인하세요.",
  };
}


// ── 토큰 자동 발급/갱신 ──────────────────────────────────────────
async function getAccessToken() {
  const now = Date.now();
  if (ACCESS_TOKEN && TOKEN_EXPIRES_AT && now < TOKEN_EXPIRES_AT) {
    return ACCESS_TOKEN;
  }

  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    throw new Error("KIS_APP_KEY 또는 KIS_APP_SECRET 환경변수가 없습니다.");
  }

  console.log("[KIS] 토큰 발급 중...");
  try {
    const res = await axios.post(`${KIS_BASE}/oauth2/tokenP`, {
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    });
    ACCESS_TOKEN = res.data.access_token;
    TOKEN_EXPIRES_AT = now + (Number(res.data.expires_in || 86400) - 60) * 1000;
    console.log("[KIS] 토큰 발급 완료");
    return ACCESS_TOKEN;
  } catch (err) {
    console.error("[KIS token error]", buildKisErrorPayload(err, "KIS_TOKEN"));
    throw err;
  }
}

async function kisGet(path, trId, params) {
  const token = await getAccessToken();
  const res = await axios.get(`${KIS_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: "P",
    },
    params,
  });
  return res.data;
}

// ── 분석용 일봉 데이터 가져오기 (내부 헬퍼) ─────────────────────
// 베이스 지지선 판정에 필요한 최소 봉 수 = 120일 + 여유분
async function fetchDailyCandles(code, count = 130) {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    "FHKST03010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: "",
      FID_INPUT_DATE_2: "",
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: "1",
    }
  );
  return (data.output2 || []).slice(0, count).map((c) => ({
    date: c.stck_bsop_date,
    open: parseInt(c.stck_oprc),
    high: parseInt(c.stck_hgpr),
    low: parseInt(c.stck_lwpr),
    close: parseInt(c.stck_clpr),
    volume: parseInt(c.acml_vol),
  }));
}

// ── 엔드포인트 ───────────────────────────────────────────────────

// 서버 상태 확인
app.get("/api/health", async (req, res) => {
  try {
    await getAccessToken();
    res.json({ status: "ok", token: !!ACCESS_TOKEN, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// KOSPI / KOSDAQ 지수
app.get("/api/index", async (req, res) => {
  try {
    const [kospi, kosdaq] = await Promise.all([
      kisGet("/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000",
        { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001" }),
      kisGet("/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000",
        { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "1001" }),
    ]);
    const fmt = (d, name) => {
      const o = d.output;
      const rate = parseFloat(o.bstp_nmix_prdy_ctrt);
      return {
        name,
        val: parseFloat(o.bstp_nmix_prpr).toLocaleString("ko-KR", { maximumFractionDigits: 2 }),
        ch: `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
        up: rate >= 0,
        sub: `거래량 ${parseInt(o.acml_vol).toLocaleString()}`,
      };
    };
    res.json([fmt(kospi, "KOSPI"), fmt(kosdaq, "KOSDAQ")]);
  } catch (err) {
    console.error("[index]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// 종목 현재가 + 기술적 지표 + 경제명탐정·독개미 분석
// GET /api/quote/:code           → 기본 (analysis 포함)
// GET /api/quote/:code?lite=1    → analysis 제외 (빠른 응답)
app.get("/api/quote/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const lite = req.query.lite === "1";

    // 시세와 일봉을 병렬로 (lite=1이면 일봉 호출 생략)
    const quotePromise = kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
    );
    const dailyPromise = lite ? Promise.resolve(null) : fetchDailyCandles(code, 130);
    const [quoteData, candles] = await Promise.all([quotePromise, dailyPromise]);

    const o = quoteData.output;
    const rate = parseFloat(o.prdy_ctrt);
    const base = {
      code,
      name: o.hts_kor_isnm,
      price: parseInt(o.stck_prpr),
      change: parseInt(o.prdy_vrss),
      changeRate: rate,
      changeStr: `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
      open: parseInt(o.stck_oprc),
      high: parseInt(o.stck_hgpr),
      low: parseInt(o.stck_lwpr),
      volume: parseInt(o.acml_vol),
      per: parseFloat(o.per) || null,
      pbr: parseFloat(o.pbr) || null,
      eps: parseFloat(o.eps) || null,
      w52High: parseInt(o.w52_hgpr),
      w52Low: parseInt(o.w52_lwpr),
      // KIS 이격도 (참고용, 정확한 값은 analysis.distance 사용)
      ma5: parseFloat(o.d5_esdg) || null,
      ma20: parseFloat(o.d20_esdg) || null,
      ma60: parseFloat(o.d60_esdg) || null,
      ma120: parseFloat(o.d120_esdg) || null,
      up: rate >= 0,
    };

    // 경제명탐정 4·5주차 + 독개미 자동 분석
    if (!lite && candles && candles.length >= 5) {
      try {
        base.analysis = analyzeCandles(candles);
      } catch (e) {
        console.error("[analyze]", code, e.message);
        base.analysis = null;
        base.analysisError = e.message;
      }
    }

    res.json(base);
  } catch (err) {
    const payload = buildKisErrorPayload(err, "KIS_QUOTE");
    console.error("[quote]", payload);

    // 화면 보호:
    // 특정 국내 종목에서 KIS가 500/403을 반환해도 프론트 전체가 오류처럼 보이지 않도록
    // HTTP 200 + fallback:true 형태로 반환합니다.
    // 이렇게 하면 콘솔의 빨간 500 메시지도 줄고, 해당 종목만 "조회 실패" 상태로 표시됩니다.
    res.status(200).json(buildSafeQuoteFallback(req.params.code, err));
  }
});

// 일봉 / 주봉 / 월봉 차트 데이터 + 분석
// GET /api/chart/:code?period=D&count=60
// GET /api/chart/:code?period=D&count=60&analyze=1   → 일봉일 때만 analysis 첨부
app.get("/api/chart/:code", async (req, res) => {
  try {
    const { period = "D", count = 60, analyze = "1" } = req.query;
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      "FHKST03010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: req.params.code,
        FID_INPUT_DATE_1: "",
        FID_INPUT_DATE_2: "",
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: "1",
      }
    );
    const candles = (data.output2 || []).slice(0, parseInt(count)).map((c) => ({
      date: c.stck_bsop_date,
      open: parseInt(c.stck_oprc),
      high: parseInt(c.stck_hgpr),
      low: parseInt(c.stck_lwpr),
      close: parseInt(c.stck_clpr),
      volume: parseInt(c.acml_vol),
    }));

    const result = { code: req.params.code, period, candles };

    // 일봉이고 분석 옵션이 켜져있고 봉이 충분하면 analysis 첨부
    if (period === "D" && analyze !== "0" && candles.length >= 5) {
      try {
        result.analysis = analyzeCandles(candles);
      } catch (e) {
        console.error("[analyze]", e.message);
        result.analysisError = e.message;
      }
    }

    res.json(result);
  } catch (err) {
    const payload = buildKisErrorPayload(err, "KIS_CHART");
    console.error("[chart]", payload);
    res.status(payload.status || 500).json(payload);
  }
});

// 종목 분석만 빠르게 받기 (시세 데이터 없이 분석 객체만)
// GET /api/analyze/:code
app.get("/api/analyze/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const candles = await fetchDailyCandles(code, 130);
    if (!candles || candles.length < 5) {
      return res.status(400).json({ error: "분석에 필요한 일봉 데이터가 부족합니다.", count: candles?.length || 0 });
    }
    const analysis = analyzeCandles(candles);
    res.json({
      code,
      candleCount: candles.length,
      lastDate: candles[0]?.date,
      analysis,
    });
  } catch (err) {
    const payload = buildKisErrorPayload(err, "KIS_ANALYZE");
    console.error("[analyze-endpoint]", payload);
    res.status(payload.status || 500).json(payload);
  }
});

// 복수 종목 시세 (쉼표 구분)
// GET /api/quotes?codes=005930,000660,035420
// GET /api/quotes?codes=...&analyze=1  → 분석까지 (API 호출량 N배 증가하니 주의)
app.get("/api/quotes", async (req, res) => {
  try {
    const codes = (req.query.codes || "").split(",").filter(Boolean).slice(0, 10);
    const withAnalysis = req.query.analyze === "1";

    const results = await Promise.allSettled(
      codes.map(async (code) => {
        const trimmed = code.trim();
        const quote = await kisGet(
          "/uapi/domestic-stock/v1/quotations/inquire-price",
          "FHKST01010100",
          { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: trimmed }
        );
        let analysis = null;
        if (withAnalysis) {
          try {
            const candles = await fetchDailyCandles(trimmed, 130);
            if (candles.length >= 5) analysis = analyzeCandles(candles);
          } catch (e) {
            // 분석 실패해도 시세는 반환
          }
        }
        return { quote, analysis };
      })
    );

    const data = results.map((r, i) => {
      if (r.status === "rejected") return { code: codes[i], error: true };
      const o = r.value.quote.output;
      const rate = parseFloat(o.prdy_ctrt);
      const base = {
        code: codes[i],
        name: o.hts_kor_isnm,
        price: parseInt(o.stck_prpr),
        changeRate: rate,
        changeStr: `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
        up: rate >= 0,
        volume: parseInt(o.acml_vol),
      };
      if (r.value.analysis) base.analysis = r.value.analysis;
      return base;
    });
    res.json(data);
  } catch (err) {
    console.error("[quotes]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 종목 검색
// GET /api/search?q=삼성
// 검색 순서:
// 1) 서버 KRX 마스터 DB
// 2) KIS search-stock-info API
// 3) 결과 병합 후 중복 제거
function normalizeKisSearchRow(row = {}) {
  const code =
    row.code ||
    row.pdno ||
    row.PDNO ||
    row.mksc_shrn_iscd ||
    row.stck_shrn_iscd ||
    row.iscd ||
    row.shtn_pdno ||
    "";

  const name =
    row.name ||
    row.prdt_name ||
    row.prdt_name120 ||
    row.hts_kor_isnm ||
    row.kor_isnm ||
    row.prdt_eng_name ||
    code;

  const market =
    row.market ||
    row.rprs_mrkt_kor_name ||
    row.mrkt_kor_name ||
    row.mrkt_div_cls_name ||
    "";

  return {
    code: String(code).replace(/\D/g, "").padStart(6, "0").slice(-6),
    name: String(name || code),
    tag: market || "KIS",
    sector: market || "KIS",
    market,
    source: "KIS",
  };
}

app.get("/api/search", async (req, res) => {
  const q = req.query.q || "";
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

  const masterRows = searchKrxMaster(q, limit).map((x) => ({ ...x, source: "KRX_MASTER" }));
  let kisRows = [];
  let kisError = null;

  try {
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/search-stock-info",
      "CTPF1002R",
      { PRDT_TYPE_CD: "300", PDNO: q }
    );

    const rawRows = Array.isArray(data?.output)
      ? data.output
      : Array.isArray(data?.output1)
        ? data.output1
        : Array.isArray(data)
          ? data
          : [];

    kisRows = rawRows.map(normalizeKisSearchRow).filter((x) => /^\d{6}$/.test(x.code));
  } catch (err) {
    kisError = err.message;
    console.error("[search:KIS]", err.response?.data || err.message);
  }

  const map = new Map();
  [...masterRows, ...kisRows].forEach((x) => {
    if (!x.code) return;
    if (!map.has(x.code)) map.set(x.code, x);
  });

  const results = Array.from(map.values()).slice(0, limit);
  res.status(200).json({
    ok: true,
    q,
    count: results.length,
    source: kisError ? "KRX master + KIS fallback failed" : "KRX master + KIS",
    kisError,
    results,
    output: results,
  });
});

const KRX_MASTER_DB = [
  {
    "code": "005930",
    "name": "삼성전자",
    "tag": "반도체",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "000660",
    "name": "SK하이닉스",
    "tag": "반도체",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "035420",
    "name": "NAVER",
    "tag": "플랫폼",
    "sector": "인터넷",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "035720",
    "name": "카카오",
    "tag": "플랫폼",
    "sector": "인터넷",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "005380",
    "name": "현대차",
    "tag": "자동차",
    "sector": "자동차",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "000270",
    "name": "기아",
    "tag": "자동차",
    "sector": "자동차",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "006400",
    "name": "삼성SDI",
    "tag": "2차전지",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "373220",
    "name": "LG에너지솔루션",
    "tag": "2차전지",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "012450",
    "name": "한화에어로스페이스",
    "tag": "방산",
    "sector": "방산",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "042700",
    "name": "한미반도체",
    "tag": "반도체",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "005490",
    "name": "POSCO홀딩스",
    "tag": "철강/2차전지",
    "sector": "철강",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "051910",
    "name": "LG화학",
    "tag": "화학/2차전지",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "011170",
    "name": "롯데케미칼",
    "tag": "화학",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "066570",
    "name": "LG전자",
    "tag": "전기전자",
    "sector": "전기전자",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "105560",
    "name": "KB금융",
    "tag": "금융",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "055550",
    "name": "신한지주",
    "tag": "금융",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "086790",
    "name": "하나금융지주",
    "tag": "금융",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "316140",
    "name": "우리금융지주",
    "tag": "금융",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "068270",
    "name": "셀트리온",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "207940",
    "name": "삼성바이오로직스",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "028260",
    "name": "삼성물산",
    "tag": "지주/건설",
    "sector": "지주",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "032830",
    "name": "삼성생명",
    "tag": "보험",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "033780",
    "name": "KT&G",
    "tag": "소비재",
    "sector": "소비재",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "096770",
    "name": "SK이노베이션",
    "tag": "정유/배터리",
    "sector": "에너지",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "034730",
    "name": "SK",
    "tag": "지주",
    "sector": "지주",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "017670",
    "name": "SK텔레콤",
    "tag": "통신",
    "sector": "통신",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "030200",
    "name": "KT",
    "tag": "통신",
    "sector": "통신",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "015760",
    "name": "한국전력",
    "tag": "전력",
    "sector": "유틸리티",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "009150",
    "name": "삼성전기",
    "tag": "전자부품",
    "sector": "전기전자",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "011200",
    "name": "HMM",
    "tag": "해운",
    "sector": "운송",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "003670",
    "name": "포스코퓨처엠",
    "tag": "2차전지",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "247540",
    "name": "에코프로비엠",
    "tag": "2차전지",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "086520",
    "name": "에코프로",
    "tag": "2차전지",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "196170",
    "name": "알테오젠",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "000810",
    "name": "삼성화재",
    "tag": "보험",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "010130",
    "name": "고려아연",
    "tag": "비철금속",
    "sector": "소재",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "018260",
    "name": "삼성에스디에스",
    "tag": "IT서비스",
    "sector": "IT",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "251270",
    "name": "넷마블",
    "tag": "게임",
    "sector": "게임",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "259960",
    "name": "크래프톤",
    "tag": "게임",
    "sector": "게임",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "377300",
    "name": "카카오페이",
    "tag": "핀테크",
    "sector": "인터넷",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "323410",
    "name": "카카오뱅크",
    "tag": "은행",
    "sector": "금융",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "047810",
    "name": "한국항공우주",
    "tag": "방산",
    "sector": "방산",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "064350",
    "name": "현대로템",
    "tag": "방산/철도",
    "sector": "방산",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "329180",
    "name": "HD현대중공업",
    "tag": "조선",
    "sector": "조선",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "010140",
    "name": "삼성중공업",
    "tag": "조선",
    "sector": "조선",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "009540",
    "name": "HD한국조선해양",
    "tag": "조선",
    "sector": "조선",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "267260",
    "name": "HD현대일렉트릭",
    "tag": "전력기기",
    "sector": "전력기기",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "010120",
    "name": "LS ELECTRIC",
    "tag": "전력기기",
    "sector": "전력기기",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "352820",
    "name": "하이브",
    "tag": "엔터",
    "sector": "엔터",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "041510",
    "name": "에스엠",
    "tag": "엔터",
    "sector": "엔터",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "035900",
    "name": "JYP Ent.",
    "tag": "엔터",
    "sector": "엔터",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "263750",
    "name": "펄어비스",
    "tag": "게임",
    "sector": "게임",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "112040",
    "name": "위메이드",
    "tag": "게임",
    "sector": "게임",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "011070",
    "name": "LG이노텍",
    "tag": "전자부품",
    "sector": "전기전자",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "272210",
    "name": "한화시스템",
    "tag": "방산",
    "sector": "방산",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "011210",
    "name": "현대위아",
    "tag": "자동차부품",
    "sector": "자동차",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "012330",
    "name": "현대모비스",
    "tag": "자동차부품",
    "sector": "자동차",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "161390",
    "name": "한국타이어앤테크놀로지",
    "tag": "타이어",
    "sector": "자동차",
    "market": "KOSPI",
    "indexes": [
      "KOSPI200"
    ]
  },
  {
    "code": "028300",
    "name": "HLB",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "145020",
    "name": "휴젤",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "214150",
    "name": "클래시스",
    "tag": "미용의료기기",
    "sector": "의료기기",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "214450",
    "name": "파마리서치",
    "tag": "바이오/미용",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "058470",
    "name": "리노공업",
    "tag": "반도체",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "039030",
    "name": "이오테크닉스",
    "tag": "반도체장비",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "036930",
    "name": "주성엔지니어링",
    "tag": "반도체장비",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "240810",
    "name": "원익IPS",
    "tag": "반도체장비",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "064760",
    "name": "티씨케이",
    "tag": "반도체소재",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "095340",
    "name": "ISC",
    "tag": "반도체부품",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "089030",
    "name": "테크윙",
    "tag": "반도체장비",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "067310",
    "name": "하나마이크론",
    "tag": "반도체후공정",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "222800",
    "name": "심텍",
    "tag": "PCB",
    "sector": "전자부품",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "101490",
    "name": "에스앤에스텍",
    "tag": "반도체소재",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "319660",
    "name": "피에스케이",
    "tag": "반도체장비",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "036540",
    "name": "SFA반도체",
    "tag": "반도체후공정",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "005290",
    "name": "동진쎄미켐",
    "tag": "반도체소재",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "046890",
    "name": "서울반도체",
    "tag": "LED",
    "sector": "전자부품",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "078600",
    "name": "대주전자재료",
    "tag": "2차전지소재",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "121600",
    "name": "나노신소재",
    "tag": "2차전지소재",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "348370",
    "name": "엔켐",
    "tag": "2차전지소재",
    "sector": "2차전지",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "025900",
    "name": "동화기업",
    "tag": "2차전지/소재",
    "sector": "소재",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "131970",
    "name": "두산테스나",
    "tag": "반도체테스트",
    "sector": "반도체",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "277810",
    "name": "레인보우로보틱스",
    "tag": "로봇",
    "sector": "로봇",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "108490",
    "name": "로보티즈",
    "tag": "로봇",
    "sector": "로봇",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "090360",
    "name": "로보스타",
    "tag": "로봇",
    "sector": "로봇",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "042000",
    "name": "카페24",
    "tag": "이커머스",
    "sector": "인터넷",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "067160",
    "name": "SOOP",
    "tag": "플랫폼",
    "sector": "인터넷",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "035760",
    "name": "CJ ENM",
    "tag": "미디어",
    "sector": "미디어",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "060250",
    "name": "NHN KCP",
    "tag": "결제",
    "sector": "핀테크",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "293490",
    "name": "카카오게임즈",
    "tag": "게임",
    "sector": "게임",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "122870",
    "name": "와이지엔터테인먼트",
    "tag": "엔터",
    "sector": "엔터",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "376300",
    "name": "디어유",
    "tag": "엔터플랫폼",
    "sector": "엔터",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "053800",
    "name": "안랩",
    "tag": "보안",
    "sector": "소프트웨어",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "096530",
    "name": "씨젠",
    "tag": "진단키트",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "237690",
    "name": "에스티팜",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "068760",
    "name": "셀트리온제약",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "141080",
    "name": "리가켐바이오",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "000250",
    "name": "삼천당제약",
    "tag": "제약",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "214370",
    "name": "케어젠",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "086900",
    "name": "메디톡스",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "048410",
    "name": "현대바이오",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "206650",
    "name": "유바이오로직스",
    "tag": "백신",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "140410",
    "name": "메지온",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "095700",
    "name": "제넥신",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "085660",
    "name": "차바이오텍",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "084990",
    "name": "헬릭스미스",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "007390",
    "name": "네이처셀",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "215600",
    "name": "신라젠",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "323990",
    "name": "박셀바이오",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "144510",
    "name": "지씨셀",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "195940",
    "name": "HK이노엔",
    "tag": "제약",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "052020",
    "name": "에스티큐브",
    "tag": "바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "215200",
    "name": "메가스터디교육",
    "tag": "교육",
    "sector": "교육",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "089980",
    "name": "상아프론테크",
    "tag": "소재",
    "sector": "소재",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "004000",
    "name": "롯데정밀화학",
    "tag": "화학/소재",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "010060",
    "name": "OCI홀딩스",
    "tag": "화학/소재",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "298050",
    "name": "효성첨단소재",
    "tag": "화학/소재",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "298020",
    "name": "효성티앤씨",
    "tag": "섬유/화학",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "005950",
    "name": "이수화학",
    "tag": "화학",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "009830",
    "name": "한화솔루션",
    "tag": "화학/태양광",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "285130",
    "name": "SK케미칼",
    "tag": "화학/바이오",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "120110",
    "name": "코오롱인더",
    "tag": "화학/소재",
    "sector": "화학",
    "market": "KOSPI",
    "indexes": []
  }
];

function normalizeKrQuery(q = "") {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[㈜주식회사\(\)\[\]\-_.]/g, "");
}

function searchKrxMaster(q = "", limit = 20) {
  const query = normalizeKrQuery(q);
  if (!query) return KRX_MASTER_DB.slice(0, limit);

  const scored = KRX_MASTER_DB.map((x) => {
    const name = normalizeKrQuery(x.name);
    const code = String(x.code || "");
    const tag = normalizeKrQuery(`${x.tag || ""}${x.sector || ""}${x.market || ""}${(x.indexes || []).join("")}`);
    let score = 0;
    if (code === query) score += 1000;
    if (code.startsWith(query)) score += 500;
    if (name === query) score += 900;
    if (name.startsWith(query)) score += 500;
    if (name.includes(query)) score += 300;
    if (tag.includes(query)) score += 100;
    return { ...x, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));

  return scored.slice(0, limit).map(({ score, ...x }) => x);
}

app.get("/api/master/search", (req, res) => {
  const q = req.query.q || "";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const results = searchKrxMaster(q, limit);
  res.json({ ok: true, q, count: results.length, results, source: "server KRX master cache" });
});

app.get("/api/master/symbol/:query", (req, res) => {
  const results = searchKrxMaster(req.params.query, 10);
  if (!results.length) {
    return res.status(404).json({ ok: false, error: "MASTER_NOT_FOUND", q: req.params.query });
  }
  res.json({ ok: true, result: results[0], candidates: results });
});

app.get("/api/master/universe/:kind", (req, res) => {
  const kind = String(req.params.kind || "").toLowerCase();
  let rows = KRX_MASTER_DB;
  if (kind === "kospi200") rows = rows.filter((x) => (x.indexes || []).includes("KOSPI200"));
  else if (kind === "kosdaq200") rows = rows.filter((x) => (x.indexes || []).includes("KOSDAQ200"));
  else if (kind === "kospi") rows = rows.filter((x) => String(x.market).includes("KOSPI"));
  else if (kind === "kosdaq") rows = rows.filter((x) => String(x.market).includes("KOSDAQ"));
  res.json({ ok: true, kind, count: rows.length, results: rows });
});



// ═══════════════════════════════════════════════════════════════
// DART - 국민연금 지분 변동
// ═══════════════════════════════════════════════════════════════

// GET /api/nps?days=60&enrich=1
//  - days: 며칠 이전까지 (1~90, 기본 60)
//  - enrich: 1이면 majorstock.json로 정확한 지분율 변화 보강 (느림), 0이면 빠름
app.get("/api/nps", async (req, res) => {
  try {
    if (!process.env.DART_API_KEY) {
      return res.status(503).json({
        error: "DART_API_KEY가 .env에 설정되지 않았습니다.",
        hint: "https://opendart.fss.or.kr 에서 인증키 발급 후 .env에 DART_API_KEY=... 추가",
      });
    }
    const days = parseInt(req.query.days || "60", 10);
    const enrich = req.query.enrich !== "0";
    const result = await fetchNpsChanges({
      apiKey: process.env.DART_API_KEY,
      days,
      enrich,
      maxEnrich: 30,
    });
    res.json(result);
  } catch (err) {
    console.error("[nps]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nps/:corpCode  -- 특정 종목의 국민연금 보유 이력
app.get("/api/nps/:corpCode", async (req, res) => {
  try {
    if (!process.env.DART_API_KEY) {
      return res.status(503).json({ error: "DART_API_KEY가 설정되지 않았습니다." });
    }
    const result = await fetchNpsForStock({
      apiKey: process.env.DART_API_KEY,
      corpCode: req.params.corpCode,
    });
    res.json(result);
  } catch (err) {
    console.error("[nps-stock]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AI 시뮬레이션 - 시그널 자동 채점 + 누적 통계
// ═══════════════════════════════════════════════════════════════

// POST /api/sim/judge
//   body: { signals: [...] }   -- 클라이언트 LocalStorage의 시그널 배열
//   응답: { signals: [...] }   -- 채점된 시그널 (status, pnlPct 등 업데이트됨)
//
// 만기일이 지난 시그널만 채점하고, pending은 그대로 반환합니다.
// 각 종목별로 KIS API에서 일봉을 한 번씩 호출합니다.
app.post("/api/sim/judge", async (req, res) => {
  try {
    const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
    if (signals.length === 0) return res.json({ signals: [] });

    // 채점 대상: status가 pending이거나 없는 시그널만
    const pending = signals.filter(s => !s.status || s.status === "pending");
    const alreadyResolved = signals.filter(s => s.status && s.status !== "pending");

    // 종목별로 묶어서 일봉을 한 번씩만 호출
    const codes = [...new Set(pending.map(s => s.code))];
    const candlesByCode = new Map();
    await Promise.all(
      codes.map(async (code) => {
        try {
          const candles = await fetchDailyCandles(code, 60);
          // KIS는 desc 순이므로 asc 정렬
          candles.sort((a, b) => String(a.date).localeCompare(String(b.date)));
          candlesByCode.set(code, candles);
        } catch (e) {
          console.error(`[sim/judge] ${code} 일봉 실패:`, e.message);
        }
      })
    );

    const judged = judgeBatch(pending, candlesByCode);
    res.json({
      signals: [...alreadyResolved, ...judged],
      judgedCount: judged.filter(s => s.status && s.status !== "pending").length,
      pendingCount: judged.filter(s => !s.status || s.status === "pending").length,
    });
  } catch (err) {
    console.error("[sim/judge]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sim/stats
//   body: { signals: [...] }
//   응답: { stats, weights }  -- 누적 통계 + 다음 시그널에 적용할 가중치
app.post("/api/sim/stats", (req, res) => {
  try {
    const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
    const stats = computeStats(signals);
    const weights = computeWeights(stats);
    res.json({ stats, weights });
  } catch (err) {
    console.error("[sim/stats]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sim/score
//   body: { features: [...], weights: {...} }
//   응답: { score, breakdown, confidence }
app.post("/api/sim/score", (req, res) => {
  try {
    const features = Array.isArray(req.body?.features) ? req.body.features : [];
    const weights = req.body?.weights || {};
    const result = scoreSignal(features, weights);
    res.json(result);
  } catch (err) {
    console.error("[sim/score]", err.message);
    res.status(500).json({ error: err.message });
  }
});



// ── Gemini AI 분석 프록시 ─────────────────────────────────────
// POST /api/ai/analyze
// body: { prompt, systemPrompt, maxTokens }
// GEMINI_API_KEY 또는 GOOGLE_API_KEY가 없으면 503을 반환합니다.
app.post("/api/ai/analyze", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        error: "GEMINI_API_KEY 또는 GOOGLE_API_KEY가 서버 환경변수에 없습니다.",
        fallback: true,
      });
    }

    const prompt = String(req.body?.prompt || "").trim();
    const systemPrompt = String(req.body?.systemPrompt || "").trim();
    const maxTokens = Math.min(Number(req.body?.maxTokens || 1200), 3000);

    if (!prompt) {
      return res.status(400).json({ ok: false, error: "prompt가 비어 있습니다." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.35,
      },
    };

    const { data } = await axios.post(url, body, {
      timeout: 20000,
      headers: { "Content-Type": "application/json" },
    });

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n").trim() ||
      "";

    res.json({
      ok: true,
      text,
      raw: data,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    console.error("[ai/analyze]", {
      message: err.message,
      status,
      data: err.response?.data,
    });
    res.status(status).json({
      ok: false,
      error: err.message,
      status,
      detail: err.response?.data || null,
      fallback: true,
    });
  }
});



// ── 서버 저장형 가격 알림 + Telegram 발송 ─────────────────────
// 웹앱이 닫혀 있어도 Render Cron Job이 /api/alerts/check 를 호출하면 조건을 감시하고 Telegram으로 발송합니다.
// 환경변수:
//   TELEGRAM_BOT_TOKEN = BotFather에서 발급받은 봇 토큰
//   TELEGRAM_CHAT_ID   = 메시지를 받을 개인/그룹 chat_id
//   ALERT_CHECK_SECRET = 선택사항. 설정 시 /api/alerts/check?secret=... 로 호출해야 합니다.
const ALERTS_FILE = process.env.ALERTS_FILE || path.join(__dirname, "alerts.json");

function readServerAlerts() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return [];
    const raw = fs.readFileSync(ALERTS_FILE, "utf-8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[alerts/read]", err.message);
    return [];
  }
}

function writeServerAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2), "utf-8");
}

function normalizeServerAlert(input) {
  const type = String(input.type || "priceAbove");
  const code = String(input.code || "").trim();
  const target = Number(input.target || 0);

  if (!code || !/^\d{6}$/.test(code)) {
    throw new Error("종목코드 6자리가 필요합니다.");
  }

  if (type !== "ma20Touch" && (!Number.isFinite(target) || target <= 0)) {
    throw new Error("목표가/손절가 기준 단가가 필요합니다.");
  }

  return {
    id: input.id || `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    code,
    name: String(input.name || code),
    type,
    target: type === "ma20Touch" ? 0 : target,
    source: input.source || "WEB",
    message: input.message || "",
    active: input.active !== false,
    triggered: Boolean(input.triggered),
    lastSentAt: input.lastSentAt || null,
    createdAt: input.createdAt || new Date().toLocaleString("ko-KR"),
  };
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      ok: false,
      skipped: true,
      reason: "TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 환경변수가 없습니다.",
    };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const { data } = await axios.post(url, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  }, {
    timeout: 8000,
    headers: { "Content-Type": "application/json" },
  });

  return data;
}

function buildTelegramAlertText(alert, quote, basis) {
  const price = Number(quote.price || 0);
  const rate = Number(quote.changeRate || 0);
  const typeLabel =
    alert.type === "priceAbove" ? "목표가 이상 도달" :
    alert.type === "priceBelow" ? "손절가 이하 이탈" :
    alert.type === "ma20Touch" ? "20일선 도달" :
    alert.type;

  return [
    "🚨 <b>ALPHA 가격 알림</b>",
    "",
    `<b>${alert.name}(${alert.code})</b>`,
    `조건: ${typeLabel}`,
    `기준: ${alert.type === "ma20Touch" ? "20일선 ±1%" : Number(alert.target).toLocaleString("ko-KR") + "원"}`,
    `현재가: ${price.toLocaleString("ko-KR")}원`,
    `등락률: ${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
    `판정: ${basis}`,
    "",
    alert.message ? `메모: ${alert.message}` : "",
    `발송시각: ${new Date().toLocaleString("ko-KR")}`,
  ].filter(Boolean).join("\n");
}

async function getQuoteForAlert(code) {
  const quote = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
    { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
  );

  const o = quote.output || {};
  const rate = parseFloat(o.prdy_ctrt || 0);
  return {
    code,
    name: o.hts_kor_isnm || code,
    price: parseInt(o.stck_prpr || 0),
    changeRate: rate,
    changeStr: `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
    ma20: parseFloat(o.d20_esdg) || 0,
  };
}

function evaluateServerAlert(alert, quote) {
  const price = Number(quote.price || 0);
  const target = Number(alert.target || 0);
  const ma20 = Number(quote.ma20 || 0);

  if (alert.type === "priceAbove") {
    return {
      hit: price >= target,
      basis: `${price.toLocaleString("ko-KR")} >= ${target.toLocaleString("ko-KR")}`,
    };
  }

  if (alert.type === "priceBelow") {
    return {
      hit: price <= target,
      basis: `${price.toLocaleString("ko-KR")} <= ${target.toLocaleString("ko-KR")}`,
    };
  }

  if (alert.type === "ma20Touch") {
    const hit = ma20 > 0 ? Math.abs(price - ma20) / ma20 <= 0.01 : false;
    return {
      hit,
      basis: ma20 > 0
        ? `${price.toLocaleString("ko-KR")} ≒ 20일선 ${Math.round(ma20).toLocaleString("ko-KR")}`
        : "20일선 데이터 없음",
    };
  }

  return { hit: false, basis: "지원하지 않는 조건" };
}

app.get("/api/alerts", (req, res) => {
  res.json({
    ok: true,
    count: readServerAlerts().length,
    alerts: readServerAlerts(),
  });
});

app.post("/api/alerts", (req, res) => {
  try {
    const alertItem = normalizeServerAlert(req.body || {});
    const alerts = readServerAlerts();

    const exists = alerts.some((a) =>
      a.code === alertItem.code &&
      a.type === alertItem.type &&
      Number(a.target) === Number(alertItem.target) &&
      a.active !== false
    );

    if (!exists) {
      alerts.push(alertItem);
      writeServerAlerts(alerts);
    }

    res.json({
      ok: true,
      exists,
      alert: exists ? alerts.find((a) => a.code === alertItem.code && a.type === alertItem.type && Number(a.target) === Number(alertItem.target)) : alertItem,
      count: alerts.length,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete("/api/alerts/:id", (req, res) => {
  const alerts = readServerAlerts();
  const next = alerts.filter((a) => String(a.id) !== String(req.params.id));
  writeServerAlerts(next);
  res.json({ ok: true, deleted: alerts.length - next.length, count: next.length });
});

app.post("/api/alerts/telegram/test", async (req, res) => {
  try {
    const text = req.body?.text || "✅ ALPHA 텔레그램 알림 테스트입니다.";
    const result = await sendTelegramMessage(text);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      error: err.message,
      detail: err.response?.data || null,
    });
  }
});

app.get("/api/alerts/check", async (req, res) => {
  try {
    const secret = process.env.ALERT_CHECK_SECRET;
    if (secret && req.query.secret !== secret) {
      return res.status(401).json({ ok: false, error: "Invalid secret" });
    }

    const alerts = readServerAlerts();
    const next = [];
    const results = [];

    for (const alert of alerts) {
      if (alert.active === false) {
        next.push(alert);
        continue;
      }

      // 이미 발송된 알림은 중복 발송하지 않습니다. 다시 쓰려면 웹앱에서 새 알림으로 등록합니다.
      if (alert.triggered) {
        next.push(alert);
        results.push({ id: alert.id, code: alert.code, skipped: "already_triggered" });
        continue;
      }

      try {
        const quote = await getQuoteForAlert(alert.code);
        const evalResult = evaluateServerAlert(alert, quote);

        if (evalResult.hit) {
          const message = buildTelegramAlertText({ ...alert, name: alert.name || quote.name }, quote, evalResult.basis);
          const tg = await sendTelegramMessage(message);
          const updated = {
            ...alert,
            triggered: true,
            lastSentAt: new Date().toISOString(),
            lastPrice: quote.price,
            lastBasis: evalResult.basis,
          };
          next.push(updated);
          results.push({ id: alert.id, code: alert.code, hit: true, telegram: tg });
        } else {
          next.push({ ...alert, lastCheckedAt: new Date().toISOString(), lastPrice: quote.price, lastBasis: evalResult.basis });
          results.push({ id: alert.id, code: alert.code, hit: false, basis: evalResult.basis });
        }
      } catch (err) {
        next.push(alert);
        results.push({
          id: alert.id,
          code: alert.code,
          error: err.message,
          kisError: err.response?.data || null,
        });
      }
    }

    writeServerAlerts(next);

    res.json({
      ok: true,
      checked: alerts.length,
      sent: results.filter((r) => r.hit).length,
      results,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ── 해외주식 / 크립토 실시간 시세 ─────────────────────────────
// 별도 API 키 없이 Yahoo Finance chart endpoint를 프록시로 사용합니다.
// 프론트 호출:
//   GET /api/us/quote/NVDA
//   GET /api/crypto/quote/BTC
async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const { data } = await axios.get(url, {
    timeout: 8000,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closeArr = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  const lastClose = [...closeArr].reverse().find((v) => Number.isFinite(Number(v)));
  const price = Number(meta.regularMarketPrice ?? meta.postMarketPrice ?? lastClose ?? 0);
  const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
  const change = prevClose ? price - prevClose : 0;
  const changeRate = prevClose ? (change / prevClose) * 100 : 0;
  const lastTs = timestamps.length ? timestamps[timestamps.length - 1] * 1000 : Date.now();

  return {
    symbol,
    price,
    change,
    changeRate,
    changeStr: `${changeRate >= 0 ? "+" : ""}${changeRate.toFixed(2)}%`,
    currency: meta.currency || "USD",
    marketState: meta.marketState || "",
    time: new Date(lastTs).toISOString(),
    source: "Yahoo Finance",
  };
}


function yahooSymbol(symbol, type = "us") {
  const raw = String(symbol || "").trim().toUpperCase();
  if (!raw) return raw;
  if (type === "crypto" && !raw.includes("-")) return `${raw}-USD`;
  return raw;
}

function yahooRangeInterval(period = "D", range = "1Y", count = 260) {
  const p = String(period || "D").toUpperCase();
  const r = String(range || "1Y").toUpperCase();

  if (p === "M") {
    if (r === "1Y") return { range: "1y", interval: "1mo" };
    if (r === "3Y") return { range: "3y", interval: "1mo" };
    if (r === "5Y") return { range: "5y", interval: "1mo" };
    return { range: "10y", interval: "1mo" };
  }

  if (p === "Y") {
    return { range: r === "3Y" ? "5y" : r === "5Y" ? "5y" : "10y", interval: "3mo" };
  }

  if (r === "6M") return { range: "6mo", interval: "1d" };
  if (r === "1Y") return { range: "1y", interval: "1d" };
  if (r === "3Y") return { range: "3y", interval: "1d" };
  if (r === "5Y") return { range: "5y", interval: "1d" };
  return { range: "10y", interval: "1d" };
}

async function fetchYahooChart(symbol, type = "us", period = "D", range = "1Y", count = 260) {
  const ys = yahooSymbol(symbol, type);
  const ri = yahooRangeInterval(period, range, count);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?range=${ri.range}&interval=${ri.interval}`;
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const result = data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const candles = timestamps.map((ts, i) => {
    const open = Number(quote.open?.[i]);
    const high = Number(quote.high?.[i]);
    const low = Number(quote.low?.[i]);
    const close = Number(quote.close?.[i]);
    const volume = Number(quote.volume?.[i] || 0);
    if (![open, high, low, close].every(Number.isFinite)) return null;
    const d = new Date(ts * 1000);
    return {
      date: d.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
    };
  }).filter(Boolean);

  return candles.slice(-Number(count || candles.length));
}

app.get("/api/global/chart/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    const type = req.query.type || (["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB"].includes(symbol) ? "crypto" : "us");
    const period = req.query.period || "D";
    const range = req.query.range || "1Y";
    const count = Number(req.query.count || 260);
    const candles = await fetchYahooChart(symbol, type, period, range, count);
    res.json({
      ok: true,
      symbol,
      type,
      period,
      range,
      count: candles.length,
      source: "Yahoo Finance",
      candles,
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      error: err.message,
      detail: err.response?.data || null,
    });
  }
});

app.get("/api/global/quote/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    const type = req.query.type || (["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB"].includes(symbol) ? "crypto" : "us");
    const q = await fetchYahooQuote(yahooSymbol(symbol, type));
    res.json({ ...q, symbol, type, realtime: true, source: "Yahoo Finance" });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: err.message, detail: err.response?.data || null });
  }
});

app.get("/api/global/search", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const catalog = [
    { symbol: "NVDA", name: "NVIDIA", type: "us", sector: "AI 반도체" },
    { symbol: "TSLA", name: "Tesla", type: "us", sector: "전기차" },
    { symbol: "AAPL", name: "Apple", type: "us", sector: "빅테크" },
    { symbol: "MSFT", name: "Microsoft", type: "us", sector: "빅테크" },
    { symbol: "GOOGL", name: "Alphabet", type: "us", sector: "빅테크" },
    { symbol: "META", name: "Meta Platforms", type: "us", sector: "빅테크" },
    { symbol: "AMZN", name: "Amazon", type: "us", sector: "이커머스/클라우드" },
    { symbol: "AMD", name: "AMD", type: "us", sector: "반도체" },
    { symbol: "AVGO", name: "Broadcom", type: "us", sector: "반도체" },
    { symbol: "SMCI", name: "Super Micro Computer", type: "us", sector: "AI 서버" },
    { symbol: "BTC", name: "Bitcoin", type: "crypto", sector: "Crypto" },
    { symbol: "ETH", name: "Ethereum", type: "crypto", sector: "Crypto" },
    { symbol: "SOL", name: "Solana", type: "crypto", sector: "Crypto" },
    { symbol: "XRP", name: "XRP", type: "crypto", sector: "Crypto" },
  ];
  const rows = q
    ? catalog.filter((x) =>
        x.symbol.toLowerCase().includes(q) ||
        x.name.toLowerCase().includes(q) ||
        String(x.sector || "").toLowerCase().includes(q)
      )
    : catalog;
  res.json(rows.slice(0, 20));
});


app.get("/api/us/quote/:symbol", async (req, res) => {
  try {
    const raw = String(req.params.symbol || "").trim().toUpperCase();
    if (!/^[A-Z.]{1,10}$/.test(raw)) {
      return res.status(400).json({ error: "Invalid US symbol" });
    }
    const quote = await fetchYahooQuote(raw);
    res.json(quote);
  } catch (err) {
    console.error("[us/quote]", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/crypto/quote/:symbol", async (req, res) => {
  try {
    const raw = String(req.params.symbol || "").trim().toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(raw)) {
      return res.status(400).json({ error: "Invalid crypto symbol" });
    }
    const yahooSymbol = raw.endsWith("-USD") ? raw : `${raw}-USD`;
    const quote = await fetchYahooQuote(yahooSymbol);
    res.json({ ...quote, symbol: raw });
  } catch (err) {
    console.error("[crypto/quote]", err.message);
    res.status(502).json({ error: err.message });
  }
});




app.get("/api/kis/health", async (req, res) => {
  res.json({
    ok: true,
    kisBase: KIS_BASE,
    hasAppKey: Boolean(process.env.KIS_APP_KEY),
    hasAppSecret: Boolean(process.env.KIS_APP_SECRET),
    tokenCached: Boolean(ACCESS_TOKEN),
    tokenExpiresAt: TOKEN_EXPIRES_AT ? new Date(TOKEN_EXPIRES_AT).toISOString() : null,
    time: new Date().toISOString(),
  });
});

app.get("/api/global/health", async (req, res) => {
  const checks = {};
  try {
    checks.NVDA = await fetchYahooQuote("NVDA");
  } catch (e) {
    checks.NVDA = { error: e.message };
  }
  try {
    checks.BTC = await fetchYahooQuote("BTC-USD");
  } catch (e) {
    checks.BTC = { error: e.message };
  }
  res.json({
    ok: true,
    routes: ["/api/us/quote/:symbol", "/api/crypto/quote/:symbol", "/api/global/quote/:symbol", "/api/global/chart/:symbol", "/api/global/search"],
    checks,
    time: new Date().toISOString(),
  });
});


// ── 서버 시작 ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  ALPHA TRADING - KIS 시세 + 분석 프록시 서버 v3       ║
║  http://localhost:${PORT}                                ║
╠══════════════════════════════════════════════════════╣
║  [시세]                                              ║
║  GET /api/health                  서버 상태           ║
║  GET /api/index                   KOSPI/KOSDAQ        ║
║  GET /api/quote/:code             시세 + 분석         ║
║  GET /api/chart/:code?period=D    차트 + 분석         ║
║  GET /api/analyze/:code           분석만              ║
║  GET /api/quotes?codes=           복수 시세           ║
║  GET /api/us/quote/:symbol        미국주식 실시간     ║
║  GET /api/crypto/quote/:symbol    크립토 실시간       ║
║  GET /api/search?q=               종목 검색           ║
║  GET /api/alerts                  서버 알림 목록      ║
║  POST /api/alerts                 서버 알림 등록      ║
║  GET /api/alerts/check            조건 감시/텔레그램  ║
║                                                      ║
║  [국민연금 - DART]                                   ║
║  GET /api/nps?days=60             국민연금 변동 종목  ║
║  GET /api/nps/:corpCode           특정 종목 보유 이력 ║
║                                                      ║
║  [AI 시뮬레이션]                                     ║
║  POST /api/sim/judge              시그널 자동 채점    ║
║  POST /api/sim/stats              누적 통계 + 가중치  ║
║  POST /api/sim/score              신규 시그널 점수    ║
╠══════════════════════════════════════════════════════╣
║  분석: 경제명탐정 4·5주차 + 독개미 + 스펙터 통합     ║
║  자가학습: 시그널 채점 → 신호별 가중치 자동 조정     ║
╚══════════════════════════════════════════════════════╝
  `);
  if (!process.env.DART_API_KEY) {
    console.log("⚠️  DART_API_KEY 미설정 — /api/nps 엔드포인트 비활성");
    console.log("   .env에 DART_API_KEY=... 추가하세요.\n");
  }
});
