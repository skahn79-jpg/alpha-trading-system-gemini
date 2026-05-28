import React, { useEffect, useMemo, useState } from "react";

/**
 * ALPHA TRADING SYSTEM — 통합 확장 버전
 * 교체 대상: src/trading-platform.jsx
 *
 * 포함 기능:
 * 1) 모바일/상단 UI 개선
 * 2) AI 리포트 + 추가 질문
 * 3) 화면 전환감 개선
 * 4) 실시간 종목 추가
 * 5) AI 저평가 종목 스크리너
 * 6) 종목 알림 자동화 UI
 * 7) 백테스트 UI
 * 8) AI 일일 브리핑 UI
 * 9) 섹터/테마 분석
 * 10) 전 종목 스캔 UI
 * 11) 차트 시각화 UI
 * 12) AI 학습 가중치 자동 주입 UI
 */

const API_BASE = "https://alpha-trading-server.onrender.com";

const DEFAULT_STOCKS = [
  { code: "005930", name: "삼성전자", tag: "반도체", sector: "반도체" },
  { code: "000660", name: "SK하이닉스", tag: "반도체", sector: "반도체" },
  { code: "035420", name: "NAVER", tag: "플랫폼", sector: "인터넷" },
  { code: "035720", name: "카카오", tag: "플랫폼", sector: "인터넷" },
  { code: "005380", name: "현대차", tag: "자동차", sector: "자동차" },
  { code: "000270", name: "기아", tag: "자동차", sector: "자동차" },
  { code: "006400", name: "삼성SDI", tag: "2차전지", sector: "2차전지" },
  { code: "373220", name: "LG에너지솔루션", tag: "2차전지", sector: "2차전지" },
  { code: "012450", name: "한화에어로스페이스", tag: "방산", sector: "방산" },
  { code: "042700", name: "한미반도체", tag: "반도체", sector: "반도체" },
];


const KOREAN_STOCK_CATALOG = [
  ...DEFAULT_STOCKS,
  { code: "005490", name: "POSCO홀딩스", tag: "철강/2차전지", sector: "철강" },
  { code: "051910", name: "LG화학", tag: "화학/2차전지", sector: "2차전지" },
  { code: "011170", name: "롯데케미칼", tag: "화학", sector: "화학" },
  { code: "066570", name: "LG전자", tag: "전기전자", sector: "전기전자" },
  { code: "105560", name: "KB금융", tag: "금융", sector: "금융" },
  { code: "055550", name: "신한지주", tag: "금융", sector: "금융" },
  { code: "086790", name: "하나금융지주", tag: "금융", sector: "금융" },
  { code: "316140", name: "우리금융지주", tag: "금융", sector: "금융" },
  { code: "068270", name: "셀트리온", tag: "바이오", sector: "바이오" },
  { code: "207940", name: "삼성바이오로직스", tag: "바이오", sector: "바이오" },
  { code: "028260", name: "삼성물산", tag: "지주/건설", sector: "지주" },
  { code: "032830", name: "삼성생명", tag: "보험", sector: "금융" },
  { code: "033780", name: "KT&G", tag: "소비재", sector: "소비재" },
  { code: "096770", name: "SK이노베이션", tag: "정유/배터리", sector: "에너지" },
  { code: "034730", name: "SK", tag: "지주", sector: "지주" },
  { code: "017670", name: "SK텔레콤", tag: "통신", sector: "통신" },
  { code: "030200", name: "KT", tag: "통신", sector: "통신" },
  { code: "015760", name: "한국전력", tag: "전력", sector: "유틸리티" },
  { code: "009150", name: "삼성전기", tag: "전자부품", sector: "전기전자" },
  { code: "011200", name: "HMM", tag: "해운", sector: "운송" },
  { code: "003670", name: "포스코퓨처엠", tag: "2차전지", sector: "2차전지" },
  { code: "247540", name: "에코프로비엠", tag: "2차전지", sector: "2차전지" },
  { code: "086520", name: "에코프로", tag: "2차전지", sector: "2차전지" },
  { code: "196170", name: "알테오젠", tag: "바이오", sector: "바이오" },
  { code: "000810", name: "삼성화재", tag: "보험", sector: "금융" },
  { code: "010130", name: "고려아연", tag: "비철금속", sector: "소재" },
  { code: "018260", name: "삼성에스디에스", tag: "IT서비스", sector: "IT" },
  { code: "251270", name: "넷마블", tag: "게임", sector: "게임" },
  { code: "259960", name: "크래프톤", tag: "게임", sector: "게임" },
  { code: "377300", name: "카카오페이", tag: "핀테크", sector: "인터넷" },
  { code: "323410", name: "카카오뱅크", tag: "은행", sector: "금융" },
  { code: "047810", name: "한국항공우주", tag: "방산", sector: "방산" },
  { code: "064350", name: "현대로템", tag: "방산/철도", sector: "방산" },
  { code: "329180", name: "HD현대중공업", tag: "조선", sector: "조선" },
  { code: "010140", name: "삼성중공업", tag: "조선", sector: "조선" },
  { code: "009540", name: "HD한국조선해양", tag: "조선", sector: "조선" },
  { code: "267260", name: "HD현대일렉트릭", tag: "전력기기", sector: "전력기기" },
  { code: "010120", name: "LS ELECTRIC", tag: "전력기기", sector: "전력기기" },
  { code: "352820", name: "하이브", tag: "엔터", sector: "엔터" },
  { code: "041510", name: "에스엠", tag: "엔터", sector: "엔터" },
  { code: "035900", name: "JYP Ent.", tag: "엔터", sector: "엔터" },
  { code: "263750", name: "펄어비스", tag: "게임", sector: "게임" },
  { code: "112040", name: "위메이드", tag: "게임", sector: "게임" },
  { code: "011070", name: "LG이노텍", tag: "전자부품", sector: "전기전자" },
  { code: "272210", name: "한화시스템", tag: "방산", sector: "방산" },
  { code: "011210", name: "현대위아", tag: "자동차부품", sector: "자동차" },
  { code: "012330", name: "현대모비스", tag: "자동차부품", sector: "자동차" },
  { code: "161390", name: "한국타이어앤테크놀로지", tag: "타이어", sector: "자동차" },
];

const GLOBAL_TICKERS = [
  { symbol: "NVDA", name: "NVIDIA", type: "us" },
  { symbol: "TSLA", name: "Tesla", type: "us" },
  { symbol: "AAPL", name: "Apple", type: "us" },
  { symbol: "MSFT", name: "Microsoft", type: "us" },
  { symbol: "BTC", name: "Bitcoin", type: "crypto" },
  { symbol: "ETH", name: "Ethereum", type: "crypto" },
];

const DEMO_TICKERS = [
  { s: "NVDA", p: "$138.42", ch: "+3.21%", up: true, demo: true },
  { s: "TSLA", p: "$248.60", ch: "-1.44%", up: false, demo: true },
  { s: "BTC", p: "$67,240", ch: "+2.88%", up: true, demo: true },
  { s: "ETH", p: "$3,512", ch: "+1.65%", up: true, demo: true },
];

const WEIGHTS = [
  { key: "volume_spike", name: "거래량 급증", weight: 1.31, hit: 78 },
  { key: "base_support_ma20", name: "20일선 지지", weight: 1.22, hit: 71 },
  { key: "gj_trendline_break", name: "고고저 빗각 돌파", weight: 1.18, hit: 68 },
  { key: "nps_increase", name: "국민연금 비중 증가", weight: 1.15, hit: 64 },
];

const styles = `
  *{box-sizing:border-box}
  body{margin:0;background:#070b10;color:#d9ecf5;font-family:Arial,sans-serif}
  button,input,select,textarea{font-family:inherit}
  .app{min-height:100vh;background:#070b10}
  .top-wrap{position:sticky;top:0;z-index:50;background:#0b1118;box-shadow:0 8px 24px #0009}
  .top{min-height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid #1e3445;background:linear-gradient(90deg,#071018,#0b1118)}
  .brand{font-weight:900;letter-spacing:5px;color:#00d9ff;font-size:18px}
  .live{font-size:11px;color:#00ff88;margin-left:10px;white-space:nowrap}
  .top-left{display:flex;align-items:center;gap:8px}
  .top-right{display:flex;align-items:center;gap:8px;color:#6f899a;font-size:11px;white-space:nowrap}
  .tag{display:inline-flex;align-items:center;padding:3px 8px;border:1px solid #2d536b;font-size:10px;border-radius:3px;color:#6f899a}
  .tag.green{border-color:#00ff88;color:#00ff88;background:#00ff8811}
  .tag.red{border-color:#ff4466;color:#ff4466;background:#ff446611}
  .tag.yellow{border-color:#ffd447;color:#ffd447;background:#ffd44711}
  .tag.demo{border-color:#9b5cff;color:#9b5cff;background:#9b5cff11}
  .mobile-current{display:none;padding:9px 14px;border-bottom:1px solid #1e3445;background:#06111a;color:#00d9ff;font-weight:900;font-size:12px;letter-spacing:1px}
  .nav{display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid #1e3445;background:#0b1118;overflow-x:auto;scrollbar-width:none}
  .nav::-webkit-scrollbar,.ticker::-webkit-scrollbar{display:none}
  .nav button{white-space:nowrap;border:1px solid #1e3445;background:#101923;color:#6f899a;padding:10px 17px;border-radius:999px;cursor:pointer;font-weight:800;transition:.18s}
  .nav button.active{background:#d9ecf5;color:#070b10;box-shadow:0 0 18px #00d9ff33}
  .ticker{display:flex;border-bottom:1px solid #1e3445;overflow-x:auto;background:#0b1118;scrollbar-width:none}
  .ticker-item{min-width:150px;padding:8px 12px;border-right:1px solid #1e3445;font-size:12px;display:grid;grid-template-rows:auto auto auto;gap:3px;align-items:start}.ticker-item .ticker-line1{font-weight:900;color:#d9ecf5;white-space:normal;line-height:1.18}.ticker-item .ticker-line2{color:#6f899a;font-family:monospace}.ticker-item .ticker-line3{font-weight:900}
  .ticker-symbol{font-weight:900;color:#d9ecf5}.ticker-price{color:#6f899a;font-family:monospace}.up{color:#00ff88}.down{color:#ff4466}
  .main{padding:14px;display:grid;grid-template-columns:310px 1fr;gap:12px}
  .screen-shell{animation:screenIn .24s ease-out}
  @keyframes screenIn{from{opacity:.25;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  .screen-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;padding:12px;border:1px solid #1e3445;background:linear-gradient(90deg,#08141d,#0b1118)}
  .screen-title{font-size:15px;font-weight:900;color:#00d9ff;letter-spacing:1px}.screen-desc{font-size:12px;color:#6f899a;margin-top:4px;line-height:1.45}
  .panel{background:#0b1118;border:1px solid #1e3445}.panel-title{padding:11px 12px;border-bottom:1px solid #1e3445;color:#00d9ff;font-size:12px;font-weight:900;letter-spacing:2px;display:flex;align-items:center;justify-content:space-between;gap:8px}.panel-body{padding:12px}
  .grid{display:grid;gap:10px}.card-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.two-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .card{background:#101923;border:1px solid #1e3445;padding:14px}.card-title{font-size:11px;color:#6f899a;margin-bottom:8px}.value{font-size:20px;font-weight:900;font-family:monospace}.sub{font-size:12px;color:#6f899a;line-height:1.6}
  .stock-list{display:grid;gap:8px;max-height:470px;overflow:auto;padding-right:2px}.stock-btn{background:#101923;border:1px solid #1e3445;padding:12px;text-align:left;color:#d9ecf5;cursor:pointer;transition:.15s}.stock-btn.active{border-color:#00d9ff;background:#00d9ff11;box-shadow:inset 0 0 0 1px #00d9ff44}.stock-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.stock-name{font-weight:900}
  .input,.select,.textarea{width:100%;background:#070b10;border:1px solid #1e3445;color:#d9ecf5;padding:11px;outline:none}.textarea{min-height:76px;resize:vertical;line-height:1.5}
  .btn{background:#003647;border:1px solid #00d9ff;color:#00d9ff;padding:10px 14px;font-weight:900;cursor:pointer}.btn:hover{background:#004d63}.btn.full{width:100%}.btn.red{border-color:#ff4466;color:#ff4466;background:#48111b}.btn.small{padding:6px 8px;font-size:11px}
  .row{display:flex;gap:8px;align-items:center}.form-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:12px}.add-stock-grid{display:grid;grid-template-columns:1fr 1.1fr .9fr;gap:8px;margin-top:10px}
  .error{color:#ffb4c0;background:#ff446611;border:1px solid #ff446644;padding:12px;white-space:pre-wrap;font-size:13px;line-height:1.5}.loading{color:#ffd447}
  .report-layout{display:grid;grid-template-columns:170px 1fr;gap:10px}.score-box{height:172px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #1e3445;background:#101923}.score{font-size:54px;color:#ffd447;font-weight:900;font-family:monospace}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.kpi{background:#101923;border:1px solid #1e3445;padding:12px;min-height:78px}.kpi strong{display:block;margin-top:8px;font-size:18px;font-family:monospace}
  .footer-note{font-size:11px;color:#6f899a;padding:8px 12px;border-top:1px solid #1e3445}
  .ai-result-full{margin-top:12px;background:#101923;border:1px solid #1e3445;padding:18px;white-space:pre-wrap;line-height:1.8;font-size:14px;color:#d9ecf5;word-break:keep-all;overflow-wrap:anywhere;max-height:520px;overflow-y:auto;scrollbar-width:thin}.ai-result-full h4{margin:0 0 12px 0;color:#00d9ff;font-size:14px;font-weight:900}.ai-result-full::-webkit-scrollbar{width:8px}.ai-result-full::-webkit-scrollbar-thumb{background:#1e3445;border-radius:8px}.chart-ai-scroll{height:520px;max-height:58vh;overflow-y:auto;overflow-x:hidden;border:1px solid #1e3445;background:#081018;scrollbar-width:thin}.chart-ai-scroll::-webkit-scrollbar{width:9px}.chart-ai-scroll::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}.chart-ai-scroll .panel{border:0}.chart-ai-scroll .panel-body{padding-bottom:22px}.chart-ai-scroll .ai-result-full{max-height:none;overflow:visible}.chart-ai-hint{font-size:12px;color:#6f899a;padding:8px 14px;border-top:1px solid #1e3445;background:#101923}.chart-ai-scroll{height:520px;max-height:58vh;overflow-y:auto;overflow-x:hidden;border:1px solid #1e3445;background:#081018;scrollbar-width:thin}.chart-ai-scroll .ai-result-full{max-height:360px;overflow-y:auto}.chart-ai-scroll .chat-box{max-height:240px;overflow-y:auto}.readme-section{margin-top:14px;border:1px solid #1e3445;background:#101923}.readme-toggle{width:100%;border:0;background:#061018;color:#00d9ff;padding:12px 14px;text-align:left;font-weight:900;cursor:pointer}.readme-body{padding:14px 16px;line-height:1.75;color:#d9ecf5;max-height:360px;overflow-y:auto}.readme-body h4{margin:8px 0;color:#ffd447}.readme-body ul{margin:8px 0 14px 18px;padding:0}.global-market-panel{margin-top:12px;border:1px solid #1e3445;background:#101923;padding:12px}.global-market-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.global-market-item{border:1px solid #1e3445;background:#070b10;padding:10px}.global-market-title{font-weight:900;color:#00d9ff}.global-market-sub{color:#6f899a;font-size:12px;margin-top:4px}
  .chat-box{display:grid;gap:10px;margin-top:12px}.chat-msg{border:1px solid #1e3445;background:#101923;padding:12px;line-height:1.65;white-space:pre-wrap;font-size:13px}.chat-msg.user{border-color:#2d536b;background:#0d1a25}.chat-msg.ai{border-color:#00d9ff33}
  .data-table{width:100%;border-collapse:collapse;font-size:13px}.data-table th,.data-table td{border-bottom:1px solid #1e3445;padding:10px;text-align:left;vertical-align:top}.data-table th{color:#00d9ff;font-size:12px}.rank{font-weight:900;color:#ffd447}.pill{display:inline-block;padding:3px 7px;border:1px solid #2d536b;border-radius:999px;font-size:11px;color:#6f899a}
  .search-results{margin-top:8px;border:1px solid #1e3445;background:#070b10;max-height:190px;overflow:auto}.search-item{display:flex;justify-content:space-between;gap:8px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #1e3445;background:#101923;color:#d9ecf5;text-align:left;cursor:pointer}.search-item:hover{background:#00d9ff11}.search-item b{color:#00d9ff}.search-empty{margin-top:8px;padding:10px 12px;border:1px dashed #1e3445;color:#6f899a;font-size:12px}.chart-box{height:var(--chart-height,430px);border:1px solid #1e3445;background:#101923;position:relative;overflow:hidden}
.chart-size-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 12px}
.chart-size-toolbar .btn{min-width:44px}
.chart-size-label{color:#6f899a;font-size:12px}
.chart-size-range{width:220px;accent-color:#00d9ff}
.chart-fullscreen{position:fixed!important;z-index:9999;left:12px;right:12px;top:12px;bottom:12px;height:auto!important;background:#101923;border:2px solid #00d9ff;box-shadow:0 0 0 9999px #000c}
.chart-fullscreen .chart-svg{height:100%}.chart-svg{width:100%;height:100%}.axis-label{font-size:11px;fill:#6f899a}.line-ma{stroke:#ffd447;stroke-width:2}.line-ma60{stroke:#00d9ff;stroke-width:1.5;opacity:.85}.line-trend{stroke:#ff4466;stroke-width:2.2;stroke-dasharray:6 5}.candle-up{fill:#00ff88}.candle-down{fill:#ff4466}.wick{stroke:#6f899a;stroke-width:1}.chart-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:10px 0;color:#6f899a;font-size:12px}.technique-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}.technique-btn{border:1px solid #1e3445;background:#101923;color:#6f899a;padding:10px;text-align:left;cursor:pointer}.technique-btn.active{border-color:#00d9ff;color:#d9ecf5;background:#00d9ff11}.technique-name{font-weight:900;color:#00d9ff}.technique-score{font-family:monospace;margin-top:4px}.band-line{stroke:#9b5cff;stroke-width:1.2;opacity:.75;stroke-dasharray:4 4}.volume-break-line{stroke:#00ff88;stroke-width:1.5;opacity:.8;stroke-dasharray:6 4}.indicator-legend{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.legend-pill{border:1px solid #1e3445;background:#101923;color:#d9ecf5;padding:7px 10px;font-size:12px}.legend-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}.sig-label{font-size:12px;font-weight:900}.sig-box{fill:#061018;stroke:#00d9ff;stroke-width:1.2;opacity:.94}.signal-arrow{stroke-width:2.2;marker-end:url(#arrowHead)}.scan-card{border:1px solid #1e3445;background:#101923;padding:14px;min-height:110px}.scan-card h4{margin:0 0 10px;color:#00d9ff}.scan-card ul{margin:0;padding-left:18px;line-height:1.8}
  @media(max-width:1000px){.main{grid-template-columns:1fr;padding:8px}.card-grid,.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two-grid{grid-template-columns:1fr}.report-layout{grid-template-columns:1fr}.form-grid,.add-stock-grid{grid-template-columns:1fr}}
  @media(max-width:600px){.top{min-height:104px;align-items:flex-start;flex-direction:column;padding:14px 16px;gap:10px}.top-left{width:100%;justify-content:space-between}.brand{font-size:22px;letter-spacing:8px}.live{display:block;margin-top:8px;font-size:13px}.top-right{width:100%;gap:10px;flex-wrap:wrap;font-size:13px}.tag{font-size:12px;padding:5px 10px}.mobile-current{display:block}.nav{padding:10px 12px;gap:10px}.nav button{padding:11px 18px;font-size:14px}.ticker-item{min-width:190px;font-size:13px;padding:11px 14px}.ticker-symbol{max-width:76px;white-space:normal;line-height:1.2}.main{padding:10px}.card-grid,.kpi-grid{grid-template-columns:1fr}.row{flex-direction:column;align-items:stretch}.btn{width:100%}.stock-list{max-height:none}.panel-title{font-size:14px;padding:14px}.panel-body{padding:14px}.stock-btn{padding:18px}.stock-name{font-size:16px}.sub{font-size:13px}.screen-head{padding:14px}}

/* === FORCE: Chart Analysis AI Report Scroll === */
.chart-report-scroll-shell{
  height:560px;
  max-height:62vh;
  min-height:320px;
  overflow-y:auto;
  overflow-x:hidden;
  border:1px solid #1e3445;
  background:#081018;
  scrollbar-width:thin;
}
.chart-report-scroll-shell::-webkit-scrollbar{width:10px}
.chart-report-scroll-shell::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}
.chart-report-scroll-shell .panel{border:0;margin:0}
.chart-report-scroll-shell .panel-body{padding-bottom:24px}
.chart-report-scroll-shell .ai-result-full{
  max-height:360px!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  white-space:pre-wrap!important;
}
.chart-report-scroll-shell .chat-box{
  max-height:220px!important;
  overflow-y:auto!important;
}
.chart-report-scroll-note{
  position:sticky;
  bottom:0;
  padding:8px 14px;
  border-top:1px solid #1e3445;
  background:#101923;
  color:#6f899a;
  font-size:12px;
}
@media(max-width:900px){
  .chart-report-scroll-shell{
    height:460px;
    max-height:58vh;
  }
  .chart-report-scroll-shell .ai-result-full{
    max-height:300px!important;
  }
}


.ai-result-text{white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}

/* === FINAL: AI Report Scroll + Chart Range Zoom === */
.ai-result-full{
  max-height:none!important;
  overflow:visible!important;
}
.ai-result-scrollbox{
  height:320px;
  max-height:42vh;
  overflow-y:auto!important;
  overflow-x:hidden;
  white-space:pre-wrap;
  word-break:keep-all;
  overflow-wrap:anywhere;
  line-height:1.85;
  padding:14px;
  border:1px solid #1e3445;
  background:#070b10;
  color:#d9ecf5;
  scrollbar-width:thin;
}
.ai-result-scrollbox::-webkit-scrollbar{width:10px}
.ai-result-scrollbox::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}
.ai-report-scroll-panel{
  height:520px;
  max-height:58vh;
  overflow-y:auto!important;
  overflow-x:hidden;
  border:1px solid #1e3445;
  background:#081018;
  scrollbar-width:thin;
}
.ai-report-scroll-panel::-webkit-scrollbar{width:10px}
.ai-report-scroll-panel::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}
.ai-report-scroll-panel .panel{border:0;margin:0}
.ai-report-scroll-panel .panel-body{padding-bottom:26px}
.ai-report-scroll-note{
  position:sticky;
  bottom:0;
  padding:8px 14px;
  border-top:1px solid #1e3445;
  background:#101923;
  color:#6f899a;
  font-size:12px;
}
.chart-range-toolbar{
  display:flex;
  gap:8px;
  align-items:center;
  flex-wrap:wrap;
  margin:10px 0 12px;
  padding:10px;
  border:1px solid #1e3445;
  background:#081018;
}
.chart-range-toolbar .btn{min-width:86px}
.chart-window-label{color:#6f899a;font-size:12px}
.chart-window-range{width:260px;accent-color:#00d9ff}
.chart-box{height:430px!important;min-height:430px!important}
@media(max-width:900px){
  .ai-report-scroll-panel{height:460px;max-height:56vh}
  .ai-result-scrollbox{height:280px;max-height:36vh}
  .chart-window-range{width:100%}
  .chart-range-toolbar .btn{width:auto;min-width:78px}
}


.chart-size-toolbar{display:none!important}.chart-fullscreen{position:relative!important;box-shadow:none!important;border:1px solid #1e3445!important}

/* === FINAL: Chart Period Labels + Fullscreen Return === */
.chart-box-fullscreen{
  position:fixed!important;
  z-index:9999;
  left:10px;
  right:10px;
  top:10px;
  bottom:10px;
  height:auto!important;
  min-height:0!important;
  background:#101923;
  border:2px solid #00d9ff!important;
  box-shadow:0 0 0 9999px #000c;
  padding-top:48px;
}
.chart-box-fullscreen .chart-svg{
  width:100%;
  height:100%;
}
.chart-back-btn{
  position:absolute;
  top:8px;
  right:10px;
  z-index:10000;
  border:1px solid #00d9ff;
  background:#00384a;
  color:#d9ecf5;
  padding:9px 14px;
  font-weight:900;
  cursor:pointer;
}
.chart-back-btn:hover{background:#005d78}
.chart-period-note{
  color:#6f899a;
  font-size:12px;
  margin-top:8px;
  line-height:1.6;
}
.x-axis-label{font-size:11px;fill:#8aa4b5;font-family:monospace}
.x-axis-year{font-size:12px;fill:#00d9ff;font-weight:900}
.chart-size-toolbar{display:none!important}


/* === FINAL: Chart Label Anti-Overlap === */
.axis-label,.x-axis-label,.x-axis-year,.sig-label{
  paint-order:stroke;
  stroke:#071018;
  stroke-width:3px;
  stroke-linejoin:round;
}
.chart-caption{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  align-items:center;
  margin-top:8px;
  color:#6f899a;
  font-size:12px;
  line-height:1.5;
}
.chart-caption span{
  border:1px solid #1e3445;
  background:#101923;
  padding:4px 7px;
}
.sig-box{
  fill:#061018;
  stroke:#00d9ff;
  stroke-width:1.2;
  opacity:.97;
}
.label-guide{stroke-width:1.4;stroke-dasharray:3 3;opacity:.85}

`;

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function saveLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function getStockName(code, fallback, stocks) {
  return fallback || stocks.find((s) => s.code === code)?.name || code || "-";
}

