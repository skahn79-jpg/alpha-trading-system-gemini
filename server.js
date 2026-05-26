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

const KIS_BASE = "https://https://openapi.koreainvestment.com:9443"; // 실전투자

let ACCESS_TOKEN = null;
let TOKEN_EXPIRES_AT = null;

// ── 토큰 자동 발급/갱신 ──────────────────────────────────────────
async function getAccessToken() {
  const now = Date.now();
  if (ACCESS_TOKEN && TOKEN_EXPIRES_AT && now < TOKEN_EXPIRES_AT) {
    return ACCESS_TOKEN;
  }
  console.log("[KIS] 토큰 발급 중...");
  const res = await axios.post(`${KIS_BASE}/oauth2/tokenP`, {
    grant_type: "client_credentials",
    appkey: process.env.KIS_APP_KEY,
    appsecret: process.env.KIS_APP_SECRET,
  });
  ACCESS_TOKEN = res.data.access_token;
  TOKEN_EXPIRES_AT = now + (res.data.expires_in - 60) * 1000;
  console.log("[KIS] 토큰 발급 완료");
  return ACCESS_TOKEN;
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
      fid_cond_mrkt_div_code: "J",
      fid_input_iscd: code,
      fid_input_date_1: "",
      fid_input_date_2: "",
      fid_period_div_code: "D",
      fid_org_adj_prc: "1",
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
        { fid_cond_mrkt_div_code: "U", fid_input_iscd: "0001" }),
      kisGet("/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000",
        { fid_cond_mrkt_div_code: "U", fid_input_iscd: "1001" }),
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
      { fid_cond_mrkt_div_code: "J", fid_input_iscd: code }
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
    console.error("[quote]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
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
        fid_cond_mrkt_div_code: "J",
        fid_input_iscd: req.params.code,
        fid_input_date_1: "",
        fid_input_date_2: "",
        fid_period_div_code: period,
        fid_org_adj_prc: "1",
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
    console.error("[chart]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
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
    console.error("[analyze-endpoint]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
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
          { fid_cond_mrkt_div_code: "J", fid_input_iscd: trimmed }
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
app.get("/api/search", async (req, res) => {
  try {
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/search-stock-info",
      "CTPF1002R",
      { PRDT_TYPE_CD: "300", PDNO: req.query.q || "" }
    );
    res.json(data.output || []);
  } catch (err) {
    console.error("[search]", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
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


// ── Gemini AI 분석 프록시 ───────────────────────────────────────
// POST /api/ai/analyze
// body: { prompt, systemPrompt?, maxTokens? }
// 브라우저에 API Key를 노출하지 않도록 Render 서버에서 Gemini를 대리 호출합니다.
app.post("/api/ai/analyze", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    const systemPrompt = String(req.body?.systemPrompt || "").trim();
    const maxTokens = Math.min(parseInt(req.body?.maxTokens || "1200", 10) || 1200, 3000);

    if (!prompt) {
      return res.status(400).json({ error: "prompt가 비어 있습니다." });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "GEMINI_API_KEY가 서버 환경변수에 설정되지 않았습니다. Render Environment에 키를 추가하세요.",
      });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const finalPrompt = `${systemPrompt || "당신은 주식·경제 분석 보조 역할을 수행합니다. 과장된 확정 표현을 피하고, 데이터 기반으로 단계형 판단을 제시하세요."}

[사용자 요청]
${prompt}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const aiRes = await axios.post(
      geminiUrl,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: finalPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: maxTokens,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      }
    );

    const text =
      aiRes.data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim() || "Gemini 분석 결과가 비어 있습니다.";

    res.json({ ok: true, provider: "gemini", model, text });
  } catch (err) {
    console.error("[gemini/ai/analyze]", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      ok: false,
      error: err.response?.data?.error?.message || err.message || "Gemini 분석 호출 실패",
      detail: err.response?.data || undefined,
    });
  }
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
║  GET /api/search?q=               종목 검색           ║
║                                                      ║
║  [국민연금 - DART]                                   ║
║  GET /api/nps?days=60             국민연금 변동 종목  ║
║  GET /api/nps/:corpCode           특정 종목 보유 이력 ║
║                                                      ║
║  [AI 시뮬레이션]                                     ║
║  POST /api/sim/judge              시그널 자동 채점    ║
║  POST /api/sim/stats              누적 통계 + 가중치  ║
║  POST /api/sim/score              신규 시그널 점수    ║
║  POST /api/ai/analyze            AI 분석 프록시      ║
╠══════════════════════════════════════════════════════╣
║  분석: 경제명탐정 4·5주차 + 독개미 + 스펙터 통합     ║
║  자가학습: 시그널 채점 → 신호별 가중치 자동 조정     ║
╚══════════════════════════════════════════════════════╝
  `);
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.log("⚠️  GEMINI_API_KEY 미설정 — /api/ai/analyze 엔드포인트는 503을 반환합니다.");
    console.log("   Render Environment에 GEMINI_API_KEY=... 추가하세요.\n");
  }
  if (!process.env.DART_API_KEY) {
    console.log("⚠️  DART_API_KEY 미설정 — /api/nps 엔드포인트 비활성");
    console.log("   .env에 DART_API_KEY=... 추가하세요.\n");
  }
});
