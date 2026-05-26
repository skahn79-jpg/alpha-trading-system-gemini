import { useState, useEffect } from "react";
import {
  FIREBASE_ENABLED,
  ensureAuth,
  subscribeAuth,
  loadSignals as fbLoadSignals,
  saveSignal as fbSaveSignal,
  saveSignalsBatch as fbSaveSignalsBatch,
  deleteAllSignals as fbDeleteAllSignals,
  saveWeights as fbSaveWeights,
  loadProfile,
  joinSharedPool,
  publishToSharedPool,
} from "./firebase-config.js";

// ── API 서버 URL (KIS+DART 프록시) ─────────────────────────────
// 우선순위: 1) Vite 환경변수 2) 로컬 개발 3) 빈 문자열(Hosting과 같은 도메인)
const API_BASE = (()=>{
  // Vite 빌드 시 VITE_API_URL 환경변수 삽입
  if(typeof __API_URL__ !== "undefined" && __API_URL__) return __API_URL__;
  // 로컬 개발 시 Vite 프록시 통해 자동 전달 (빈 문자열 = /api → proxy → localhost:3001)
  return "";
})();
// ── 컬러 팔레트 ───────────────────────────────────────────────────
const C = {
  bg0:"#090b0f", bg1:"#0d1117", bg2:"#131920", bg3:"#1a2332",
  border:"#1f2d3d", borderBright:"#2a3f57",
  accent:"#00d4ff", accentDim:"#0099bb",
  green:"#00ff88", greenDim:"#00cc66",
  red:"#ff4466", redDim:"#cc2244",
  yellow:"#ffcc00", purple:"#a855f7",
  text:"#e2eaf4", textDim:"#7a90a8", textMuted:"#3d5268",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@300;400;500;600;700&family=Orbitron:wght@400;700;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:${C.bg0};color:${C.text};font-family:'Rajdhani',sans-serif;overflow:hidden;}
  ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:${C.bg1};}::-webkit-scrollbar-thumb{background:${C.borderBright};border-radius:2px;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  @keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
  @keyframes blink{0%,100%{opacity:1}49%{opacity:1}50%{opacity:0}99%{opacity:0}}
  @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
  .scanline{position:fixed;top:0;left:0;right:0;height:2px;background:linear-gradient(transparent,${C.accent}22,transparent);animation:scanline 8s linear infinite;pointer-events:none;z-index:9999;}
  .grid-bg{background-image:linear-gradient(${C.border}44 1px,transparent 1px),linear-gradient(90deg,${C.border}44 1px,transparent 1px);background-size:40px 40px;}
  .panel{background:${C.bg1};border:1px solid ${C.border};border-radius:2px;position:relative;overflow:hidden;}
  .panel::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,${C.accent}66,transparent);}
  .panel-title{font-family:'Orbitron',monospace;font-size:10px;letter-spacing:3px;color:${C.accent};text-transform:uppercase;padding:10px 14px;border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:8px;}
  .dot-live{width:6px;height:6px;border-radius:50%;background:${C.green};animation:pulse 1.5s infinite;flex-shrink:0;}
  .mono{font-family:'Share Tech Mono',monospace;}
  .tag{display:inline-flex;align-items:center;padding:2px 8px;font-family:'Share Tech Mono',monospace;font-size:10px;border-radius:1px;border:1px solid;}
  .tag-green{color:${C.green};border-color:${C.green}44;background:${C.green}11;}
  .tag-red{color:${C.red};border-color:${C.red}44;background:${C.red}11;}
  .tag-accent{color:${C.accent};border-color:${C.accent}44;background:${C.accent}11;}
  .tag-yellow{color:${C.yellow};border-color:${C.yellow}44;background:${C.yellow}11;}
  .tag-purple{color:${C.purple};border-color:${C.purple}44;background:${C.purple}11;}
  .nav-btn{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;transition:all 0.15s;border-left:2px solid transparent;font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:500;letter-spacing:1px;color:${C.textDim};background:none;border-top:none;border-right:none;border-bottom:none;width:100%;text-align:left;}
  .nav-btn:hover{color:${C.text};background:${C.bg2};border-left-color:${C.borderBright};}
  .nav-btn.active{color:${C.accent};background:${C.bg2};border-left-color:${C.accent};}
  .btn{padding:6px 14px;font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:600;letter-spacing:2px;cursor:pointer;border-radius:1px;transition:all 0.15s;text-transform:uppercase;}
  .btn-primary{background:${C.accent}22;color:${C.accent};border:1px solid ${C.accent}66;}
  .btn-primary:hover{background:${C.accent}33;}
  .btn-green{background:${C.green}22;color:${C.green};border:1px solid ${C.green}66;}
  .btn-red{background:${C.red}22;color:${C.red};border:1px solid ${C.red}66;}
  .input-field{background:${C.bg0};border:1px solid ${C.border};color:${C.text};font-family:'Share Tech Mono',monospace;font-size:12px;padding:6px 10px;outline:none;width:100%;border-radius:1px;transition:border-color 0.15s;}
  .input-field:focus{border-color:${C.accent}66;}
  .ticker-bar{display:flex;gap:0;animation:ticker 30s linear infinite;white-space:nowrap;}
  .ai-typing::after{content:'▌';animation:blink 1s infinite;}
  .row-hover:hover{background:${C.bg2};}
  select.input-field option{background:${C.bg1};}
  .badge{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:10px;font-weight:700;background:${C.red};color:#fff;font-family:'Share Tech Mono',monospace;}

  /* ── 상단 알약 탭 (모바일 친화) ──────────────────────── */
  .pill-tabs{display:flex;gap:6px;padding:8px 12px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;background:${C.bg1};border-bottom:1px solid ${C.border};}
  .pill-tabs::-webkit-scrollbar{display:none;}
  .pill-tab{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:999px;background:${C.bg2};border:1px solid ${C.border};color:${C.textDim};font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.5px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all 0.15s;}
  .pill-tab:hover{color:${C.text};border-color:${C.borderBright};}
  .pill-tab.active{background:${C.text};color:${C.bg0};border-color:${C.text};font-weight:700;}
  .pill-tab .pill-icon{font-size:13px;}
  .pill-tab .pill-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:10px;font-weight:700;background:${C.red};color:#fff;font-family:'Share Tech Mono',monospace;margin-left:2px;}
  .pill-tab.active .pill-badge{background:${C.bg0};color:${C.red};}

  /* 햄버거 메뉴 (선택형 — 기본은 알약 탭) */
  .brand-strip{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${C.bg1};border-bottom:1px solid ${C.border};}
  .brand-strip .brand-l{display:flex;align-items:center;gap:10px;}
  .brand-strip .brand-r{display:flex;align-items:center;gap:8px;}

  /* 모바일 (≤768px) 미세 조정 */
  @media (max-width: 768px) {
    .pill-tab{padding:6px 12px;font-size:12px;}
    .panel-title{font-size:9px;letter-spacing:2px;padding:8px 10px;}
    .hide-mobile{display:none !important;}
  }
  .hide-mobile{display:flex;}

  /* ── 대시보드 카드 반응형 그리드 ───────────────────────── */
  .market-grid{display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:8px;}
  .market-card{padding:14px 16px;min-width:0;}
  .market-name{font-size:10px;letter-spacing:2px;color:${C.textDim};font-family:'Orbitron',monospace;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .market-val{font-size:18px;font-weight:700;color:${C.text};letter-spacing:0.5px;font-family:'Share Tech Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .market-sub{font-size:10px;color:${C.textDim};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .market-ch{font-size:12px;font-weight:600;font-family:'Share Tech Mono',monospace;white-space:nowrap;}
  .ai-diag-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .portfolio-big{font-size:26px;font-weight:700;font-family:'Share Tech Mono',monospace;}

  /* 태블릿 (≤900px) */
  @media (max-width: 900px) {
    .market-grid{grid-template-columns:repeat(2, minmax(0, 1fr));}
    .market-card{padding:10px 12px;}
    .market-val{font-size:16px;}
  }
  /* 모바일 (≤560px) — 카드 2열 유지하되 폰트 더 축소 */
  @media (max-width: 560px) {
    .market-card{padding:10px 11px;}
    .market-name{font-size:9px;letter-spacing:1.5px;margin-bottom:4px;}
    .market-val{font-size:14px;letter-spacing:0;}
    .market-sub{font-size:9px;}
    .market-ch{font-size:11px;}
    .ai-diag-grid{grid-template-columns:1fr;gap:6px;}
    .portfolio-big{font-size:22px;}
  }
  /* 초소형 (≤380px) */
  @media (max-width: 380px) {
    .market-val{font-size:13px;}
    .market-name{font-size:8px;}
  }

  /* ── 하단(AI 진단 + 포트폴리오) ─────────────────────── */
  .dash-bottom{display:grid;grid-template-columns:2fr 1fr;gap:8px;}
  @media (max-width: 900px) {
    .dash-bottom{grid-template-columns:1fr;}
  }

  /* ── 시그널 그리드 (5개) ──────────────────────── */
  .signal-grid{display:grid;grid-template-columns:repeat(5, minmax(0, 1fr));}
  .signal-cell{padding:10px 12px;border-right:1px solid ${C.border};min-width:0;}
  .signal-cell:last-child{border-right:none;}
  @media (max-width: 900px) {
    .signal-grid{grid-template-columns:repeat(3, minmax(0, 1fr));}
    .signal-cell{border-bottom:1px solid ${C.border};}
    .signal-cell:nth-child(3n){border-right:none;}
    .signal-cell:nth-last-child(-n+2){border-bottom:none;}
  }
  @media (max-width: 560px) {
    .signal-grid{grid-template-columns:repeat(2, minmax(0, 1fr));}
    .signal-cell{border-right:1px solid ${C.border} !important;border-bottom:1px solid ${C.border} !important;}
    .signal-cell:nth-child(2n){border-right:none !important;}
  }
`;

// ── 더미 데이터 ─────────────────────────────────────────────────────
const TICKERS = [
  {s:"삼성전자",p:"75,400",ch:"+1.24%",up:true},{s:"SK하이닉스",p:"189,500",ch:"-0.78%",up:false},
  {s:"NVDA",p:"$138.42",ch:"+3.21%",up:true},{s:"TSLA",p:"$248.60",ch:"-1.44%",up:false},
  {s:"BTC",p:"$67,240",ch:"+2.88%",up:true},{s:"ETH",p:"$3,512",ch:"+1.65%",up:true},
  {s:"AAPL",p:"$214.80",ch:"+0.92%",up:true},{s:"MSFT",p:"$432.10",ch:"-0.33%",up:false},
  {s:"카카오",p:"42,150",ch:"-2.11%",up:false},{s:"NAVER",p:"198,000",ch:"+0.76%",up:true},
];
const MARKET_DATA = [
  {name:"KOSPI",val:"2,687.45",ch:"+0.84%",up:true,sub:"거래량 8.2B"},
  {name:"KOSDAQ",val:"876.23",ch:"-0.42%",up:false,sub:"거래량 5.1B"},
  {name:"NASDAQ",val:"17,432.60",ch:"+1.23%",up:true,sub:"Vol 12.4B"},
  {name:"S&P500",val:"5,308.14",ch:"+0.91%",up:true,sub:"Vol 9.8B"},
  {name:"BTC/USD",val:"$67,240",ch:"+2.88%",up:true,sub:"24h Vol $42B"},
  {name:"USD/KRW",val:"1,348.20",ch:"-0.31%",up:false,sub:"외환시장"},
];
const ALERTS = [
  {id:1,time:"14:32",type:"BUY",sym:"NVDA",msg:"21일EMA 지지 액션(밑꼬리 양봉+거래량 2.3배)·컨플루언스 3개",strength:"강",read:false},
  {id:2,time:"13:58",type:"SELL",sym:"카카오",msg:"베이스 20일선 첫 이탈+ADX 데드크로스 — 1차 익절 30%",strength:"중",read:false},
  {id:3,time:"13:21",type:"BUY",sym:"BTC",msg:"주봉 스토캐스틱(20,12) 골드+볼린저 하단 반등",strength:"강",read:false},
  {id:4,time:"12:44",type:"WATCH",sym:"SK하이닉스",msg:"52주 신고가 근접·N자 2차상승·역할 전환 매수자리 대기",strength:"관찰",read:true},
  {id:5,time:"11:30",type:"SELL",sym:"TSLA",msg:"60일선 이격 30%↑ 과열·5파동 고점·베이스선 거리 -38%",strength:"강",read:true},
  {id:6,time:"10:48",type:"BUY",sym:"삼성전자",msg:"코스피 -1.2% 와중 60일선 지지+거래량 1.8배·신뢰도 최상",strength:"강",read:true},
  {id:7,time:"10:12",type:"WATCH",sym:"KOSPI",msg:"신호등 1단계: 20일선 종가 상향돌파 — 30~40% 진입 검토",strength:"관찰",read:true},
  {id:8,time:"09:48",type:"BUY",sym:"NAVER",msg:"고고저: 6개월 하락추세선(3회 터치) 양봉 돌파+거래량 2.1배",strength:"강",read:false},
  {id:9,time:"09:32",type:"WATCH",sym:"현대차",msg:"고고저: 하락쐐기형 바닥 다지기 완성·돌파 임박",strength:"관찰",read:false},
];
const PORTFOLIO = [
  {sym:"삼성전자",qty:50,avg:71200,cur:75400,sec:"반도체"},
  {sym:"NVDA",qty:10,avg:118.5,cur:138.42,sec:"AI/반도체"},
  {sym:"BTC",qty:0.5,avg:58200,cur:67240,sec:"암호화폐"},
  {sym:"AAPL",qty:15,avg:198.2,cur:214.8,sec:"빅테크"},
  {sym:"NAVER",qty:20,avg:182000,cur:198000,sec:"플랫폼"},
];
const SCREENER_DATA = [
  {sym:"에코프로비엠",sec:"2차전지",per:24.1,pbr:4.2,rsi:42,mc:"4.2조",ch:"+2.1%",up:true,signal:"BUY"},
  {sym:"한화솔루션",sec:"태양광",per:18.3,pbr:1.8,rsi:38,mc:"3.1조",ch:"+3.4%",up:true,signal:"BUY"},
  {sym:"셀트리온",sec:"바이오",per:31.2,pbr:3.1,rsi:65,mc:"12.8조",ch:"-0.8%",up:false,signal:"HOLD"},
  {sym:"현대차",sec:"자동차",per:6.4,pbr:0.7,rsi:55,mc:"42.1조",ch:"+1.2%",up:true,signal:"BUY"},
  {sym:"카카오뱅크",sec:"핀테크",per:41.2,pbr:2.9,rsi:71,mc:"8.9조",ch:"-1.4%",up:false,signal:"SELL"},
  {sym:"LG에너지솔루션",sec:"2차전지",per:88.4,pbr:5.1,rsi:48,mc:"89.2조",ch:"+0.6%",up:true,signal:"HOLD"},
];

// ── 공통 컴포넌트 ─────────────────────────────────────────────────
function Sparkline({data,color}){
  const max=Math.max(...data),min=Math.min(...data);
  return <div style={{display:"flex",alignItems:"flex-end",gap:1,height:32}}>
    {data.map((v,i)=><div key={i} style={{width:3,height:Math.round(((v-min)/(max-min||1))*28)+4,background:color,opacity:0.7+(i/data.length)*0.3,borderRadius:1,flexShrink:0}}/>)}
  </div>;
}
function MiniBar({data,colors}){
  const max=Math.max(...data);
  return <div style={{display:"flex",alignItems:"flex-end",gap:3,height:80}}>
    {data.map((v,i)=><div key={i} style={{flex:1,height:Math.round((v/max)*76)+4,background:`linear-gradient(to top,${colors[i%colors.length]}cc,${colors[i%colors.length]}44)`,borderRadius:"1px 1px 0 0",border:`1px solid ${colors[i%colors.length]}66`,borderBottom:"none"}}/>)}
  </div>;
}

// ── AI 스트림 훅 ─────────────────────────────────────────────────
function useAIStream(){
  const [text,setText]=useState("");
  const [loading,setLoading]=useState(false);
  const run=async(prompt,systemPrompt)=>{
    setLoading(true);setText("");
    try{
      const res=await fetch(`${API_BASE}/api/ai/analyze`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          systemPrompt:systemPrompt||`당신은 15년 경력의 전문 주식 트레이더이자 경제 분석가입니다.
아래의 세 가지 핵심 기법 체계를 반드시 분석에 통합하세요:

【스펙터 바닥연구 기법】
- 스토캐스틱 지수이평(20,12) 기반 골드크로스 신호 체계: 주봉1차골드(10%)→주봉2차골드(20%)→주봉3차골드(30%)→월봉골드(20%)→60일/240일골드(10%)→N파동눌린목(10%) 순 분할매수
- 일봉=단타, 주봉=스윙, 월봉=바닥 확정 기준
- RSI+MFI 복합 그린존 발바닥 확인
- 바닥지표 데드크로스 = 폭락 징조

【독개미 비법서 기법】
- 정배열(5<20<60<120<240일선 탑다운): 살아있는 종목만 매매
- 역배열: 절대 진입 금지
- 스토캐스틱(10,6,6): 그린존 과침체 매수, 레드존 과열 매도
- ADX(DMI): PDI>NDI 골든크로스=상승 초입, NDI>PDI 데드크로스=하락
- 볼린저밴드: 하단 터치 반등=매수, 상단 이탈+밴드 확장=추세 시작, 60일선 이격 30%↑=진입금지
- 짝궁뎅이(쌍바닥)+N자 파동=재상승 신호
- 120일선·240일선(참치라인): 급락 시 반드시 반등 구간, 240일선=바닥 확정
- 60일선 이격 30%↑=과열 진입 금지
- 전저점 이탈=손절 기준
- 5파동이론: 1~3파 분할매수, 5파 고점 매도
- 엘리엇 ABC파동: C파=개미지옥 주의

【경제명탐정 차트 시리즈 (4·5주차)】
- 베이스 지지선: 종목마다 '타고 가는 이평선'이 다름. 그 선이 매매 기준선. 한국=5/20/60/120일선 SMA, 미국=10/21/50/200일선(21만 EMA)
- 단계별 분할 매도: '타고 가는 이평선' 첫 이탈=1차 30% 익절 → 그다음 이평선 이탈=2차 50% → 장기선까지 깨지면 잔량 정리
- 눌림목 시험매수: 베이스 이평선 근처 '지지 액션'(꼬리 양봉+거래량 감소 후 양봉반등 또는 2~3일 횡보 후 재상승) 확인 후 30~50% 시험매수, 흐름 회복 확인 후 추가
- 하락장 끝 신호등(이평선 상향돌파 점진 매수): 20일선 돌파=1단계(30~40%) → 60일선 돌파=2단계(잔량) → 120/200일선=3단계(최대 비중). 거래량 동반·이평선 우상향 전환 동시 확인
- 지지 액션 신뢰도 3중 체크: ①거래량 평소 대비 증가 ②긴 밑꼬리 ③지수 하락일에 만들어진 양봉이면 신뢰도 최상
- 컨플루언스(신호 겹침): 한 자리에 매수근거 2개=시험매수, 3개 이상=정식매수. 억지로 찾지 말고 자연스럽게 보이는 자리만
- 역할 전환 2단계 매수: 저항 돌파 양봉 당일=시험매수(정찰병) → 며칠 뒤 그 선까지 되돌림+지지 액션=정식매수
- 이평선은 '선'이 아니라 '구간(±2%)': 단발 이탈에 흔들리지 말고 종가 기준·구간 개념으로 판단
- 베이스 이평선 거리 측정 의무: 매수 전 현재가↔20일선(한국)/21일선(미국) % 거리를 반드시 계산. "사지 말라가 아니라 알고 사라" — -10% 이상 벌어진 자리는 정상 호흡 범위 인지 후 진입

【고고저 기법 (빗각 활용 추세선 매매)】
- 핵심: 차트의 두 고점을 빗각(추세선)으로 잇고, 그 선이 작동하는지 추적
- 하락추세선(고점-고점 빗각): 두 개 이상의 고점이 점점 낮아질 때 잇는 선. 저항으로 작동
- 상승추세선(저점-저점 빗각): 두 개 이상의 저점이 점점 높아질 때 잇는 선. 지지로 작동
- 바닥 다지기 구간 식별: 하락추세선 아래에서 저점이 더 이상 낮아지지 않고 수평/약상승 형성 = 삼각수렴 또는 하락쐐기형(Falling Wedge)
- 매수 시그널: 캔들이 하락추세선을 종가로 확실히 상향돌파(윗꼬리만 살짝이 아니라 양봉 몸통이 빗각 위) + 거래량 동반 → '트레이딩 준비'
- 정식 진입: 돌파 다음 봉 또는 돌파선까지 되돌림(역할 전환) 후 지지 액션 확인 → 진입
- 매도 시그널: 상승추세선이 종가로 깨지면 추세 종료 신호 → 분할 매도
- 빗각의 신뢰도: 추세선이 닿은 횟수가 많을수록(3번 이상 터치) 강한 추세선. 한 번만 닿은 빗각은 신뢰도 낮음
- 빗각 + 캔들 패턴 결합: 빗각 돌파 캔들이 양봉·긴 몸통·거래량 증가면 신뢰도 최상, 도지·짧은 몸통이면 가짜 돌파 의심
- 빗각 + 이평선 컨플루언스: 빗각 돌파와 동시에 베이스 이평선(20일/60일선)도 같이 돌파하면 신호 강도 2배

분석 시 이 기법들을 명시적으로 언급하며 매수/매도 시점, 목표가, 손절가를 제시하세요. 특히 '베이스 지지선이 무엇인지', '현재 컨플루언스 신호 몇 개가 겹치는지', '이평선까지의 거리는 얼마인지', '빗각(추세선)이 작동 중인지'를 우선 짚어주세요. 300자 이내로 핵심만.`,
          prompt,
          maxTokens:1000,
        }),
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"AI 분석 API 오류");
      const result=data.text||"분석 결과를 가져올 수 없습니다.";
      let i=0;
      const interval=setInterval(()=>{setText(result.slice(0,i));i+=3;if(i>result.length){setText(result);clearInterval(interval);setLoading(false);}},20);
    }catch(e){setText(`API 연결 오류: ${e.message||"잠시 후 다시 시도해주세요."}`);setLoading(false);}
  };
  return{text,loading,run};
}

// ════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════
function Dashboard(){
  const spark1=[62,65,61,67,70,68,73,71,76,74,78,75,80,79,84];
  const spark2=[80,78,75,72,74,71,69,72,70,68,65,67,64,62,60];
  const barData=[42,67,55,78,63,91,84,72,88,76,93,87];
  const barColors=[C.accent,C.green,C.purple,C.yellow,C.accent,C.green,C.purple,C.accent,C.green,C.accent,C.green,C.accent];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8,animation:"rise 0.4s ease"}}>
      <div className="market-grid">
        {MARKET_DATA.map((m,i)=>(
          <div key={i} className="panel market-card">
            <div className="market-name">{m.name}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:8,minWidth:0}}>
              <div style={{minWidth:0,flex:1}}>
                <div className="market-val">{m.val}</div>
                <div className="market-sub">{m.sub}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div className="market-ch" style={{color:m.up?C.green:C.red}}>{m.ch}</div>
                <Sparkline data={m.up?spark1:spark2} color={m.up?C.green:C.red}/>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8}} className="dash-bottom">
      <div className="panel" style={{padding:0}}>
        <div className="panel-title"><div className="dot-live"/>AI 시장 진단 — 실시간</div>
        <div style={{padding:"14px 16px"}}>
          <div className="ai-diag-grid">
          {[
            {label:"시장 심리",val:"중립→강세",score:68,color:C.yellow},
            {label:"변동성(VIX)",val:"17.2 안정",score:34,color:C.green},
            {label:"매크로",val:"금리 동결 예상",score:71,color:C.accent},
            {label:"외국인 수급",val:"2일 연속 순매수",score:78,color:C.green},
          ].map((item,i)=>(
            <div key={i} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:11,color:C.textDim,letterSpacing:1}}>{item.label}</span>
                <span className="mono" style={{fontSize:11,color:item.color}}>{item.score}</span>
              </div>
              <div style={{fontSize:13,color:C.text,fontWeight:500,marginBottom:8}}>{item.val}</div>
              <div style={{height:3,background:C.border,borderRadius:2}}>
                <div style={{height:3,width:`${item.score}%`,background:item.color,borderRadius:2}}/>
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
      <div className="panel" style={{padding:0}}>
        <div className="panel-title">포트폴리오 요약</div>
        <div style={{padding:"14px 16px"}}>
          <div className="portfolio-big" style={{color:C.green}}>+12.84%</div>
          <div style={{fontSize:11,color:C.textDim,marginBottom:12}}>총 수익률</div>
          <MiniBar data={barData} colors={barColors}/>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10}}>
            {["국내","미국","크립토"].map((l,i)=>(
              <div key={i} style={{textAlign:"center"}}>
                <div className="mono" style={{fontSize:11,color:[C.accent,C.green,C.purple][i]}}>{["48%","35%","17%"][i]}</div>
                <div style={{fontSize:10,color:C.textDim}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>{/* dash-bottom 그리드 닫기 */}
      <div className="panel" style={{padding:0}}>
        <div className="panel-title"><div className="dot-live"/>최근 시그널 (스펙터·독개미·경제명탐정·고고저 통합)</div>
        <div className="signal-grid">
          {ALERTS.slice(0,5).map((a,i)=>(
            <div key={i} className="signal-cell" style={{opacity:a.read?0.5:1}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span className={`tag tag-${a.type==="BUY"?"green":a.type==="SELL"?"red":"yellow"}`}>{a.type}</span>
                <span className="mono" style={{fontSize:10,color:C.textMuted}}>{a.time}</span>
              </div>
              <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:2}}>{a.sym}</div>
              <div style={{fontSize:11,color:C.textDim,lineHeight:1.4}}>{a.msg}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 차트 분석 (NEW - 기법 통합)
// ════════════════════════════════════════════════════════════════════
function ChartAnalysis(){
  const {text,loading,run}=useAIStream();
  const [sym,setSym]=useState("삼성전자");
  const [tf,setTf]=useState("주봉");
  const [checkedTechs,setCheckedTechs]=useState({
    specterGold:true, stochastic:true, adx:true, bollinger:true,
    alignment:true, wave5:true, nwave:true, ma240:true,
    doubleBtm:true, rsiMfi:true, trendLine:true, candle:true,
    edBase:true, edAction:true, edConfluence:true, edSignal:true,
    edRoleSwap:true, edDistance:true,
    gjLine:true, gjBreak:true, gjWedge:true, gjEntry:true,
    gjTouch:true, gjBreakdown:true,
  });

  const TECHNIQUES = [
    {
      group:"【스펙터 바닥연구】",color:C.purple,items:[
        {key:"specterGold",label:"골드크로스 분할매수 6단계",desc:"주봉1~3차→월봉→60/240일→N파동 순 비중배분"},
        {key:"rsiMfi",label:"RSI+MFI 그린존 바닥확인",desc:"RSI+MFI 복합 과침체 확인 후 매수 타이밍"},
      ]
    },
    {
      group:"【독개미 비법서】",color:C.accent,items:[
        {key:"alignment",label:"정배열/역배열 판단",desc:"5<20<60<120<240일선 정배열=진입, 역배열=절대 금지"},
        {key:"stochastic",label:"스토캐스틱(10,6,6) 마켓타이밍",desc:"그린존 과침체 매수↑ / 레드존 과열 매도↓"},
        {key:"adx",label:"ADX/DMI 방향성 강도",desc:"PDI>NDI 골든크로스=상승 초입 / NDI>PDI=하락"},
        {key:"bollinger",label:"볼린저밴드 추세·변동성",desc:"하단반등=매수 / 밴드확장+하단타기=추세하락 / 60일이격30%↑=진입금지"},
        {key:"ma240",label:"120/240일선(참치라인) 바닥",desc:"급락 시 반드시 반등 구간 / 240일선=바닥확정"},
        {key:"wave5",label:"엘리엇 5파동+ABC",desc:"1~3파 분할매수, 5파 고점매도, C파 개미지옥 주의"},
        {key:"nwave",label:"N자파동·짝궁뎅이(쌍바닥)",desc:"쌍바닥 후 N자 상승파동 2차 랠리 진입"},
        {key:"doubleBtm",label:"전저점 손절 기준",desc:"전저점 이탈 확인 시 즉시 손절 원칙"},
        {key:"trendLine",label:"추세선 스윙매매",desc:"고점·저점 연결 추세채널 상단매도·하단매수"},
        {key:"candle",label:"망치형·역망치 캔들",desc:"바닥 망치형=매수신호, 고점 역망치=매도신호"},
      ]
    },
    {
      group:"【경제명탐정 4·5주차】",color:C.yellow,items:[
        {key:"edBase",label:"베이스 지지선 식별",desc:"종목이 '타고 가는' 이평선 판별(한국 5/20/60, 미국 10/21/50) → 매매 기준선 확정"},
        {key:"edAction",label:"지지 액션 3중 신뢰도",desc:"이평선 근처 양봉+거래량 증가+긴 밑꼬리+지수 하락일이면 신뢰도 최상"},
        {key:"edConfluence",label:"컨플루언스(신호 겹침)",desc:"한 자리에 매수근거 2개=시험매수, 3개+=정식매수"},
        {key:"edSignal",label:"하락장 끝 신호등 단계 매수",desc:"20일선 돌파=1단계 → 60일선 돌파=2단계 → 120/200일선=3단계, 거래량 동반 필수"},
        {key:"edRoleSwap",label:"역할 전환 2단계 매수",desc:"저항 돌파 양봉=시험매수, 되돌림 지지 액션=정식매수"},
        {key:"edDistance",label:"베이스 이평선 거리 측정",desc:"현재가↔20일선(또는 21일선) % 거리 산정 — '알고 사라' 원칙"},
      ]
    },
    {
      group:"【고고저 기법 (빗각 추세선)】",color:C.red,items:[
        {key:"gjLine",label:"하락추세선(고점-고점 빗각)",desc:"두 고점 이상을 잇는 하향 빗각 = 저항선. 닿은 횟수 3회 이상이면 강한 추세선"},
        {key:"gjWedge",label:"바닥 다지기 + 하락쐐기형",desc:"하락추세선 아래에서 저점이 더 낮아지지 않고 수평/약상승 = 삼각수렴·Falling Wedge"},
        {key:"gjBreak",label:"빗각 상향돌파 신호",desc:"양봉 몸통이 종가로 하락추세선 위 마감 + 거래량 동반 → 트레이딩 준비"},
        {key:"gjEntry",label:"돌파 후 진입 자리",desc:"돌파 다음 봉 또는 빗각까지 되돌림 후 지지 액션 확인 시 정식 진입"},
        {key:"gjTouch",label:"빗각 터치 횟수 카운트",desc:"동일 추세선에 3회 이상 닿은 빗각만 유효 신호로 인정"},
        {key:"gjBreakdown",label:"상승추세선 이탈 매도",desc:"저점-저점 잇는 상승추세선이 종가로 깨지면 추세 종료 → 분할 매도"},
      ]
    },
  ];

  const allKeys=TECHNIQUES.flatMap(g=>g.items.map(i=>i.key));
  const toggle=(k)=>setCheckedTechs(p=>({...p,[k]:!p[k]}));
  const toggleAll=(keys,val)=>setCheckedTechs(p=>{const n={...p};keys.forEach(k=>n[k]=val);return n;});

  const analyze=()=>{
    const selected=TECHNIQUES.flatMap(g=>g.items.filter(i=>checkedTechs[i.key]).map(i=>`- ${i.label}: ${i.desc}`)).join("\n");
    run(
      `${sym} 종목을 ${tf} 기준으로 분석해주세요.\n\n아래 선택된 기법들을 모두 적용하여 현재 차트 상태, 매매 시점, 목표가, 손절가를 제시해주세요:\n${selected}`,
    );
  };

  return(
    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:8,animation:"rise 0.4s ease"}}>
      {/* 기법 선택 패널 */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {/* 종목·타임프레임 입력 */}
        <div className="panel" style={{padding:"14px 16px"}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:10}}>분석 설정</div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:11,color:C.textDim,marginBottom:4}}>종목명</div>
            <input className="input-field" value={sym} onChange={e=>setSym(e.target.value)} placeholder="예: NVDA, 삼성전자, BTC"/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textDim,marginBottom:4}}>타임프레임</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {["일봉","주봉","월봉"].map(t=>(
                <button key={t} onClick={()=>setTf(t)} style={{
                  padding:"4px 12px",fontSize:11,cursor:"pointer",borderRadius:1,
                  fontFamily:"'Rajdhani',sans-serif",fontWeight:600,letterSpacing:1,
                  background:tf===t?`${C.accent}22`:"transparent",
                  color:tf===t?C.accent:C.textDim,
                  border:`1px solid ${tf===t?C.accent:C.border}`,
                }}>{t}</button>
              ))}
            </div>
          </div>
        </div>

        {/* 기법 체크리스트 */}
        <div className="panel" style={{padding:0,flex:1,overflowY:"auto",maxHeight:480}}>
          <div className="panel-title">
            적용 기법 선택
            <button onClick={()=>toggleAll(allKeys,true)} style={{marginLeft:"auto",fontSize:9,padding:"2px 6px",background:`${C.accent}22`,color:C.accent,border:`1px solid ${C.accent}44`,cursor:"pointer",borderRadius:1}}>전체</button>
            <button onClick={()=>toggleAll(allKeys,false)} style={{fontSize:9,padding:"2px 6px",background:`${C.red}22`,color:C.red,border:`1px solid ${C.red}44`,cursor:"pointer",borderRadius:1}}>해제</button>
          </div>
          <div style={{padding:"8px 0"}}>
            {TECHNIQUES.map((grp,gi)=>(
              <div key={gi}>
                <div style={{
                  padding:"6px 14px",fontSize:10,fontFamily:"'Orbitron',monospace",
                  color:grp.color,letterSpacing:1,
                  background:`${grp.color}11`,borderBottom:`1px solid ${grp.color}22`,
                  display:"flex",alignItems:"center",justifyContent:"space-between",
                }}>
                  {grp.group}
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>toggleAll(grp.items.map(i=>i.key),true)} style={{fontSize:8,padding:"1px 5px",background:`${grp.color}22`,color:grp.color,border:`1px solid ${grp.color}44`,cursor:"pointer",borderRadius:1}}>전체</button>
                    <button onClick={()=>toggleAll(grp.items.map(i=>i.key),false)} style={{fontSize:8,padding:"1px 5px",background:C.bg2,color:C.textMuted,border:`1px solid ${C.border}`,cursor:"pointer",borderRadius:1}}>해제</button>
                  </div>
                </div>
                {grp.items.map((item,ii)=>(
                  <div key={ii} onClick={()=>toggle(item.key)} style={{
                    padding:"8px 14px",cursor:"pointer",borderBottom:`1px solid ${C.border}33`,
                    display:"flex",alignItems:"flex-start",gap:10,
                    background:checkedTechs[item.key]?`${grp.color}08`:"transparent",
                    transition:"all 0.15s",
                  }}>
                    <div style={{
                      width:14,height:14,flexShrink:0,marginTop:1,border:`1px solid ${checkedTechs[item.key]?grp.color:C.border}`,
                      borderRadius:1,background:checkedTechs[item.key]?`${grp.color}33`:"transparent",
                      display:"flex",alignItems:"center",justifyContent:"center",
                    }}>
                      {checkedTechs[item.key]&&<div style={{width:6,height:6,background:grp.color,borderRadius:"1px"}}/>}
                    </div>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:checkedTechs[item.key]?C.text:C.textDim,marginBottom:2}}>{item.label}</div>
                      <div style={{fontSize:10,color:C.textMuted,lineHeight:1.4}}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" style={{width:"100%",padding:"10px",fontSize:13}} onClick={analyze}>
          ▶ AI 종합 차트 분석 실행
        </button>
      </div>

      {/* AI 분석 결과 */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {/* 기법 요약 카드 */}
        <div className="panel" style={{padding:0}}>
          <div className="panel-title">핵심 기법 빠른 참조</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:0}}>
            {[
              {icon:"◈",label:"바닥확인순서",val:"주봉골드→월봉골드→60/240골드→N파동",color:C.purple},
              {icon:"◉",label:"진입 금지 신호",val:"역배열·60일이격30%↑·전저점이탈·ADX데드",color:C.red},
              {icon:"◆",label:"최종 바닥 확정",val:"240일선 지지+월봉골드+RSI/MFI 그린존",color:C.green},
            ].map((c,i)=>(
              <div key={i} style={{padding:"12px 14px",borderRight:i<2?`1px solid ${C.border}`:"none"}}>
                <div style={{fontSize:18,color:c.color,marginBottom:4}}>{c.icon}</div>
                <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:4}}>{c.label}</div>
                <div style={{fontSize:12,color:C.text,lineHeight:1.5}}>{c.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AI 분석 결과 출력 */}
        <div className="panel" style={{flex:1,padding:0}}>
          <div className="panel-title">
            <div className="dot-live"/>AI 분석 결과
            {sym&&<span style={{marginLeft:8,color:C.text,fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13}}>{sym}</span>}
            {tf&&<span className="tag tag-accent" style={{marginLeft:4,fontSize:9}}>{tf}</span>}
          </div>
          <div style={{padding:"16px 20px"}}>
            {!text&&!loading&&(
              <div>
                <div style={{color:C.textMuted,fontSize:13,textAlign:"center",padding:"30px 0 20px"}}>
                  ← 좌측에서 종목·기법 선택 후 분석 실행
                </div>
                {/* 빠른 분석 */}
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16}}>
                  <div style={{fontSize:10,color:C.textDim,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:10}}>빠른 분석</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                    {[
                      "지금 코스피 정배열인가?",
                      "BTC 주봉 골드크로스 상태?",
                      "NVDA 5파동 어디쯤?",
                      "삼성전자 240일선까지 얼마?",
                    ].map((q,i)=>(
                      <button key={i} onClick={()=>run(q)} style={{
                        padding:"8px 12px",fontSize:12,background:C.bg2,border:`1px solid ${C.border}`,
                        color:C.textDim,cursor:"pointer",borderRadius:1,fontFamily:"'Rajdhani',sans-serif",
                        textAlign:"left",transition:"all 0.15s",
                      }}>{q}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {(text||loading)&&(
              <div style={{fontSize:13,color:C.text,lineHeight:1.9}} className={loading?"ai-typing":""}>{text}</div>
            )}
          </div>
        </div>

        {/* 직접 질문 */}
        <div className="panel" style={{padding:"12px 16px"}}>
          <DirectQuestion run={run}/>
        </div>
      </div>
    </div>
  );
}

function DirectQuestion({run}){
  const [q,setQ]=useState("");
  return(
    <div style={{display:"flex",gap:6}}>
      <input className="input-field" value={q} onChange={e=>setQ(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&q.trim()){run(q);setQ("");}}}
        placeholder="스펙터·독개미·경제명탐정·고고저 기법 기반 질문 입력..."/>
      <button className="btn btn-primary" onClick={()=>{if(q.trim()){run(q);setQ("")}}}>분석</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SCREENER
// ════════════════════════════════════════════════════════════════════
function Screener(){
  const [filters,setFilters]=useState({rsiMax:70,rsiMin:20,perMax:50,signal:"ALL"});
  const filtered=SCREENER_DATA.filter(r=>r.rsi>=filters.rsiMin&&r.rsi<=filters.rsiMax&&r.per<=filters.perMax&&(filters.signal==="ALL"||r.signal===filters.signal));
  return(
    <div style={{animation:"rise 0.4s ease"}}>
      <div className="panel" style={{padding:"12px 16px",marginBottom:8}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:C.textDim,letterSpacing:2,fontFamily:"'Orbitron',monospace"}}>FILTER</span>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,color:C.textDim}}>RSI</span>
            <input className="input-field" type="number" value={filters.rsiMin} onChange={e=>setFilters({...filters,rsiMin:+e.target.value})} style={{width:54}} placeholder="min"/>
            <span style={{color:C.textMuted}}>~</span>
            <input className="input-field" type="number" value={filters.rsiMax} onChange={e=>setFilters({...filters,rsiMax:+e.target.value})} style={{width:54}} placeholder="max"/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,color:C.textDim}}>PER ≤</span>
            <input className="input-field" type="number" value={filters.perMax} onChange={e=>setFilters({...filters,perMax:+e.target.value})} style={{width:60}}/>
          </div>
          <select className="input-field" value={filters.signal} onChange={e=>setFilters({...filters,signal:e.target.value})} style={{width:100}}>
            <option>ALL</option><option>BUY</option><option>SELL</option><option>HOLD</option>
          </select>
          <span style={{marginLeft:"auto",fontSize:11,color:C.textDim}}>{filtered.length}개 종목</span>
        </div>
      </div>
      <div className="panel" style={{padding:0}}>
        <div className="panel-title">종목 스크리너 (정배열·스토캐스틱·ADX 복합 필터)</div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["종목","섹터","시가총액","PER","PBR","RSI","등락","시그널"].map(h=>(
                <th key={h} style={{padding:"8px 14px",fontSize:10,color:C.textMuted,textAlign:"left",fontFamily:"'Orbitron',monospace",letterSpacing:1,fontWeight:400}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r,i)=>(
              <tr key={i} className="row-hover" style={{borderBottom:`1px solid ${C.border}44`,cursor:"pointer"}}>
                <td style={{padding:"10px 14px",fontWeight:700,fontSize:14}}>{r.sym}</td>
                <td><span className="tag tag-accent" style={{fontSize:10}}>{r.sec}</span></td>
                <td className="mono" style={{padding:"10px 14px",fontSize:12,color:C.textDim}}>{r.mc}</td>
                <td className="mono" style={{padding:"10px 14px",fontSize:12,color:r.per<20?C.green:r.per>40?C.red:C.text}}>{r.per}</td>
                <td className="mono" style={{padding:"10px 14px",fontSize:12}}>{r.pbr}</td>
                <td>
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"10px 14px 10px 0"}}>
                    <div style={{width:40,height:4,background:C.border,borderRadius:2}}>
                      <div style={{width:`${r.rsi}%`,height:4,background:r.rsi<40?C.green:r.rsi>65?C.red:C.yellow,borderRadius:2}}/>
                    </div>
                    <span className="mono" style={{fontSize:11,color:C.textDim}}>{r.rsi}</span>
                  </div>
                </td>
                <td className="mono" style={{padding:"10px 14px",color:r.up?C.green:C.red,fontSize:12}}>{r.ch}</td>
                <td style={{padding:"10px 14px"}}><span className={`tag tag-${r.signal==="BUY"?"green":r.signal==="SELL"?"red":"yellow"}`}>{r.signal}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PORTFOLIO
// ════════════════════════════════════════════════════════════════════
function Portfolio(){
  const totalPnl=PORTFOLIO.reduce((s,p)=>s+(p.cur-p.avg)*p.qty,0);
  return(
    <div style={{animation:"rise 0.4s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
        {[
          {label:"총 평가금액",val:"₩ 52,847,200",color:C.text},
          {label:"총 수익금",val:`+₩ ${Math.round(totalPnl).toLocaleString()}`,color:C.green},
          {label:"총 수익률",val:"+12.84%",color:C.green},
          {label:"보유 종목수",val:"5개",color:C.accent},
        ].map((c,i)=>(
          <div key={i} className="panel" style={{padding:"14px 16px"}}>
            <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:6}}>{c.label}</div>
            <div className="mono" style={{fontSize:18,fontWeight:700,color:c.color}}>{c.val}</div>
          </div>
        ))}
      </div>
      <div className="panel" style={{padding:0,marginBottom:8}}>
        <div className="panel-title">보유 종목</div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["종목","섹터","수량","평균단가","현재가","평가손익","수익률","스파크"].map(h=>(
                <th key={h} style={{padding:"8px 14px",fontSize:10,color:C.textMuted,textAlign:"left",fontFamily:"'Orbitron',monospace",letterSpacing:1,fontWeight:400}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PORTFOLIO.map((p,i)=>{
              const pnl=(p.cur-p.avg)*p.qty,rate=((p.cur-p.avg)/p.avg*100).toFixed(2),up=pnl>=0;
              const spark=Array.from({length:12},()=>p.avg+(Math.random()-0.5)*(p.cur-p.avg)*2);
              spark[11]=p.cur;
              return(
                <tr key={i} className="row-hover" style={{borderBottom:`1px solid ${C.border}44`}}>
                  <td style={{padding:"10px 14px",fontWeight:700,fontSize:14}}>{p.sym}</td>
                  <td><span className="tag tag-accent" style={{fontSize:10}}>{p.sec}</span></td>
                  <td className="mono" style={{padding:"10px 14px",fontSize:12}}>{p.qty}</td>
                  <td className="mono" style={{padding:"10px 14px",fontSize:12,color:C.textDim}}>{p.avg.toLocaleString()}</td>
                  <td className="mono" style={{padding:"10px 14px",fontSize:12,fontWeight:600}}>{p.cur.toLocaleString()}</td>
                  <td className="mono" style={{padding:"10px 14px",fontSize:12,color:up?C.green:C.red}}>{up?"+":""}{Math.round(pnl).toLocaleString()}</td>
                  <td className="mono" style={{padding:"10px 14px",fontSize:12,color:up?C.green:C.red}}>{up?"+":""}{rate}%</td>
                  <td style={{padding:"6px 14px"}}><Sparkline data={spark} color={up?C.green:C.red}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel" style={{padding:0}}>
        <div className="panel-title"><div className="dot-live"/>AI 리밸런싱 제안 (스펙터·독개미·경제명탐정·고고저 기법 기반)</div>
        <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          {[
            {action:"비중 축소",sym:"BTC",reason:"월봉 골드 미발생·레드존 과열·암호화폐 비중 17%→10%",color:C.yellow},
            {action:"비중 확대",sym:"NVDA",reason:"주봉 3차 골드+정배열 유지·ADX PDI 상승·240일선 위",color:C.green},
            {action:"신규 편입",sym:"현대차",reason:"저PBR+240일선 지지+스토캐스틱 그린존 접근·짝궁뎅이 패턴",color:C.accent},
          ].map((r,i)=>(
            <div key={i} style={{background:C.bg2,border:`1px solid ${r.color}44`,borderRadius:2,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span className="tag" style={{color:r.color,borderColor:`${r.color}44`,background:`${r.color}11`,fontSize:10}}>{r.action}</span>
                <span style={{fontWeight:700,color:C.text}}>{r.sym}</span>
              </div>
              <div style={{fontSize:12,color:C.textDim,lineHeight:1.5}}>{r.reason}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════════════════
function AlertCenter(){
  const {text,loading,run}=useAIStream();
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState(null);
  const handleAnalyze=(a)=>{
    setSelected(a.id);
    run(`${a.sym} 종목에 대해 "${a.msg}" 시그널이 발생했습니다. 스펙터 바닥연구 기법, 독개미 비법서 기법, 경제명탐정 차트 시리즈(4·5주차: 베이스 지지선/지지 액션 신뢰도/컨플루언스/신호등 단계 매수/역할 전환/이평선 거리), 고고저 기법(빗각 추세선: 고점-고점 빗각으로 하락추세선/저점-저점 빗각으로 상승추세선 분석, 빗각 종가 돌파 + 거래량 동반 시 매수 신호) 네 가지를 모두 적용하여 현재 상황 분석과 구체적인 매매 전략(진입가, 목표가, 손절가, 베이스 이평선까지의 거리, 빗각 작동 여부)을 제시해주세요.`);
  };
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,animation:"rise 0.4s ease"}}>
      <div className="panel" style={{padding:0}}>
        <div className="panel-title"><div className="dot-live"/>실시간 시그널 <span className="badge" style={{marginLeft:4}}>3</span></div>
        {ALERTS.map((a,i)=>(
          <div key={i} onClick={()=>handleAnalyze(a)} style={{
            padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",
            background:selected===a.id?C.bg2:"transparent",opacity:a.read?0.55:1,
            borderLeft:selected===a.id?`2px solid ${C.accent}`:"2px solid transparent",transition:"all 0.15s",
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span className={`tag tag-${a.type==="BUY"?"green":a.type==="SELL"?"red":"yellow"}`}>{a.type}</span>
                <span style={{fontWeight:700,fontSize:15}}>{a.sym}</span>
                <span className="tag tag-accent" style={{fontSize:9}}>강도:{a.strength}</span>
              </div>
              <span className="mono" style={{fontSize:10,color:C.textMuted}}>{a.time}</span>
            </div>
            <div style={{fontSize:12,color:C.textDim}}>{a.msg}</div>
          </div>
        ))}
      </div>
      <div className="panel" style={{padding:0}}>
        <div className="panel-title">AI 상세 분석 (스펙터+독개미+경제명탐정+고고저 기법 적용)</div>
        <div style={{padding:"14px 16px"}}>
          {!text&&!loading&&<div style={{color:C.textMuted,fontSize:13,textAlign:"center",padding:"40px 0"}}>← 시그널 클릭 시 AI가 스펙터+독개미+경제명탐정+고고저 기법으로 분석</div>}
          {(text||loading)&&<div style={{fontSize:13,color:C.text,lineHeight:1.8,minHeight:120}} className={loading?"ai-typing":""}>{text}</div>}
          <div style={{marginTop:24,borderTop:`1px solid ${C.border}`,paddingTop:16}}>
            <div style={{fontSize:10,color:C.textDim,letterSpacing:2,marginBottom:8,fontFamily:"'Orbitron',monospace"}}>AI에게 직접 질문</div>
            <div style={{display:"flex",gap:6}}>
              <input className="input-field" value={query} onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&query.trim()){run(query);setQuery("");}}}
                placeholder="종목명 또는 기법 기반 질문 입력..."/>
              <button className="btn btn-primary" onClick={()=>{if(query.trim()){run(query);setQuery("")}}}>분석</button>
            </div>
            <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
              {["주봉 골드크로스 종목은?","BTC N자 파동 위치?","오늘 정배열 섹터?"].map((q,i)=>(
                <button key={i} onClick={()=>run(q)} style={{padding:"4px 10px",fontSize:11,background:C.bg2,border:`1px solid ${C.border}`,color:C.textDim,cursor:"pointer",borderRadius:1,fontFamily:"'Rajdhani',sans-serif"}}>{q}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════════════
const AI_REPORTS=[
  {sym:"NVDA",date:"2026.05.24",score:92,
   summary:"정배열 유지(5<20<60<120<240). 주봉 스토캐스틱(10,6,6) 그린존 상승. ADX PDI>NDI 골든 유지. 볼린저 중심선 위 안착. 5파동 3파 진행 추정.",
   tags:["정배열","주봉골드","ADX상승"],ta:"강세",fa:"우수",macro:"유리",sentiment:"긍정",target:"$165",stop:"$128"},
  {sym:"삼성전자",date:"2026.05.23",score:74,
   summary:"주봉 2차 골드 진입 구간. 240일선(참치라인) 지지 확인. RSI 42 그린존 접근. ADX 방향성 전환 대기. 월봉 골드 미확정으로 추가 분할매수 전략.",
   tags:["240일선지지","주봉2차골드","분할매수"],ta:"중립",fa:"양호",macro:"중립",sentiment:"혼조",target:"82,000",stop:"70,000"},
];

function ReportView(){
  const {text,loading,run}=useAIStream();
  const [activeReport,setActiveReport]=useState(null);
  const [customSym,setCustomSym]=useState("");
  const handleReport=(r)=>{
    setActiveReport(r);
    run(`${r.sym} 종목에 대한 종합 투자 분석 리포트를 작성해주세요. 반드시 다음 네 가지 기법 체계를 모두 적용하세요. (1) 스펙터 바닥연구 기법(골드크로스 6단계, RSI+MFI 그린존) (2) 독개미 비법서 기법(정배열/역배열 판단, 스토캐스틱 10,6,6, ADX/DMI, 볼린저밴드, 120/240일선 참치라인, 5파동, N자파동, 전저점 손절) (3) 경제명탐정 4·5주차 기법(베이스 지지선 식별, 지지 액션 3중 신뢰도, 컨플루언스 신호 겹침, 하락장 끝 신호등 단계 매수, 역할 전환 2단계 매수, 베이스 이평선 거리 측정) (4) 고고저 기법(빗각 활용 추세선 매매: 고점-고점 빗각 = 하락추세선, 저점-저점 빗각 = 상승추세선, 종가 돌파 + 거래량 동반 시 매수, 3회 이상 터치한 빗각만 유효, 돌파 후 되돌림 자리 = 역할 전환 정식 진입). 현재 파동 위치, 베이스 이평선까지의 거리, 컨플루언스 카운트, 빗각 작동 여부 및 터치 횟수, 매매 시점, 목표가, 손절가를 명시하세요.`);
  };
  return(
    <div style={{animation:"rise 0.4s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:8}}>
        <div>
          <div className="panel" style={{padding:0,marginBottom:8}}>
            <div className="panel-title">저장된 리포트</div>
            {AI_REPORTS.map((r,i)=>(
              <div key={i} onClick={()=>handleReport(r)} style={{
                padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",
                background:activeReport?.sym===r.sym?C.bg2:"transparent",
                borderLeft:activeReport?.sym===r.sym?`2px solid ${C.accent}`:"2px solid transparent",transition:"all 0.15s",
              }}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:15}}>{r.sym}</span>
                  <div style={{width:28,height:28,borderRadius:"50%",border:`2px solid ${r.score>80?C.green:r.score>60?C.yellow:C.red}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span className="mono" style={{fontSize:10,color:r.score>80?C.green:r.score>60?C.yellow:C.red}}>{r.score}</span>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.textDim,marginBottom:6,lineHeight:1.4}}>{r.summary.slice(0,60)}...</div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{r.tags.map((t,j)=><span key={j} className="tag tag-accent" style={{fontSize:9}}>{t}</span>)}</div>
              </div>
            ))}
          </div>
          <div className="panel" style={{padding:"12px 16px"}}>
            <div style={{fontSize:10,color:C.textDim,letterSpacing:2,marginBottom:8,fontFamily:"'Orbitron',monospace"}}>새 리포트 생성</div>
            <input className="input-field" value={customSym} onChange={e=>setCustomSym(e.target.value)} placeholder="종목명 입력" style={{marginBottom:8}}/>
            <button className="btn btn-primary" style={{width:"100%"}} onClick={()=>{if(customSym.trim()){handleReport({sym:customSym,date:"",score:0,summary:"",tags:[],ta:"",fa:"",macro:"",sentiment:"",target:"",stop:""});setCustomSym("")}}}>AI 리포트 생성</button>
          </div>
        </div>
        <div className="panel" style={{padding:0}}>
          {activeReport?.sym?(
            <>
              <div className="panel-title">
                <span style={{fontSize:14,fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}>{activeReport.sym}</span>
                <span style={{color:C.textMuted,fontWeight:400}}> 스펙터+독개미+경제명탐정+고고저 종합 분석 리포트</span>
                <span style={{marginLeft:"auto",fontSize:10,color:C.textMuted}}>{activeReport.date}</span>
              </div>
              <div style={{padding:"16px 20px"}}>
                {activeReport.score>0&&(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
                    <div style={{gridRow:"span 2",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:2,padding:"14px 0"}}>
                      <div style={{fontSize:36,fontWeight:900,fontFamily:"'Orbitron',monospace",color:activeReport.score>80?C.green:activeReport.score>60?C.yellow:C.red}}>{activeReport.score}</div>
                      <div style={{fontSize:10,color:C.textDim,letterSpacing:2}}>AI SCORE</div>
                    </div>
                    {[
                      {label:"기술적",val:activeReport.ta,color:activeReport.ta==="강세"?C.green:activeReport.ta==="약세"?C.red:C.yellow},
                      {label:"기본적",val:activeReport.fa,color:activeReport.fa==="우수"?C.green:activeReport.fa==="불량"?C.red:C.yellow},
                      {label:"매크로",val:activeReport.macro,color:activeReport.macro==="유리"?C.green:activeReport.macro==="불리"?C.red:C.yellow},
                      {label:"센티먼트",val:activeReport.sentiment,color:activeReport.sentiment==="긍정"?C.green:activeReport.sentiment==="부정"?C.red:C.yellow},
                    ].map((m,i)=>(
                      <div key={i} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px"}}>
                        <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:4}}>{m.label}</div>
                        <div style={{fontSize:14,fontWeight:700,color:m.color}}>{m.val}</div>
                      </div>
                    ))}
                    <div style={{background:C.bg2,border:`1px solid ${C.green}44`,borderRadius:2,padding:"10px 12px"}}>
                      <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:4}}>목표가</div>
                      <div className="mono" style={{fontSize:14,fontWeight:700,color:C.green}}>{activeReport.target}</div>
                    </div>
                    <div style={{background:C.bg2,border:`1px solid ${C.red}44`,borderRadius:2,padding:"10px 12px"}}>
                      <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:4}}>손절가</div>
                      <div className="mono" style={{fontSize:14,fontWeight:700,color:C.red}}>{activeReport.stop}</div>
                    </div>
                    <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px"}}>
                      <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:4}}>요약</div>
                      <div style={{fontSize:11,color:C.textDim,lineHeight:1.4}}>{activeReport.summary.slice(0,60)}...</div>
                    </div>
                  </div>
                )}
                <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:2,padding:"16px"}}>
                  <div style={{fontSize:10,color:C.accent,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:12}}>AI 상세 분석 (스펙터+독개미+경제명탐정+고고저 기법 통합)</div>
                  {loading&&!text&&<div style={{color:C.textMuted,fontSize:12}}>분석 리포트 생성 중...</div>}
                  <div style={{fontSize:13,color:C.text,lineHeight:1.9}} className={loading?"ai-typing":""}>{text||activeReport.summary}</div>
                </div>
              </div>
            </>
          ):(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:400,color:C.textMuted,fontSize:13}}>← 좌측에서 리포트를 선택하거나 새로 생성하세요</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// NPS TRACKER - 국민연금 지분 변동 추적 (DART 5% 룰 공시 기반)