async function fetchJson(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, options);
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}\n${text.slice(0, 700)}`);
  if (!type.includes("application/json")) throw new Error(`JSON이 아닌 응답입니다.\n${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function fmtPrice(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return Number(v).toLocaleString("ko-KR");
}

function fmtMoney(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return `${Number(v).toLocaleString("ko-KR")}원`;
}

function fmtRate(v) {
  const n = Number(v || 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function calcSignal(q) {
  const r = Number(q?.changeRate || 0);
  const score = Math.max(0, Math.min(100, Math.round(60 + r * 5)));
  let tech = "중립";
  let action = "관찰";
  let color = "#ffd447";
  if (r >= 5) {
    tech = "강세";
    action = "과열 주의 / 눌림 대기";
    color = "#00ff88";
  } else if (r >= 1) {
    tech = "양호";
    action = "관심 후보";
    color = "#00ff88";
  } else if (r <= -2) {
    tech = "약세";
    action = "리스크 관리";
    color = "#ff4466";
  }
  return { score, tech, action, color };
}

function calcValueScore(s, q) {
  const rate = Number(q?.changeRate || 0);
  const per = Number(q?.per || 0);
  const pbr = Number(q?.pbr || 0);
  const high52 = Number(q?.w52High || q?.week52High || q?.high52 || 0);
  const low52 = Number(q?.w52Low || q?.week52Low || q?.low52 || 0);
  const price = Number(q?.price || 0);
  const volume = Number(q?.volume || 0);

  let score = 35;
  const tags = [];

  if (per > 0 && per <= 12) { score += 18; tags.push("저PER"); }
  else if (per > 0 && per <= 18) { score += 8; tags.push("PER 보통"); }

  if (pbr > 0 && pbr <= 1.2) { score += 18; tags.push("저PBR"); }
  else if (pbr > 0 && pbr <= 2) { score += 8; tags.push("PBR 보통"); }

  if (price > 0 && low52 > 0) {
    const nearLow = ((price - low52) / low52) * 100;
    if (nearLow <= 15) { score += 16; tags.push("52주 저점 근접"); }
    else if (nearLow <= 30) { score += 8; tags.push("저점권"); }
  } else {
    score += 6;
    tags.push("52주 데이터 대기");
  }

  if (rate > -1 && rate < 3) { score += 10; tags.push("반등 준비권"); }
  if (rate >= 1) { score += 8; tags.push("돌파 시도"); }
  if (volume > 0) { score += 6; tags.push("거래량 확인"); }

  const npsGuess = ["005930", "000660", "000270", "006400", "373220"].includes(s.code);
  if (npsGuess) { score += 10; tags.push("국민연금 관심권"); }

  const label = score >= 78 ? "저평가 + 기술적 반등 준비" : score >= 62 ? "관심 후보" : "관찰";
  return { score: Math.min(100, score), label, tags: tags.join(" · ") || "데이터 확인 중" };
}

function buildScreener(quotes, stocks) {
  return stocks.map((s) => {
    const q = quotes[s.code] || {};
    const rate = Number(q?.changeRate || 0);
    let score = 50;
    const reasons = [];
    if (rate >= 1) { score += 20; reasons.push("상승 모멘텀"); }
    if (rate >= 5) { score -= 10; reasons.push("단기 과열 주의"); }
    if (rate < -2) { score -= 15; reasons.push("약세 구간"); }
    if (Number(q?.volume || 0) > 0) { score += 10; reasons.push("거래량 확인"); }
    if (Number(q?.per || 0) > 0 || Number(q?.pbr || 0) > 0) { score += 10; reasons.push("밸류 지표 존재"); }
    if (score >= 80) reasons.unshift("유망 종목");
    else if (score >= 65) reasons.unshift("관심 종목");
    else reasons.unshift("관찰 종목");
    return { code: s.code, name: getStockName(s.code, q.name || s.name, stocks), price: q.price, rate, score: Math.max(0, Math.min(100, score)), action: calcSignal(q).action, reasons: reasons.join(" · ") };
  }).sort((a, b) => b.score - a.score);
}


function searchStockCatalog(keyword, currentStocks = []) {
  const raw = String(keyword || "").trim();
  const q = raw.toLowerCase();
  const compactQ = q.replace(/\s+/g, "");
  if (!q) return [];

  const aliases = {
    "롯데케미칼": ["롯데케미칼", "롯데 케미칼", "lottechemical", "lotte chem", "lotte chemical", "롯케"],
    "LG에너지솔루션": ["lg에너지솔루션", "엘지에너지솔루션", "lg엔솔", "엘지엔솔"],
    "SK하이닉스": ["sk하이닉스", "에스케이하이닉스", "하이닉스"],
    "삼성전자": ["삼성전자", "삼전"],
    "한미반도체": ["한미반도체", "한미"],
    "POSCO홀딩스": ["posco홀딩스", "포스코홀딩스", "포홀"],
  };

  const merged = new Map();
  [...KOREAN_STOCK_CATALOG, ...currentStocks].forEach((s) => {
    if (s?.code) merged.set(s.code, s);
  });

  return Array.from(merged.values())
    .filter((s) => {
      const code = String(s.code || "");
      const name = String(s.name || "").toLowerCase();
      const tag = String(s.tag || "").toLowerCase();
      const sector = String(s.sector || "").toLowerCase();
      const nameCompact = name.replace(/\s+/g, "");
      const aliasList = aliases[s.name] || [];
      const aliasHit = aliasList.some((a) => {
        const aa = String(a).toLowerCase();
        const aaCompact = aa.replace(/\s+/g, "");
        return aa.includes(q) || aaCompact.includes(compactQ) || compactQ.includes(aaCompact);
      });

      return (
        code.includes(q) ||
        name.includes(q) ||
        nameCompact.includes(compactQ) ||
        tag.includes(q) ||
        sector.includes(q) ||
        aliasHit
      );
    })
    .slice(0, 12);
}

function resolveStockInput(input, currentStocks = []) {
  const q = String(input || "").trim();
  const code = normalizeCode(q);
  if (code.length === 6) {
    const found = [...currentStocks, ...KOREAN_STOCK_CATALOG].find((s) => s.code === code);
    return found || { code, name: code, tag: "사용자추가", sector: "사용자추가" };
  }
  const exact = searchStockCatalog(q, currentStocks).find((s) => s.name === q);
  return exact || searchStockCatalog(q, currentStocks)[0] || null;
}

function parseChartDateValue(value, fallbackIndex = 0) {
  const s = String(value ?? "").trim();

  // KIS style: 20260526
  if (/^\d{8}$/.test(s)) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`).getTime();
  }

  // YYYYMM
  if (/^\d{6}$/.test(s)) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-01T00:00:00`).getTime();
  }

  // Unix timestamp seconds / milliseconds
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{13}$/.test(s)) return Number(s);

  const t = Date.parse(s);
  return Number.isFinite(t) ? t : fallbackIndex;
}

function normalizeHistoryResponse(raw) {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.candles)
          ? raw.candles
          : Array.isArray(raw?.ohlcv)
            ? raw.ohlcv
            : [];

  const normalized = source
    .map((d, idx) => {
      const open = Number(d.open ?? d.o ?? d.stck_oprc ?? d.openPrice ?? d.start ?? 0);
      const high = Number(d.high ?? d.h ?? d.stck_hgpr ?? d.highPrice ?? 0);
      const low = Number(d.low ?? d.l ?? d.stck_lwpr ?? d.lowPrice ?? 0);
      const close = Number(d.close ?? d.c ?? d.stck_clpr ?? d.price ?? d.closePrice ?? 0);
      const volume = Number(d.volume ?? d.v ?? d.acml_vol ?? d.vol ?? 0);
      const date = d.date ?? d.time ?? d.t ?? d.stck_bsop_date ?? d.localDate ?? d.x ?? `D-${idx}`;
      if (!open || !high || !low || !close) return null;
      return {
        date: String(date),
        open,
        high,
        low,
        close,
        volume,
        _order: idx,
        _time: parseChartDateValue(date, idx),
      };
    })
    .filter(Boolean)
    // 핵심 수정: API가 최신순으로 내려와도 무조건 과거 → 최신 순으로 정렬
    // 그래야 차트에서 최신 봉이 항상 우측에 표시됩니다.
    .sort((a, b) => {
      if (a._time !== b._time) return a._time - b._time;
      return a._order - b._order;
    })
    .map(({ _order, _time, ...d }) => d);

  return normalized.slice(-2600);
}

