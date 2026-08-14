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
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { analyzeCandles } = require("./analysis.js");
const { buildPredictOptsFromCandles } = require("./lib/calendar/candle-meta");
const { fetchNpsChanges, fetchNpsForStock } = require("./dart.js");
const { judgeBatch, computeStats, computeWeights, scoreSignal } = require("./simulation.js");
const aiPredictor = require("./predictor.js");
const { buildTradeReport } = require("./trade.js");
const { buildMacroReport } = require("./macro.js");
const { volumeProfile, patternOutlook, buildCommentary } = require("./chartlab.js");
const cryptoReport = require("./crypto-report.js");
const apns = require("./apns.js");
const { buildLiqMap } = require("./liqmap.js");
const evolver = require("./evolve.js");
const dartFund = require("./dart-fund.js");
const { buildBtcCycle } = require("./btc-cycle.js");
const kbConfig = require("./kb/config.js");
const kbToken = require("./kb/token.js");
const kbBroker = require("./kb/broker.js");
const kbAuth = require("./kb/auth.js");
const kbDiagnostic = require("./kb/diagnostic.js");

const app = express();
app.disable("x-powered-by");
// Render 는 리버스 프록시 1홉. 로그인 Rate Limit·감사로그가 실제 클라이언트 IP를 쓰도록 한 번만 설정한다.
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
});
app.use(cors(kbAuth.corsOptionsDelegate));
app.use(express.json());

const isProduction = process.env.NODE_ENV === "production";

function requireAppAuth(req, res, next) {
  const expected = process.env.APP_API_KEY;
  if (!expected) {
    if (isProduction) {
      return res.status(503).json({ ok: false, error: "APP_API_KEY not configured" });
    }
    return next();
  }
  const key = req.headers["x-app-key"];
  if (key !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

const generalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  // iOS 앱은 화면당 여러 요청(시세+분석+예측+차트)을 병렬로 보내므로 60은 정상 사용에도 걸림
  max: Number(process.env.RATE_LIMIT_GENERAL || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AI || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "AI rate limit exceeded" },
});

app.use("/api", generalRateLimit);
app.use("/api/ai", aiRateLimit, requireAppAuth);
app.use("/api/alerts", requireAppAuth);
app.use("/api/sim", requireAppAuth);

// ── 단일 관리자 세션 인증 ────────────────────────────────────────
// 로그인 실패 기준: 동일 IP 15분에 5회. 성공 요청은 카운트하지 않는다.
const loginRateLimit = rateLimit(kbAuth.loginRateLimitOptions);
const requireAdminSession = kbAuth.requireAuth(["admin"]);

app.post("/api/auth/login", kbAuth.requireCsrf, loginRateLimit, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const loginId = typeof body.loginId === "string" ? body.loginId : typeof body.id === "string" ? body.id : "";
    const password = typeof body.password === "string" ? body.password : "";
    const result = await kbAuth.verifyAdminCredentials(loginId, password);
    if (!result.configured) {
      kbAuth.logAuthEvent("login_unconfigured", req);
      return res.status(503).json({ error: "관리자 인증이 설정되어 있지 않습니다." });
    }
    if (!result.ok) {
      kbAuth.logAuthEvent("login_failure", req);
      return res.status(401).json({ error: kbAuth.LOGIN_ERROR_MESSAGE });
    }
    const token = kbAuth.issueToken({ role: "admin" });
    const check = kbAuth.verifyToken(token);
    res.setHeader("Set-Cookie", kbAuth.buildSessionCookie(token));
    kbAuth.logAuthEvent("login_success", req);
    return res.json(kbAuth.sessionPublicPayload(check && check.ok ? check.payload : { name: kbAuth.ADMIN_DISPLAY_NAME }));
  } catch (e) {
    console.error("[auth] 로그인 처리 실패");
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

app.post("/api/auth/logout", kbAuth.requireCsrf, (req, res) => {
  const payload = kbAuth.optionalAuth(req);
  if (payload && payload.jti) kbAuth.revokeJti(payload.jti, payload.exp);
  res.setHeader("Set-Cookie", kbAuth.buildClearCookie());
  kbAuth.logAuthEvent("logout", req);
  return res.json({ authenticated: false });
});

app.get("/api/auth/session", (req, res) => {
  const payload = kbAuth.optionalAuth(req);
  return res.json(kbAuth.sessionPublicPayload(payload));
});

// KB 조회 API 는 라우터 그룹 단위로 인증한다. 개별 라우트에 다시 붙이지 않는다.
app.use("/api/broker", requireAdminSession);
app.use("/api/trading", requireAdminSession);
app.use("/api/trading", (req, res, next) => {
  const method = String(req.method || "").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (process.env.KBSEC_TRADING_ENABLED !== "true") {
    return res.status(403).json({ error: "주문 기능이 비활성화되어 있습니다." });
  }
  return next();
});

const KIS_BASE = process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443"; // 실전투자

let ACCESS_TOKEN = null;
let TOKEN_EXPIRES_AT = null;

function buildKisErrorPayload(err, label = "KIS") {
  const payload = {
    ok: false,
    label,
    error: err.message,
    status: err.response?.status || 500,
    hint:
      err.response?.status === 403
        ? "KIS 403 오류입니다. APP_KEY/APP_SECRET, 실전·모의 URL, TR_ID, 요청 파라미터, 계정 권한을 확인하세요."
        : "KIS 요청 중 오류가 발생했습니다.",
  };
  if (!isProduction) {
    payload.kisError = err.response?.data || null;
    payload.url = err.config?.url || null;
    payload.params = err.config?.params || null;
    payload.method = err.config?.method || null;
  }
  return payload;
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
    ...(isProduction ? {} : { kisError: payload.kisError }),
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
function fmtYmd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// KIS 일봉 API는 1회 최대 ~100봉(날짜 미지정 시 30봉)만 반환하므로
// 날짜 범위를 뒤로 옮겨가며 페이지네이션 (MACD·MA120 등 장기 지표에 필요)
async function fetchDailyCandles(code, count = 130) {
  const rows = [];
  const seen = new Set();
  let end = new Date();

  for (let page = 0; page < 5 && rows.length < count; page += 1) {
    const start = new Date(end.getTime() - 200 * 86400000);
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      "FHKST03010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: fmtYmd(start),
        FID_INPUT_DATE_2: fmtYmd(end),
        FID_PERIOD_DIV_CODE: "D",
        FID_ORG_ADJ_PRC: "1",
      }
    );
    const pageRows = (data.output2 || []).filter((c) => c && c.stck_bsop_date && !seen.has(c.stck_bsop_date));
    if (pageRows.length === 0) break;
    for (const c of pageRows) seen.add(c.stck_bsop_date);
    rows.push(...pageRows); // 각 페이지는 최신순 → 뒤로 갈수록 과거

    const oldest = pageRows[pageRows.length - 1].stck_bsop_date;
    const oldestDate = new Date(`${oldest.slice(0, 4)}-${oldest.slice(4, 6)}-${oldest.slice(6, 8)}T00:00:00Z`);
    end = new Date(oldestDate.getTime() - 86400000);
  }

  return rows.slice(0, count).map((c) => ({
    date: c.stck_bsop_date,
    open: parseInt(c.stck_oprc),
    high: parseInt(c.stck_hgpr),
    low: parseInt(c.stck_lwpr),
    close: parseInt(c.stck_clpr),
    volume: parseInt(c.acml_vol),
  }));
}

// ── 엔드포인트 ───────────────────────────────────────────────────

// 서버 상태 확인 (공개 — 최소 정보만 반환)
app.get("/api/health", async (req, res) => {
  if (isProduction) {
    return res.json({ status: "ok" });
  }
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
    const dailyPromise = lite ? Promise.resolve(null) : fetchDailyCandles(code, 260);
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
    let candles;
    if (period === "D") {
      // 일봉은 날짜 페이지네이션으로 요청 개수만큼 확보 (KIS는 1회 ~30봉만 반환)
      candles = await fetchDailyCandles(req.params.code, Math.min(parseInt(count) || 60, 300));
    } else {
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
      candles = (data.output2 || []).slice(0, parseInt(count)).map((c) => ({
        date: c.stck_bsop_date,
        open: parseInt(c.stck_oprc),
        high: parseInt(c.stck_hgpr),
        low: parseInt(c.stck_lwpr),
        close: parseInt(c.stck_clpr),
        volume: parseInt(c.acml_vol),
      }));
    }

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
    const candles = await fetchDailyCandles(code, 260);
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

// AI 상승/하락 확률 예측 (온라인 학습 — 호출이 쌓일수록 정확도 개선)
// 주의: /api/ai/* 는 APP_API_KEY 보호 구간이므로 /api/predict 로 분리 (Gemini 비용 없음)
// GET /api/predict/:code
app.get("/api/predict/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const candles = await fetchDailyCandles(code, 260);
    if (!candles || candles.length < 30) {
      return res.status(400).json({ error: "예측에 필요한 일봉 데이터가 부족합니다.", count: candles?.length || 0 });
    }
    const analysis = analyzeCandles(candles);
    const close = Number(candles[0]?.close) || 0;
    const prediction = aiPredictor.predict(code, analysis, close, buildPredictOptsFromCandles(candles));
    // 만기된 과거 예측 채점 + 가중치 자동 학습 (요청당 소량 처리)
    aiPredictor.processMatured((c, n) => fetchDailyCandles(c, n), { maxPerRun: 5 })
      .catch((e) => console.error("[ai-learn]", e.message));
    res.json({ code, ...prediction });
  } catch (err) {
    const payload = buildKisErrorPayload(err, "AI_PREDICT");
    console.error("[ai-predict]", payload);
    res.status(payload.status || 500).json(payload);
  }
});