// ════════════════════════════════════════════════════════════════════
function NpsTracker(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [days,setDays]=useState(60);
  const [filter,setFilter]=useState("ALL"); // ALL | UP | DOWN | NEW

  const load = async()=>{
    setLoading(true); setError(null);
    try{
      const res = await fetch(`${API_BASE}/api/nps?days=${days}&enrich=1`);
      const j = await res.json();
      if(!res.ok) throw new Error(j.error || j.hint || "조회 실패");
      setData(j);
    }catch(e){ setError(e.message); }
    finally{ setLoading(false); }
  };

  useEffect(()=>{ load(); /* eslint-disable-next-line */ },[]);

  const items = data?.items || [];
  const filtered = items.filter(i=>{
    if(filter==="UP") return i.direction==="증가";
    if(filter==="DOWN") return i.direction==="감소";
    if(filter==="NEW") return i.direction==="신규";
    return true;
  });

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div className="panel">
        <div className="panel-title">
          <div className="dot-live" style={{background:C.yellow}}/>
          국민연금 지분 변동 추적 (DART 5% 룰 공시)
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:4}}>
            {[30,60,90].map(d=>(
              <button key={d} onClick={()=>setDays(d)}
                className={`btn ${days===d?"btn-primary":""}`}
                style={{padding:"4px 12px",fontSize:11}}>
                {d}일
              </button>
            ))}
          </div>
          <button className="btn" onClick={load} disabled={loading} style={{padding:"4px 16px",fontSize:11}}>
            {loading?"조회 중...":"▶ 새로고침"}
          </button>
          {data && (
            <div style={{marginLeft:"auto",display:"flex",gap:12,fontSize:11,color:C.textDim}}>
              <span>총 <b style={{color:C.text}}>{data.stats.total}</b>건</span>
              <span style={{color:C.green}}>↑ 증가 {data.stats.increased}</span>
              <span style={{color:C.red}}>↓ 감소 {data.stats.decreased}</span>
              <span style={{color:C.accent}}>★ 신규 {data.stats.newHoldings}</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="panel" style={{borderColor:C.red,background:`${C.red}08`}}>
          <div style={{color:C.red,fontSize:12,marginBottom:6}}>⚠ DART API 오류</div>
          <div style={{color:C.textDim,fontSize:11,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{error}</div>
          <div style={{color:C.textMuted,fontSize:10,marginTop:8}}>
            DART API 키를 .env에 추가하세요:
            <div className="mono" style={{background:C.bg2,padding:"6px 10px",marginTop:4,borderRadius:4,color:C.accent}}>
              DART_API_KEY=발급받은_키
            </div>
            발급: https://opendart.fss.or.kr → 로그인 → 인증키 신청 (무료)
          </div>
        </div>
      )}

      <div className="panel">
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {[{k:"ALL",l:"전체"},{k:"UP",l:"↑ 비중 증가"},{k:"DOWN",l:"↓ 비중 감소"},{k:"NEW",l:"★ 신규 편입"}].map(f=>(
            <button key={f.k} onClick={()=>setFilter(f.k)}
              className={`btn ${filter===f.k?"btn-primary":""}`}
              style={{padding:"4px 10px",fontSize:10}}>
              {f.l}
            </button>
          ))}
        </div>

        {loading && <div style={{textAlign:"center",padding:30,color:C.textDim,fontSize:12}}>DART 공시 조회 중...</div>}

        {!loading && filtered.length===0 && !error && (
          <div style={{textAlign:"center",padding:30,color:C.textMuted,fontSize:12}}>
            {data ? "조건에 맞는 공시 없음" : "데이터를 불러오는 중..."}
          </div>
        )}

        {!loading && filtered.length>0 && (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {/* 헤더 */}
            <div style={{display:"grid",gridTemplateColumns:"40px 1fr 80px 100px 90px 90px 50px",gap:8,padding:"6px 10px",fontSize:9,color:C.textMuted,letterSpacing:1,fontFamily:"'Orbitron',monospace",borderBottom:`1px solid ${C.border}`}}>
              <span>방향</span><span>종목</span><span>코드</span><span>보유비율</span><span>변동</span><span>접수일</span><span>DART</span>
            </div>
            {filtered.map((it,i)=>{
              const dirColor = it.direction==="증가"?C.green : it.direction==="감소"?C.red : it.direction==="신규"?C.accent : C.textDim;
              const dirIcon = it.direction==="증가"?"↑" : it.direction==="감소"?"↓" : it.direction==="신규"?"★" : "·";
              return(
                <div key={i} style={{display:"grid",gridTemplateColumns:"40px 1fr 80px 100px 90px 90px 50px",gap:8,padding:"8px 10px",fontSize:11,alignItems:"center",borderBottom:`1px solid ${C.border}40`,background:i%2?`${C.bg2}40`:"transparent"}}>
                  <span style={{color:dirColor,fontSize:14,fontWeight:700}}>{dirIcon}</span>
                  <span style={{color:C.text,fontWeight:500}}>{it.name}</span>
                  <span className="mono" style={{color:C.textDim,fontSize:10}}>{it.code||"-"}</span>
                  <span className="mono" style={{color:C.text}}>{it.ratio!=null?`${it.ratio.toFixed(2)}%`:"-"}</span>
                  <span className="mono" style={{color:dirColor,fontWeight:600}}>
                    {it.ratioDelta!=null ? `${it.ratioDelta>0?"+":""}${it.ratioDelta.toFixed(2)}%p` : it.direction}
                  </span>
                  <span className="mono" style={{color:C.textMuted,fontSize:10}}>
                    {it.reportDate ? `${it.reportDate.slice(4,6)}/${it.reportDate.slice(6,8)}` : "-"}
                  </span>
                  <a href={it.dartUrl} target="_blank" rel="noreferrer" style={{color:C.accent,fontSize:10,textDecoration:"none"}}>→</a>
                </div>
              );
            })}
          </div>
        )}

        {data && (
          <div style={{marginTop:12,fontSize:10,color:C.textMuted,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
            조회 기간: {data.stats.period.from.slice(0,4)}-{data.stats.period.from.slice(4,6)}-{data.stats.period.from.slice(6,8)} ~ {data.stats.period.to.slice(0,4)}-{data.stats.period.to.slice(4,6)}-{data.stats.period.to.slice(6,8)} ·
            DART 대량보유공시(D001) 기준 · 5% 룰 적용 종목만 반영 (5% 미만 변동은 분기 후 공시)
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SIMULATION - AI 시그널 자가학습 시뮬레이션
// ════════════════════════════════════════════════════════════════════
// 동작:
//  1. AI 분석 결과를 시그널로 발행 → Firestore(또는 LocalStorage 폴백)에 저장
//  2. 일정 기간(horizon) 후 자동 채점 (서버 /api/sim/judge)
//  3. 누적 통계로 신호별 적중률 계산 → 가중치 산출
//  4. 다음 시그널 발행 시 가중치 적용으로 점수 산출
const FEATURE_LABELS = {
  base_support_ma20: "20일선 지지",
  base_support_ma60: "60일선 지지",
  volume_spike: "거래량 급증",
  long_lower_wick: "긴 밑꼬리",
  alignment_normal: "정배열 유지",
  alignment_reverse: "역배열 진입금지",
  ma20_breakout: "20일선 상향돌파",
  ma60_breakout: "60일선 상향돌파",
  ma120_breakout: "120일선 상향돌파",
  index_drop_bullish: "지수 하락 중 양봉",
  confluence_3plus: "컨플루언스 3개+",
  pullback_action: "눌림목 지지 액션",
  role_reversal: "역할 전환(저항→지지)",
  stoch_gold: "스토캐스틱 골드",
  adx_pdi: "ADX PDI>NDI",
  bollinger_lower: "볼린저 하단 반등",
  n_wave: "N자 파동",
  double_bottom: "쌍바닥",
  ma240_support: "240일선 지지",
  // 고고저 기법 (빗각 추세선)
  gj_trendline_break: "고고저 빗각 상향돌파",
  gj_wedge_bottom: "하락쐐기형 바닥 다지기",
  gj_trendline_3touch: "빗각 3회+ 터치(강한 추세선)",
  gj_retest_entry: "빗각 되돌림 후 지지(역할 전환)",
  gj_uptrend_break: "상승추세선 이탈(매도)",
};

const SIM_STORAGE_KEY = "alpha-sim-signals-v1";

// ── LocalStorage 폴백 (Firebase 비활성일 때만 사용) ─────────────
function lsLoadSignals(){
  try{
    if(typeof window==="undefined") return [];
    const raw = window.localStorage.getItem(SIM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch{ return []; }
}
function lsSaveSignals(signals){
  try{
    if(typeof window==="undefined") return;
    window.localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(signals));
  }catch{}
}

// ── 하이브리드 어댑터 (Firebase 우선, 없으면 LocalStorage) ──────
async function loadSignalsFor(uid){
  if(FIREBASE_ENABLED && uid){
    return await fbLoadSignals(uid);
  }
  return lsLoadSignals();
}

async function saveSignalsFor(uid, signals){
  if(FIREBASE_ENABLED && uid){
    return await fbSaveSignalsBatch(uid, signals);
  }
  lsSaveSignals(signals);
  return true;
}

async function clearSignalsFor(uid){
  if(FIREBASE_ENABLED && uid){
    return await fbDeleteAllSignals(uid);
  }
  try{
    if(typeof window!=="undefined") window.localStorage.removeItem(SIM_STORAGE_KEY);
  }catch{}
  return true;
}

function Simulation(){
  const [signals,setSignals]=useState([]);
  const [stats,setStats]=useState(null);
  const [weights,setWeights]=useState({});
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState("");
  const [tab,setTab]=useState("overview"); // overview | new | history
  const [uid,setUid]=useState(null);
  const [syncStatus,setSyncStatus]=useState(FIREBASE_ENABLED ? "connecting" : "local"); // connecting | synced | syncing | error | local
  const [hydrated,setHydrated]=useState(false); // 최초 로드 완료 플래그 (이전에는 saveSignals 무한 루프 방지)

  // 1) 인증 + 초기 로드
  useEffect(()=>{
    let mounted = true;
    (async()=>{
      try{
        let currentUid = null;
        if(FIREBASE_ENABLED){
          currentUid = await ensureAuth();
          if(!mounted) return;
          setUid(currentUid);
        }
        const loaded = await loadSignalsFor(currentUid);
        if(!mounted) return;
        setSignals(loaded);
        setSyncStatus(FIREBASE_ENABLED ? "synced" : "local");
        setHydrated(true);
      }catch(e){
        if(!mounted) return;
        console.error("[sim] 초기 로드 실패:", e);
        setSyncStatus("error");
        setMsg(`⚠ 동기화 실패: ${e.message} (LocalStorage 폴백)`);
        // 폴백
        setSignals(lsLoadSignals());
        setHydrated(true);
      }
    })();
    return ()=>{ mounted = false; };
  },[]);

  // 2) signals가 바뀔 때마다 통계 재계산 + 저장
  useEffect(()=>{
    if(!hydrated) return; // 최초 로드 전엔 저장 안 함 (빈 배열 덮어쓰기 방지)
    if(signals.length===0){ setStats(null); setWeights({}); return; }
    // 통계 계산
    (async()=>{
      try{
        const res = await fetch(`${API_BASE}/api/sim/stats`,{
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({signals})
        });
        const j = await res.json();
        if(res.ok){ setStats(j.stats); setWeights(j.weights||{}); }
      }catch(e){ /* 서버 다운 시 무시 */ }
    })();
    // Firestore/LocalStorage 저장
    (async()=>{
      if(FIREBASE_ENABLED && uid){
        setSyncStatus("syncing");
        const ok = await saveSignalsFor(uid, signals);
        setSyncStatus(ok ? "synced" : "error");
      }else{
        lsSaveSignals(signals);
      }
    })();
  },[signals,hydrated,uid]);

  // 채점 실행 (서버 호출)
  const judge = async()=>{
    setLoading(true); setMsg("");
    try{
      const res = await fetch(`${API_BASE}/api/sim/judge`,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({signals})
      });
      const j = await res.json();
      if(!res.ok) throw new Error(j.error||"채점 실패");
      setSignals(j.signals);
      setMsg(`✓ ${j.judgedCount}건 채점 완료 (대기 ${j.pendingCount}건)`);
    }catch(e){
      setMsg(`⚠ ${e.message}`);
    }
    setLoading(false);
  };

  // 데모 시그널 추가
  const addDemo = ()=>{
    const demos = [
      {code:"005930",name:"삼성전자",direction:"BUY",entryPrice:71500,targetPrice:75000,stopPrice:69500,horizon:5,
       reason:"20일선 지지 액션 + 거래량 2.3배",features:["base_support_ma20","volume_spike","long_lower_wick"],confluence:3,trend:"눌림목"},
      {code:"035720",name:"카카오",direction:"BUY",entryPrice:42000,targetPrice:45000,stopPrice:40500,horizon:10,
       reason:"60일선 종가 상향돌파 + 정배열 전환",features:["ma60_breakout","alignment_normal"],confluence:2,trend:"상승추세"},
      {code:"000660",name:"SK하이닉스",direction:"SELL",entryPrice:235000,targetPrice:225000,stopPrice:240000,horizon:5,
       reason:"60일선 이격 28% 과열 + 윗꼬리",features:["confluence_3plus"],confluence:1,trend:"상승추세"},
    ];
    const now = new Date().toISOString();
    const newSigs = demos.map((d,i)=>({
      ...d,
      id: `demo-${Date.now()}-${i}`,
      createdAt: now,
      status:"pending",
    }));
    setSignals(prev=>[...prev, ...newSigs]);
    setMsg(`✓ 데모 시그널 ${demos.length}건 추가 — 만기 후 [채점 실행] 클릭`);
  };

  const clearAll = async()=>{
    if(!window.confirm("모든 시뮬레이션 시그널을 삭제하시겠어요?")) return;
    setSignals([]);
    // Firestore도 비우기 (signals=[] 저장만으로는 기존 문서들이 안 지워지므로 명시적 삭제)
    if(FIREBASE_ENABLED && uid){
      setSyncStatus("syncing");
      const ok = await clearSignalsFor(uid);
      setSyncStatus(ok ? "synced" : "error");
    }else{
      clearSignalsFor(null);
    }
    setMsg("✓ 전체 초기화 완료");
  };

  const overall = stats?.overall;

  // 동기화 상태 뱃지
  const syncBadge = (()=>{
    if(syncStatus==="local") return {label:"LocalStorage", color:C.yellow, dot:C.yellow};
    if(syncStatus==="connecting") return {label:"Firebase 연결 중...", color:C.textDim, dot:C.textDim};
    if(syncStatus==="syncing") return {label:"동기화 중...", color:C.accent, dot:C.accent};
    if(syncStatus==="synced") return {label:`Firebase 동기화 (${uid?uid.slice(0,6):""}...)`, color:C.green, dot:C.green};
    return {label:"오프라인 (폴백)", color:C.red, dot:C.red};
  })();

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* 상단 헤더 */}
      <div className="panel">
        <div className="panel-title">
          <div className="dot-live" style={{background:C.purple}}/>
          AI 시뮬레이션 - 자가학습 시그널 시스템
          <span className="tag" style={{marginLeft:8,fontSize:9,background:`${syncBadge.color}20`,color:syncBadge.color,borderColor:syncBadge.color,display:"inline-flex",alignItems:"center",gap:4}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:syncBadge.dot,display:"inline-block"}}/>
            {syncBadge.label}
          </span>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button className="btn btn-primary" onClick={judge} disabled={loading||signals.length===0} style={{padding:"6px 14px",fontSize:11}}>
            {loading?"채점 중...":"▶ 채점 실행"}
          </button>
          <button className="btn" onClick={addDemo} style={{padding:"6px 14px",fontSize:11}}>
            + 데모 시그널 추가
          </button>
          <button className="btn" onClick={clearAll} disabled={signals.length===0} style={{padding:"6px 14px",fontSize:11,color:C.red}}>
            ⌫ 전체 초기화
          </button>
          {msg && <span style={{fontSize:11,color:msg.startsWith("⚠")?C.red:C.green,marginLeft:8}}>{msg}</span>}
        </div>
      </div>

      {/* 메인 통계 카드 */}
      {overall && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
          <StatCard label="총 시그널" value={overall.total} color={C.text}/>
          <StatCard label="채점 완료" value={overall.resolved} color={C.accent}/>
          <StatCard label="대기 중" value={overall.pending} color={C.yellow}/>
          <StatCard label="적중률" value={overall.hitRate!=null?`${overall.hitRate}%`:"-"}
            color={overall.hitRate>=60?C.green:overall.hitRate>=40?C.yellow:C.red}/>
          <StatCard label="평균 손익" value={overall.avgPnl!=null?`${overall.avgPnl>=0?"+":""}${overall.avgPnl}%`:"-"}
            color={overall.avgPnl>=0?C.green:C.red}/>
          <StatCard label="HIT / MISS" value={`${overall.hit||0} / ${overall.miss||0}`} color={C.text}/>
        </div>
      )}

      {/* 탭 */}
      <div className="panel" style={{padding:0}}>
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
          {[{k:"overview",l:"📊 신호별 적중률"},{k:"new",l:"✚ 새 시그널 발행"},{k:"history",l:"📜 시그널 이력"}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              style={{flex:1,padding:"10px 16px",background:tab===t.k?C.bg2:"transparent",
                color:tab===t.k?C.accent:C.textDim,border:"none",borderBottom:tab===t.k?`2px solid ${C.accent}`:"none",
                cursor:"pointer",fontSize:11,fontFamily:"'Orbitron',monospace",letterSpacing:2}}>
              {t.l}
            </button>
          ))}
        </div>

        <div style={{padding:16}}>
          {tab==="overview" && (
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {!stats || stats.byFeature.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:C.textMuted,fontSize:12}}>
                  채점된 시그널이 없습니다.<br/>
                  <span style={{color:C.textDim,fontSize:10}}>[데모 시그널 추가] 후 만기 도래하면 [채점 실행] 클릭</span>
                </div>
              ) : (
                <>
                  <div>
                    <div style={{fontSize:10,color:C.textMuted,marginBottom:8,letterSpacing:2,fontFamily:"'Orbitron',monospace"}}>
                      신호별 적중률 (가중치 학습용)
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {stats.byFeature.map(f=>{
                        const w = weights[f.key];
                        const color = f.hitRate>=60?C.green:f.hitRate>=40?C.yellow:C.red;
                        return(
                          <div key={f.key} style={{display:"grid",gridTemplateColumns:"1fr 60px 80px 80px",gap:8,padding:"8px 10px",background:`${C.bg2}40`,borderRadius:4,alignItems:"center"}}>
                            <span style={{fontSize:11,color:C.text}}>{FEATURE_LABELS[f.key]||f.key}</span>
                            <span className="mono" style={{fontSize:11,color,textAlign:"right"}}>{f.hitRate}%</span>
                            <span className="mono" style={{fontSize:10,color:C.textDim,textAlign:"right"}}>{f.hit}/{f.total}건</span>
                            <span className="mono" style={{fontSize:11,color:w>=1.1?C.green:w<=0.9?C.red:C.textDim,textAlign:"right",fontWeight:600}}>
                              ×{w?.toFixed(2)||"1.00"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {stats.byConfluence.length>0 && (
                    <div>
                      <div style={{fontSize:10,color:C.textMuted,marginBottom:8,letterSpacing:2,fontFamily:"'Orbitron',monospace"}}>
                        컨플루언스 개수별 적중률
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {stats.byConfluence.map(c=>(
                          <div key={c.key} style={{flex:1,padding:"10px",background:C.bg2,borderRadius:4,textAlign:"center"}}>
                            <div style={{fontSize:10,color:C.textDim}}>{c.key}</div>
                            <div style={{fontSize:18,fontWeight:700,color:c.hitRate>=60?C.green:C.text,fontFamily:"'Orbitron',monospace"}}>{c.hitRate}%</div>
                            <div style={{fontSize:9,color:C.textMuted}}>{c.hit}/{c.total}건</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {stats.byTrend.length>0 && (
                    <div>
                      <div style={{fontSize:10,color:C.textMuted,marginBottom:8,letterSpacing:2,fontFamily:"'Orbitron',monospace"}}>
                        추세별 적중률
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {stats.byTrend.map(t=>(
                          <div key={t.key} style={{flex:1,padding:"10px",background:C.bg2,borderRadius:4,textAlign:"center"}}>
                            <div style={{fontSize:10,color:C.textDim}}>{t.key}</div>
                            <div style={{fontSize:16,fontWeight:700,color:t.hitRate>=60?C.green:C.text,fontFamily:"'Orbitron',monospace"}}>{t.hitRate}%</div>
                            <div style={{fontSize:9,color:C.textMuted}}>{t.avgPnl>=0?"+":""}{t.avgPnl}%</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab==="new" && <NewSignalForm signals={signals} setSignals={setSignals} weights={weights} setMsg={setMsg}/>}

          {tab==="history" && (
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {signals.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:C.textMuted,fontSize:12}}>발행된 시그널이 없습니다.</div>
              ) : (
                [...signals].reverse().map(s=>{
                  const statusColor = s.status==="hit"?C.green : s.status==="miss"?C.red : s.status==="breakeven"?C.yellow : C.textMuted;
                  const statusLabel = s.status==="hit"?"HIT" : s.status==="miss"?"MISS" : s.status==="breakeven"?"EVEN" : "PENDING";
                  return(
                    <div key={s.id} style={{display:"grid",gridTemplateColumns:"70px 50px 1fr 80px 80px 70px",gap:8,padding:"8px 10px",background:`${C.bg2}40`,borderRadius:4,alignItems:"center",fontSize:11}}>
                      <span style={{color:statusColor,fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:10}}>{statusLabel}</span>
                      <span className="tag" style={{fontSize:9,background:s.direction==="BUY"?`${C.green}20`:`${C.red}20`,color:s.direction==="BUY"?C.green:C.red,borderColor:"transparent"}}>{s.direction}</span>
                      <div style={{minWidth:0}}>
                        <div style={{color:C.text,fontWeight:500}}>{s.name} <span style={{color:C.textMuted,fontSize:9}}>({s.code})</span></div>
                        <div style={{color:C.textDim,fontSize:9,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.reason}</div>
                      </div>
                      <span className="mono" style={{color:C.textDim,fontSize:10}}>{s.createdAt?.slice(5,10)}</span>
                      <span className="mono" style={{color:C.text,fontSize:10}}>{s.entryPrice?.toLocaleString()}</span>
                      <span className="mono" style={{color:s.pnlPct>=0?C.green:s.pnlPct<0?C.red:C.textDim,fontWeight:600,textAlign:"right"}}>
                        {s.pnlPct!=null?`${s.pnlPct>=0?"+":""}${s.pnlPct}%`:"-"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{fontSize:10,color:C.textMuted,padding:"4px 8px",lineHeight:1.5}}>
        💡 {FIREBASE_ENABLED
          ? "Firebase Firestore에 동기화됩니다. 같은 브라우저·기기에서 다시 접속하면 시그널이 자동 복원되며, 디바이스를 바꿔도 익명 ID가 유지되는 한 동기화됩니다."
          : "Firebase 설정이 없어 LocalStorage에 저장됩니다. 다른 기기에서는 보이지 않으며 브라우저 데이터 삭제 시 초기화됩니다. (firebase-config.js + .env 추가하면 클라우드 동기화)"}
        <br/>실제 매매가 발생하지 않는 페이퍼 트레이딩입니다.
      </div>
    </div>
  );
}

function StatCard({label,value,color}){
  return(
    <div style={{background:C.bg1,border:`1px solid ${C.border}`,borderRadius:4,padding:"12px 14px"}}>
      <div style={{fontSize:9,color:C.textMuted,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color,fontFamily:"'Orbitron',monospace"}}>{value}</div>
    </div>
  );
}

function NewSignalForm({signals,setSignals,weights,setMsg}){
  const [code,setCode]=useState("005930");
  const [name,setName]=useState("삼성전자");
  const [direction,setDirection]=useState("BUY");
  const [entryPrice,setEntryPrice]=useState("71500");
  const [targetPrice,setTargetPrice]=useState("");
  const [stopPrice,setStopPrice]=useState("");
  const [horizon,setHorizon]=useState(5);
  const [reason,setReason]=useState("");
  const [picked,setPicked]=useState([]);
  const [trend,setTrend]=useState("눌림목");

  const toggle = (f)=> setPicked(p=> p.includes(f)?p.filter(x=>x!==f):[...p,f]);

  const score = picked.reduce((s,f)=> s + (weights[f]!=null?weights[f]:1.0), 0);
  const confidence = picked.length>=3 ? "high" : picked.length>=2 ? "mid" : "low";

  const submit = ()=>{
    const ep = parseInt(entryPrice);
    if(!code || !name || !ep){ setMsg("⚠ 종목코드/이름/매수가는 필수"); return; }
    const sig = {
      id: `sig-${Date.now()}`,
      createdAt: new Date().toISOString(),
      code, name, direction,
      entryPrice: ep,
      targetPrice: targetPrice?parseInt(targetPrice):null,
      stopPrice: stopPrice?parseInt(stopPrice):null,
      horizon: parseInt(horizon),
      reason: reason || picked.map(f=>FEATURE_LABELS[f]||f).join(" + "),
      features: picked,
      confluence: picked.length,
      trend,
      status:"pending",
    };
    setSignals(prev=>[...prev, sig]);
    setPicked([]); setReason("");
    setMsg(`✓ 시그널 발행: ${name} ${direction} @ ${ep.toLocaleString()}원 (가중점수 ${Math.round(score*100)/100})`);
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr 1fr",gap:8}}>
        <FormInput label="종목코드" value={code} onChange={setCode} placeholder="005930"/>
        <FormInput label="종목명" value={name} onChange={setName} placeholder="삼성전자"/>
        <FormSelect label="방향" value={direction} onChange={setDirection} options={[{v:"BUY",l:"BUY ↑"},{v:"SELL",l:"SELL ↓"}]}/>
        <FormSelect label="만기" value={horizon} onChange={v=>setHorizon(parseInt(v))} options={[{v:5,l:"5일"},{v:10,l:"10일"},{v:20,l:"20일"}]}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
        <FormInput label="진입가" value={entryPrice} onChange={setEntryPrice} placeholder="71500"/>
        <FormInput label="목표가 (옵션)" value={targetPrice} onChange={setTargetPrice} placeholder="75000"/>
        <FormInput label="손절가 (옵션)" value={stopPrice} onChange={setStopPrice} placeholder="69500"/>
        <FormSelect label="추세 상태" value={trend} onChange={setTrend}
          options={[{v:"상승추세",l:"상승추세"},{v:"눌림목",l:"눌림목"},{v:"하락추세",l:"하락추세"},{v:"횡보",l:"횡보"}]}/>
      </div>
      <FormInput label="이유 (메모)" value={reason} onChange={setReason} placeholder="20일선 지지 액션 + 거래량 2.3배"/>

      <div>
        <div style={{fontSize:10,color:C.textMuted,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:6}}>
          신호 태그 선택 (선택할수록 가중점수↑)
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {Object.entries(FEATURE_LABELS).map(([k,l])=>{
            const w = weights[k];
            const isPicked = picked.includes(k);
            const wColor = w>=1.1?C.green:w<=0.9?C.red:C.textDim;
            return(
              <button key={k} onClick={()=>toggle(k)}
                style={{padding:"4px 8px",borderRadius:3,fontSize:10,cursor:"pointer",
                  background:isPicked?`${C.accent}20`:C.bg2,
                  border:`1px solid ${isPicked?C.accent:C.border}`,
                  color:isPicked?C.accent:C.textDim,
                  display:"flex",alignItems:"center",gap:4}}>
                {l}
                {w!=null && <span style={{color:wColor,fontFamily:"'Orbitron',monospace",fontSize:9}}>×{w.toFixed(2)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {picked.length>0 && (
        <div style={{background:C.bg2,padding:"10px 14px",borderRadius:4,display:"flex",alignItems:"center",gap:16}}>
          <span style={{fontSize:10,color:C.textMuted,letterSpacing:1}}>가중 점수</span>
          <span style={{fontSize:20,fontWeight:700,color:score>=picked.length?C.green:C.yellow,fontFamily:"'Orbitron',monospace"}}>
            {Math.round(score*100)/100}
          </span>
          <span style={{fontSize:10,color:C.textDim}}>
            (기본 {picked.length}점 + 가중치 ×{Math.round((score/picked.length)*100)/100})
          </span>
          <span className="tag" style={{marginLeft:"auto",fontSize:9,
            background:confidence==="high"?`${C.green}20`:confidence==="mid"?`${C.yellow}20`:`${C.red}20`,
            color:confidence==="high"?C.green:confidence==="mid"?C.yellow:C.red,
            borderColor:"transparent"}}>
            신뢰도 {confidence.toUpperCase()}
          </span>
        </div>
      )}

      <button className="btn btn-primary" onClick={submit} style={{padding:"10px",fontSize:12}}>
        ▶ 시그널 발행 (LocalStorage 저장)
      </button>
    </div>
  );
}

function FormInput({label,value,onChange,placeholder}){
  return(
    <div>
      <div style={{fontSize:9,color:C.textMuted,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:4}}>{label}</div>
      <input type="text" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",padding:"8px 10px",background:C.bg2,border:`1px solid ${C.border}`,color:C.text,
          fontSize:11,borderRadius:3,fontFamily:"'Share Tech Mono',monospace",outline:"none"}}/>
    </div>
  );
}

function FormSelect({label,value,onChange,options}){
  return(
    <div>
      <div style={{fontSize:9,color:C.textMuted,letterSpacing:2,fontFamily:"'Orbitron',monospace",marginBottom:4}}>{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{width:"100%",padding:"8px 10px",background:C.bg2,border:`1px solid ${C.border}`,color:C.text,
          fontSize:11,borderRadius:3,outline:"none"}}>
        {options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════
const PAGES=[
  {id:"dashboard",label:"대시보드",icon:"◈"},
  {id:"chartanalysis",label:"차트 분석",icon:"◇",badge:null},
  {id:"screener",label:"스크리너",icon:"⊞"},
  {id:"portfolio",label:"포트폴리오",icon:"◉"},
  {id:"alerts",label:"알림 센터",icon:"◆",badge:3},
  {id:"reports",label:"AI 리포트",icon:"◍"},
  {id:"nps",label:"국민연금",icon:"₩"},
  {id:"simulation",label:"AI 시뮬레이션",icon:"⚛",badge:"NEW"},
];
export default function App(){
  const [page,setPage]=useState("dashboard");
  const [time,setTime]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  const fmt=d=>d.toTimeString().slice(0,8);
  const currentPage = PAGES.find(p=>p.id===page);

  return(
    <>
      <style>{css}</style>
      <div className="scanline"/>
      <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.bg0}} className="grid-bg">

        {/* 브랜드 스트립 (얇은 상단 바) */}
        <div className="brand-strip">
          <div className="brand-l">
            <div style={{fontFamily:"'Orbitron',monospace",fontSize:14,fontWeight:900,color:C.accent,letterSpacing:3}}>ALPHA</div>
            <div style={{height:14,width:1,background:C.border}}/>
            <div className="mono" style={{fontSize:10,color:C.green,display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:C.green,boxShadow:`0 0 8px ${C.green}`,animation:"pulse 2s infinite"}}/>
              LIVE {fmt(time)}
            </div>
          </div>
          <div className="brand-r">
            {/* 데스크탑에서만 보이는 분석방법 뱃지 + 시장 상태 */}
            <div style={{display:"flex",alignItems:"center",gap:6}} className="hide-mobile">
              <span className="tag tag-purple" style={{fontSize:9}}>스펙터</span>
              <span className="tag tag-accent" style={{fontSize:9}}>독개미</span>
              <span className="tag tag-yellow" style={{fontSize:9}}>경제명탐정</span>
              <span className="tag tag-red" style={{fontSize:9}}>고고저</span>
              <div style={{height:14,width:1,background:C.border,margin:"0 4px"}}/>
              <span className="mono" style={{fontSize:10,color:C.green}}>KRX OPEN</span>
              <span className="mono" style={{fontSize:10,color:C.red}}>NYSE CLOSED</span>
            </div>
            <span className="mono" style={{fontSize:10,color:C.textMuted,marginLeft:4}}>{time.toLocaleDateString("ko-KR")}</span>
          </div>
        </div>

        {/* 알약 탭 (가로 스크롤) */}
        <div className="pill-tabs">
          {PAGES.map(p=>(
            <button key={p.id} className={`pill-tab ${page===p.id?"active":""}`} onClick={()=>setPage(p.id)}>
              <span className="pill-icon">{p.icon}</span>
              <span>{p.label}</span>
              {p.badge && <span className="pill-badge">{p.badge}</span>}
            </button>
          ))}
        </div>

        {/* 티커 바 */}
        <div style={{height:32,background:C.bg1,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",overflow:"hidden",flexShrink:0}}>
          <div style={{width:46,flexShrink:0,paddingLeft:10,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center"}}>
            <span style={{fontSize:9,color:C.textMuted,fontFamily:"'Orbitron',monospace",letterSpacing:2}}>TICK</span>
          </div>
          <div style={{flex:1,overflow:"hidden"}}>
            <div className="ticker-bar">
              {[...TICKERS,...TICKERS].map((t,i)=>(
                <div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"0 16px",borderRight:`1px solid ${C.border}`,height:32}}>
                  <span style={{fontSize:11,color:C.textDim,fontWeight:600}}>{t.s}</span>
                  <span className="mono" style={{fontSize:11,color:C.text}}>{t.p}</span>
                  <span className="mono" style={{fontSize:10,color:t.up?C.green:C.red}}>{t.ch}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 현재 페이지 라벨 (얇은 줄) */}
        <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10,background:C.bg1,flexShrink:0}}>
          <span style={{fontFamily:"'Orbitron',monospace",fontSize:11,color:C.accent,letterSpacing:3}}>
            {currentPage?.icon} {currentPage?.label.toUpperCase()}
          </span>
          <div style={{height:1,flex:1,background:`linear-gradient(90deg,${C.border},transparent)`}}/>
        </div>

        {/* 본문 (스크롤 영역) */}
        <div style={{flex:1,overflowY:"auto",padding:12}}>
          {page==="dashboard"&&<Dashboard/>}
          {page==="chartanalysis"&&<ChartAnalysis/>}
          {page==="screener"&&<Screener/>}
          {page==="portfolio"&&<Portfolio/>}
          {page==="alerts"&&<AlertCenter/>}
          {page==="reports"&&<ReportView/>}
          {page==="nps"&&<NpsTracker/>}
          {page==="simulation"&&<Simulation/>}
        </div>
      </div>
    </>
  );
}