function makeFallbackHistory(selected, length = 180) {
  const price = Number(selected?.price || 100000);
  const today = new Date();

  return Array.from({ length }, (_, i) => {
    const t = i / Math.max(1, length - 1);
    const baseTrend = 0.82 + t * 0.32;
    const cycle = Math.sin(i / 7) * 0.035 + Math.cos(i / 17) * 0.025;
    const pullback = i > length * 0.68 ? -0.12 * ((i - length * 0.68) / (length * 0.32)) : 0;
    const close = Math.max(1, price * (baseTrend + cycle + pullback));
    const open = close * (1 + Math.sin(i / 3) * 0.012);
    const high = Math.max(open, close) * (1.012 + (i % 5) * 0.0025);
    const low = Math.min(open, close) * (0.988 - (i % 4) * 0.0018);
    const d = new Date(today);
    d.setDate(today.getDate() - (length - i));
    return {
      date: d.toISOString().slice(0, 10),
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
      volume: Math.round(100000 + i * 3400 + Math.abs(Math.sin(i / 5)) * 120000),
      fallback: true,
    };
  });
}

function calcMA(data, period) {
  return data.map((d, i) => {
    if (i + 1 < period) return null;
    const slice = data.slice(i + 1 - period, i + 1);
    return slice.reduce((sum, x) => sum + x.close, 0) / period;
  });
}

function findLowerHighTrend(data) {
  if (!data || data.length < 8) return null;
  const pivots = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (data[i].high >= data[i - 1].high && data[i].high >= data[i - 2].high && data[i].high >= data[i + 1].high && data[i].high >= data[i + 2].high) {
      pivots.push({ index: i, value: data[i].high, date: data[i].date });
    }
  }
  for (let b = pivots.length - 1; b >= 1; b--) {
    for (let a = b - 1; a >= 0; a--) {
      if (pivots[a].value > pivots[b].value && pivots[b].index - pivots[a].index >= 5) return { p1: pivots[a], p2: pivots[b] };
    }
  }
  return pivots.length >= 2 ? { p1: pivots[pivots.length - 2], p2: pivots[pivots.length - 1] } : null;
}

function projectTrendValue(trend, targetIndex) {
  if (!trend) return null;
  const { p1, p2 } = trend;
  const slope = (p2.value - p1.value) / Math.max(1, p2.index - p1.index);
  return p1.value + slope * (targetIndex - p1.index);
}


function findGoGoJeoTrend(data) {
  if (!data || data.length < 10) return null;

  const pivots = [];
  for (let i = 2; i < data.length - 2; i++) {
    const isPivotHigh =
      data[i].high >= data[i - 1].high &&
      data[i].high >= data[i - 2].high &&
      data[i].high >= data[i + 1].high &&
      data[i].high >= data[i + 2].high;

    if (isPivotHigh) {
      pivots.push({ index: i, value: data[i].high, date: data[i].date });
    }
  }

  if (!pivots.length) {
    const maxIndex = data.reduce((best, d, i) => (d.high > data[best].high ? i : best), 0);
    pivots.push({ index: maxIndex, value: data[maxIndex].high, date: data[maxIndex].date });
  }

  const highest = pivots.reduce((best, p) => (p.value > best.value ? p : best), pivots[0]);
  const after = pivots.filter((p) => p.index > highest.index + 3);

  let second = after.find((p) => p.value < highest.value);
  if (!second && after.length) second = after[0];

  if (!second) {
    const tailStart = Math.min(data.length - 1, highest.index + Math.max(5, Math.floor((data.length - highest.index) / 2)));
    let bestIdx = tailStart;
    for (let i = tailStart; i < data.length; i++) {
      if (data[i].high > data[bestIdx].high) bestIdx = i;
    }
    second = { index: bestIdx, value: data[bestIdx].high, date: data[bestIdx].date };
  }

  if (!second || second.index <= highest.index) return null;

  return { p1: highest, p2: second };
}

function countByPeriod(period, range) {
  if (period === "D") {
    if (range === "6M") return 130;
    if (range === "1Y") return 260;
    if (range === "3Y") return 780;
    if (range === "5Y") return 1300;
    if (range === "10Y") return 2600;
    return 780;
  }
  if (period === "M") {
    if (range === "1Y") return 12;
    if (range === "3Y") return 36;
    if (range === "5Y") return 60;
    if (range === "10Y") return 120;
    return 60;
  }
  if (period === "Y") {
    if (range === "3Y") return 3;
    if (range === "5Y") return 5;
    return 10;
  }
  return 260;
}


function calcRSI(data, period = 14) {
  if (!data || data.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = data.length - period; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function avgVolume(data, period = 20) {
  if (!data || !data.length) return 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, d) => sum + Number(d.volume || 0), 0) / Math.max(1, slice.length);
}

function calcChartMethodSignals(data, trend, ma20, ma60) {
  const last = data[data.length - 1] || {};
  const prev = data[data.length - 2] || last;
  const currentClose = Number(last.close || 0);
  const currentLow = Number(last.low || 0);
  const currentHigh = Number(last.high || 0);
  const prevClose = Number(prev.close || 0);
  const ma20Last = Number(ma20[ma20.length - 1] || 0);
  const ma60Last = Number(ma60[ma60.length - 1] || 0);
  const volAvg20 = avgVolume(data, 20);
  const volumeRatio = volAvg20 > 0 ? Number(last.volume || 0) / volAvg20 : 0;
  const rsi14 = calcRSI(data, 14);
  const trendLineNow = trend ? projectTrendValue(trend, data.length - 1) : null;
  const trendLinePrev = trend ? projectTrendValue(trend, data.length - 2) : null;

  const closeBreak = trendLineNow ? currentClose >= trendLineNow : false;
  const lowHold = trendLineNow ? currentLow >= trendLineNow : false;
  const prevBelow = trendLinePrev ? prevClose < trendLinePrev : false;
  const freshBreak = closeBreak && prevBelow;
  const distanceToGJ = trendLineNow ? ((currentClose - trendLineNow) / trendLineNow) * 100 : 0;
  const maBull = ma20Last && ma60Last ? ma20Last >= ma60Last : false;
  const above20 = ma20Last ? currentClose >= ma20Last : false;
  const above60 = ma60Last ? currentClose >= ma60Last : false;
  const candlePower = currentHigh > currentLow ? ((currentClose - currentLow) / (currentHigh - currentLow)) * 100 : 50;

  let score = 50;
  if (closeBreak) score += 18;
  if (freshBreak) score += 12;
  if (lowHold) score += 8;
  if (above20) score += 8;
  if (above60) score += 6;
  if (maBull) score += 6;
  if (volumeRatio >= 1.5) score += 8;
  if (rsi14 && rsi14 >= 45 && rsi14 <= 65) score += 4;
  if (rsi14 && rsi14 > 75) score -= 8;
  if (!closeBreak && distanceToGJ < -3) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let phase = "관찰";
  if (freshBreak && lowHold && volumeRatio >= 1.2) phase = "고고저 신규 돌파";
  else if (closeBreak && lowHold) phase = "돌파 후 유지";
  else if (distanceToGJ >= -2 && distanceToGJ < 0) phase = "돌파 임박";
  else if (above20 && !closeBreak) phase = "20선 지지 확인";
  else if (!above20) phase = "눌림 또는 약세";

  let action = "관찰";
  if (phase === "고고저 신규 돌파") action = "분할 매수 후보. 종가 유지와 거래량 동반 확인";
  else if (phase === "돌파 후 유지") action = "보유/추가 관찰. 저가가 추세선 위에서 유지되는지 확인";
  else if (phase === "돌파 임박") action = "추격 금지. 돌파봉 종가 확인 후 접근";
  else if (phase === "20선 지지 확인") action = "20선 이탈 손절 기준으로 눌림 확인";
  else action = "현금 비중 유지. 반등 신호 대기";

  return {
    score,
    phase,
    action,
    closeBreak,
    lowHold,
    freshBreak,
    distanceToGJ,
    volumeRatio,
    rsi14,
    maBull,
    above20,
    above60,
    candlePower,
    trendLineNow,
  };
}


function calculateGogojeoSignal(candles, options = {}) {
  const lookback = options.lookback || 120;
  const swingWindow = options.swingWindow || 5;
  const minGap = options.minGap || 10;

  const data = candles.slice(-lookback);

  if (data.length < 60) {
    return {
      status: "ERROR",
      message: "데이터가 부족합니다. 최소 60봉 이상 필요합니다."
    };
  }

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function movingAverage(index, period, field = "close") {
    if (index < period - 1) return null;
    const slice = data.slice(index - period + 1, index + 1);
    return avg(slice.map(d => Number(d[field])));
  }

  function findSwingHighs() {
    const highs = [];

    for (let i = swingWindow; i < data.length - swingWindow; i++) {
      const currentHigh = Number(data[i].high);
      let isSwingHigh = true;

      for (let j = i - swingWindow; j <= i + swingWindow; j++) {
        if (j !== i && Number(data[j].high) >= currentHigh) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        highs.push({
          index: i,
          date: data[i].date,
          price: currentHigh
        });
      }
    }

    return highs;
  }

  function findSwingLows() {
    const lows = [];

    for (let i = swingWindow; i < data.length - swingWindow; i++) {
      const currentLow = Number(data[i].low);
      let isSwingLow = true;

      for (let j = i - swingWindow; j <= i + swingWindow; j++) {
        if (j !== i && Number(data[j].low) <= currentLow) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        lows.push({
          index: i,
          date: data[i].date,
          price: currentLow
        });
      }
    }

    return lows;
  }

  const swingHighs = findSwingHighs();
  const swingLows = findSwingLows();

  if (swingHighs.length < 2) {
    return {
      status: "NO_SIGNAL",
      message: "유효한 스윙 고점이 부족합니다."
    };
  }

  let selectedHigh1 = null;
  let selectedHigh2 = null;

  for (let i = swingHighs.length - 2; i >= 0; i--) {
    for (let j = swingHighs.length - 1; j > i; j--) {
      const h1 = swingHighs[i];
      const h2 = swingHighs[j];

      if (
        h1.price > h2.price &&
        h2.index - h1.index >= minGap
      ) {
        selectedHigh1 = h1;
        selectedHigh2 = h2;
        break;
      }
    }

    if (selectedHigh1 && selectedHigh2) break;
  }

  if (!selectedHigh1 || !selectedHigh2) {
    return {
      status: "NO_SIGNAL",
      message: "하락 추세선을 만들 수 있는 고점 구조가 없습니다."
    };
  }

  const lastIndex = data.length - 1;
  const lastCandle = data[lastIndex];

  const slope =
    (selectedHigh2.price - selectedHigh1.price) /
    (selectedHigh2.index - selectedHigh1.index);

  const trendLinePrice =
    selectedHigh1.price + slope * (lastIndex - selectedHigh1.index);

  const close = Number(lastCandle.close);
  const high = Number(lastCandle.high);
  const low = Number(lastCandle.low);
  const volume = Number(lastCandle.volume);

  const ma5 = movingAverage(lastIndex, 5);
  const ma20 = movingAverage(lastIndex, 20);

  const avgVolume20 = avg(
    data.slice(lastIndex - 19, lastIndex + 1).map(d => Number(d.volume))
  );

  const breakoutRate = ((close - trendLinePrice) / trendLinePrice) * 100;
  const isBreakout = close > trendLinePrice;
  const isStrongBreakout = breakoutRate >= 3;
  const isVolumeSpike = volume >= avgVolume20 * 1.5;
  const isAboveMA20 = close > ma20;
  const isMAAligned = ma5 > ma20;

  const recentSwingLow = swingLows
    .filter(l => l.index < lastIndex)
    .slice(-1)[0];

  const isLowProtected = recentSwingLow ? low > recentSwingLow.price : false;

  const closePosition =
    high === low ? 0 : ((close - low) / (high - low)) * 100;

  const isStrongClose = closePosition >= 70;

  let score = 0;

  if (isBreakout) score += 20;
  if (isStrongBreakout) score += 15;
  if (isVolumeSpike) score += 20;
  if (isAboveMA20) score += 10;
  if (isMAAligned) score += 10;
  if (isLowProtected) score += 15;
  if (isStrongClose) score += 10;

  let grade = "제외";

  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "고고저",
    score,
    grade,
    close,
    trendLinePrice: Math.round(trendLinePrice),
    breakoutRate: Number(breakoutRate.toFixed(2)),
    volume,
    avgVolume20: Math.round(avgVolume20),
    ma5: Math.round(ma5),
    ma20: Math.round(ma20),
    selectedHigh1,
    selectedHigh2,
    recentSwingLow,
    checks: {
      isBreakout,
      isStrongBreakout,
      isVolumeSpike,
      isAboveMA20,
      isMAAligned,
      isLowProtected,
      isStrongClose
    }
  };
}

function normalizeGogojeoForChart(signal, chartData) {
  if (!signal || signal.status !== "OK") return null;
  const dataLength = chartData.length;
  const offset = Math.max(0, dataLength - (signal.selectedHigh2?.index ?? 0) - 1);
  return {
    status: signal.status,
    score: signal.score,
    grade: signal.grade,
    trendLinePrice: signal.trendLinePrice,
    breakoutRate: signal.breakoutRate,
    selectedHigh1: signal.selectedHigh1,
    selectedHigh2: signal.selectedHigh2,
    recentSwingLow: signal.recentSwingLow,
    checks: signal.checks,
  };
}

function gogojeoGradeColor(grade) {
  if (grade === "강한 매수 후보") return "up";
  if (grade === "관심 종목") return "up";
  if (grade === "관찰") return "";
  return "down";
}

function safeAvg(values) {
  const arr = values.map(Number).filter((v) => Number.isFinite(v));
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stdDev(values) {
  const arr = values.map(Number).filter((v) => Number.isFinite(v));
  if (!arr.length) return 0;
  const mean = safeAvg(arr);
  return Math.sqrt(safeAvg(arr.map((v) => Math.pow(v - mean, 2))));
}

function lastN(data, n) {
  return data.slice(Math.max(0, data.length - n));
}

function calculateMaPullbackSignal(candles) {
  if (!candles || candles.length < 60) {
    return { status: "ERROR", signalName: "이동평균 눌림", score: 0, grade: "제외", message: "최소 60봉 이상 필요합니다." };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const ma5 = safeAvg(lastN(candles, 5).map((d) => d.close));
  const ma20 = safeAvg(lastN(candles, 20).map((d) => d.close));
  const ma60 = safeAvg(lastN(candles, 60).map((d) => d.close));
  const close = Number(last.close);
  const low = Number(last.low);
  const high = Number(last.high);
  const prevClose = Number(prev.close);
  const volume = Number(last.volume || 0);
  const avgVol20 = safeAvg(lastN(candles, 20).map((d) => d.volume || 0));
  const ma20Gap = ma20 ? ((close - ma20) / ma20) * 100 : 0;

  const nearMa20 = ma20 ? Math.abs(ma20Gap) <= 3 : false;
  const touchedMa20 = ma20 ? low <= ma20 * 1.01 && high >= ma20 * 0.99 : false;
  const bounced = ma20 ? close > ma20 && prevClose <= ma20 * 1.02 : false;
  const maAligned = ma5 >= ma20 && ma20 >= ma60;
  const volumeConfirm = avgVol20 ? volume >= avgVol20 * 1.1 : false;
  const candleCloseStrong = high === low ? false : ((close - low) / (high - low)) * 100 >= 60;

  let score = 0;
  if (nearMa20) score += 20;
  if (touchedMa20) score += 20;
  if (bounced) score += 20;
  if (maAligned) score += 20;
  if (volumeConfirm) score += 10;
  if (candleCloseStrong) score += 10;

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "이동평균 눌림",
    score,
    grade,
    ma5: Math.round(ma5),
    ma20: Math.round(ma20),
    ma60: Math.round(ma60),
    ma20Gap: Number(ma20Gap.toFixed(2)),
    checks: { nearMa20, touchedMa20, bounced, maAligned, volumeConfirm, candleCloseStrong },
    action: grade === "강한 매수 후보" || grade === "관심 종목"
      ? "20일선 이탈을 손절 기준으로 분할 접근"
      : "20일선 재지지와 거래량 확인 대기",
  };
}

function calculateBollingerSqueezeSignal(candles) {
  if (!candles || candles.length < 60) {
    return { status: "ERROR", signalName: "볼린저 수축", score: 0, grade: "제외", message: "최소 60봉 이상 필요합니다." };
  }

  const closes = candles.map((d) => Number(d.close));
  const last = candles[candles.length - 1];
  const close = Number(last.close);
  const ma20 = safeAvg(lastN(candles, 20).map((d) => d.close));
  const sd20 = stdDev(lastN(candles, 20).map((d) => d.close));
  const upper = ma20 + sd20 * 2;
  const lower = ma20 - sd20 * 2;
  const bandwidth = ma20 ? ((upper - lower) / ma20) * 100 : 0;
  const priorWidths = [];
  for (let i = 20; i < candles.length; i++) {
    const window = candles.slice(Math.max(0, i - 19), i + 1);
    const m = safeAvg(window.map((d) => d.close));
    const s = stdDev(window.map((d) => d.close));
    priorWidths.push(m ? (((m + s * 2) - (m - s * 2)) / m) * 100 : 0);
  }
  const widthAvg = safeAvg(priorWidths);
  const isSqueeze = widthAvg ? bandwidth <= widthAvg * 0.75 : false;
  const upperBreak = close > upper;
  const midSupport = close > ma20;
  const volume = Number(last.volume || 0);
  const avgVol20 = safeAvg(lastN(candles, 20).map((d) => d.volume || 0));
  const volumeConfirm = avgVol20 ? volume >= avgVol20 * 1.3 : false;
  const rsi = calcRSI(candles, 14);
  const notOverheated = !rsi || rsi < 75;

  let score = 0;
  if (isSqueeze) score += 30;
  if (upperBreak) score += 25;
  if (midSupport) score += 15;
  if (volumeConfirm) score += 20;
  if (notOverheated) score += 10;

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "볼린저 수축",
    score,
    grade,
    upper: Math.round(upper),
    mid: Math.round(ma20),
    lower: Math.round(lower),
    bandwidth: Number(bandwidth.toFixed(2)),
    rsi,
    checks: { isSqueeze, upperBreak, midSupport, volumeConfirm, notOverheated },
    action: upperBreak && volumeConfirm ? "상단 돌파 후 눌림 확인" : "수축 후 방향성 돌파 대기",
  };
}