// AI 모델 상태/성적표
// GET /api/predict-model
app.get("/api/predict-model", (req, res) => {
  try {
    res.json({ ok: true, ...aiPredictor.getModelStats() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// 특징 종목 스캐너 — 상승 전환·바닥 신호가 뜬 종목만 골라서 보여줌
// ═══════════════════════════════════════════════════════════════
// 스캔은 KIS 호출이 많아(종목당 ~3회) 백그라운드로 돌리고 30분 캐시.
const featuredCache = { at: 0, data: null, building: false };
const FEATURED_TTL_MS = 30 * 60 * 1000;
const FEATURED_SCAN_LIMIT = 30; // 마스터 앞쪽(큐레이션 주요 종목) N개만 스캔

function extractFeaturedSignals(code, name, sector, analysis, close) {
  const reasons = [];
  let kind = null; // bottom(바닥 신호) | turn(상승 전환)

  if (analysis.supertrend?.flipped && analysis.supertrend?.direction === 'up') {
    reasons.push('SuperTrend 상승 전환'); kind = 'turn';
  }
  if (analysis.divergence?.bullish) {
    reasons.push(`강세 다이버전스 (${analysis.divergence.bullish.indicators.join('·')})`); kind = kind || 'bottom';
  }
  if (analysis.stochasticSlow?.inWell) {
    reasons.push(`스토캐스틱 슬로우 우물 (K ${analysis.stochasticSlow.k})`); kind = kind || 'bottom';
  }
  if (analysis.vixFix?.spike) {
    reasons.push(`VixFix 공포 스파이크 ${analysis.vixFix.value}`); kind = kind || 'bottom';
  }
  if (analysis.stochHeatmap?.zone === 'bottom_paint') {
    reasons.push('히트맵 바닥 도배'); kind = kind || 'bottom';
  }
  if (analysis.painMeter?.bullDiv) {
    reasons.push('고통지수 바닥 다이버전스'); kind = kind || 'bottom';
  }
  if (analysis.bullBearPower?.zone === 'wave_bottom') {
    reasons.push(`파동 바닥권 (BBP ${analysis.bullBearPower.value})`); kind = kind || 'bottom';
  }
  if (analysis.macd?.cross === 'golden') {
    reasons.push('MACD 골든크로스'); kind = kind || 'turn';
  }
  if (analysis.ichimoku?.tkCross === 'bullish' && analysis.ichimoku?.status === 'above_cloud'
    && (analysis.minervini?.passed ?? 0) >= 7) {
    reasons.push(`미너비니 ${analysis.minervini.passed}/8 + 일목 정배열`); kind = kind || 'turn';
  }

  if (reasons.length === 0) return null;
  return {
    code, name, sector,
    price: close,
    kind,
    score: analysis.score,
    signalBadge: analysis.signalBadge,
    reasons,
  };
}

async function buildFeaturedSignals() {
  if (featuredCache.building) return;
  featuredCache.building = true;
  try {
    const universe = KRX_MASTER_ALL.slice(0, FEATURED_SCAN_LIMIT);
    const found = [];
    for (const stock of universe) {
      try {
        const candles = await fetchDailyCandles(stock.code, 260);
        if (!candles || candles.length < 60) continue;
        const analysis = analyzeCandles(candles);
        const item = extractFeaturedSignals(stock.code, stock.name, stock.sector, analysis, Number(candles[0]?.close) || 0);
        if (item) found.push(item);
      } catch (e) {
        // 개별 종목 실패는 건너뜀
      }
    }
    found.sort((a, b) => b.reasons.length - a.reasons.length || b.score - a.score);
    featuredCache.data = {
      ok: true,
      scanned: universe.length,
      count: found.length,
      updatedAt: new Date().toISOString(),
      results: found,
      disclaimer: '기술적 신호 기반 참고 정보이며 투자 권유가 아닙니다.',
    };
    featuredCache.at = Date.now();
  } finally {
    featuredCache.building = false;
  }
}

// GET /api/signals/featured — 캐시 반환, 만료 시 백그라운드 재스캔
app.get("/api/signals/featured", (req, res) => {
  const stale = Date.now() - featuredCache.at > FEATURED_TTL_MS;
  if (stale && !featuredCache.building) {
    buildFeaturedSignals().catch((e) => console.error("[featured]", e.message));
  }
  if (featuredCache.data) {
    return res.json({ ...featuredCache.data, refreshing: stale });
  }
  res.json({ ok: true, building: true, results: [], message: "첫 스캔 진행 중 — 1~2분 후 다시 요청하세요." });
});

// ═══════════════════════════════════════════════════════════════
// 시그널 히스토리 — 과거 일봉에서 발생한 매매 신호 이벤트 (KospiAI 이식)
// GET /api/signals/history/:code
// ═══════════════════════════════════════════════════════════════
app.get("/api/signals/history/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "잘못된 종목코드" });
    const raw = await fetchDailyCandles(code, 320);
    // 과거→현재 순으로 정렬
    const candles = [...raw].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (candles.length < 60) {
      return res.json({ ok: true, code, events: [], note: "데이터 부족" });
    }
    const closes = candles.map((c) => Number(c.close));

    const smaAt = (idx, period) => {
      if (idx + 1 < period) return null;
      let s = 0;
      for (let i = idx - period + 1; i <= idx; i += 1) s += closes[i];
      return s / period;
    };
    // RSI 시리즈 (와일더 방식)
    const rsiSeries = new Array(closes.length).fill(null);
    if (closes.length > 15) {
      let gain = 0; let loss = 0;
      for (let i = 1; i <= 14; i += 1) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) gain += d; else loss -= d;
      }
      let avgG = gain / 14; let avgL = loss / 14;
      rsiSeries[14] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      for (let i = 15; i < closes.length; i += 1) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * 13 + Math.max(d, 0)) / 14;
        avgL = (avgL * 13 + Math.max(-d, 0)) / 14;
        rsiSeries[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      }
    }

    const fmtDate = (d) => {
      const s = String(d).replace(/[^0-9]/g, "");
      return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(d);
    };
    const events = [];
    for (let i = 1; i < candles.length; i += 1) {
      const price = closes[i];
      const date = fmtDate(candles[i].date);
      // 골든/데드크로스 50/200
      const a50 = smaAt(i, 50); const a200 = smaAt(i, 200);
      const p50 = smaAt(i - 1, 50); const p200 = smaAt(i - 1, 200);
      if (a50 && a200 && p50 && p200) {
        if (p50 <= p200 && a50 > a200) events.push({ date, type: "bull", label: "골든크로스 (50/200일선)", price });
        if (p50 >= p200 && a50 < a200) events.push({ date, type: "bear", label: "데드크로스 (50/200일선)", price });
      }
      // 20일선 상향/하향 돌파
      const a20 = smaAt(i, 20); const p20 = smaAt(i - 1, 20);
      if (a20 && p20) {
        if (closes[i - 1] <= p20 && price > a20) events.push({ date, type: "bull", label: "20일선 상향 돌파", price });
        if (closes[i - 1] >= p20 && price < a20) events.push({ date, type: "bear", label: "20일선 하향 이탈", price });
      }
      // RSI 과매도 탈출 / 과매수 이탈
      const r = rsiSeries[i]; const rp = rsiSeries[i - 1];
      if (r !== null && rp !== null) {
        if (rp < 30 && r >= 30) events.push({ date, type: "bull", label: `RSI 과매도 탈출 (${Math.round(r)})`, price });
        if (rp > 70 && r <= 70) events.push({ date, type: "bear", label: `RSI 과매수 이탈 (${Math.round(r)})`, price });
      }
    }
    res.json({ ok: true, code, count: events.length, events: events.slice(-20).reverse() });
  } catch (err) {
    console.error("[signals/history]", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// 섹터 히트맵 — 업종별 대표 종목 등락률 집계 (KospiAI 이식)
// GET /api/sector/heatmap
// ═══════════════════════════════════════════════════════════════
const sectorHeatCache = { at: 0, data: null, building: false };
const SECTOR_HEAT_TTL_MS = 10 * 60 * 1000;

async function buildSectorHeatmap() {
  if (sectorHeatCache.building) return;
  sectorHeatCache.building = true;
  try {
    // 업종별 대표 2종목 — 큐레이션 마스터(대분류 업종)만 사용
    // KIND 병합본은 세분류(200개+)라 히트맵이 지나치게 쪼개짐
    const bySector = new Map();
    for (const x of KRX_MASTER_DB) {
      const sector = x.sector;
      if (!sector || sector === "ETF·분류") continue;
      if (!bySector.has(sector)) bySector.set(sector, []);
      const arr = bySector.get(sector);
      if (arr.length < 2) arr.push(x);
    }
    const sectors = [];
    for (const [sector, stocks] of bySector) {
      const rows = await Promise.allSettled(stocks.map(async (s) => {
        const q = await kisGet(
          "/uapi/domestic-stock/v1/quotations/inquire-price",
          "FHKST01010100",
          { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: s.code }
        );
        return { code: s.code, name: s.name, rate: parseFloat(q.output?.prdy_ctrt) };
      }));
      const ok = rows.filter((r) => r.status === "fulfilled" && Number.isFinite(r.value.rate)).map((r) => r.value);
      if (!ok.length) continue;
      const avg = ok.reduce((s, r) => s + r.rate, 0) / ok.length;
      sectors.push({
        sector,
        changeRate: Math.round(avg * 100) / 100,
        leaders: ok.map((r) => ({ code: r.code, name: r.name, changeRate: r.rate })),
      });
      await new Promise((r) => setTimeout(r, 250)); // KIS 호출 속도 완화
    }
    sectors.sort((a, b) => b.changeRate - a.changeRate);
    sectorHeatCache.data = { ok: true, updatedAt: new Date().toISOString(), sectors };
    sectorHeatCache.at = Date.now();
  } catch (e) {
    console.error("[sector/heatmap]", e.message);
  } finally {
    sectorHeatCache.building = false;
  }
}

app.get("/api/sector/heatmap", (req, res) => {
  const stale = Date.now() - sectorHeatCache.at > SECTOR_HEAT_TTL_MS;
  if (stale && !sectorHeatCache.building) buildSectorHeatmap();
  if (sectorHeatCache.data) return res.json({ ...sectorHeatCache.data, refreshing: stale });
  res.json({ ok: true, building: true, sectors: [], message: "업종 등락 집계 중 — 잠시 후 다시 요청하세요." });
});

// ═══════════════════════════════════════════════════════════════
// 유망 업종 트렌드 — 기간별(1주/1개월/3개월) 수익률 + 수출 실적 연계 TOP5
// GET /api/sector/trends
// ═══════════════════════════════════════════════════════════════
const sectorTrendCache = { at: 0, data: null, building: false };
const SECTOR_TREND_TTL_MS = 60 * 60 * 1000;

async function buildSectorTrends() {
  if (sectorTrendCache.building) return;
  sectorTrendCache.building = true;
  try {
    const bySector = new Map();
    for (const x of KRX_MASTER_DB) {
      if (!x.sector || x.sector === "ETF·분류") continue;
      if (!bySector.has(x.sector)) bySector.set(x.sector, []);
      const arr = bySector.get(x.sector);
      if (arr.length < 2) arr.push(x);
    }

    // 수출 실적 연계: 리포트 캐시의 품목별 YoY를 업종에 매핑
    let exportBoost = new Map();
    try {
      const report = await buildTradeReport();
      for (const hint of report.sectorHints || []) {
        const cat = (report.categories || []).find((c) => String(c.name).includes(hint.category.slice(0, 3)));
        if (cat && cat.exportsYoY !== null && cat.exportsYoY > 5) {
          exportBoost.set(hint.sector, { category: cat.name, yoy: cat.exportsYoY });
        }
      }
    } catch { /* 수출 데이터 없으면 생략 */ }

    const rows = [];
    for (const [sector, stocks] of bySector) {
      const rets = { w1: [], m1: [], m3: [] };
      for (const s of stocks) {
        try {
          const candles = await fetchDailyCandles(s.code, 70);
          const newest = [...candles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
          const close = Number(newest[0]?.close);
          const at = (n) => Number(newest[Math.min(n, newest.length - 1)]?.close);
          if (!close) continue;
          if (at(5)) rets.w1.push((close / at(5) - 1) * 100);
          if (at(21)) rets.m1.push((close / at(21) - 1) * 100);
          if (at(63)) rets.m3.push((close / at(63) - 1) * 100);
        } catch { /* 개별 실패 무시 */ }
        await new Promise((r) => setTimeout(r, 150));
      }
      const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
      const row = {
        sector,
        ret1w: avg(rets.w1),
        ret1m: avg(rets.m1),
        ret3m: avg(rets.m3),
        leaders: stocks.map((s) => ({ code: s.code, name: s.name })),
      };
      const boost = exportBoost.get(sector);
      if (boost) row.exportNote = `수출 ${boost.category} +${boost.yoy}%`;
      rows.push(row);
    }

    // 순위 점수: 1개월 50% + 1주 30% + 3개월 20% + 수출 보너스
    const score = (r) => (r.ret1m ?? 0) * 0.5 + (r.ret1w ?? 0) * 0.3 + (r.ret3m ?? 0) * 0.2 + (r.exportNote ? 1.5 : 0);
    rows.sort((a, b) => score(b) - score(a));
    const top = rows.slice(0, 5).map((r, i) => ({
      rank: i + 1,
      ...r,
      reason: [
        r.ret1m !== null ? `1개월 ${r.ret1m > 0 ? "+" : ""}${r.ret1m}%` : null,
        r.ret1w !== null ? `1주 ${r.ret1w > 0 ? "+" : ""}${r.ret1w}%` : null,
        r.exportNote || null,
      ].filter(Boolean).join(" · "),
    }));

    sectorTrendCache.data = {
      ok: true,
      updatedAt: new Date().toISOString(),
      top,
      all: rows,
      note: "업종 대표 종목 기준 기간별 평균 수익률 — 수출 호조 업종은 보너스 반영 (참고용)",
    };
    sectorTrendCache.at = Date.now();
  } catch (e) {
    console.error("[sector/trends]", e.message);
  } finally {
    sectorTrendCache.building = false;
  }
}

app.get("/api/sector/trends", (req, res) => {
  const stale = Date.now() - sectorTrendCache.at > SECTOR_TREND_TTL_MS;
  if (stale && !sectorTrendCache.building) buildSectorTrends();
  if (sectorTrendCache.data) return res.json({ ...sectorTrendCache.data, refreshing: stale });
  res.json({ ok: true, building: true, top: [], all: [], message: "업종 트렌드 집계 중 — 1~2분 후 다시 요청하세요." });
});

// ═══════════════════════════════════════════════════════════════
// 실적(매출·영업이익) — 3개년/분기 실적 + 실적 점수 + 관심종목 실적 알림
// ═══════════════════════════════════════════════════════════════
app.get("/api/fundamentals/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "잘못된 종목코드" });
    const data = await dartFund.getFundamentals(code);
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// 앱이 관심종목을 등록하면 서버가 실적 공시를 감시해 푸시로 알림
app.post("/api/watchlist", (req, res) => {
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
  res.json({ ok: true, ...dartFund.registerWatchlist(codes) });
});

app.get("/api/watchlist", (req, res) => {
  res.json({ ok: true, codes: dartFund.getWatchlist() });
});

// ═══════════════════════════════════════════════════════════════
// 트럼프 정책/미디어 관찰 뉴스 — 관세·TMTG(트루스소셜) 등 시장 영향 이슈
// GET /api/news/trump
// ═══════════════════════════════════════════════════════════════
let trumpNewsCache = { at: 0, data: null };
app.get("/api/news/trump", async (req, res) => {
  try {
    if (trumpNewsCache.data && Date.now() - trumpNewsCache.at < 15 * 60 * 1000) {
      return res.json(trumpNewsCache.data);
    }
    const topics = [
      { topic: "트럼프 정책·관세", query: "트럼프 관세 증시" },
      { topic: "트럼프 미디어(TMTG)", query: "트럼프 미디어 테크놀로지 트루스소셜" },
    ];
    const out = [];
    for (const t of topics) {
      const items = await cryptoReport.fetchGoogleNews(t.query, 5).catch(() => []);
      if (items.length) out.push({ topic: t.topic, items });
    }
    const result = { ok: out.length > 0, topics: out, updatedAt: new Date().toISOString() };
    if (result.ok) trumpNewsCache = { at: Date.now(), data: result };
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AI 수출입 연계 저평가 종목 — 수출 주력 품목 업종에서 저평가 후보 추출
// ═══════════════════════════════════════════════════════════════
const tradePicksCache = { at: 0, data: null, building: false };
const TRADE_PICKS_TTL_MS = 6 * 60 * 60 * 1000;

async function buildTradePicks() {
  if (tradePicksCache.building) return;
  tradePicksCache.building = true;
  try {
    const tradeReport = await buildTradeReport();
    const hints = tradeReport.sectorHints || [];
    const exportTrend = tradeReport.trend; // increase | decrease | flat
    const picks = [];

    for (const hint of hints.slice(0, 6)) {
      const sectorStocks = KRX_MASTER_ALL
        .filter((x) => x.sector === hint.sector)
        .slice(0, 3);
      for (const stock of sectorStocks) {
        try {
          const quoteData = await kisGet(
            "/uapi/domestic-stock/v1/quotations/inquire-price",
            "FHKST01010100",
            { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stock.code }
          );
          const o = quoteData.output;
          const per = parseFloat(o.per) || null;
          const pbr = parseFloat(o.pbr) || null;
          const price = parseInt(o.stck_prpr) || 0;
          const changeRate = parseFloat(o.prdy_ctrt) || 0;
          const w52High = parseInt(o.w52_hgpr) || null;
          const w52Pos = w52High && price ? Math.round((price / w52High) * 100) : null;

          // 저평가 점수: PER·PBR 낮을수록 + 52주 고점 대비 낮을수록
          let valueScore = 50;
          if (per !== null && per > 0) valueScore += per < 8 ? 20 : per < 12 ? 12 : per < 20 ? 4 : -8;
          if (pbr !== null && pbr > 0) valueScore += pbr < 0.8 ? 18 : pbr < 1.2 ? 10 : pbr < 2 ? 2 : -6;
          if (w52Pos !== null) valueScore += w52Pos < 60 ? 12 : w52Pos < 80 ? 6 : -4;

          picks.push({
            code: stock.code,
            name: stock.name,
            sector: hint.sector,
            category: hint.category,
            categoryNote: hint.note,
            price,
            changeRate,
            per,
            pbr,
            w52Pos,
            valueScore: Math.max(0, Math.min(100, valueScore)),
          });
        } catch {
          // skip
        }
      }
    }

    picks.sort((a, b) => b.valueScore - a.valueScore);
    tradePicksCache.data = {
      ok: true,
      exportTrend,
      basis: exportTrend === 'increase'
        ? '수출 증가 국면 — 수출 주력 품목 연계 업종의 저평가 후보'
        : '수출 주력 품목 연계 업종의 저평가 후보 (수출 국면 참고)',
      updatedAt: new Date().toISOString(),
      results: picks.slice(0, 12),
      disclaimer: 'PER·PBR 기반 참고 정보이며 투자 권유가 아닙니다.',
    };
    tradePicksCache.at = Date.now();
  } finally {
    tradePicksCache.building = false;
  }
}

// GET /api/trade/picks — 수출입 연계 저평가 후보
app.get("/api/trade/picks", (req, res) => {
  const stale = Date.now() - tradePicksCache.at > TRADE_PICKS_TTL_MS;
  if (stale && !tradePicksCache.building) {
    buildTradePicks().catch((e) => console.error("[trade-picks]", e.message));
  }
  if (tradePicksCache.data) {
    return res.json({ ...tradePicksCache.data, refreshing: stale });
  }
  res.json({ ok: true, building: true, results: [], message: "분석 진행 중 — 잠시 후 다시 요청하세요." });
});

// ═══════════════════════════════════════════════════════════════
// 암호화폐 관찰 리포트 — 차트 분석 + 업황 + 규제(CLARITY 법안 등) 뉴스
// ═══════════════════════════════════════════════════════════════
const cryptoReportCache = { at: 0, data: null };
const CRYPTO_REPORT_TTL_MS = 30 * 60 * 1000;

// GET /api/crypto/report
app.get("/api/crypto/report", async (req, res) => {
  try {
    if (cryptoReportCache.data && Date.now() - cryptoReportCache.at < CRYPTO_REPORT_TTL_MS) {
      return res.json(cryptoReportCache.data);
    }

    // 1) BTC·ETH 차트 분석 (Yahoo 일봉 → 국내 주식과 동일한 분석 엔진)
    const markets = [];
    for (const symbol of ["BTC", "ETH"]) {
      try {
        const candles = await fetchYahooChart(symbol, "crypto", "D", "2Y", 400);
        if (!Array.isArray(candles) || candles.length < 60) continue;
        const newest = [...candles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const analysis = analyzeCandles(newest);
        const close = Number(newest[0]?.close) || 0;
        const prevClose = Number(newest[1]?.close) || 0;
        markets.push({
          symbol,
          price: close,
          changeRate: prevClose ? Math.round(((close - prevClose) / prevClose) * 1000) / 10 : null,
          score: analysis.score,
          grade: analysis.grade,
          signalBadge: analysis.signalBadge,
          signals: (analysis.signals || []).slice(0, 6),
          macd: analysis.macd,
          ichimoku: analysis.ichimoku ? { status: analysis.ichimoku.status, tkCross: analysis.ichimoku.tkCross } : null,
          supertrend: analysis.supertrend,
          mayer: analysis.mayer,
          summary: analysis.summary,
        });
      } catch (e) {
        console.error(`[crypto-report:${symbol}]`, e.message);
      }
    }

    // 2) 업황 + 3) 규제 뉴스 + 4) BTC 사이클 진단 (병렬)
    const [fearGreed, globalData, regulation, btcCycle] = await Promise.all([
      cryptoReport.fetchFearGreed().catch(() => null),
      cryptoReport.fetchGlobalCrypto(),
      cryptoReport.fetchRegulationNews().catch(() => []),
      buildBtcCycle().catch((e) => { console.error("[btc-cycle]", e.message); return null; }),
    ]);

    const report = {
      ok: true,
      updatedAt: new Date().toISOString(),
      markets,
      sentiment: fearGreed,
      global: globalData,
      regulation,
      btcCycle,
      disclaimer: "본 리포트는 투자 참고용 정보이며 투자 권유가 아닙니다.",
    };
    // 부분 실패(규제 뉴스·업황 누락) 시 짧은 캐시로 곧 재시도
    const partial = !regulation.length || !fearGreed;
    cryptoReportCache.at = partial ? Date.now() - CRYPTO_REPORT_TTL_MS + 3 * 60 * 1000 : Date.now();
    cryptoReportCache.data = report;
    res.json(report);
  } catch (err) {
    console.error("[crypto-report]", err.message);
    res.status(502).json({ ok: false, error: "암호화폐 리포트 생성 실패: " + err.message });
  }
});

// 악시오스 뉴스 (대시보드용)
// GET /api/news/axios
app.get("/api/news/axios", async (req, res) => {
  try {
    const news = await cryptoReport.fetchAxiosNews(8);
    res.json(news);
  } catch (err) {
    res.status(502).json({ ok: false, error: "뉴스 조회 실패: " + err.message });
  }
});

// 미국주식/코인 기술 분석 — 국내 주식과 동일한 분석 엔진 (Yahoo 캔들)
// GET /api/global/analyze/:symbol?type=us|crypto
app.get("/api/global/analyze/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    const type = req.query.type || (["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB"].includes(symbol) ? "crypto" : "us");
    const candles = type === "crypto"
      ? await fetchCryptoCandles(symbol, "D", "2Y", 400)
      : await fetchYahooChart(symbol, type, "D", "2Y", 400);
    if (!Array.isArray(candles) || candles.length < 30) {
      return res.status(400).json({ ok: false, error: "분석에 필요한 일봉 데이터가 부족합니다.", count: candles?.length || 0 });
    }
    const newest = [...candles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const analysis = analyzeCandles(newest);
    res.json({ ok: true, code: symbol, type, candleCount: newest.length, lastDate: newest[0]?.date, analysis });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: "글로벌 분석 실패: " + err.message });
  }
});

// 차트 랩 — 매물대·과거 유사 패턴 전망·전 지표 분석·자동 해설
// GET /api/chartlab/:code            (국내 주식, KIS)
// GET /api/chartlab/:code?type=us|crypto  (미국주식/코인, Yahoo)
app.get("/api/chartlab/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const type = String(req.query.type || "kr").toLowerCase();
    let candles;
    if (type === "us" || type === "crypto") {
      const raw = type === "crypto"
        ? await fetchCryptoCandles(code.toUpperCase(), "D", "2Y", 400)
        : await fetchYahooChart(code.toUpperCase(), type, "D", "2Y", 400);
      candles = [...(raw || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))); // 최신순
    } else {
      candles = await fetchDailyCandles(code, 400); // 유사 패턴 검색용 장기 데이터
    }
    if (!candles || candles.length < 60) {
      return res.status(400).json({ ok: false, error: "차트 랩에 필요한 일봉 데이터가 부족합니다.", count: candles?.length || 0 });
    }
    const analysis = analyzeCandles(candles);
    const close = Number(candles[0]?.close) || 0;
    const profile = volumeProfile(candles);
    const outlook = patternOutlook(candles);
    const commentary = buildCommentary({ analysis, profile, outlook, close });
    res.json({
      ok: true,
      code,
      close,
      candleCount: candles.length,
      analysis,
      volumeProfile: profile,
      outlook,
      commentary,
    });
  } catch (err) {
    const payload = buildKisErrorPayload(err, "CHARTLAB");
    console.error("[chartlab]", payload);
    res.status(payload.status || 500).json(payload);
  }
});

// 실시간 환율 — 원/달러 · 원/엔(100엔) (Yahoo, 30초 캐시)
// GET /api/fx
const fxCache = { at: 0, data: null };
app.get("/api/fx", async (req, res) => {
  try {
    if (fxCache.data && Date.now() - fxCache.at < 30 * 1000) {
      return res.json(fxCache.data);
    }
    const [usd, jpy] = await Promise.all([
      fetchYahooQuote("KRW=X"),
      fetchYahooQuote("JPYKRW=X"),
    ]);
    const result = {
      ok: true,
      updatedAt: new Date().toISOString(),
      usdKrw: {
        price: Math.round((usd.price || 0) * 100) / 100,
        changeRate: usd.changeRate ?? null,
        changeStr: usd.changeStr ?? null,
      },
      jpy100Krw: {
        // 원/엔은 100엔 기준 표기가 관례
        price: Math.round((jpy.price || 0) * 100 * 100) / 100,
        changeRate: jpy.changeRate ?? null,
        changeStr: jpy.changeStr ?? null,
      },
    };
    fxCache.at = Date.now();
    fxCache.data = result;
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: "환율 조회 실패: " + err.message });
  }
});

// 거시경제 지표 (FRED 공개 데이터 — CPI·금리·연준 유동성·VIX·달러)
// GET /api/macro/indicators
app.get("/api/macro/indicators", async (req, res) => {
  try {
    const report = await buildMacroReport();
    res.json(report);
  } catch (err) {
    console.error("[macro]", err.message);
    res.status(502).json({ ok: false, error: "거시 지표 조회 실패: " + err.message });
  }
});

// 한국 수출입 리포트 (총괄: FRED 공개 데이터, 품목별: 관세청 API 키 설정 시)
// GET /api/trade/report
app.get("/api/trade/report", async (req, res) => {
  try {
    const report = await buildTradeReport();
    res.json(report);
  } catch (err) {
    console.error("[trade-report]", err.message);
    res.status(502).json({ ok: false, error: "수출입 데이터 조회 실패: " + err.message });
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
            const candles = await fetchDailyCandles(trimmed, 260);
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
        name: o.hts_kor_isnm || KRX_NAME_BY_CODE.get(codes[i].trim()) || null,
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

// 호가창 — 체결 단가별 매도/매수 잔량 (KIS 주식현재가 호가/예상체결)
// GET /api/orderbook/:code
app.get("/api/orderbook/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "잘못된 종목코드" });
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
      "FHKST01010200",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
    );
    const o = data.output1 || {};
    const levels = [];
    for (let i = 1; i <= 10; i += 1) {
      levels.push({
        level: i,
        askPrice: Number(o[`askp${i}`]) || 0,
        askVolume: Number(o[`askp_rsqn${i}`]) || 0,
        bidPrice: Number(o[`bidp${i}`]) || 0,
        bidVolume: Number(o[`bidp_rsqn${i}`]) || 0,
      });
    }
    const totalAsk = Number(o.total_askp_rsqn) || 0;
    const totalBid = Number(o.total_bidp_rsqn) || 0;
    res.json({
      ok: true,
      code,
      time: o.aspr_acpt_hour || null,
      levels,
      totalAskVolume: totalAsk,
      totalBidVolume: totalBid,
      // 매수/매도 잔량 비율 — 1보다 크면 매수 대기 물량 우위
      bidAskRatio: totalAsk ? Math.round((totalBid / totalAsk) * 100) / 100 : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[orderbook]", err.message);
    res.status(502).json({ ok: false, error: err.message });
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
  },
  {
    "code": "170900",
    "name": "동아에스티",
    "tag": "제약/바이오",
    "sector": "바이오",
    "market": "KOSPI",
    "indexes": []
  },
  {
    "code": "045660",
    "name": "에이텍",
    "tag": "IT/금융단말",
    "sector": "IT",
    "market": "KOSDAQ",
    "indexes": []
  },
  {
    "code": "224110",
    "name": "에이텍모빌리티",
    "tag": "교통카드/모빌리티",
    "sector": "IT",
    "market": "KOSDAQ",
    "indexes": []
  }
];

// Enriched KOSPI/KOSDAQ catalog (sector/industry + market correction)
let KRX_MASTER_ALL = KRX_MASTER_DB;
try {
  const mergedPath = path.join(__dirname, "data/krx-master-merged.json");
  if (fs.existsSync(mergedPath)) {
    const merged = JSON.parse(fs.readFileSync(mergedPath, "utf8"));
    if (Array.isArray(merged) && merged.length >= KRX_MASTER_DB.length) {
      KRX_MASTER_ALL = merged;
      console.log(`[master] loaded enriched catalog: ${merged.length} symbols`);
    }
  }
} catch (e) {
  console.warn("[master] enriched catalog load failed:", e.message);
}

// 종목코드 → 종목명 (KIS 현재가 API는 종목명을 주지 않으므로 마스터에서 보충)
const KRX_NAME_BY_CODE = new Map(KRX_MASTER_ALL.map((x) => [x.code, x.name]));

function normalizeMarketFilter(market = "ALL") {
  const m = String(market || "ALL").toUpperCase();
  return m === "KOSPI" || m === "KOSDAQ" ? m : "ALL";
}

function scoreKrxRow(x, query) {
  const name = normalizeKrQuery(x.name);
  const code = String(x.code || "");
  const tag = normalizeKrQuery(`${x.tag || ""}${x.sector || ""}${x.industry || ""}${x.market || ""}${(x.indexes || []).join("")}`);
  let score = 0;
  if (code === query) score += 1000;
  if (code.startsWith(query)) score += 500;
  if (name === query) score += 900;
  if (name.startsWith(query)) score += 500;
  if (name.includes(query)) score += 300;
  if (tag.includes(query)) score += 100;
  return score;
}

function filterKrxMaster({ market, sector, industry, q } = {}) {
  let rows = KRX_MASTER_ALL;
  const mkt = normalizeMarketFilter(market);
  if (mkt !== "ALL") {
    rows = rows.filter((x) => String(x.market || "").toUpperCase() === mkt);
  }
  if (sector) {
    const s = normalizeKrQuery(sector);
    rows = rows.filter((x) => {
      const val = normalizeKrQuery(x.sector || "");
      return val === s || val.includes(s);
    });
  }
  if (industry) {
    const s = normalizeKrQuery(industry);
    rows = rows.filter((x) => {
      const val = normalizeKrQuery(x.industry || x.tag || "");
      return val === s || val.includes(s);
    });
  }
  const query = normalizeKrQuery(q);
  if (query) {
    rows = rows
      .map((x) => ({ ...x, score: scoreKrxRow(x, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"))
      .map(({ score, ...x }) => x);
  } else {
    rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return rows;
}

function listMasterSectors({ market = "ALL", type = "sector" } = {}) {
  const rows = filterKrxMaster({ market });
  const pick = type === "industry"
    ? (x) => x.industry || x.tag || "기타"
    : (x) => x.sector || "기타";
  const map = new Map();
  rows.forEach((x) => {
    const key = pick(x) || "기타";
    if (!map.has(key)) {
      map.set(key, { name: key, count: 0, kospi: 0, kosdaq: 0 });
    }
    const bucket = map.get(key);
    bucket.count += 1;
    if (String(x.market || "").toUpperCase() === "KOSDAQ") bucket.kosdaq += 1;
    else bucket.kospi += 1;
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

function normalizeKrQuery(q = "") {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[㈜주식회사\(\)\[\]\-_.]/g, "");
}

function searchKrxMaster(q = "", limit = 20, filters = {}) {
  const query = normalizeKrQuery(q);
  const base = filterKrxMaster({
    market: filters.market,
    sector: filters.sector,
    industry: filters.industry,
  });

  if (!query) return base.slice(0, limit);

  const aliasMap = {
    "동아에스티": ["동아st", "동아에스티", "동아 에스티", "donga st", "dong-a st", "dongaest"],
    "에이텍": ["에이텍", "atec", "a-tech", "에이텍컴퓨터"],
    "에이텍모빌리티": ["에이텍모빌리티", "atec mobility", "에이텍 모빌리티"],
    "롯데정밀화학": ["롯데정밀화학", "롯데 정밀화학", "lotte fine chemical", "lottefinechemical"],
  };

  const scored = base.map((x) => {
    const name = normalizeKrQuery(x.name);
    const code = String(x.code || "");
    const tag = normalizeKrQuery(`${x.tag || ""}${x.sector || ""}${x.industry || ""}${x.market || ""}${(x.indexes || []).join("")}`);
    const aliases = (aliasMap[x.name] || []).map(normalizeKrQuery).join(" ");
    let score = scoreKrxRow(x, query);
    if (aliases.includes(query)) score += 650;
    if (tag.includes(query)) score += 100;
    if (name.includes(query) && score === 0) score += 300;
    return { ...x, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));

  return scored.slice(0, limit).map(({ score, ...x }) => x);
}

app.get("/api/master/search", (req, res) => {
  const q = req.query.q || "";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const filters = {
    market: req.query.market,
    sector: req.query.sector,
    industry: req.query.industry,
  };
  const results = searchKrxMaster(q, limit, filters);
  res.json({
    ok: true,
    q,
    ...filters,
    count: results.length,
    results,
    source: "server KRX master cache",
  });
});

app.get("/api/master/sectors", (req, res) => {
  const market = req.query.market || "ALL";
  const type = req.query.type || "sector";
  const sectors = listMasterSectors({ market, type });
  res.json({
    ok: true,
    market: normalizeMarketFilter(market),
    type,
    totalSymbols: filterKrxMaster({ market }).length,
    count: sectors.length,
    sectors,
  });
});

app.get("/api/master/by-sector", (req, res) => {
  const sector = String(req.query.sector || req.query.industry || "").trim();
  const type = req.query.type || (req.query.industry ? "industry" : "sector");
  const market = req.query.market || "ALL";
  const sort = String(req.query.sort || "name").toLowerCase();
  const q = req.query.q || "";
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

  if (!sector) {
    return res.status(400).json({ ok: false, error: "sector 또는 industry 파라미터가 필요합니다." });
  }

  const filterKey = type === "industry" ? "industry" : "sector";
  let rows = filterKrxMaster({
    market,
    [filterKey]: sector,
    q,
  });

  if (sort === "code") {
    rows.sort((a, b) => a.code.localeCompare(b.code));
  } else if (sort === "marketcap") {
    rows.sort((a, b) => (Number(b.marketCap) || 0) - (Number(a.marketCap) || 0));
  } else {
    rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }

  rows = rows.slice(0, limit);
  res.json({
    ok: true,
    sector,
    type,
    market: normalizeMarketFilter(market),
    sort,
    q,
    count: rows.length,
    results: rows,
  });
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
  let rows = KRX_MASTER_ALL;
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

    const generationConfig = {
      maxOutputTokens: maxTokens,
      temperature: 0.35,
    };
    // 2.5 계열은 기본적으로 내부 사고(thinking)에 토큰을 소모해
    // maxOutputTokens를 다 써버리고 답변이 잘림 → 사고 기능 비활성화
    if (/2\.5/.test(model)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

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
      generationConfig,
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

// ── 자체 발굴 기법 (유전 알고리즘 진화) ──
// GET /api/evolve/strategies — 현재 세대의 우수 발굴 기법 목록
app.get("/api/evolve/strategies", (req, res) => {
  res.json(evolver.getStrategies());
});

// GET /api/evolve/apply/:code — 이 종목에서 지금 발동 중인 발굴 기법
app.get("/api/evolve/apply/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "잘못된 종목코드" });
    const candles = await fetchDailyCandles(code, 260);
    const newest = [...candles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const analysis = analyzeCandles(newest);
    const close = Number(newest[0]?.close);
    res.json({ code, ...evolver.applyToAnalysis(analysis, close) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── 예상 청산 분포 (청산맵 추정) ──
// GET /api/crypto/liqmap/:symbol — 현재가 위/아래 청산 밀집 구간 추정
app.get("/api/crypto/liqmap/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "BTC").toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(symbol)) return res.status(400).json({ ok: false, error: "잘못된 심볼" });
    const data = await buildLiqMap(symbol);
    res.json(data);
  } catch (err) {
    console.error("[liqmap]", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── APNs 원격 푸시 ──
// POST /api/push/register  { token }  — 앱이 실행될 때마다 디바이스 토큰 등록
app.post("/api/push/register", (req, res) => {
  try {
    const result = apns.registerToken(req.body?.token);
    res.json({ ok: true, ...result, configured: apns.isConfigured() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/push/test — 등록된 모든 기기로 테스트 푸시
app.post("/api/push/test", async (req, res) => {
  const result = await apns.sendPushToAll({
    title: "ALPHA TRADING",
    body: req.body?.text || "✅ 푸시 알림 테스트입니다. 이 알림이 보이면 정상 동작합니다.",
  });
  res.json(result);
});

app.get("/api/push/status", (req, res) => {
  res.json({ ok: true, configured: apns.isConfigured(), devices: apns.tokenCount() });
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
    if (isProduction && !secret) {
      return res.status(503).json({ ok: false, error: "ALERT_CHECK_SECRET required in production" });
    }
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
          // APNs 푸시도 함께 발송 (등록 기기 + 페어링된 Apple Watch 미러링)
          const push = await apns.sendPushToAll({
            title: `${alert.name || quote.name || alert.code} 알림`,
            body: message.replace(/\n+/g, " ").slice(0, 160),
          }).catch((e) => ({ ok: false, error: e.message }));
          const updated = {
            ...alert,
            triggered: true,
            lastSentAt: new Date().toISOString(),
            lastPrice: quote.price,
            lastBasis: evalResult.basis,
          };
          next.push(updated);
          results.push({ id: alert.id, code: alert.code, hit: true, telegram: tg, push });
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

// ── CoinGecko 코인 해석·시세·차트 ──
// Yahoo는 마이너 코인이 없거나 동명의 죽은 코인을 반환할 수 있음
// (예: ADI → Yahoo는 죽은 'Aditus', 실제로는 시총 84위 ADI 토큰)
// 주요 코인은 Yahoo(속도·무제한), 그 외에는 CoinGecko를 우선 사용
const MAJOR_CRYPTO = new Set([
  "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB", "USDT", "USDC", "TRX",
  "AVAX", "LINK", "DOT", "MATIC", "LTC", "BCH", "SHIB", "XLM", "ETC", "APT",
  "ARB", "OP", "SUI", "PEPE", "TON", "NEAR", "ICP", "UNI", "HBAR", "FIL",
]);
const cgIdCache = new Map(); // SYMBOL → { id, name, at }
const cgPriceCache = new Map(); // id → { data, at }

// CoinGecko 무료 한도(IP당) 보호 — 호출 간격 1.8초 유지, 429 시 90초 쿨다운
let cgCooldownUntil = 0;
let cgChain = Promise.resolve();
function cgThrottled(fn) {
  const run = cgChain.then(async () => {
    if (Date.now() < cgCooldownUntil) {
      const err = new Error("CoinGecko 한도 초과 — 잠시 후 다시 시도하세요");
      err.isCooldown = true;
      throw err;
    }
    try {
      return await fn();
    } catch (e) {
      if (e?.response?.status === 429) cgCooldownUntil = Date.now() + 90 * 1000;
      throw e;
    } finally {
      await new Promise((r) => setTimeout(r, 1800));
    }
  });
  cgChain = run.then(() => {}, () => {});
  return run;
}

async function resolveCoinGeckoId(symbol) {
  const key = String(symbol || "").toUpperCase();
  const hit = cgIdCache.get(key);
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit;
  const { data } = await cgThrottled(() => axios.get("https://api.coingecko.com/api/v3/search", {
    params: { query: key },
    timeout: 10000,
  }));
  const exact = (data?.coins || [])
    .filter((c) => String(c.symbol || "").toUpperCase() === key)
    .sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9))[0] || null;
  const entry = { id: exact?.id || null, name: exact?.name || null, at: Date.now() };
  cgIdCache.set(key, entry);
  return entry;
}

async function fetchCoinGeckoQuote(symbol) {
  const { id, name } = await resolveCoinGeckoId(symbol);
  if (!id) throw new Error(`CoinGecko에 없는 코인: ${symbol}`);
  const hit = cgPriceCache.get(id);
  if (hit && Date.now() - hit.at < 120 * 1000) return hit.data;
  // 한도 초과 등 실패 시 오래된 캐시라도 제공 —
  // Yahoo의 동명 죽은 코인으로 잘못 폴백하는 것보다 안전함
  let data;
  try {
    ({ data } = await cgThrottled(() => axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: { ids: id, vs_currencies: "usd", include_24hr_change: "true" },
      timeout: 10000,
    })));
  } catch (e) {
    if (hit) return { ...hit.data, stale: true };
    throw e;
  }
  const p = data?.[id];
  if (!p || !Number.isFinite(p.usd)) {
    if (hit) return { ...hit.data, stale: true };
    throw new Error(`CoinGecko 시세 없음: ${id}`);
  }
  const rate = Number(p.usd_24h_change || 0);
  const prev = p.usd / (1 + rate / 100);
  const quote = {
    name,
    price: p.usd,
    change: p.usd - prev,
    changeRate: rate,
    changeStr: `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
    currency: "USD",
    marketState: "",
    time: new Date().toISOString(),
    source: "CoinGecko",
  };
  cgPriceCache.set(id, { data: quote, at: Date.now() });
  return quote;
}

// 일별 종가 시리즈로 근사 캔들 생성 (open=전일 종가) — 종가 기반 지표 분석용
const cgCandlesCache = new Map(); // id → { data, at }
async function fetchCoinGeckoCandles(symbol, count = 260) {
  const { id } = await resolveCoinGeckoId(symbol);
  if (!id) throw new Error(`CoinGecko에 없는 코인: ${symbol}`);
  const hit = cgCandlesCache.get(id);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data.slice(-count);
  let data;
  try {
    ({ data } = await cgThrottled(() => axios.get(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart`, {
      params: { vs_currency: "usd", days: 365, interval: "daily" },
      timeout: 15000,
    })));
  } catch (e) {
    if (hit) return hit.data.slice(-count); // 오래된 캐시라도 제공
    throw e;
  }
  const prices = data?.prices || [];
  const vols = new Map((data?.total_volumes || []).map(([t, v]) => [t, v]));
  const candles = prices.map(([ts, close], i) => {
    const prev = i > 0 ? prices[i - 1][1] : close;
    return {
      date: new Date(ts).toISOString().slice(0, 10),
      open: prev,
      high: Math.max(prev, close),
      low: Math.min(prev, close),
      close,
      volume: vols.get(ts) || 0,
    };
  });
  cgCandlesCache.set(id, { data: candles, at: Date.now() });
  return candles.slice(-count);
}

// 일봉 → 주봉/월봉 리샘플 (CoinGecko는 일봉만 제공)
function resampleCandles(candles, period) {
  const p = String(period || "D").toUpperCase();
  if (p !== "W" && p !== "M") return candles;
  const keyOf = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    if (p === "M") return dateStr.slice(0, 7);
    // ISO 주차 키 (연도-주)
    const day = (d.getUTCDay() + 6) % 7;
    const th = new Date(d);
    th.setUTCDate(d.getUTCDate() - day + 3);
    const firstTh = new Date(Date.UTC(th.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((th - firstTh) / 86400000 - 3 + ((firstTh.getUTCDay() + 6) % 7)) / 7);
    return `${th.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  };
  const groups = new Map();
  for (const c of candles) {
    const k = keyOf(c.date);
    const g = groups.get(k);
    if (!g) {
      groups.set(k, { ...c });
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
      g.date = c.date; // 구간 마지막 날짜로 표기
    }
  }
  return [...groups.values()];
}

// 크립토 캔들 통합: 주요 코인 Yahoo, 그 외 CoinGecko
// CoinGecko에 존재하는 코인은 Yahoo로 폴백하지 않음 —
// Yahoo가 동명의 다른(죽은) 코인을 반환해 잘못된 차트가 나올 수 있음
async function fetchCryptoCandles(symbol, period = "D", range = "1Y", count = 260) {
  const sym = String(symbol || "").toUpperCase();
  if (MAJOR_CRYPTO.has(sym)) return fetchYahooChart(sym, "crypto", period, range, count);
  let resolved = null;
  try {
    resolved = await resolveCoinGeckoId(sym);
  } catch { /* 해석 실패 시 Yahoo 시도 */ }
  if (!resolved?.id) return fetchYahooChart(sym, "crypto", period, range, count);
  const daily = await fetchCoinGeckoCandles(sym, 400);
  return resampleCandles(daily, period).slice(-count);
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
    const candles = type === "crypto"
      ? await fetchCryptoCandles(symbol, period, range, count)
      : await fetchYahooChart(symbol, type, period, range, count);
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

app.get("/api/global/search", async (req, res) => {
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
  if (rows.length || !q) return res.json(rows.slice(0, 20));

  // 하드코딩 카탈로그에 없으면 실시간 검색 폴백 —
  // 코인은 CoinGecko(마이너 코인 포함), 주식/ETF는 Yahoo
  try {
    const [yhRes, cgRes] = await Promise.allSettled([
      axios.get("https://query1.finance.yahoo.com/v1/finance/search", {
        params: { q, quotesCount: 15, newsCount: 0 },
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      }),
      cgThrottled(() => axios.get("https://api.coingecko.com/api/v3/search", {
        params: { query: q },
        timeout: 10000,
      })),
    ]);

    const cgCoins = cgRes.status === "fulfilled" ? (cgRes.value.data?.coins || []) : [];
    // 심볼→CoinGecko id 캐시를 미리 채워 시세 조회 시 추가 검색 호출을 아낌
    for (const c of cgCoins) {
      const sym = String(c.symbol || "").toUpperCase();
      if (!sym || !c.id) continue;
      const cur = cgIdCache.get(sym);
      const curRank = cur?.rank ?? 1e9;
      const rank = c.market_cap_rank || 1e9;
      if (!cur?.id || rank < curRank) {
        cgIdCache.set(sym, { id: c.id, name: c.name, rank, at: Date.now() });
      }
    }
    const coins = cgCoins.slice(0, 8).map((c) => ({
      symbol: String(c.symbol || "").toUpperCase(),
      name: c.name,
      type: "crypto",
      sector: c.market_cap_rank ? `시총 #${c.market_cap_rank}` : "Crypto",
    }));

    const stocks = yhRes.status === "fulfilled"
      ? (yhRes.value.data?.quotes || [])
          .filter((x) => ["EQUITY", "ETF"].includes(x.quoteType))
          .map((x) => ({
            symbol: x.symbol,
            name: x.shortname || x.longname || x.symbol,
            type: "us",
            sector: x.exchDisp || null,
          }))
      : [];

    const seen = new Set();
    const found = [...coins, ...stocks].filter((x) => {
      if (!x.symbol) return false;
      const key = `${x.type}:${x.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return res.json(found.slice(0, 20));
  } catch (e) {
    console.error("[global/search]", e.message);
    return res.json([]);
  }
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
    let quote;
    if (MAJOR_CRYPTO.has(raw)) {
      quote = await fetchYahooQuote(`${raw}-USD`);
    } else {
      // 마이너 코인은 CoinGecko (Yahoo는 동명의 죽은 코인을 반환할 수 있어
      // CoinGecko에 존재하는 심볼은 Yahoo로 폴백하지 않음)
      let resolved = null;
      try {
        resolved = await resolveCoinGeckoId(raw);
      } catch { /* 해석 자체가 실패하면 Yahoo 시도 */ }
      quote = resolved?.id
        ? await fetchCoinGeckoQuote(raw)
        : await fetchYahooQuote(`${raw}-USD`);
    }
    res.json({ ...quote, symbol: raw });
  } catch (err) {
    console.error("[crypto/quote]", err.message);
    res.status(502).json({ error: err.message });
  }
});




app.get("/api/kis/health", async (req, res) => {
  if (isProduction) {
    return res.json({ ok: true, time: new Date().toISOString() });
  }
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


// ── KB증권 조회 전용 API ──────────────────────────────────────────
// 모든 라우트는 읽기 전용이다. 주문(매수/매도/정정/취소)은 제공하지 않는다.
// 응답에 appKey/appSecret/access token 원문이 절대 포함되지 않도록 주의할 것.

const KB_NOT_CONFIGURED_MSG = "KB증권 연동 환경변수가 설정되어 있지 않습니다.";

/** KB 라우트 공통 에러 응답. 환경변수명·스택·비밀정보는 절대 담지 않는다. */
function sendKbError(res, err) {
  const e = err || {};
  if (e instanceof kbConfig.ConfigError || e.code === "KB_NOT_CONFIGURED") {
    console.error("[kb]", KB_NOT_CONFIGURED_MSG);
    return res.status(503).json({
      error: "KB증권 연동을 사용할 수 없습니다.",
    });
  }
  if (kbDiagnostic.isDiagnosticError(e)) {
    kbDiagnostic.logKbDiagnostic(e);
  } else {
    kbDiagnostic.logKbDiagnostic(
      new kbDiagnostic.KbDiagnosticError({
        stage: "unknown",
        errorType: "unknown",
      }),
    );
  }
  return res.status(502).json({
    error: kbDiagnostic.KB_CLIENT_ERROR,
  });
}

/** 성공 응답 공통 포맷 */
function sendKbOk(res, data) {
  res.json({ ok: true, data, time: new Date().toISOString() });
}

// 연결 설정 상태 — 인증 후에만 도달한다. 네트워크 호출·토큰 발급 없음.
// 응답은 아래 4개 필드만. 환경변수명·키·토큰·경로를 포함하지 않는다.
app.get("/api/broker/status", (req, res) => {
  let cfg = null;
  try {
    cfg = kbConfig.getKbConfig();
  } catch (_) {
    cfg = null;
  }
  return res.status(200).json({
    configured: !!(cfg && cfg.configured),
    connection: "unverified",
    tradingEnabled: !!(cfg && cfg.tradingEnabled),
    autoTradingEnabled: !!(cfg && cfg.autoTradingEnabled),
  });
});

// 장운영상태 — 계좌 정보는 아니지만 KB 호출 쿼터를 소모하므로 비공개.
app.get("/api/trading/market-status", async (req, res) => {
  try {
    sendKbOk(res, await kbBroker.getMarketStatus());
  } catch (e) {
    sendKbError(res, e);
  }
});

// 현재가 — 단축코드 6자리
app.get("/api/trading/quotes/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").trim();
    if (!/^\d{6}$/.test(symbol)) {
      return res
        .status(400)
        .json({ ok: false, code: "BAD_SYMBOL", message: "단축코드 6자리를 입력하세요." });
    }
    sendKbOk(res, await kbBroker.getQuote(symbol, req.query.excg || "0"));
  } catch (e) {
    sendKbError(res, e);
  }
});

// 잔고 요약(체결기준)
app.get("/api/trading/balance", async (req, res) => {
  try {
    sendKbOk(res, await kbBroker.getBalance({ excg_mktpr_ccd: req.query.excg }));
  } catch (e) {
    sendKbError(res, e);
  }
});

// 보유종목(체결기준)
app.get("/api/trading/positions", async (req, res) => {
  try {
    sendKbOk(res, await kbBroker.getPositions({ excg_mktpr_ccd: req.query.excg }));
  } catch (e) {
    sendKbError(res, e);
  }
});

// 매수주문가능금액
app.get("/api/trading/orderable-amount", async (req, res) => {
  try {
    sendKbOk(res, await kbBroker.getOrderableAmount({ symbol: req.query.symbol }));
  } catch (e) {
    sendKbError(res, e);
  }
});

// 주문 내역(기본: 전체)
app.get("/api/trading/orders", async (req, res) => {
  try {
    sendKbOk(
      res,
      await kbBroker.getExecutions({
        cclsClsf: req.query.cclsClsf || "0",
        ordrDt: req.query.date,
        maxPages: 20,
      })
    );
  } catch (e) {
    sendKbError(res, e);
  }
});

// 체결 내역(기본: 체결)
app.get("/api/trading/executions", async (req, res) => {
  try {
    sendKbOk(
      res,
      await kbBroker.getExecutions({
        cclsClsf: req.query.cclsClsf || "1",
        ordrDt: req.query.date,
        maxPages: 20,
      })
    );
  } catch (e) {
    sendKbError(res, e);
  }
});


// 미등록 /api/* 는 React HTML 이 아니라 JSON 404.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "요청한 API를 찾을 수 없습니다." });
});

const DIST_DIR = path.join(__dirname, "dist");
const DIST_INDEX = path.join(DIST_DIR, "index.html");

app.use((req, res, next) => {
  if (req.path.endsWith(".map") || req.path.endsWith(".md")) {
    return res.status(404).end();
  }
  next();
});

app.use(
  express.static(DIST_DIR, {
    index: false,
    fallthrough: true,
    dotfiles: "ignore",
    maxAge: "1h",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }),
);

// Express 4 SPA fallback — API 가 아닌 GET 만 index.html.
app.use((req, res, next) => {
  const method = String(req.method || "").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();
  if (req.path.startsWith("/api")) return next();
  if (!fs.existsSync(DIST_INDEX)) {
    return res.status(503).json({ error: "프런트엔드 빌드가 없습니다." });
  }
  res.sendFile(DIST_INDEX, (err) => {
    if (err) next(err);
  });
});

// 스택·내부 오류 객체를 클라이언트에 노출하지 않는다.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("[server]", err && err.message ? err.message : "unhandled error");
  return res.status(500).json({ error: "서버 오류가 발생했습니다." });
});

// ── 서버 시작 ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
// 테스트에서 이 파일을 require 할 수 있도록, 직접 실행될 때만 서버를 기동한다.
// (node server.js / npm start 동작은 이전과 완전히 동일하다.)
if (require.main === module) {
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

    // 수출입 리포트(관세청 품목 수집 ~20분 포함)를 미리 준비해
    // 첫 사용자가 수집을 기다리지 않게 함
    setTimeout(() => {
      buildTradeReport().catch((e) => console.error("[trade-warmup]", e.message));
    }, 10 * 1000);

    // ── AI 예측 모델 지속 자동 학습 ──
    // 1) 부팅 시 과거 백테스트 재학습 (무료 호스팅 재시작으로 소실된 학습 복구)
    // 2) 6시간마다: 최신 데이터 재학습 + 만기 예측 채점 + 새 예측 자동 생성
    async function selfTrainPredictor() {
      try {
        const codes = KRX_MASTER_ALL.slice(0, 30).map((x) => x.code);
        const trained = await aiPredictor.trainFromHistory(
          codes,
          (c, n) => fetchDailyCandles(c, n),
          analyzeCandles,
        );
        console.log("[predict-train] history:", JSON.stringify(trained));
        const matured = await aiPredictor.processMatured((c, n) => fetchDailyCandles(c, n), { maxPerRun: 20 });
        if (matured.processed) console.log("[predict-train] matured:", matured.processed);
        // 다음 채점 주기를 위한 새 예측 자동 축적 (사용자 요청 없이도 학습 재료 생성)
        for (const code of codes.slice(0, 10)) {
          try {
            const candles = await fetchDailyCandles(code, 260);
            const newest = [...candles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
            const analysis = analyzeCandles(newest);
            aiPredictor.predict(code, analysis, Number(newest[0]?.close), buildPredictOptsFromCandles(newest));
          } catch { /* 개별 실패 무시 */ }
        }
      } catch (e) {
        console.error("[predict-train]", e.message);
      }
    }
    setTimeout(selfTrainPredictor, 60 * 1000);
    setInterval(selfTrainPredictor, 6 * 60 * 60 * 1000);

    // ── 자체 기법 발굴 진화 사이클 ──
    // 부팅 3분 후 첫 진화, 이후 6시간마다 세대를 이어가며 발전
    async function runEvolution() {
      try {
        const codes = KRX_MASTER_ALL.slice(0, 20).map((x) => x.code);
        const r = await evolver.evolveCycle(codes, (c, n) => fetchDailyCandles(c, n), analyzeCandles);
        console.log("[evolve]", JSON.stringify(r));
      } catch (e) {
        console.error("[evolve]", e.message);
      }
    }
    setTimeout(runEvolution, 3 * 60 * 1000);
    setInterval(runEvolution, 6 * 60 * 60 * 1000);

    // ── 관심종목 실적 공시 감시 (분기·반기·사업보고서 → 푸시) ──
    async function scanEarningsLoop() {
      try {
        const r = await dartFund.scanEarnings((title, body) => apns.sendPushToAll({ title, body }));
        if (r.found) console.log("[earnings]", JSON.stringify(r));
      } catch (e) {
        console.error("[earnings]", e.message);
      }
    }
    setTimeout(scanEarningsLoop, 5 * 60 * 1000);
    setInterval(scanEarningsLoop, 12 * 60 * 60 * 1000);
  });
}

module.exports = app;