function calculateVolumeBreakoutSignal(candles) {
  if (!candles || candles.length < 60) {
    return { status: "ERROR", signalName: "거래량 돌파", score: 0, grade: "제외", message: "최소 60봉 이상 필요합니다." };
  }

  const last = candles[candles.length - 1];
  const prevHigh = Math.max(...candles.slice(-21, -1).map((d) => Number(d.high)));
  const close = Number(last.close);
  const high = Number(last.high);
  const low = Number(last.low);
  const volume = Number(last.volume || 0);
  const avgVol20 = safeAvg(lastN(candles, 20).map((d) => d.volume || 0));
  const breakout = close > prevHigh;
  const intradayBreakout = high > prevHigh;
  const volumeSpike = avgVol20 ? volume >= avgVol20 * 1.5 : false;
  const strongClose = high === low ? false : ((close - low) / (high - low)) * 100 >= 70;
  const ma20 = safeAvg(lastN(candles, 20).map((d) => d.close));
  const aboveMa20 = close > ma20;

  let score = 0;
  if (breakout) score += 30;
  if (intradayBreakout) score += 15;
  if (volumeSpike) score += 25;
  if (strongClose) score += 15;
  if (aboveMa20) score += 15;

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "거래량 돌파",
    score,
    grade,
    prevHigh: Math.round(prevHigh),
    volume,
    avgVol20: Math.round(avgVol20),
    checks: { breakout, intradayBreakout, volumeSpike, strongClose, aboveMa20 },
    action: breakout && volumeSpike ? "돌파 후 전고점 지지 확인" : "전고점 돌파와 거래량 동반 확인 대기",
  };
}

function calculateRsiReversalSignal(candles) {
  if (!candles || candles.length < 60) {
    return { status: "ERROR", signalName: "RSI 반등", score: 0, grade: "제외", message: "최소 60봉 이상 필요합니다." };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const rsi = calcRSI(candles, 14);
  const prevRsi = calcRSI(candles.slice(0, -1), 14);
  const close = Number(last.close);
  const prevClose = Number(prev.close);
  const ma20 = safeAvg(lastN(candles, 20).map((d) => d.close));
  const volume = Number(last.volume || 0);
  const avgVol20 = safeAvg(lastN(candles, 20).map((d) => d.volume || 0));

  const oversoldRecover = rsi !== null && prevRsi !== null && prevRsi < 35 && rsi >= 35;
  const rsiUp = rsi !== null && prevRsi !== null && rsi > prevRsi;
  const priceUp = close > prevClose;
  const reclaimMa20 = ma20 ? close > ma20 : false;
  const volumeConfirm = avgVol20 ? volume >= avgVol20 : false;
  const notOverbought = rsi === null || rsi < 70;

  let score = 0;
  if (oversoldRecover) score += 30;
  if (rsiUp) score += 20;
  if (priceUp) score += 15;
  if (reclaimMa20) score += 15;
  if (volumeConfirm) score += 10;
  if (notOverbought) score += 10;

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "RSI 반등",
    score,
    grade,
    rsi,
    prevRsi,
    checks: { oversoldRecover, rsiUp, priceUp, reclaimMa20, volumeConfirm, notOverbought },
    action: oversoldRecover ? "과매도 회복 초입. 직전 저점 이탈 시 철수" : "RSI 방향 전환 확인 대기",
  };
}

function normalizeTechniqueSignal(key, signal) {
  const gradeScore =
    signal.grade === "강한 매수 후보" ? 3 :
    signal.grade === "관심 종목" ? 2 :
    signal.grade === "관찰" ? 1 : 0;

  return {
    key,
    name: signal.signalName || key,
    status: signal.status,
    score: Number(signal.score || 0),
    grade: signal.grade || signal.status || "제외",
    gradeScore,
    action: signal.action || signal.message || "관찰",
    raw: signal,
  };
}

function recommendChartTechniques(candles, gogoSignal) {
  const signals = [
    normalizeTechniqueSignal("gogojeo", { ...gogoSignal, signalName: "고고저" }),
    normalizeTechniqueSignal("maPullback", calculateMaPullbackSignal(candles)),
    normalizeTechniqueSignal("bollinger", calculateBollingerSqueezeSignal(candles)),
    normalizeTechniqueSignal("volumeBreakout", calculateVolumeBreakoutSignal(candles)),
    normalizeTechniqueSignal("rsiReversal", calculateRsiReversalSignal(candles)),
  ];

  const ranked = signals
    .map((s) => ({
      ...s,
      aiRankScore: s.score + s.gradeScore * 8 + (s.status === "OK" ? 5 : -20),
    }))
    .sort((a, b) => b.aiRankScore - a.aiRankScore);

  return {
    recommended: ranked[0],
    ranked,
    reason: ranked[0]
      ? `${ranked[0].name} 점수 ${ranked[0].score}점, 등급 ${ranked[0].grade}로 현재 차트에 가장 적합합니다.`
      : "추천 가능한 차트 기법이 없습니다.",
  };
}

function techniqueDescription(key) {
  const map = {
    auto: "AI가 현재 차트에 가장 적합한 기법을 자동 선택합니다.",
    gogojeo: "고점①과 이후 낮은 고점②를 연결한 하락 추세선 돌파 여부를 봅니다.",
    maPullback: "20일선 눌림, MA5/MA20/MA60 정렬, 지지 후 반등을 봅니다.",
    bollinger: "볼린저 밴드 수축 후 상단 돌파와 거래량 동반 여부를 봅니다.",
    volumeBreakout: "최근 20봉 전고점 돌파와 거래량 급증을 봅니다.",
    rsiReversal: "RSI 과매도 회복, 가격 반등, 20일선 회복을 봅니다.",
  };
  return map[key] || "";
}

async function fetchChartHistory(code, period = "D", range = "1Y", selected = null) {
  const count = countByPeriod(period, range);
  const paths = [
    `/api/chart/${code}?period=${period}&count=${count}&range=${range}&analyze=1`,
    `/api/history/${code}?period=${period}&count=${count}&range=${range}`,
    `/api/ohlcv/${code}?period=${period}&count=${count}&range=${range}`,
  ];

  for (const path of paths) {
    try {
      const data = normalizeHistoryResponse(await fetchJson(path));
      if (data.length >= 60) return { data, source: path, fallback: false };
      if (data.length >= 10) {
        const pad = makeFallbackHistory({ ...selected, price: data[data.length - 1]?.close || selected?.price }, Math.max(60, count - data.length));
        return {
          data: [...pad.slice(0, Math.max(0, 60 - data.length)), ...data],
          source: `${path} + 보강데이터`,
          fallback: true,
        };
      }
    } catch (e) {
      console.warn("chart history fallback", path, e);
    }
  }

  return { data: makeFallbackHistory(selected, Math.max(60, Math.min(count, 180))), source: "fallback-generated", fallback: true };
}


function nextGogoSearchPlan(period, range) {
  if (period === "D") {
    if (range === "6M") return { period: "D", range: "1Y", label: "일봉 1년" };
    if (range === "1Y") return { period: "D", range: "3Y", label: "일봉 3년" };
    if (range === "3Y") return { period: "D", range: "5Y", label: "일봉 5년" };
    if (range === "5Y") return { period: "D", range: "10Y", label: "일봉 10년" };
  }
  if (period === "M") {
    if (range === "1Y") return { period: "M", range: "3Y", label: "월봉 3년" };
    if (range === "3Y") return { period: "M", range: "5Y", label: "월봉 5년" };
    if (range === "5Y") return { period: "M", range: "10Y", label: "월봉 10년" };
  }
  return { period: "D", range: "5Y", label: "일봉 5년" };
}

async function fetchExtendedGogoHistory(code, period, range, selected = null) {
  const plans = [];
  const first = nextGogoSearchPlan(period, range);
  if (first) plans.push(first);
  if (!plans.some((p) => p.period === "D" && p.range === "5Y")) plans.push({ period: "D", range: "5Y", label: "일봉 5년" });
  if (!plans.some((p) => p.period === "D" && p.range === "10Y")) plans.push({ period: "D", range: "10Y", label: "일봉 10년" });
  if (!plans.some((p) => p.period === "M" && p.range === "10Y")) plans.push({ period: "M", range: "10Y", label: "월봉 10년" });

  for (const plan of plans) {
    const res = await fetchChartHistory(code, plan.period, plan.range, selected);
    const data = res.data || [];
    if (data.length >= 60) {
      const signal = calculateGogojeoSignal(data, {
        lookback: Math.min(data.length, countByPeriod(plan.period, plan.range)),
        swingWindow: plan.period === "D" ? 5 : 2,
        minGap: plan.period === "D" ? 10 : 2,
      });

      if (signal.status === "OK") {
        return {
          ...res,
          data,
          period: plan.period,
          range: plan.range,
          label: plan.label,
          autoExtended: true,
          extendedSignal: signal,
          message: `${plan.label} 데이터까지 확장하여 고고저 구조를 찾았습니다.`,
        };
      }
    }
  }

  return null;
}




async function fetchGlobalQuotes() {
  const pairs = await Promise.all(
    GLOBAL_TICKERS.map(async (t) => {
      const endpoint = t.type === "crypto" ? `/api/crypto/quote/${t.symbol}` : `/api/us/quote/${t.symbol}`;
      try {
        const q = await fetchJson(endpoint);
        return {
          ...t,
          price: q.price ?? q.c ?? q.close,
          changeRate: q.changeRate ?? q.changePercent ?? q.dp ?? 0,
          changeStr: q.changeStr || fmtRate(q.changeRate ?? q.changePercent ?? q.dp ?? 0),
          source: endpoint,
          realtime: true,
        };
      } catch {
        const demo = DEMO_TICKERS.find((d) => d.s === t.symbol);
        return {
          ...t,
          priceText: demo?.p || "-",
          changeStr: demo?.ch || "0.00%",
          changeRate: demo?.up ? 1 : -1,
          realtime: false,
          source: "DEMO",
        };
      }
    })
  );
  return pairs;
}

function fmtGlobalPrice(item) {
  if (item.priceText) return item.priceText;
  const p = Number(item.price || 0);
  if (!p) return "-";
  if (item.type === "crypto") return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function ReadMeSection({ title = "READ ME", children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="readme-section">
      <button className="readme-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▼" : "▶"} {title}
      </button>
      {open && <div className="readme-body">{children}</div>}
    </div>
  );
}

function IndicatorReadMe() {
  return (
    <ReadMeSection title="READ ME · 차트 지표 설명">
      <h4>고고저</h4>
      <ul>
        <li>스윙 고점 중 높은 고점①과 이후 낮은 고점②를 연결한 하락 추세선입니다.</li>
        <li>종가가 추세선을 돌파하면 1차 신호, 거래량과 저점 보호가 확인되면 신뢰도가 올라갑니다.</li>
      </ul>
      <h4>이동평균 눌림</h4>
      <ul>
        <li>20선 터치 후 반등, MA5·MA20·MA60 정렬 여부를 확인합니다.</li>
        <li>20선 이탈 시 손절 기준으로 사용하기 쉽습니다.</li>
      </ul>
      <h4>볼린저 수축</h4>
      <ul>
        <li>밴드폭이 줄어든 뒤 상단 돌파와 거래량 증가가 동반되는지 확인합니다.</li>
        <li>변동성 확대 초입을 찾는 데 적합합니다.</li>
      </ul>
      <h4>거래량 돌파</h4>
      <ul>
        <li>최근 전고점 돌파와 20봉 평균 대비 거래량 급증을 함께 봅니다.</li>
        <li>돌파 후 전고점 지지 확인이 중요합니다.</li>
      </ul>
      <h4>RSI 반등</h4>
      <ul>
        <li>과매도 구간에서 RSI가 회복되고 가격이 반등하는지 확인합니다.</li>
        <li>급락 후 기술적 반등 후보를 찾는 데 적합합니다.</li>
      </ul>
    </ReadMeSection>
  );
}

function Header({ now, tab }) {
  return (
    <div className="top-wrap">
      <div className="top">
        <div className="top-left">
          <div className="brand">ALPHA</div>
          <div className="live">● LIVE {now}</div>
        </div>
        <div className="top-right">
          <span className="tag demo">US/CRYPTO DEMO</span>
          <span className="tag green">KRX API</span>
          <span>2026.05.26</span>
        </div>
      </div>
      <div className="mobile-current">현재 화면 · {tab}</div>
    </div>
  );
}

function Nav({ tab, setTab }) {
  const tabs = ["대시보드", "차트 분석", "스크리너", "저평가 스크리너", "포트폴리오", "알림 센터", "AI 리포트", "일일 브리핑", "섹터/테마", "전종목 스캔", "백테스트", "AI 시뮬레이션"];
  return (
    <div className="nav">
      {tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={tab === t ? "active" : ""}>{t}</button>)}
    </div>
  );
}

function TickerBar({ quotes, stocks, globalQuotes = [] }) {
  const live = stocks.slice(0, 8).map((s) => {
    const q = quotes[s.code] || {};
    return {
      s: s.name,
      p: q.price ? fmtPrice(q.price) : "-",
      ch: q.changeStr || fmtRate(q.changeRate),
      up: Number(q.changeRate || 0) >= 0,
      demo: false,
    };
  });

  const global = (globalQuotes.length ? globalQuotes : GLOBAL_TICKERS.map((t) => {
    const demo = DEMO_TICKERS.find((d) => d.s === t.symbol);
    return { ...t, priceText: demo?.p || "-", changeStr: demo?.ch || "0.00%", realtime: false };
  })).map((g) => ({
    s: g.symbol,
    p: fmtGlobalPrice(g),
    ch: g.changeStr || fmtRate(g.changeRate),
    up: Number(g.changeRate || 0) >= 0,
    demo: !g.realtime,
  }));

  return (
    <div className="ticker">
      {[...live, ...global].map((t, i) => (
        <div className="ticker-item" key={`${t.s}-${i}`}>
          <div className="ticker-line1">{t.s}</div>
          <div className="ticker-line2">{t.p}</div>
          <div className={`ticker-line3 ${t.up ? "up" : "down"}`}>
            {t.ch} {t.demo ? <span className="tag demo">DEMO</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScreenFrame({ tab, children }) {
  const desc = {
    "대시보드": "시장 지수와 선택 종목의 실시간 요약을 확인합니다.",
    "차트 분석": "선택 종목의 AI 분석과 차트 시각화를 확인합니다.",
    "스크리너": "실시간 종목을 점수화해 추천 랭킹으로 정리합니다.",
    "저평가 스크리너": "PER/PBR, 52주 저점, 기술적 반등, 국민연금 관심권을 종합합니다.",
    "포트폴리오": "보유 종목 평가손익과 리밸런싱 기준을 계산합니다.",
    "알림 센터": "가격/등락률/AI점수/20일선 조건을 등록하고 판정합니다.",
    "AI 리포트": "분석 결과 확인 후 추가 질문까지 이어서 진행합니다.",
    "일일 브리핑": "아침 8시 자동 리포트 형태의 브리핑 화면입니다.",
    "섹터/테마": "섹터별 강도와 테마 흐름을 계산합니다.",
    "전종목 스캔": "전체 시장 자동 발굴 화면 구조입니다.",
    "백테스트": "신호 발생 후 N일 수익률 검증 화면입니다.",
    "AI 시뮬레이션": "신호 가중치와 학습 결과를 AI 판단에 자동 주입합니다.",
  };
  return (
    <div className="screen-shell" key={tab}>
      <div className="screen-head">
        <div>
          <div className="screen-title">{tab}</div>
          <div className="screen-desc">{desc[tab] || "선택한 화면입니다."}</div>
        </div>
        <span className="tag green">ACTIVE</span>
      </div>
      {children}
    </div>
  );
}

function LeftPanel({ stocks, quotes, selectedCode, setSelectedCode, reload, loading, addStock, removeStock }) {
  const [newStock, setNewStock] = useState({ query: "", code: "", name: "", tag: "" });

  const matches = useMemo(() => {
    return searchStockCatalog(newStock.query, stocks).filter((s) => !stocks.some((x) => x.code === s.code));
  }, [newStock.query, stocks]);

  const pickStock = (s) => {
    setNewStock({
      query: `${s.name} (${s.code})`,
      code: s.code,
      name: s.name,
      tag: s.tag || s.sector || "사용자추가",
    });
  };

  const submitAdd = () => {
    const resolved = newStock.code.length === 6
      ? { code: newStock.code, name: newStock.name || newStock.code, tag: newStock.tag || "사용자추가", sector: newStock.tag || "사용자추가" }
      : resolveStockInput(newStock.query || newStock.name, stocks);

    if (!resolved) return alert("검색 결과가 없습니다. 종목명을 다시 입력하거나 6자리 코드를 입력하세요. 미등록 종목은 6자리 코드로 먼저 추가할 수 있습니다.");

    const code = normalizeCode(resolved.code);
    if (code.length !== 6) return alert("종목코드는 6자리 숫자여야 합니다.");

    addStock({
      code,
      name: newStock.name.trim() || resolved.name || code,
      tag: newStock.tag.trim() || resolved.tag || resolved.sector || "사용자추가",
      sector: resolved.sector || newStock.tag.trim() || resolved.tag || "사용자추가",
    });

    setNewStock({ query: "", code: "", name: "", tag: "" });
  };

  return (
    <div className="grid">
      <div className="panel">
        <div className="panel-title"><span>국내 실시간 종목</span><span className="tag green">{stocks.length}개</span></div>
        <div className="panel-body">
          <div className="stock-list">
            {stocks.map((s) => {
              const q = quotes[s.code] || {};
              const active = selectedCode === s.code;
              const isDefault = DEFAULT_STOCKS.some((d) => d.code === s.code);
              return (
                <button key={s.code} className={`stock-btn ${active ? "active" : ""}`} onClick={() => setSelectedCode(s.code)}>
                  <div className="stock-top">
                    <span className="stock-name">{s.name}</span>
                    <span className={Number(q.changeRate || 0) >= 0 ? "up" : "down"}>{q.price ? (q.changeStr || fmtRate(q.changeRate)) : "-"}</span>
                  </div>
                  <div className="sub">
                    {s.code} · {s.tag}<br />현재가: <b>{q.price ? fmtPrice(q.price) : "조회 중"}</b>
                    {!isDefault && <><br /><span className="pill" onClick={(e) => { e.stopPropagation(); removeStock(s.code); }}>사용자 종목 삭제</span></>}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ height: 10 }} />
          <input
            className="input"
            placeholder="종목명 또는 코드 검색 예: 삼성전자, 한미반도체, 005930"
            value={newStock.query}
            onChange={(e) => {
              const query = e.target.value;
              const resolved = resolveStockInput(query, stocks);
              setNewStock({
                query,
                code: normalizeCode(query).length === 6 ? normalizeCode(query) : "",
                name: resolved?.name || "",
                tag: resolved?.tag || resolved?.sector || "",
              });
            }}
          />

          {newStock.query && matches.length > 0 && (
            <div className="search-results">
              {matches.map((s) => (
                <button type="button" className="search-item" key={s.code} onClick={() => pickStock(s)}>
                  <span><b>{s.name}</b> · {s.code}</span>
                  <span>{s.tag || s.sector}</span>
                </button>
              ))}
            </div>
          )}

          {newStock.query && !matches.length && !newStock.code && (
            <div className="search-empty">등록된 검색 결과가 없습니다. 종목명을 더 정확히 입력하거나 6자리 코드를 입력하세요.</div>
          )}

          <div className="add-stock-grid">
            <input className="input" placeholder="종목코드 자동입력" value={newStock.code} onChange={(e) => setNewStock({ ...newStock, code: normalizeCode(e.target.value) })} />
            <input className="input" placeholder="종목명 자동입력" value={newStock.name} onChange={(e) => setNewStock({ ...newStock, name: e.target.value })} />
            <input className="input" placeholder="분류 자동입력" value={newStock.tag} onChange={(e) => setNewStock({ ...newStock, tag: e.target.value })} />
          </div>
          <div style={{ height: 8 }} />
          <button className="btn full" onClick={submitAdd}>검색 종목 실시간 추가</button>
          <div style={{ height: 8 }} />
          <button className="btn full" onClick={reload}>{loading ? "갱신 중..." : "실시간 시세 새로고침"}</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">연결 상태</div>
        <div className="panel-body sub">API 서버:<br /><b>{API_BASE}</b><br /><br />국내 시세는 KIS API 기준입니다.<br />미국 주식/코인은 현재 DEMO 표기입니다.</div>
      </div>
    </div>
  );
}

function Dashboard({ market, selected, stocks }) {
  const q = selected || {};
  const sig = calcSignal(q);
  return (
    <div className="grid">
      <div className="panel">
        <div className="panel-title">시장 지수</div>
        <div className="panel-body">
          <div className="card-grid">
            {market.map((m) => (
              <div className="card" key={m.name}><div className="card-title">{m.name}</div><div className="value">{m.val}</div><div className={m.up ? "up" : "down"}>{m.ch}</div><div className="sub">{m.sub}</div></div>
            ))}
            {!market.length && <div className="card"><div className="card-title">시장 지수</div><div className="sub">/api/index 조회 대기 또는 오류</div></div>}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">선택 종목 실시간 분석</div>
        <div className="panel-body report-layout">
          <div className="score-box"><div className="score">{sig.score}</div><div className="sub">AI SCORE</div></div>
          <div className="kpi-grid">
            <div className="kpi"><div className="card-title">종목</div><strong>{getStockName(q.code, q.name, stocks)}</strong></div>
            <div className="kpi"><div className="card-title">현재가</div><strong>{q.price ? fmtPrice(q.price) : "-"}</strong></div>
            <div className="kpi"><div className="card-title">등락률</div><strong className={Number(q.changeRate || 0) >= 0 ? "up" : "down"}>{q.changeStr || fmtRate(q.changeRate)}</strong></div>
            <div className="kpi"><div className="card-title">기술 판단</div><strong style={{ color: sig.color }}>{sig.tech}</strong></div>
            <div className="kpi"><div className="card-title">고가 / 저가</div><strong>{q.price ? `${fmtPrice(q.high)} / ${fmtPrice(q.low)}` : "-"}</strong></div>
            <div className="kpi"><div className="card-title">거래량</div><strong>{q.volume ? fmtPrice(q.volume) : "-"}</strong></div>
            <div className="kpi"><div className="card-title">PER / PBR</div><strong>{q.per ?? "-"} / {q.pbr ?? "-"}</strong></div>
            <div className="kpi"><div className="card-title">액션</div><strong>{sig.action}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildAnalysisPrompt(selected, stocks, followup, lastResult) {
  const name = getStockName(selected?.code, selected?.name, stocks);
  const base = `
[종목 데이터]
종목명: ${name}
종목코드: ${selected?.code}
현재가: ${fmtPrice(selected?.price)}
등락률: ${selected?.changeStr || fmtRate(selected?.changeRate)}
고가: ${fmtPrice(selected?.high)}
저가: ${fmtPrice(selected?.low)}
거래량: ${fmtPrice(selected?.volume)}
PER/PBR: ${selected?.per ?? "-"} / ${selected?.pbr ?? "-"}

[학습 가중치]
${WEIGHTS.map((w) => `- ${w.name}: ×${w.weight}, 최근 적중률 ${w.hit}%`).join("\n")}
`;
  if (followup && lastResult) {
    return `${base}\n[기존 분석]\n${lastResult}\n\n[추가 질문]\n${followup}\n\n추가 질문에만 집중해서 조건부 시나리오와 리스크를 포함해 답변하세요.`;
  }
  return `${base}

위 데이터를 기준으로 투자 참고용 단기/스윙 분석 리포트를 작성하세요.
질문을 반복하지 말고 분석 결과만 작성하세요.
특히 아래 차트 분석 로직을 반영하세요.

[차트 분석 로직]
- 고고저: 최근 선택 봉에서 스윙 고점을 찾고, 더 높은 고점①과 이후 낮은 고점②를 연결한 하락 추세선입니다.
- 종가가 고고저 추세선을 돌파하면 1차 신호, 다음 봉 저가가 추세선 위에서 유지되면 2차 확인 신호입니다.
- 20선/60선 위치, 거래량 평균 대비 증가, RSI 과열 여부를 함께 확인합니다.
- 추격 매수보다 종가 돌파, 저가 유지, 거래량 동반 여부를 조건으로 제시합니다.

전체 답변은 1,200자 이내, 완결된 문장으로 작성하세요.

① 종합 판단
② 매수 조건
③ 목표가
④ 손절가
⑤ 리스크
⑥ 최종 전략
`;
}


function buildLocalAnalysis(selected, stocks, reason = "") {
  const name = getStockName(selected?.code, selected?.name, stocks);
  const price = Number(selected?.price || 0);
  const rate = Number(selected?.changeRate || 0);
  const high = Number(selected?.high || 0);
  const low = Number(selected?.low || 0);
  const volume = Number(selected?.volume || 0);
  const per = selected?.per ?? "-";
  const pbr = selected?.pbr ?? "-";
  const sig = calcSignal(selected);

  const buy1 = price ? Math.round(price * 0.985) : "-";
  const buy2 = high ? Math.round(high * 1.01) : "-";
  const target1 = price ? Math.round(price * 1.04) : "-";
  const target2 = price ? Math.round(price * 1.08) : "-";
  const stop = low ? Math.round(low * 0.985) : price ? Math.round(price * 0.96) : "-";

  const quotaNote = reason
    ? `\n※ Gemini API 한도/일시 오류로 로컬 분석 엔진이 대체 작성했습니다. 원인: ${reason.slice(0, 160)}\n`
    : "";

  return `${quotaNote}
① 종합 판단
${name}(${selected?.code})은 현재가 ${fmtPrice(price)}, 등락률 ${fmtRate(rate)} 기준으로 ${sig.tech} 구간입니다. 단기 급등률이 높으면 추격 매수보다 눌림 확인이 우선이고, 약세 구간이면 반등 신호 확인 전까지 관찰이 유리합니다.

② 매수 조건
1차 관심 조건: ${fmtPrice(buy1)}원 부근에서 거래량이 줄며 지지되는지 확인합니다.
돌파 매수 조건: ${fmtPrice(buy2)}원 이상에서 종가 안착하고 거래량이 동반될 때만 단기 돌파 관점으로 접근합니다.
눌림 매수 조건: 20일선 또는 직전 지지 가격대에서 양봉 전환이 확인될 때 분할 접근합니다.

③ 목표가
1차 목표가: ${fmtPrice(target1)}원
2차 목표가: ${fmtPrice(target2)}원
산정 근거: 현재가 대비 단기 변동폭과 고가/저가 범위를 기준으로 한 조건부 목표입니다.

④ 손절가
손절 기준: ${fmtPrice(stop)}원 또는 직전 저점 이탈입니다.
이탈 시 대응: 재진입보다 현금화 후 추세 회복 여부를 재확인합니다.

⑤ 리스크
PER/PBR: ${per} / ${pbr}
거래량: ${fmtPrice(volume)}
단기 급등 후 거래량이 감소하거나 고점 돌파 실패 시 변동성 확대가 발생할 수 있습니다.

⑥ 최종 전략
보수적 전략: 눌림 지지 확인 후 분할 접근.
공격적 전략: 고점 돌파와 거래량 동반 시 단기 대응.
관망 전략: 고고저 빗각선 또는 20일선 기준 확인 전까지 대기.`;
}

function AiReport({ selected, stocks }) {
  const name = getStockName(selected?.code, selected?.name, stocks);
  const defaultPrompt = `${name}(${selected?.code}) 단기/스윙 분석 리포트 생성`;
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [result, setResult] = useState("");
  const [followup, setFollowup] = useState("");
  const [chat, setChat] = useState([]);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPrompt(defaultPrompt);
    setResult("");
    setFollowup("");
    setChat([]);
    setErr("");
    setNotice("");
  }, [defaultPrompt]);

  const applyAnswer = (answer, isFollowup) => {
    if (isFollowup) {
      setChat((p) => [...p, { role: "ai", text: answer }]);
      setFollowup("");
    } else {
      setResult(answer);
      setChat([{ role: "ai", text: answer }]);
    }
  };

  const askAI = async (mode) => {
    const isFollowup = mode === "followup";
    if (isFollowup && !followup.trim()) return alert("추가 질문을 입력하세요.");
    setLoading(true);
    setErr("");
    setNotice("");

    try {
      if (isFollowup) setChat((p) => [...p, { role: "user", text: followup }]);

      const finalPrompt = buildAnalysisPrompt(selected, stocks, isFollowup ? followup : "", result);
      const data = await fetchJson("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          systemPrompt:
            "당신은 15년 경력의 주식 트레이딩 분석가입니다. 사용자의 질문을 반복하지 말고 종목 데이터와 학습 가중치를 반영해 한국어로 답변하세요.",
        }),
      });

      const answer = data.text || data.result || JSON.stringify(data, null, 2);
      applyAnswer(answer, isFollowup);
    } catch (e) {
      const msg = e.message || String(e);
      const isQuota =
        msg.includes("429") ||
        msg.toLowerCase().includes("quota") ||
        msg.toLowerCase().includes("rate") ||
        msg.includes("RESOURCE_EXHAUSTED");

      if (isQuota) {
        const local = buildLocalAnalysis(selected, stocks, msg);
        setNotice("Gemini API 한도 초과 또는 일시 제한입니다. 호출을 우회하는 것은 불가하므로, 현재는 로컬 분석 엔진으로 대체 표시합니다. 한도 복구 후 Gemini 분석으로 자동 전환됩니다.");
        applyAnswer(local, isFollowup);
      } else {
        const local = buildLocalAnalysis(selected, stocks, msg);
        setNotice("AI API 연결 오류로 로컬 분석 결과를 표시했습니다.");
        applyAnswer(local, isFollowup);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">AI 리포트</div>
      <div className="panel-body">
        <div className="row">
          <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <button className="btn" onClick={() => askAI("new")} disabled={loading}>{loading ? "분석 중" : "분석"}</button>
        </div>
        <div style={{ height: 12 }} />
        {loading && <div className="loading">Gemini 분석 요청 중...</div>}
        {notice && <div className="error" style={{ borderColor: "#ffd44766", color: "#ffd447", background: "#ffd44711" }}>{notice}</div>}
        {err && <div className="error">API 연결 오류: {err}</div>}
        {result && (
          <div className="ai-result-full">
            <h4>분석 결과 전체</h4>
            <pre className="ai-result-scrollbox">{result}</pre>
          </div>
        )}
        {result && (
          <>
            <div style={{ height: 12 }} />
            <div className="row">
              <input
                className="input"
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
                placeholder="추가 질문 예: 지금 추격매수해도 되나요? 손절가는 얼마가 적절한가요?"
                onKeyDown={(e) => { if (e.key === "Enter") askAI("followup"); }}
              />
              <button className="btn" onClick={() => askAI("followup")} disabled={loading}>추가 질문</button>
            </div>
          </>
        )}
        {chat.length > 1 && (
          <div className="chat-box">
            {chat.slice(1).map((m, i) => (
              <div key={i} className={`chat-msg ${m.role === "user" ? "user" : "ai"}`}>
                <b>{m.role === "user" ? "질문" : "답변"}</b><br />{m.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Screener({ quotes, stocks }) {
  const rows = buildScreener(quotes, stocks);
  return (
    <div className="panel">
      <div className="panel-title"><span>스크리너 — 실시간 추천 랭킹</span><span className="tag green">LIVE</span></div>
      <div className="panel-body">
        <table className="data-table"><thead><tr><th>순위</th><th>종목</th><th>현재가</th><th>등락률</th><th>추천점수</th><th>판단</th><th>사유</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.code}><td className="rank">{i + 1}</td><td>{r.name} ({r.code})</td><td>{fmtPrice(r.price)}</td><td className={r.rate >= 0 ? "up" : "down"}>{fmtRate(r.rate)}</td><td>{r.score}</td><td>{r.action}</td><td>{r.reasons}</td></tr>)}</tbody></table>
        <div className="footer-note">추천점수는 등락률, 거래량, PER/PBR 존재 여부를 단순 가중치로 계산한 참고용 점수입니다.</div>
      </div>
    </div>
  );
}

function ValueScreener({ quotes, stocks }) {
  const rows = stocks.map((s) => {
    const q = quotes[s.code] || {};
    const v = calcValueScore(s, q);
    return { ...s, q, ...v };
  }).sort((a, b) => b.score - a.score);

  return (
    <div className="panel">
      <div className="panel-title"><span>AI 저평가 종목 스크리너</span><span className="tag yellow">VALUE + TECH</span></div>
      <div className="panel-body">
        <table className="data-table"><thead><tr><th>순위</th><th>종목</th><th>현재가</th><th>PER/PBR</th><th>등락률</th><th>점수</th><th>판정</th><th>근거</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.code}><td className="rank">{i + 1}</td><td>{r.name} ({r.code})</td><td>{fmtPrice(r.q.price)}</td><td>{r.q.per ?? "-"} / {r.q.pbr ?? "-"}</td><td className={Number(r.q.changeRate || 0) >= 0 ? "up" : "down"}>{fmtRate(r.q.changeRate)}</td><td>{r.score}</td><td>{r.label}</td><td>{r.tags}</td></tr>)}</tbody></table>
        <div className="footer-note">52주 저점/국민연금/DART 데이터는 서버 API 확장 시 실제값으로 대체됩니다. 현재는 KIS 응답값과 휴리스틱을 혼합한 MVP 판정입니다.</div>
      </div>
    </div>
  );
}

function Portfolio({ quotes, stocks }) {
  const [items, setItems] = useState(() => loadLS("alpha_portfolio", []));
  const [form, setForm] = useState({ code: stocks[0]?.code || "005930", buyPrice: "", qty: "" });
  useEffect(() => saveLS("alpha_portfolio", items), [items]);

  const rows = items.map((item) => {
    const q = quotes[item.code] || {};
    const currentPrice = Number(q.price || 0), buyPrice = Number(item.buyPrice || 0), qty = Number(item.qty || 0);
    const buyAmount = buyPrice * qty, evalAmount = currentPrice * qty, profit = evalAmount - buyAmount, profitRate = buyAmount > 0 ? profit / buyAmount * 100 : 0;
    let suggestion = "유지";
    if (profitRate >= 15) suggestion = "일부 차익실현 검토";
    else if (profitRate >= 5) suggestion = "보유 / 추세 확인";
    else if (profitRate <= -8) suggestion = "손절 기준 재점검";
    else if (profitRate <= -3) suggestion = "비중 축소 검토";
    return { ...item, name: getStockName(item.code, item.name, stocks), currentPrice, buyPrice, qty, buyAmount, evalAmount, profit, profitRate, suggestion };
  });
  const totalBuy = rows.reduce((s, r) => s + r.buyAmount, 0), totalEval = rows.reduce((s, r) => s + r.evalAmount, 0);
  const totalProfit = totalEval - totalBuy, totalRate = totalBuy > 0 ? totalProfit / totalBuy * 100 : 0;
  const addItem = () => {
    const buyPrice = Number(form.buyPrice), qty = Number(form.qty);
    if (!form.code || !buyPrice || !qty) return alert("종목, 매수가, 수량을 입력하세요.");
    const stock = stocks.find((s) => s.code === form.code);
    setItems((p) => [...p, { id: Date.now(), code: form.code, name: stock?.name || form.code, buyPrice, qty }]);
    setForm({ code: stocks[0]?.code || "005930", buyPrice: "", qty: "" });
  };
  return (
    <div className="panel">
      <div className="panel-title"><span>포트폴리오 — 실시간 평가손익</span><span className="tag green">LOCAL SAVE</span></div>
      <div className="panel-body">
        <div className="card-grid">
          <div className="card"><div className="card-title">매입금액</div><div className="value">{fmtMoney(totalBuy)}</div></div>
          <div className="card"><div className="card-title">평가금액</div><div className="value">{fmtMoney(totalEval)}</div></div>
          <div className="card"><div className="card-title">평가손익</div><div className={`value ${totalProfit >= 0 ? "up" : "down"}`}>{fmtMoney(totalProfit)}</div></div>
          <div className="card"><div className="card-title">수익률</div><div className={`value ${totalRate >= 0 ? "up" : "down"}`}>{fmtRate(totalRate)}</div></div>
        </div>
        <div style={{ height: 12 }} />
        <div className="form-grid">
          <select className="select" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>{stocks.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select>
          <input className="input" type="number" placeholder="매수가" value={form.buyPrice} onChange={(e) => setForm({ ...form, buyPrice: e.target.value })} />
          <input className="input" type="number" placeholder="수량" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          <button className="btn" onClick={addItem}>추가</button>
        </div>
        <table className="data-table"><thead><tr><th>종목</th><th>매수가</th><th>현재가</th><th>수량</th><th>손익</th><th>수익률</th><th>제안</th><th>삭제</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.name} ({r.code})</td><td>{fmtPrice(r.buyPrice)}</td><td>{fmtPrice(r.currentPrice)}</td><td>{fmtPrice(r.qty)}</td><td className={r.profit >= 0 ? "up" : "down"}>{fmtMoney(r.profit)}</td><td className={r.profitRate >= 0 ? "up" : "down"}>{fmtRate(r.profitRate)}</td><td>{r.suggestion}</td><td><button className="btn red small" onClick={() => setItems((p) => p.filter((v) => v.id !== r.id))}>삭제</button></td></tr>)}
          {!rows.length && <tr><td colSpan="8" className="sub">보유 종목을 추가하면 현재가 기준 평가손익이 자동 계산됩니다.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}

function AlertCenter({ quotes, stocks }) {
  const [alerts, setAlerts] = useState(() => loadLS("alpha_alerts", []));
  const [form, setForm] = useState({ code: stocks[0]?.code || "005930", type: "priceAbove", target: "" });
  useEffect(() => saveLS("alpha_alerts", alerts), [alerts]);
  const addAlert = () => {
    const target = Number(form.target);
    if (!form.code || Number.isNaN(target) || form.target === "") return alert("종목과 기준값을 입력하세요.");
    const stock = stocks.find((s) => s.code === form.code);
    setAlerts((p) => [...p, { id: Date.now(), code: form.code, name: stock?.name || form.code, type: form.type, target, createdAt: new Date().toLocaleString("ko-KR") }]);
    setForm({ code: stocks[0]?.code || "005930", type: "priceAbove", target: "" });
  };
  const evalAlert = (a) => {
    const q = quotes[a.code] || {}, price = Number(q.price || 0), rate = Number(q.changeRate || 0), score = calcSignal(q).score, target = Number(a.target || 0);
    let hit = false, label = "", basis = "";
    if (a.type === "priceAbove") { hit = price >= target; label = "목표가 이상"; basis = `${fmtPrice(price)} >= ${fmtPrice(target)}`; }
    if (a.type === "priceBelow") { hit = price <= target; label = "손절가 이하"; basis = `${fmtPrice(price)} <= ${fmtPrice(target)}`; }
    if (a.type === "rateAbove") { hit = rate >= target; label = "등락률 이상"; basis = `${fmtRate(rate)} >= ${fmtRate(target)}`; }
    if (a.type === "rateBelow") { hit = rate <= target; label = "등락률 이하"; basis = `${fmtRate(rate)} <= ${fmtRate(target)}`; }
    if (a.type === "scoreAbove") { hit = score >= target; label = "AI 점수 이상"; basis = `${score} >= ${target}`; }
    if (a.type === "ma20Touch") { const ma20 = Number(q.ma20 || 0); hit = ma20 > 0 ? Math.abs(price - ma20) / ma20 <= 0.01 : false; label = "20일선 도달"; basis = ma20 > 0 ? `${fmtPrice(price)} ≒ ${fmtPrice(ma20)}` : "20일선 데이터 대기"; }
    return { ...a, q, hit, label, basis, score };
  };
  const rows = alerts.map(evalAlert), hitCount = rows.filter((r) => r.hit).length;
  return (
    <div className="panel">
      <div className="panel-title"><span>알림 센터 — 조건 충족 자동 판정</span><span className={hitCount ? "tag yellow" : "tag green"}>{hitCount ? `${hitCount}건 충족` : "대기 중"}</span></div>
      <div className="panel-body">
        <div className="form-grid">
          <select className="select" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>{stocks.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select>
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="priceAbove">목표가 이상</option><option value="priceBelow">손절가 이하</option><option value="rateAbove">등락률 이상</option><option value="rateBelow">등락률 이하</option><option value="scoreAbove">AI 점수 이상</option><option value="ma20Touch">20일선 도달</option>
          </select>
          <input className="input" type="number" placeholder="기준값, 20일선은 0 입력" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          <button className="btn" onClick={addAlert}>등록</button>
        </div>
        <table className="data-table"><thead><tr><th>상태</th><th>종목</th><th>조건</th><th>현재 판정</th><th>현재가</th><th>등락률</th><th>AI점수</th><th>삭제</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.hit ? <span className="tag yellow">충족</span> : <span className="tag">대기</span>}</td><td>{getStockName(r.code, r.name, stocks)} ({r.code})</td><td>{r.label} {r.target}</td><td>{r.basis}</td><td>{fmtPrice(r.q.price)}</td><td className={Number(r.q.changeRate || 0) >= 0 ? "up" : "down"}>{fmtRate(r.q.changeRate)}</td><td>{r.score}</td><td><button className="btn red small" onClick={() => setAlerts((p) => p.filter((v) => v.id !== r.id))}>삭제</button></td></tr>)}
          {!rows.length && <tr><td colSpan="8" className="sub">예: 삼성전자가 20일선에 닿으면 알려줘 → 종목 삼성전자, 조건 20일선 도달, 기준값 0 등록</td></tr>}</tbody></table>
      </div>
    </div>
  );
}

function makeSignalBadge(x, y, label, color = "#00d9ff") {
  return { x, y, label, color };
}

function getChartVisualSignals({ activeTechniqueKey, chartData, gogoSignal, activeTechnique }) {
  const lastIndex = chartData.length - 1;
  const signals = [];

  if (activeTechniqueKey === "gogojeo" || activeTechniqueKey === "auto") {
    if (gogoSignal?.status === "OK") {
      signals.push({
        index: lastIndex,
        price: gogoSignal.trendLinePrice,
        label: gogoSignal.checks?.isBreakout ? "고고저 돌파" : "고고저 감시",
        color: gogoSignal.checks?.isBreakout ? "#00ff88" : "#ff4466",
      });
      if (gogoSignal.recentSwingLow) {
        signals.push({
          index: gogoSignal.recentSwingLow.index,
          price: gogoSignal.recentSwingLow.price,
          label: "스윙 저점",
          color: "#ffd447",
        });
      }
    }
  }

  if (activeTechniqueKey === "maPullback") {
    const ma20 = activeTechnique?.raw?.ma20;
    if (ma20) {
      signals.push({ index: lastIndex, price: ma20, label: "20선 눌림", color: "#ffd447" });
    }
  }

  if (activeTechniqueKey === "bollinger") {
    const upper = activeTechnique?.raw?.upper;
    if (upper) {
      signals.push({ index: lastIndex, price: upper, label: "밴드 상단", color: "#9b5cff" });
    }
  }

  if (activeTechniqueKey === "volumeBreakout") {
    const prevHigh = activeTechnique?.raw?.prevHigh;
    if (prevHigh) {
      signals.push({ index: lastIndex, price: prevHigh, label: "전고점 돌파", color: "#00ff88" });
    }
  }

  if (activeTechniqueKey === "rsiReversal") {
    const last = chartData[lastIndex];
    if (last) {
      signals.push({ index: lastIndex, price: last.low, label: "RSI 반등", color: "#00d9ff" });
    }
  }

  return signals;
}


function ChartView({ selected, stocks }) {
  const name = getStockName(selected?.code, selected?.name, stocks);
  const [period, setPeriod] = useState("D");
  const [range, setRange] = useState("1Y");
  const [techniqueMode, setTechniqueMode] = useState("auto");
  const [historyState, setHistoryState] = useState({ data: [], source: "", fallback: true, loading: false });
  const [autoExtended, setAutoExtended] = useState(false);
  const [extendNotice, setExtendNotice] = useState("");
  const [visibleCount, setVisibleCount] = useState(80);
  const [windowOffset, setWindowOffset] = useState(0);
  const [chartFullscreen, setChartFullscreen] = useState(false);

  const rangeOptions = period === "D"
    ? ["6M", "1Y", "3Y", "5Y", "10Y"]
    : period === "M"
      ? ["1Y", "3Y", "5Y", "10Y"]
      : ["3Y", "5Y", "10Y"];

  const techniqueOptions = [
    { key: "auto", label: "AI 자동" },
    { key: "gogojeo", label: "고고저" },
    { key: "maPullback", label: "이평 눌림" },
    { key: "bollinger", label: "볼린저" },
    { key: "volumeBreakout", label: "거래량 돌파" },
    { key: "rsiReversal", label: "RSI 반등" },
  ];
const loadExtendedGogo = async () => {
    const code = selected?.code;
    if (!code) return;
    setHistoryState((prev) => ({ ...prev, loading: true }));
    setExtendNotice("고고저 구조가 없어 더 이전 데이터까지 자동 조회 중입니다.");
    try {
      const res = await fetchExtendedGogoHistory(code, period, range, selected);
      if (res) {
        setHistoryState({ ...res, loading: false, fallback: res.fallback || false });
        setPeriod(res.period);
        setRange(res.range);
        setAutoExtended(true);
        setExtendNotice(res.message);
      } else {
        const basic = await fetchChartHistory(code, period, range, selected);
        setHistoryState({ ...basic, loading: false, fallback: true });
        setAutoExtended(false);
        setExtendNotice("일봉 10년/월봉 10년까지 확장했지만 유효한 하락 고점 구조가 없습니다. 이 경우 고고저보다 볼린저/RSI/이평 눌림 기법이 더 적합합니다.");
      }
    } catch (e) {
      setHistoryState((prev) => ({ ...prev, loading: false }));
      setAutoExtended(false);
      setExtendNotice(`이전 데이터 조회 중 오류가 발생했습니다: ${e.message || e}`);
    }
  };


  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") setChartFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!rangeOptions.includes(range)) setRange(rangeOptions[0]);
  }, [period]);

  useEffect(() => {
    setWindowOffset(0);
  }, [selected?.code, period, range]);

  const loadChart = async () => {
    const code = selected?.code;
    if (!code) return;
    setHistoryState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetchChartHistory(code, period, range, selected);
      const data = res.data.length ? res.data : makeFallbackHistory(selected);
      setHistoryState({ ...res, data, loading: false, fallback: res.fallback || !res.data.length });
    } catch {
      setHistoryState({ data: makeFallbackHistory(selected), source: "fallback", fallback: true, loading: false });
    }
  };

  useEffect(() => {
    let alive = true;
    const code = selected?.code;
    if (!code) return;

    setAutoExtended(false);
    setExtendNotice("");
    setHistoryState((prev) => ({ ...prev, loading: true }));
    fetchChartHistory(code, period, range, selected)
      .then((res) => {
        if (!alive) return;
        const data = res.data.length ? res.data : makeFallbackHistory(selected);
        setHistoryState({ ...res, data, loading: false, fallback: res.fallback || !res.data.length });
      })
      .catch(() => {
        if (!alive) return;
        setHistoryState({ data: makeFallbackHistory(selected), source: "fallback", fallback: true, loading: false });
      });

    return () => {
      alive = false;
    };
  }, [selected?.code, selected?.price, period, range]);

  const rawDataRaw = historyState.data.length ? historyState.data : makeFallbackHistory(selected);
  const rawData = [...rawDataRaw].sort((a, b) => {
    const at = parseChartDateValue(a.date, 0);
    const bt = parseChartDateValue(b.date, 0);
    return at - bt;
  });
  const gogoLookback = period === "Y" ? rawData.length : Math.min(rawData.length, countByPeriod(period, range));
  const fullChartData = rawData.slice(-gogoLookback);
  const safeVisibleCount = Math.min(fullChartData.length, Math.max(20, visibleCount));
  const maxOffset = Math.max(0, fullChartData.length - safeVisibleCount);
  const safeOffset = Math.min(windowOffset, maxOffset);
  const windowStart = Math.max(0, fullChartData.length - safeVisibleCount - safeOffset);
  const chartData = fullChartData.slice(windowStart, windowStart + safeVisibleCount);

  const ma20 = calcMA(chartData, Math.min(20, chartData.length));
  const ma60 = calcMA(chartData, Math.min(60, chartData.length));

  const gogoSignal = calculateGogojeoSignal(chartData, {
    lookback: Math.min(gogoLookback, chartData.length),
    swingWindow: period === "D" ? 5 : 2,
    minGap: period === "D" ? 10 : 2,
  });

  useEffect(() => {
    const code = selected?.code;
    const shouldExtend =
      code &&
      !historyState.loading &&
      !autoExtended &&
      techniqueMode === "auto" &&
      chartData.length >= 60 &&
      gogoSignal.status !== "OK" &&
      (String(gogoSignal.message || "").includes("하락 추세선") || String(gogoSignal.message || "").includes("고점"));

    if (shouldExtend) {
      loadExtendedGogo();
    }
  }, [selected?.code, historyState.loading, autoExtended, techniqueMode, gogoSignal.status, gogoSignal.message]);

  const techniqueAI = recommendChartTechniques(chartData, gogoSignal);
  const activeTechniqueKey = techniqueMode === "auto" ? techniqueAI.recommended?.key || "gogojeo" : techniqueMode;
  const activeTechnique = techniqueAI.ranked.find((t) => t.key === activeTechniqueKey) || techniqueAI.recommended || techniqueAI.ranked[0];

  const last = chartData[chartData.length - 1];

  const width = 820;
  const height = 460;
  const pad = { l: 54, r: 30, t: 34, b: 72 };
  const highs = chartData.map((d) => d.high);
  const lows = chartData.map((d) => d.low);
  const maValues = [...ma20, ...ma60].filter(Boolean);
  const extraValues = [];
  if (gogoSignal.status === "OK") extraValues.push(gogoSignal.trendLinePrice);
  if (activeTechniqueKey === "bollinger" && activeTechnique?.raw?.upper) {
    extraValues.push(activeTechnique.raw.upper, activeTechnique.raw.lower);
  }
  if (activeTechniqueKey === "volumeBreakout" && activeTechnique?.raw?.prevHigh) {
    extraValues.push(activeTechnique.raw.prevHigh);
  }
  const maxP = Math.max(...highs, ...maValues, ...extraValues);
  const minP = Math.min(...lows, ...maValues, ...extraValues);
  const rangeP = Math.max(1, maxP - minP);
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const step = plotW / Math.max(1, chartData.length - 1);
  const xFor = (i) => pad.l + i * step;
  const yFor = (v) => pad.t + (maxP - v) / rangeP * plotH;
  const formatAxisDate = (value) => {
    const s = String(value || "");
    if (/^\d{8}$/.test(s)) return `${s.slice(2, 4)}.${s.slice(4, 6)}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${s.slice(2, 4)}.${s.slice(5, 7)}`;
    if (/^\d{6}$/.test(s)) return `${s.slice(2, 4)}.${s.slice(4, 6)}`;
    if (/^\d{4}-\d{2}/.test(s)) return `${s.slice(2, 4)}.${s.slice(5, 7)}`;
    return s.slice(0, 7);
  };
  const formatAxisYear = (value) => {
    const s = String(value || "");
    if (/^\d{8}$/.test(s)) return s.slice(0, 4);
    if (/^\d{4}-/.test(s)) return s.slice(0, 4);
    if (/^\d{6}$/.test(s)) return s.slice(0, 4);
    return "";
  };
  const axisLabelStep = Math.max(1, Math.ceil(chartData.length / 5));
  const axisLabels = chartData
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i === 0 || i === chartData.length - 1 || i % axisLabelStep === 0)
    .filter((item, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr[idx - 1];
      return Math.abs(item.i - prev.i) >= Math.max(3, Math.floor(axisLabelStep * 0.65)) || item.i === chartData.length - 1;
    });

  const maPath = (arr) =>
    arr
      .map((v, i) => (v ? `${i === arr.findIndex(Boolean) ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}` : ""))
      .filter(Boolean)
      .join(" ");

  const lastTradeLabel = last?.date || "마지막 거래 시점";
  const ma20Last = ma20[ma20.length - 1];

  const isGogoOk = gogoSignal.status === "OK";
  const selectedHigh1 = isGogoOk ? gogoSignal.selectedHigh1 : null;
  const selectedHigh2 = isGogoOk ? gogoSignal.selectedHigh2 : null;
  const trendStart = selectedHigh1 ? { x: xFor(selectedHigh1.index), y: yFor(selectedHigh1.price) } : null;
  const trendEnd = isGogoOk ? { x: xFor(chartData.length - 1), y: yFor(gogoSignal.trendLinePrice) } : null;
  const recentLow = isGogoOk && gogoSignal.recentSwingLow ? gogoSignal.recentSwingLow : null;

  const showGogo = activeTechniqueKey === "gogojeo" || activeTechniqueKey === "auto" || techniqueMode === "auto";
  const bollinger = activeTechniqueKey === "bollinger" ? activeTechnique?.raw : null;
  const volumeBreak = activeTechniqueKey === "volumeBreakout" ? activeTechnique?.raw : null;
  const visualSignals = getChartVisualSignals({ activeTechniqueKey, chartData, gogoSignal, activeTechnique });

  return (
    <div className="grid">
      <div className="ai-report-scroll-panel">
        <AiReport selected={selected} stocks={stocks} />
        <div className="ai-report-scroll-note">AI 리포트 영역은 별도 스크롤입니다. 분석 결과 전체 박스 안에서 마우스 휠 또는 터치로 내려보세요.</div>
      </div>
      <div className="panel">
        <div className="panel-title">
          <span>실시간 차트 시각화 — AI 차트 기법 추천/선택</span>
          <span className={activeTechnique?.grade === "강한 매수 후보" || activeTechnique?.grade === "관심 종목" ? "tag yellow" : "tag green"}>
            {techniqueMode === "auto" ? "AI 추천" : "수동 선택"} · {activeTechnique?.name} · {activeTechnique?.score}점
          </span>
        </div>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 10 }}>
            <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="D">일봉</option>
              <option value="M">월봉</option>
              <option value="Y">연봉</option>
            </select>
            <select className="select" value={range} onChange={(e) => setRange(e.target.value)}>
              {rangeOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="select" value={techniqueMode} onChange={(e) => setTechniqueMode(e.target.value)}>
              {techniqueOptions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <button className="btn" onClick={loadChart}>차트 새로고침</button>
            <button className="btn" onClick={loadExtendedGogo}>고고저 이전데이터 확장</button>
          </div>

          {extendNotice && <div className="error" style={{ borderColor: autoExtended ? "#00ff8855" : "#ffd44766", color: autoExtended ? "#00ff88" : "#ffd447", background: autoExtended ? "#00ff8811" : "#ffd44711" }}>{extendNotice}</div>}

          <div className="error" style={{ borderColor: "#00d9ff55", color: "#d9ecf5", background: "#00d9ff0d" }}>
            AI 추천: <b>{techniqueAI.recommended?.name}</b> — {techniqueAI.reason}<br />
            현재 적용: <b>{activeTechnique?.name}</b> · {techniqueDescription(activeTechniqueKey)}
          </div>

          <div className="technique-grid">
            {techniqueAI.ranked.map((t) => (
              <button key={t.key} className={`technique-btn ${activeTechniqueKey === t.key ? "active" : ""}`} onClick={() => setTechniqueMode(t.key)}>
                <div className="technique-name">{t.name}</div>
                <div className="technique-score">{t.score}점 · {t.grade}</div>
                <div className="sub">{t.action}</div>
              </button>
            ))}
          </div>

          <div className="chart-meta">
            <span>{name}({selected?.code}) · 기준: {lastTradeLabel}</span>
            <span>{historyState.loading ? "차트 데이터 조회 중" : historyState.autoExtended ? `확장 데이터: ${historyState.source}` : historyState.fallback ? "서버 OHLCV 미연결 · 예시 차트" : `실데이터: ${historyState.source}`}</span>
            <span>20선: {ma20Last ? fmtPrice(ma20Last) : "계산 중"}</span>
            <span>고고저: {isGogoOk ? `${selectedHigh1.date} 고점① → ${selectedHigh2.date} 고점②` : gogoSignal.message}</span>
          </div>

          <div className="indicator-legend">
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#ffd447" }} />20선</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#00d9ff" }} />60선</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#ff4466" }} />고고저</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#9b5cff" }} />볼린저</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#00ff88" }} />돌파/매수 신호</span>
          </div>

          <div className="chart-range-toolbar">
            <span className="chart-window-label">차트 구간</span>
            <button className="btn" onClick={() => setVisibleCount((n) => Math.max(20, Math.floor(n * 0.7)))}>확대</button>
            <button className="btn" onClick={() => setVisibleCount((n) => Math.min(fullChartData.length, Math.ceil(n * 1.35)))}>축소</button>
            <button className="btn" onClick={() => setVisibleCount(80)}>기본</button>
            <button className="btn" onClick={() => { setVisibleCount(fullChartData.length); setWindowOffset(0); }}>전체구간</button>
            <button className="btn" onClick={() => setChartFullscreen(true)}>차트 크게보기</button>
            <span className="chart-window-label">이전/최근 이동</span>
            <input
              className="chart-window-range"
              type="range"
              min="0"
              max={maxOffset}
              step="1"
              value={safeOffset}
              onChange={(e) => setWindowOffset(Number(e.target.value))}
            />
            <span className="chart-window-label">{chartData.length}봉 표시 / 전체 {fullChartData.length}봉</span>
          </div>

          <div className={`chart-box ${chartFullscreen ? "chart-box-fullscreen" : ""}`}>
            {chartFullscreen && <button className="chart-back-btn" onClick={() => setChartFullscreen(false)}>돌아가기</button>}
            <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
              <defs>
                <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L7,3 z" fill="#00ff88" />
                </marker>
              </defs>
              <rect x="0" y="0" width={width} height={height} fill="#101923" />
              {[0, 1, 2, 3, 4].map((g) => {
                const y = pad.t + (plotH / 4) * g;
                const price = maxP - (rangeP / 4) * g;
                return (
                  <g key={g}>
                    <line x1={pad.l} y1={y} x2={width - pad.r} y2={y} stroke="#1e3445" strokeWidth="1" />
                    <text x="6" y={y + 4} className="axis-label">{fmtPrice(price)}</text>
                  </g>
                );
              })}

              {chartData.map((d, i) => {
                const x = xFor(i);
                const candleW = Math.max(1.2, Math.min(10, step * 0.58));
                const yOpen = yFor(d.open);
                const yClose = yFor(d.close);
                const yHigh = yFor(d.high);
                const yLow = yFor(d.low);
                const up = d.close >= d.open;
                return (
                  <g key={`${d.date}-${i}`}>
                    <line x1={x} y1={yHigh} x2={x} y2={yLow} className="wick" />
                    <rect
                      x={x - candleW / 2}
                      y={Math.min(yOpen, yClose)}
                      width={candleW}
                      height={Math.max(1.5, Math.abs(yClose - yOpen))}
                      className={up ? "candle-up" : "candle-down"}
                    />
                  </g>
                );
              })}

              <path d={maPath(ma20)} fill="none" className="line-ma" />
              <path d={maPath(ma60)} fill="none" className="line-ma60" />

              {bollinger && (
                <>
                  <line x1={pad.l} y1={yFor(bollinger.upper)} x2={width - pad.r} y2={yFor(bollinger.upper)} className="band-line" />
                  <line x1={pad.l} y1={yFor(bollinger.mid)} x2={width - pad.r} y2={yFor(bollinger.mid)} className="band-line" />
                  <line x1={pad.l} y1={yFor(bollinger.lower)} x2={width - pad.r} y2={yFor(bollinger.lower)} className="band-line" />
                  <text x={width - 130} y={yFor(bollinger.upper) - 6} className="axis-label">볼린저 상단</text>
                </>
              )}

              {volumeBreak && (
                <>
                  <line x1={pad.l} y1={yFor(volumeBreak.prevHigh)} x2={width - pad.r} y2={yFor(volumeBreak.prevHigh)} className="volume-break-line" />
                  <text x={width - 120} y={yFor(volumeBreak.prevHigh) - 6} className="axis-label">전고점 돌파선</text>
                </>
              )}

              {showGogo && isGogoOk && trendStart && trendEnd && (
                <>
                  <line x1={trendStart.x} y1={trendStart.y} x2={trendEnd.x} y2={trendEnd.y} className="line-trend" />
                  <circle cx={trendStart.x} cy={trendStart.y} r="5" fill="#ff4466" />
                  <circle cx={xFor(selectedHigh2.index)} cy={yFor(selectedHigh2.price)} r="5" fill="#ff4466" />
                  <circle cx={trendEnd.x} cy={trendEnd.y} r="5" fill={gogoSignal.checks.isBreakout ? "#00ff88" : "#ff4466"} />
                  {recentLow && <circle cx={xFor(recentLow.index)} cy={yFor(recentLow.price)} r="5" fill="#ffd447" />}
                  {[
                    { x: trendStart.x, y: trendStart.y, label: "고점①", color: "#ff4466", dx: 8, dy: -30 },
                    { x: xFor(selectedHigh2.index), y: yFor(selectedHigh2.price), label: "고점②", color: "#ff4466", dx: -58, dy: -46 },
                    { x: trendEnd.x, y: trendEnd.y, label: "고고저", color: gogoSignal.checks.isBreakout ? "#00ff88" : "#ff4466", dx: -72, dy: 22 },
                  ].map((p, idx) => {
                    const lx = Math.min(width - 72, Math.max(pad.l + 4, p.x + p.dx));
                    const ly = Math.min(height - pad.b - 18, Math.max(18, p.y + p.dy));
                    return (
                      <g key={`gj-label-${idx}`}>
                        <line x1={p.x} y1={p.y} x2={lx + 8} y2={ly + 12} stroke={p.color} className="label-guide" />
                        <rect x={lx} y={ly} width={p.label === "고고저" ? 58 : 52} height="22" rx="4" className="sig-box" />
                        <text x={lx + 7} y={ly + 15} fill={p.color} className="sig-label">{p.label}</text>
                      </g>
                    );
                  })}
                </>
              )}

              {visualSignals.map((s, i) => {
                const sx = xFor(Math.max(0, Math.min(chartData.length - 1, s.index)));
                const sy = yFor(s.price);
                const labelW = Math.min(128, Math.max(76, s.label.length * 12));
                const laneY = pad.t + 10 + (i % 4) * 30;
                const preferRight = sx < width * 0.62;
                const baseX = preferRight ? sx + 14 : sx - labelW - 14;
                const labelX = Math.min(width - labelW - 12, Math.max(pad.l + 4, baseX));
                const labelY = Math.min(height - pad.b - 30, Math.max(18, laneY));
                return (
                  <g key={`${s.label}-${i}`}>
                    <line x1={sx} y1={sy} x2={labelX + (preferRight ? 4 : labelW - 4)} y2={labelY + 12} stroke={s.color} className="label-guide" />
                    <circle cx={sx} cy={sy} r="5.5" fill={s.color} />
                    <rect x={labelX} y={labelY} width={labelW} height="24" rx="4" className="sig-box" />
                    <text x={labelX + 8} y={labelY + 16} fill={s.color} className="sig-label">{s.label}</text>
                  </g>
                );
              })}

              {axisLabels.map(({ d, i }, idx) => {
                const x = xFor(i);
                const year = formatAxisYear(d.date);
                const showYear = i === 0 || i === chartData.length - 1 || String(d.date || "").slice(0, 4) !== String(chartData[Math.max(0, i - axisLabelStep)]?.date || "").slice(0, 4);
                const anchor = i === 0 ? "start" : i === chartData.length - 1 ? "end" : "middle";
                const tx = i === 0 ? x + 2 : i === chartData.length - 1 ? x - 2 : x;
                const stagger = idx % 2 === 0 ? 0 : 13;
                return (
                  <g key={`axis-${i}`}>
                    <line x1={x} y1={height - pad.b + 4} x2={x} y2={height - pad.b + 12} stroke="#254357" strokeWidth="1" />
                    <text x={tx} y={height - 43 + stagger} textAnchor={anchor} className="x-axis-label">{formatAxisDate(d.date)}</text>
                    {showYear && <text x={tx} y={height - 18 + stagger} textAnchor={anchor} className="x-axis-year">{year}</text>}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="chart-caption">
            <span>노란선: 20선</span>
            <span>파란선: 60선</span>
            <span>빨간 점선: 고고저</span>
            <span>보라 점선: 볼린저</span>
            <span>녹색 점선: 전고점</span>
          </div>
          <div className="chart-period-note">
            차트 하단 기간 표시는 <b>년.월</b> 기준입니다. 왼쪽은 과거, 오른쪽은 최신 시세입니다. 확대/축소 및 이전/최근 이동 시 표시 구간의 기간도 함께 변경됩니다.
          </div>

          <div className="kpi-grid" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="card-title">선택 기법</div><strong>{activeTechnique?.name}</strong></div>
            <div className="kpi"><div className="card-title">AI 점수</div><strong>{activeTechnique?.score}</strong></div>
            <div className="kpi"><div className="card-title">등급</div><strong className={activeTechnique?.grade === "강한 매수 후보" || activeTechnique?.grade === "관심 종목" ? "up" : ""}>{activeTechnique?.grade}</strong></div>
            <div className="kpi"><div className="card-title">전략</div><strong>{activeTechnique?.action}</strong></div>
            <div className="kpi"><div className="card-title">고고저 점수</div><strong>{isGogoOk ? gogoSignal.score : "-"}</strong></div>
            <div className="kpi"><div className="card-title">추세선 가격</div><strong>{isGogoOk ? fmtPrice(gogoSignal.trendLinePrice) : "-"}</strong></div>
            <div className="kpi"><div className="card-title">돌파율</div><strong className={isGogoOk && gogoSignal.breakoutRate >= 0 ? "up" : "down"}>{isGogoOk ? `${gogoSignal.breakoutRate}%` : "-"}</strong></div>
            <div className="kpi"><div className="card-title">검증</div><strong>{activeTechnique?.status}</strong></div>
          </div>

          <div className="footer-note">
            AI 자동 추천은 고고저, 이동평균 눌림, 볼린저 수축, 거래량 돌파, RSI 반등을 동시에 점수화한 뒤 현재 차트에 가장 적합한 기법을 선택합니다. 고고저 하락추세선을 만들 수 없으면 일봉 5년/10년 또는 월봉 10년까지 확장 조회해 다시 판정합니다.
            수동 선택 시 선택한 기법 기준으로 보조선과 KPI가 바뀝니다.
          </div>

          <IndicatorReadMe />
        </div>
      </div>
    </div>
  );
}


function buildDailyBriefingText(stocks, quotes, refreshCount = 0) {
  const ranked = buildScreener(quotes, stocks);
  const strong = ranked.slice(0, 5);
  const weak = ranked.slice(-3).reverse();
  const now = new Date().toLocaleString("ko-KR", { hour12: false });

  const sectorMap = stocks.reduce((acc, s) => {
    const sector = s.sector || s.tag || "기타";
    const q = quotes[s.code] || {};
    acc[sector] = acc[sector] || [];
    acc[sector].push({ ...s, rate: Number(q.changeRate || 0), price: q.price });
    return acc;
  }, {});

  const sectors = Object.entries(sectorMap)
    .map(([sector, list]) => ({
      sector,
      avg: list.reduce((sum, x) => sum + x.rate, 0) / Math.max(1, list.length),
      leader: [...list].sort((a, b) => b.rate - a.rate)[0],
    }))
    .sort((a, b) => b.avg - a.avg);

  const topSector = sectors[0];
  const weakSector = sectors[sectors.length - 1];

  const strongLine = strong.length
    ? strong.map((s) => `${s.name} ${fmtRate(s.rate)} · ${s.judge}`).join("\n- ")
    : "실시간 후보 없음";

  const weakLine = weak.length
    ? weak.map((s) => `${s.name} ${fmtRate(s.rate)} · 리스크 관리`).join("\n- ")
    : "경계 후보 없음";

  const condition =
    strong.some((s) => s.rate >= 5)
      ? "단기 급등 종목이 있어 추격 매수보다 눌림 확인이 우선입니다."
      : strong.some((s) => s.rate >= 2)
        ? "일부 종목 중심의 양호한 모멘텀이 확인됩니다."
        : "강한 추세보다 선별 관찰이 필요한 구간입니다.";

  return {
    now,
    text: `📋 실시간 일일 브리핑 업데이트 #${refreshCount}

[생성 시각]
${now}

[시장 컨디션]
${condition}

[주목 종목]
- ${strongLine}

[경계 종목]
- ${weakLine}

[섹터/테마]
강한 섹터: ${topSector ? `${topSector.sector} ${fmtRate(topSector.avg)} / 주도: ${topSector.leader?.name}` : "-"}
약한 섹터: ${weakSector ? `${weakSector.sector} ${fmtRate(weakSector.avg)} / 약세: ${weakSector.leader?.name}` : "-"}

[오늘 체크]
1. 급등 종목은 전고점 돌파 후 지지 여부 확인
2. 눌림 종목은 20일선 또는 직전 지지선 이탈 여부 확인
3. AI 리포트가 한도 초과일 경우 로컬 분석 결과를 기준으로 1차 판단
4. 실시간 재검색 시 현재 시세와 등락률을 다시 반영

[AI 판단]
현재 화면의 실시간 시세 기준으로는 주도 종목과 약세 종목의 차별화가 진행 중입니다. 단기 매매는 고고저 돌파, 거래량 동반, 20일선 지지 조건을 동시에 확인하는 방식이 적합합니다.`,
    strong,
    weak,
    sectors,
  };
}

function DailyBriefing({ stocks, quotes, reload, loading }) {
  const [refreshCount, setRefreshCount] = useState(1);
  const [briefing, setBriefing] = useState(() => buildDailyBriefingText(stocks, quotes, 1));
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [localNotice, setLocalNotice] = useState("");

  const regenerate = async (withReload = false) => {
    setLocalNotice("");
    if (withReload && reload) {
      await reload();
      setLocalNotice("실시간 시세를 다시 조회했습니다. 최신 quote 반영 후 브리핑을 재생성했습니다.");
    } else {
      setLocalNotice("현재 화면에 로딩된 실시간 시세 기준으로 브리핑을 재생성했습니다.");
    }

    setRefreshCount((prev) => {
      const next = prev + 1;
      setBriefing(buildDailyBriefingText(stocks, quotes, next));
      return next;
    });
  };

  useEffect(() => {
    setBriefing(buildDailyBriefingText(stocks, quotes, refreshCount));
  }, [quotes, stocks.map((s) => s.code).join(",")]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      regenerate(true);
    }, 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, quotes, stocks.map((s) => s.code).join(",")]);

  return (
    <div className="panel">
      <div className="panel-title">
        <span>AI 일일 브리핑</span>
        <span className="tag yellow">REALTIME RESEARCH</span>
      </div>
      <div className="panel-body">
        <div className="briefing-toolbar">
          <button className="btn" onClick={() => regenerate(true)} disabled={loading}>
            {loading ? "재검색 중" : "실시간 재검색"}
          </button>
          <button className="btn" onClick={() => regenerate(false)}>
            현재 데이터로 재생성
          </button>
          <button className={`btn ${autoRefresh ? "active" : ""}`} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? "1분 자동갱신 ON" : "1분 자동갱신 OFF"}
          </button>
        </div>

        <div className="briefing-meta">
          <span>마지막 생성: {briefing.now}</span>
          <span>재검색 횟수: {refreshCount}</span>
          <span>대상 종목: {stocks.length}개</span>
        </div>

        {localNotice && (
          <div className="error" style={{ borderColor: "#00d9ff55", color: "#d9ecf5", background: "#00d9ff0d" }}>
            {localNotice}
          </div>
        )}

        <div className="ai-result-full">
          <h4>📋 오늘의 시장 브리핑</h4>
          {briefing.text}
        </div>

        <div className="briefing-card">
          <h4>재검색 메뉴 설명</h4>
          <b>실시간 재검색</b>: Render API에서 현재 시세를 다시 조회한 뒤 브리핑을 재생성합니다.<br />
          <b>현재 데이터로 재생성</b>: 이미 화면에 표시된 시세를 기준으로 즉시 브리핑만 다시 계산합니다.<br />
          <b>1분 자동갱신</b>: 원하는 순간이 아니라 계속 모니터링해야 할 때 1분마다 재검색합니다.
        </div>

        <div className="footer-note">
          자동 08시 발송은 Render Cron Job 또는 Firebase Functions Scheduler 연결이 필요합니다. 화면 내 재검색은 즉시 실행 가능합니다.
        </div>
        <ReadMeSection title="READ ME · 일일 브리핑">
          <h4>실시간 재검색</h4>
          <ul>
            <li>Render API에서 국내 시세를 다시 조회한 뒤 브리핑을 재계산합니다.</li>
            <li>미국/크립토는 서버에 전용 API가 연결되어 있으면 실시간으로 표시되고, 없으면 DEMO로 표시됩니다.</li>
          </ul>
          <h4>자동갱신</h4>
          <ul>
            <li>1분 자동갱신은 화면을 켜둔 상태에서 주기적으로 재검색합니다.</li>
          </ul>
        </ReadMeSection>

      </div>
    </div>
  );
}

function ThemeAnalysis({ stocks, quotes }) {
  const groups = stocks.reduce((acc, s) => {
    const sector = s.sector || s.tag || "기타";
    acc[sector] = acc[sector] || [];
    acc[sector].push(s);
    return acc;
  }, {});
  const rows = Object.entries(groups).map(([sector, list]) => {
    const rates = list.map((s) => Number(quotes[s.code]?.changeRate || 0));
    const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    const leader = [...list].sort((a, b) => Number(quotes[b.code]?.changeRate || 0) - Number(quotes[a.code]?.changeRate || 0))[0];
    return { sector, count: list.length, avg, leader };
  }).sort((a, b) => b.avg - a.avg);
  return (
    <div className="panel">
      <div className="panel-title">섹터/테마 분석</div>
      <div className="panel-body">
        <table className="data-table"><thead><tr><th>순위</th><th>섹터</th><th>종목수</th><th>평균 등락률</th><th>주도 종목</th><th>AI 해석</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.sector}><td className="rank">{i + 1}</td><td>{r.sector}</td><td>{r.count}</td><td className={r.avg >= 0 ? "up" : "down"}>{fmtRate(r.avg)}</td><td>{r.leader?.name}</td><td>{r.avg > 1 ? "섹터 내 강세 흐름. 주도주 지속성 확인." : r.avg < -1 ? "섹터 약세. 반등 확인 전 보수적 접근." : "차별화 진행 중."}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function FullScan({ stocks, quotes }) {
  const rows = stocks.map((s) => ({ ...s, q: quotes[s.code] || {}, value: calcValueScore(s, quotes[s.code] || {}) }));
  const trend = rows.filter((r) => Number(r.q.changeRate || 0) >= 1).slice(0, 5);
  const pullback = rows.filter((r) => Number(r.q.changeRate || 0) > -2 && Number(r.q.changeRate || 0) < 1).slice(0, 5);
  const value = rows.filter((r) => r.value.score >= 62).slice(0, 5);
  return (
    <div className="two-grid">
      <div className="scan-card"><h4>고고저 돌파 임박</h4><ul>{trend.map((r) => <li key={r.code}>{r.name} · {fmtRate(r.q.changeRate)}</li>)}</ul></div>
      <div className="scan-card"><h4>눌림목 매수 자리</h4><ul>{pullback.map((r) => <li key={r.code}>{r.name} · {fmtRate(r.q.changeRate)}</li>)}</ul></div>
      <div className="scan-card"><h4>국민연금 증가 + 저PER</h4><ul>{value.map((r) => <li key={r.code}>{r.name} · {r.value.label}</li>)}</ul></div>
      <div className="scan-card"><h4>자동 스캔 안내</h4><ul><li>현재는 등록 종목 기준 스캔</li><li>전 종목 스캔은 서버 배치 필요</li><li>KOSPI/KOSDAQ 종목 리스트 API 연동 예정</li></ul></div>
    </div>
  );
}

function Backtest({ selected, stocks }) {
  const name = getStockName(selected?.code, selected?.name, stocks);
  return (
    <div className="panel">
      <div className="panel-title">백테스트 — 고고저 빗각 돌파 신호</div>
      <div className="panel-body">
        <div className="card-grid">
          <div className="card"><div className="card-title">대상</div><div className="value">{name}</div></div>
          <div className="card"><div className="card-title">신호 발생</div><div className="value">32회</div></div>
          <div className="card"><div className="card-title">5일 후 평균</div><div className="value up">+2.8%</div></div>
          <div className="card"><div className="card-title">승률</div><div className="value up">62.5%</div></div>
        </div>
        <div className="footer-note">현재는 예시 결과입니다. 실제 백테스트는 /api/history/:code, OHLCV 저장, 신호 계산 API가 필요합니다.</div>
      </div>
    </div>
  );
}

function AiSimulation() {
  return (
    <div className="panel">
      <div className="panel-title">AI 학습 고도화 — 가중치 자동 주입</div>
      <div className="panel-body">
        <table className="data-table"><thead><tr><th>신호</th><th>가중치</th><th>적중률</th><th>AI 프롬프트 반영</th></tr></thead>
          <tbody>{WEIGHTS.map((w) => <tr key={w.key}><td>{w.name}</td><td>×{w.weight}</td><td>{w.hit}%</td><td>이 신호가 발생한 종목은 판단 가중치를 높여 분석</td></tr>)}</tbody></table>
        <div className="footer-note">AI 리포트 프롬프트에는 위 가중치가 자동 삽입됩니다.</div>
      </div>
    </div>
  );
}

export default function TradingPlatform() {
  const [tab, setTab] = useState("대시보드");
  const [customStocks, setCustomStocks] = useState(() => loadLS("alpha_custom_stocks", []));
  const stocks = useMemo(() => {
    const map = new Map();
    [...DEFAULT_STOCKS, ...customStocks].forEach((s) => {
      const code = normalizeCode(s.code);
      if (code.length === 6) map.set(code, { ...s, code });
    });
    return Array.from(map.values());
  }, [customStocks]);

  const [quotes, setQuotes] = useState({});
  const [market, setMarket] = useState([]);
  const [globalQuotes, setGlobalQuotes] = useState([]);
  const [selectedCode, setSelectedCode] = useState("005930");
  const [loading, setLoading] = useState(false);
  const [globalErr, setGlobalErr] = useState("");
  const [now, setNow] = useState("");

  const selected = quotes[selectedCode] || { code: selectedCode, name: getStockName(selectedCode, "", stocks) };

  useEffect(() => saveLS("alpha_custom_stocks", customStocks), [customStocks]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("ko-KR", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  const addStock = (stock) => {
    const code = normalizeCode(stock.code);
    if (stocks.some((s) => s.code === code)) return alert("이미 등록된 종목입니다.");
    setCustomStocks((p) => [...p, { ...stock, code }]);
    setSelectedCode(code);
  };
  const removeStock = (code) => {
    setCustomStocks((p) => p.filter((s) => s.code !== code));
    if (selectedCode === code) setSelectedCode("005930");
  };

  const loadAll = async () => {
    setLoading(true);
    setGlobalErr("");
    try {
      const marketPromise = fetchJson("/api/index").catch(() => []);
      const globalPromise = fetchGlobalQuotes().catch(() => []);
      const quotePromises = stocks.map(async (s) => {
        try {
          const q = await fetchJson(`/api/quote/${s.code}`);
          return [s.code, { ...q, code: s.code, name: s.name }];
        } catch {
          return [s.code, { code: s.code, name: s.name, error: true }];
        }
      });
      const [m, g, quotePairs] = await Promise.all([marketPromise, globalPromise, Promise.all(quotePromises)]);
      setMarket(Array.isArray(m) ? m : []);
      setGlobalQuotes(Array.isArray(g) ? g : []);
      setQuotes(Object.fromEntries(quotePairs));
    } catch (e) {
      setGlobalErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [stocks.map((s) => s.code).join(",")]);

  return (
    <div className="app">
      <style>{styles}</style>
      <Header now={now} tab={tab} />
      <Nav tab={tab} setTab={setTab} />
      <TickerBar quotes={quotes} stocks={stocks} globalQuotes={globalQuotes} />

      <div className="main">
        <LeftPanel stocks={stocks} quotes={quotes} selectedCode={selectedCode} setSelectedCode={setSelectedCode} reload={loadAll} loading={loading} addStock={addStock} removeStock={removeStock} />

        <div className="grid">
          {globalErr && <div className="error">전역 API 오류: {globalErr}</div>}
          <ScreenFrame tab={tab}>
            {tab === "대시보드" && <Dashboard market={market} selected={selected} stocks={stocks} />}
            {tab === "차트 분석" && <ChartView selected={selected} stocks={stocks} />}
            {tab === "스크리너" && <Screener quotes={quotes} stocks={stocks} />}
            {tab === "저평가 스크리너" && <ValueScreener quotes={quotes} stocks={stocks} />}
            {tab === "포트폴리오" && <Portfolio quotes={quotes} stocks={stocks} />}
            {tab === "알림 센터" && <AlertCenter quotes={quotes} stocks={stocks} />}
            {tab === "AI 리포트" && <AiReport selected={selected} stocks={stocks} />}
            {tab === "일일 브리핑" && <DailyBriefing stocks={stocks} quotes={quotes} reload={loadAll} loading={loading} />}
            {tab === "섹터/테마" && <ThemeAnalysis stocks={stocks} quotes={quotes} />}
            {tab === "전종목 스캔" && <FullScan stocks={stocks} quotes={quotes} />}
            {tab === "백테스트" && <Backtest selected={selected} stocks={stocks} />}
            {tab === "AI 시뮬레이션" && <AiSimulation />}
          </ScreenFrame>
        </div>
      </div>
    </div>
  );
}
