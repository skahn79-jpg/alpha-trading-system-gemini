import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * ALPHA TRADING SYSTEM — 통합 확장 버전
 * Creator: ASK
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

const API_BASE = import.meta.env.VITE_API_URL || "https://alpha-trading-server.onrender.com";
const APP_API_KEY = import.meta.env.VITE_APP_API_KEY || "";

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
  { code: "004000", name: "롯데정밀화학", tag: "화학/소재", sector: "화학" },
  { code: "170900", name: "동아에스티", tag: "제약/바이오", sector: "바이오" },
  { code: "045660", name: "에이텍", tag: "IT/금융단말", sector: "IT" },
  { code: "224110", name: "에이텍모빌리티", tag: "교통카드/모빌리티", sector: "IT" },
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

  // ── KOSDAQ 검색 보강 리스트 ─────────────────────────────
  // 일부 KOSDAQ 종목은 KIS 검색 API/프론트 기본 목록에 없으면 종목명 검색이 되지 않아
  // 대표 KOSDAQ 종목을 로컬 카탈로그에 추가합니다.
  { code: "028300", name: "HLB", tag: "바이오", sector: "바이오" },
  { code: "145020", name: "휴젤", tag: "바이오", sector: "바이오" },
  { code: "214150", name: "클래시스", tag: "미용의료기기", sector: "의료기기" },
  { code: "214450", name: "파마리서치", tag: "바이오/미용", sector: "바이오" },
  { code: "058470", name: "리노공업", tag: "반도체", sector: "반도체" },
  { code: "039030", name: "이오테크닉스", tag: "반도체장비", sector: "반도체" },
  { code: "036930", name: "주성엔지니어링", tag: "반도체장비", sector: "반도체" },
  { code: "240810", name: "원익IPS", tag: "반도체장비", sector: "반도체" },
  { code: "064760", name: "티씨케이", tag: "반도체소재", sector: "반도체" },
  { code: "095340", name: "ISC", tag: "반도체부품", sector: "반도체" },
  { code: "089030", name: "테크윙", tag: "반도체장비", sector: "반도체" },
  { code: "067310", name: "하나마이크론", tag: "반도체후공정", sector: "반도체" },
  { code: "222800", name: "심텍", tag: "PCB", sector: "전자부품" },
  { code: "101490", name: "에스앤에스텍", tag: "반도체소재", sector: "반도체" },
  { code: "319660", name: "피에스케이", tag: "반도체장비", sector: "반도체" },
  { code: "036540", name: "SFA반도체", tag: "반도체후공정", sector: "반도체" },
  { code: "005290", name: "동진쎄미켐", tag: "반도체소재", sector: "반도체" },
  { code: "046890", name: "서울반도체", tag: "LED", sector: "전자부품" },
  { code: "078600", name: "대주전자재료", tag: "2차전지소재", sector: "2차전지" },
  { code: "121600", name: "나노신소재", tag: "2차전지소재", sector: "2차전지" },
  { code: "348370", name: "엔켐", tag: "2차전지소재", sector: "2차전지" },
  { code: "025900", name: "동화기업", tag: "2차전지/소재", sector: "소재" },
  { code: "131970", name: "두산테스나", tag: "반도체테스트", sector: "반도체" },
  { code: "277810", name: "레인보우로보틱스", tag: "로봇", sector: "로봇" },
  { code: "108490", name: "로보티즈", tag: "로봇", sector: "로봇" },
  { code: "090360", name: "로보스타", tag: "로봇", sector: "로봇" },
  { code: "042000", name: "카페24", tag: "이커머스", sector: "인터넷" },
  { code: "067160", name: "SOOP", tag: "플랫폼", sector: "인터넷" },
  { code: "035760", name: "CJ ENM", tag: "미디어", sector: "미디어" },
  { code: "060250", name: "NHN KCP", tag: "결제", sector: "핀테크" },
  { code: "293490", name: "카카오게임즈", tag: "게임", sector: "게임" },
  { code: "122870", name: "와이지엔터테인먼트", tag: "엔터", sector: "엔터" },
  { code: "376300", name: "디어유", tag: "엔터플랫폼", sector: "엔터" },
  { code: "053800", name: "안랩", tag: "보안", sector: "소프트웨어" },
  { code: "096530", name: "씨젠", tag: "진단키트", sector: "바이오" },
  { code: "237690", name: "에스티팜", tag: "바이오", sector: "바이오" },
  { code: "068760", name: "셀트리온제약", tag: "바이오", sector: "바이오" },
  { code: "141080", name: "리가켐바이오", tag: "바이오", sector: "바이오" },
  { code: "000250", name: "삼천당제약", tag: "제약", sector: "바이오" },
  { code: "214370", name: "케어젠", tag: "바이오", sector: "바이오" },
  { code: "086900", name: "메디톡스", tag: "바이오", sector: "바이오" },
  { code: "048410", name: "현대바이오", tag: "바이오", sector: "바이오" },
  { code: "206650", name: "유바이오로직스", tag: "백신", sector: "바이오" },
  { code: "140410", name: "메지온", tag: "바이오", sector: "바이오" },
  { code: "095700", name: "제넥신", tag: "바이오", sector: "바이오" },
  { code: "085660", name: "차바이오텍", tag: "바이오", sector: "바이오" },
  { code: "084990", name: "헬릭스미스", tag: "바이오", sector: "바이오" },
  { code: "007390", name: "네이처셀", tag: "바이오", sector: "바이오" },
  { code: "215600", name: "신라젠", tag: "바이오", sector: "바이오" },
  { code: "323990", name: "박셀바이오", tag: "바이오", sector: "바이오" },
  { code: "144510", name: "지씨셀", tag: "바이오", sector: "바이오" },
  { code: "195940", name: "HK이노엔", tag: "제약", sector: "바이오" },
  { code: "052020", name: "에스티큐브", tag: "바이오", sector: "바이오" },
  { code: "215200", name: "메가스터디교육", tag: "교육", sector: "교육" },
  { code: "089980", name: "상아프론테크", tag: "소재", sector: "소재" },
];

const KOREAN_STOCK_SEARCH_EXPANSION = [
  { code: "003550", name: "LG", tag: "지주", sector: "지주" },
  { code: "003555", name: "LG우", tag: "지주/우선주", sector: "지주" },

  { code: "090430", name: "아모레퍼시픽", tag: "화장품", sector: "소비재" },
  { code: "002790", name: "아모레G", tag: "화장품/지주", sector: "소비재" },
  { code: "051900", name: "LG생활건강", tag: "화장품/생활소비재", sector: "소비재" },
  { code: "004370", name: "농심", tag: "식품", sector: "음식료" },
  { code: "271560", name: "오리온", tag: "식품", sector: "음식료" },
  { code: "097950", name: "CJ제일제당", tag: "식품/바이오", sector: "음식료" },
  { code: "003230", name: "삼양식품", tag: "식품", sector: "음식료" },
  { code: "000080", name: "하이트진로", tag: "주류", sector: "음식료" },
  { code: "007070", name: "GS리테일", tag: "유통", sector: "유통" },
  { code: "023530", name: "롯데쇼핑", tag: "유통", sector: "유통" },
  { code: "008770", name: "호텔신라", tag: "면세/관광", sector: "소비재" },
  { code: "139480", name: "이마트", tag: "유통", sector: "유통" },
  { code: "036460", name: "한국가스공사", tag: "가스/에너지", sector: "유틸리티" },
  { code: "034220", name: "LG디스플레이", tag: "디스플레이", sector: "전기전자" },
  { code: "010950", name: "S-Oil", tag: "정유", sector: "에너지" },
  { code: "078930", name: "GS", tag: "지주/에너지", sector: "지주" },
  { code: "010060", name: "OCI홀딩스", tag: "소재/화학", sector: "화학" },
  { code: "010780", name: "아이에스동서", tag: "건설/환경", sector: "건설" },
  { code: "006360", name: "GS건설", tag: "건설", sector: "건설" },
  { code: "000720", name: "현대건설", tag: "건설", sector: "건설" },
  { code: "047040", name: "대우건설", tag: "건설", sector: "건설" },
  { code: "028050", name: "삼성E&A", tag: "플랜트/엔지니어링", sector: "건설" },
  { code: "064960", name: "SNT모티브", tag: "자동차부품", sector: "자동차" },
  { code: "204320", name: "HL만도", tag: "자동차부품", sector: "자동차" },
  { code: "018880", name: "한온시스템", tag: "자동차부품", sector: "자동차" },
  { code: "161390", name: "한국타이어앤테크놀로지", tag: "타이어", sector: "자동차" },
  { code: "003620", name: "KG모빌리티", tag: "자동차", sector: "자동차" },
  { code: "005830", name: "DB손해보험", tag: "보험", sector: "금융" },
  { code: "000100", name: "유한양행", tag: "제약", sector: "바이오" },
  { code: "128940", name: "한미약품", tag: "제약", sector: "바이오" },
  { code: "185750", name: "종근당", tag: "제약", sector: "바이오" },
  { code: "069620", name: "대웅제약", tag: "제약", sector: "바이오" },
  { code: "001430", name: "세아베스틸지주", tag: "철강", sector: "철강" },
  { code: "004020", name: "현대제철", tag: "철강", sector: "철강" },
  { code: "047050", name: "포스코인터내셔널", tag: "상사/에너지", sector: "상사" },
  { code: "001120", name: "LX인터내셔널", tag: "상사", sector: "상사" },
  { code: "120110", name: "코오롱인더", tag: "화학/소재", sector: "화학" },
  { code: "011780", name: "금호석유", tag: "화학", sector: "화학" },
  { code: "298020", name: "효성티앤씨", tag: "화학/섬유", sector: "화학" },
  { code: "298050", name: "효성첨단소재", tag: "소재/탄소섬유", sector: "화학" },
  { code: "011790", name: "SKC", tag: "소재/2차전지", sector: "화학" },
  { code: "000120", name: "CJ대한통운", tag: "물류", sector: "운송" },
  { code: "086280", name: "현대글로비스", tag: "물류/자동차", sector: "운송" },
  { code: "003490", name: "대한항공", tag: "항공", sector: "운송" },
  { code: "020560", name: "아시아나항공", tag: "항공", sector: "운송" },
  { code: "180640", name: "한진칼", tag: "항공/지주", sector: "지주" },
  { code: "001740", name: "SK네트웍스", tag: "상사/렌탈", sector: "상사" },
  { code: "112610", name: "씨에스윈드", tag: "풍력", sector: "에너지" },
  { code: "336260", name: "두산퓨얼셀", tag: "수소/연료전지", sector: "에너지" },
  { code: "042660", name: "한화오션", tag: "조선", sector: "조선" },
  { code: "267250", name: "HD현대", tag: "지주/조선", sector: "지주" },
  { code: "272210", name: "한화시스템", tag: "방산/ICT", sector: "방산" },
  { code: "079550", name: "LIG넥스원", tag: "방산", sector: "방산" },
  { code: "000150", name: "두산", tag: "지주/로봇", sector: "지주" },
  { code: "241560", name: "두산밥캣", tag: "기계", sector: "기계" },
  { code: "034020", name: "두산에너빌리티", tag: "원전/에너지", sector: "에너지" },
  { code: "071050", name: "한국금융지주", tag: "증권", sector: "금융" },
  { code: "039490", name: "키움증권", tag: "증권", sector: "금융" },
  { code: "006800", name: "미래에셋증권", tag: "증권", sector: "금융" },
  { code: "016360", name: "삼성증권", tag: "증권", sector: "금융" },
  { code: "006260", name: "LS", tag: "전력/전선", sector: "전력기기" },
  { code: "001440", name: "대한전선", tag: "전선", sector: "전력기기" },
  { code: "010620", name: "HD현대미포", tag: "조선", sector: "조선" },
  { code: "017800", name: "현대엘리베이터", tag: "기계", sector: "기계" },
  { code: "000240", name: "한국앤컴퍼니", tag: "지주/타이어", sector: "자동차" },
  { code: "375500", name: "DL이앤씨", tag: "건설", sector: "건설" },
  { code: "001040", name: "CJ", tag: "지주", sector: "지주" },
  { code: "035250", name: "강원랜드", tag: "카지노/레저", sector: "소비재" },
  { code: "192820", name: "코스맥스", tag: "화장품ODM", sector: "소비재" },
  { code: "161890", name: "한국콜마", tag: "화장품ODM", sector: "소비재" },
];

function dedupeStockCatalog(rows = []) {
  const map = new Map();
  rows.forEach((s) => {
    const code = normalizeCode(s.code);
    if (!code) return;
    map.set(code, { ...s, code });
  });
  return Array.from(map.values());
}

const ALL_KOREAN_STOCK_CATALOG = dedupeStockCatalog([
  ...KOREAN_STOCK_CATALOG,
  ...KOREAN_STOCK_SEARCH_EXPANSION,
]);

function normalizeStockSearchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\(\s*주\s*\)|㈜|주식회사|주\)/gi, "")
    .replace(/보통주|우선주|증권|종목|코스피|유가증권|kospi|krx/gi, "")
    .replace(/[\s()\[\]{}·ㆍ\-_.,]/g, "")
    .trim();
}

function buildStockAliasList(stock) {
  const name = String(stock?.name || "");
  const compact = normalizeStockSearchText(name);
  const list = [name, compact];

  list.push(name.replace(/홀딩스/g, "홀딩스"));
  list.push(name.replace(/지주/g, ""));
  list.push(name.replace(/&/g, "앤"));
  list.push(name.replace(/앤/g, "&"));
  list.push(name.replace(/에스앤에스/g, "sns"));
  list.push(name.replace(/에이치디/g, "hd"));
  list.push(name.replace(/엘지/g, "lg"));
  list.push(name.replace(/에스케이/g, "sk"));

  if (compact === "lg") {
    list.push("lg", "(주)lg", "㈜lg", "주식회사lg", "엘지", "(주)엘지", "엘지지주", "lg지주");
  }
  if (compact === "lg우") {
    list.push("lg우", "(주)lg우", "엘지우");
  }

  return Array.from(new Set(list.filter(Boolean)));
}


const GLOBAL_TICKERS = [
  { symbol: "NVDA", name: "NVIDIA", type: "us", sector: "AI 반도체" },
  { symbol: "TSLA", name: "Tesla", type: "us", sector: "전기차" },
  { symbol: "AAPL", name: "Apple", type: "us", sector: "빅테크" },
  { symbol: "MSFT", name: "Microsoft", type: "us", sector: "빅테크" },
  { symbol: "GOOGL", name: "Alphabet", type: "us", sector: "빅테크" },
  { symbol: "META", name: "Meta Platforms", type: "us", sector: "빅테크" },
  { symbol: "AMZN", name: "Amazon", type: "us", sector: "이커머스/클라우드" },
  { symbol: "AMD", name: "AMD", type: "us", sector: "반도체" },
  { symbol: "AVGO", name: "Broadcom", type: "us", sector: "반도체" },
  { symbol: "BTC", name: "Bitcoin", type: "crypto", sector: "Crypto" },
  { symbol: "ETH", name: "Ethereum", type: "crypto", sector: "Crypto" },
  { symbol: "SOL", name: "Solana", type: "crypto", sector: "Crypto" },
  { symbol: "XRP", name: "XRP", type: "crypto", sector: "Crypto" },
];


const NASDAQ100_UNIVERSE = [
  { symbol: "AAPL", name: "Apple", sector: "빅테크/디바이스" },
  { symbol: "MSFT", name: "Microsoft", sector: "빅테크/클라우드" },
  { symbol: "NVDA", name: "NVIDIA", sector: "AI 반도체" },
  { symbol: "AMZN", name: "Amazon", sector: "이커머스/클라우드" },
  { symbol: "META", name: "Meta Platforms", sector: "소셜/AI" },
  { symbol: "GOOGL", name: "Alphabet A", sector: "검색/AI" },
  { symbol: "GOOG", name: "Alphabet C", sector: "검색/AI" },
  { symbol: "AVGO", name: "Broadcom", sector: "반도체" },
  { symbol: "TSLA", name: "Tesla", sector: "전기차" },
  { symbol: "COST", name: "Costco", sector: "유통" },
  { symbol: "NFLX", name: "Netflix", sector: "미디어" },
  { symbol: "AMD", name: "AMD", sector: "반도체" },
  { symbol: "PEP", name: "PepsiCo", sector: "필수소비재" },
  { symbol: "ADBE", name: "Adobe", sector: "소프트웨어" },
  { symbol: "CSCO", name: "Cisco", sector: "네트워크" },
  { symbol: "TMUS", name: "T-Mobile US", sector: "통신" },
  { symbol: "INTC", name: "Intel", sector: "반도체" },
  { symbol: "QCOM", name: "Qualcomm", sector: "반도체" },
  { symbol: "TXN", name: "Texas Instruments", sector: "반도체" },
  { symbol: "AMGN", name: "Amgen", sector: "바이오" },
  { symbol: "HON", name: "Honeywell", sector: "산업재" },
  { symbol: "INTU", name: "Intuit", sector: "소프트웨어" },
  { symbol: "AMAT", name: "Applied Materials", sector: "반도체장비" },
  { symbol: "ISRG", name: "Intuitive Surgical", sector: "의료기기" },
  { symbol: "BKNG", name: "Booking Holdings", sector: "여행/플랫폼" },
  { symbol: "VRTX", name: "Vertex", sector: "바이오" },
  { symbol: "LRCX", name: "Lam Research", sector: "반도체장비" },
  { symbol: "MU", name: "Micron", sector: "메모리" },
  { symbol: "ADI", name: "Analog Devices", sector: "반도체" },
  { symbol: "PANW", name: "Palo Alto Networks", sector: "사이버보안" },
  { symbol: "KLAC", name: "KLA", sector: "반도체장비" },
  { symbol: "SBUX", name: "Starbucks", sector: "소비재" },
  { symbol: "GILD", name: "Gilead Sciences", sector: "바이오" },
  { symbol: "ADP", name: "ADP", sector: "서비스" },
  { symbol: "MDLZ", name: "Mondelez", sector: "필수소비재" },
  { symbol: "MELI", name: "MercadoLibre", sector: "이커머스" },
  { symbol: "REGN", name: "Regeneron", sector: "바이오" },
  { symbol: "SNPS", name: "Synopsys", sector: "EDA/소프트웨어" },
  { symbol: "CDNS", name: "Cadence", sector: "EDA/소프트웨어" },
  { symbol: "PYPL", name: "PayPal", sector: "핀테크" },
  { symbol: "MAR", name: "Marriott", sector: "호텔" },
  { symbol: "CRWD", name: "CrowdStrike", sector: "사이버보안" },
  { symbol: "MRVL", name: "Marvell", sector: "반도체" },
  { symbol: "ABNB", name: "Airbnb", sector: "여행/플랫폼" },
  { symbol: "ORLY", name: "O'Reilly Auto", sector: "소비재" },
  { symbol: "CSX", name: "CSX", sector: "운송" },
  { symbol: "NXPI", name: "NXP", sector: "반도체" },
  { symbol: "ROP", name: "Roper", sector: "산업SW" },
  { symbol: "MNST", name: "Monster Beverage", sector: "필수소비재" },
  { symbol: "PCAR", name: "PACCAR", sector: "산업재" },
  { symbol: "WDAY", name: "Workday", sector: "소프트웨어" },
  { symbol: "CPRT", name: "Copart", sector: "서비스" },
  { symbol: "FTNT", name: "Fortinet", sector: "사이버보안" },
  { symbol: "KDP", name: "Keurig Dr Pepper", sector: "필수소비재" },
  { symbol: "ADSK", name: "Autodesk", sector: "소프트웨어" },
  { symbol: "CHTR", name: "Charter", sector: "통신" },
  { symbol: "ROST", name: "Ross Stores", sector: "유통" },
  { symbol: "PAYX", name: "Paychex", sector: "서비스" },
  { symbol: "LULU", name: "Lululemon", sector: "소비재" },
  { symbol: "CTAS", name: "Cintas", sector: "서비스" },
  { symbol: "MCHP", name: "Microchip", sector: "반도체" },
  { symbol: "AEP", name: "American Electric Power", sector: "유틸리티" },
  { symbol: "KHC", name: "Kraft Heinz", sector: "필수소비재" },
  { symbol: "IDXX", name: "IDEXX", sector: "헬스케어" },
  { symbol: "FAST", name: "Fastenal", sector: "산업재" },
  { symbol: "ODFL", name: "Old Dominion", sector: "운송" },
  { symbol: "GEHC", name: "GE HealthCare", sector: "헬스케어" },
  { symbol: "DDOG", name: "Datadog", sector: "소프트웨어" },
  { symbol: "EXC", name: "Exelon", sector: "유틸리티" },
  { symbol: "EA", name: "Electronic Arts", sector: "게임" },
  { symbol: "BKR", name: "Baker Hughes", sector: "에너지" },
  { symbol: "TEAM", name: "Atlassian", sector: "소프트웨어" },
  { symbol: "XEL", name: "Xcel Energy", sector: "유틸리티" },
  { symbol: "ZS", name: "Zscaler", sector: "사이버보안" },
  { symbol: "CCEP", name: "Coca-Cola Europacific", sector: "필수소비재" },
  { symbol: "TTWO", name: "Take-Two", sector: "게임" },
  { symbol: "CSGP", name: "CoStar", sector: "부동산/데이터" },
  { symbol: "FANG", name: "Diamondback Energy", sector: "에너지" },
  { symbol: "BIIB", name: "Biogen", sector: "바이오" },
  { symbol: "ON", name: "ON Semiconductor", sector: "반도체" },
  { symbol: "GFS", name: "GlobalFoundries", sector: "반도체" },
  { symbol: "ANSS", name: "ANSYS", sector: "소프트웨어" },
  { symbol: "CDW", name: "CDW", sector: "IT유통" },
  { symbol: "MRNA", name: "Moderna", sector: "바이오" },
  { symbol: "DXCM", name: "DexCom", sector: "의료기기" },
  { symbol: "MDB", name: "MongoDB", sector: "소프트웨어" },
  { symbol: "ILMN", name: "Illumina", sector: "바이오장비" },
  { symbol: "WBD", name: "Warner Bros Discovery", sector: "미디어" },
  { symbol: "SIRI", name: "Sirius XM", sector: "미디어" },
  { symbol: "ENPH", name: "Enphase Energy", sector: "신재생" },
  { symbol: "ZM", name: "Zoom", sector: "소프트웨어" },
  { symbol: "LCID", name: "Lucid", sector: "전기차" },
  { symbol: "RIVN", name: "Rivian", sector: "전기차" },
  { symbol: "ARM", name: "Arm Holdings", sector: "반도체 IP" },
  { symbol: "SMCI", name: "Super Micro Computer", sector: "AI 서버" },
  { symbol: "PLTR", name: "Palantir", sector: "AI 소프트웨어" },
  { symbol: "LIN", name: "Linde", sector: "소재" },
  { symbol: "ASML", name: "ASML", sector: "반도체장비" },
  { symbol: "AZN", name: "AstraZeneca", sector: "제약" },
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
  body{margin:0;background:#070b10;color:#d9ecf5;font-family:var(--paperlogy-font)}
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
  .ticker-item{min-width:150px;padding:8px 12px;border-right:1px solid #1e3445;font-size:12px;display:grid;grid-template-rows:auto auto auto;gap:3px;align-items:start}.ticker-item .ticker-line1{font-weight:900;color:#d9ecf5;white-space:normal;line-height:1.18}.ticker-item .ticker-line2{color:#6f899a;font-family:var(--paperlogy-font)}.ticker-item .ticker-line3{font-weight:900}
  .ticker-symbol{font-weight:900;color:#d9ecf5}.ticker-price{color:#6f899a;font-family:var(--paperlogy-font)}.up{color:#00ff88}.down{color:#ff4466}
  .main{padding:14px;display:grid;grid-template-columns:310px 1fr;gap:12px}
  .screen-shell{animation:screenIn .24s ease-out}
  @keyframes screenIn{from{opacity:.25;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  .screen-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;padding:12px;border:1px solid #1e3445;background:linear-gradient(90deg,#08141d,#0b1118)}
  .screen-title{font-size:15px;font-weight:900;color:#00d9ff;letter-spacing:1px}.screen-desc{font-size:12px;color:#6f899a;margin-top:4px;line-height:1.45}
  .panel{background:#0b1118;border:1px solid #1e3445}.panel-title{padding:11px 12px;border-bottom:1px solid #1e3445;color:#00d9ff;font-size:12px;font-weight:900;letter-spacing:2px;display:flex;align-items:center;justify-content:space-between;gap:8px}.panel-body{padding:12px}
  .grid{display:grid;gap:10px}.card-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.two-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .card{background:#101923;border:1px solid #1e3445;padding:14px}.card-title{font-size:11px;color:#6f899a;margin-bottom:8px}.value{font-size:20px;font-weight:900;font-family:var(--paperlogy-font)}.sub{font-size:12px;color:#6f899a;line-height:1.6}
  .stock-list{display:grid;gap:8px;max-height:470px;overflow:auto;padding-right:2px}.stock-btn{background:#101923;border:1px solid #1e3445;padding:12px;text-align:left;color:#d9ecf5;cursor:pointer;transition:.15s}.stock-btn.active{border-color:#00d9ff;background:#00d9ff11;box-shadow:inset 0 0 0 1px #00d9ff44}.stock-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.stock-name{font-weight:900}
  .input,.select,.textarea{width:100%;background:#070b10;border:1px solid #1e3445;color:#d9ecf5;padding:11px;outline:none}.textarea{min-height:76px;resize:vertical;line-height:1.5}
  .btn{background:#003647;border:1px solid #00d9ff;color:#00d9ff;padding:10px 14px;font-weight:900;cursor:pointer}.btn:hover{background:#004d63}.btn.full{width:100%}.btn.red{border-color:#ff4466;color:#ff4466;background:#48111b}.btn.small{padding:6px 8px;font-size:11px}.auth-gate{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070b10;padding:24px}.auth-card{width:100%;max-width:420px;background:#0b1118;border:1px solid #1e3445;padding:28px 24px}.auth-card h1{margin:0 0 8px;color:#00d9ff;letter-spacing:4px;font-size:18px}.auth-card .sub{margin-bottom:18px}.auth-field{margin-bottom:12px}.auth-field label{display:block;font-size:11px;color:#6f899a;margin-bottom:6px;font-weight:800}.auth-pw-row{display:flex;gap:8px}.auth-user{color:#d9ecf5;font-weight:800}
  .row{display:flex;gap:8px;align-items:center}.form-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:12px}.add-stock-grid{display:grid;grid-template-columns:1fr 1.1fr .9fr;gap:8px;margin-top:10px}
  .error{color:#ffb4c0;background:#ff446611;border:1px solid #ff446644;padding:12px;white-space:pre-wrap;font-size:13px;line-height:1.5}.loading{color:#ffd447}
  .report-layout{display:grid;grid-template-columns:170px 1fr;gap:10px}.score-box{height:172px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #1e3445;background:#101923}.score{font-size:54px;color:#ffd447;font-weight:900;font-family:var(--paperlogy-font)}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.kpi{background:#101923;border:1px solid #1e3445;padding:12px;min-height:78px}.kpi strong{display:block;margin-top:8px;font-size:18px;font-family:var(--paperlogy-font)}
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
.chart-fullscreen .chart-svg{height:100%}.chart-svg{width:100%;height:100%}.axis-label{font-size:11px;fill:#6f899a}.line-ma{stroke:#ffd447;stroke-width:2}.line-ma60{stroke:#00d9ff;stroke-width:1.5;opacity:.85}.line-trend{stroke:#ff4466;stroke-width:2.2;stroke-dasharray:6 5}.candle-up{fill:#00ff88}.candle-down{fill:#ff4466}.wick{stroke:#6f899a;stroke-width:1}.chart-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:10px 0;color:#6f899a;font-size:12px}.technique-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}.technique-btn{border:1px solid #1e3445;background:#101923;color:#6f899a;padding:10px;text-align:left;cursor:pointer}.technique-btn.active{border-color:#00d9ff;color:#d9ecf5;background:#00d9ff11}.technique-name{font-weight:900;color:#00d9ff}.technique-score{font-family:var(--paperlogy-font);margin-top:4px}.band-line{stroke:#9b5cff;stroke-width:1.2;opacity:.75;stroke-dasharray:4 4}.volume-break-line{stroke:#00ff88;stroke-width:1.5;opacity:.8;stroke-dasharray:6 4}.indicator-legend{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.legend-pill{border:1px solid #1e3445;background:#101923;color:#d9ecf5;padding:7px 10px;font-size:12px}.legend-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}.sig-label{font-size:12px;font-weight:900}.sig-box{fill:#061018;stroke:#00d9ff;stroke-width:1.2;opacity:.94}.signal-arrow{stroke-width:2.2;marker-end:url(#arrowHead)}.scan-card{border:1px solid #1e3445;background:#101923;padding:14px;min-height:110px}.scan-card h4{margin:0 0 10px;color:#00d9ff}.scan-card ul{margin:0;padding-left:18px;line-height:1.8}
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
.chart-drag-hint{color:#6f899a;font-size:11px;margin:-4px 0 10px}
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
.x-axis-label{font-size:11px;fill:#8aa4b5;font-family:var(--paperlogy-font)}
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


/* === FIX: AI Report Inner Scroll Only === */
.ai-report-scroll-panel{
  overflow:visible!important;
  height:auto!important;
  max-height:none!important;
}
.ai-report-scroll-panel .panel{
  overflow:visible!important;
  height:auto!important;
  max-height:none!important;
}
.ai-report-scroll-panel .panel-body{
  overflow:visible!important;
  height:auto!important;
  max-height:none!important;
}
.ai-report-result-box{
  height:360px!important;
  max-height:360px!important;
  min-height:260px!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain!important;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:thin;
  border:1px solid #1e3445;
  background:#070b10;
  padding:16px;
  color:#d9ecf5;
  white-space:pre-wrap;
  word-break:keep-all;
  overflow-wrap:anywhere;
  line-height:1.85;
}
.ai-report-result-box::-webkit-scrollbar{width:10px}
.ai-report-result-box::-webkit-scrollbar-track{background:#071018}
.ai-report-result-box::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}
.ai-report-result-box::-webkit-scrollbar-thumb:hover{background:#00d9ff}
.ai-result-full{
  max-height:none!important;
  overflow:visible!important;
}
.ai-result-full h4{
  position:sticky;
  top:0;
  z-index:2;
  margin:0 0 10px 0;
  padding:0 0 8px 0;
  background:#101923;
}
.ai-report-scroll-help{
  margin-top:8px;
  color:#6f899a;
  font-size:12px;
  line-height:1.5;
}
@media(max-width:900px){
  .ai-report-result-box{
    height:300px!important;
    max-height:300px!important;
    min-height:220px!important;
  }
}


/* === FINAL FIX: AI Report Content Scroll + Full View Modal === */
.ai-report-result-box{
  display:block!important;
  width:100%!important;
  box-sizing:border-box!important;
  height:260px!important;
  max-height:260px!important;
  min-height:260px!important;
  overflow-y:scroll!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain!important;
  -webkit-overflow-scrolling:touch!important;
  white-space:pre-wrap!important;
  word-break:keep-all!important;
  overflow-wrap:anywhere!important;
  line-height:1.85!important;
  font-family:inherit!important;
  font-size:14px!important;
  color:#d9ecf5!important;
  background:#070b10!important;
  border:1px solid #1e3445!important;
  padding:16px!important;
  margin:0!important;
}
.ai-report-result-box::-webkit-scrollbar{width:12px!important}
.ai-report-result-box::-webkit-scrollbar-track{background:#071018!important}
.ai-report-result-box::-webkit-scrollbar-thumb{background:#00a6c8!important;border-radius:10px!important}
.ai-report-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 8px}
.ai-report-actions .btn{min-width:120px}
.ai-report-modal-backdrop{
  position:fixed;
  inset:0;
  z-index:99999;
  background:rgba(0,0,0,.78);
  display:flex;
  align-items:center;
  justify-content:center;
  padding:18px;
}
.ai-report-modal{
  width:min(1180px,96vw);
  height:min(820px,92vh);
  background:#081018;
  border:2px solid #00d9ff;
  box-shadow:0 18px 60px rgba(0,0,0,.75);
  display:flex;
  flex-direction:column;
}
.ai-report-modal-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:14px 18px;
  border-bottom:1px solid #1e3445;
  color:#00d9ff;
  font-weight:900;
}
.ai-report-modal-body{
  flex:1;
  overflow-y:scroll;
  overflow-x:hidden;
  padding:22px;
  color:#d9ecf5;
  line-height:1.9;
  white-space:pre-wrap;
  word-break:keep-all;
  overflow-wrap:anywhere;
  font-size:15px;
}
.ai-report-modal-body::-webkit-scrollbar{width:12px}
.ai-report-modal-body::-webkit-scrollbar-track{background:#071018}
.ai-report-modal-body::-webkit-scrollbar-thumb{background:#00a6c8;border-radius:10px}
.ai-report-close{
  border:1px solid #00d9ff;
  background:#00384a;
  color:#d9ecf5;
  padding:9px 14px;
  font-weight:900;
  cursor:pointer;
}
.ai-report-close:hover{background:#005d78}
@media(max-width:900px){
  .ai-report-result-box{height:220px!important;max-height:220px!important;min-height:220px!important}
  .ai-report-modal{width:96vw;height:88vh}
  .ai-report-modal-body{font-size:14px;padding:16px}
}


/* === PC FIX: AI Report wheel scroll === */
.ai-report-result-box{
  height:360px!important;
  max-height:360px!important;
  min-height:360px!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:auto!important;
  pointer-events:auto!important;
  cursor:auto!important;
  display:block!important;
}
.ai-result-full{
  pointer-events:auto!important;
}
.ai-report-wheel-wrapper{
  max-height:360px!important;
  height:360px!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  border:1px solid #1e3445;
  background:#070b10;
  overscroll-behavior:contain;
  scrollbar-width:thin;
}
.ai-report-wheel-wrapper .ai-report-result-box{
  border:0!important;
  height:auto!important;
  max-height:none!important;
  min-height:100%!important;
  overflow:visible!important;
}
.ai-report-wheel-wrapper::-webkit-scrollbar{width:12px}
.ai-report-wheel-wrapper::-webkit-scrollbar-track{background:#071018}
.ai-report-wheel-wrapper::-webkit-scrollbar-thumb{background:#00a6c8;border-radius:10px}
.ai-report-wheel-wrapper:hover::-webkit-scrollbar-thumb{background:#00d9ff}
@media(max-width:900px){
  .ai-report-wheel-wrapper{
    height:300px!important;
    max-height:300px!important;
  }
}


/* === AI Report Price Alert Controls === */
.ai-alert-card{
  margin-top:12px;
  border:1px solid #1e3445;
  background:#0b1520;
  padding:14px;
}
.ai-alert-title{
  color:#00d9ff;
  font-weight:900;
  margin-bottom:10px;
}
.ai-alert-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
}
.ai-alert-grid .input,
.ai-alert-grid .select{
  width:100%;
}
.ai-alert-hint{
  color:#6f899a;
  font-size:12px;
  line-height:1.5;
  margin-top:8px;
}
.ai-alert-toast{
  margin-top:8px;
  border:1px solid #00ff8866;
  background:#00ff8814;
  color:#00ff88;
  padding:8px 10px;
  font-weight:800;
}
@media(max-width:900px){
  .ai-alert-grid{grid-template-columns:1fr 1fr}
}


/* === Value Screener Scan Controls === */
.value-scan-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.value-scan-toolbar .btn{min-width:120px}
.value-scan-status{border:1px solid #1e3445;background:#0b1520;padding:10px 12px;margin:10px 0;color:#8ca6b5;line-height:1.6}
.value-scan-progress{height:8px;background:#071018;border:1px solid #1e3445;overflow:hidden;margin-top:8px}
.value-scan-progress-inner{height:100%;background:#00d9ff;transition:width .2s ease}
.value-scan-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0}
.value-scan-summary .mini-kpi{border:1px solid #1e3445;background:#101923;padding:10px;color:#d9ecf5}
.value-scan-summary .mini-kpi b{display:block;color:#00d9ff;font-size:18px;margin-top:4px}
@media(max-width:900px){.value-scan-summary{grid-template-columns:1fr 1fr}.value-scan-toolbar .btn{flex:1 1 45%}}


/* === Chart Analysis 2.0 UI Upgrade === */
.chart-pro-toolbar{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
  margin:10px 0;
}
.chart-pro-chip{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:10px 12px;
  color:#d9ecf5;
  font-size:12px;
  line-height:1.5;
}
.chart-pro-chip b{color:#00d9ff}
.chart-tooltip{
  position:absolute;
  pointer-events:none;
  z-index:20;
  min-width:190px;
  border:1px solid #00d9ff;
  background:rgba(5,12,18,.94);
  color:#d9ecf5;
  padding:10px 12px;
  font-size:12px;
  line-height:1.55;
  box-shadow:0 10px 28px rgba(0,0,0,.45);
}
.chart-tooltip b{color:#00d9ff}
.chart-cross-line{stroke:#6f899a;stroke-width:1;stroke-dasharray:4 4;opacity:.75}
.support-line{stroke:#ffd447;stroke-width:1.4;stroke-dasharray:5 5}
.resistance-line{stroke:#9b5cff;stroke-width:1.4;stroke-dasharray:5 5}
.target-line{stroke:#00ff88;stroke-width:1.5;stroke-dasharray:6 4}
.stop-line{stroke:#ff4466;stroke-width:1.5;stroke-dasharray:6 4}
.sr-zone-support{fill:#ffd447;opacity:.08}
.sr-zone-resistance{fill:#9b5cff;opacity:.08}
.box-zone{fill:#00d9ff;opacity:.055;stroke:#00d9ff;stroke-width:1;stroke-dasharray:6 4}
.fibo-line{stroke:#6f899a;stroke-width:1;stroke-dasharray:3 5;opacity:.62}
.forecast-cone-zone{fill:#00d9ff;opacity:.05}
.forecast-high-line{stroke:#00d9ff;stroke-width:1.3;stroke-dasharray:2 5;opacity:.75}
.forecast-low-line{stroke:#ff9d3d;stroke-width:1.3;stroke-dasharray:2 5;opacity:.75}
.ai-forecast-high-line{stroke:#00ff88;stroke-width:1.6;stroke-dasharray:7 3}
.ai-forecast-low-line{stroke:#ff4466;stroke-width:1.6;stroke-dasharray:7 3}
.forecast-panel{border:1px solid rgba(0,217,255,.25);border-radius:10px;padding:10px 14px;margin:10px 0;background:rgba(0,217,255,.04)}
.forecast-panel-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600;color:#c9e8ff}
.forecast-panel-body{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.forecast-stat-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12.5px}
.forecast-stat-row.ai{border-top:1px dashed rgba(255,255,255,.12);padding-top:6px}
.forecast-stat-label{color:#8fa6bd;min-width:56px}
.forecast-stat-high{color:#00ff88;font-weight:600}
.forecast-stat-low{color:#ff9d3d;font-weight:600}
.forecast-stat-note{color:#8fa6bd;flex:1 1 100%}
.forecast-stat-error{color:#ff4466;font-size:12px}
.chart-svg-wrap{position:relative}
.pro-chart-svg{cursor:grab;touch-action:pan-y;user-select:none}
.pro-chart-svg.dragging{cursor:grabbing}
@media(max-width:900px){
  .chart-pro-toolbar{grid-template-columns:1fr 1fr}
  .chart-tooltip{display:none}
}


/* === Mobile UX Fix: selected tab only + compact 2-column stock cards === */
.mobile-tab-summary{display:none}
.mobile-nav-label{display:none}
.left-panel-shell{display:block}
@media(max-width:900px){
  .app{min-width:0!important;overflow-x:hidden}
  .top{padding:22px 14px 18px!important;display:block!important}
  .top-left{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .brand{font-size:28px!important;letter-spacing:11px!important}
  .live{font-size:13px!important;margin-top:8px;white-space:nowrap}
  .top-right{margin-top:14px;gap:10px;flex-wrap:wrap}
  .top-right span:last-child{font-size:14px;color:#6f899a}
  .mobile-current{
    display:block!important;
    padding:11px 14px!important;
    font-size:13px!important;
    border-top:1px solid #1e3445;
    border-bottom:1px solid #1e3445;
  }
  .mobile-nav-label{
    display:block;
    padding:10px 14px 4px;
    color:#6f899a;
    font-size:11px;
    letter-spacing:.8px;
    background:#071018;
  }
  .nav{
    padding:10px 12px!important;
    gap:8px!important;
    scroll-snap-type:x mandatory;
  }
  .nav button{
    min-width:auto!important;
    padding:12px 20px!important;
    font-size:13px!important;
    scroll-snap-align:start;
  }
  .ticker{display:none!important}
  .main{
    display:block!important;
    padding:12px!important;
  }
  .main > .grid{
    display:block!important;
  }
  .mobile-hide-left{
    display:none!important;
  }
  .left-panel-shell .grid{
    display:block!important;
  }
  .left-panel-shell .panel{
    margin-bottom:12px;
  }
  .left-panel-shell .panel:nth-child(2){
    display:none!important;
  }
  .left-panel-shell .stock-list{
    display:grid!important;
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:8px!important;
    max-height:none!important;
    overflow:visible!important;
    padding-right:0!important;
  }
  .left-panel-shell .stock-btn{
    min-height:112px!important;
    padding:10px!important;
    border-radius:0!important;
  }
  .left-panel-shell .stock-top{
    display:block!important;
    margin-bottom:8px!important;
  }
  .left-panel-shell .stock-name{
    display:block!important;
    font-size:15px!important;
    line-height:1.25!important;
    margin-bottom:4px!important;
    white-space:normal!important;
    word-break:keep-all!important;
  }
  .left-panel-shell .stock-top span:last-child{
    display:block!important;
    font-size:13px!important;
    text-align:left!important;
  }
  .left-panel-shell .sub{
    font-size:11px!important;
    line-height:1.45!important;
  }
  .left-panel-shell .add-stock-grid{
    grid-template-columns:1fr!important;
  }
  .screen-shell{
    margin-top:0!important;
  }
  .screen-head{
    padding:11px 12px!important;
    margin-bottom:10px!important;
  }
  .screen-title{
    font-size:14px!important;
  }
  .screen-desc{
    display:block;
    font-size:11px!important;
  }
  .card-grid,
  .kpi-grid,
  .chart-pro-toolbar,
  .technique-grid{
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:8px!important;
  }
  .card,.kpi,.technique-btn{
    min-height:auto!important;
    padding:10px!important;
  }
  .report-layout{
    grid-template-columns:1fr!important;
  }
  .score-box{
    height:120px!important;
  }
  .grid{
    gap:10px!important;
  }
  .panel-body{
    padding:12px!important;
  }
  .chart-box{
    height:360px!important;
    min-height:360px!important;
  }
}
@media(max-width:430px){
  .left-panel-shell .stock-list{
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
  }
  .left-panel-shell .stock-btn{
    min-height:108px!important;
    padding:10px!important;
  }
  .left-panel-shell .stock-name{
    font-size:15px!important;
  }
  .left-panel-shell .sub{
    font-size:11px!important;
  }
  .card-grid,
  .kpi-grid,
  .chart-pro-toolbar,
  .technique-grid{
    grid-template-columns:1fr 1fr!important;
  }
}


/* === Global US/Crypto Feature UI === */
.global-grid{display:grid;grid-template-columns:310px 1fr;gap:12px}
.global-list{display:grid;gap:8px;max-height:540px;overflow:auto;padding-right:2px}
.global-card{background:#101923;border:1px solid #1e3445;padding:12px;text-align:left;color:#d9ecf5;cursor:pointer}
.global-card.active{border-color:#00d9ff;background:#00d9ff11;box-shadow:inset 0 0 0 1px #00d9ff44}
.global-card-top{display:flex;justify-content:space-between;gap:10px;align-items:center}
.global-symbol{font-weight:900;color:#d9ecf5;font-size:16px}
.global-name{color:#6f899a;font-size:12px;margin-top:4px}
.global-price{font-family:var(--paperlogy-font);font-size:16px;margin-top:7px}
.global-form{display:grid;grid-template-columns:1fr .8fr auto;gap:8px;margin-bottom:10px}
.global-badge{border:1px solid #9b5cff;color:#9b5cff;background:#9b5cff11;padding:3px 6px;font-size:10px;font-weight:900}
@media(max-width:900px){
  .global-grid{display:block}
  .global-list{grid-template-columns:repeat(2,minmax(0,1fr));display:grid;max-height:none;overflow:visible}
  .global-form{grid-template-columns:1fr 1fr}
  .global-form .btn{grid-column:1 / -1}
}


/* === Psychology Analysis 1.0 === */
.psych-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.psych-tab-btn{border:1px solid #1e3445;background:#101923;color:#6f899a;padding:9px 13px;font-weight:900;cursor:pointer}
.psych-tab-btn.active{border-color:#9b5cff;color:#d9ecf5;background:#9b5cff22;box-shadow:0 0 14px #9b5cff22}
.psych-panel{border:1px solid #1e3445;background:#081018;margin-top:12px}
.psych-panel-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #1e3445}
.psych-panel-title{color:#9b5cff;font-weight:900;letter-spacing:1px}
.psych-body{padding:14px}
.psych-grid{display:grid;grid-template-columns:280px 1fr;gap:12px}
.psych-card{border:1px solid #1e3445;background:#101923;padding:14px}
.psych-phase{font-size:20px;font-weight:900;margin:8px 0 10px}
.psych-desc{line-height:1.75;color:#94a3b8;border-left:3px solid #9b5cff;background:#0b1520;padding:12px;margin-top:10px}
.psych-bias-list{display:grid;gap:7px;margin-top:12px}
.psych-bias{display:flex;gap:8px;align-items:center;color:#c7d2fe;font-size:12px}
.psych-bias::before{content:"";width:7px;height:7px;border-radius:50%;background:#9b5cff;display:inline-block}
.fear-greed-gauge{position:relative;width:170px;height:102px;margin:2px auto 10px;overflow:hidden}
.fear-greed-arc{position:absolute;left:0;top:0;width:170px;height:170px;border-radius:50%;background:conic-gradient(from 180deg,#1d4ed8 0deg,#16a34a 36deg,#84cc16 72deg,#f59e0b 108deg,#dc2626 180deg,transparent 180deg);clip-path:inset(0 0 50% 0)}
.fear-greed-inner{position:absolute;left:31px;top:31px;width:108px;height:108px;border-radius:50%;background:#101923;clip-path:inset(0 0 50% 0)}
.fear-greed-needle{position:absolute;left:50%;bottom:8px;width:3px;height:68px;background:#f8fafc;transform-origin:bottom center;border-radius:4px;box-shadow:0 0 10px #fff8}
.fear-greed-center{position:absolute;left:50%;bottom:2px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:#f8fafc}
.fear-greed-score{position:absolute;left:0;right:0;bottom:28px;text-align:center;font-size:22px;font-weight:900;color:#f8fafc}
.psych-meter{margin:10px 0}
.psych-meter-row{display:flex;justify-content:space-between;gap:10px;color:#6f899a;font-size:12px;margin-bottom:6px}
.psych-meter-track{height:8px;border-radius:8px;background:#0b1520;overflow:hidden;border:1px solid #1e3445}
.psych-meter-fill{height:100%;border-radius:8px;transition:width .45s ease}
.psych-patterns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
.psych-pattern{border:1px solid #1e3445;background:#0b1520;padding:10px}
.psych-learning-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.prediction-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.prediction-btn{border:1px solid #1e3445;background:#0b1520;padding:14px 8px;font-weight:900;cursor:pointer}
.prediction-btn.up{color:#00ff88;border-color:#00ff8844;background:#00ff8812}
.prediction-btn.side{color:#d9ecf5}
.prediction-btn.down{color:#ff4466;border-color:#ff446644;background:#ff446612}
.learning-log{max-height:300px;overflow:auto;display:grid;gap:8px}
.learning-entry{border:1px solid #1e3445;background:#0b1520;padding:10px;font-size:12px}
.learning-result-btn{border:1px solid #1e3445;background:transparent;color:#6f899a;padding:3px 8px;margin-left:4px;cursor:pointer}
@media(max-width:900px){
  .psych-grid,.psych-learning-grid{grid-template-columns:1fr}
  .psych-patterns{grid-template-columns:1fr}
  .prediction-buttons{grid-template-columns:1fr 1fr 1fr}
}


/* === Auto Learning Engine === */
.auto-learning-summary{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
  margin:12px 0;
}
.auto-learn-card{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:12px;
}
.auto-learn-card b{
  display:block;
  margin-top:6px;
  font-size:18px;
  color:#d9ecf5;
  font-family:var(--paperlogy-font);
}
.auto-learn-controls{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:10px;
}
.signal-stat-table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
}
.signal-stat-table th,
.signal-stat-table td{
  border-bottom:1px solid #1e3445;
  padding:8px;
  text-align:left;
}
.signal-stat-table th{
  color:#6f899a;
  font-weight:800;
}
.learning-entry.done{border-color:#00ff8844;background:#00ff8809}
.learning-entry.pending{border-color:#ffd44744;background:#ffd44709}
@media(max-width:900px){
  .auto-learning-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}


/* === US/CRYPTO Layout Fix: global-only view === */
.hide-left-panel{
  display:none!important;
}
.main.global-only{
  grid-template-columns:1fr!important;
}
.main.global-only > .grid{
  width:100%!important;
}
.main.global-only .global-grid{
  grid-template-columns:310px minmax(0,1fr);
}
@media(max-width:900px){
  .main.global-only .global-grid{
    display:block;
  }
}


/* === AI Report Follow-up Scroll Fix === */
.chat-box{
  display:grid!important;
  gap:12px!important;
  margin-top:12px!important;
  max-height:none!important;
  overflow:visible!important;
}
.chat-msg{
  border:1px solid #1e3445;
  background:#101923;
  padding:12px;
  line-height:1.75;
  white-space:pre-wrap;
  font-size:13px;
}
.chat-msg.user{
  border-color:#2d536b;
  background:#0d1a25;
}
.chat-msg.ai{
  border-color:#00d9ff33;
}
.chat-msg-scroll{
  max-height:360px;
  overflow-y:auto!important;
  overflow-x:hidden;
  overscroll-behavior:contain;
  padding-right:8px;
  white-space:pre-wrap;
  word-break:keep-all;
  overflow-wrap:anywhere;
  scrollbar-width:thin;
}
.chat-msg-scroll::-webkit-scrollbar{width:10px}
.chat-msg-scroll::-webkit-scrollbar-track{background:#071018}
.chat-msg-scroll::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}
.chat-msg.ai .chat-msg-scroll{
  max-height:430px;
}
.chat-msg-head{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:center;
  margin-bottom:8px;
  color:#00d9ff;
}
.chat-msg-open{
  border:1px solid #1e3445;
  background:#081018;
  color:#6f899a;
  padding:4px 8px;
  font-size:11px;
  cursor:pointer;
}
.chat-msg-open:hover{
  color:#00d9ff;
  border-color:#00d9ff;
}
.chat-scroll-help{
  margin-top:6px;
  color:#6f899a;
  font-size:11px;
}
.followup-modal-body{
  white-space:pre-wrap;
  word-break:keep-all;
  overflow-wrap:anywhere;
}
@media(max-width:900px){
  .chat-msg-scroll{max-height:300px}
  .chat-msg.ai .chat-msg-scroll{max-height:340px}
}


/* === Value Screener Top20 by KOSPI/KOSDAQ === */
.value-top20-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-top:14px;
}
.value-top20-section{
  border:1px solid #1e3445;
  background:#081018;
}
.value-top20-title{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:center;
  padding:12px 14px;
  border-bottom:1px solid #1e3445;
  color:#00d9ff;
  font-weight:900;
}
.value-top20-scroll{
  max-height:620px;
  overflow:auto;
}
.value-market-tabs{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin:10px 0;
}
.value-market-tabs .btn.active{
  background:#00d9ff22;
  color:#d9ecf5;
  border-color:#00d9ff;
}
@media(max-width:1100px){
  .value-top20-grid{grid-template-columns:1fr}
  .value-top20-scroll{max-height:none}
}


/* === Sector/Theme KOSPI200 KOSDAQ200 Scan === */
.theme-toolbar{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  align-items:center;
  margin-bottom:12px;
}
.theme-summary-grid{
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:8px;
  margin:12px 0;
}
.theme-mini-card{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:11px;
}
.theme-mini-card span{
  display:block;
  color:#6f899a;
  font-size:11px;
}
.theme-mini-card b{
  display:block;
  margin-top:5px;
  font-size:16px;
  color:#d9ecf5;
}
.theme-section-grid{
  display:grid;
  grid-template-columns:1.1fr .9fr;
  gap:12px;
}
.theme-stock-list{
  display:grid;
  gap:7px;
  max-height:360px;
  overflow:auto;
  padding-right:4px;
}
.theme-stock-item{
  display:flex;
  justify-content:space-between;
  gap:10px;
  border:1px solid #1e3445;
  background:#0b1520;
  padding:9px 10px;
  font-size:12px;
}
.theme-progress{
  height:7px;
  background:#0b1520;
  border:1px solid #1e3445;
  overflow:hidden;
  margin-top:8px;
}
.theme-progress-inner{
  height:100%;
  background:#00d9ff;
  transition:width .25s ease;
}
@media(max-width:1100px){
  .theme-section-grid{grid-template-columns:1fr}
  .theme-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}


/* === Creator Signature: ASK === */
.creator-badge{
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:6px 10px;
  border:1px solid #00d9ff66;
  background:#00d9ff12;
  color:#d9ecf5;
  font-size:12px;
  font-weight:900;
  letter-spacing:.8px;
}
.creator-badge b{
  color:#00d9ff;
  font-size:13px;
}
.creator-mark{
  position:fixed;
  right:12px;
  bottom:10px;
  z-index:40;
  padding:6px 10px;
  border:1px solid #1e3445;
  background:rgba(7,16,24,.78);
  color:#6f899a;
  font-size:11px;
  backdrop-filter:blur(8px);
  pointer-events:none;
}
.creator-mark b{
  color:#00d9ff;
}
@media(max-width:900px){
  .creator-badge{
    padding:5px 8px;
    font-size:11px;
  }
  .creator-mark{
    right:8px;
    bottom:7px;
    font-size:10px;
    opacity:.72;
  }
}


/* === Pro Chart Layout: Candle + Volume + RSI === */
.chart-box.pro-chart-box{
  height:var(--chart-height,650px)!important;
  border-radius:10px;
  background:#0a0f1e!important;
  border:1px solid #1e3445;
}
.chart-svg.pro-chart-svg{
  background:#0a0f1e;
}
.pro-panel-bg{fill:#0a0f1e;stroke:#1e3445;stroke-width:1}
.pro-grid{stroke:#1a2035;stroke-width:1;opacity:.9}
.line-ma5{stroke:#f59e0b;stroke-width:2.1;fill:none}
.line-ma20{stroke:#06b6d4;stroke-width:2;fill:none}
.line-boll{stroke:#8b5cf6;stroke-width:1.1;fill:none;opacity:.68}
.rsi-line{stroke:#a78bfa;stroke-width:2;fill:none}
.rsi-guide-red{stroke:#ef4444;stroke-width:1;stroke-dasharray:4 5;opacity:.9}
.rsi-guide-green{stroke:#22c55e;stroke-width:1;stroke-dasharray:4 5;opacity:.9}
.rsi-guide-mid{stroke:#334155;stroke-width:1;stroke-dasharray:2 5;opacity:.7}
.volume-bar-up{fill:#22c55e;opacity:.62}
.volume-bar-down{fill:#ef4444;opacity:.62}
.volume-avg-line{stroke:#fbbf24;stroke-width:1.2;stroke-dasharray:5 5;opacity:.65}
.pro-section-title{fill:#6f899a;font-size:11px;font-weight:800;letter-spacing:.5px}
.pro-legend{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 10px;color:#6f899a;font-size:12px}
.pro-legend b{color:#d9ecf5}
.pro-legend-dot{display:inline-block;width:8px;height:8px;margin-right:5px;border-radius:2px}
.pattern-marker-up{fill:#22c55e;stroke:#061018;stroke-width:1}
.pattern-marker-down{fill:#ef4444;stroke:#061018;stroke-width:1}
@media(max-width:900px){
  .chart-box.pro-chart-box{height:560px!important}
  .pro-legend{gap:9px;font-size:11px}
}


/* === Top ticker marquee: right to left === */
.ticker{
  position:relative!important;
  display:block!important;
  height:68px;
  border-bottom:1px solid #1e3445;
  overflow:hidden!important;
  background:#0b1118;
  scrollbar-width:none;
}
.ticker-track{
  display:flex;
  width:max-content;
  min-width:100%;
  animation:tickerMarquee 42s linear infinite;
  will-change:transform;
}
.ticker:hover .ticker-track{
  animation-play-state:paused;
}
.ticker-item{
  min-width:150px;
  height:68px;
  padding:8px 12px;
  border-right:1px solid #1e3445;
  font-size:12px;
  display:grid;
  grid-template-rows:auto auto auto;
  gap:3px;
  align-items:start;
  flex:0 0 auto;
}
@keyframes tickerMarquee{
  0%{transform:translateX(0)}
  100%{transform:translateX(-50%)}
}
@media(max-width:900px){
  .ticker{
    display:block!important;
    height:62px;
  }
  .ticker-track{
    animation-duration:34s;
  }
  .ticker-item{
    min-width:132px;
    height:62px;
    padding:7px 10px;
    font-size:11px;
  }
}


/* === Font Unification: Paperlogy === */
:root{
  --paperlogy-font:
    "Paperlogy",
    "Paperlogy-5Medium",
    "Paperlogy-6SemiBold",
    "Paperlogy-7Bold",
    "Paperlogy-8ExtraBold",
    "Pretendard",
    "Noto Sans KR",
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    sans-serif;
}

/* 앱 전체 기본 폰트를 Paperlogy 계열로 통일합니다. */
html,
body,
#root,
.app,
.app *,
button,
input,
select,
textarea,
pre,
code,
svg text{
  font-family:var(--paperlogy-font)!important;
}

/* 숫자/시세 영역도 기존 monospace 대신 같은 폰트로 통일합니다. */
.value,
.ticker-line2,
.ticker-price,
.chart-tooltip,
.axis-label,
.data-table,
.kpi strong,
.score-box strong,
.ai-score,
.rank,
.global-price,
.creator-badge,
.creator-mark{
  font-family:var(--paperlogy-font)!important;
  font-variant-numeric:tabular-nums;
}

/* 차트/리포트 텍스트 가독성 보정 */
.ai-report-result-box,
.ai-report-modal-body,
.chat-msg,
.chat-msg-scroll,
.followup-modal-body{
  font-family:var(--paperlogy-font)!important;
  line-height:1.75;
}

/* 폰트 렌더링 보정 */
body{
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  text-rendering:geometricPrecision;
}


/* === Pro Chart UI Readability Upgrade === */
.chart-box.pro-chart-box{
  height:720px!important;
  border-radius:12px!important;
  background:#0a0f1e!important;
  border:1px solid #24384a!important;
  box-shadow:inset 0 0 0 1px rgba(0,217,255,.04);
}
.chart-svg.pro-chart-svg{
  background:#0a0f1e!important;
}
.pro-panel-bg{
  fill:#0a0f1e!important;
  stroke:#24384a!important;
  stroke-width:1.15!important;
}
.pro-grid{
  stroke:#1f3142!important;
  stroke-width:1.15!important;
  opacity:.88!important;
}
.axis-label{
  font-size:13px!important;
  fill:#8aa4b5!important;
  font-weight:700!important;
  letter-spacing:.1px;
}
.x-axis-label{
  font-size:13px!important;
  fill:#91aabc!important;
  font-weight:700!important;
}
.x-axis-year{
  font-size:14px!important;
  fill:#00d9ff!important;
  font-weight:900!important;
}
.pro-section-title{
  fill:#8fa4b5!important;
  font-size:14px!important;
  font-weight:900!important;
  letter-spacing:.6px!important;
}
.pro-legend-bg{
  fill:#0a0f1e;
  opacity:.92;
  stroke:#1e3445;
  stroke-width:1;
}
.line-ma5{stroke:#f5a400!important;stroke-width:2.45!important;fill:none!important}
.line-ma20{stroke:#06b6d4!important;stroke-width:2.3!important;fill:none!important}
.line-boll{stroke:#7c5bd6!important;stroke-width:1.35!important;fill:none!important;opacity:.7!important}
.support-line{stroke:#ffd447!important;stroke-width:2!important;stroke-dasharray:7 6!important}
.resistance-line{stroke:#9b5cff!important;stroke-width:2!important;stroke-dasharray:7 6!important}
.line-trend{stroke:#ff4466!important;stroke-width:2.4!important;stroke-dasharray:7 6!important}
.wick{stroke:#8aa4b5!important;stroke-width:1.05!important;opacity:.9}
.candle-up{fill:#00ff88!important}
.candle-down{fill:#ff4466!important}
.volume-bar-up{fill:#00ff88!important;opacity:.58!important}
.volume-bar-down{fill:#ff4466!important;opacity:.58!important}
.volume-avg-line{stroke:#fbbf24!important;stroke-width:1.6!important;stroke-dasharray:6 5!important;opacity:.75!important}
.rsi-line{stroke:#a78bfa!important;stroke-width:2.4!important;fill:none!important}
.rsi-guide-red{stroke:#ff4466!important;stroke-width:1.2!important;stroke-dasharray:5 5!important}
.rsi-guide-green{stroke:#00ff88!important;stroke-width:1.2!important;stroke-dasharray:5 5!important}
.rsi-guide-mid{stroke:#526377!important;stroke-width:1!important;stroke-dasharray:3 5!important}
.sig-label{
  font-size:14px!important;
  font-weight:900!important;
  paint-order:stroke;
  stroke:#061018;
  stroke-width:4px;
  stroke-linejoin:round;
}
.pattern-marker-up,
.pattern-marker-down{
  stroke:#061018!important;
  stroke-width:1.4!important;
}
.chart-caption{
  gap:10px!important;
  font-size:13px!important;
  margin-top:10px!important;
}
.chart-caption span{
  padding:6px 9px!important;
  border-color:#24384a!important;
}
.chart-period-note{
  font-size:13px!important;
  line-height:1.7!important;
}
@media(max-width:900px){
  .chart-box.pro-chart-box{height:620px!important}
  .axis-label{font-size:11px!important}
  .x-axis-label{font-size:11px!important}
  .x-axis-year{font-size:12px!important}
  .pro-section-title{font-size:12px!important}
  .sig-label{font-size:12px!important}
}


/* === FINAL Chart UX Fix: Paperlogy + Mobile Stock Select + Compact PC Chart === */
@font-face{
  font-family:"PaperlogyLocal";
  src:local("Paperlogy"), local("Paperlogy-5Medium"), local("Paperlogy-6SemiBold"), local("Paperlogy-7Bold"), local("Paperlogy-8ExtraBold");
  font-display:swap;
}
:root{
  --paperlogy-font:
    "PaperlogyLocal",
    "Paperlogy",
    "Paperlogy-5Medium",
    "Paperlogy-6SemiBold",
    "Paperlogy-7Bold",
    "Paperlogy-8ExtraBold",
    "Pretendard",
    "Noto Sans KR",
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    sans-serif;
}
html,body,#root,.app,.app *,button,input,select,textarea,pre,code,
svg,svg *,svg text,tspan{
  font-family:var(--paperlogy-font)!important;
}
.chart-scroll-area{
  max-height:calc(100vh - 170px);
  overflow-y:auto;
  overflow-x:hidden;
  padding-right:6px;
  overscroll-behavior:contain;
  scrollbar-width:thin;
}
.chart-scroll-area::-webkit-scrollbar{width:10px}
.chart-scroll-area::-webkit-scrollbar-track{background:#071018}
.chart-scroll-area::-webkit-scrollbar-thumb{background:#254357;border-radius:10px}
.chart-box.pro-chart-box{
  height:560px!important;
  max-height:560px!important;
  overflow:hidden!important;
}
.chart-svg.pro-chart-svg{
  width:100%!important;
  height:100%!important;
  font-family:var(--paperlogy-font)!important;
}
.pro-chart-svg text,
.pro-chart-svg tspan,
.axis-label,
.x-axis-label,
.x-axis-year,
.pro-section-title,
.sig-label{
  font-family:var(--paperlogy-font)!important;
}
.chart-mobile-stock-select{
  display:none;
  border:1px solid #1e3445;
  background:#08131d;
  padding:12px;
  margin:0 0 12px;
}
.chart-mobile-stock-select label{
  display:block;
  margin-bottom:8px;
  color:#00d9ff;
  font-size:12px;
  font-weight:900;
  letter-spacing:.6px;
}
.chart-mobile-stock-select select{
  width:100%;
  min-height:44px;
  border:1px solid #2d536b;
  background:#071018;
  color:#d9ecf5;
  padding:0 12px;
  font-size:14px;
  font-weight:800;
}
.chart-mobile-stock-select .sub{
  margin-top:7px;
  line-height:1.5;
}
@media(min-width:901px){
  .axis-label{font-size:11.5px!important}
  .x-axis-label{font-size:11.5px!important}
  .x-axis-year{font-size:12.5px!important}
  .pro-section-title{font-size:12.5px!important}
}
@media(max-width:900px){
  .chart-scroll-area{
    max-height:none;
    overflow:visible;
    padding-right:0;
  }
  .chart-mobile-stock-select{
    display:block;
  }
  .chart-box.pro-chart-box{
    height:520px!important;
    max-height:520px!important;
  }
  .indicator-legend{
    gap:6px!important;
  }
  .legend-pill{
    font-size:11px!important;
    padding:6px 8px!important;
  }
}


/* === SECTORMIND Dashboard === */
.sectormind-shell{
  display:grid;
  gap:14px;
}
.sectormind-toolbar{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  align-items:center;
}
.sectormind-toolbar .btn.active{
  border-color:#6366f1;
  background:#6366f122;
  color:#c7d2fe;
}
.sectormind-summary{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
}
.sectormind-kpi{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:14px;
  min-height:76px;
}
.sectormind-kpi small{
  display:block;
  color:#6f899a;
  font-size:11px;
  margin-bottom:7px;
}
.sectormind-kpi b{
  display:block;
  font-size:24px;
  line-height:1;
  color:#d9ecf5;
}
.sectormind-kpi span{
  display:block;
  margin-top:7px;
  font-size:11px;
  color:#6f899a;
}
.sectormind-card-layout{
  display:grid;
  grid-template-columns:minmax(0,1fr) 380px;
  gap:14px;
}
.sectormind-card-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(230px,1fr));
  gap:10px;
}
.sectormind-card{
  position:relative;
  overflow:hidden;
  border:1px solid #1e3445;
  background:#0b1520;
  padding:14px;
  cursor:pointer;
  transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;
}
.sectormind-card:hover,
.sectormind-card.active{
  transform:translateY(-2px);
  border-color:#00d9ff77;
  box-shadow:0 0 22px rgba(0,217,255,.08);
}
.sectormind-card-head{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:flex-start;
  margin-bottom:10px;
}
.sectormind-icon{
  width:34px;
  height:34px;
  display:grid;
  place-items:center;
  border:1px solid #1e3445;
  background:#071018;
  font-weight:900;
}
.sectormind-rank{
  position:absolute;
  right:9px;
  top:9px;
  border:1px solid #1e3445;
  background:#071018;
  padding:2px 7px;
  color:#6f899a;
  font-size:10px;
}
.sectormind-phase{
  display:inline-block;
  margin-top:4px;
  padding:3px 7px;
  border:1px solid currentColor;
  font-size:11px;
  font-weight:900;
}
.sectormind-metrics{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:6px;
  margin-top:10px;
  border-top:1px solid #1e3445;
  padding-top:10px;
}
.sectormind-metric small{
  display:block;
  color:#6f899a;
  font-size:10px;
  margin-bottom:3px;
}
.sectormind-metric b{
  font-size:14px;
}
.sectormind-detail{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:16px;
  max-height:760px;
  overflow:auto;
}
.sectormind-detail h3{
  margin:0;
  color:#d9ecf5;
}
.sectormind-detail-section{
  border:1px solid #1e3445;
  background:#071018;
  padding:12px;
  margin-top:10px;
}
.sectormind-stock-row{
  display:grid;
  grid-template-columns:1fr 52px 52px;
  gap:8px;
  align-items:center;
  padding:7px 0;
  border-bottom:1px solid #102334;
  font-size:12px;
}
.sectormind-stock-row:last-child{border-bottom:0}
.sectormind-heatbar{
  height:8px;
  border:1px solid #1e3445;
  background:#071018;
  overflow:hidden;
}
.sectormind-heatbar div{
  height:100%;
  transition:width .35s ease;
}
.sectormind-matrix-wrap{
  overflow:auto;
  border:1px solid #1e3445;
}
.sectormind-heatmap{
  display:grid;
  gap:8px;
  border:1px solid #1e3445;
  background:#0b1520;
  padding:14px;
}
.sectormind-heat-row{
  display:grid;
  grid-template-columns:34px 130px 1fr 70px;
  gap:10px;
  align-items:center;
}
.sectormind-heat-track{
  height:24px;
  position:relative;
  background:#071018;
  border:1px solid #1e3445;
}
.sectormind-heat-fill{
  height:100%;
  opacity:.92;
}
.sectormind-heat-text{
  position:absolute;
  right:8px;
  top:50%;
  transform:translateY(-50%);
  font-size:11px;
  font-weight:900;
  color:#d9ecf5;
}
.sectormind-radar-layout{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}
.sectormind-visual-card{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:16px;
}
.sectormind-svg{
  width:100%;
  max-width:420px;
  height:auto;
  display:block;
  margin:0 auto;
}
@media(max-width:1100px){
  .sectormind-card-layout,
  .sectormind-radar-layout{grid-template-columns:1fr}
  .sectormind-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:700px){
  .sectormind-summary{grid-template-columns:1fr 1fr}
  .sectormind-card-grid{grid-template-columns:1fr}
  .sectormind-heat-row{grid-template-columns:26px 92px 1fr 56px}
  .sectormind-toolbar .btn{flex:1 1 30%}
}


/* === SECTORMIND Top Picks + Accuracy === */
.sectormind-picks-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}
.sectormind-pick-section{
  border:1px solid #1e3445;
  background:#08131d;
}
.sectormind-pick-head{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:center;
  padding:12px 14px;
  border-bottom:1px solid #1e3445;
}
.sectormind-pick-head b{
  color:#00d9ff;
  font-size:14px;
}
.sectormind-pick-scroll{
  max-height:620px;
  overflow:auto;
}
.sectormind-pick-table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
}
.sectormind-pick-table th,
.sectormind-pick-table td{
  border-bottom:1px solid #163044;
  padding:8px;
  text-align:left;
  vertical-align:top;
}
.sectormind-pick-table th{
  color:#6f899a;
  font-size:11px;
  font-weight:900;
  background:#071018;
  position:sticky;
  top:0;
  z-index:1;
}
.pick-score{
  font-size:17px;
  font-weight:900;
  color:#ffd447;
}
.pick-tags{
  color:#6f899a;
  font-size:11px;
  line-height:1.5;
}
.sectormind-accuracy-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
  margin-top:12px;
}
.sectormind-accuracy-card{
  border:1px solid #1e3445;
  background:#071018;
  padding:12px;
}
.sectormind-accuracy-card small{
  display:block;
  color:#6f899a;
  margin-bottom:6px;
}
.sectormind-accuracy-card b{
  font-size:20px;
}
.pick-toggle-row{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:10px;
}
@media(max-width:1100px){
  .sectormind-picks-grid{grid-template-columns:1fr}
  .sectormind-accuracy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:700px){
  .sectormind-accuracy-grid{grid-template-columns:1fr 1fr}
  .sectormind-pick-table{font-size:11px}
  .sectormind-pick-table th,
  .sectormind-pick-table td{padding:7px 6px}
}


/* === Full Scan KOSPI200/KOSDAQ200 Upgrade === */
.fullscan-toolbar{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  align-items:center;
  margin-bottom:12px;
}
.fullscan-summary{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
  margin-bottom:12px;
}
.fullscan-kpi{
  border:1px solid #1e3445;
  background:#071018;
  padding:12px;
}
.fullscan-kpi small{
  display:block;
  color:#6f899a;
  margin-bottom:6px;
  font-size:11px;
}
.fullscan-kpi b{
  font-size:20px;
  color:#d9ecf5;
}
.fullscan-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.fullscan-section{
  border:1px solid #1e3445;
  background:#08131d;
}
.fullscan-section-head{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:center;
  padding:12px 14px;
  border-bottom:1px solid #1e3445;
}
.fullscan-section-head b{
  color:#00d9ff;
}
.fullscan-scroll{
  max-height:440px;
  overflow:auto;
}
.fullscan-table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
}
.fullscan-table th,
.fullscan-table td{
  border-bottom:1px solid #163044;
  padding:8px;
  text-align:left;
  vertical-align:top;
}
.fullscan-table th{
  color:#6f899a;
  background:#071018;
  position:sticky;
  top:0;
  z-index:1;
}
.fullscan-score{
  font-weight:900;
  font-size:16px;
  color:#ffd447;
}
@media(max-width:1100px){
  .fullscan-grid{grid-template-columns:1fr}
  .fullscan-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}


/* === Integrated Optimal Analysis === */
.integrated-shell{
  display:grid;
  gap:14px;
}
.integrated-toolbar{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  align-items:center;
}
.integrated-summary{
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:10px;
}
.integrated-kpi{
  border:1px solid #1e3445;
  background:#071018;
  padding:12px;
}
.integrated-kpi small{
  display:block;
  color:#6f899a;
  margin-bottom:6px;
  font-size:11px;
}
.integrated-kpi b{
  display:block;
  font-size:21px;
  color:#d9ecf5;
}
.integrated-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}
.integrated-section{
  border:1px solid #1e3445;
  background:#08131d;
}
.integrated-section-head{
  display:flex;
  justify-content:space-between;
  gap:10px;
  align-items:center;
  padding:12px 14px;
  border-bottom:1px solid #1e3445;
}
.integrated-section-head b{
  color:#00d9ff;
}
.integrated-scroll{
  max-height:650px;
  overflow:auto;
}
.integrated-table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
}
.integrated-table th,
.integrated-table td{
  border-bottom:1px solid #163044;
  padding:8px;
  text-align:left;
  vertical-align:top;
}
.integrated-table th{
  position:sticky;
  top:0;
  background:#071018;
  color:#6f899a;
  z-index:1;
  font-size:11px;
}
.integrated-score{
  font-size:19px;
  font-weight:900;
  color:#ffd447;
}
.integrated-pill{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:3px 7px;
  border:1px solid #1e3445;
  background:#071018;
  color:#8fb2c7;
  font-size:11px;
  margin:2px 3px 2px 0;
}
.integrated-breakdown{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:4px;
  min-width:220px;
}
.integrated-mini-meter{
  height:5px;
  border:1px solid #1e3445;
  background:#071018;
  overflow:hidden;
  margin-top:3px;
}
.integrated-mini-meter div{
  height:100%;
  background:#00d9ff;
}
@media(max-width:1200px){
  .integrated-grid{grid-template-columns:1fr}
  .integrated-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:700px){
  .integrated-summary{grid-template-columns:1fr 1fr}
  .integrated-table{font-size:11px}
  .integrated-table th,
  .integrated-table td{padding:7px 6px}
}


.integrated-toolbar .btn.active{
  border-color:#00d9ff;
  background:#00d9ff22;
  color:#d9ecf5;
}


/* === Integrated WOST Bottom 10 === */
.integrated-wost-section{
  border:1px solid #4a1f2a;
  background:#12080d;
  margin-top:14px;
}
.integrated-wost-section .integrated-section-head{
  border-bottom-color:#4a1f2a;
}
.integrated-wost-section .integrated-section-head b{
  color:#ff6680;
}
.integrated-wost-score{
  font-size:18px;
  font-weight:900;
  color:#ff6680;
}
.integrated-risk-tag{
  display:inline-flex;
  padding:3px 7px;
  border:1px solid #4a1f2a;
  background:#1b0b12;
  color:#ff9bad;
  font-size:11px;
  margin:2px 3px 2px 0;
}


/* === WORST 10 Top Visibility Upgrade === */
.integrated-worst-top{
  margin-top:4px;
  border:1px solid #ff668066;
  box-shadow:0 0 22px rgba(255,102,128,.08);
}
.integrated-worst-top .integrated-section-head{
  background:linear-gradient(90deg, rgba(255,102,128,.13), rgba(7,16,24,.9));
}
.integrated-worst-notice{
  display:flex;
  gap:8px;
  align-items:center;
  padding:10px 12px;
  border-bottom:1px solid #4a1f2a;
  color:#ff9bad;
  background:#1b0b1211;
  font-size:12px;
  line-height:1.5;
}
.integrated-worst-notice b{
  color:#ff6680;
}


/* === NASDAQ100 Integrated Extension === */
.integrated-nasdaq-section{
  border-color:#2d3f77;
  background:#08101f;
}
.integrated-nasdaq-section .integrated-section-head b{
  color:#7dd3fc;
}
.integrated-global-price{
  color:#d9ecf5;
  font-weight:900;
}
.integrated-us-tag{
  display:inline-flex;
  padding:3px 7px;
  border:1px solid #2d3f77;
  background:#0b1530;
  color:#93c5fd;
  font-size:11px;
  margin:2px 3px 2px 0;
}


/* === Mobile UX Fix: Integrated Optimal Analysis === */
.integrated-mobile-card-list{display:none}
.integrated-mobile-card{border:1px solid #1e3445;background:#08131d;padding:12px;margin-bottom:10px}
.integrated-mobile-card-head{display:grid;grid-template-columns:34px minmax(0,1fr) 58px;gap:10px;align-items:start}
.integrated-mobile-rank{color:#ffd447;font-weight:900;font-size:15px}
.integrated-mobile-name{color:#d9ecf5;font-weight:900;font-size:14px;line-height:1.35}
.integrated-mobile-meta{color:#6f899a;font-size:11px;line-height:1.55;margin-top:3px}
.integrated-mobile-score{text-align:right;color:#ffd447;font-size:24px;font-weight:900;line-height:1}
.integrated-mobile-score small{display:block;color:#6f899a;font-size:10px;margin-top:4px}
.integrated-mobile-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.integrated-mobile-badges span{border:1px solid #1e3445;background:#071018;padding:4px 7px;font-size:11px;color:#8fb2c7}
.integrated-mobile-bars{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin-top:10px}
.integrated-mobile-bar small{display:block;color:#6f899a;font-size:10px;margin-bottom:3px}
.integrated-mobile-bar-track{height:5px;border:1px solid #1e3445;background:#071018;overflow:hidden}
.integrated-mobile-bar-track div{height:100%;background:#00d9ff}
.integrated-mobile-reason{margin-top:10px;color:#9fb4c5;font-size:12px;line-height:1.6;border-left:3px solid #00d9ff66;padding-left:8px}
.integrated-mobile-worst .integrated-mobile-score{color:#ff6680}
.integrated-mobile-worst .integrated-mobile-reason{border-left-color:#ff668066}
@media(max-width:700px){
  .integrated-shell{gap:10px!important}
  .integrated-toolbar{gap:6px!important}
  .integrated-toolbar .btn,.integrated-toolbar button{min-height:42px;flex:1 1 46%;font-size:12px;padding:8px 10px}
  .integrated-toolbar .sub{flex-basis:100%;line-height:1.55}
  .integrated-summary{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
  .integrated-kpi{padding:10px!important;min-height:76px}
  .integrated-kpi b{font-size:17px!important;line-height:1.25;word-break:keep-all}
  .integrated-kpi small,.integrated-kpi span{font-size:10px!important;line-height:1.4}
  .integrated-grid{display:block!important}
  .integrated-section,.integrated-wost-section,.integrated-nasdaq-section{margin-top:12px}
  .integrated-section-head{padding:10px 12px!important}
  .integrated-section-head b{font-size:15px!important}
  .integrated-scroll{max-height:none!important;overflow:visible!important}
  .integrated-table{display:none!important}
  .integrated-mobile-card-list{display:block!important;padding:10px}
  .integrated-worst-notice{font-size:11px!important;padding:9px 10px!important;align-items:flex-start!important}
  .value-scan-status{font-size:12px!important;line-height:1.65!important;padding:10px!important}
}
@media(max-width:420px){
  .integrated-mobile-card{padding:10px}
  .integrated-mobile-card-head{grid-template-columns:28px minmax(0,1fr) 48px;gap:8px}
  .integrated-mobile-score{font-size:21px}
  .integrated-mobile-bars{gap:4px}
  .integrated-mobile-badges span{font-size:10px;padding:3px 6px}
}


/* === Integrated Analysis: Realtime-Stock Style One Column Cards === */
.integrated-onecol-list{
  display:grid;
  grid-template-columns:1fr;
  gap:10px;
  padding:12px;
}
.integrated-onecol-card{
  border:1px solid #1e3445;
  background:#0b1520;
  padding:13px 14px;
  min-height:112px;
}
.integrated-onecol-card.active{
  border-color:#00d9ff;
  box-shadow:0 0 0 1px rgba(0,217,255,.18) inset;
}
.integrated-onecol-card.worst{
  border-color:#4a1f2a;
  background:#12080d;
}
.integrated-onecol-head{
  display:grid;
  grid-template-columns:30px minmax(0,1fr) 70px;
  gap:10px;
  align-items:start;
}
.integrated-onecol-rank{
  color:#ffd447;
  font-weight:900;
  font-size:14px;
  line-height:1.2;
}
.integrated-onecol-name{
  color:#d9ecf5;
  font-size:15px;
  font-weight:900;
  line-height:1.35;
  word-break:keep-all;
}
.integrated-onecol-meta{
  margin-top:4px;
  color:#6f899a;
  font-size:12px;
  line-height:1.55;
}
.integrated-onecol-change{
  margin-top:4px;
  font-size:13px;
  font-weight:900;
}
.integrated-onecol-score{
  text-align:right;
  color:#ffd447;
  font-size:24px;
  font-weight:900;
  line-height:1;
}
.integrated-onecol-card.worst .integrated-onecol-score{
  color:#ff6680;
}
.integrated-onecol-score small{
  display:block;
  color:#6f899a;
  font-size:10px;
  margin-top:5px;
  font-weight:700;
}
.integrated-onecol-body{
  margin-top:11px;
  display:grid;
  grid-template-columns:1fr;
  gap:9px;
}
.integrated-onecol-badges{
  display:flex;
  flex-wrap:wrap;
  gap:5px;
}
.integrated-onecol-badges span{
  border:1px solid #1e3445;
  background:#071018;
  padding:4px 7px;
  color:#8fb2c7;
  font-size:11px;
}
.integrated-onecol-card.worst .integrated-onecol-badges span{
  border-color:#4a1f2a;
  color:#ff9bad;
}
.integrated-onecol-bars{
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:5px;
}
.integrated-onecol-bar small{
  display:block;
  color:#6f899a;
  font-size:10px;
  margin-bottom:3px;
}
.integrated-onecol-track{
  height:6px;
  border:1px solid #1e3445;
  background:#071018;
  overflow:hidden;
}
.integrated-onecol-track div{
  height:100%;
  background:#00d9ff;
}
.integrated-onecol-reason{
  color:#9fb4c5;
  font-size:12px;
  line-height:1.6;
  border-left:3px solid #00d9ff66;
  padding-left:8px;
  word-break:keep-all;
}
.integrated-onecol-card.worst .integrated-onecol-reason{
  border-left-color:#ff668066;
}
.integrated-table{
  display:none!important;
}
.integrated-scroll{
  max-height:none!important;
  overflow:visible!important;
}
.integrated-grid{
  grid-template-columns:1fr!important;
}
.integrated-section,
.integrated-wost-section,
.integrated-nasdaq-section{
  overflow:hidden;
}
@media(max-width:900px){
  .integrated-section-head{
    padding:10px 12px!important;
  }
  .integrated-section-head b{
    font-size:15px!important;
  }
  .integrated-onecol-list{
    padding:10px;
    gap:9px;
  }
  .integrated-onecol-card{
    padding:12px;
    min-height:116px;
  }
  .integrated-onecol-head{
    grid-template-columns:26px minmax(0,1fr) 56px;
    gap:8px;
  }
  .integrated-onecol-name{
    font-size:14px;
  }
  .integrated-onecol-meta{
    font-size:11px;
  }
  .integrated-onecol-score{
    font-size:22px;
  }
  .integrated-onecol-bars{
    grid-template-columns:repeat(5,1fr);
    gap:4px;
  }
  .integrated-onecol-badges span{
    font-size:10px;
    padding:3px 6px;
  }
  .integrated-onecol-reason{
    font-size:11px;
  }
  .creator-mark{
    display:none!important;
  }
}


/* === WORST 10 Bottom Placement === */
.integrated-wost-section{
  margin-top:14px!important;
  margin-bottom:14px!important;
}
@media(max-width:900px){
  .integrated-wost-section{
    margin-top:16px!important;
  }
}


/* === Integrated Mobile Compact Matrix Card === */
@media(max-width:900px){
  .integrated-onecol-card{
    padding:0!important;
    min-height:0!important;
    border-color:#284457!important;
    background:#08131d!important;
  }
  .integrated-onecol-head{
    display:grid!important;
    grid-template-columns:28px minmax(86px,1fr) 52px minmax(0,1.15fr)!important;
    gap:0!important;
    align-items:stretch!important;
    border-bottom:1px solid #284457;
  }
  .integrated-onecol-rank{
    display:flex!important;
    align-items:flex-start;
    justify-content:center;
    padding:8px 4px!important;
    border-right:1px solid #284457;
    font-size:12px!important;
    line-height:1.2!important;
  }
  .integrated-onecol-main{
    padding:8px 8px!important;
    border-right:1px solid #284457;
    min-width:0;
  }
  .integrated-onecol-name{
    font-size:12px!important;
    line-height:1.32!important;
    word-break:keep-all;
  }
  .integrated-onecol-meta{
    font-size:10.5px!important;
    line-height:1.45!important;
    margin-top:3px!important;
  }
  .integrated-onecol-change{
    margin-top:3px!important;
    font-size:10.5px!important;
    line-height:1.25!important;
  }
  .integrated-onecol-score{
    display:flex!important;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    padding:6px 3px!important;
    border-right:1px solid #284457;
    font-size:21px!important;
    text-align:center!important;
  }
  .integrated-onecol-score small{
    font-size:9px!important;
    margin-top:4px!important;
  }
  .integrated-onecol-judge{
    padding:7px 8px!important;
    min-width:0;
  }
  .integrated-onecol-judge-title{
    color:#6f899a;
    font-size:9.5px;
    font-weight:800;
    margin-bottom:3px;
  }
  .integrated-onecol-judge-value{
    color:#28ff91;
    font-size:12px;
    font-weight:900;
    line-height:1.35;
  }
  .integrated-onecol-judge-meta{
    color:#8da2b3;
    font-size:10px;
    line-height:1.45;
    margin-top:4px;
  }
  .integrated-onecol-body{
    margin-top:0!important;
    padding:8px 8px 9px!important;
    gap:7px!important;
  }
  .integrated-onecol-badges{
    display:none!important;
  }
  .integrated-onecol-bars{
    grid-template-columns:repeat(5,1fr)!important;
    gap:6px!important;
  }
  .integrated-onecol-bar small{
    font-size:10px!important;
    margin-bottom:2px!important;
    white-space:nowrap;
  }
  .integrated-onecol-track{
    height:4px!important;
  }
  .integrated-onecol-reason{
    margin-top:1px!important;
    border-left:0!important;
    border:1px solid #1e3445;
    background:#071018;
    padding:7px 8px!important;
    font-size:10.5px!important;
    line-height:1.52!important;
    max-height:none!important;
    word-break:keep-all;
    white-space:normal;
  }
  .integrated-onecol-reason::before{
    content:"추천근거 ";
    color:#00d9ff;
    font-weight:900;
  }
  .integrated-onecol-card.worst .integrated-onecol-reason::before{
    content:"위험요인 ";
    color:#ff6680;
  }
  .integrated-onecol-card.worst .integrated-onecol-judge-value{
    color:#ff6680;
  }
}
@media(max-width:380px){
  .integrated-onecol-head{
    grid-template-columns:24px minmax(78px,1fr) 46px minmax(0,1fr)!important;
  }
  .integrated-onecol-main{
    padding:7px 6px!important;
  }
  .integrated-onecol-name{
    font-size:11.2px!important;
  }
  .integrated-onecol-meta,
  .integrated-onecol-change{
    font-size:9.8px!important;
  }
  .integrated-onecol-score{
    font-size:18px!important;
  }
  .integrated-onecol-judge{
    padding:6px!important;
  }
  .integrated-onecol-judge-value{
    font-size:11px!important;
  }
  .integrated-onecol-judge-meta{
    font-size:9.3px!important;
  }
  .integrated-onecol-bars{
    gap:4px!important;
  }
  .integrated-onecol-bar small{
    font-size:9px!important;
  }
  .integrated-onecol-reason{
    font-size:9.8px!important;
  }
}


/* === Mobile Paperlogy Force Override === */
@font-face{
  font-family:"PaperlogyForce";
  src:local("Paperlogy"),
      local("Paperlogy-1Thin"),
      local("Paperlogy-2ExtraLight"),
      local("Paperlogy-3Light"),
      local("Paperlogy-4Regular"),
      local("Paperlogy-5Medium"),
      local("Paperlogy-6SemiBold"),
      local("Paperlogy-7Bold"),
      local("Paperlogy-8ExtraBold"),
      local("Paperlogy-9Black");
  font-display:swap;
}
:root{
  --paperlogy-font:
    "PaperlogyForce",
    "Paperlogy",
    "Paperlogy-4Regular",
    "Paperlogy-5Medium",
    "Paperlogy-6SemiBold",
    "Paperlogy-7Bold",
    "Pretendard",
    "Noto Sans KR",
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    sans-serif;
}
html,
body,
#root,
.app,
.app *,
button,
input,
select,
textarea,
pre,
code,
svg,
svg *,
svg text,
tspan{
  font-family:var(--paperlogy-font)!important;
}
body{
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  text-rendering:geometricPrecision;
}
@media(max-width:900px){
  html,
  body,
  #root,
  .app,
  .app *,
  .topbar,
  .topbar *,
  .nav,
  .nav *,
  .ticker,
  .ticker *,
  .panel,
  .panel *,
  .integrated-shell,
  .integrated-shell *,
  .integrated-onecol-card,
  .integrated-onecol-card *,
  .integrated-mobile-card,
  .integrated-mobile-card *,
  .chart-box,
  .chart-box *,
  .data-table,
  .data-table *,
  button,
  input,
  select,
  textarea,
  svg,
  svg *,
  svg text,
  tspan{
    font-family:var(--paperlogy-font)!important;
  }
  .integrated-onecol-name,
  .integrated-onecol-meta,
  .integrated-onecol-score,
  .integrated-onecol-judge,
  .integrated-onecol-judge *,
  .integrated-onecol-reason,
  .integrated-onecol-bar,
  .integrated-onecol-bar *,
  .creator-badge,
  .ticker-line1,
  .ticker-line2,
  .ticker-line3{
    font-family:var(--paperlogy-font)!important;
  }
}


/* === Integrated Mobile Realtime Card Layout v2 === */
@media(max-width:900px){
  .integrated-grid{
    display:block!important;
  }

  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    margin-top:14px!important;
    border:1px solid #1e3445!important;
    background:#08131d!important;
    overflow:visible!important;
  }

  .integrated-section-head{
    padding:14px 16px!important;
    min-height:52px;
  }

  .integrated-section-head b{
    color:#00d9ff!important;
    font-size:16px!important;
    line-height:1.35!important;
    word-break:keep-all;
  }

  .integrated-section-head .tag{
    min-width:54px;
    text-align:center;
    font-size:12px!important;
  }

  .integrated-scroll{
    max-height:none!important;
    overflow:visible!important;
  }

  .integrated-table,
  .integrated-mobile-card-list{
    display:none!important;
  }

  .integrated-onecol-list{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:12px!important;
    padding:14px!important;
  }

  .integrated-onecol-card{
    display:block!important;
    min-height:0!important;
    padding:18px 18px 16px!important;
    border:1px solid #263c4f!important;
    background:#0b1520!important;
    box-shadow:none!important;
  }

  .integrated-onecol-card.active{
    border-color:#00d9ff!important;
    box-shadow:0 0 0 1px rgba(0,217,255,.45) inset!important;
    background:#071d24!important;
  }

  .integrated-onecol-card.worst{
    border-color:#4a1f2a!important;
    background:#12080d!important;
  }

  .integrated-onecol-head{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) auto!important;
    gap:12px!important;
    align-items:start!important;
    border:0!important;
  }

  .integrated-onecol-rank{
    display:none!important;
  }

  .integrated-onecol-main{
    border:0!important;
    padding:0!important;
    min-width:0!important;
  }

  .integrated-onecol-name{
    font-size:21px!important;
    line-height:1.28!important;
    font-weight:900!important;
    color:#d9ecf5!important;
    letter-spacing:-.2px;
    word-break:keep-all;
  }

  .integrated-onecol-meta{
    margin-top:11px!important;
    color:#7f95a7!important;
    font-size:14px!important;
    line-height:1.65!important;
    word-break:keep-all;
  }

  .integrated-onecol-change{
    margin-top:8px!important;
    font-size:15px!important;
    line-height:1.4!important;
    font-weight:900!important;
  }

  .integrated-onecol-score{
    border:0!important;
    padding:0!important;
    min-width:62px;
    text-align:right!important;
    color:#ffd447!important;
    font-size:30px!important;
    line-height:1!important;
    font-weight:900!important;
    display:block!important;
  }

  .integrated-onecol-score small{
    display:block!important;
    margin-top:5px!important;
    color:#7f95a7!important;
    font-size:11px!important;
    font-weight:800!important;
  }

  .integrated-onecol-judge{
    display:block!important;
    grid-column:1 / -1;
    border:1px solid #1e3445;
    background:#071018;
    padding:10px 12px!important;
    margin-top:12px;
  }

  .integrated-onecol-judge-title{
    display:inline-block;
    color:#6f899a;
    font-size:11px!important;
    font-weight:900;
    margin-right:8px;
  }

  .integrated-onecol-judge-value{
    display:inline-block;
    color:#28ff91!important;
    font-size:15px!important;
    font-weight:900!important;
    line-height:1.35!important;
  }

  .integrated-onecol-card.worst .integrated-onecol-judge-value{
    color:#ff6680!important;
  }

  .integrated-onecol-judge-meta{
    margin-top:5px!important;
    color:#8da2b3!important;
    font-size:12px!important;
    line-height:1.5!important;
  }

  .integrated-onecol-body{
    margin-top:14px!important;
    padding:0!important;
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:12px!important;
  }

  .integrated-onecol-badges{
    display:flex!important;
    gap:6px!important;
    flex-wrap:wrap!important;
  }

  .integrated-onecol-badges span{
    border:1px solid #1e3445!important;
    background:#071018!important;
    color:#8fb2c7!important;
    font-size:12px!important;
    line-height:1.3;
    padding:5px 8px!important;
  }

  .integrated-onecol-bars{
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:8px!important;
  }

  .integrated-onecol-bar small{
    display:block!important;
    color:#7f95a7!important;
    font-size:12px!important;
    margin-bottom:5px!important;
    white-space:nowrap;
  }

  .integrated-onecol-track{
    height:7px!important;
    border:1px solid #20394b!important;
    background:#071018!important;
  }

  .integrated-onecol-track div{
    background:#00d9ff!important;
  }

  .integrated-onecol-reason{
    margin-top:0!important;
    border:1px solid #20394b!important;
    border-left:0!important;
    background:#071018!important;
    padding:11px 12px!important;
    color:#9fb4c5!important;
    font-size:13px!important;
    line-height:1.65!important;
    max-height:none!important;
    white-space:normal!important;
    word-break:keep-all!important;
  }

  .integrated-onecol-reason::before{
    content:"추천근거 ";
    color:#00d9ff;
    font-weight:900;
  }

  .integrated-onecol-card.worst .integrated-onecol-reason::before{
    content:"위험요인 ";
    color:#ff6680;
  }
}

@media(max-width:430px){
  .integrated-onecol-list{
    padding:12px!important;
    gap:11px!important;
  }

  .integrated-onecol-card{
    padding:16px 16px 14px!important;
  }

  .integrated-onecol-name{
    font-size:19px!important;
  }

  .integrated-onecol-meta{
    font-size:13px!important;
  }

  .integrated-onecol-change{
    font-size:14px!important;
  }

  .integrated-onecol-score{
    font-size:27px!important;
    min-width:56px;
  }

  .integrated-onecol-bars{
    gap:6px!important;
  }

  .integrated-onecol-bar small{
    font-size:11px!important;
  }

  .integrated-onecol-reason{
    font-size:12px!important;
  }
}


/* === Integrated Analysis Device Split: Desktop/Tablet Table, Phone Cards === */
@media(min-width:901px){
  .integrated-grid{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    gap:14px!important;
  }
  .integrated-scroll{
    max-height:650px!important;
    overflow:auto!important;
  }
  .integrated-onecol-list,
  .integrated-mobile-card-list{
    display:none!important;
  }
  .integrated-desktop-table{
    display:table!important;
    width:100%!important;
    border-collapse:collapse!important;
  }
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    display:table-cell!important;
  }
  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    overflow:hidden!important;
  }
}
@media(max-width:700px){
  .integrated-desktop-table{
    display:none!important;
  }
  .integrated-onecol-list{
    display:grid!important;
  }
}


/* === Integrated Analysis Mobile Simplify + PC Font Visibility === */

/* PC/Tablet: thin Paperlogy text readability boost */
@media(min-width:901px){
  body,
  .app,
  .app *,
  .panel,
  .panel *,
  .ticker,
  .ticker *,
  .data-table,
  .data-table *,
  .integrated-table,
  .integrated-table *,
  .integrated-desktop-table,
  .integrated-desktop-table *,
  .fullscan-table,
  .fullscan-table *,
  .sectormind-pick-table,
  .sectormind-pick-table *{
    font-weight:600;
    -webkit-font-smoothing:antialiased;
    text-rendering:geometricPrecision;
  }

  .panel-title,
  .panel-title *,
  .card-title,
  .btn,
  button,
  th,
  .rank,
  .ticker-line1,
  .integrated-score,
  .integrated-wost-score,
  .fullscan-score,
  .pick-score,
  .ai-score,
  .score-box strong,
  .value{
    font-weight:800!important;
  }

  .sub,
  .footer-note,
  .pick-tags,
  .integrated-pill,
  .integrated-us-tag,
  .integrated-risk-tag{
    font-weight:600!important;
    color:#8fa5b8;
  }

  .integrated-table td,
  .integrated-table th,
  .integrated-desktop-table td,
  .integrated-desktop-table th{
    font-size:12.5px;
    line-height:1.55;
  }
}

/* Phone only: simplify integrated analysis cards */
@media(max-width:900px){
  .integrated-onecol-list{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:10px!important;
    padding:12px!important;
  }

  .integrated-onecol-card{
    padding:16px!important;
    border:1px solid #263c4f!important;
    background:#0b1520!important;
    min-height:0!important;
  }

  .integrated-onecol-card.active{
    border-color:#00d9ff!important;
    background:#071d24!important;
    box-shadow:0 0 0 1px rgba(0,217,255,.35) inset!important;
  }

  .integrated-onecol-card.worst{
    border-color:#4a1f2a!important;
    background:#12080d!important;
  }

  .integrated-onecol-head{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) 64px!important;
    gap:12px!important;
    align-items:start!important;
    border:0!important;
  }

  /* Hide unnecessary mobile info: rank, market labels, separate judge box, badges */
  .integrated-onecol-rank,
  .integrated-onecol-judge,
  .integrated-onecol-badges{
    display:none!important;
  }

  .integrated-onecol-main{
    padding:0!important;
    border:0!important;
    min-width:0!important;
  }

  .integrated-onecol-name{
    font-size:20px!important;
    line-height:1.28!important;
    color:#d9ecf5!important;
    font-weight:900!important;
    letter-spacing:-.2px;
    word-break:keep-all;
  }

  .integrated-onecol-meta{
    margin-top:9px!important;
    color:#7f95a7!important;
    font-size:13px!important;
    line-height:1.55!important;
  }

  .integrated-onecol-meta .mobile-hide-market,
  .mobile-hide-market{
    display:none!important;
  }

  .integrated-onecol-change{
    margin-top:7px!important;
    font-size:14px!important;
    line-height:1.35!important;
    font-weight:900!important;
  }

  .integrated-onecol-score{
    display:block!important;
    text-align:right!important;
    color:#ffd447!important;
    font-size:27px!important;
    line-height:1!important;
    font-weight:900!important;
    border:0!important;
    padding:0!important;
    min-width:56px!important;
  }

  .integrated-onecol-score small{
    display:block!important;
    margin-top:5px!important;
    font-size:10px!important;
    color:#7f95a7!important;
    font-weight:800!important;
  }

  .integrated-onecol-body{
    margin-top:12px!important;
    padding:0!important;
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:11px!important;
  }

  .integrated-onecol-bars{
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:7px!important;
  }

  .integrated-onecol-bar small{
    display:block!important;
    color:#7f95a7!important;
    font-size:11px!important;
    margin-bottom:4px!important;
    white-space:nowrap;
  }

  .integrated-onecol-track{
    height:6px!important;
    border:1px solid #20394b!important;
    background:#071018!important;
  }

  .integrated-onecol-track div{
    background:#00d9ff!important;
  }

  /* Recommendation reason goes to the bottom, full-width */
  .integrated-onecol-reason{
    display:block!important;
    width:100%!important;
    margin-top:2px!important;
    border:1px solid #20394b!important;
    border-left:0!important;
    background:#071018!important;
    padding:10px 11px!important;
    color:#9fb4c5!important;
    font-size:12px!important;
    line-height:1.62!important;
    white-space:normal!important;
    word-break:keep-all!important;
    max-height:none!important;
  }

  .integrated-onecol-reason::before{
    content:"추천근거 ";
    color:#00d9ff;
    font-weight:900;
  }

  .integrated-onecol-card.worst .integrated-onecol-reason::before{
    content:"위험요인 ";
    color:#ff6680;
  }

  .integrated-section-head b{
    font-weight:900!important;
  }
}

@media(max-width:420px){
  .integrated-onecol-card{
    padding:14px!important;
  }
  .integrated-onecol-head{
    grid-template-columns:minmax(0,1fr) 54px!important;
    gap:10px!important;
  }
  .integrated-onecol-name{
    font-size:18px!important;
  }
  .integrated-onecol-meta{
    font-size:12px!important;
  }
  .integrated-onecol-score{
    font-size:25px!important;
    min-width:52px!important;
  }
  .integrated-onecol-bars{
    gap:5px!important;
  }
  .integrated-onecol-bar small{
    font-size:10px!important;
  }
  .integrated-onecol-reason{
    font-size:11px!important;
  }
}


/* === Integrated Mobile Table-Like Layout: reason bottom only === */
@media(max-width:900px){
  .integrated-onecol-list{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:9px!important;
    padding:10px!important;
  }

  .integrated-onecol-card{
    padding:0!important;
    min-height:0!important;
    border:1px solid #263c4f!important;
    background:#08131d!important;
    overflow:hidden!important;
  }

  .integrated-onecol-card.active{
    border-color:#00d9ff!important;
    box-shadow:0 0 0 1px rgba(0,217,255,.32) inset!important;
    background:#071d24!important;
  }

  .integrated-onecol-card.worst{
    border-color:#4a1f2a!important;
    background:#12080d!important;
  }

  /* PC/tablet table concept compressed into a mobile card */
  .integrated-onecol-head{
    display:grid!important;
    grid-template-columns:minmax(118px,1.35fr) 52px minmax(96px,1fr)!important;
    gap:0!important;
    align-items:stretch!important;
    border-bottom:1px solid #263c4f!important;
  }

  .integrated-onecol-rank{
    display:none!important;
  }

  .integrated-onecol-main{
    padding:9px 10px!important;
    border-right:1px solid #263c4f!important;
    min-width:0!important;
  }

  .integrated-onecol-name{
    font-size:13px!important;
    line-height:1.3!important;
    font-weight:900!important;
    color:#d9ecf5!important;
    word-break:keep-all!important;
  }

  .integrated-onecol-meta{
    margin-top:4px!important;
    font-size:10.5px!important;
    line-height:1.45!important;
    color:#7f95a7!important;
    word-break:keep-all!important;
  }

  .integrated-onecol-change{
    margin-top:4px!important;
    font-size:11px!important;
    line-height:1.25!important;
    font-weight:900!important;
  }

  .integrated-onecol-score{
    display:flex!important;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    border-right:1px solid #263c4f!important;
    padding:6px 4px!important;
    min-width:0!important;
    text-align:center!important;
    color:#ffd447!important;
    font-size:22px!important;
    line-height:1!important;
    font-weight:900!important;
  }

  .integrated-onecol-score small{
    display:block!important;
    margin-top:5px!important;
    color:#7f95a7!important;
    font-size:9px!important;
    font-weight:800!important;
  }

  .integrated-onecol-judge{
    display:block!important;
    grid-column:auto!important;
    margin:0!important;
    border:0!important;
    background:transparent!important;
    padding:8px 9px!important;
    min-width:0!important;
  }

  .integrated-onecol-judge-title{
    display:block!important;
    color:#6f899a!important;
    font-size:10px!important;
    line-height:1.2!important;
    font-weight:800!important;
    margin:0 0 3px 0!important;
  }

  .integrated-onecol-judge-value{
    display:block!important;
    color:#28ff91!important;
    font-size:12px!important;
    line-height:1.3!important;
    font-weight:900!important;
  }

  .integrated-onecol-card.worst .integrated-onecol-judge-value{
    color:#ff6680!important;
  }

  .integrated-onecol-judge-meta{
    display:block!important;
    margin-top:4px!important;
    color:#8da2b3!important;
    font-size:10px!important;
    line-height:1.45!important;
  }

  .integrated-onecol-badges{
    display:none!important;
  }

  .integrated-onecol-body{
    margin:0!important;
    padding:8px 10px 10px!important;
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:8px!important;
  }

  .integrated-onecol-bars{
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:6px!important;
  }

  .integrated-onecol-bar small{
    display:block!important;
    color:#7f95a7!important;
    font-size:10px!important;
    margin-bottom:3px!important;
    white-space:nowrap!important;
  }

  .integrated-onecol-track{
    height:5px!important;
    border:1px solid #20394b!important;
    background:#071018!important;
    overflow:hidden!important;
  }

  .integrated-onecol-track div{
    height:100%!important;
    background:#00d9ff!important;
  }

  /* only recommendation reason moves to full-width bottom */
  .integrated-onecol-reason{
    display:block!important;
    width:100%!important;
    box-sizing:border-box!important;
    margin:0!important;
    border:1px solid #20394b!important;
    border-left:0!important;
    background:#071018!important;
    padding:8px 9px!important;
    color:#9fb4c5!important;
    font-size:11px!important;
    line-height:1.55!important;
    white-space:normal!important;
    word-break:keep-all!important;
    max-height:none!important;
  }

  .integrated-onecol-reason::before{
    content:"추천근거 ";
    color:#00d9ff;
    font-weight:900;
  }

  .integrated-onecol-card.worst .integrated-onecol-reason::before{
    content:"위험요인 ";
    color:#ff6680;
  }

  .mobile-hide-market{
    display:none!important;
  }
}

@media(max-width:390px){
  .integrated-onecol-head{
    grid-template-columns:minmax(104px,1.25fr) 46px minmax(82px,1fr)!important;
  }
  .integrated-onecol-main{
    padding:8px 8px!important;
  }
  .integrated-onecol-name{
    font-size:12px!important;
  }
  .integrated-onecol-meta,
  .integrated-onecol-change{
    font-size:9.6px!important;
  }
  .integrated-onecol-score{
    font-size:20px!important;
  }
  .integrated-onecol-judge{
    padding:7px 7px!important;
  }
  .integrated-onecol-judge-title{
    font-size:9px!important;
  }
  .integrated-onecol-judge-value{
    font-size:11px!important;
  }
  .integrated-onecol-judge-meta{
    font-size:9.2px!important;
  }
  .integrated-onecol-bars{
    gap:4px!important;
  }
  .integrated-onecol-bar small{
    font-size:9px!important;
  }
  .integrated-onecol-reason{
    font-size:10px!important;
  }
}


/* === Phone Integrated Compact v3: remove rank/market, reason bottom === */
/* iPhone/Safari can report a wider CSS viewport, so combine width + device-width rules. */
@media(max-width:700px), (max-device-width:480px){
  .integrated-onecol-list{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:10px!important;
    padding:10px!important;
  }

  .integrated-onecol-card{
    padding:0!important;
    min-height:0!important;
    border:1px solid #263c4f!important;
    background:#08131d!important;
    overflow:hidden!important;
  }

  .integrated-onecol-card.active{
    border-color:#00d9ff!important;
    box-shadow:0 0 0 1px rgba(0,217,255,.34) inset!important;
    background:#071d24!important;
  }

  .integrated-onecol-card.worst{
    border-color:#4a1f2a!important;
    background:#12080d!important;
  }

  /* Top row: 종목정보 | 통합점수 | 판정 */
  .integrated-onecol-head{
    display:grid!important;
    grid-template-columns:minmax(132px,1.38fr) 54px minmax(86px,.95fr)!important;
    gap:0!important;
    align-items:stretch!important;
    border-bottom:1px solid #263c4f!important;
  }

  /* remove rank column on phone */
  .integrated-onecol-rank{
    display:none!important;
    width:0!important;
    min-width:0!important;
    padding:0!important;
    margin:0!important;
    border:0!important;
  }

  .integrated-onecol-main{
    padding:9px 10px!important;
    border-right:1px solid #263c4f!important;
    min-width:0!important;
  }

  .integrated-onecol-name{
    font-size:13px!important;
    line-height:1.32!important;
    font-weight:900!important;
    color:#d9ecf5!important;
    word-break:keep-all!important;
  }

  .integrated-onecol-meta{
    margin-top:4px!important;
    font-size:10.5px!important;
    line-height:1.42!important;
    color:#7f95a7!important;
    word-break:keep-all!important;
  }

  /* hide market label such as KOSPI200/KOSDAQ200/NASDAQ100 on phone */
  .integrated-onecol-meta .mobile-hide-market,
  .integrated-onecol-market,
  .mobile-hide-market{
    display:none!important;
  }

  .integrated-onecol-change{
    margin-top:4px!important;
    font-size:11px!important;
    line-height:1.25!important;
    font-weight:900!important;
  }

  .integrated-onecol-score{
    display:flex!important;
    flex-direction:column!important;
    justify-content:center!important;
    align-items:center!important;
    border-right:1px solid #263c4f!important;
    padding:6px 4px!important;
    min-width:0!important;
    text-align:center!important;
    color:#ffd447!important;
    font-size:22px!important;
    line-height:1!important;
    font-weight:900!important;
  }

  .integrated-onecol-score small{
    display:block!important;
    margin-top:5px!important;
    color:#7f95a7!important;
    font-size:9px!important;
    font-weight:800!important;
  }

  .integrated-onecol-judge{
    display:block!important;
    grid-column:auto!important;
    margin:0!important;
    border:0!important;
    background:transparent!important;
    padding:8px 8px!important;
    min-width:0!important;
  }

  .integrated-onecol-judge-title{
    display:block!important;
    color:#6f899a!important;
    font-size:10px!important;
    line-height:1.2!important;
    font-weight:800!important;
    margin:0 0 3px 0!important;
  }

  .integrated-onecol-judge-value{
    display:block!important;
    color:#28ff91!important;
    font-size:12px!important;
    line-height:1.3!important;
    font-weight:900!important;
  }

  .integrated-onecol-card.worst .integrated-onecol-judge-value{
    color:#ff6680!important;
  }

  .integrated-onecol-judge-meta{
    display:block!important;
    margin-top:4px!important;
    color:#8da2b3!important;
    font-size:10px!important;
    line-height:1.45!important;
  }

  .integrated-onecol-badges{
    display:none!important;
  }

  .integrated-onecol-body{
    margin:0!important;
    padding:8px 10px 10px!important;
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:8px!important;
  }

  .integrated-onecol-bars{
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:6px!important;
  }

  .integrated-onecol-bar small{
    display:block!important;
    color:#7f95a7!important;
    font-size:10px!important;
    margin-bottom:3px!important;
    white-space:nowrap!important;
  }

  .integrated-onecol-track{
    height:5px!important;
    border:1px solid #20394b!important;
    background:#071018!important;
    overflow:hidden!important;
  }

  .integrated-onecol-track div{
    height:100%!important;
    background:#00d9ff!important;
  }

  /* recommendation reason only at bottom, full-width */
  .integrated-onecol-reason{
    display:block!important;
    width:100%!important;
    box-sizing:border-box!important;
    margin:0!important;
    border:1px solid #20394b!important;
    border-left:0!important;
    background:#071018!important;
    padding:8px 9px!important;
    color:#9fb4c5!important;
    font-size:11px!important;
    line-height:1.55!important;
    white-space:normal!important;
    word-break:keep-all!important;
    max-height:none!important;
  }

  .integrated-onecol-reason::before{
    content:"추천근거 ";
    color:#00d9ff;
    font-weight:900;
  }

  .integrated-onecol-card.worst .integrated-onecol-reason::before{
    content:"위험요인 ";
    color:#ff6680;
  }
}

@media(max-width:390px), (max-device-width:390px){
  .integrated-onecol-head{
    grid-template-columns:minmax(112px,1.3fr) 48px minmax(78px,.9fr)!important;
  }
  .integrated-onecol-main{
    padding:8px 8px!important;
  }
  .integrated-onecol-name{
    font-size:12px!important;
  }
  .integrated-onecol-meta,
  .integrated-onecol-change{
    font-size:9.6px!important;
  }
  .integrated-onecol-score{
    font-size:20px!important;
  }
  .integrated-onecol-judge{
    padding:7px 7px!important;
  }
  .integrated-onecol-judge-title{
    font-size:9px!important;
  }
  .integrated-onecol-judge-value{
    font-size:11px!important;
  }
  .integrated-onecol-judge-meta{
    font-size:9.2px!important;
  }
  .integrated-onecol-bars{
    gap:4px!important;
  }
  .integrated-onecol-bar small{
    font-size:9px!important;
  }
  .integrated-onecol-reason{
    font-size:10px!important;
  }
}


/* === Tablet follows PC layout / Phone only mobile cards === */
/* Tablet and PC: force the original table layout even if older max-width:900 rules exist. */
@media(min-width:701px){
  .integrated-grid{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    gap:14px!important;
  }

  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    overflow:hidden!important;
    background:#08131d!important;
  }

  .integrated-scroll{
    max-height:650px!important;
    overflow:auto!important;
  }

  .integrated-onecol-list,
  .integrated-mobile-card-list{
    display:none!important;
  }

  .integrated-table,
  .integrated-desktop-table{
    display:table!important;
    width:100%!important;
    border-collapse:collapse!important;
  }

  .integrated-table thead,
  .integrated-table tbody,
  .integrated-desktop-table thead,
  .integrated-desktop-table tbody{
    display:table-header-group;
  }

  .integrated-table tbody,
  .integrated-desktop-table tbody{
    display:table-row-group;
  }

  .integrated-table tr,
  .integrated-desktop-table tr{
    display:table-row!important;
  }

  .integrated-table th,
  .integrated-table td,
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    display:table-cell!important;
    font-size:12.5px;
    line-height:1.55;
  }

  .integrated-section-head{
    padding:12px 14px!important;
    min-height:auto!important;
  }

  .integrated-section-head b{
    font-size:14px!important;
  }

  .creator-mark,
  .creator-badge{
    display:flex!important;
  }
}

/* Phone only: mobile compact card mode. Tablet is excluded. */
@media(max-width:700px){
  .integrated-desktop-table{
    display:none!important;
  }

  .integrated-onecol-list{
    display:grid!important;
  }
}


/* === Tablet Font Fit Optimization === */
/* Tablet keeps PC/table layout, but uses smaller table fonts and tighter spacing. */
@media(min-width:701px) and (max-width:1180px){
  .integrated-grid{
    grid-template-columns:1fr 1fr!important;
    gap:10px!important;
  }

  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    min-width:0!important;
  }

  .integrated-section-head{
    padding:9px 10px!important;
    min-height:40px!important;
  }

  .integrated-section-head b{
    font-size:12px!important;
    line-height:1.25!important;
    letter-spacing:-.2px!important;
  }

  .integrated-section-head .tag{
    font-size:10px!important;
    padding:2px 6px!important;
    min-width:38px!important;
  }

  .integrated-scroll{
    max-height:560px!important;
    overflow:auto!important;
  }

  .integrated-table,
  .integrated-desktop-table{
    table-layout:fixed!important;
    width:100%!important;
    font-size:10px!important;
  }

  .integrated-table th,
  .integrated-table td,
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    padding:5px 4px!important;
    font-size:10px!important;
    line-height:1.32!important;
    word-break:keep-all!important;
    vertical-align:top!important;
  }

  .integrated-table th,
  .integrated-desktop-table th{
    font-size:9.5px!important;
    font-weight:800!important;
  }

  .integrated-table td:nth-child(1),
  .integrated-desktop-table td:nth-child(1),
  .integrated-table th:nth-child(1),
  .integrated-desktop-table th:nth-child(1){
    width:30px!important;
  }

  .integrated-table td:nth-child(2),
  .integrated-desktop-table td:nth-child(2),
  .integrated-table th:nth-child(2),
  .integrated-desktop-table th:nth-child(2){
    width:112px!important;
  }

  .integrated-table td:nth-child(3),
  .integrated-desktop-table td:nth-child(3),
  .integrated-table th:nth-child(3),
  .integrated-desktop-table th:nth-child(3){
    width:54px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(4),
  .integrated-desktop-table td:nth-child(4),
  .integrated-table th:nth-child(4),
  .integrated-desktop-table th:nth-child(4){
    width:160px!important;
  }

  .integrated-table td:nth-child(5),
  .integrated-desktop-table td:nth-child(5),
  .integrated-table th:nth-child(5),
  .integrated-desktop-table th:nth-child(5){
    width:70px!important;
  }

  .integrated-table td:nth-child(6),
  .integrated-desktop-table td:nth-child(6),
  .integrated-table th:nth-child(6),
  .integrated-desktop-table th:nth-child(6){
    width:auto!important;
  }

  .integrated-score{
    font-size:18px!important;
    line-height:1!important;
  }

  .integrated-wost-score{
    font-size:16px!important;
    line-height:1!important;
  }

  .integrated-breakdown{
    min-width:0!important;
    grid-template-columns:repeat(5,1fr)!important;
    gap:3px!important;
  }

  .integrated-breakdown small{
    font-size:8.5px!important;
    line-height:1.15!important;
    white-space:nowrap!important;
  }

  .integrated-mini-meter{
    height:4px!important;
    margin-top:2px!important;
  }

  .integrated-pill,
  .integrated-us-tag,
  .integrated-risk-tag{
    font-size:8.5px!important;
    line-height:1.2!important;
    padding:2px 4px!important;
    margin:1px 2px 1px 0!important;
  }

  .pick-tags{
    font-size:9px!important;
    line-height:1.35!important;
  }

  .integrated-table .sub,
  .integrated-desktop-table .sub{
    font-size:9px!important;
    line-height:1.35!important;
  }

  .rank{
    font-size:10px!important;
  }
}

/* Narrow tablet / iPad portrait: fit columns more aggressively */
@media(min-width:701px) and (max-width:900px){
  .integrated-grid{
    grid-template-columns:1fr!important;
  }

  .integrated-scroll{
    max-height:520px!important;
  }

  .integrated-table th,
  .integrated-table td,
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    font-size:9.5px!important;
    padding:5px 4px!important;
  }

  .integrated-table th,
  .integrated-desktop-table th{
    font-size:9px!important;
  }

  .integrated-score{
    font-size:17px!important;
  }

  .integrated-table td:nth-child(2),
  .integrated-desktop-table td:nth-child(2),
  .integrated-table th:nth-child(2),
  .integrated-desktop-table th:nth-child(2){
    width:105px!important;
  }

  .integrated-table td:nth-child(4),
  .integrated-desktop-table td:nth-child(4),
  .integrated-table th:nth-child(4),
  .integrated-desktop-table th:nth-child(4){
    width:145px!important;
  }
}


/* === iPad Pro 11 Optimization === */
/*
  iPad Pro 11 common CSS viewport
  Portrait : 834 x 1194
  Landscape: 1194 x 834
  Rule:
  - Phone <= 700px: mobile card layout
  - iPad Pro 11 portrait/landscape: PC-like table layout with fitted font/columns
*/

/* iPad Pro 11 portrait and nearby tablets */
@media(min-width:701px) and (max-width:900px){
  .integrated-grid{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:12px!important;
  }

  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
  }

  .integrated-scroll{
    max-height:610px!important;
    overflow:auto!important;
  }

  .integrated-onecol-list,
  .integrated-mobile-card-list{
    display:none!important;
  }

  .integrated-table,
  .integrated-desktop-table{
    display:table!important;
    table-layout:fixed!important;
    width:100%!important;
    border-collapse:collapse!important;
  }

  .integrated-table thead,
  .integrated-desktop-table thead{
    display:table-header-group!important;
  }

  .integrated-table tbody,
  .integrated-desktop-table tbody{
    display:table-row-group!important;
  }

  .integrated-table tr,
  .integrated-desktop-table tr{
    display:table-row!important;
  }

  .integrated-table th,
  .integrated-table td,
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    display:table-cell!important;
    padding:6px 5px!important;
    font-size:10.2px!important;
    line-height:1.38!important;
    vertical-align:top!important;
    word-break:keep-all!important;
  }

  .integrated-table th,
  .integrated-desktop-table th{
    font-size:9.5px!important;
    font-weight:900!important;
    color:#8aa0b1!important;
  }

  .integrated-section-head{
    padding:10px 12px!important;
    min-height:42px!important;
  }

  .integrated-section-head b{
    font-size:13px!important;
    line-height:1.3!important;
    font-weight:900!important;
  }

  .integrated-section-head .tag{
    font-size:10px!important;
    padding:2px 6px!important;
    min-width:40px!important;
  }

  .integrated-table td:nth-child(1),
  .integrated-desktop-table td:nth-child(1),
  .integrated-table th:nth-child(1),
  .integrated-desktop-table th:nth-child(1){
    width:34px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(2),
  .integrated-desktop-table td:nth-child(2),
  .integrated-table th:nth-child(2),
  .integrated-desktop-table th:nth-child(2){
    width:136px!important;
  }

  .integrated-table td:nth-child(3),
  .integrated-desktop-table td:nth-child(3),
  .integrated-table th:nth-child(3),
  .integrated-desktop-table th:nth-child(3){
    width:58px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(4),
  .integrated-desktop-table td:nth-child(4),
  .integrated-table th:nth-child(4),
  .integrated-desktop-table th:nth-child(4){
    width:185px!important;
  }

  .integrated-table td:nth-child(5),
  .integrated-desktop-table td:nth-child(5),
  .integrated-table th:nth-child(5),
  .integrated-desktop-table th:nth-child(5){
    width:82px!important;
  }

  .integrated-table td:nth-child(6),
  .integrated-desktop-table td:nth-child(6),
  .integrated-table th:nth-child(6),
  .integrated-desktop-table th:nth-child(6){
    width:auto!important;
  }

  .integrated-score{
    font-size:19px!important;
    line-height:1!important;
  }

  .integrated-wost-score{
    font-size:17px!important;
    line-height:1!important;
  }

  .integrated-breakdown{
    min-width:0!important;
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:4px!important;
  }

  .integrated-breakdown small{
    font-size:8.8px!important;
    line-height:1.15!important;
    white-space:nowrap!important;
  }

  .integrated-mini-meter{
    height:4px!important;
    margin-top:2px!important;
  }

  .integrated-pill,
  .integrated-us-tag,
  .integrated-risk-tag{
    font-size:8.8px!important;
    line-height:1.2!important;
    padding:2px 5px!important;
    margin:1px 2px 2px 0!important;
  }

  .pick-tags{
    font-size:9.4px!important;
    line-height:1.38!important;
  }

  .integrated-table .sub,
  .integrated-desktop-table .sub{
    font-size:9.2px!important;
    line-height:1.36!important;
  }

  .rank{
    font-size:10px!important;
    font-weight:900!important;
  }
}

/* iPad Pro 11 landscape and small desktop width */
@media(min-width:901px) and (max-width:1240px){
  .integrated-grid{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    gap:12px!important;
  }

  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    min-width:0!important;
    overflow:hidden!important;
  }

  .integrated-scroll{
    max-height:640px!important;
    overflow:auto!important;
  }

  .integrated-onecol-list,
  .integrated-mobile-card-list{
    display:none!important;
  }

  .integrated-table,
  .integrated-desktop-table{
    display:table!important;
    table-layout:fixed!important;
    width:100%!important;
    border-collapse:collapse!important;
  }

  .integrated-table th,
  .integrated-table td,
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    display:table-cell!important;
    padding:6px 5px!important;
    font-size:10.6px!important;
    line-height:1.4!important;
    vertical-align:top!important;
    word-break:keep-all!important;
  }

  .integrated-table th,
  .integrated-desktop-table th{
    font-size:9.8px!important;
    font-weight:900!important;
  }

  .integrated-section-head{
    padding:10px 12px!important;
  }

  .integrated-section-head b{
    font-size:13px!important;
    font-weight:900!important;
  }

  .integrated-table td:nth-child(1),
  .integrated-desktop-table td:nth-child(1),
  .integrated-table th:nth-child(1),
  .integrated-desktop-table th:nth-child(1){
    width:30px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(2),
  .integrated-desktop-table td:nth-child(2),
  .integrated-table th:nth-child(2),
  .integrated-desktop-table th:nth-child(2){
    width:120px!important;
  }

  .integrated-table td:nth-child(3),
  .integrated-desktop-table td:nth-child(3),
  .integrated-table th:nth-child(3),
  .integrated-desktop-table th:nth-child(3){
    width:54px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(4),
  .integrated-desktop-table td:nth-child(4),
  .integrated-table th:nth-child(4),
  .integrated-desktop-table th:nth-child(4){
    width:158px!important;
  }

  .integrated-table td:nth-child(5),
  .integrated-desktop-table td:nth-child(5),
  .integrated-table th:nth-child(5),
  .integrated-desktop-table th:nth-child(5){
    width:74px!important;
  }

  .integrated-score{
    font-size:18px!important;
  }

  .integrated-breakdown{
    min-width:0!important;
    gap:3px!important;
  }

  .integrated-breakdown small{
    font-size:8.5px!important;
    white-space:nowrap!important;
  }

  .integrated-mini-meter{
    height:4px!important;
  }

  .integrated-pill,
  .integrated-us-tag,
  .integrated-risk-tag{
    font-size:8.5px!important;
    padding:2px 4px!important;
    margin:1px 2px 1px 0!important;
  }

  .pick-tags,
  .integrated-table .sub,
  .integrated-desktop-table .sub{
    font-size:9px!important;
    line-height:1.35!important;
  }
}

/* Phone must remain card layout */
@media(max-width:700px){
  .integrated-desktop-table,
  .integrated-table{
    display:none!important;
  }

  .integrated-onecol-list{
    display:grid!important;
  }
}


/* === iPad Pro 11 Market Placement: KOSPI top, KOSDAQ + NASDAQ bottom === */
/* Base market layout for integrated analysis */
.integrated-market-layout{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}
.integrated-kospi-section{grid-column:auto}
.integrated-kosdaq-section{grid-column:auto}
.integrated-nasdaq-section-wrap{grid-column:1 / -1}

/* PC keeps broad table style: KOSPI/KOSDAQ first row, NASDAQ full row */
@media(min-width:1241px){
  .integrated-market-layout{
    grid-template-columns:1fr 1fr!important;
    gap:14px!important;
  }
  .integrated-kospi-section{grid-column:1!important}
  .integrated-kosdaq-section{grid-column:2!important}
  .integrated-nasdaq-section-wrap{grid-column:1 / -1!important}
}

/* iPad Pro 11 portrait: KOSPI full top, KOSDAQ + NASDAQ bottom two columns */
@media(min-width:701px) and (max-width:900px){
  .integrated-market-layout{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    grid-template-areas:
      "kospi kospi"
      "kosdaq nasdaq"!important;
    gap:10px!important;
  }

  .integrated-kospi-section{grid-area:kospi!important}
  .integrated-kosdaq-section{grid-area:kosdaq!important; min-width:0!important}
  .integrated-nasdaq-section-wrap{grid-area:nasdaq!important; min-width:0!important}

  .integrated-kosdaq-section .integrated-scroll,
  .integrated-nasdaq-section-wrap .integrated-scroll{
    max-height:520px!important;
  }

  .integrated-kosdaq-section .integrated-table th,
  .integrated-kosdaq-section .integrated-table td,
  .integrated-kosdaq-section .integrated-desktop-table th,
  .integrated-kosdaq-section .integrated-desktop-table td,
  .integrated-nasdaq-section-wrap .integrated-table th,
  .integrated-nasdaq-section-wrap .integrated-table td,
  .integrated-nasdaq-section-wrap .integrated-desktop-table th,
  .integrated-nasdaq-section-wrap .integrated-desktop-table td{
    font-size:8.8px!important;
    padding:4px 3px!important;
    line-height:1.28!important;
  }

  .integrated-kosdaq-section .integrated-table th,
  .integrated-kosdaq-section .integrated-desktop-table th,
  .integrated-nasdaq-section-wrap .integrated-table th,
  .integrated-nasdaq-section-wrap .integrated-desktop-table th{
    font-size:8.2px!important;
  }

  .integrated-kosdaq-section .integrated-score,
  .integrated-nasdaq-section-wrap .integrated-score{
    font-size:15px!important;
  }

  .integrated-kosdaq-section .integrated-breakdown,
  .integrated-nasdaq-section-wrap .integrated-breakdown{
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:2px!important;
  }

  .integrated-kosdaq-section .integrated-breakdown small,
  .integrated-nasdaq-section-wrap .integrated-breakdown small{
    font-size:7.2px!important;
  }

  .integrated-kosdaq-section .integrated-mini-meter,
  .integrated-nasdaq-section-wrap .integrated-mini-meter{
    height:3px!important;
  }

  .integrated-kosdaq-section .integrated-pill,
  .integrated-kosdaq-section .integrated-us-tag,
  .integrated-nasdaq-section-wrap .integrated-pill,
  .integrated-nasdaq-section-wrap .integrated-us-tag{
    font-size:7.2px!important;
    padding:1px 3px!important;
    margin:1px!important;
  }

  .integrated-kosdaq-section .pick-tags,
  .integrated-nasdaq-section-wrap .pick-tags,
  .integrated-kosdaq-section .sub,
  .integrated-nasdaq-section-wrap .sub{
    font-size:7.8px!important;
    line-height:1.25!important;
  }

  .integrated-kosdaq-section .integrated-table td:nth-child(1),
  .integrated-kosdaq-section .integrated-desktop-table td:nth-child(1),
  .integrated-nasdaq-section-wrap .integrated-table td:nth-child(1),
  .integrated-nasdaq-section-wrap .integrated-desktop-table td:nth-child(1){
    width:24px!important;
  }
  .integrated-kosdaq-section .integrated-table td:nth-child(2),
  .integrated-kosdaq-section .integrated-desktop-table td:nth-child(2),
  .integrated-nasdaq-section-wrap .integrated-table td:nth-child(2),
  .integrated-nasdaq-section-wrap .integrated-desktop-table td:nth-child(2){
    width:78px!important;
  }
  .integrated-kosdaq-section .integrated-table td:nth-child(3),
  .integrated-kosdaq-section .integrated-desktop-table td:nth-child(3),
  .integrated-nasdaq-section-wrap .integrated-table td:nth-child(3),
  .integrated-nasdaq-section-wrap .integrated-desktop-table td:nth-child(3){
    width:38px!important;
  }
  .integrated-kosdaq-section .integrated-table td:nth-child(4),
  .integrated-kosdaq-section .integrated-desktop-table td:nth-child(4),
  .integrated-nasdaq-section-wrap .integrated-table td:nth-child(4),
  .integrated-nasdaq-section-wrap .integrated-desktop-table td:nth-child(4){
    width:96px!important;
  }
  .integrated-kosdaq-section .integrated-table td:nth-child(5),
  .integrated-kosdaq-section .integrated-desktop-table td:nth-child(5),
  .integrated-nasdaq-section-wrap .integrated-table td:nth-child(5),
  .integrated-nasdaq-section-wrap .integrated-desktop-table td:nth-child(5){
    width:48px!important;
  }

  /* Value Screener on iPad Pro 11: KOSPI top, KOSDAQ bottom */
  .value-tablet-stack{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:12px!important;
  }
}

/* iPad Pro 11 landscape: KOSPI full top, KOSDAQ + NASDAQ bottom */
@media(min-width:901px) and (max-width:1240px){
  .integrated-market-layout{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    grid-template-areas:
      "kospi kospi"
      "kosdaq nasdaq"!important;
    gap:12px!important;
  }
  .integrated-kospi-section{grid-area:kospi!important}
  .integrated-kosdaq-section{grid-area:kosdaq!important; min-width:0!important}
  .integrated-nasdaq-section-wrap{grid-area:nasdaq!important; min-width:0!important}

  .integrated-kosdaq-section .integrated-table th,
  .integrated-kosdaq-section .integrated-table td,
  .integrated-kosdaq-section .integrated-desktop-table th,
  .integrated-kosdaq-section .integrated-desktop-table td,
  .integrated-nasdaq-section-wrap .integrated-table th,
  .integrated-nasdaq-section-wrap .integrated-table td,
  .integrated-nasdaq-section-wrap .integrated-desktop-table th,
  .integrated-nasdaq-section-wrap .integrated-desktop-table td{
    font-size:9.5px!important;
    padding:5px 4px!important;
  }

  .integrated-kosdaq-section .integrated-score,
  .integrated-nasdaq-section-wrap .integrated-score{
    font-size:16px!important;
  }

  .value-tablet-stack{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:12px!important;
  }
}

/* Phone remains card-only layout */
@media(max-width:700px){
  .integrated-market-layout{
    display:block!important;
  }
  .value-tablet-stack{
    display:block!important;
  }
}


/* === iPad Pro 11 Final Vertical Order === */
/*
  Tablet must NOT use PC side-by-side layout.
  iPad Pro 11 target:
  - Portrait around 834px
  - Landscape around 1194px
  - Usually pointer: coarse
*/
@media (min-width:701px) and (max-width:1240px) and (pointer:coarse),
       (min-width:701px) and (max-width:1240px) and (hover:none),
       (min-width:701px) and (max-width:900px){
  /* Integrated indicator analysis: KOSPI -> KOSDAQ -> NASDAQ -> WORST */
  .integrated-market-layout{
    display:grid!important;
    grid-template-columns:1fr!important;
    grid-template-areas:
      "kospi"
      "kosdaq"
      "nasdaq"!important;
    gap:12px!important;
  }

  .integrated-kospi-section{grid-area:kospi!important; grid-column:1!important}
  .integrated-kosdaq-section{grid-area:kosdaq!important; grid-column:1!important}
  .integrated-nasdaq-section-wrap{grid-area:nasdaq!important; grid-column:1!important}

  .integrated-wost-section{
    grid-column:1!important;
    margin-top:12px!important;
  }

  .integrated-section,
  .integrated-wost-section,
  .integrated-nasdaq-section{
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
  }

  .integrated-scroll{
    max-height:560px!important;
    overflow:auto!important;
  }

  .integrated-onecol-list,
  .integrated-mobile-card-list{
    display:none!important;
  }

  .integrated-table,
  .integrated-desktop-table{
    display:table!important;
    table-layout:fixed!important;
    width:100%!important;
    border-collapse:collapse!important;
  }

  .integrated-table thead,
  .integrated-desktop-table thead{display:table-header-group!important}
  .integrated-table tbody,
  .integrated-desktop-table tbody{display:table-row-group!important}
  .integrated-table tr,
  .integrated-desktop-table tr{display:table-row!important}

  .integrated-table th,
  .integrated-table td,
  .integrated-desktop-table th,
  .integrated-desktop-table td{
    display:table-cell!important;
    padding:5px 4px!important;
    font-size:9.4px!important;
    line-height:1.32!important;
    vertical-align:top!important;
    word-break:keep-all!important;
  }

  .integrated-table th,
  .integrated-desktop-table th{
    font-size:8.8px!important;
    font-weight:900!important;
    color:#8aa0b1!important;
  }

  .integrated-section-head{
    padding:9px 10px!important;
    min-height:38px!important;
  }

  .integrated-section-head b{
    font-size:12px!important;
    line-height:1.25!important;
    font-weight:900!important;
  }

  .integrated-section-head .tag{
    font-size:9.5px!important;
    padding:2px 5px!important;
    min-width:36px!important;
  }

  .integrated-table td:nth-child(1),
  .integrated-desktop-table td:nth-child(1),
  .integrated-table th:nth-child(1),
  .integrated-desktop-table th:nth-child(1){
    width:32px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(2),
  .integrated-desktop-table td:nth-child(2),
  .integrated-table th:nth-child(2),
  .integrated-desktop-table th:nth-child(2){
    width:130px!important;
  }

  .integrated-table td:nth-child(3),
  .integrated-desktop-table td:nth-child(3),
  .integrated-table th:nth-child(3),
  .integrated-desktop-table th:nth-child(3){
    width:54px!important;
    text-align:center!important;
  }

  .integrated-table td:nth-child(4),
  .integrated-desktop-table td:nth-child(4),
  .integrated-table th:nth-child(4),
  .integrated-desktop-table th:nth-child(4){
    width:175px!important;
  }

  .integrated-table td:nth-child(5),
  .integrated-desktop-table td:nth-child(5),
  .integrated-table th:nth-child(5),
  .integrated-desktop-table th:nth-child(5){
    width:78px!important;
  }

  .integrated-score{
    font-size:17px!important;
    line-height:1!important;
  }

  .integrated-wost-score{
    font-size:16px!important;
    line-height:1!important;
  }

  .integrated-breakdown{
    min-width:0!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:3px!important;
  }

  .integrated-breakdown small{
    font-size:8px!important;
    line-height:1.1!important;
    white-space:nowrap!important;
  }

  .integrated-mini-meter{
    height:3px!important;
    margin-top:2px!important;
  }

  .integrated-pill,
  .integrated-us-tag,
  .integrated-risk-tag{
    font-size:8px!important;
    line-height:1.15!important;
    padding:1px 3px!important;
    margin:1px!important;
  }

  .pick-tags,
  .integrated-table .sub,
  .integrated-desktop-table .sub{
    font-size:8.5px!important;
    line-height:1.28!important;
  }

  .rank{
    font-size:9.5px!important;
    font-weight:900!important;
  }

  .integrated-summary{
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:7px!important;
  }

  .integrated-kpi{
    padding:8px!important;
  }

  .integrated-kpi small{
    font-size:9.5px!important;
    margin-bottom:4px!important;
  }

  .integrated-kpi b{
    font-size:16px!important;
  }

  .integrated-kpi span{
    font-size:9px!important;
  }

  .integrated-toolbar .btn,
  .value-scan-toolbar .btn,
  .value-market-tabs .btn{
    font-size:10.5px!important;
    padding:7px 9px!important;
    min-height:34px!important;
  }

  .integrated-toolbar .sub,
  .value-scan-status,
  .footer-note{
    font-size:10.5px!important;
    line-height:1.45!important;
  }

  /* Undervalue screener: KOSPI -> KOSDAQ vertical */
  .value-top20-grid,
  .value-tablet-stack{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:12px!important;
  }

  .value-top20-section{
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
  }

  .value-top20-title{
    padding:9px 10px!important;
  }

  .value-top20-title span:first-child{
    font-size:12px!important;
    font-weight:900!important;
  }

  .value-top20-title .tag{
    font-size:9.5px!important;
    padding:2px 5px!important;
  }

  .value-top20-scroll{
    max-height:560px!important;
    overflow:auto!important;
  }

  .value-top20-section .data-table{
    table-layout:fixed!important;
    width:100%!important;
    font-size:9.4px!important;
  }

  .value-top20-section .data-table th,
  .value-top20-section .data-table td{
    padding:5px 4px!important;
    font-size:9.4px!important;
    line-height:1.3!important;
    word-break:keep-all!important;
  }

  .value-top20-section .data-table th{
    font-size:8.8px!important;
    font-weight:900!important;
  }

  .value-top20-section .data-table th:nth-child(1),
  .value-top20-section .data-table td:nth-child(1){width:32px!important;text-align:center!important}
  .value-top20-section .data-table th:nth-child(2),
  .value-top20-section .data-table td:nth-child(2){width:130px!important}
  .value-top20-section .data-table th:nth-child(3),
  .value-top20-section .data-table td:nth-child(3){width:74px!important}
  .value-top20-section .data-table th:nth-child(4),
  .value-top20-section .data-table td:nth-child(4){width:70px!important}
  .value-top20-section .data-table th:nth-child(5),
  .value-top20-section .data-table td:nth-child(5){width:56px!important}
  .value-top20-section .data-table th:nth-child(6),
  .value-top20-section .data-table td:nth-child(6){width:46px!important;text-align:center!important}
  .value-top20-section .data-table th:nth-child(7),
  .value-top20-section .data-table td:nth-child(7){width:70px!important}
  .value-top20-section .data-table th:nth-child(8),
  .value-top20-section .data-table td:nth-child(8){width:auto!important}

  .value-scan-summary{
    grid-template-columns:repeat(4,minmax(0,1fr))!important;
    gap:7px!important;
  }

  .value-scan-summary .mini-kpi{
    padding:8px!important;
    font-size:10px!important;
  }

  .value-scan-summary .mini-kpi b{
    font-size:15px!important;
  }
}

/* Keep phone card layout only for phones */
@media(max-width:700px){
  .integrated-market-layout,
  .value-top20-grid,
  .value-tablet-stack{
    display:block!important;
  }
}


/* === Runtime Tablet Layout Override: class based === */
.app.device-tablet .integrated-market-layout{
  display:grid!important;
  grid-template-columns:1fr!important;
  grid-template-areas:
    "kospi"
    "kosdaq"
    "nasdaq"!important;
  gap:12px!important;
}
.app.device-tablet .integrated-kospi-section{grid-area:kospi!important;grid-column:1!important}
.app.device-tablet .integrated-kosdaq-section{grid-area:kosdaq!important;grid-column:1!important}
.app.device-tablet .integrated-nasdaq-section-wrap{grid-area:nasdaq!important;grid-column:1!important}
.app.device-tablet .integrated-wost-section{grid-column:1!important;margin-top:12px!important}

.app.device-tablet .value-top20-grid,
.app.device-tablet .value-tablet-stack{
  display:grid!important;
  grid-template-columns:1fr!important;
  gap:12px!important;
}
.app.device-tablet .value-kospi-section{order:1}
.app.device-tablet .value-kosdaq-section{order:2}
.app.device-tablet .value-nasdaq-section{order:3}
.app.device-tablet .value-worst-section{order:4}

.app.device-tablet .integrated-onecol-list,
.app.device-tablet .integrated-mobile-card-list{
  display:none!important;
}
.app.device-tablet .integrated-table,
.app.device-tablet .integrated-desktop-table,
.app.device-tablet .value-top20-section .data-table{
  display:table!important;
  table-layout:fixed!important;
  width:100%!important;
  border-collapse:collapse!important;
}
.app.device-tablet .integrated-table th,
.app.device-tablet .integrated-table td,
.app.device-tablet .integrated-desktop-table th,
.app.device-tablet .integrated-desktop-table td,
.app.device-tablet .value-top20-section .data-table th,
.app.device-tablet .value-top20-section .data-table td{
  display:table-cell!important;
  padding:5px 4px!important;
  font-size:9px!important;
  line-height:1.28!important;
  vertical-align:top!important;
}
.app.device-tablet .integrated-table th,
.app.device-tablet .integrated-desktop-table th,
.app.device-tablet .value-top20-section .data-table th{
  font-size:8.5px!important;
  font-weight:900!important;
}
.app.device-tablet .integrated-section-head,
.app.device-tablet .value-top20-title{
  padding:9px 10px!important;
  min-height:38px!important;
}
.app.device-tablet .integrated-section-head b,
.app.device-tablet .value-top20-title span:first-child{
  font-size:12px!important;
  line-height:1.25!important;
}
.app.device-tablet .integrated-score{font-size:16px!important}
.app.device-tablet .integrated-breakdown{min-width:0!important;gap:3px!important}
.app.device-tablet .integrated-breakdown small{font-size:8px!important}
.app.device-tablet .integrated-mini-meter{height:3px!important}
.app.device-tablet .pick-tags,
.app.device-tablet .sub,
.app.device-tablet .footer-note,
.app.device-tablet .value-scan-status{
  font-size:8.5px!important;
  line-height:1.28!important;
}
.app.device-tablet .integrated-summary,
.app.device-tablet .value-scan-summary{
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:7px!important;
}
.app.device-tablet .integrated-kpi,
.app.device-tablet .value-scan-summary .mini-kpi{
  padding:8px!important;
}
.app.device-tablet .integrated-kpi b,
.app.device-tablet .value-scan-summary .mini-kpi b{
  font-size:15px!important;
}


/* === Hotfix: Value Screener render restore + tablet order === */
.app.device-tablet .value-top20-grid,
.app.device-tablet .value-tablet-stack{
  display:grid!important;
  grid-template-columns:1fr!important;
  gap:12px!important;
}
.app.device-tablet .value-kospi-section{order:1!important}
.app.device-tablet .value-kosdaq-section{order:2!important}

.app.device-tablet .value-top20-section .data-table{
  display:table!important;
  table-layout:fixed!important;
  width:100%!important;
  border-collapse:collapse!important;
}
.app.device-tablet .value-top20-section .data-table th,
.app.device-tablet .value-top20-section .data-table td{
  display:table-cell!important;
  padding:5px 4px!important;
  font-size:9px!important;
  line-height:1.28!important;
}
.app.device-tablet .value-top20-section .data-table th{
  font-size:8.5px!important;
  font-weight:900!important;
}


/* === Value Screener Phone Card Layout === */
.value-mobile-card-list{
  display:none;
}

@media(max-width:700px){
  .value-top20-grid,
  .value-tablet-stack{
    display:block!important;
  }

  .value-top20-section{
    margin-top:12px!important;
    overflow:hidden!important;
  }

  .value-top20-title{
    padding:10px 12px!important;
  }

  .value-top20-title span:first-child{
    font-size:14px!important;
    line-height:1.3!important;
    font-weight:900!important;
  }

  .value-top20-scroll{
    max-height:none!important;
    overflow:visible!important;
  }

  .value-top20-section .data-table,
  .value-single-scroll .data-table{
    display:none!important;
  }

  .value-mobile-card-list{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:9px!important;
    padding:10px!important;
  }

  .value-mobile-card{
    padding:0!important;
    border:1px solid #263c4f!important;
    background:#08131d!important;
    overflow:hidden!important;
  }

  .value-mobile-card.active{
    border-color:#00d9ff!important;
    background:#071d24!important;
    box-shadow:0 0 0 1px rgba(0,217,255,.30) inset!important;
  }

  .value-mobile-head{
    display:grid!important;
    grid-template-columns:minmax(118px,1.35fr) 52px minmax(92px,1fr)!important;
    gap:0!important;
    align-items:stretch!important;
    border-bottom:1px solid #263c4f!important;
  }

  .value-mobile-main{
    padding:9px 10px!important;
    border-right:1px solid #263c4f!important;
    min-width:0!important;
  }

  .value-mobile-name{
    font-size:12.5px!important;
    line-height:1.32!important;
    font-weight:900!important;
    color:#d9ecf5!important;
    word-break:keep-all!important;
  }

  .value-mobile-meta{
    margin-top:4px!important;
    color:#7f95a7!important;
    font-size:10px!important;
    line-height:1.42!important;
    word-break:keep-all!important;
  }

  .value-mobile-market{
    display:none!important;
  }

  .value-mobile-change{
    margin-top:4px!important;
    font-size:10.5px!important;
    line-height:1.25!important;
    font-weight:900!important;
  }

  .value-mobile-score{
    display:flex!important;
    flex-direction:column!important;
    justify-content:center!important;
    align-items:center!important;
    border-right:1px solid #263c4f!important;
    padding:6px 4px!important;
    color:#ffd447!important;
    font-size:21px!important;
    line-height:1!important;
    font-weight:900!important;
    text-align:center!important;
  }

  .value-mobile-score small{
    display:block!important;
    color:#7f95a7!important;
    font-size:9px!important;
    margin-top:5px!important;
    font-weight:800!important;
  }

  .value-mobile-judge{
    padding:8px 8px!important;
    min-width:0!important;
  }

  .value-mobile-judge-title{
    color:#6f899a!important;
    font-size:9.5px!important;
    line-height:1.2!important;
    font-weight:800!important;
    margin-bottom:3px!important;
  }

  .value-mobile-judge-value{
    color:#28ff91!important;
    font-size:11.5px!important;
    line-height:1.3!important;
    font-weight:900!important;
  }

  .value-mobile-judge-meta{
    margin-top:4px!important;
    color:#8da2b3!important;
    font-size:9.5px!important;
    line-height:1.45!important;
  }

  .value-mobile-body{
    padding:8px 10px 10px!important;
    display:grid!important;
    gap:8px!important;
  }

  .value-mobile-bars{
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    gap:5px!important;
  }

  .value-mobile-bar small{
    display:block!important;
    color:#7f95a7!important;
    font-size:9.5px!important;
    margin-bottom:3px!important;
    white-space:nowrap!important;
  }

  .value-mobile-track{
    height:5px!important;
    border:1px solid #20394b!important;
    background:#071018!important;
    overflow:hidden!important;
  }

  .value-mobile-track div{
    height:100%!important;
    background:#00d9ff!important;
  }

  .value-mobile-reason{
    width:100%!important;
    box-sizing:border-box!important;
    border:1px solid #20394b!important;
    background:#071018!important;
    padding:8px 9px!important;
    color:#9fb4c5!important;
    font-size:10.5px!important;
    line-height:1.55!important;
    word-break:keep-all!important;
    white-space:normal!important;
  }

  .value-mobile-reason::before{
    content:"추천근거 ";
    color:#00d9ff;
    font-weight:900;
  }
}

@media(max-width:390px){
  .value-mobile-head{
    grid-template-columns:minmax(105px,1.28fr) 46px minmax(78px,.95fr)!important;
  }
  .value-mobile-main{
    padding:8px 8px!important;
  }
  .value-mobile-name{
    font-size:11.5px!important;
  }
  .value-mobile-meta,
  .value-mobile-change{
    font-size:9.3px!important;
  }
  .value-mobile-score{
    font-size:19px!important;
  }
  .value-mobile-judge{
    padding:7px 7px!important;
  }
  .value-mobile-judge-title{
    font-size:8.8px!important;
  }
  .value-mobile-judge-value{
    font-size:10.5px!important;
  }
  .value-mobile-judge-meta{
    font-size:8.8px!important;
  }
  .value-mobile-bar small{
    font-size:8.8px!important;
  }
  .value-mobile-reason{
    font-size:9.8px!important;
  }
}


/* === Mobile Global Font Size Tune === */
/* 설명문, 안내문, README, 상태문구처럼 화면을 많이 차지하는 텍스트를 모바일에서 축소 */
@media(max-width:700px){
  .screen-head,
  .screen-desc,
  .footer-note,
  .readme,
  .readme *,
  .readme-section,
  .readme-section *,
  .value-scan-status,
  .chat-scroll-help,
  .ai-alert-hint,
  .sub,
  .tag,
  .panel-title .tag,
  .mobile-nav-label,
  .mobile-current,
  .creator-badge,
  .top-right,
  .ticker-line2,
  .ticker-line3{
    font-size:10px!important;
    line-height:1.45!important;
  }

  .screen-head h1,
  .screen-title,
  .panel-title,
  .panel-title span:first-child{
    font-size:14px!important;
    line-height:1.35!important;
    font-weight:900!important;
  }

  .panel-body{
    font-size:11px!important;
    line-height:1.45!important;
  }

  .panel{
    margin-bottom:12px!important;
  }

  .footer-note{
    padding:8px 10px!important;
    margin-top:10px!important;
    color:#7f95a7!important;
  }

  .readme,
  .readme-section{
    padding:9px 10px!important;
    margin-top:10px!important;
  }

  .readme h3,
  .readme h4,
  .readme-section h3,
  .readme-section h4{
    font-size:11px!important;
    line-height:1.35!important;
    margin:6px 0!important;
  }

  .readme ul,
  .readme-section ul{
    margin:5px 0 5px 16px!important;
    padding:0!important;
  }

  .readme li,
  .readme-section li{
    font-size:10px!important;
    line-height:1.45!important;
    margin:2px 0!important;
  }

  .value-scan-status{
    padding:8px 9px!important;
    margin:8px 0!important;
  }

  .value-scan-progress{
    height:5px!important;
    margin-top:6px!important;
  }

  .value-scan-toolbar,
  .value-market-tabs,
  .integrated-toolbar,
  .theme-toolbar{
    gap:6px!important;
    margin-bottom:8px!important;
  }

  .value-scan-toolbar .btn,
  .value-market-tabs .btn,
  .integrated-toolbar .btn,
  .theme-toolbar .btn,
  .btn,
  button,
  .select,
  .input{
    font-size:10.5px!important;
    line-height:1.25!important;
    min-height:32px!important;
    padding:7px 8px!important;
  }

  .value-scan-summary,
  .integrated-summary,
  .theme-summary-grid,
  .card-grid{
    gap:6px!important;
    margin:8px 0!important;
  }

  .value-scan-summary .mini-kpi,
  .integrated-kpi,
  .theme-mini-card,
  .card{
    padding:8px!important;
  }

  .value-scan-summary .mini-kpi,
  .integrated-kpi small,
  .theme-mini-card span,
  .card-title{
    font-size:9.5px!important;
    line-height:1.35!important;
  }

  .value-scan-summary .mini-kpi b,
  .integrated-kpi b,
  .theme-mini-card b,
  .value{
    font-size:15px!important;
    line-height:1.2!important;
  }

  .top{
    min-height:42px!important;
    padding:7px 10px!important;
  }

  .brand{
    font-size:17px!important;
  }

  .live{
    font-size:10px!important;
  }

  .nav{
    gap:5px!important;
    padding:7px 8px!important;
  }

  .nav button{
    font-size:10px!important;
    padding:7px 8px!important;
    min-height:30px!important;
  }

  .ticker{
    min-height:48px!important;
  }

  .ticker-item{
    min-width:96px!important;
    padding:6px 8px!important;
  }

  .ticker-line1{
    font-size:11px!important;
  }

  /* AI 리포트/추가질문 설명 영역 축소 */
  .chat-msg,
  .chat-msg *,
  .followup-modal-body,
  .followup-modal-body *{
    font-size:11px!important;
    line-height:1.55!important;
  }

  .chat-msg-scroll{
    max-height:260px!important;
  }

  .chat-msg.ai .chat-msg-scroll{
    max-height:300px!important;
  }

  /* 지표 통합 최적분석/저평가 카드 내부 보조 텍스트도 한 단계 축소 */
  .integrated-onecol-meta,
  .integrated-onecol-judge-meta,
  .integrated-onecol-reason,
  .value-mobile-meta,
  .value-mobile-judge-meta,
  .value-mobile-reason{
    font-size:9.8px!important;
    line-height:1.48!important;
  }

  .integrated-onecol-name,
  .value-mobile-name{
    font-size:11.5px!important;
  }

  .integrated-onecol-score,
  .value-mobile-score{
    font-size:19px!important;
  }

  .integrated-onecol-judge-value,
  .value-mobile-judge-value{
    font-size:10.5px!important;
  }

  .integrated-onecol-bar small,
  .value-mobile-bar small{
    font-size:8.8px!important;
  }
}

@media(max-width:390px){
  .screen-desc,
  .footer-note,
  .readme,
  .readme *,
  .readme-section,
  .readme-section *,
  .value-scan-status,
  .sub{
    font-size:9.5px!important;
    line-height:1.42!important;
  }

  .panel-title,
  .panel-title span:first-child{
    font-size:13px!important;
  }

  .btn,
  button,
  .select,
  .input{
    font-size:9.8px!important;
    padding:6px 7px!important;
  }

  .integrated-onecol-meta,
  .integrated-onecol-judge-meta,
  .integrated-onecol-reason,
  .value-mobile-meta,
  .value-mobile-judge-meta,
  .value-mobile-reason{
    font-size:9.2px!important;
  }
}


/* === Mobile Requested Tweaks: Realtime Stocks + Value Screener === */
@media(max-width:700px){
  /* 1. 국내 실시간 종목: 카드 높이 낮게 */
  .stock-list{
    gap:6px!important;
    max-height:390px!important;
  }

  .stock-btn{
    padding:8px 9px!important;
    min-height:0!important;
  }

  .stock-top{
    margin-bottom:3px!important;
  }

  .stock-name{
    font-size:12px!important;
    line-height:1.25!important;
  }

  .stock-top .up,
  .stock-top .down{
    font-size:11px!important;
    line-height:1.25!important;
  }

  .stock-btn .sub{
    font-size:9.5px!important;
    line-height:1.35!important;
  }

  .stock-btn .pill{
    font-size:9px!important;
    padding:2px 5px!important;
    margin-top:2px!important;
    display:inline-block!important;
  }

  /* 2. 저평가 스크리너: 지표통합형 구조 유지 + 정보 압축 */
  .value-mobile-head{
    grid-template-columns:minmax(112px,1.35fr) 48px minmax(82px,.95fr)!important;
  }

  .value-mobile-main{
    padding:8px 9px!important;
  }

  .value-mobile-name{
    font-size:11.2px!important;
    line-height:1.25!important;
  }

  .value-mobile-meta{
    font-size:9.2px!important;
    line-height:1.28!important;
    margin-top:3px!important;
  }

  .value-mobile-price-line{
    display:flex!important;
    align-items:center!important;
    gap:6px!important;
    flex-wrap:wrap!important;
    margin-top:3px!important;
    font-size:9.4px!important;
    line-height:1.25!important;
    color:#8da2b3!important;
    font-weight:800!important;
  }

  .value-mobile-perpbr{
    margin-top:3px!important;
    font-size:8.8px!important;
    line-height:1.2!important;
    color:#6f899a!important;
    font-weight:700!important;
    white-space:nowrap!important;
  }

  .value-mobile-change{
    display:none!important;
  }

  .value-mobile-score{
    font-size:18px!important;
    padding:5px 3px!important;
  }

  .value-mobile-score small{
    font-size:8.5px!important;
    margin-top:4px!important;
  }

  .value-mobile-judge{
    padding:7px 7px!important;
  }

  .value-mobile-judge-title{
    font-size:8.5px!important;
    margin-bottom:2px!important;
  }

  .value-mobile-judge-value{
    font-size:10px!important;
    line-height:1.22!important;
  }

  .value-mobile-judge-meta{
    font-size:8.5px!important;
    line-height:1.25!important;
    margin-top:3px!important;
  }

  .value-mobile-body{
    padding:7px 9px 9px!important;
    gap:7px!important;
  }

  .value-mobile-bars{
    gap:4px!important;
  }

  .value-mobile-bar small{
    font-size:8.4px!important;
    margin-bottom:2px!important;
  }

  .value-mobile-track{
    height:4px!important;
  }

  .value-mobile-reason{
    font-size:9.4px!important;
    line-height:1.45!important;
    padding:7px 8px!important;
  }
}

@media(max-width:390px){
  .stock-btn{
    padding:7px 8px!important;
  }

  .stock-name{
    font-size:11px!important;
  }

  .stock-btn .sub{
    font-size:9px!important;
  }

  .value-mobile-head{
    grid-template-columns:minmax(100px,1.3fr) 43px minmax(74px,.9fr)!important;
  }

  .value-mobile-name{
    font-size:10.7px!important;
  }

  .value-mobile-price-line{
    font-size:8.8px!important;
    gap:4px!important;
  }

  .value-mobile-perpbr{
    font-size:8.2px!important;
  }

  .value-mobile-score{
    font-size:16.5px!important;
  }

  .value-mobile-judge-value{
    font-size:9.3px!important;
  }

  .value-mobile-reason{
    font-size:8.8px!important;
  }
}


/* === Mobile Fine Tune: realtime stock height + selected analysis + Paperlogy === */
@font-face{
  font-family:"PaperlogyMobile";
  src:local("Paperlogy"),
      local("Paperlogy-4Regular"),
      local("Paperlogy-5Medium"),
      local("Paperlogy-6SemiBold"),
      local("Paperlogy-7Bold"),
      local("Paperlogy-8ExtraBold"),
      local("Paperlogy-9Black");
  font-display:swap;
}

@media(max-width:700px){
  :root{
    --paperlogy-font:"PaperlogyMobile","Paperlogy","Paperlogy-4Regular","Paperlogy-5Medium","Paperlogy-6SemiBold","Paperlogy-7Bold","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif!important;
  }

  html,
  body,
  #root,
  .app,
  .app *,
  button,
  input,
  select,
  textarea,
  svg,
  svg *,
  svg text,
  tspan{
    font-family:var(--paperlogy-font)!important;
  }

  /* 1) 국내 실시간 종목: 위/아래 여백 최소화 */
  .stock-list{
    gap:4px!important;
    max-height:360px!important;
    padding-right:0!important;
  }

  .stock-btn{
    padding:5px 7px!important;
    min-height:0!important;
    line-height:1.15!important;
  }

  .stock-top{
    margin-bottom:1px!important;
    min-height:0!important;
  }

  .stock-name{
    font-size:10.8px!important;
    line-height:1.15!important;
    font-weight:900!important;
  }

  .stock-top .up,
  .stock-top .down{
    font-size:10px!important;
    line-height:1.15!important;
    white-space:nowrap!important;
  }

  .stock-btn .sub{
    font-size:8.6px!important;
    line-height:1.18!important;
    margin:0!important;
  }

  .stock-btn .sub br:first-of-type{
    display:none!important;
  }

  .stock-btn .sub b{
    font-size:8.8px!important;
    line-height:1.18!important;
  }

  .stock-btn .pill{
    font-size:8px!important;
    line-height:1!important;
    padding:1px 4px!important;
    margin-top:1px!important;
  }

  /* 입력영역도 너무 높지 않게 */
  .add-stock-grid{
    gap:5px!important;
    margin-top:7px!important;
  }

  .left-panel-shell .input,
  .left-panel-shell .btn{
    min-height:28px!important;
    padding:5px 7px!important;
    font-size:9.5px!important;
  }

  .left-panel-shell .panel-body{
    padding:8px!important;
  }

  /* 2) 선택 종목 실시간 분석: 전체 폰트/박스 축소 */
  .report-layout{
    grid-template-columns:76px 1fr!important;
    gap:6px!important;
  }

  .score-box{
    height:86px!important;
    min-height:86px!important;
    padding:6px!important;
  }

  .score{
    font-size:30px!important;
    line-height:1!important;
  }

  .score-box .sub{
    font-size:8.5px!important;
    line-height:1.1!important;
    margin-top:3px!important;
  }

  .kpi-grid{
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:5px!important;
  }

  .kpi{
    min-height:44px!important;
    padding:6px 7px!important;
  }

  .kpi .card-title{
    font-size:8.7px!important;
    line-height:1.15!important;
    margin-bottom:3px!important;
  }

  .kpi strong{
    margin-top:3px!important;
    font-size:10.5px!important;
    line-height:1.22!important;
    font-weight:900!important;
    word-break:keep-all!important;
  }

  .panel:has(.report-layout) .panel-title{
    font-size:11px!important;
    padding:8px 10px!important;
    min-height:0!important;
  }

  /* 시장지수 카드도 대시보드 모바일에서 균형 있게 축소 */
  .card-grid{
    grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:6px!important;
  }

  .card{
    padding:8px!important;
  }

  .card-title{
    font-size:8.8px!important;
    margin-bottom:3px!important;
  }

  .value{
    font-size:15px!important;
    line-height:1.15!important;
  }

  .card .up,
  .card .down{
    font-size:9.5px!important;
    line-height:1.2!important;
  }

  .card .sub{
    font-size:8.5px!important;
    line-height:1.25!important;
  }
}

@media(max-width:390px){
  .stock-btn{
    padding:4px 6px!important;
  }

  .stock-name{
    font-size:10.2px!important;
  }

  .stock-top .up,
  .stock-top .down{
    font-size:9.4px!important;
  }

  .stock-btn .sub{
    font-size:8.1px!important;
  }

  .report-layout{
    grid-template-columns:68px 1fr!important;
    gap:5px!important;
  }

  .score-box{
    height:78px!important;
    min-height:78px!important;
  }

  .score{
    font-size:27px!important;
  }

  .kpi{
    min-height:40px!important;
    padding:5px 6px!important;
  }

  .kpi .card-title{
    font-size:8.1px!important;
  }

  .kpi strong{
    font-size:9.7px!important;
  }
}


/* === AXIOS Market Insight === */
.axios-shell{display:grid;gap:12px}
.axios-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.axios-toolbar .btn.active{border-color:#00d9ff;background:#00d9ff22;color:#d9ecf5}
.axios-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.axios-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}
.axios-section{border:1px solid #1e3445;background:#08131d;min-width:0}
.axios-title{padding:11px 12px;border-bottom:1px solid #1e3445;color:#00d9ff;font-weight:900;font-size:12px}
.axios-list{display:grid;gap:8px;padding:10px;max-height:680px;overflow:auto}
.axios-card{border:1px solid #1e3445;background:#0b1520;padding:11px}
.axios-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.axios-card-head b{color:#d9ecf5;font-size:13px;line-height:1.45}
.axios-meta{color:#6f899a;font-size:10.5px;margin-top:6px}
.axios-summary-text{color:#9fb4c5;font-size:12px;line-height:1.6;margin-top:8px}
.axios-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.axios-tags span{border:1px solid #1e3445;background:#071018;color:#8fb2c7;font-size:10px;padding:3px 6px}
.axios-reason{margin-top:8px;color:#ffd447;font-size:11px}
.axios-link{display:inline-block;margin-top:8px;color:#00d9ff;font-size:11px;text-decoration:none}
.axios-impact-table{font-size:11px}
.axios-sector-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:10px}
.axios-sector{display:flex;justify-content:space-between;gap:8px;border:1px solid #1e3445;background:#071018;padding:7px 8px;font-size:11px}
@media(max-width:900px){
  .axios-grid{grid-template-columns:1fr}
  .axios-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:700px){
  .axios-toolbar .btn{font-size:10px!important;min-height:30px!important;padding:6px 8px!important}
  .axios-list{max-height:none;overflow:visible;padding:8px}
  .axios-card{padding:9px}
  .axios-card-head b{font-size:11px}
  .axios-summary-text{font-size:10px;line-height:1.5}
  .axios-meta,.axios-reason,.axios-link{font-size:9.5px}
  .axios-impact-table th,.axios-impact-table td{font-size:9px!important;padding:5px 4px!important}
  .axios-sector-list{grid-template-columns:1fr}
}


/* === Integrated WORST Split: Domestic vs US === */
.integrated-worst-split-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-top:14px;
}
.integrated-worst-us{
  border-color:#2d3f77!important;
  background:#08101f!important;
}
.integrated-worst-us .integrated-section-head{
  background:linear-gradient(90deg, rgba(59,130,246,.14), rgba(7,16,24,.9))!important;
  border-bottom-color:#2d3f77!important;
}
.integrated-worst-us .integrated-section-head b{
  color:#93c5fd!important;
}
.integrated-worst-us .integrated-worst-notice{
  border-bottom-color:#2d3f77!important;
  color:#bfdbfe!important;
}
.integrated-worst-domestic .integrated-section-head b{
  color:#ff9bad!important;
}
@media(max-width:1240px){
  .integrated-worst-split-grid{
    grid-template-columns:1fr!important;
    gap:12px!important;
  }
}


.app.device-tablet .integrated-worst-split-grid{
  display:grid!important;
  grid-template-columns:1fr!important;
  gap:12px!important;
}


/* === Axios Korean Translation Display === */
.axios-card-head b,
.axios-summary-text{
  word-break:keep-all;
}


/* === Integrated Holding Strategy Comment === */
.integrated-hold-tag{
  display:inline-flex;
  margin-top:4px;
  padding:2px 6px;
  border:1px solid #2d536b;
  background:#071824;
  color:#7dd3fc;
  font-size:10px;
  font-weight:900;
}
.integrated-hold-box{
  margin:6px 0 5px;
  padding:7px 8px;
  border:1px solid #1e3445;
  background:#071018;
  color:#9fb4c5;
  font-size:11px;
  line-height:1.45;
}
.integrated-hold-box b{
  display:block;
  color:#ffd447;
  margin-bottom:3px;
}
.integrated-onecol-hold,
.integrated-mobile-hold{
  border:1px solid #1e3445;
  background:#071018;
  padding:8px 9px;
  color:#9fb4c5;
  font-size:11px;
  line-height:1.5;
}
.integrated-onecol-hold b,
.integrated-mobile-hold b{
  display:block;
  color:#ffd447;
  font-weight:900;
  margin-bottom:3px;
}
@media(max-width:700px){
  .integrated-hold-tag{
    font-size:8.8px!important;
    padding:1px 4px!important;
  }
  .integrated-onecol-hold,
  .integrated-mobile-hold{
    font-size:9.5px!important;
    line-height:1.45!important;
    padding:7px 8px!important;
  }
}


/* === AI Learning Auto Feedback === */
.ai-learning-kpi{
  border-color:#7c3aed66!important;
  background:linear-gradient(180deg,#12091f,#081018)!important;
}
.ai-learning-kpi b{
  color:#c4b5fd!important;
}
.ai-learning-kpi small{
  display:block;
  margin-top:4px;
  color:#a78bfa!important;
  font-size:10px;
  line-height:1.3;
}
@media(max-width:700px){
  .ai-learning-kpi small{
    font-size:8.5px!important;
  }
}


/* === Gogojeo Low Structure Signal === */
.gogo-low-note{
  margin-top:8px;
  border:1px solid #254357;
  background:#071824;
  color:#9fb4c5;
  padding:9px 11px;
  font-size:12px;
  line-height:1.55;
}
.gogo-low-note b{
  color:#00d9ff;
}
.gogo-low-note.bull{
  border-color:#00ff8866;
  background:#062016;
}
.gogo-low-note.bull b{
  color:#00ff88;
}
.gogo-low-note.risk{
  border-color:#ff446666;
  background:#24080e;
}
.gogo-low-note.risk b{
  color:#ff6680;
}
@media(max-width:700px){
  .gogo-low-note{
    font-size:10px!important;
    padding:8px 9px!important;
  }
}


/* === Trendline Breakout Quality === */
.gogo-breakout-note{
  margin-top:8px;
  border:1px solid #254357;
  background:#071824;
  color:#9fb4c5;
  padding:9px 11px;
  font-size:12px;
  line-height:1.55;
}
.gogo-breakout-note b{color:#00d9ff}
.gogo-breakout-note.bull{
  border-color:#00ff8866;
  background:#062016;
}
.gogo-breakout-note.bull b{color:#00ff88}
.gogo-breakout-note.risk{
  border-color:#ff446666;
  background:#24080e;
}
.gogo-breakout-note.risk b{color:#ff6680}
@media(max-width:700px){
  .gogo-breakout-note{
    font-size:10px!important;
    padding:8px 9px!important;
  }
}

`;

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function saveLS(key, value) {
  const payload = JSON.stringify(value);
  try {
    localStorage.setItem(key, payload);
  } catch {
    try {
      sessionStorage.setItem(key, payload);
    } catch {
      // 모바일 인앱 브라우저 저장소 제한 시 저장 실패는 앱 중단 없이 무시
    }
  }
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback below
  }
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function isMobileRuntime() {
  try {
    return window.innerWidth <= 700 || /iPhone|Android|Mobile|KAKAOTALK|NAVER|CriOS|FxiOS/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

const AI_LEARNING_VERSION = "v1.0";
const AI_LEARNING_STATS_KEY = "alpha_ai_learning_stats";
const AI_LEARNING_OPEN_KEY = "alpha_ai_learning_open_predictions";
const AI_LEARNING_REMOTE_STATS_KEY = "alpha_ai_learning_remote_stats";
const AI_LEARNING_REMOTE_OPEN_KEY = "alpha_ai_learning_remote_open_predictions";
const AI_LEARNING_DEVICE_KEY = "alpha_ai_learning_device_id";
const AI_LEARNING_SCOPE = "alpha-trading-global-v1";

function emptyAiLearningStats() {
  return {
    version: AI_LEARNING_VERSION,
    updatedAt: "",
    models: {
      value: { total: 0, wins: 0, avgReturn: 0, bias: 0, symbols: {}, sectors: {} },
      integrated: { total: 0, wins: 0, avgReturn: 0, bias: 0, symbols: {}, sectors: {} },
    },
  };
}


function normalizeAiLearningStatsShape(stats) {
  if (!stats?.models) return emptyAiLearningStats();
  return {
    ...emptyAiLearningStats(),
    ...stats,
    models: {
      value: {
        ...emptyAiLearningStats().models.value,
        ...(stats.models?.value || {}),
        symbols: stats.models?.value?.symbols || {},
        sectors: stats.models?.value?.sectors || {},
      },
      integrated: {
        ...emptyAiLearningStats().models.integrated,
        ...(stats.models?.integrated || {}),
        symbols: stats.models?.integrated?.symbols || {},
        sectors: stats.models?.integrated?.sectors || {},
      },
    },
  };
}

function getAiLearningStats() {
  const saved = loadLS(AI_LEARNING_STATS_KEY, null);
  return normalizeAiLearningStatsShape(saved);
}

function getAiLearningRemoteStats() {
  const saved = loadLS(AI_LEARNING_REMOTE_STATS_KEY, null);
  return normalizeAiLearningStatsShape(saved);
}

function mergeLearningBucket(a = {}, b = {}) {
  const totalA = Number(a.total || 0);
  const totalB = Number(b.total || 0);
  const total = totalA + totalB;
  const wins = Number(a.wins || 0) + Number(b.wins || 0);
  const avgReturn = total ? ((Number(a.avgReturn || 0) * totalA) + (Number(b.avgReturn || 0) * totalB)) / total : 0;
  const adj = bounded(((Number(a.adj || 0) * totalA) + (Number(b.adj || 0) * totalB)) / Math.max(1, total), -8, 8);
  return {
    total,
    wins,
    avgReturn: Number(avgReturn.toFixed(2)),
    adj: Number(adj.toFixed(2)),
  };
}

function mergeModelLearning(a = {}, b = {}) {
  const totalA = Number(a.total || 0);
  const totalB = Number(b.total || 0);
  const total = totalA + totalB;
  const wins = Number(a.wins || 0) + Number(b.wins || 0);
  const avgReturn = total ? ((Number(a.avgReturn || 0) * totalA) + (Number(b.avgReturn || 0) * totalB)) / total : 0;
  const bias = bounded(((Number(a.bias || 0) * totalA) + (Number(b.bias || 0) * totalB)) / Math.max(1, total), -3, 3);
  const symbols = {};
  const sectors = {};
  Array.from(new Set([...Object.keys(a.symbols || {}), ...Object.keys(b.symbols || {})])).forEach((k) => {
    symbols[k] = mergeLearningBucket(a.symbols?.[k], b.symbols?.[k]);
  });
  Array.from(new Set([...Object.keys(a.sectors || {}), ...Object.keys(b.sectors || {})])).forEach((k) => {
    sectors[k] = mergeLearningBucket(a.sectors?.[k], b.sectors?.[k]);
  });
  return {
    total,
    wins,
    avgReturn: Number(avgReturn.toFixed(2)),
    bias: Number(bias.toFixed(2)),
    symbols,
    sectors,
  };
}

function mergeAiLearningStats(localStats, remoteStats) {
  const local = normalizeAiLearningStatsShape(localStats);
  const remote = normalizeAiLearningStatsShape(remoteStats);
  return {
    version: AI_LEARNING_VERSION,
    updatedAt: [local.updatedAt, remote.updatedAt].filter(Boolean).sort().slice(-1)[0] || "",
    models: {
      value: mergeModelLearning(local.models.value, remote.models.value),
      integrated: mergeModelLearning(local.models.integrated, remote.models.integrated),
    },
  };
}

function getAiLearningEffectiveStats() {
  return mergeAiLearningStats(getAiLearningStats(), getAiLearningRemoteStats());
}

function getAiLearningDeviceId() {
  let id = loadLS(AI_LEARNING_DEVICE_KEY, "");
  if (!id) {
    id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    saveLS(AI_LEARNING_DEVICE_KEY, id);
  }
  return id;
}

function mergeOpenPredictions(localOpen = [], remoteOpen = []) {
  const map = new Map();
  [...remoteOpen, ...localOpen].filter(Boolean).forEach((p) => {
    const key = p.id || `${p.model}-${p.code}-${p.ts}`;
    map.set(key, p);
  });
  return Array.from(map.values()).slice(-1000);
}

async function pullAiLearningFromServer() {
  try {
    const data = await fetchJson(`/api/ai-learning?scope=${encodeURIComponent(AI_LEARNING_SCOPE)}`);
    if (data?.stats) saveLS(AI_LEARNING_REMOTE_STATS_KEY, data.stats);
    if (Array.isArray(data?.open)) saveLS(AI_LEARNING_REMOTE_OPEN_KEY, data.open);
    return true;
  } catch {
    return false;
  }
}

async function pushAiLearningToServer() {
  try {
    const payload = {
      scope: AI_LEARNING_SCOPE,
      deviceId: getAiLearningDeviceId(),
      stats: getAiLearningStats(),
      open: loadLS(AI_LEARNING_OPEN_KEY, []),
      updatedAt: new Date().toISOString(),
    };
    const data = await fetchJson("/api/ai-learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (data?.stats) saveLS(AI_LEARNING_REMOTE_STATS_KEY, data.stats);
    if (Array.isArray(data?.open)) saveLS(AI_LEARNING_REMOTE_OPEN_KEY, data.open);
    return true;
  } catch {
    return false;
  }
}



function saveAiLearningStats(stats) {
  saveLS(AI_LEARNING_STATS_KEY, { ...stats, version: AI_LEARNING_VERSION, updatedAt: new Date().toISOString() });
}

function bounded(n, min, max) {
  return Math.max(min, Math.min(max, Number(n || 0)));
}

function updateAiBucket(bucket = {}, success, returnPct) {
  const prevTotal = Number(bucket.total || 0);
  const total = prevTotal + 1;
  const wins = Number(bucket.wins || 0) + (success ? 1 : 0);
  const avgReturn = ((Number(bucket.avgReturn || 0) * prevTotal) + returnPct) / total;
  const adj = bounded(Number(bucket.adj || 0) + (success ? 0.55 : -0.45) + Math.max(-0.25, Math.min(0.25, returnPct / 20)), -8, 8);
  return { ...bucket, total, wins, avgReturn: Number(avgReturn.toFixed(2)), adj: Number(adj.toFixed(2)) };
}

function getAiLearningAdjustment(model, code, sector) {
  const stats = getAiLearningEffectiveStats();
  const m = stats.models?.[model] || {};
  const symbolAdj = Number(m.symbols?.[code]?.adj || 0);
  const sectorAdj = Number(m.sectors?.[sector]?.adj || 0);
  const modelAdj = Number(m.bias || 0);
  return Math.round(bounded(modelAdj * 0.35 + symbolAdj * 0.45 + sectorAdj * 0.25, -8, 8));
}

function summarizeAiLearning(model) {
  const stats = getAiLearningEffectiveStats();
  const m = stats.models?.[model] || {};
  const total = Number(m.total || 0);
  const wins = Number(m.wins || 0);
  const winRate = total ? Math.round((wins / total) * 100) : 0;
  const localOpen = loadLS(AI_LEARNING_OPEN_KEY, []);
  const remoteOpen = loadLS(AI_LEARNING_REMOTE_OPEN_KEY, []);
  const open = mergeOpenPredictions(localOpen, remoteOpen);
  const pending = Array.isArray(open) ? open.filter((p) => p.model === model).length : 0;
  return { total, wins, winRate, avgReturn: Number(m.avgReturn || 0), pending, updatedAt: stats.updatedAt || "" };
}

function recordAiLearningPredictions(model, list = [], horizonDays = 5) {
  const open = loadLS(AI_LEARNING_OPEN_KEY, []);
  const now = Date.now();
  const newOnes = list
    .filter((r) => Number(r.q?.price || r.price || 0) > 0)
    .map((r) => {
      const code = r.code || r.symbol;
      return {
        id: `${model}-${code}-${now}`,
        model,
        code,
        name: r.name || code,
        sector: r.sector || r.tag || r.market || "-",
        market: r.market || "",
        startPrice: Number(r.q?.price || r.price || 0),
        startScore: Number(r.total || r.score || 0),
        startRate: Number(r.q?.changeRate || 0),
        ts: now,
        dueTs: now + horizonDays * 86400000,
        version: AI_LEARNING_VERSION,
      };
    });
  const dedup = new Map();
  [...open, ...newOnes].slice(-700).forEach((p) => {
    // 같은 날 같은 종목은 최신 추천으로 갱신하되, 모바일에서도 pending 카운트가 즉시 보이도록 저장
    const key = `${p.model}-${p.code}-${new Date(p.ts).toDateString()}`;
    dedup.set(key, p);
  });
  const next = Array.from(dedup.values());
  saveLS(AI_LEARNING_OPEN_KEY, next);
  return summarizeAiLearning(model);
}

function evaluateAiLearningPredictions(model, currentRows = []) {
  const open = loadLS(AI_LEARNING_OPEN_KEY, []);
  if (!open.length) return summarizeAiLearning(model);
  const quoteMap = new Map(currentRows.map((r) => [r.code || r.symbol, r]));
  const now = Date.now();
  const stats = getAiLearningStats();
  stats.models[model] = stats.models[model] || { total: 0, wins: 0, avgReturn: 0, bias: 0, symbols: {}, sectors: {} };

  const remain = [];
  open.forEach((p) => {
    if (p.model !== model) {
      remain.push(p);
      return;
    }
    const row = quoteMap.get(p.code);
    const currentPrice = Number(row?.q?.price || row?.price || 0);
    const minEvalMs = isMobileRuntime() ? 30 * 1000 : 10 * 60 * 1000;
    const enoughTime = now - Number(p.ts || 0) > minEvalMs;
    if (!row || !currentPrice || !p.startPrice || !enoughTime) {
      remain.push(p);
      return;
    }
    const returnPct = ((currentPrice - Number(p.startPrice)) / Number(p.startPrice)) * 100;
    const hurdle = isMobileRuntime() ? 0 : (Number(p.startScore || 0) >= 78 ? 0.3 : 0.5);
    const success = returnPct >= hurdle;
    const m = stats.models[model];
    const prevTotal = Number(m.total || 0);
    m.total = prevTotal + 1;
    m.wins = Number(m.wins || 0) + (success ? 1 : 0);
    m.avgReturn = Number((((Number(m.avgReturn || 0) * prevTotal) + returnPct) / Math.max(1, m.total)).toFixed(2));
    m.bias = bounded(Number(m.bias || 0) + (success ? 0.12 : -0.10), -3, 3);
    m.symbols[p.code] = updateAiBucket(m.symbols[p.code], success, returnPct);
    m.sectors[p.sector || "-"] = updateAiBucket(m.sectors[p.sector || "-"], success, returnPct);
  });

  saveLS(AI_LEARNING_OPEN_KEY, remain.slice(-600));
  saveAiLearningStats(stats);
  return summarizeAiLearning(model);
}

function getStockName(code, fallback, stocks) {
  return fallback || stocks.find((s) => s.code === code)?.name || code || "-";
}

async function fetchJson(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    ...(APP_API_KEY ? { "X-App-Key": APP_API_KEY } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  if (res.status === 401 && path !== "/api/auth/login") {
    window.dispatchEvent(new Event("alpha-auth-unauthorized"));
  }
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


const KOSPI200_SCREEN_UNIVERSE = [
  { code: "005930", name: "삼성전자", tag: "반도체", sector: "반도체" },
  { code: "000660", name: "SK하이닉스", tag: "반도체", sector: "반도체" },
  { code: "005380", name: "현대차", tag: "자동차", sector: "자동차" },
  { code: "000270", name: "기아", tag: "자동차", sector: "자동차" },
  { code: "012330", name: "현대모비스", tag: "자동차부품", sector: "자동차" },
  { code: "005490", name: "POSCO홀딩스", tag: "철강/2차전지", sector: "철강" },
  { code: "051910", name: "LG화학", tag: "화학/2차전지", sector: "2차전지" },
  { code: "006400", name: "삼성SDI", tag: "2차전지", sector: "2차전지" },
  { code: "373220", name: "LG에너지솔루션", tag: "2차전지", sector: "2차전지" },
  { code: "207940", name: "삼성바이오로직스", tag: "바이오", sector: "바이오" },
  { code: "068270", name: "셀트리온", tag: "바이오", sector: "바이오" },
  { code: "035420", name: "NAVER", tag: "플랫폼", sector: "인터넷" },
  { code: "035720", name: "카카오", tag: "플랫폼", sector: "인터넷" },
  { code: "105560", name: "KB금융", tag: "금융", sector: "금융" },
  { code: "055550", name: "신한지주", tag: "금융", sector: "금융" },
  { code: "086790", name: "하나금융지주", tag: "금융", sector: "금융" },
  { code: "316140", name: "우리금융지주", tag: "금융", sector: "금융" },
  { code: "000810", name: "삼성화재", tag: "보험", sector: "금융" },
  { code: "032830", name: "삼성생명", tag: "보험", sector: "금융" },
  { code: "033780", name: "KT&G", tag: "소비재", sector: "소비재" },
  { code: "034730", name: "SK", tag: "지주", sector: "지주" },
  { code: "017670", name: "SK텔레콤", tag: "통신", sector: "통신" },
  { code: "030200", name: "KT", tag: "통신", sector: "통신" },
  { code: "015760", name: "한국전력", tag: "전력", sector: "유틸리티" },
  { code: "011200", name: "HMM", tag: "해운", sector: "운송" },
  { code: "010130", name: "고려아연", tag: "비철금속", sector: "소재" },
  { code: "028260", name: "삼성물산", tag: "지주/건설", sector: "지주" },
  { code: "018260", name: "삼성에스디에스", tag: "IT서비스", sector: "IT" },
  { code: "096770", name: "SK이노베이션", tag: "정유/배터리", sector: "에너지" },
  { code: "011070", name: "LG이노텍", tag: "전자부품", sector: "전기전자" },
  { code: "009150", name: "삼성전기", tag: "전자부품", sector: "전기전자" },
  { code: "066570", name: "LG전자", tag: "전기전자", sector: "전기전자" },
  { code: "003670", name: "포스코퓨처엠", tag: "2차전지", sector: "2차전지" },
  { code: "011170", name: "롯데케미칼", tag: "화학", sector: "화학" },
  { code: "010140", name: "삼성중공업", tag: "조선", sector: "조선" },
  { code: "009540", name: "HD한국조선해양", tag: "조선", sector: "조선" },
  { code: "329180", name: "HD현대중공업", tag: "조선", sector: "조선" },
  { code: "267260", name: "HD현대일렉트릭", tag: "전력기기", sector: "전력기기" },
  { code: "010120", name: "LS ELECTRIC", tag: "전력기기", sector: "전력기기" },
  { code: "047810", name: "한국항공우주", tag: "방산", sector: "방산" },
  { code: "064350", name: "현대로템", tag: "방산/철도", sector: "방산" },
  { code: "012450", name: "한화에어로스페이스", tag: "방산", sector: "방산" },
  { code: "272210", name: "한화시스템", tag: "방산", sector: "방산" },
  { code: "042700", name: "한미반도체", tag: "반도체", sector: "반도체" },
  { code: "161390", name: "한국타이어앤테크놀로지", tag: "타이어", sector: "자동차" },
  { code: "251270", name: "넷마블", tag: "게임", sector: "게임" },
  { code: "259960", name: "크래프톤", tag: "게임", sector: "게임" },
  { code: "352820", name: "하이브", tag: "엔터", sector: "엔터" },
  { code: "377300", name: "카카오페이", tag: "핀테크", sector: "인터넷" },
  { code: "323410", name: "카카오뱅크", tag: "은행", sector: "금융" },
];

const KOSDAQ200_SCREEN_UNIVERSE = [
  { code: "247540", name: "에코프로비엠", tag: "2차전지", sector: "2차전지" },
  { code: "086520", name: "에코프로", tag: "2차전지", sector: "2차전지" },
  { code: "028300", name: "HLB", tag: "바이오", sector: "바이오" },
  { code: "196170", name: "알테오젠", tag: "바이오", sector: "바이오" },
  { code: "068760", name: "셀트리온제약", tag: "바이오", sector: "바이오" },
  { code: "141080", name: "리가켐바이오", tag: "바이오", sector: "바이오" },
  { code: "000250", name: "삼천당제약", tag: "제약", sector: "바이오" },
  { code: "145020", name: "휴젤", tag: "바이오", sector: "바이오" },
  { code: "214450", name: "파마리서치", tag: "바이오/미용", sector: "바이오" },
  { code: "214150", name: "클래시스", tag: "미용의료기기", sector: "의료기기" },
  { code: "058470", name: "리노공업", tag: "반도체", sector: "반도체" },
  { code: "039030", name: "이오테크닉스", tag: "반도체장비", sector: "반도체" },
  { code: "036930", name: "주성엔지니어링", tag: "반도체장비", sector: "반도체" },
  { code: "240810", name: "원익IPS", tag: "반도체장비", sector: "반도체" },
  { code: "064760", name: "티씨케이", tag: "반도체소재", sector: "반도체" },
  { code: "095340", name: "ISC", tag: "반도체부품", sector: "반도체" },
  { code: "089030", name: "테크윙", tag: "반도체장비", sector: "반도체" },
  { code: "067310", name: "하나마이크론", tag: "반도체후공정", sector: "반도체" },
  { code: "222800", name: "심텍", tag: "PCB", sector: "전자부품" },
  { code: "101490", name: "에스앤에스텍", tag: "반도체소재", sector: "반도체" },
  { code: "319660", name: "피에스케이", tag: "반도체장비", sector: "반도체" },
  { code: "036540", name: "SFA반도체", tag: "반도체후공정", sector: "반도체" },
  { code: "005290", name: "동진쎄미켐", tag: "반도체소재", sector: "반도체" },
  { code: "078600", name: "대주전자재료", tag: "2차전지소재", sector: "2차전지" },
  { code: "121600", name: "나노신소재", tag: "2차전지소재", sector: "2차전지" },
  { code: "348370", name: "엔켐", tag: "2차전지소재", sector: "2차전지" },
  { code: "025900", name: "동화기업", tag: "2차전지/소재", sector: "소재" },
  { code: "131970", name: "두산테스나", tag: "반도체테스트", sector: "반도체" },
  { code: "277810", name: "레인보우로보틱스", tag: "로봇", sector: "로봇" },
  { code: "108490", name: "로보티즈", tag: "로봇", sector: "로봇" },
  { code: "090360", name: "로보스타", tag: "로봇", sector: "로봇" },
  { code: "042000", name: "카페24", tag: "이커머스", sector: "인터넷" },
  { code: "067160", name: "SOOP", tag: "플랫폼", sector: "인터넷" },
  { code: "035760", name: "CJ ENM", tag: "미디어", sector: "미디어" },
  { code: "060250", name: "NHN KCP", tag: "결제", sector: "핀테크" },
  { code: "293490", name: "카카오게임즈", tag: "게임", sector: "게임" },
  { code: "122870", name: "와이지엔터테인먼트", tag: "엔터", sector: "엔터" },
  { code: "041510", name: "에스엠", tag: "엔터", sector: "엔터" },
  { code: "035900", name: "JYP Ent.", tag: "엔터", sector: "엔터" },
  { code: "376300", name: "디어유", tag: "엔터플랫폼", sector: "엔터" },
  { code: "263750", name: "펄어비스", tag: "게임", sector: "게임" },
  { code: "112040", name: "위메이드", tag: "게임", sector: "게임" },
  { code: "053800", name: "안랩", tag: "보안", sector: "소프트웨어" },
  { code: "096530", name: "씨젠", tag: "진단키트", sector: "바이오" },
  { code: "237690", name: "에스티팜", tag: "바이오", sector: "바이오" },
  { code: "214370", name: "케어젠", tag: "바이오", sector: "바이오" },
  { code: "086900", name: "메디톡스", tag: "바이오", sector: "바이오" },
  { code: "048410", name: "현대바이오", tag: "바이오", sector: "바이오" },
  { code: "206650", name: "유바이오로직스", tag: "백신", sector: "바이오" },
  { code: "140410", name: "메지온", tag: "바이오", sector: "바이오" },
  { code: "215200", name: "메가스터디교육", tag: "교육", sector: "교육" },
];

function uniqueUniverse(list) {
  const map = new Map();
  list.forEach((s) => {
    const code = normalizeCode(s.code);
    if (code.length === 6 && !map.has(code)) map.set(code, { ...s, code });
  });
  return Array.from(map.values());
}

function withMarket(list, market) {
  return list.map((x) => ({ ...x, market }));
}

function getValueUniverse(kind, stocks = []) {
  if (kind === "kospi200") return uniqueUniverse(withMarket([...KOSPI200_SCREEN_UNIVERSE, ...DEFAULT_STOCKS], "KOSPI200"));
  if (kind === "kosdaq200") return uniqueUniverse(withMarket([...KOSDAQ200_SCREEN_UNIVERSE], "KOSDAQ200"));
  if (kind === "all" || kind === "both200") {
    return uniqueUniverse([
      ...withMarket([...KOSPI200_SCREEN_UNIVERSE, ...DEFAULT_STOCKS], "KOSPI200"),
      ...withMarket([...KOSDAQ200_SCREEN_UNIVERSE], "KOSDAQ200"),
    ]);
  }
  return uniqueUniverse(stocks.map((x) => ({ ...x, market: "등록종목" })));
}

async function runValueScanUniverse({ universe, baseQuotes = {}, onProgress }) {
  const rows = [];
  const concurrency = 8;
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < universe.length) {
      const s = universe[cursor++];
      let q = baseQuotes[s.code];
      try {
        if (!q || q.error || !q.price) {
          q = await fetchJson(`/api/quote/${s.code}?lite=1`);
        }
      } catch (err) {
        q = { code: s.code, name: s.name, error: true, errorMessage: err.message || String(err) };
      }
      const v = calcValueScore(s, q || {});
      rows.push({ ...s, q: { ...(q || {}), code: s.code, name: s.name }, ...v });
      done += 1;
      if (onProgress) onProgress({ done, total: universe.length, current: s });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, universe.length) }, () => worker()));
  return rows.sort((a, b) => b.score - a.score);
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

  const learningAdj = getAiLearningAdjustment("value", s.code, s.sector || s.tag || "기타");
  if (learningAdj !== 0) {
    score += learningAdj;
    tags.push(`AI학습 ${learningAdj > 0 ? "+" : ""}${learningAdj}`);
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, score)));
  const label = finalScore >= 78 ? "저평가 + 기술적 반등 준비" : finalScore >= 62 ? "관심 후보" : "관찰";
  return { score: finalScore, learningAdj, label, tags: tags.join(" · ") || "데이터 확인 중" };
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
  const compactQ = normalizeStockSearchText(raw);
  if (!q) return [];

  const aliases = {
    "롯데케미칼": ["롯데케미칼", "롯데 케미칼", "lottechemical", "lotte chem", "lotte chemical", "롯케"],
    "롯데정밀화학": ["롯데정밀화학", "롯데 정밀화학", "lottefinechemical", "lotte fine chemical", "롯정"],
    "동아에스티": ["동아에스티", "동아 에스티", "동아ST", "동아 st", "donga st", "dong-a st", "dongaest"],
    "에이텍": ["에이텍", "atec", "a-tech", "에이텍컴퓨터", "에이텍모빌리티"],
    "LG에너지솔루션": ["lg에너지솔루션", "엘지에너지솔루션", "lg엔솔", "엘지엔솔"],
    "SK하이닉스": ["sk하이닉스", "에스케이하이닉스", "하이닉스"],
    "삼성전자": ["삼성전자", "삼전"],
    "한미반도체": ["한미반도체", "한미"],
    "POSCO홀딩스": ["posco홀딩스", "포스코홀딩스", "포홀"],
    "HLB": ["hlb", "에이치엘비"],
    "리가켐바이오": ["리가켐", "레고켐", "레고켐바이오", "legochem", "ligachem"],
    "SOOP": ["soop", "숲", "아프리카tv", "아프리카티비"],
    "JYP Ent.": ["jyp", "jypent", "jyp엔터", "제이와이피"],
    "CJ ENM": ["cjenm", "씨제이이엔엠", "cj이엔엠"],
    "NHN KCP": ["nhnkcp", "kcp", "엔에이치엔케이씨피"],
    "SFA반도체": ["sfa반도체", "에스에프에이반도체"],
    "에스앤에스텍": ["에스앤에스텍", "sns텍", "s&s tech"],
    "와이지엔터테인먼트": ["yg", "yg엔터", "와이지", "와이지엔터"],
    "레인보우로보틱스": ["레인보우", "rainbow robotics"],
  };

  const merged = new Map();
  [...ALL_KOREAN_STOCK_CATALOG, ...currentStocks].forEach((s) => {
    if (s?.code) merged.set(s.code, s);
  });

  return Array.from(merged.values())
    .filter((s) => {
      const code = String(s.code || "");
      const name = String(s.name || "").toLowerCase();
      const tag = String(s.tag || "").toLowerCase();
      const sector = String(s.sector || "").toLowerCase();
      const nameCompact = normalizeStockSearchText(name);
      const autoAliases = buildStockAliasList(s);
      const aliasList = [...(aliases[s.name] || []), ...autoAliases];
      const aliasHit = aliasList.some((a) => {
        const aa = String(a).toLowerCase();
        const aaCompact = normalizeStockSearchText(aa);
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
    const found = [...currentStocks, ...ALL_KOREAN_STOCK_CATALOG].find((s) => s.code === code);
    return found || { code, name: code, tag: "사용자추가", sector: "사용자추가" };
  }
  const exact = searchStockCatalog(q, currentStocks).find((s) => s.name === q);
  return exact || searchStockCatalog(q, currentStocks)[0] || null;
}

async function searchStockMasterServer(keyword, options = {}) {
  const q = String(keyword || "").trim();
  const sector = options.sector || "";
  const market = options.market || "";
  if (!q && !sector) return [];
  try {
    const params = new URLSearchParams({ limit: String(options.limit || 20) });
    if (q) params.set("q", q);
    if (sector) params.set("sector", sector);
    if (market) params.set("market", market);
    const data = await fetchJson(`/api/master/search?${params.toString()}`);
    const rows = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    return rows.map((s) => ({
      code: normalizeCode(s.code),
      name: s.name || s.hts_kor_isnm || s.code,
      tag: s.tag || s.sector || s.market || "KRX",
      sector: s.sector || s.tag || "KRX",
      market: s.market || "",
      indexes: s.indexes || [],
    })).filter((s) => s.code.length === 6);
  } catch (e) {
    console.warn("KRX master search fallback", e);
    return [];
  }
}

async function searchStockKisServer(keyword) {
  const q = String(keyword || "").trim();
  if (!q) return [];
  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
    const rows = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.output)
        ? data.output
        : Array.isArray(data)
          ? data
          : [];

    return rows.map((s) => ({
      code: normalizeCode(s.code || s.pdno || s.PDNO || s.mksc_shrn_iscd || s.stck_shrn_iscd),
      name: s.name || s.prdt_name || s.hts_kor_isnm || s.kor_isnm || s.code,
      tag: s.tag || s.sector || s.market || s.rprs_mrkt_kor_name || s.mrkt_kor_name || "KIS",
      sector: s.sector || s.tag || s.market || "KIS",
      market: s.market || s.rprs_mrkt_kor_name || s.mrkt_kor_name || "",
      source: s.source || "KIS",
      indexes: s.indexes || [],
    })).filter((s) => s.code.length === 6);
  } catch (e) {
    console.warn("KIS stock search failed", e);
    return [];
  }
}

async function searchStockEverywhere(keyword, currentStocks = []) {
  const q = String(keyword || "").trim();
  if (!q) return [];

  const localRows = searchStockCatalog(q, currentStocks);
  const [masterRows, kisRows] = await Promise.all([
    searchStockMasterServer(q),
    searchStockKisServer(q),
  ]);

  const map = new Map();
  [...localRows, ...masterRows, ...kisRows].forEach((s) => {
    const code = normalizeCode(s.code);
    if (!code) return;
    map.set(code, {
      ...s,
      code,
      name: s.name || code,
      tag: s.tag || s.sector || s.market || "KRX",
      sector: s.sector || s.tag || "KRX",
    });
  });

  return Array.from(map.values()).slice(0, 15);
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

function makeFallbackHistory(selected, length = 180, period = "D") {
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

    // 핵심 수정:
    // 월봉 3Y는 36개월, 월봉 5Y는 60개월처럼 기간 단위에 맞는 날짜를 생성합니다.
    // 기존에는 fallback 날짜가 일 단위로 생성되어 월봉 3Y 선택 시 최근 36일처럼 보였습니다.
    if (period === "M") {
      d.setMonth(today.getMonth() - (length - 1 - i));
      d.setDate(1);
    } else if (period === "Y") {
      d.setFullYear(today.getFullYear() - (length - 1 - i));
      d.setMonth(0);
      d.setDate(1);
    } else {
      d.setDate(today.getDate() - (length - 1 - i));
    }

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

function minChartCandles(period, range) {
  // 일봉은 최소 60봉을 요구하되, 월봉 3Y는 36봉 자체가 정상 데이터입니다.
  if (period === "M") return Math.min(36, countByPeriod(period, range));
  if (period === "Y") return Math.min(3, countByPeriod(period, range));
  return Math.min(60, countByPeriod(period, range));
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



function analyzeGogojeoLowStructure({ swingLows = [], lastIndex, low, close, ma20, isBreakout, trendLinePrice }) {
  const previousSwingLow = swingLows
    .filter(l => l.index < lastIndex)
    .slice(-2, -1)[0];

  const recentSwingLow = swingLows
    .filter(l => l.index < lastIndex)
    .slice(-1)[0];

  const lowChangeRate = previousSwingLow && recentSwingLow
    ? ((recentSwingLow.price - previousSwingLow.price) / previousSwingLow.price) * 100
    : 0;

  const isLowRising = Boolean(previousSwingLow && recentSwingLow && recentSwingLow.price > previousSwingLow.price);
  const isLowFlat = Boolean(previousSwingLow && recentSwingLow && Math.abs(lowChangeRate) <= 1.2);
  const isLowFalling = Boolean(previousSwingLow && recentSwingLow && recentSwingLow.price < previousSwingLow.price);
  const isLowProtected = recentSwingLow ? low > recentSwingLow.price : false;
  const isLowBreakdown = recentSwingLow ? low < recentSwingLow.price : false;
  const isCloseBelowRecentLow = recentSwingLow ? close < recentSwingLow.price : false;
  const isBelowMA20 = ma20 ? close < ma20 : false;
  const isBreakoutFailure = Boolean(isBreakout && isLowBreakdown);
  const isStrongRisk = Boolean(isLowBreakdown && isBelowMA20);

  let lowStructure = "저점 확인 필요";
  let lowSignal = "중립";
  let lowComment = "최근 저점 구조가 충분하지 않아 보조 확인이 필요합니다.";
  let lowScore = 0;

  if (isBreakoutFailure) {
    lowStructure = "돌파 실패";
    lowSignal = "위험";
    lowComment = "고고저 돌파 이후 저점이 이탈되어 돌파 실패 가능성이 큽니다.";
    lowScore = -30;
  } else if (isStrongRisk || isCloseBelowRecentLow) {
    lowStructure = "저점 이탈";
    lowSignal = "강한 위험";
    lowComment = "최근 저점과 20일선 방어가 동시에 약해져 추가 하락 위험이 큽니다.";
    lowScore = -35;
  } else if (isLowBreakdown || isLowFalling) {
    lowStructure = "저점 하락";
    lowSignal = "위험";
    lowComment = "저점이 낮아지는 구조입니다. 매수세 방어 실패 가능성이 있어 관망이 우선입니다.";
    lowScore = -25;
  } else if (isLowRising && isLowProtected) {
    lowStructure = "저점 상승";
    lowSignal = "상승 전환";
    lowComment = "저점이 이전보다 높아져 매수세가 상단에서 유입되는 상승 전환 구조입니다.";
    lowScore = 18;
  } else if (isLowProtected) {
    lowStructure = "저점 보호";
    lowSignal = "관심";
    lowComment = "최근 저점은 방어 중입니다. 고고저 돌파와 거래량 동반 여부를 추가 확인합니다.";
    lowScore = 10;
  } else if (isLowFlat) {
    lowStructure = "저점 횡보";
    lowSignal = "관찰";
    lowComment = "저점이 크게 무너지지는 않았지만 상승 저점 구조는 아직 약합니다.";
    lowScore = 3;
  }

  return {
    previousSwingLow,
    recentSwingLow,
    lowChangeRate: Number(lowChangeRate.toFixed(2)),
    lowStructure,
    lowSignal,
    lowComment,
    lowScore,
    isLowRising,
    isLowFlat,
    isLowFalling,
    isLowProtected,
    isLowBreakdown,
    isCloseBelowRecentLow,
    isBreakoutFailure,
    isStrongRisk,
    trendLinePrice,
  };
}


function calculateGogojeoSignal(candles, options = {}) {
  const lookback = options.lookback || 120;
  const swingWindow = options.swingWindow || 5;
  const minGap = options.minGap || 10;

  const data = candles.slice(-lookback);

  if (data.length < 24) {
    return {
      status: "ERROR",
      message: "데이터가 부족합니다. 최소 24봉 이상 필요합니다."
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
  const intradayBreakoutRate = ((high - trendLinePrice) / trendLinePrice) * 100;
  const open = Number(lastCandle.open);
  const bodyRate = open ? ((close - open) / open) * 100 : 0;
  const trendDropRate = ((selectedHigh1.price - selectedHigh2.price) / selectedHigh1.price) * 100;
  const trendBars = Math.max(1, selectedHigh2.index - selectedHigh1.index);
  const trendSlopePer20Bars = (trendDropRate / trendBars) * 20;

  const isBreakout = close > trendLinePrice;
  const isCloseBreakout = breakoutRate >= 0.3;
  const isIntradayPierce = high > trendLinePrice && close <= trendLinePrice;
  const isStrongBreakout = breakoutRate >= 3;
  const isBullishCandle = close > open && bodyRate >= 0.2;
  const isVolumeSpike = volume >= avgVolume20 * 1.5;
  const isVolumeConfirm = volume >= avgVolume20 * 1.25;
  const isRealBreakout = isCloseBreakout && isVolumeConfirm && isBullishCandle;
  const isWeakBreakout = isBreakout && (!isVolumeConfirm || !isBullishCandle);
  const isFalseBreakoutRisk = isIntradayPierce || isWeakBreakout;
  const isTrendTooSteep = trendSlopePer20Bars >= 18;
  const isAboveMA20 = close > ma20;
  const isMAAligned = ma5 > ma20;

  const lowStructureInfo = analyzeGogojeoLowStructure({
    swingLows,
    lastIndex,
    low,
    close,
    ma20,
    isBreakout,
    trendLinePrice,
  });

  const previousSwingLow = lowStructureInfo.previousSwingLow;
  const recentSwingLow = lowStructureInfo.recentSwingLow;
  const isLowProtected = lowStructureInfo.isLowProtected;
  const isLowRising = lowStructureInfo.isLowRising;
  const isLowBreakdown = lowStructureInfo.isLowBreakdown;
  const isBreakoutFailure = lowStructureInfo.isBreakoutFailure;
  const isStrongRisk = lowStructureInfo.isStrongRisk;

  const closePosition =
    high === low ? 0 : ((close - low) / (high - low)) * 100;

  const isStrongClose = closePosition >= 70;

  let score = 0;

  if (isBreakout) score += 12;
  if (isCloseBreakout) score += 8;
  if (isRealBreakout) score += 18;
  if (isStrongBreakout) score += 10;
  if (isVolumeSpike) score += 14;
  else if (isVolumeConfirm) score += 8;
  if (isBullishCandle) score += 8;
  if (isFalseBreakoutRisk) score -= 18;
  if (isTrendTooSteep) score -= 12;
  if (isAboveMA20) score += 10;
  if (isMAAligned) score += 10;
  score += lowStructureInfo.lowScore;
  if (isStrongClose) score += 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = "제외";

  if (isBreakoutFailure) grade = "돌파 실패";
  else if (isStrongRisk) grade = "강한 위험신호";
  else if (isLowBreakdown) grade = "위험신호";
  else if (isFalseBreakoutRisk) grade = "가짜 돌파 의심";
  else if (isTrendTooSteep) grade = "급경사 추세선 제외";
  else if (score >= 82 && isLowRising && isRealBreakout) grade = "강한 상승 패턴";
  else if (score >= 80) grade = "강한 매수 후보";
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
    previousSwingLow,
    recentSwingLow,
    lowStructure: lowStructureInfo.lowStructure,
    lowSignal: lowStructureInfo.lowSignal,
    lowComment: lowStructureInfo.lowComment,
    lowChangeRate: lowStructureInfo.lowChangeRate,
    lowScore: lowStructureInfo.lowScore,
    breakoutQuality: isRealBreakout ? "진짜 돌파" : isFalseBreakoutRisk ? "가짜 돌파 의심" : isBreakout ? "약한 돌파" : "미돌파",
    breakoutComment: isRealBreakout
      ? "종가 돌파·거래량·양봉 조건이 함께 충족되어 신뢰도가 높습니다."
      : isIntradayPierce
        ? "장중에는 추세선을 넘었지만 종가 기준으로 확정되지 않아 가짜 돌파 위험이 있습니다."
        : isWeakBreakout
          ? "종가 돌파는 있으나 거래량 또는 양봉 확인이 약해 한 박자 더 확인이 필요합니다."
          : "아직 하락 추세선 상향 돌파가 확정되지 않았습니다.",
    trendSlopePer20Bars: Number(trendSlopePer20Bars.toFixed(2)),
    isTrendTooSteep,
    checks: {
      isBreakout,
      isCloseBreakout,
      isIntradayPierce,
      isStrongBreakout,
      isBullishCandle,
      isVolumeSpike,
      isVolumeConfirm,
      isRealBreakout,
      isFalseBreakoutRisk,
      isTrendTooSteep,
      isAboveMA20,
      isMAAligned,
      isLowProtected,
      isLowRising,
      isLowBreakdown,
      isBreakoutFailure,
      isStrongRisk,
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
    previousSwingLow: signal.previousSwingLow,
    recentSwingLow: signal.recentSwingLow,
    lowStructure: signal.lowStructure,
    lowSignal: signal.lowSignal,
    lowComment: signal.lowComment,
    lowChangeRate: signal.lowChangeRate,
    lowScore: signal.lowScore,
    breakoutQuality: signal.breakoutQuality,
    breakoutComment: signal.breakoutComment,
    trendSlopePer20Bars: signal.trendSlopePer20Bars,
    isTrendTooSteep: signal.isTrendTooSteep,
    checks: signal.checks,
  };
}

function gogojeoGradeColor(grade) {
  if (grade === "강한 상승 패턴") return "up";
  if (grade === "강한 매수 후보") return "up";
  if (grade === "관심 종목") return "up";
  if (grade === "관찰") return "";
  if (grade === "위험신호" || grade === "강한 위험신호" || grade === "돌파 실패" || grade === "가짜 돌파 의심" || grade === "급경사 추세선 제외") return "down";
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
  if (!candles || candles.length < 24) {
    return { status: "ERROR", signalName: "이동평균 눌림", score: 0, grade: "제외", message: "최소 24봉 이상 필요합니다." };
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
  if (!candles || candles.length < 24) {
    return { status: "ERROR", signalName: "볼린저 수축", score: 0, grade: "제외", message: "최소 24봉 이상 필요합니다." };
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
  if (!candles || candles.length < 24) {
    return { status: "ERROR", signalName: "거래량 돌파", score: 0, grade: "제외", message: "최소 24봉 이상 필요합니다." };
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
  if (!candles || candles.length < 24) {
    return { status: "ERROR", signalName: "RSI 반등", score: 0, grade: "제외", message: "최소 24봉 이상 필요합니다." };
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



function calcRSISeries(data, period = 14) {
  if (!Array.isArray(data)) return [];
  return data.map((_, i) => {
    if (i < period) return null;
    const slice = data.slice(i - period, i + 1);
    let gains = 0;
    let losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const diff = Number(slice[j].close) - Number(slice[j - 1].close);
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
  });
}

function calcBollingerSeries(data, period = 20, multiplier = 2) {
  if (!Array.isArray(data)) return [];
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1).map((d) => Number(d.close || 0));
    const mean = safeAvg(slice);
    const sd = stdDev(slice);
    return {
      upper: Math.round(mean + sd * multiplier),
      mid: Math.round(mean),
      lower: Math.round(mean - sd * multiplier),
    };
  });
}

function detectPsychPatterns(data) {
  const patterns = [];
  const n = data?.length || 0;
  if (n < 24) return patterns;

  for (let i = 8; i < n - 1; i++) {
    const recent = data.slice(i - 7, i + 1);
    const lows = recent.map((d) => Number(d.low));
    const minLow = Math.min(...lows);
    const maxLow = Math.max(...lows);
    const close = Number(data[i].close);
    const prevClose = Number(data[i - 1].close);
    if (minLow > 0 && (maxLow - minLow) / minLow < 0.025 && close > prevClose * 1.012) {
      patterns.push({
        index: i,
        type: "double_bottom",
        label: "이중바닥 심리",
        sentiment: "bullish",
        confidence: Math.min(92, 68 + Math.round(((close / prevClose) - 1) * 900)),
        message: "저점 방어가 반복되며 공포 매물이 줄어드는 구조입니다.",
      });
    }
  }

  for (let i = 14; i < n - 1; i++) {
    const slice = data.slice(i - 12, i + 1);
    const highs = slice.map((d) => Number(d.high));
    const peak = Math.max(...highs);
    const peakIdx = highs.indexOf(peak);
    if (peakIdx > 3 && peakIdx < 9) {
      const leftShoulder = Math.max(...highs.slice(0, peakIdx));
      const rightShoulder = Math.max(...highs.slice(peakIdx + 1));
      if (peak > 0 && Math.abs(leftShoulder - rightShoulder) / peak < 0.035 && peak > leftShoulder * 1.018) {
        patterns.push({
          index: i,
          type: "head_shoulders",
          label: "헤드앤숄더 심리",
          sentiment: "bearish",
          confidence: 70 + Math.min(18, Math.round(((peak / leftShoulder) - 1) * 350)),
          message: "추격 매수세가 약해지고 고점 부담이 커지는 구조입니다.",
        });
      }
    }
  }

  return patterns.slice(-6);
}

function analyzeMarketPsychology(data, rsiSeries) {
  const safe = Array.isArray(data) ? data.filter((d) => Number(d.close) > 0) : [];
  const last = safe[safe.length - 1];
  if (!last || safe.length < 10) {
    return {
      phase: "데이터 부족",
      phaseColor: "#94a3b8",
      description: "심리 분석을 위해 최소 10봉 이상의 가격 데이터가 필요합니다.",
      biases: ["데이터 부족"],
      fearGreedScore: 50,
      volumeAnomaly: false,
      rsiValue: 50,
      priceChange5: "0.00",
      action: "관망",
    };
  }

  const base = safe[Math.max(0, safe.length - 5)];
  const prev20 = safe.slice(-20);
  const avgVol = prev20.reduce((s, d) => s + Number(d.volume || 0), 0) / Math.max(1, prev20.length);
  const lastRSI = Number([...rsiSeries].reverse().find((v) => v !== null && Number.isFinite(Number(v))) ?? calcRSI(safe, 14) ?? 50);
  const priceChange5 = base?.open ? ((Number(last.close) - Number(base.open)) / Number(base.open)) * 100 : 0;
  const volumeAnomaly = avgVol > 0 && Number(last.volume || 0) > avgVol * 1.8;

  let phase = "중립 (관망)";
  let phaseColor = "#94a3b8";
  let description = "뚜렷한 방향성 없이 눈치 보기 장세입니다. 거래량 감소와 함께 다음 방향성을 결정하는 변곡점이 형성될 수 있습니다.";
  let biases = ["현상 유지 편향", "모호성 회피", "군집 행동 대기"];
  let action = "확인 후 대응";

  if (lastRSI > 75 && priceChange5 > 8) {
    phase = "극단적 탐욕 (FOMO)";
    phaseColor = "#ef4444";
    description = "시장 참여자들이 상승 기회를 놓칠까 두려워 추격 매수하는 구간입니다. 신규 매수는 고점 물림 위험이 커지므로 분할 대응과 손절 기준이 필요합니다.";
    biases = ["FOMO", "과잉 자신감 편향", "군집 행동"];
    action = "추격매수 자제";
  } else if (lastRSI > 60) {
    phase = "탐욕";
    phaseColor = "#f97316";
    description = "낙관론이 우세하며 매수 심리가 강합니다. 단기 추가 상승 가능성은 있으나 과매수 진입을 경계해야 합니다.";
    biases = ["앵커링 편향", "최근성 편향", "확증 편향"];
    action = "눌림 확인";
  } else if (lastRSI < 25 && priceChange5 < -8) {
    phase = "극단적 공포 (패닉)";
    phaseColor = "#22c55e";
    description = "패닉 셀링이 진행 중입니다. 감정 매물이 과도하게 출회되는 구간으로, 거래량 동반 반등이 나오면 중기 기회가 형성될 수 있습니다.";
    biases = ["손실 회피 편향", "패닉 셀링", "가용성 편향"];
    action = "분할 관심";
  } else if (lastRSI < 40) {
    phase = "공포";
    phaseColor = "#84cc16";
    description = "추가 하락 우려로 관망세가 짙습니다. 지지선 부근에서 거래량을 동반한 반등 시그널을 확인할 필요가 있습니다.";
    biases = ["손실 회피 편향", "현상 유지 편향", "비관론 편향"];
    action = "반등 확인";
  }

  const rawScore = lastRSI * 0.62 + priceChange5 * 2.1 + (volumeAnomaly ? 7 : 0) + 18;
  const fearGreedScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  return {
    phase,
    phaseColor,
    description,
    biases,
    fearGreedScore,
    volumeAnomaly,
    rsiValue: lastRSI,
    priceChange5: priceChange5.toFixed(2),
    action,
  };
}

function classifyReturn(returnPct, threshold = 2) {
  if (returnPct >= threshold) return "up";
  if (returnPct <= -threshold) return "down";
  return "side";
}

function decideAutoPrediction({ psych, activeTechnique, gogoSignal }) {
  let score = 0;
  const reasons = [];

  const techScore = Number(activeTechnique?.score || 0);
  if (techScore >= 75) {
    score += 24;
    reasons.push(`${activeTechnique?.name} 강세 점수`);
  } else if (techScore >= 60) {
    score += 14;
    reasons.push(`${activeTechnique?.name} 관심 점수`);
  } else if (techScore <= 35) {
    score -= 12;
    reasons.push(`${activeTechnique?.name} 약세 점수`);
  }

  if (gogoSignal?.status === "OK" && gogoSignal?.checks?.isBreakout) {
    score += 18;
    reasons.push("고고저 돌파");
  }

  if (psych?.fearGreedScore >= 78) {
    score -= 18;
    reasons.push("극단 탐욕/FOMO 경계");
  } else if (psych?.fearGreedScore >= 65) {
    score += 7;
    reasons.push("탐욕 모멘텀");
  } else if (psych?.fearGreedScore <= 22) {
    score += 12;
    reasons.push("극단 공포 반등 후보");
  } else if (psych?.fearGreedScore <= 38) {
    score += 7;
    reasons.push("공포권 반등 감시");
  }

  if (psych?.volumeAnomaly) {
    score += 8;
    reasons.push("거래량 이상 감지");
  }

  const rsi = Number(psych?.rsiValue || 50);
  if (rsi >= 75) score -= 12;
  else if (rsi <= 30) score += 10;
  else if (rsi >= 55 && rsi <= 68) score += 6;

  let prediction = "side";
  if (score >= 18) prediction = "up";
  else if (score <= -12) prediction = "down";

  return {
    prediction,
    score,
    reasons: reasons.length ? reasons : ["중립권 혼조"],
  };
}

function buildSignalSet({ psych, activeTechnique, gogoSignal }) {
  return {
    technique: activeTechnique?.key || "unknown",
    techniqueName: activeTechnique?.name || "-",
    techniqueScore: Number(activeTechnique?.score || 0),
    gogoBreakout: Boolean(gogoSignal?.status === "OK" && gogoSignal?.checks?.isBreakout),
    volumeAnomaly: Boolean(psych?.volumeAnomaly),
    psychologyPhase: psych?.phase || "-",
    fearGreedScore: Number(psych?.fearGreedScore || 50),
    rsi: Number(psych?.rsiValue || 50),
  };
}

function signalStatKey(entry) {
  const s = entry.signalSet || {};
  const keys = [];
  if (s.technique) keys.push(s.techniqueName || s.technique);
  if (s.gogoBreakout) keys.push("고고저 돌파");
  if (s.volumeAnomaly) keys.push("거래량 이상");
  if (s.psychologyPhase) keys.push(s.psychologyPhase);
  return keys.slice(0, 3).join(" + ") || "기본 신호";
}

function usePsychLearningLog() {
  const [log, setLog] = useState(() => loadLS("alpha_psych_learning_log", []));
  const [autoEnabled, setAutoEnabled] = useState(() => loadLS("alpha_auto_learning_enabled", true));

  useEffect(() => saveLS("alpha_auto_learning_enabled", autoEnabled), [autoEnabled]);

  const saveLog = useCallback((updater) => {
    setLog((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveLS("alpha_psych_learning_log", next);
      return next;
    });
  }, []);

  const addEntry = useCallback((entry) => {
    saveLog((prev) => {
      const next = [{ ...entry, id: Date.now(), mode: entry.mode || "manual", ts: new Date().toISOString() }, ...prev].slice(0, 300);
      return next;
    });
  }, [saveLog]);

  const updateResult = useCallback((id, actual) => {
    saveLog((prev) => prev.map((e) => e.id === id ? { ...e, actual, correct: e.prediction === actual, status: "done" } : e));
  }, [saveLog]);

  const addAutoPrediction = useCallback((entry) => {
    if (!autoEnabled) return { saved: false, reason: "disabled" };

    const code = String(entry.code || "");
    const baseDate = String(entry.baseDate || "");
    if (!code || !baseDate) return { saved: false, reason: "missing" };

    let saved = false;
    saveLog((prev) => {
      const exists = prev.some((e) =>
        e.mode === "auto" &&
        String(e.code) === code &&
        String(e.baseDate) === baseDate &&
        Number(e.horizon || 5) === Number(entry.horizon || 5)
      );
      if (exists) return prev;

      saved = true;
      return [{
        ...entry,
        id: Date.now(),
        mode: "auto",
        status: "pending",
        actual: undefined,
        correct: undefined,
        ts: new Date().toISOString(),
      }, ...prev].slice(0, 300);
    });

    return { saved };
  }, [autoEnabled, saveLog]);

  const evaluateAutoPredictions = useCallback((code, chartData, threshold = 2) => {
    if (!Array.isArray(chartData) || !chartData.length) return { evaluated: 0 };

    let evaluated = 0;
    const normalizedCode = String(code || "");
    const byDate = new Map(chartData.map((d, i) => [String(d.date), { d, i }]));

    saveLog((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        if (entry.mode !== "auto" || entry.status === "done") return entry;
        if (String(entry.code) !== normalizedCode) return entry;

        const found = byDate.get(String(entry.baseDate));
        if (!found) return entry;

        const horizon = Number(entry.horizon || 5);
        const targetIndex = found.i + horizon;
        if (targetIndex >= chartData.length) return entry;

        const basePrice = Number(entry.basePrice || found.d.close || 0);
        const targetPrice = Number(chartData[targetIndex].close || 0);
        if (!basePrice || !targetPrice) return entry;

        const returnPct = ((targetPrice - basePrice) / basePrice) * 100;
        const actual = classifyReturn(returnPct, threshold);
        const correct = actual === entry.prediction;
        evaluated += 1;
        changed = true;

        return {
          ...entry,
          status: "done",
          actual,
          correct,
          targetDate: chartData[targetIndex].date,
          targetPrice,
          returnPct: Number(returnPct.toFixed(2)),
          evaluatedAt: new Date().toISOString(),
        };
      });

      return changed ? next : prev;
    });

    return { evaluated };
  }, [saveLog]);

  const clearLearning = useCallback(() => {
    saveLog([]);
  }, [saveLog]);

  const done = log.filter((e) => e.status === "done" || e.actual !== undefined);
  const pending = log.filter((e) => e.mode === "auto" && e.status !== "done");
  const accuracy = done.length ? Math.round(done.filter((e) => e.correct).length / done.length * 100) : null;

  const signalStats = Object.values(done.reduce((acc, entry) => {
    const key = signalStatKey(entry);
    acc[key] = acc[key] || { key, total: 0, hit: 0 };
    acc[key].total += 1;
    if (entry.correct) acc[key].hit += 1;
    return acc;
  }, {}))
    .map((x) => ({
      ...x,
      rate: x.total ? Math.round((x.hit / x.total) * 100) : 0,
      weight: x.total >= 3 ? Number((1 + ((x.hit / x.total) - 0.5) * 0.6).toFixed(2)) : 1,
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);

  return {
    log,
    pending,
    done,
    signalStats,
    addEntry,
    updateResult,
    accuracy,
    addAutoPrediction,
    evaluateAutoPredictions,
    clearLearning,
    autoEnabled,
    setAutoEnabled,
  };
}


function FearGreedGauge({ score = 50 }) {
  const angle = -90 + (Math.max(0, Math.min(100, Number(score))) / 100) * 180;
  return (
    <div className="fear-greed-gauge">
      <div className="fear-greed-arc" />
      <div className="fear-greed-inner" />
      <div className="fear-greed-needle" style={{ transform: `rotate(${angle}deg)` }} />
      <div className="fear-greed-center" />
      <div className="fear-greed-score">{score}</div>
    </div>
  );
}

function PsychologyPanel({ selected, name, last, psych, patterns, log, pending = [], done = [], signalStats = [], autoPrediction, addEntry, updateResult, accuracy, autoEnabled, setAutoEnabled, clearLearning }) {
  const [tab, setTab] = useState("psychology");

  const submitPrediction = (prediction) => {
    if (!last) return;
    addEntry({
      code: selected?.code || selected?.symbol,
      name,
      price: Number(last.close || selected?.price || 0),
      phase: psych.phase,
      rsi: psych.rsiValue,
      fearGreedScore: psych.fearGreedScore,
      prediction,
    });
  };

  const meters = [
    {
      label: "RSI 심리",
      value: psych.rsiValue,
      note: psych.rsiValue >= 70 ? "과매수" : psych.rsiValue <= 30 ? "과매도" : "중립",
      color: psych.rsiValue >= 70 ? "#ef4444" : psych.rsiValue <= 30 ? "#22c55e" : "#a78bfa",
    },
    {
      label: "공포·탐욕",
      value: psych.fearGreedScore,
      note: psych.phase,
      color: psych.phaseColor,
    },
    {
      label: "5봉 가격 변화",
      value: Math.min(100, Math.max(0, Number(psych.priceChange5) + 50)),
      note: `${psych.priceChange5}%`,
      color: Number(psych.priceChange5) >= 0 ? "#00ff88" : "#ff4466",
    },
  ];

  return (
    <div className="psych-panel">
      <div className="psych-panel-head">
        <div>
          <div className="psych-panel-title">심리분석 · {name}</div>
          <div className="sub">RSI, 5봉 변화율, 거래량 이상, 패턴 심리를 종합합니다.</div>
        </div>
        <span className="tag yellow">PSYCHOLOGY</span>
      </div>

      <div className="psych-body">
        <div className="psych-tabs">
          <button className={`psych-tab-btn ${tab === "psychology" ? "active" : ""}`} onClick={() => setTab("psychology")}>🧠 심리분석</button>
          <button className={`psych-tab-btn ${tab === "learning" ? "active" : ""}`} onClick={() => setTab("learning")}>🎯 자체학습</button>
        </div>

        {tab === "psychology" && (
          <div className="psych-grid">
            <div className="psych-card" style={{ textAlign: "center" }}>
              <div className="card-title">공포·탐욕 지수</div>
              <FearGreedGauge score={psych.fearGreedScore} />
              <div className="psych-phase" style={{ color: psych.phaseColor }}>{psych.phase}</div>
              <div className="sub">전략: <b>{psych.action}</b></div>
            </div>

            <div className="psych-card">
              <div className="card-title">현재 심리 해석</div>
              <div className="psych-desc" style={{ borderLeftColor: psych.phaseColor }}>{psych.description}</div>
              <div className="psych-bias-list">
                {psych.biases.map((b) => <div className="psych-bias" key={b}>{b}</div>)}
              </div>

              <div style={{ height: 10 }} />
              {meters.map((m) => (
                <div className="psych-meter" key={m.label}>
                  <div className="psych-meter-row"><span>{m.label}</span><b style={{ color: m.color }}>{m.note}</b></div>
                  <div className="psych-meter-track">
                    <div className="psych-meter-fill" style={{ width: `${Math.max(0, Math.min(100, Number(m.value)))}%`, background: m.color }} />
                  </div>
                </div>
              ))}

              {psych.volumeAnomaly && (
                <div className="error" style={{ marginTop: 10, color: "#ffd447", borderColor: "#ffd44766", background: "#ffd44711" }}>
                  ⚡ 거래량 이상 감지: 평균 대비 180% 이상 거래량입니다. 세력 개입, 뉴스, 공포/탐욕 급변 가능성을 확인하세요.
                </div>
              )}
            </div>

            <div className="psych-card" style={{ gridColumn: "1 / -1" }}>
              <div className="card-title">감지된 심리 패턴</div>
              <div className="psych-patterns">
                {patterns.length ? patterns.map((p, i) => (
                  <div className="psych-pattern" key={`${p.type}-${i}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <b className={p.sentiment === "bullish" ? "up" : "down"}>{p.sentiment === "bullish" ? "▲" : "▼"} {p.label}</b>
                      <span className="sub">{p.confidence}%</span>
                    </div>
                    <div className="sub" style={{ marginTop: 6, lineHeight: 1.55 }}>{p.message}</div>
                  </div>
                )) : <div className="sub">명확한 심리 패턴은 아직 감지되지 않았습니다.</div>}
              </div>
            </div>
          </div>
        )}

        {tab === "learning" && (
          <div className="psych-learning-grid">
            <div className="psych-card">
              <div className="card-title">자동학습 엔진 — 자체 조회 기반</div>
              <div className="sub" style={{ lineHeight: 1.7, marginTop: 8 }}>
                차트 분석 시점의 AI 예측을 자동 저장하고, 이후 같은 종목의 차트 데이터가 충분히 쌓이면 5봉 후 실제 수익률로 적중 여부를 자동 판정합니다.
              </div>

              <div className="auto-learning-summary">
                <div className="auto-learn-card"><span className="sub">대기 중</span><b>{pending.length}</b></div>
                <div className="auto-learn-card"><span className="sub">판정 완료</span><b>{done.length}</b></div>
                <div className="auto-learn-card"><span className="sub">정확도</span><b>{accuracy !== null ? `${accuracy}%` : "-"}</b></div>
                <div className="auto-learn-card"><span className="sub">현재 예측</span><b className={autoPrediction?.prediction === "up" ? "up" : autoPrediction?.prediction === "down" ? "down" : ""}>{autoPrediction?.prediction === "up" ? "상승" : autoPrediction?.prediction === "down" ? "하락" : "횡보"}</b></div>
              </div>

              <div className="psych-card" style={{ padding: 12, marginTop: 10 }}>
                <div className="card-title">현재 자동 예측 근거</div>
                <div className="sub" style={{ marginTop: 7, lineHeight: 1.7 }}>
                  예측 점수: <b>{autoPrediction?.score ?? 0}</b><br />
                  근거: {autoPrediction?.reasons?.join(" + ") || "-"}<br />
                  기준: 5봉 후 수익률 +2% 이상 상승, -2% 이하 하락, 그 외 횡보
                </div>
              </div>

              <div className="auto-learn-controls">
                <button className="btn" onClick={() => setAutoEnabled(!autoEnabled)}>
                  자동 예측 저장 {autoEnabled ? "ON" : "OFF"}
                </button>
                <button className="btn red" onClick={() => {
                  if (confirm("자동학습 기록을 초기화할까요?")) clearLearning();
                }}>
                  학습 초기화
                </button>
              </div>
            </div>

            <div className="psych-card">
              <div className="card-title">신호별 적중률 / 가중치</div>
              <div className="sub" style={{ marginTop: 6, lineHeight: 1.6 }}>
                판정 완료 데이터 기준으로 신호별 적중률과 가중치를 계산합니다. 표본 3건 미만은 가중치 1.00으로 유지합니다.
              </div>
              <div style={{ marginTop: 10, overflowX: "auto" }}>
                <table className="signal-stat-table">
                  <thead><tr><th>신호 조합</th><th>건수</th><th>적중</th><th>적중률</th><th>가중치</th></tr></thead>
                  <tbody>
                    {signalStats.length ? signalStats.slice(0, 8).map((s) => (
                      <tr key={s.key}>
                        <td>{s.key}</td>
                        <td>{s.total}</td>
                        <td>{s.hit}</td>
                        <td className={s.rate >= 60 ? "up" : "down"}>{s.rate}%</td>
                        <td>×{s.weight}</td>
                      </tr>
                    )) : <tr><td colSpan="5" className="sub">판정 완료 데이터가 쌓이면 표시됩니다.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="psych-card" style={{ gridColumn: "1 / -1" }}>
              <div className="card-title">자동 예측 기록</div>
              <div className="learning-log" style={{ marginTop: 10 }}>
                {log.length ? log.map((entry) => (
                  <div className={`learning-entry ${entry.status === "done" ? "done" : "pending"}`} key={entry.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <b>{entry.name}</b>
                      <span className="sub">{new Date(entry.ts).toLocaleDateString("ko-KR")}</span>
                    </div>
                    <div className="sub" style={{ lineHeight: 1.6 }}>
                      기준 {entry.baseDate || "-"} · 기준가 {fmtPrice(entry.basePrice || entry.price)} · 예측 {entry.prediction === "up" ? "상승" : entry.prediction === "down" ? "하락" : "횡보"} · 사유 {entry.predictionReason || entry.phase || "-"}
                    </div>
                    {entry.status === "done" || entry.actual !== undefined ? (
                      <div style={{ marginTop: 7 }} className={entry.correct ? "up" : "down"}>
                        {entry.correct ? "✓ 적중" : "✗ 빗나감"} · 실제 {entry.actual === "up" ? "상승" : entry.actual === "down" ? "하락" : "횡보"} · 수익률 {entry.returnPct ?? "-"}%
                      </div>
                    ) : (
                      <div style={{ marginTop: 7 }} className="loading">
                        판정 대기 · 5봉 후 데이터 확보 시 자동 평가
                      </div>
                    )}
                  </div>
                )) : <div className="sub">차트 분석을 실행하면 자동 예측 기록이 쌓입니다.</div>}
              </div>
            </div>
          </div>
        )}      </div>
    </div>
  );
}


function calcSupportResistance(candles, lookback = 90) {
  const data = candles.slice(-lookback);
  if (data.length < 20) return { support: null, resistance: null, supportZone: null, resistanceZone: null, target: null, stop: null };

  const lows = data.map((d) => Number(d.low)).filter(Boolean);
  const highs = data.map((d) => Number(d.high)).filter(Boolean);
  const closes = data.map((d) => Number(d.close)).filter(Boolean);
  const lastClose = closes[closes.length - 1] || 0;
  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...highs);
  const span = Math.max(1, maxHigh - minLow);
  const bucketSize = Math.max(1, span / 28);

  const bucket = (price) => Math.round((price - minLow) / bucketSize) * bucketSize + minLow;
  const lowBuckets = {};
  const highBuckets = {};

  lows.forEach((p) => {
    const k = Math.round(bucket(p));
    lowBuckets[k] = (lowBuckets[k] || 0) + 1;
  });
  highs.forEach((p) => {
    const k = Math.round(bucket(p));
    highBuckets[k] = (highBuckets[k] || 0) + 1;
  });

  const supportCandidates = Object.entries(lowBuckets)
    .map(([price, count]) => ({ price: Number(price), count }))
    .filter((x) => x.price <= lastClose)
    .sort((a, b) => b.count - a.count || b.price - a.price);

  const resistanceCandidates = Object.entries(highBuckets)
    .map(([price, count]) => ({ price: Number(price), count }))
    .filter((x) => x.price >= lastClose)
    .sort((a, b) => b.count - a.count || a.price - b.price);

  const support = supportCandidates[0] || { price: Math.min(...lows.slice(-20)), count: 1 };
  const resistance = resistanceCandidates[0] || { price: Math.max(...highs.slice(-20)), count: 1 };

  const zone = Math.max(1, span * 0.012);
  return {
    support,
    resistance,
    supportZone: [Math.max(1, support.price - zone), support.price + zone],
    resistanceZone: [resistance.price - zone, resistance.price + zone],
    target: Math.round(resistance.price),
    stop: Math.round(support.price * 0.985),
    lastClose,
  };
}

function calculateSupportResistanceSignal(candles) {
  if (!candles || candles.length < 24) {
    return { status: "ERROR", signalName: "지지·저항", score: 0, grade: "제외", message: "최소 24봉 이상 필요합니다." };
  }

  const sr = calcSupportResistance(candles, 120);
  const last = candles[candles.length - 1];
  const close = Number(last.close || 0);
  const support = Number(sr.support?.price || 0);
  const resistance = Number(sr.resistance?.price || 0);

  const distSupport = support ? ((close - support) / support) * 100 : 999;
  const distResistance = resistance ? ((resistance - close) / close) * 100 : 999;

  let score = 35;
  if (distSupport >= 0 && distSupport <= 3) score += 25;
  if (distResistance >= 2 && distResistance <= 10) score += 15;
  if (sr.support?.count >= 3) score += 15;
  if (sr.resistance?.count >= 3) score += 10;

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "지지·저항",
    score,
    grade,
    action: distSupport <= 3 ? "지지선 근접 · 반등 확인" : "지지·저항 구간 확인",
    support,
    resistance,
    distSupport: Number(distSupport.toFixed(2)),
    distResistance: Number(distResistance.toFixed(2)),
    sr,
  };
}

function calculateBoxBreakoutSignal(candles) {
  if (!candles || candles.length < 24) {
    return { status: "ERROR", signalName: "박스권 돌파", score: 0, grade: "제외", message: "최소 24봉 이상 필요합니다." };
  }

  const recent = candles.slice(-40);
  const prev = recent.slice(0, -1);
  const last = recent[recent.length - 1];
  const upper = Math.max(...prev.map((d) => Number(d.high)));
  const lower = Math.min(...prev.map((d) => Number(d.low)));
  const close = Number(last.close);
  const volume = Number(last.volume || 0);
  const avgVol = prev.reduce((s, d) => s + Number(d.volume || 0), 0) / Math.max(1, prev.length);
  const widthRate = ((upper - lower) / Math.max(1, close)) * 100;
  const isTight = widthRate <= 18;
  const isBreakout = close > upper;
  const isNearUpper = close >= upper * 0.985;
  const volOk = avgVol > 0 ? volume >= avgVol * 1.25 : false;

  let score = 30;
  if (isTight) score += 20;
  if (isNearUpper) score += 20;
  if (isBreakout) score += 20;
  if (volOk) score += 10;

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status: "OK",
    signalName: "박스권 돌파",
    score,
    grade,
    action: isBreakout ? "박스 상단 돌파" : isNearUpper ? "박스 상단 근접" : "박스권 관찰",
    upper: Math.round(upper),
    lower: Math.round(lower),
    widthRate: Number(widthRate.toFixed(2)),
    isBreakout,
    isNearUpper,
    volOk,
  };
}

/** 삼각수렴 — 고점을 연결한 상단 추세선과 저점을 연결한 하단 추세선이 좁아지는 패턴 */
function calculateTriangleSignal(candles, options = {}) {
  const lookback = options.lookback || 90;
  const swingWindow = options.swingWindow || 3;
  if (!candles || candles.length < 30) {
    return { status: "ERROR", signalName: "삼각수렴", score: 0, grade: "제외", message: "최소 30봉 이상 필요합니다." };
  }

  const sliceLen = Math.min(lookback, candles.length);
  const offset = candles.length - sliceLen;
  const data = candles.slice(-sliceLen);
  const n = data.length;

  const swingHighs = [];
  const swingLows = [];
  for (let i = swingWindow; i < n - swingWindow; i++) {
    const hi = Number(data[i].high);
    const lo = Number(data[i].low);
    let isHigh = true;
    let isLow = true;
    for (let j = i - swingWindow; j <= i + swingWindow; j++) {
      if (j === i) continue;
      if (Number(data[j].high) >= hi) isHigh = false;
      if (Number(data[j].low) <= lo) isLow = false;
    }
    if (isHigh) swingHighs.push({ index: offset + i, price: hi });
    if (isLow) swingLows.push({ index: offset + i, price: lo });
  }

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return { status: "NO_SIGNAL", signalName: "삼각수렴", score: 0, grade: "제외", message: "유효한 스윙 고점/저점이 부족합니다." };
  }

  const regress = (points) => {
    const m = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    points.forEach((p) => {
      sumX += p.index; sumY += p.price; sumXY += p.index * p.price; sumXX += p.index * p.index;
    });
    const denom = m * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (m * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / m;
    return { slope, intercept, valueAt: (i) => slope * i + intercept };
  };

  const upperReg = regress(swingHighs);
  const lowerReg = regress(swingLows);

  const lastIndex = candles.length - 1;
  const firstIndex = Math.min(swingHighs[0].index, swingLows[0].index);
  const widthAt = (i) => Math.max(0, upperReg.valueAt(i) - lowerReg.valueAt(i));
  const widthStart = widthAt(firstIndex);
  const widthNow = widthAt(lastIndex);
  const priceRef = Number(data[n - 1].close) || 1;
  const widthNowRate = (widthNow / priceRef) * 100;
  const isConverging = widthStart > 0 && widthNow < widthStart * 0.85;

  if (!isConverging || widthNow <= 0) {
    return { status: "NO_SIGNAL", signalName: "삼각수렴", score: 0, grade: "제외", message: "고점·저점 추세선이 수렴하지 않아 삼각형 패턴이 아닙니다." };
  }

  const flatThreshold = priceRef * 0.0006;
  const upperFlat = Math.abs(upperReg.slope) <= flatThreshold;
  const lowerFlat = Math.abs(lowerReg.slope) <= flatThreshold;
  const upperFalling = upperReg.slope < -flatThreshold;
  const lowerRising = lowerReg.slope > flatThreshold;

  let patternType = "대칭 삼각형";
  if (upperFlat && lowerRising) patternType = "상승 삼각형";
  else if (upperFalling && lowerFlat) patternType = "하락 삼각형";
  else if (!(upperFalling && lowerRising)) patternType = "쐐기형";

  const last = data[n - 1];
  const close = Number(last.close);
  const open = Number(last.open);
  const volume = Number(last.volume || 0);
  const avgVol20 = safeAvg(lastN(data, 20).map((d) => d.volume || 0));
  const upperNow = upperReg.valueAt(lastIndex);
  const lowerNow = lowerReg.valueAt(lastIndex);

  const isBreakoutUp = close > upperNow;
  const isBreakoutDown = close < lowerNow;
  const isBullishCandle = close > open;
  const volumeConfirm = avgVol20 ? volume >= avgVol20 * 1.3 : false;
  const nearApex = widthNowRate <= 3;

  let score = 30;
  if (isConverging) score += 15;
  if (nearApex) score += 10;
  if (patternType === "상승 삼각형") score += 8;
  if (isBreakoutUp) score += 20;
  if (isBreakoutUp && volumeConfirm) score += 10;
  if (isBreakoutUp && isBullishCandle) score += 5;
  if (isBreakoutDown) score -= 20;
  if (patternType === "하락 삼각형") score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = "제외";
  if (isBreakoutDown) grade = "제외";
  else if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  const action = isBreakoutUp
    ? "상단 추세선 상향 돌파 — 거래량 동반 확인"
    : isBreakoutDown
      ? "하단 추세선 이탈 — 리스크 관리"
      : nearApex
        ? "꼭짓점 임박 — 방향성 돌파 대기"
        : "수렴 진행 중 — 상/하단 돌파 대기";

  return {
    status: "OK",
    signalName: "삼각수렴",
    score,
    grade,
    action,
    patternType,
    widthNowRate: Number(widthNowRate.toFixed(2)),
    // 시작점은 회귀선을 과거로 외삽하지 않고 실제로 닿은 스윙 고점/저점을 그대로 사용해
    // 차트에 그릴 때 실제 캔들 범위를 벗어나 어긋나 보이지 않게 한다.
    upperStart: { index: swingHighs[0].index, price: Math.round(swingHighs[0].price) },
    upperEnd: { index: lastIndex, price: Math.round(upperNow) },
    lowerStart: { index: swingLows[0].index, price: Math.round(swingLows[0].price) },
    lowerEnd: { index: lastIndex, price: Math.round(lowerNow) },
    upperNow: Math.round(upperNow),
    lowerNow: Math.round(lowerNow),
    isBreakoutUp,
    isBreakoutDown,
    checks: { isConverging, nearApex, upperFlat, lowerFlat, upperFalling, lowerRising, volumeConfirm, isBullishCandle },
  };
}

/** TD 시퀀셜(디마크 지표) — 종가가 4봉 전보다 낮은/높은 흐름이 9회 연속되면 매수/매도 셋업 완성으로 보고,
 * 이후 2봉 전 고가·저가 대비 조건을 13회까지 세는 카운트다운으로 반전 강도를 봅니다. */
function calculateTdSequentialSignal(candles) {
  if (!candles || candles.length < 30) {
    return { status: "ERROR", signalName: "TD 시퀀셜", score: 0, grade: "제외", message: "최소 30봉 이상 필요합니다." };
  }

  const closes = candles.map((c) => Number(c.close));
  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));
  const n = candles.length;
  const lastIndex = n - 1;

  let buyCount = 0;
  let sellCount = 0;
  let lastBuySetup9 = -1;
  let lastSellSetup9 = -1;

  for (let i = 4; i < n; i++) {
    if (closes[i] < closes[i - 4]) {
      buyCount += 1;
      sellCount = 0;
    } else if (closes[i] > closes[i - 4]) {
      sellCount += 1;
      buyCount = 0;
    } else {
      buyCount = 0;
      sellCount = 0;
    }
    if (buyCount === 9) { lastBuySetup9 = i; buyCount = 0; }
    if (sellCount === 9) { lastSellSetup9 = i; sellCount = 0; }
  }

  const countdownFrom = (setupIndex, direction) => {
    if (setupIndex < 0) return 0;
    let count = 0;
    for (let i = setupIndex + 1; i < n && i - 2 >= 0; i++) {
      const qualifies = direction === "buy" ? closes[i] <= lows[i - 2] : closes[i] >= highs[i - 2];
      if (qualifies) {
        count += 1;
        if (count >= 13) return 13;
      }
    }
    return count;
  };

  const buyCountdown = countdownFrom(lastBuySetup9, "buy");
  const sellCountdown = countdownFrom(lastSellSetup9, "sell");
  const buySetupRecent = lastBuySetup9 >= 0 && lastIndex - lastBuySetup9 <= 3;
  const sellSetupRecent = lastSellSetup9 >= 0 && lastIndex - lastSellSetup9 <= 3;

  let status = "NO_SIGNAL";
  let signalType = "none";
  let score = 25;
  let action = "매수·매도 셋업 진행 중 — 9 완성 대기";

  if (buyCountdown >= 13) {
    status = "OK"; signalType = "buyCountdown13"; score = 92;
    action = "매수 카운트다운 13 완성 — 강한 바닥 반전 신호";
  } else if (sellCountdown >= 13) {
    status = "OK"; signalType = "sellCountdown13"; score = 8;
    action = "매도 카운트다운 13 완성 — 강한 상투 반전 신호";
  } else if (buySetupRecent) {
    status = "OK"; signalType = "buySetup9"; score = 78;
    action = `매수 셋업 9 완성 (${lastIndex - lastBuySetup9}봉 전) — 과매도 반전 후보`;
  } else if (sellSetupRecent) {
    status = "OK"; signalType = "sellSetup9"; score = 15;
    action = `매도 셋업 9 완성 (${lastIndex - lastSellSetup9}봉 전) — 과매수 반전 후보`;
  } else if (buyCount >= 5) {
    status = "OK"; signalType = "buyBuilding"; score = 45 + buyCount * 2;
    action = `매수 셋업 진행 중 (${buyCount}/9)`;
  } else if (sellCount >= 5) {
    status = "OK"; signalType = "sellBuilding"; score = 45 - sellCount * 2;
    action = `매도 셋업 진행 중 (${sellCount}/9)`;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  return {
    status,
    signalName: "TD 시퀀셜",
    score,
    grade,
    action,
    signalType,
    buyCount,
    sellCount,
    buyCountdown,
    sellCountdown,
    lastBuySetup9BarsAgo: lastBuySetup9 >= 0 ? lastIndex - lastBuySetup9 : null,
    lastSellSetup9BarsAgo: lastSellSetup9 >= 0 ? lastIndex - lastSellSetup9 : null,
  };
}

/** 대세주 조정밴드(시스코 패러다임) — 52주 고점 대비 낙폭이 대형 주도주가 대세 상승 중 겪는
 * 전형적 조정 구간(-30%~-40%)에 들어왔는지를 봅니다. */
function calculateLeaderDrawdownSignal(candles) {
  if (!candles || candles.length < 20) {
    return { status: "ERROR", signalName: "대세주 조정밴드", score: 0, grade: "제외", message: "최소 20봉 이상 필요합니다." };
  }

  const lookback = Math.min(candles.length, 252);
  const windowData = candles.slice(-lookback);
  const high52w = Math.max(...windowData.map((c) => Number(c.high)));
  const price = Number(candles[candles.length - 1].close);

  if (!(high52w > 0)) {
    return { status: "ERROR", signalName: "대세주 조정밴드", score: 0, grade: "제외", message: "52주 고점을 계산할 수 없습니다." };
  }

  const drawdownPct = ((price - high52w) / high52w) * 100;
  const inLeaderBand = drawdownPct <= -30 && drawdownPct >= -40;
  const deepBand = drawdownPct < -40;

  let score = 30;
  if (drawdownPct <= -15) score += 10;
  if (inLeaderBand) score += 40;
  else if (deepBand) score += 25;
  if (drawdownPct > -10) score -= 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = "제외";
  if (score >= 80) grade = "강한 매수 후보";
  else if (score >= 65) grade = "관심 종목";
  else if (score >= 50) grade = "관찰";

  const action = inLeaderBand
    ? "역사적 주도주 조정 밴드(-30%~-40%) 진입 — 분할 매수 관찰 구간"
    : deepBand
      ? "조정 밴드를 넘어선 급락 — 펀더멘털 재점검 필요"
      : drawdownPct <= -15
        ? "조정 진행 중 — 밴드 진입 대기"
        : "52주 고점 근접 — 조정 매수 근거 약함";

  return {
    status: "OK",
    signalName: "대세주 조정밴드",
    score,
    grade,
    action,
    high52w: Math.round(high52w),
    drawdownPct: Number(drawdownPct.toFixed(2)),
    inLeaderBand,
    deepBand,
  };
}

function calculateGapSignal(candles) {
  if (!candles || candles.length < 10) {
    return { status: "ERROR", signalName: "갭/과열", score: 0, grade: "제외", message: "최소 10봉 이상 필요합니다." };
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const gapRate = ((Number(last.open) - Number(prev.close)) / Math.max(1, Number(prev.close))) * 100;
  const bodyRate = ((Number(last.close) - Number(last.open)) / Math.max(1, Number(last.open))) * 100;
  const status = Math.abs(gapRate) >= 2 ? "OK" : "NO_SIGNAL";
  const score = Math.abs(gapRate) >= 4 ? 70 : Math.abs(gapRate) >= 2 ? 55 : 30;
  return {
    status,
    signalName: "갭/과열",
    score,
    grade: score >= 65 ? "관심 종목" : score >= 50 ? "관찰" : "제외",
    action: gapRate > 0 ? "갭상승 후 지지 확인" : gapRate < 0 ? "갭하락 반등 확인" : "갭 신호 약함",
    gapRate: Number(gapRate.toFixed(2)),
    bodyRate: Number(bodyRate.toFixed(2)),
  };
}

function calcFibonacciLevels(candles, lookback = 120) {
  const data = candles.slice(-lookback);
  if (data.length < 20) return [];
  let hi = { index: 0, price: -Infinity };
  let lo = { index: 0, price: Infinity };
  data.forEach((d, i) => {
    const h = Number(d.high);
    const l = Number(d.low);
    if (h > hi.price) hi = { index: i, price: h, date: d.date };
    if (l < lo.price) lo = { index: i, price: l, date: d.date };
  });
  const top = hi.price;
  const bottom = lo.price;
  const diff = Math.max(1, top - bottom);
  return [
    { label: "Fibo 23.6", price: top - diff * 0.236 },
    { label: "Fibo 38.2", price: top - diff * 0.382 },
    { label: "Fibo 50.0", price: top - diff * 0.5 },
    { label: "Fibo 61.8", price: top - diff * 0.618 },
  ];
}

// 최근 window봉 TR(True Range) 평균 / 마지막 종가 — iOS ChartView.atrPct와 동일 로직
function calcAtrPct(candles, window = 14) {
  if (!candles || candles.length < 2) return 0;
  const last = candles[candles.length - 1];
  const lastClose = Number(last?.close || 0);
  if (!(lastClose > 0)) return 0;
  const slice = candles.slice(-(window + 1));
  const trs = [];
  for (let i = 1; i < slice.length; i++) {
    const prevClose = Number(slice[i - 1].close);
    const c = slice[i];
    const high = Number(c.high);
    const low = Number(c.low);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (!trs.length) return 0;
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  return atr / lastClose;
}

// 과거 데이터 기반 최고/최저 예측 — ATR% 변동폭 + 확률 드리프트 누적 + √t 불확실성 콘
// (iOS ChartView.forecastPoints와 동일 공식; probUpPct 미지정 시 방향성 없는 순수 변동성 밴드)
function computeForecastCone(candles, probUpPct, horizonDays = 7) {
  const last = candles?.[candles.length - 1];
  const lastClose = Number(last?.close || 0);
  if (!candles || candles.length < 2 || !(lastClose > 0)) {
    return { points: [], predictedHigh: null, predictedLow: null, atrPct: 0, horizonDays: 0, probUp: 50 };
  }
  const atr = calcAtrPct(candles, 14);
  if (!(atr > 0)) {
    return { points: [], predictedHigh: null, predictedLow: null, atrPct: 0, horizonDays: 0, probUp: 50 };
  }
  const probUp = Number.isFinite(Number(probUpPct)) ? Number(probUpPct) : 50;
  const days = Math.min(Math.max(Math.round(horizonDays) || 7, 1), 7);
  const dailyDrift = (probUp / 100 - 0.5) * 2 * atr;
  const points = [{ label: String(last.date || ""), center: lastClose, lower: lastClose, upper: lastClose }];
  for (let d = 1; d <= days; d++) {
    const center = lastClose * (1 + dailyDrift * d);
    const band = lastClose * atr * Math.sqrt(d);
    points.push({ label: `→${d}`, center, lower: center - band, upper: center + band });
  }
  const uppers = points.slice(1).map((p) => p.upper);
  const lowers = points.slice(1).map((p) => p.lower);
  return {
    points,
    predictedHigh: Math.max(...uppers),
    predictedLow: Math.max(0, Math.min(...lowers)),
    atrPct: atr,
    horizonDays: days,
    probUp,
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
    normalizeTechniqueSignal("supportResistance", calculateSupportResistanceSignal(candles)),
    normalizeTechniqueSignal("boxBreakout", calculateBoxBreakoutSignal(candles)),
    normalizeTechniqueSignal("triangle", calculateTriangleSignal(candles)),
    normalizeTechniqueSignal("td", calculateTdSequentialSignal(candles)),
    normalizeTechniqueSignal("drawdown", calculateLeaderDrawdownSignal(candles)),
    normalizeTechniqueSignal("bollinger", calculateBollingerSqueezeSignal(candles)),
    normalizeTechniqueSignal("volumeBreakout", calculateVolumeBreakoutSignal(candles)),
    normalizeTechniqueSignal("rsiReversal", calculateRsiReversalSignal(candles)),
    normalizeTechniqueSignal("gapSignal", calculateGapSignal(candles)),
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
    supportResistance: "최근 매물대가 많이 겹친 지지·저항 가격대를 자동 추정합니다.",
    boxBreakout: "최근 박스권 상단 돌파 또는 돌파 임박 여부를 봅니다.",
    triangle: "고점을 연결한 상단 추세선과 저점을 연결한 하단 추세선이 좁혀지는 삼각수렴 패턴과 돌파 방향을 봅니다.",
    td: "종가가 4봉 전보다 낮거나 높은 흐름이 9회 연속되면 매수/매도 셋업 완성으로 보고, 이후 2봉 전 고저 대비 카운트다운 13까지 반전 강도를 추적합니다.",
    drawdown: "52주 고점 대비 낙폭이 대형 주도주가 대세 상승 중 겪는 전형적 조정 구간(-30%~-40%)에 들어왔는지를 봅니다.",
    bollinger: "볼린저 밴드 수축 후 상단 돌파와 거래량 동반 여부를 봅니다.",
    volumeBreakout: "최근 20봉 전고점 돌파와 거래량 급증을 봅니다.",
    rsiReversal: "RSI 과매도 회복, 가격 반등, 20일선 회복을 봅니다.",
    gapSignal: "갭상승/갭하락 후 지지 여부와 과열 리스크를 봅니다.",
  };
  return map[key] || "";
}

async function fetchChartHistory(code, period = "D", range = "1Y", selected = null) {
  const count = countByPeriod(period, range);
  const minNeeded = minChartCandles(period, range);

  if (selected?.assetClass === "global") {
    const symbol = normalizeGlobalInput(selected.symbol || code);
    const type = selected.type || (isCryptoSymbol(symbol) ? "crypto" : "us");
    const path = `/api/global/chart/${symbol}?type=${type}&period=${period}&count=${count}&range=${range}`;
    try {
      const data = normalizeHistoryResponse(await fetchJson(path));
      if (data.length >= Math.min(10, minNeeded)) {
        return { data: data.slice(-count), source: path, fallback: false };
      }
    } catch (e) {
      console.warn("global chart fallback", path, e);
    }
    return {
      data: makeFallbackHistory(selected, count, period),
      source: `global-fallback-${symbol}-${period}-${range}`,
      fallback: true,
    };
  }
  const paths = [
    `/api/chart/${code}?period=${period}&count=${count}&range=${range}&analyze=1`,
    `/api/history/${code}?period=${period}&count=${count}&range=${range}`,
    `/api/ohlcv/${code}?period=${period}&count=${count}&range=${range}`,
  ];

  for (const path of paths) {
    try {
      const data = normalizeHistoryResponse(await fetchJson(path));

      // 핵심 수정:
      // 월봉 3Y는 36봉이 정상입니다. 기존처럼 60봉 미만을 오류/보강 처리하지 않습니다.
      if (data.length >= minNeeded) {
        return { data: data.slice(-count), source: path, fallback: false };
      }

      if (data.length >= Math.min(10, minNeeded)) {
        const padCount = Math.max(0, count - data.length);
        const pad = makeFallbackHistory(
          { ...selected, price: data[data.length - 1]?.close || selected?.price },
          padCount,
          period
        );
        return {
          data: [...pad, ...data].slice(-count),
          source: `${path} + 기간보강`,
          fallback: true,
        };
      }
    } catch (e) {
      console.warn("chart history fallback", path, e);
    }
  }

  return {
    data: makeFallbackHistory(selected, count, period),
    source: `fallback-generated-${period}-${range}`,
    fallback: true,
  };
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
      const endpoint = globalEndpointFor(t.symbol, t.type);
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


function normalizeGlobalInput(input) {
  const raw = String(input || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!raw) return "";
  if (raw.endsWith("-USD")) return raw.replace("-USD", "");
  return raw;
}

function isCryptoSymbol(symbol) {
  return ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB", "AVAX", "LINK", "DOT", "MATIC"].includes(String(symbol || "").toUpperCase());
}

function globalEndpointFor(symbol, type = "us") {
  const s = normalizeGlobalInput(symbol);
  return type === "crypto" || isCryptoSymbol(s) ? `/api/crypto/quote/${s}` : `/api/us/quote/${s}`;
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
        <li>저점이 상단으로 올라가는 구조는 상승 전환 신뢰도를 높이고, 저점이 하단으로 이탈하면 위험신호로 감점합니다.</li>
        <li>돌파 후 저점 이탈은 돌파 실패로 분류하며, 20일선 이탈이 동반되면 강한 위험신호로 판정합니다.</li>
        <li>추세선은 절대적인 벽이 아니라 유연한 구간으로 보고, 장중 돌파보다 종가 돌파를 우선합니다.</li>
        <li>종가 돌파·거래량 증가·양봉 마감이 함께 충족될 때만 진짜 돌파로 분류하고, 거래량 없는 돌파는 가짜 돌파 의심으로 감점합니다.</li>
        <li>기울기가 지나치게 가파른 추세선은 가짜 돌파 위험이 커서 별도 감점합니다.</li>
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

function Header({ now, tab, user, onLogout }) {
  return (
    <div className="top-wrap">
      <div className="top">
        <div className="top-left">
          <div className="brand">ALPHA</div>
          <div className="live">● LIVE {now}</div>
        </div>
        <div className="top-right">
          <span className="creator-badge">Created by <b>ASK</b></span>
          <span className="tag green">US/CRYPTO API</span>
          <span className="tag green">KRX API</span>
          <span>2026.05.26</span>
          {user?.name ? (
            <>
              <span className="auth-user">{user.name}</span>
              <button className="btn small" type="button" onClick={onLogout}>로그아웃</button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mobile-current">현재 화면 · {tab}</div>
    </div>
  );
}

function Nav({ tab, setTab }) {
  const tabs = ["대시보드", "차트 분석", "스크리너", "저평가 스크리너", "US/CRYPTO", "포트폴리오", "알림 센터", "AI 리포트", "AXIOS 마켓 인사이트", "일일 브리핑", "섹터/테마", "전종목 스캔", "백테스트", "AI 시뮬레이션", "지표 통합 최적분석", "투자운영"];
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

  const tickerItems = [...live, ...global];
  const marqueeItems = [...tickerItems, ...tickerItems];

  return (
    <div className="ticker" title="마우스를 올리면 흐름이 잠시 멈춥니다.">
      <div className="ticker-track">
        {marqueeItems.map((t, i) => (
          <div className="ticker-item" key={`${t.s}-${i}`}>
            <div className="ticker-line1">{t.s}</div>
            <div className="ticker-line2">{t.p}</div>
            <div className={`ticker-line3 ${t.up ? "up" : "down"}`}>
              {t.ch} {t.demo ? <span className="tag demo">DEMO</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenFrame({ tab, children }) {
  const desc = {
    "대시보드": "시장 지수와 선택 종목의 실시간 요약을 확인합니다.",
    "차트 분석": "선택 종목의 AI 분석과 차트 시각화를 확인합니다.",
    "스크리너": "실시간 종목을 점수화해 추천 랭킹으로 정리합니다.",
    "저평가 스크리너": "PER/PBR, 52주 저점, 기술적 반등, 국민연금 관심권을 종합합니다.",
    "US/CRYPTO": "미국주식과 가상자산 시세, 차트, AI 기법 분석을 확인합니다.",
    "포트폴리오": "보유 종목 평가손익과 리밸런싱 기준을 계산합니다.",
    "알림 센터": "가격/등락률/AI점수/20일선 조건을 등록하고 판정합니다.",
    "AI 리포트": "분석 결과 확인 후 추가 질문까지 이어서 진행합니다.",
    "AXIOS 마켓 인사이트": "Axios 최신 기사 기반으로 섹터·종목 영향도와 뉴스 촉매 점수를 계산합니다.",
    "일일 브리핑": "아침 8시 자동 리포트 형태의 브리핑 화면입니다.",
    "섹터/테마": "섹터별 강도와 테마 흐름을 계산합니다.",
    "전종목 스캔": "전체 시장 자동 발굴 화면 구조입니다.",
    "백테스트": "신호 발생 후 N일 수익률 검증 화면입니다.",
    "AI 시뮬레이션": "신호 가중치와 학습 결과를 AI 판단에 자동 주입합니다.",
    "지표 통합 최적분석": "가치, 섹터 심리, RSI, 모멘텀, 기술 조건을 통합해 코스피/코스닥 최적 후보 20개와 WORST 10개를 선정합니다.",
    "투자운영": "KB증권 연동 상태와 조회 전용 계좌 정보를 확인합니다. 주문 기능은 비활성입니다.",
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
  const [serverMatches, setServerMatches] = useState([]);
  const [masterLoading, setMasterLoading] = useState(false);

  const localMatches = useMemo(() => {
    return searchStockCatalog(newStock.query, stocks).filter((s) => !stocks.some((x) => x.code === s.code));
  }, [newStock.query, stocks]);

  useEffect(() => {
    const q = String(newStock.query || "").trim();
    let ignore = false;
    if (q.length < 2) {
      setServerMatches([]);
      setMasterLoading(false);
      return;
    }

    setMasterLoading(true);
    const timer = setTimeout(async () => {
      const rows = await searchStockEverywhere(q, stocks);
      if (!ignore) {
        setServerMatches(rows.filter((s) => !stocks.some((x) => x.code === s.code)));
        setMasterLoading(false);
      }
    }, 220);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [newStock.query, stocks]);

  const matches = useMemo(() => {
    const map = new Map();
    [...localMatches, ...serverMatches].forEach((s) => {
      if (s?.code) map.set(s.code, s);
    });
    return Array.from(map.values()).slice(0, 10);
  }, [localMatches, serverMatches]);

  const pickStock = (s) => {
    setNewStock({
      query: `${s.name} (${s.code})`,
      code: s.code,
      name: s.name,
      tag: s.tag || s.sector || "사용자추가",
    });
  };

  const submitAdd = async () => {
    let resolved = newStock.code.length === 6
      ? { code: newStock.code, name: newStock.name || newStock.code, tag: newStock.tag || "사용자추가", sector: newStock.tag || "사용자추가" }
      : resolveStockInput(newStock.query || newStock.name, stocks);

    if (!resolved) {
      const serverRows = await searchStockEverywhere(newStock.query || newStock.name, stocks);
      resolved = serverRows[0];
    }

    if (!resolved) return alert("검색 결과가 없습니다. 종목명을 다시 입력하거나 6자리 코드를 입력하세요. 미등록 종목은 6자리 코드로 먼저 추가할 수 있습니다.");

    const code = normalizeCode(resolved.code);
    if (code.length !== 6) return alert("종목코드는 6자리 숫자여야 합니다.");

    addStock({
      code,
      name: newStock.name.trim() || resolved.name || getStockName(code, code, stocks),
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
            placeholder="종목명 또는 코드 검색 예: 롯데정밀화학, 삼성전자, 005930"
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
                  <span>{s.tag || s.sector}{s.market ? ` · ${s.market}` : ""}{s.source ? ` · ${s.source}` : ""}</span>
                </button>
              ))}
            </div>
          )}

          {newStock.query && masterLoading && (
            <div className="search-empty">KRX 마스터 + KIS에서 추가 검색 중입니다...</div>
          )}

          {newStock.query && !matches.length && !newStock.code && !masterLoading && (
            <div className="search-empty">검색 결과가 없습니다. KRX/KIS 검색에 없는 종목은 6자리 코드로 직접 추가할 수 있습니다.</div>
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
        <div className="panel-body sub">API 서버:<br /><b>{API_BASE}</b><br /><br />국내 시세는 KIS API 기준입니다.<br />미국 주식/코인은 Render API 연결 시 실시간으로 표시됩니다.</div>
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

function buildAnalysisPrompt(selected, stocks, followup, lastResult, chartContext) {
  const name = selected?.assetClass === "global" ? (selected?.name || selected?.symbol || selected?.code) : getStockName(selected?.code, selected?.name, stocks);
  const { activeTechnique, gogoSignal, psych } = chartContext || {};
  const chartScoreBlock = activeTechnique
    ? `
[현재 화면에 표시 중인 차트 분석 점수 — 반드시 참고]
선택 기법: ${activeTechnique.name} · 점수 ${activeTechnique.score}점 · 등급 ${activeTechnique.grade} · 권장 액션 ${activeTechnique.action || "-"}
고고저 판정: ${gogoSignal?.status === "OK" ? `${gogoSignal.grade} (점수 ${gogoSignal.score}점, 돌파율 ${gogoSignal.breakoutRate}%, 저점구조 ${gogoSignal.lowStructure})` : gogoSignal?.message || "-"}
시장 심리: ${psych?.phase || "-"} (공포·탐욕 ${psych?.fearGreedScore ?? "-"}점, RSI ${psych?.rsiValue ?? "-"})
`
    : "";
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
${chartScoreBlock}
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
${chartContext ? "- 위 [현재 화면에 표시 중인 차트 분석 점수]와 반대되는 결론(예: 점수가 높은데 매도/하락 의견)을 낼 경우, 반드시 어떤 지표 때문에 점수와 다른 판단을 하는지 근거를 명시하세요. 근거 없이 점수와 모순된 결론만 제시하지 마세요." : ""}

전체 답변은 2,500자 이내로 작성하되, 반드시 ①~⑥ 항목을 모두 완결된 문장으로 끝까지 작성하세요. 중간에 문장이 끊기면 안 됩니다.

① 종합 판단
② 매수 조건
③ 목표가
④ 손절가
⑤ 리스크
⑥ 최종 전략
`;
}


function buildForecastReviewPrompt(selected, stocks, chartContext, forecastCone) {
  const name = selected?.assetClass === "global" ? (selected?.name || selected?.symbol || selected?.code) : getStockName(selected?.code, selected?.name, stocks);
  const { activeTechnique, gogoSignal, psych } = chartContext || {};
  return `
[종목 데이터]
종목명: ${name}
종목코드: ${selected?.code}
현재가: ${fmtPrice(selected?.price)}

[통계 기반 예측 — ATR% 변동성 + 확률 드리프트, ${forecastCone.horizonDays}거래일 콘]
예측 최고가: ${fmtPrice(Math.round(forecastCone.predictedHigh || 0))}원
예측 최저가: ${fmtPrice(Math.round(forecastCone.predictedLow || 0))}원
변동성(ATR%): ${((forecastCone.atrPct || 0) * 100).toFixed(2)}%
상승확률: ${forecastCone.probUp}%

[현재 화면 차트 분석]
선택 기법: ${activeTechnique?.name || "-"} · 점수 ${activeTechnique?.score ?? "-"}점 · 등급 ${activeTechnique?.grade || "-"}
고고저 판정: ${gogoSignal?.status === "OK" ? `${gogoSignal.grade} (점수 ${gogoSignal.score}점)` : gogoSignal?.message || "-"}
시장 심리: ${psych?.phase || "-"} (RSI ${psych?.rsiValue ?? "-"})

위 통계 기반 최고가/최저가 예측은 단순 변동성(ATR)과 확률 드리프트만 반영한 값이라 추세 전환, 지지/저항, 거래량 등은 반영하지 못합니다.
위 차트 분석·시장 심리·최근 가격 흐름을 참고해 이 예측이 타당한지 검토하세요.
동의하면 통계값을 그대로 제시하고, 조정이 필요하면 근거와 함께 새 값을 제시하세요.

반드시 아래 형식으로만 답변하세요. 다른 설명은 추가하지 마세요.
검토 최고가: [숫자]원
검토 최저가: [숫자]원
근거: [2~3문장]
`;
}

function buildLocalAnalysis(selected, stocks, reason = "") {
  const name = selected?.assetClass === "global" ? (selected?.name || selected?.symbol || selected?.code) : getStockName(selected?.code, selected?.name, stocks);
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


function parseFirstPriceFromText(text, labels = []) {
  const src = String(text || "");
  for (const label of labels) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}[^0-9]{0,20}([0-9][0-9,]{2,})\\s*원?`, "i");
    const m = src.match(re);
    if (m) {
      const n = Number(String(m[1]).replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const any = src.match(/([0-9][0-9,]{3,})\s*원/g);
  if (any?.length) {
    const n = Number(any[0].replace(/[^0-9]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function upsertAlphaAlert(alertItem) {
  const current = loadLS("alpha_alerts", []);
  const exists = current.some((a) =>
    String(a.code) === String(alertItem.code) &&
    String(a.type) === String(alertItem.type) &&
    Number(a.target) === Number(alertItem.target)
  );
  const next = exists ? current : [...current, alertItem];
  saveLS("alpha_alerts", next);
  try {
    window.dispatchEvent(new CustomEvent("alpha-alerts-updated", { detail: next }));
  } catch {}
  return { next, exists };
}

async function saveAlertToServer(alertItem) {
  try {
    const data = await fetchJson("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertItem),
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}


function AiReport({ selected, stocks, chartContext }) {
  const name = getStockName(selected?.code, selected?.name, stocks);
  const defaultPrompt = `${name}(${selected?.code}) 단기/스윙 분석 리포트 생성`;
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [result, setResult] = useState("");
  const [followup, setFollowup] = useState("");
  const [chat, setChat] = useState([]);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(null);
  const [alertType, setAlertType] = useState("priceAbove");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertMsg, setAlertMsg] = useState("");

  useEffect(() => {
    setPrompt(defaultPrompt);
    setResult("");
    setFollowup("");
    setChat([]);
    setErr("");
    setNotice("");
    setReportOpen(false);
    setFollowupOpen(null);
    setAlertType("priceAbove");
    setAlertPrice("");
    setAlertMsg("");
  }, [defaultPrompt]);

  const applyAnswer = (answer, isFollowup) => {
    if (isFollowup) {
      setChat((p) => [...p, { role: "ai", text: answer }]);
      setFollowup("");
    } else {
      setResult(answer);
      setChat([{ role: "ai", text: answer }]);
      const targetGuess = parseFirstPriceFromText(answer, ["1차 목표가", "목표가", "돌파 매수 조건"]);
      if (targetGuess) setAlertPrice(String(targetGuess));
    }
  };

  const getSuggestedAlertPrice = (type = alertType) => {
    const price = Number(selected?.price || 0);
    const low = Number(selected?.low || 0);
    const high = Number(selected?.high || 0);
    const ma20 = Number(selected?.ma20 || 0);

    if (type === "priceAbove") {
      return parseFirstPriceFromText(result, ["1차 목표가", "목표가", "돌파 매수 조건"]) ||
        (high ? Math.round(high * 1.01) : price ? Math.round(price * 1.04) : "");
    }
    if (type === "priceBelow") {
      return parseFirstPriceFromText(result, ["손절 기준", "손절가", "손절"]) ||
        (low ? Math.round(low * 0.985) : price ? Math.round(price * 0.96) : "");
    }
    if (type === "ma20Touch") return ma20 || 0;
    return "";
  };

  const setSuggestedAlert = (type) => {
    setAlertType(type);
    setAlertPrice(String(getSuggestedAlertPrice(type)));
  };

  const saveAiAlert = async (type = alertType, targetValue = alertPrice) => {
    const code = selected?.code;
    const target = Number(String(targetValue).replace(/,/g, ""));
    if (!code) return alert("선택된 종목이 없습니다.");
    if (type !== "ma20Touch" && (!Number.isFinite(target) || target <= 0)) {
      return alert("알림 기준 단가를 입력하세요.");
    }

    const alertItem = {
      id: Date.now(),
      code,
      name,
      type,
      target: type === "ma20Touch" ? 0 : target,
      source: "AI 리포트",
      message:
        type === "priceAbove"
          ? `${name}(${code}) 목표가 ${fmtPrice(target)}원 이상 도달 알림`
          : type === "priceBelow"
            ? `${name}(${code}) 손절가 ${fmtPrice(target)}원 이하 이탈 알림`
            : `${name}(${code}) 20일선 도달 알림`,
      createdAt: new Date().toLocaleString("ko-KR"),
    };

    const { exists } = upsertAlphaAlert(alertItem);
    const server = await saveAlertToServer(alertItem);

    if (server.ok) {
      setAlertMsg(exists ? "이미 동일한 알림이 있습니다. 서버 알림도 확인했습니다." : "알림 센터와 서버 텔레그램 감시에 등록했습니다.");
    } else {
      setAlertMsg(exists ? `이미 동일한 알림이 있습니다. 서버 저장 실패: ${server.error}` : `브라우저 알림은 등록, 서버 저장 실패: ${server.error}`);
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

      const finalPrompt = buildAnalysisPrompt(selected, stocks, isFollowup ? followup : "", result, chartContext);
      const data = await fetchJson("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          systemPrompt:
            "당신은 15년 경력의 주식 트레이딩 분석가입니다. 사용자의 질문을 반복하지 말고 종목 데이터와 학습 가중치를 반영해 한국어로 답변하세요. 답변은 ①~⑥ 항목을 모두 끝까지 완성하세요.",
          maxTokens: 3000,
        }),
      });

      let answer = data.text || data.result || JSON.stringify(data, null, 2);

      const tooShort =
        !isFollowup &&
        (!answer || answer.trim().length < 450 || !answer.includes("⑥"));
      if (tooShort) {
        answer = `${answer || ""}

---
[로컬 보강 분석]
${buildLocalAnalysis(selected, stocks, "AI 응답이 짧거나 일부 항목이 누락되어 로컬 분석을 보강했습니다.")}`;
      }

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


  const renderWostTable = (list) => (
    <div className="integrated-wost-section integrated-worst-top">
      <div className="integrated-section-head">
        <b>WORST 10 · 통합지표 취약 후보</b>
        <span className="tag red">{list.length}개</span>
      </div>
      <div className="integrated-worst-notice">
        <b>주의:</b>
        <span>통합점수 하위 10개입니다. 신규 진입 후보가 아니라, 보유/관심 종목 중 리스크 점검이 필요한 종목입니다.</span>
      </div>
      <div className="integrated-scroll">
        {renderMobileCards(list, false, isGlobal)}
        <table className="integrated-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>종목</th>
              <th>시장</th>
              <th>취약점수</th>
              <th>위험 요인</th>
              <th>관리 의견</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const risks = [];
              if (r.valuePart < 55) risks.push("가치 점수 약함");
              if (r.momentumScore < 45) risks.push("모멘텀 약세");
              if (r.rsi >= 75) risks.push("RSI 과열");
              if (r.rsi <= 30) risks.push("RSI 침체");
              if (r.sectorScore < 55) risks.push("섹터 심리 약세");
              if (Number(r.q?.changeRate || 0) < -2) risks.push("단기 하락 압력");
              return (
                <tr key={`wost-${r.code}`}>
                  <td className="rank">{i + 1}</td>
                  <td>
                    <b>{r.name}</b><br />
                    <span className="sub">{r.code} · {r.sector || r.tag || "-"} · {fmtPrice(r.q?.price)}</span><br />
                    <span className={Number(r.q?.changeRate || 0) >= 0 ? "up" : "down"}>{fmtRate(r.q?.changeRate)}</span>
                  </td>
                  <td>{r.market || "-"}</td>
                  <td><span className="integrated-wost-score">{r.total}</span></td>
                  <td>
                    {(risks.length ? risks : ["통합점수 하위권"]).slice(0, 4).map((risk) => (
                      <span className="integrated-risk-tag" key={risk}>{risk}</span>
                    ))}
                  </td>
                  <td>
                    <span className="sub">
                      신규 진입보다 관망 우선. 보유 중이면 지지선·거래량 회복 여부 확인 후 대응.
                    </span>
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan="6" className="sub">통합 분석 후 WORST 10이 표시됩니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

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
            <div className="ai-report-actions">
              <button className="btn" type="button" onClick={() => setReportOpen(true)}>
                분석 결과 크게보기
              </button>
              <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(result)}>
                결과 복사
              </button>
            </div>
            <div
              className="ai-report-wheel-wrapper"
              onWheel={(e) => {
                const el = e.currentTarget;
                const atTop = el.scrollTop <= 0;
                const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
                if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
                  e.stopPropagation();
                }
              }}
            >
              <pre className="ai-report-result-box">
{result}
              </pre>
            </div>
            <div className="ai-report-scroll-help">
              위 검은 박스 안에서만 스크롤됩니다. 내용이 길면 “분석 결과 크게보기”로 전체 화면에서 확인하세요.
            </div>
          </div>
        )}
        {result && (
          <div className="ai-alert-card">
            <div className="ai-alert-title">AI 리포트 기반 가격 알림</div>
            <div className="ai-alert-grid">
              <select className="select" value={alertType} onChange={(e) => {
                setAlertType(e.target.value);
                setAlertPrice(String(getSuggestedAlertPrice(e.target.value)));
              }}>
                <option value="priceAbove">목표가 이상 도달</option>
                <option value="priceBelow">손절가 이하 이탈</option>
                <option value="ma20Touch">20일선 도달</option>
              </select>
              <input
                className="input"
                type="number"
                placeholder="알림 기준 단가"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                disabled={alertType === "ma20Touch"}
              />
              <button className="btn" type="button" onClick={() => setSuggestedAlert(alertType)}>
                AI 제안가 불러오기
              </button>
              <button className="btn" type="button" onClick={() => saveAiAlert()}>
                알림 설정
              </button>
            </div>
            <div className="ai-alert-grid" style={{ marginTop: 8 }}>
              <button className="btn" type="button" onClick={() => saveAiAlert("priceAbove", getSuggestedAlertPrice("priceAbove"))}>
                목표가 알림 즉시등록
              </button>
              <button className="btn" type="button" onClick={() => saveAiAlert("priceBelow", getSuggestedAlertPrice("priceBelow"))}>
                손절가 알림 즉시등록
              </button>
              <button className="btn" type="button" onClick={() => saveAiAlert("ma20Touch", 0)}>
                20일선 알림 등록
              </button>
              <button className="btn" type="button" onClick={() => setAlertMsg("")}>
                메시지 지우기
              </button>
            </div>
            {alertMsg && <div className="ai-alert-toast">{alertMsg}</div>}
            <div className="ai-alert-hint">
              알림은 브라우저와 서버에 함께 저장됩니다. 서버에 저장된 알림은 Render Cron이 /api/alerts/check를 호출하면 웹앱이 닫혀 있어도 Telegram으로 발송됩니다.
            </div>
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
                <div className="chat-msg-head">
                  <b>{m.role === "user" ? "질문" : "답변"}</b>
                  <button className="chat-msg-open" type="button" onClick={() => setFollowupOpen({ ...m, index: i })}>
                    크게보기
                  </button>
                </div>
                <div
                  className="chat-msg-scroll"
                  onWheel={(e) => {
                    const el = e.currentTarget;
                    const atTop = el.scrollTop <= 0;
                    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
                    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
                      e.stopPropagation();
                    }
                  }}
                >
                  {m.text}
                </div>
                <div className="chat-scroll-help">이 박스 안에서 마우스 휠 또는 터치로 스크롤합니다.</div>
              </div>
            ))}
          </div>
        )}
        {followupOpen && (
          <div className="ai-report-modal-backdrop" onClick={() => setFollowupOpen(null)}>
            <div className="ai-report-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ai-report-modal-head">
                <span>{followupOpen.role === "user" ? "추가 질문 전체 보기" : "추가 답변 전체 보기"}</span>
                <button className="ai-report-close" type="button" onClick={() => setFollowupOpen(null)}>
                  돌아가기
                </button>
              </div>
              <pre className="ai-report-modal-body followup-modal-body">{followupOpen.text}</pre>
            </div>
          </div>
        )}

        {reportOpen && (
          <div className="ai-report-modal-backdrop" onClick={() => setReportOpen(false)}>
            <div className="ai-report-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ai-report-modal-head">
                <span>분석 결과 전체 보기</span>
                <button className="ai-report-close" type="button" onClick={() => setReportOpen(false)}>
                  돌아가기
                </button>
              </div>
              <pre className="ai-report-modal-body">{result}</pre>
            </div>
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
  const [universeKind, setUniverseKind] = useState("both200");
  const [viewMode, setViewMode] = useState("both20");
  const [rows, setRows] = useState([]);
  const [kospiRows, setKospiRows] = useState([]);
  const [kosdaqRows, setKosdaqRows] = useState([]);
  const [scanState, setScanState] = useState({ loading: false, done: 0, total: 0, current: "", lastRun: "", error: "" });
  const [learning, setLearning] = useState(() => summarizeAiLearning("value"));

  useEffect(() => {
    if (scanState.loading) return;
    if (universeKind !== "current") return;
    const currentRows = stocks.map((s) => {
      const q = quotes[s.code] || {};
      const v = calcValueScore(s, q);
      return { ...s, market: "등록종목", q, ...v };
    }).sort((a, b) => b.score - a.score);
    setRows(currentRows);
    setKospiRows([]);
    setKosdaqRows([]);
  }, [quotes, stocks, universeKind, scanState.loading]);

  const runScan = async (kind = universeKind) => {
    const actualKind = kind === "both20" ? "both200" : kind;
    const universe = getValueUniverse(actualKind, stocks);
    setUniverseKind(actualKind);
    setViewMode(actualKind === "both200" || actualKind === "all" ? "both20" : actualKind);
    setRows([]);
    setKospiRows([]);
    setKosdaqRows([]);
    setScanState({ loading: true, done: 0, total: universe.length, current: "시작", lastRun: "", error: "" });

    try {
      await pullAiLearningFromServer();
      const result = await runValueScanUniverse({
        universe,
        baseQuotes: quotes,
        onProgress: ({ done, total, current }) => {
          setScanState((p) => ({ ...p, done, total, current: `${current.name}(${current.code})` }));
        },
      });

      const kospi = result.filter((r) => r.market === "KOSPI200").sort((a, b) => b.score - a.score);
      const kosdaq = result.filter((r) => r.market === "KOSDAQ200").sort((a, b) => b.score - a.score);
      evaluateAiLearningPredictions("value", result);
      recordAiLearningPredictions("value", [...kospi.slice(0, 20), ...kosdaq.slice(0, 20)], 5);
      await pushAiLearningToServer();
      setLearning(summarizeAiLearning("value"));

      setRows(result);
      setKospiRows(kospi);
      setKosdaqRows(kosdaq);
      setScanState({
        loading: false,
        done: universe.length,
        total: universe.length,
        current: "완료",
        lastRun: new Date().toLocaleString("ko-KR"),
        error: "",
      });
    } catch (err) {
      setScanState((p) => ({ ...p, loading: false, error: err.message || String(err) }));
    }
  };

  const top20 = rows.slice(0, 20);
  const kospiTop20 = kospiRows.slice(0, 20);
  const kosdaqTop20 = kosdaqRows.slice(0, 20);
  const strong = rows.filter((r) => r.score >= 78).length;
  const watch = rows.filter((r) => r.score >= 62 && r.score < 78).length;
  const progress = scanState.total ? Math.round(scanState.done / scanState.total * 100) : 0;
  const kospiUniverseCount = getValueUniverse("kospi200", stocks).length;
  const kosdaqUniverseCount = getValueUniverse("kosdaq200", stocks).length;

  const renderRows = (list, offset = 0) => (
    list.map((r, i) => (
      <tr key={`${r.market || "M"}-${r.code}`}>
        <td className="rank">{offset + i + 1}</td>
        <td>{r.name} ({r.code})<br /><span className="sub">{r.market || "-"}</span></td>
        <td>{fmtPrice(r.q.price)}</td>
        <td>{r.q.per ?? "-"} / {r.q.pbr ?? "-"}</td>
        <td className={Number(r.q.changeRate || 0) >= 0 ? "up" : "down"}>{fmtRate(r.q.changeRate)}</td>
        <td>{r.score}</td>
        <td>{r.label}</td>
        <td>{r.tags}</td>
      </tr>
    ))
  );

  const renderValueMobileCards = (list, emptyText = "조회 후 표시됩니다.") => (
    <div className="value-mobile-card-list">
      {list.map((r, i) => {
        const rate = Number(r.q?.changeRate || 0);
        const per = Number(r.q?.per || 0);
        const pbr = Number(r.q?.pbr || 0);
        const perScore = per > 0 ? Math.max(0, Math.min(100, 100 - per * 3.2)) : 48;
        const pbrScore = pbr > 0 ? Math.max(0, Math.min(100, 100 - pbr * 28)) : 48;
        const reboundScore = Math.max(0, Math.min(100, 50 + rate * 8));
        const totalScore = Math.max(0, Math.min(100, Number(r.score || 0)));
        const bars = [
          ["PER", perScore],
          ["PBR", pbrScore],
          ["반등", reboundScore],
          ["수급", totalScore],
          ["종합", totalScore],
        ];
        return (
          <div className={`value-mobile-card ${i === 0 ? "active" : ""}`} key={`value-mobile-${r.market || "M"}-${r.code}`}>
            <div className="value-mobile-head">
              <div className="value-mobile-main">
                <div className="value-mobile-name">{r.name}</div>
                <div className="value-mobile-meta">{r.code}<span className="value-mobile-market"> · {r.market || "-"}</span></div>
                <div className="value-mobile-price-line">
                  <span>현재가 {fmtPrice(r.q?.price)}</span>
                  <span className={rate >= 0 ? "up" : "down"}>{fmtRate(rate)}</span>
                </div>
                <div className="value-mobile-perpbr">PER {r.q?.per ?? "-"} · PBR {r.q?.pbr ?? "-"}</div>
              </div>
              <div className="value-mobile-score">
                {r.score}
                <small>점수</small>
              </div>
              <div className="value-mobile-judge">
                <div className="value-mobile-judge-title">판정</div>
                <div className="value-mobile-judge-value">{r.label}</div>
                <div className="value-mobile-judge-meta">저평가<br />후보</div>
              </div>
            </div>

            <div className="value-mobile-body">
              <div className="value-mobile-bars">
                {bars.map(([label, value]) => (
                  <div className="value-mobile-bar" key={label}>
                    <small>{label}</small>
                    <div className="value-mobile-track">
                      <div style={{ width: `${Math.round(value)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="value-mobile-reason">{r.tags}</div>
            </div>
          </div>
        );
      })}
      {!list.length && <div className="sub">{emptyText}</div>}
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-title">
        <span>AI 저평가 종목 스크리너</span>
        <span className="tag yellow">KOSPI200 / KOSDAQ200 TOP 20</span>
      </div>
      <div className="panel-body">
        <div className="value-scan-toolbar">
          <select className="select" value={universeKind} onChange={(e) => setUniverseKind(e.target.value)} disabled={scanState.loading}>
            <option value="both200">코스피200 + 코스닥200 상위 20개씩</option>
            <option value="kospi200">코스피200 상위 20개</option>
            <option value="kosdaq200">코스닥200 상위 20개</option>
            <option value="current">현재 등록 종목</option>
          </select>
          <button className="btn" onClick={() => runScan(universeKind)} disabled={scanState.loading}>{scanState.loading ? "조회 중..." : "조회"}</button>
          <button className="btn" onClick={() => runScan("kospi200")} disabled={scanState.loading}>코스피200 조회</button>
          <button className="btn" onClick={() => runScan("kosdaq200")} disabled={scanState.loading}>코스닥200 조회</button>
          <button className="btn" onClick={() => runScan("both200")} disabled={scanState.loading}>둘 다 조회</button>
        </div>

        <div className="value-market-tabs">
          <button className={`btn ${viewMode === "both20" ? "active" : ""}`} onClick={() => setViewMode("both20")}>상위 20개씩</button>
          <button className={`btn ${viewMode === "kospi200" ? "active" : ""}`} onClick={() => setViewMode("kospi200")}>코스피200만</button>
          <button className={`btn ${viewMode === "kosdaq200" ? "active" : ""}`} onClick={() => setViewMode("kosdaq200")}>코스닥200만</button>
          <button className={`btn ${viewMode === "all" ? "active" : ""}`} onClick={() => setViewMode("all")}>통합 순위</button>
        </div>

        <div className="value-scan-summary">
          <div className="mini-kpi">코스피 후보군<b>{kospiUniverseCount}</b></div>
          <div className="mini-kpi">코스닥 후보군<b>{kosdaqUniverseCount}</b></div>
          <div className="mini-kpi">저평가+반등 후보<b>{strong}</b></div>
          <div className="mini-kpi">마지막 조회<b>{scanState.lastRun || "-"}</b></div>
          <div className="mini-kpi ai-learning-kpi">AI학습 예측률<b>{learning.winRate}%</b><small>통합통합검증 {learning.total}건 · 대기 {learning.pending || 0}건 · 평균 {fmtRate(learning.avgReturn)}</small></div>
        </div>

        <div className="value-scan-status">
          {scanState.loading
            ? `조회 진행 중: ${scanState.done}/${scanState.total} · 현재 ${scanState.current}`
            : "조회 버튼을 누르면 코스피200/코스닥200 후보군을 순차 조회해 각 시장별 상위 20개 저평가 후보를 산출합니다."}
          {scanState.error && <div className="error">조회 오류: {scanState.error}</div>}
          <div className="value-scan-progress"><div className="value-scan-progress-inner" style={{ width: `${progress}%` }} /></div>
        </div>

        {viewMode === "both20" && (
          <div className="value-top20-grid value-tablet-stack">
            <div className="value-top20-section value-kospi-section">
              <div className="value-top20-title">
                <span>코스피200 저평가 상위 20</span>
                <span className="tag green">{kospiTop20.length}개</span>
              </div>
              <div className="value-top20-scroll">
                {renderValueMobileCards(kospiTop20, "코스피200 조회 버튼을 눌러 분석하세요.")}
                <table className="data-table">
                  <thead><tr><th>순위</th><th>종목</th><th>현재가</th><th>PER/PBR</th><th>등락률</th><th>점수</th><th>판정</th><th>근거</th></tr></thead>
                  <tbody>{renderRows(kospiTop20)}{!kospiTop20.length && <tr><td colSpan="8" className="sub">코스피200 조회 버튼을 눌러 분석하세요.</td></tr>}</tbody>
                </table>
              </div>
            </div>
            <div className="value-top20-section value-kosdaq-section">
              <div className="value-top20-title">
                <span>코스닥200 저평가 상위 20</span>
                <span className="tag green">{kosdaqTop20.length}개</span>
              </div>
              <div className="value-top20-scroll">
                {renderValueMobileCards(kosdaqTop20, "코스닥200 조회 버튼을 눌러 분석하세요.")}
                <table className="data-table">
                  <thead><tr><th>순위</th><th>종목</th><th>현재가</th><th>PER/PBR</th><th>등락률</th><th>점수</th><th>판정</th><th>근거</th></tr></thead>
                  <tbody>{renderRows(kosdaqTop20)}{!kosdaqTop20.length && <tr><td colSpan="8" className="sub">코스닥200 조회 버튼을 눌러 분석하세요.</td></tr>}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {viewMode !== "both20" && (
          <div className="value-top20-scroll value-single-scroll">
            {renderValueMobileCards(viewMode === "kospi200" ? kospiTop20 : viewMode === "kosdaq200" ? kosdaqTop20 : top20, "조회 버튼을 눌러 코스피200 또는 코스닥200 후보군을 분석하세요.")}
            <table className="data-table">
              <thead><tr><th>순위</th><th>종목</th><th>현재가</th><th>PER/PBR</th><th>등락률</th><th>점수</th><th>판정</th><th>근거</th></tr></thead>
              <tbody>
                {renderRows(viewMode === "kospi200" ? kospiTop20 : viewMode === "kosdaq200" ? kosdaqTop20 : top20)}
                {!rows.length && <tr><td colSpan="8" className="sub">조회 버튼을 눌러 코스피200 또는 코스닥200 후보군을 분석하세요.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="footer-note">
          코스피200/코스닥200 후보군을 각각 조회해 시장별 상위 20개 저평가 후보를 분리 표시합니다. 내장 후보군은 앱 내부 대표 구성 목록이며, 정확한 공식 지수 편입종목과 100% 일치시키려면 KRX 지수 구성 마스터를 서버 DB로 연결하면 됩니다.
        </div>
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
  useEffect(() => {
    const sync = () => setAlerts(loadLS("alpha_alerts", []));
    window.addEventListener("alpha-alerts-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("alpha-alerts-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const addAlert = async () => {
    const target = Number(form.target);
    if (!form.code || Number.isNaN(target) || form.target === "") return alert("종목과 기준값을 입력하세요.");
    const stock = stocks.find((s) => s.code === form.code);
    const alertItem = { id: Date.now(), code: form.code, name: stock?.name || form.code, type: form.type, target, source: "알림 센터", createdAt: new Date().toLocaleString("ko-KR") };
    setAlerts((p) => [...p, alertItem]);
    await saveAlertToServer(alertItem);
    setForm({ code: stocks[0]?.code || "005930", type: "priceAbove", target: "" });
  };

  const refreshServerAlerts = async () => {
    try {
      const data = await fetchJson("/api/alerts");
      if (Array.isArray(data.alerts)) {
        setAlerts(data.alerts);
        saveLS("alpha_alerts", data.alerts);
      }
    } catch (err) {
      alert(`서버 알림 조회 실패: ${err.message || err}`);
    }
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
      <div className="panel-title"><span>알림 센터 — 조건 충족 자동 판정 / AI 리포트 연동</span><span className={hitCount ? "tag yellow" : "tag green"}>{hitCount ? `${hitCount}건 충족` : "대기 중"}</span></div>
      <div className="panel-body">
        <div className="form-grid">
          <select className="select" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>{stocks.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select>
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="priceAbove">목표가 이상</option><option value="priceBelow">손절가 이하</option><option value="rateAbove">등락률 이상</option><option value="rateBelow">등락률 이하</option><option value="scoreAbove">AI 점수 이상</option><option value="ma20Touch">20일선 도달</option>
          </select>
          <input className="input" type="number" placeholder="기준값, 20일선은 0 입력" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          <button className="btn" onClick={addAlert}>등록</button>
          <button className="btn" onClick={refreshServerAlerts}>서버 알림 새로고침</button>
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

  if (activeTechniqueKey === "supportResistance") {
    const sr = activeTechnique?.raw?.sr;
    if (sr?.support?.price) signals.push({ index: lastIndex, price: sr.support.price, label: "지지선", color: "#ffd447" });
    if (sr?.resistance?.price) signals.push({ index: lastIndex, price: sr.resistance.price, label: "저항선", color: "#9b5cff" });
  }

  if (activeTechniqueKey === "boxBreakout") {
    if (activeTechnique?.raw?.upper) signals.push({ index: lastIndex, price: activeTechnique.raw.upper, label: "박스 상단", color: "#00d9ff" });
    if (activeTechnique?.raw?.isBreakout) signals.push({ index: lastIndex, price: chartData[lastIndex]?.close, label: "박스 돌파", color: "#00ff88" });
  }

  if (activeTechniqueKey === "triangle") {
    const t = activeTechnique?.raw;
    if (t?.status === "OK") {
      signals.push({
        index: lastIndex,
        price: t.isBreakoutUp ? t.upperNow : t.isBreakoutDown ? t.lowerNow : t.upperNow,
        label: t.isBreakoutUp ? "삼각수렴 상단 돌파" : t.isBreakoutDown ? "삼각수렴 하단 이탈" : `${t.patternType} 수렴 중`,
        color: t.isBreakoutUp ? "#00ff88" : t.isBreakoutDown ? "#ff4466" : "#ffd447",
      });
    }
  }

  if (activeTechniqueKey === "td") {
    const t = activeTechnique?.raw;
    if (t?.status === "OK" && (t.signalType === "buySetup9" || t.signalType === "buyCountdown13")) {
      const idx = t.signalType === "buyCountdown13" ? lastIndex : lastIndex - (t.lastBuySetup9BarsAgo || 0);
      signals.push({
        index: idx,
        price: chartData[idx]?.low,
        label: t.signalType === "buyCountdown13" ? "TD 매수 카운트다운 13" : "TD 매수 셋업 9",
        color: "#00ff88",
      });
    } else if (t?.status === "OK" && (t.signalType === "sellSetup9" || t.signalType === "sellCountdown13")) {
      const idx = t.signalType === "sellCountdown13" ? lastIndex : lastIndex - (t.lastSellSetup9BarsAgo || 0);
      signals.push({
        index: idx,
        price: chartData[idx]?.high,
        label: t.signalType === "sellCountdown13" ? "TD 매도 카운트다운 13" : "TD 매도 셋업 9",
        color: "#ff4466",
      });
    }
  }

  if (activeTechniqueKey === "drawdown") {
    const t = activeTechnique?.raw;
    if (t?.status === "OK" && t.high52w) {
      signals.push({
        index: lastIndex,
        price: t.high52w,
        label: `52주 고점 대비 ${t.drawdownPct}%`,
        color: t.inLeaderBand ? "#00ff88" : "#ffd447",
      });
    }
  }

  return signals;
}


function ChartView({ selected, stocks, selectedCode, setSelectedCode }) {
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
  const [hoverIndex, setHoverIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef(null);
  const [predictionInfo, setPredictionInfo] = useState(null);
  const [aiForecast, setAiForecast] = useState(null);
  const [aiForecastLoading, setAiForecastLoading] = useState(false);
  const [aiForecastError, setAiForecastError] = useState("");

  // 자동 고고저 확장 무한 반복 방지용 잠금값입니다.
  // 기존에는 5Y ↔ 10Y처럼 range가 자동 변경되면서 useEffect가 다시 실행되어
  // 같은 종목에서 확장 조회가 반복되는 문제가 있었습니다.
  const autoExtendKeyRef = useRef("");
  const autoExtendRunningRef = useRef(false);
  const {
    log: psychLog,
    pending: psychPending,
    done: psychDone,
    signalStats: psychSignalStats,
    addEntry: addPsychEntry,
    updateResult: updatePsychResult,
    accuracy: psychAccuracy,
    addAutoPrediction,
    evaluateAutoPredictions,
    clearLearning,
    autoEnabled,
    setAutoEnabled,
  } = usePsychLearningLog();

  const rangeOptions = period === "D"
    ? ["6M", "1Y", "3Y", "5Y", "10Y"]
    : period === "M"
      ? ["1Y", "3Y", "5Y", "10Y"]
      : ["3Y", "5Y", "10Y"];

  const techniqueOptions = [
    { key: "auto", label: "AI 자동" },
    { key: "gogojeo", label: "고고저" },
    { key: "maPullback", label: "이평 눌림" },
    { key: "supportResistance", label: "지지·저항" },
    { key: "boxBreakout", label: "박스권 돌파" },
    { key: "triangle", label: "삼각수렴" },
    { key: "td", label: "TD 시퀀셜" },
    { key: "drawdown", label: "조정밴드" },
    { key: "bollinger", label: "볼린저" },
    { key: "volumeBreakout", label: "거래량 돌파" },
    { key: "rsiReversal", label: "RSI 반등" },
  ];
const loadExtendedGogo = async (trigger = "manual") => {
    const code = selected?.code;
    if (!code) return;
    if (selected?.assetClass === "global") {
      setExtendNotice("해외/가상자산은 Yahoo Finance 장기 차트 기준으로 분석하며, 고고저 자동 기간 확장은 적용하지 않습니다.");
      return;
    }
    if (autoExtendRunningRef.current) return;

    autoExtendRunningRef.current = true;
    setHistoryState((prev) => ({ ...prev, loading: true }));
    setExtendNotice("고고저 구조가 없어 더 이전 데이터까지 1회만 조회 중입니다.");

    try {
      const res = await fetchExtendedGogoHistory(code, period, range, selected);
      if (res) {
        // 핵심 수정:
        // 여기서 setPeriod(res.period), setRange(res.range)를 호출하지 않습니다.
        // 자동 확장 결과가 5Y/10Y를 오가며 드롭다운을 변경하면 useEffect가 다시 실행되어
        // 무한 반복처럼 보이는 문제가 발생하기 때문입니다.
        setHistoryState({ ...res, loading: false, fallback: res.fallback || false });
        setAutoExtended(true);
        setExtendNotice(
          trigger === "auto"
            ? `${res.message} 단, 화면 선택값은 사용자가 고른 ${period}/${range}로 유지합니다.`
            : res.message
        );
      } else {
        const basic = await fetchChartHistory(code, period, range, selected);
        setHistoryState({ ...basic, loading: false, fallback: true });
        setAutoExtended(true);
        setExtendNotice("일봉 10년/월봉 10년까지 1회 확장했지만 유효한 하락 고점 구조가 없습니다. 고고저보다 볼린저/RSI/이평 눌림 기법이 더 적합할 수 있습니다.");
      }
    } catch (e) {
      setHistoryState((prev) => ({ ...prev, loading: false }));
      setAutoExtended(true);
      setExtendNotice(`이전 데이터 조회 중 오류가 발생했습니다: ${e.message || e}`);
    } finally {
      autoExtendRunningRef.current = false;
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
    setAutoExtended(false);
    setExtendNotice("");
    autoExtendRunningRef.current = false;
    autoExtendKeyRef.current = "";
  }, [selected?.code, period, range]);

  // 국내 종목은 AI 방향성 확률(/api/predict)로 예측 콘에 드리프트를 반영하고,
  // 해외/가상자산은 확률 없이(중립 50%) 변동성만 반영한 예측 콘을 표시합니다.
  useEffect(() => {
    let alive = true;
    setPredictionInfo(null);
    setAiForecast(null);
    setAiForecastError("");
    const code = selected?.code;
    if (!code || selected?.assetClass === "global") return;
    fetchJson(`/api/predict/${code}`)
      .then((data) => {
        if (alive) setPredictionInfo(data);
      })
      .catch(() => {
        if (alive) setPredictionInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [selected?.code, selected?.assetClass]);

  const loadChart = async () => {
    const code = selected?.code;
    if (!code) return;
    setHistoryState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetchChartHistory(code, period, range, selected);
      const data = res.data.length ? res.data : makeFallbackHistory(selected, countByPeriod(period, range), period);
      setHistoryState({ ...res, data, loading: false, fallback: res.fallback || !res.data.length });
    } catch {
      setHistoryState({ data: makeFallbackHistory(selected, countByPeriod(period, range), period), source: "fallback", fallback: true, loading: false });
    }
  };

  useEffect(() => {
    let alive = true;
    const code = selected?.code;
    if (!code) return;

    setHistoryState((prev) => ({ ...prev, loading: true }));
    fetchChartHistory(code, period, range, selected)
      .then((res) => {
        if (!alive) return;
        const data = res.data.length ? res.data : makeFallbackHistory(selected, countByPeriod(period, range), period);
        setHistoryState({ ...res, data, loading: false, fallback: res.fallback || !res.data.length });
      })
      .catch(() => {
        if (!alive) return;
        setHistoryState({ data: makeFallbackHistory(selected, countByPeriod(period, range), period), source: "fallback", fallback: true, loading: false });
      });

    return () => {
      alive = false;
    };
  }, [selected?.code, selected?.price, period, range]);

  const rawDataRaw = historyState.data.length ? historyState.data : makeFallbackHistory(selected, countByPeriod(period, range), period);
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

  const ma5 = calcMA(chartData, Math.min(5, chartData.length));
  const ma20 = calcMA(chartData, Math.min(20, chartData.length));
  const ma60 = calcMA(chartData, Math.min(60, chartData.length));
  const bollingerSeries = calcBollingerSeries(chartData, 20, 2);
  const rsiSeries = calcRSISeries(chartData, 14);
  const psych = analyzeMarketPsychology(chartData, rsiSeries);
  const psychPatterns = detectPsychPatterns(chartData);
  const lastPsychLog = psychLog.filter((x) => String(x.code) === String(selected?.code || selected?.symbol)).slice(0, 20);

  const gogoSignal = calculateGogojeoSignal(chartData, {
    lookback: Math.min(gogoLookback, chartData.length),
    swingWindow: period === "D" ? 5 : 2,
    minGap: period === "D" ? 10 : 2,
  });

  useEffect(() => {
    const code = selected?.code;
    const autoKey = `${code || ""}|${period}|${range}|${techniqueMode}`;

    const shouldExtend =
      code &&
      !historyState.loading &&
      !autoExtended &&
      !autoExtendRunningRef.current &&
      autoExtendKeyRef.current !== autoKey &&
      techniqueMode === "auto" &&
      selected?.assetClass !== "global" &&
      chartData.length >= minChartCandles(period, range) &&
      gogoSignal.status !== "OK" &&
      (String(gogoSignal.message || "").includes("하락 추세선") || String(gogoSignal.message || "").includes("고점"));

    if (shouldExtend) {
      autoExtendKeyRef.current = autoKey;
      loadExtendedGogo("auto");
    }
  }, [selected?.code, period, range, historyState.loading, autoExtended, techniqueMode, chartData.length, gogoSignal.status]);

  const techniqueAI = recommendChartTechniques(chartData, gogoSignal);
  const activeTechniqueKey = techniqueMode === "auto" ? techniqueAI.recommended?.key || "gogojeo" : techniqueMode;
  const activeTechnique = techniqueAI.ranked.find((t) => t.key === activeTechniqueKey) || techniqueAI.recommended || techniqueAI.ranked[0];
  const autoPrediction = decideAutoPrediction({ psych, activeTechnique, gogoSignal });

  useEffect(() => {
    const code = selected?.code || selected?.symbol;
    const lastBar = chartData[chartData.length - 1];
    if (!code || !lastBar || historyState.loading) return;

    evaluateAutoPredictions(String(code), fullChartData, 2);

    addAutoPrediction({
      code: String(code),
      name,
      baseDate: String(lastBar.date),
      basePrice: Number(lastBar.close || selected?.price || 0),
      horizon: 5,
      prediction: autoPrediction.prediction,
      predictionScore: autoPrediction.score,
      predictionReason: autoPrediction.reasons.join(" + "),
      signalSet: buildSignalSet({ psych, activeTechnique, gogoSignal }),
    });
  }, [
    selected?.code,
    selected?.symbol,
    chartData[chartData.length - 1]?.date,
    historyState.loading,
    autoPrediction.prediction,
    autoPrediction.score,
    autoEnabled,
  ]);

  const last = chartData[chartData.length - 1];
  const srInfo = calcSupportResistance(chartData, Math.min(120, chartData.length));
  const fiboLevels = calcFibonacciLevels(chartData, Math.min(120, chartData.length));
  const boxInfo = calculateBoxBreakoutSignal(chartData);
  const suggestedTarget = srInfo?.target || (last ? Math.round(Number(last.close) * 1.05) : 0);
  const suggestedStop = srInfo?.stop || (last ? Math.round(Number(last.close) * 0.96) : 0);
  const hoverCandle = hoverIndex != null ? chartData[hoverIndex] : null;

  // 과거 데이터(표시 구간) 기반 최고/최저 예측 콘 — ATR% 변동성 + (국내는) AI 방향성 확률 드리프트
  const forecastCone = useMemo(
    () => computeForecastCone(chartData, predictionInfo?.probUp, predictionInfo?.horizonDays || 7),
    [chartData, predictionInfo?.probUp, predictionInfo?.horizonDays]
  );

  const reviewForecastWithAi = async () => {
    if (!forecastCone.predictedHigh || !forecastCone.predictedLow) return;
    setAiForecastLoading(true);
    setAiForecastError("");
    try {
      const prompt = buildForecastReviewPrompt(selected, stocks, { activeTechnique, gogoSignal, psych }, forecastCone);
      const data = await fetchJson("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt:
            "당신은 15년 경력의 주식 트레이딩 분석가입니다. 통계 기반 최고가/최저가 예측을 차트 분석과 시장 상황을 반영해 검토하고, 지정된 형식으로만 답하세요.",
          maxTokens: 700,
        }),
      });
      const text = data.text || data.result || "";
      const high = parseFirstPriceFromText(text, ["검토 최고가"]);
      const low = parseFirstPriceFromText(text, ["검토 최저가"]);
      const reasonMatch = text.match(/근거\s*[:：]\s*([\s\S]+)/);
      const reasoning = (reasonMatch ? reasonMatch[1] : text).trim();
      if (!high && !low) {
        setAiForecastError("AI 응답에서 예측값을 해석하지 못해 통계 예측값을 그대로 사용합니다.");
        setAiForecast({ high: null, low: null, reasoning: reasoning || "-" });
      } else {
        setAiForecast({
          high: high || Math.round(forecastCone.predictedHigh),
          low: low || Math.round(forecastCone.predictedLow),
          reasoning: reasoning || "-",
        });
      }
    } catch (e) {
      const msg = e.message || String(e);
      const isQuota = msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate");
      setAiForecastError(isQuota ? "Gemini API 한도 초과로 검토를 완료하지 못했습니다. 잠시 후 다시 시도하세요." : `AI 검토 중 오류: ${msg}`);
    } finally {
      setAiForecastLoading(false);
    }
  };

  const width = 900;
  const height = 620;
  const pad = { l: 82, r: 42, t: 52, b: 44 };
  const main = { x: 82, y: 52, w: width - 126, h: 306 };
  const vol = { x: 82, y: 392, w: width - 126, h: 72 };
  const rsiPanel = { x: 82, y: 510, w: width - 126, h: 78 };
  const highs = chartData.map((d) => Number(d.high));
  const lows = chartData.map((d) => Number(d.low));
  const maValues = [...ma5, ...ma20, ...ma60].filter(Boolean);
  const bollValues = bollingerSeries.filter(Boolean).flatMap((b) => [b.upper, b.lower]);
  const extraValues = [];
  if (srInfo?.support?.price) extraValues.push(srInfo.support.price);
  if (srInfo?.resistance?.price) extraValues.push(srInfo.resistance.price);
  if (suggestedTarget) extraValues.push(suggestedTarget);
  if (suggestedStop) extraValues.push(suggestedStop);
  fiboLevels.forEach((f) => extraValues.push(f.price));
  if (boxInfo?.upper) extraValues.push(boxInfo.upper, boxInfo.lower);
  if (gogoSignal.status === "OK") extraValues.push(gogoSignal.trendLinePrice);
  if (activeTechniqueKey === "bollinger" && activeTechnique?.raw?.upper) {
    extraValues.push(activeTechnique.raw.upper, activeTechnique.raw.lower);
  }
  if (activeTechniqueKey === "volumeBreakout" && activeTechnique?.raw?.prevHigh) {
    extraValues.push(activeTechnique.raw.prevHigh);
  }
  if (activeTechniqueKey === "triangle" && activeTechnique?.raw?.status === "OK") {
    const t = activeTechnique.raw;
    extraValues.push(t.upperStart.price, t.upperEnd.price, t.lowerStart.price, t.lowerEnd.price);
  }
  if (activeTechniqueKey === "drawdown" && activeTechnique?.raw?.high52w) {
    extraValues.push(activeTechnique.raw.high52w);
  }
  if (forecastCone?.predictedHigh) extraValues.push(forecastCone.predictedHigh);
  if (forecastCone?.predictedLow) extraValues.push(forecastCone.predictedLow);
  if (aiForecast?.high) extraValues.push(aiForecast.high);
  if (aiForecast?.low) extraValues.push(aiForecast.low);
  const maxP = Math.max(...highs, ...maValues, ...bollValues, ...extraValues);
  const minP = Math.min(...lows, ...maValues, ...bollValues, ...extraValues);
  const pricePadding = Math.max(1, (maxP - minP) * 0.06);
  const chartMaxP = maxP + pricePadding;
  const chartMinP = Math.max(0, minP - pricePadding);
  const rangeP = Math.max(1, chartMaxP - chartMinP);
  const plotW = main.w;
  const plotH = main.h;
  const step = plotW / Math.max(1, chartData.length - 1);
  const xFor = (i) => main.x + i * step;
  const yFor = (v) => main.y + (chartMaxP - Number(v || 0)) / rangeP * plotH;
  const maxVol = Math.max(1, ...chartData.map((d) => Number(d.volume || 0)));
  const avgVol = safeAvg(chartData.map((d) => Number(d.volume || 0)));
  const yVol = (v) => vol.y + vol.h - (Number(v || 0) / maxVol) * vol.h;
  const yRsi = (v) => rsiPanel.y + rsiPanel.h - (Number(v || 0) / 100) * rsiPanel.h;
  const pathFor = (arr, valueGetter, yGetter = yFor) => {
    let started = false;
    return arr.map((item, i) => {
      const v = valueGetter(item, i);
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return "";
      const cmd = started ? "L" : "M";
      started = true;
      return `${cmd} ${xFor(i).toFixed(1)} ${yGetter(v).toFixed(1)}`;
    }).filter(Boolean).join(" ");
  };
  const maPath = (arr) => pathFor(arr, (v) => v, yFor);
  const bollPath = (key) => pathFor(bollingerSeries, (b) => b?.[key], yFor);
  const rsiPath = pathFor(rsiSeries, (v) => v, yRsi);
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

  // 차트 위 드래그로 과거/최근 이동, 휠로 확대/축소
  const updateHoverFromClientX = (clientX, rect) => {
    const relX = ((clientX - rect.left) / rect.width) * width;
    const idx = Math.round((relX - main.x) / Math.max(1, step));
    setHoverIndex(Math.max(0, Math.min(chartData.length - 1, idx)));
  };

  const handleChartPointerDown = (e) => {
    dragStateRef.current = { startClientX: e.clientX, startOffset: safeOffset };
    setIsDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };

  const handleChartPointerMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const drag = dragStateRef.current;
    if (drag) {
      const deltaClientX = e.clientX - drag.startClientX;
      const svgScale = width / Math.max(1, rect.width);
      const deltaBars = Math.round((deltaClientX * svgScale) / Math.max(1, step));
      const nextOffset = Math.max(0, Math.min(maxOffset, drag.startOffset + deltaBars));
      setWindowOffset(nextOffset);
    }
    updateHoverFromClientX(e.clientX, rect);
  };

  const endChartDrag = (e) => {
    dragStateRef.current = null;
    setIsDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const handleChartWheel = (e) => {
    try { e.preventDefault(); } catch {}
    const zoomIn = e.deltaY < 0;
    setVisibleCount((n) => {
      const base = Math.max(20, Math.min(fullChartData.length, n));
      const next = zoomIn ? Math.round(base * 0.85) : Math.round(base * 1.18);
      return Math.max(20, Math.min(fullChartData.length, next));
    });
  };

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
  const triangleInfo = activeTechniqueKey === "triangle" && activeTechnique?.raw?.status === "OK" ? activeTechnique.raw : null;
  const visualSignals = getChartVisualSignals({ activeTechniqueKey, chartData, gogoSignal, activeTechnique });

  return (
    <div className="grid">
      <div className="ai-report-scroll-panel">
        <AiReport selected={selected} stocks={stocks} chartContext={{ activeTechnique, gogoSignal, psych }} />
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
          {Array.isArray(stocks) && stocks.length > 0 && typeof setSelectedCode === "function" && (
            <div className="chart-mobile-stock-select">
              <label>차트 분석 종목 선택</label>
              <select value={selected?.code || selectedCode || ""} onChange={(e) => setSelectedCode(e.target.value)}>
                {stocks.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code}) · {s.tag || s.sector || "-"}</option>
                ))}
              </select>
              <div className="sub">핸드폰에서는 좌측 종목 목록 대신 이 선택창에서 분석 종목을 바꿉니다.</div>
            </div>
          )}

          <div className="chart-scroll-area">
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

          <div className="chart-pro-toolbar">
            <div className="chart-pro-chip"><b>지지선</b><br />{srInfo?.support?.price ? `${fmtPrice(srInfo.support.price)} · 접점 ${srInfo.support.count || 1}` : "-"}</div>
            <div className="chart-pro-chip"><b>저항선</b><br />{srInfo?.resistance?.price ? `${fmtPrice(srInfo.resistance.price)} · 접점 ${srInfo.resistance.count || 1}` : "-"}</div>
            <div className="chart-pro-chip"><b>목표/손절</b><br />목표 {fmtPrice(suggestedTarget)} · 손절 {fmtPrice(suggestedStop)}</div>
            <div className="chart-pro-chip"><b>박스권</b><br />{boxInfo?.upper ? `${fmtPrice(boxInfo.lower)} ~ ${fmtPrice(boxInfo.upper)} · 폭 ${boxInfo.widthRate}%` : "-"}</div>
            <div className="chart-pro-chip"><b>심리</b><br /><span style={{ color: psych.phaseColor }}>{psych.phase}</span> · {psych.fearGreedScore}점</div>
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
            <span>저점구조: {isGogoOk ? `${gogoSignal.lowStructure} · ${gogoSignal.lowSignal}` : "-"}</span>
          </div>

          <div className="forecast-panel">
            <div className="forecast-panel-title">
              <span>과거 데이터 기반 최고/최저 예측 ({forecastCone.horizonDays || 7}거래일)</span>
              <button className="btn" disabled={aiForecastLoading || !forecastCone.predictedHigh} onClick={reviewForecastWithAi}>
                {aiForecastLoading ? "AI 검토 중..." : "AI로 검토하기"}
              </button>
            </div>
            {forecastCone.predictedHigh != null ? (
              <div className="forecast-panel-body">
                <div className="forecast-stat-row">
                  <span className="forecast-stat-label">통계 예측</span>
                  <span className="forecast-stat-high">최고 {fmtPrice(Math.round(forecastCone.predictedHigh))}</span>
                  <span className="forecast-stat-low">최저 {fmtPrice(Math.round(forecastCone.predictedLow))}</span>
                  <span className="forecast-stat-note">
                    변동성(ATR) {(forecastCone.atrPct * 100).toFixed(2)}%
                    {selected?.assetClass !== "global" && predictionInfo?.probUp != null ? ` · AI 상승확률 ${predictionInfo.probUp}%` : " · 방향성 확률 미반영(순수 변동성)"}
                  </span>
                </div>
                {aiForecast && (
                  <div className="forecast-stat-row ai">
                    <span className="forecast-stat-label">AI 검토</span>
                    <span className="forecast-stat-high">최고 {aiForecast.high != null ? fmtPrice(aiForecast.high) : "-"}</span>
                    <span className="forecast-stat-low">최저 {aiForecast.low != null ? fmtPrice(aiForecast.low) : "-"}</span>
                    <span className="forecast-stat-note">{aiForecast.reasoning}</span>
                  </div>
                )}
                {aiForecastError && <div className="forecast-stat-error">{aiForecastError}</div>}
              </div>
            ) : (
              <div className="forecast-panel-body">
                <span className="forecast-stat-note">변동성을 계산할 데이터가 부족합니다.</span>
              </div>
            )}
          </div>

          <div className="indicator-legend">
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#f59e0b" }} />MA5</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#06b6d4" }} />MA20</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#8b5cf6" }} />볼린저밴드</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#22c55e" }} />거래량</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: "#a78bfa" }} />RSI</span>
            <span className="legend-pill"><span className="legend-dot" style={{ background: psych.phaseColor }} />심리 {psych.fearGreedScore}</span>
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
          <div className="chart-drag-hint">차트 위에서 마우스로 드래그하면 과거/최근 구간으로 이동하고, 마우스 휠로 확대·축소할 수 있습니다.</div>

          <div className={`chart-box pro-chart-box ${chartFullscreen ? "chart-box-fullscreen" : ""}`}>
            {chartFullscreen && <button className="chart-back-btn" onClick={() => setChartFullscreen(false)}>돌아가기</button>}
            {hoverCandle && (
              <div className="chart-tooltip" style={{ left: "74px", top: "18px" }}>
                <b>{hoverCandle.date}</b><br />
                시가: {fmtPrice(hoverCandle.open)} / 고가: {fmtPrice(hoverCandle.high)}<br />
                저가: {fmtPrice(hoverCandle.low)} / 종가: {fmtPrice(hoverCandle.close)}<br />
                거래량: {fmtPrice(hoverCandle.volume)}
              </div>
            )}
            <div className="chart-svg-wrap">
            <svg
              className={`chart-svg pro-chart-svg${isDragging ? " dragging" : ""}`}
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ fontFamily: "var(--paperlogy-font)" }}
              onPointerDown={handleChartPointerDown}
              onPointerMove={handleChartPointerMove}
              onPointerUp={endChartDrag}
              onPointerCancel={endChartDrag}
              onPointerLeave={(e) => { endChartDrag(e); setHoverIndex(null); }}
              onWheel={handleChartWheel}
            >
              <defs>
                <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L7,3 z" fill="#00ff88" />
                </marker>
              </defs>

              <rect x="0" y="0" width={width} height={height} fill="#0a0f1e" />
              <rect x="5" y="8" width={width - 10} height={main.y + main.h - 8 + 24} rx="10" className="pro-panel-bg" />
              <rect x="5" y={vol.y - 22} width={width - 10} height={vol.h + 42} rx="10" className="pro-panel-bg" />
              <rect x="5" y={rsiPanel.y - 22} width={width - 10} height={rsiPanel.h + 42} rx="10" className="pro-panel-bg" />

              {[0, 1, 2, 3, 4].map((g) => {
                const y = main.y + (main.h / 4) * g;
                const price = chartMaxP - (rangeP / 4) * g;
                return (
                  <g key={`main-grid-${g}`}>
                    <line x1={main.x} y1={y} x2={main.x + main.w} y2={y} className="pro-grid" />
                    <text x={main.x - 12} y={y + 5} textAnchor="end" className="axis-label">{fmtPrice(price)}</text>
                  </g>
                );
              })}

              <path d={bollPath("upper")} className="line-boll" />
              <path d={bollPath("lower")} className="line-boll" />
              <path d={maPath(ma5)} className="line-ma5" />
              <path d={maPath(ma20)} className="line-ma20" />

              {srInfo?.supportZone && (
                <>
                  <rect x={main.x} y={yFor(srInfo.supportZone[1])} width={main.w} height={Math.max(3, yFor(srInfo.supportZone[0]) - yFor(srInfo.supportZone[1]))} className="sr-zone-support" />
                  <line x1={main.x} y1={yFor(srInfo.support.price)} x2={main.x + main.w} y2={yFor(srInfo.support.price)} className="support-line" />
                </>
              )}
              {srInfo?.resistanceZone && (
                <>
                  <rect x={main.x} y={yFor(srInfo.resistanceZone[1])} width={main.w} height={Math.max(3, yFor(srInfo.resistanceZone[0]) - yFor(srInfo.resistanceZone[1]))} className="sr-zone-resistance" />
                  <line x1={main.x} y1={yFor(srInfo.resistance.price)} x2={main.x + main.w} y2={yFor(srInfo.resistance.price)} className="resistance-line" />
                </>
              )}
              {boxInfo?.upper && <rect x={main.x} y={yFor(boxInfo.upper)} width={main.w} height={Math.max(4, yFor(boxInfo.lower) - yFor(boxInfo.upper))} className="box-zone" />}

              {forecastCone?.predictedHigh != null && forecastCone?.predictedLow != null && (
                <>
                  <rect
                    x={main.x}
                    y={yFor(forecastCone.predictedHigh)}
                    width={main.w}
                    height={Math.max(2, yFor(forecastCone.predictedLow) - yFor(forecastCone.predictedHigh))}
                    className="forecast-cone-zone"
                  />
                  <line x1={main.x} y1={yFor(forecastCone.predictedHigh)} x2={main.x + main.w} y2={yFor(forecastCone.predictedHigh)} className="forecast-high-line" />
                  <line x1={main.x} y1={yFor(forecastCone.predictedLow)} x2={main.x + main.w} y2={yFor(forecastCone.predictedLow)} className="forecast-low-line" />
                </>
              )}
              {aiForecast?.high != null && (
                <line x1={main.x} y1={yFor(aiForecast.high)} x2={main.x + main.w} y2={yFor(aiForecast.high)} className="ai-forecast-high-line" />
              )}
              {aiForecast?.low != null && (
                <line x1={main.x} y1={yFor(aiForecast.low)} x2={main.x + main.w} y2={yFor(aiForecast.low)} className="ai-forecast-low-line" />
              )}

              {chartData.map((d, i) => {
                const x = xFor(i);
                const candleW = Math.max(2, Math.min(9, step * 0.62));
                const yOpen = yFor(d.open);
                const yClose = yFor(d.close);
                const yHigh = yFor(d.high);
                const yLow = yFor(d.low);
                const up = Number(d.close) >= Number(d.open);
                return (
                  <g key={`${d.date}-${i}`}>
                    <line x1={x} y1={yHigh} x2={x} y2={yLow} className="wick" />
                    <rect x={x - candleW / 2} y={Math.min(yOpen, yClose)} width={candleW} height={Math.max(1.5, Math.abs(yClose - yOpen))} className={up ? "candle-up" : "candle-down"} />
                  </g>
                );
              })}

              {psychPatterns.slice(-6).map((p, i) => {
                const idx = Math.max(0, Math.min(chartData.length - 1, p.index));
                const x = xFor(idx);
                const y = p.sentiment === "bullish" ? yFor(chartData[idx]?.low) + 13 : yFor(chartData[idx]?.high) - 13;
                return p.sentiment === "bullish" ? (
                  <path key={`psych-pattern-${i}`} d={`M ${x} ${y - 9} L ${x - 6} ${y + 3} L ${x + 6} ${y + 3} Z`} className="pattern-marker-up" />
                ) : (
                  <path key={`psych-pattern-${i}`} d={`M ${x} ${y + 9} L ${x - 6} ${y - 3} L ${x + 6} ${y - 3} Z`} className="pattern-marker-down" />
                );
              })}

              {volumeBreak && <line x1={main.x} y1={yFor(volumeBreak.prevHigh)} x2={main.x + main.w} y2={yFor(volumeBreak.prevHigh)} className="volume-break-line" />}

              {showGogo && isGogoOk && trendStart && trendEnd && (
                <>
                  <line x1={trendStart.x} y1={trendStart.y} x2={trendEnd.x} y2={trendEnd.y} className="line-trend" />
                  <circle cx={trendStart.x} cy={trendStart.y} r="5" fill="#ff4466" />
                  <circle cx={xFor(selectedHigh2.index)} cy={yFor(selectedHigh2.price)} r="5" fill="#ff4466" />
                  <circle cx={trendEnd.x} cy={trendEnd.y} r="5" fill={gogoSignal.checks.isBreakout ? "#00ff88" : "#ff4466"} />
                </>
              )}

              {triangleInfo && (
                <>
                  <line
                    x1={xFor(triangleInfo.upperStart.index)} y1={yFor(triangleInfo.upperStart.price)}
                    x2={xFor(triangleInfo.upperEnd.index)} y2={yFor(triangleInfo.upperEnd.price)}
                    className="resistance-line"
                  />
                  <line
                    x1={xFor(triangleInfo.lowerStart.index)} y1={yFor(triangleInfo.lowerStart.price)}
                    x2={xFor(triangleInfo.lowerEnd.index)} y2={yFor(triangleInfo.lowerEnd.price)}
                    className="support-line"
                  />
                  <circle cx={xFor(triangleInfo.upperEnd.index)} cy={yFor(triangleInfo.upperEnd.price)} r="5" fill={triangleInfo.isBreakoutUp ? "#00ff88" : "#9b5cff"} />
                  <circle cx={xFor(triangleInfo.lowerEnd.index)} cy={yFor(triangleInfo.lowerEnd.price)} r="5" fill={triangleInfo.isBreakoutDown ? "#ff4466" : "#ffd447"} />
                </>
              )}

              {visualSignals.slice(0, 5).map((s, i) => {
                const sx = xFor(Math.max(0, Math.min(chartData.length - 1, s.index)));
                const sy = yFor(s.price);
                return (
                  <g key={`${s.label}-${i}`}>
                    <circle cx={sx} cy={sy} r="5" fill={s.color} />
                    <text x={Math.min(width - 130, sx + 8)} y={Math.max(main.y + 16, sy - 10)} fill={s.color} className="sig-label">{s.label}</text>
                  </g>
                );
              })}

              <rect x="18" y="18" width="350" height="30" rx="8" className="pro-legend-bg" />
              <text x="30" y="39" className="pro-section-title" fill="#f5a400">■ MA5</text>
              <text x="95" y="39" className="pro-section-title" fill="#06b6d4">■ MA20</text>
              <text x="170" y="39" className="pro-section-title" fill="#8b5cf6">■ 볼린저밴드</text>
              <text x="285" y="39" className="pro-section-title">패턴 {psychPatterns.length}개 감지</text>

              <text x="30" y={vol.y - 8} className="pro-section-title">거래량</text>
              <text x={main.x - 12} y={vol.y + 12} textAnchor="end" className="axis-label">{`${Math.round(maxVol / 10000).toLocaleString()}만`}</text>
              <line x1={vol.x} y1={yVol(avgVol)} x2={vol.x + vol.w} y2={yVol(avgVol)} className="volume-avg-line" />
              {chartData.map((d, i) => {
                const x = xFor(i);
                const barW = Math.max(1.5, Math.min(9, step * 0.62));
                const barH = vol.y + vol.h - yVol(d.volume || 0);
                const up = Number(d.close) >= Number(d.open);
                return <rect key={`vol-${d.date}-${i}`} x={x - barW / 2} y={vol.y + vol.h - barH} width={barW} height={Math.max(1, barH)} className={up ? "volume-bar-up" : "volume-bar-down"} />;
              })}

              <text x="30" y={rsiPanel.y - 8} className="pro-section-title">RSI (14) — {psych.rsiValue}</text>
              {[70, 50, 30].map((level) => (
                <g key={`rsi-guide-${level}`}>
                  <line x1={rsiPanel.x} y1={yRsi(level)} x2={rsiPanel.x + rsiPanel.w} y2={yRsi(level)} className={level === 70 ? "rsi-guide-red" : level === 30 ? "rsi-guide-green" : "rsi-guide-mid"} />
                  <text x={rsiPanel.x - 12} y={yRsi(level) + 5} textAnchor="end" className="axis-label">{level}</text>
                </g>
              ))}
              <path d={rsiPath} className="rsi-line" />

              {hoverIndex != null && chartData[hoverIndex] && (
                <>
                  <line x1={xFor(hoverIndex)} y1={main.y} x2={xFor(hoverIndex)} y2={rsiPanel.y + rsiPanel.h} className="chart-cross-line" />
                  <line x1={main.x} y1={yFor(chartData[hoverIndex].close)} x2={main.x + main.w} y2={yFor(chartData[hoverIndex].close)} className="chart-cross-line" />
                </>
              )}

              {axisLabels.map(({ d, i }, idx) => {
                const x = xFor(i);
                const anchor = i === 0 ? "start" : i === chartData.length - 1 ? "end" : "middle";
                const tx = i === 0 ? x + 2 : i === chartData.length - 1 ? x - 2 : x;
                return (
                  <g key={`axis-${i}`}>
                    <line x1={x} y1={rsiPanel.y + rsiPanel.h + 4} x2={x} y2={rsiPanel.y + rsiPanel.h + 10} stroke="#254357" strokeWidth="1" />
                    <text x={tx} y={rsiPanel.y + rsiPanel.h + 24} textAnchor={anchor} className="x-axis-label">{formatAxisDate(d.date)}</text>
                    {(i === 0 || i === chartData.length - 1) && <text x={tx} y={rsiPanel.y + rsiPanel.h + 40} textAnchor={anchor} className="x-axis-year">{formatAxisYear(d.date)}</text>}
                  </g>
                );
              })}
            </svg>
            </div>
          </div>
          <div className="chart-caption">
            <span>노란선: MA5</span>
            <span>파란선: MA20</span>
            <span>보라선: 볼린저밴드</span>
            <span>노란 점선: 지지선</span>
            <span>보라 점선: 저항선</span>
            <span>빨간 점선: 고고저 추세선</span>
          </div>
          <div className="chart-period-note">
            차트 하단 기간 표시는 <b>년.월</b> 기준입니다. 왼쪽은 과거, 오른쪽은 최신 시세입니다. 확대/축소 및 이전/최근 이동 시 표시 구간의 기간도 함께 변경됩니다.
          </div>
          {isGogoOk && (
            <div className={`gogo-low-note ${String(gogoSignal.lowSignal || "").includes("위험") ? "risk" : gogoSignal.lowSignal === "상승 전환" ? "bull" : ""}`}>
              <b>고고저 저점구조:</b> {gogoSignal.lowStructure} · {gogoSignal.lowSignal}
              <br />
              <span>{gogoSignal.lowComment}</span>
            </div>
          )}
          {isGogoOk && (
            <div className={`gogo-breakout-note ${gogoSignal.checks?.isRealBreakout ? "bull" : gogoSignal.checks?.isFalseBreakoutRisk || gogoSignal.checks?.isTrendTooSteep ? "risk" : ""}`}>
              <b>추세선 돌파 신뢰도:</b> {gogoSignal.breakoutQuality}
              <br />
              <span>{gogoSignal.breakoutComment}</span>
              {gogoSignal.checks?.isTrendTooSteep && <><br /><span>추세선 기울기가 과도하게 가팔라 가짜 돌파 가능성을 추가 감점했습니다.</span></>}
            </div>
          )}

          </div>

          <PsychologyPanel
            selected={selected}
            name={name}
            last={last}
            psych={psych}
            patterns={psychPatterns}
            log={lastPsychLog}
            pending={psychPending}
            done={psychDone}
            signalStats={psychSignalStats}
            autoPrediction={autoPrediction}
            addEntry={addPsychEntry}
            updateResult={updatePsychResult}
            accuracy={psychAccuracy}
            autoEnabled={autoEnabled}
            setAutoEnabled={setAutoEnabled}
            clearLearning={clearLearning}
          />

          <div className="kpi-grid" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="card-title">선택 기법</div><strong>{activeTechnique?.name}</strong></div>
            <div className="kpi"><div className="card-title">AI 점수</div><strong>{activeTechnique?.score}</strong></div>
            <div className="kpi"><div className="card-title">등급</div><strong className={activeTechnique?.grade === "강한 매수 후보" || activeTechnique?.grade === "관심 종목" ? "up" : ""}>{activeTechnique?.grade}</strong></div>
            <div className="kpi"><div className="card-title">전략</div><strong>{activeTechnique?.action}</strong></div>
            <div className="kpi"><div className="card-title">고고저 점수</div><strong>{isGogoOk ? gogoSignal.score : "-"}</strong></div>
            <div className="kpi"><div className="card-title">추세선 가격</div><strong>{isGogoOk ? fmtPrice(gogoSignal.trendLinePrice) : "-"}</strong></div>
            <div className="kpi"><div className="card-title">돌파율</div><strong className={isGogoOk && gogoSignal.breakoutRate >= 0 ? "up" : "down"}>{isGogoOk ? `${gogoSignal.breakoutRate}%` : "-"}</strong></div>
            <div className="kpi"><div className="card-title">저점구조</div><strong className={isGogoOk && (gogoSignal.checks?.isLowRising || gogoSignal.lowSignal === "상승 전환") ? "up" : isGogoOk && (gogoSignal.checks?.isLowBreakdown || gogoSignal.lowSignal?.includes("위험")) ? "down" : ""}>{isGogoOk ? gogoSignal.lowStructure : "-"}</strong></div>
            <div className="kpi"><div className="card-title">저점판정</div><strong className={isGogoOk && gogoSignal.lowSignal === "상승 전환" ? "up" : isGogoOk && String(gogoSignal.lowSignal || "").includes("위험") ? "down" : ""}>{isGogoOk ? gogoSignal.lowSignal : "-"}</strong></div>
            <div className="kpi"><div className="card-title">돌파신뢰</div><strong className={isGogoOk && gogoSignal.checks?.isRealBreakout ? "up" : isGogoOk && gogoSignal.checks?.isFalseBreakoutRisk ? "down" : ""}>{isGogoOk ? gogoSignal.breakoutQuality : "-"}</strong></div>
            <div className="kpi"><div className="card-title">자동 목표가</div><strong className="up">{fmtPrice(suggestedTarget)}</strong></div>
            <div className="kpi"><div className="card-title">자동 손절가</div><strong className="down">{fmtPrice(suggestedStop)}</strong></div>
            <div className="kpi"><div className="card-title">심리 단계</div><strong style={{ color: psych.phaseColor }}>{psych.phase}</strong></div>
            <div className="kpi"><div className="card-title">공포·탐욕</div><strong>{psych.fearGreedScore}</strong></div>
            <div className="kpi"><div className="card-title">검증</div><strong>{activeTechnique?.status}</strong></div>
          </div>

          <div className="footer-note">
            AI 자동 추천은 고고저, 이동평균 눌림, 지지·저항, 박스권 돌파, 볼린저 수축, 거래량 돌파, RSI 반등, 갭/과열과 함께 심리분석까지 확인하도록 확장했습니다. 고고저 하락추세선을 만들 수 없으면 일봉 5년/10년 또는 월봉 10년까지 확장 조회해 다시 판정합니다.
            수동 선택 시 선택한 기법 기준으로 보조선과 KPI가 바뀝니다.
          </div>

          <IndicatorReadMe />
        </div>
      </div>
    </div>
  );
}



function GlobalMarket({ globalQuotes, setGlobalQuotes, selectedGlobal, setSelectedGlobal }) {
  const [custom, setCustom] = useState(() => loadLS("alpha_global_custom", []));
  const [form, setForm] = useState({ symbol: "", type: "us" });
  const [loading, setLoading] = useState(false);
  const assets = useMemo(() => {
    const map = new Map();
    [...GLOBAL_TICKERS, ...custom].forEach((x) => {
      const symbol = normalizeGlobalInput(x.symbol);
      if (symbol) map.set(symbol, { ...x, symbol, type: x.type || (isCryptoSymbol(symbol) ? "crypto" : "us"), assetClass: "global", code: symbol });
    });
    return Array.from(map.values());
  }, [custom]);

  useEffect(() => saveLS("alpha_global_custom", custom), [custom]);

  const quoteMap = useMemo(() => {
    const m = new Map();
    globalQuotes.forEach((q) => m.set(q.symbol, q));
    return m;
  }, [globalQuotes]);

  const refresh = async () => {
    setLoading(true);
    try {
      const pairs = await Promise.all(
        assets.map(async (a) => {
          try {
            const endpoint = globalEndpointFor(a.symbol, a.type);
            const q = await fetchJson(endpoint);
            return {
              ...a,
              ...q,
              symbol: a.symbol,
              code: a.symbol,
              name: a.name,
              type: a.type,
              assetClass: "global",
              price: q.price,
              changeRate: q.changeRate ?? 0,
              changeStr: q.changeStr || fmtRate(q.changeRate),
              realtime: true,
            };
          } catch {
            return { ...a, price: null, changeRate: 0, changeStr: "-", realtime: false };
          }
        })
      );
      setGlobalQuotes(pairs);
      if (!selectedGlobal && pairs[0]) setSelectedGlobal(pairs[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!globalQuotes.length) refresh();
  }, []);

  const add = () => {
    const symbol = normalizeGlobalInput(form.symbol);
    if (!symbol) return alert("미국 종목 티커 또는 코인 심볼을 입력하세요. 예: NVDA, AAPL, BTC");
    const type = form.type || (isCryptoSymbol(symbol) ? "crypto" : "us");
    const exists = assets.some((a) => a.symbol === symbol);
    if (!exists) setCustom((p) => [...p, { symbol, name: symbol, type, sector: type === "crypto" ? "Crypto" : "US" }]);
    setSelectedGlobal({ symbol, code: symbol, name: symbol, type, assetClass: "global" });
    setForm({ symbol: "", type: "us" });
  };

  const selected = selectedGlobal || globalQuotes[0] || assets[0];
  const selectedQuote = selected ? { ...selected, ...(quoteMap.get(selected.symbol) || {}) } : null;

  return (
    <div className="global-grid">
      <div className="panel">
        <div className="panel-title">
          <span>미국주식 · 가상자산 실시간</span>
          <span className="tag green">{assets.length}개</span>
        </div>
        <div className="panel-body">
          <div className="global-form">
            <input className="input" placeholder="티커/코인 예: NVDA, AAPL, BTC" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="us">미국주식</option>
              <option value="crypto">가상자산</option>
            </select>
            <button className="btn" onClick={add}>추가</button>
          </div>
          <button className="btn full" onClick={refresh}>{loading ? "조회 중..." : "미국/코인 시세 새로고침"}</button>
          <div style={{ height: 10 }} />
          <div className="global-list">
            {assets.map((a) => {
              const q = quoteMap.get(a.symbol) || a;
              const active = selected?.symbol === a.symbol;
              return (
                <button key={a.symbol} className={`global-card ${active ? "active" : ""}`} onClick={() => setSelectedGlobal({ ...a, ...(q || {}) })}>
                  <div className="global-card-top">
                    <span className="global-symbol">{a.symbol}</span>
                    <span className="global-badge">{a.type === "crypto" ? "CRYPTO" : "US"}</span>
                  </div>
                  <div className="global-name">{a.name || a.symbol} · {a.sector || "-"}</div>
                  <div className="global-price">{q.price ? fmtGlobalPrice(q) : "-"}</div>
                  <div className={Number(q.changeRate || 0) >= 0 ? "up" : "down"}>{q.changeStr || fmtRate(q.changeRate)}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid">
        <div className="panel">
          <div className="panel-title">
            <span>{selectedQuote?.symbol || "-"} 글로벌 분석</span>
            <span className={selectedQuote?.realtime ? "tag green" : "tag demo"}>{selectedQuote?.realtime ? "REALTIME" : "YAHOO/대기"}</span>
          </div>
          <div className="panel-body">
            <div className="kpi-grid">
              <div className="kpi"><div className="card-title">자산</div><strong>{selectedQuote?.name || selectedQuote?.symbol || "-"}</strong></div>
              <div className="kpi"><div className="card-title">현재가</div><strong>{selectedQuote ? fmtGlobalPrice(selectedQuote) : "-"}</strong></div>
              <div className="kpi"><div className="card-title">등락률</div><strong className={Number(selectedQuote?.changeRate || 0) >= 0 ? "up" : "down"}>{selectedQuote?.changeStr || fmtRate(selectedQuote?.changeRate)}</strong></div>
              <div className="kpi"><div className="card-title">구분</div><strong>{selectedQuote?.type === "crypto" ? "가상자산" : "미국주식"}</strong></div>
            </div>
          </div>
        </div>
        {selectedQuote && (
          <ChartView
            selected={{
              ...selectedQuote,
              code: selectedQuote.symbol,
              symbol: selectedQuote.symbol,
              name: selectedQuote.name || selectedQuote.symbol,
              assetClass: "global",
              type: selectedQuote.type || (isCryptoSymbol(selectedQuote.symbol) ? "crypto" : "us"),
              price: selectedQuote.price,
              changeRate: selectedQuote.changeRate,
              changeStr: selectedQuote.changeStr,
            }}
            stocks={[]}
          />
        )}
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



function stableNumber(seedText = "") {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function sectorColorByName(name = "") {
  const palette = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#ef4444", "#06b6d4", "#a3e635"];
  return palette[stableNumber(name) % palette.length];
}

function sectorIconByName(name = "") {
  const icons = ["◈", "⬡", "✦", "⬟", "◆", "▣", "◉", "◇", "⬢", "▰"];
  return icons[stableNumber(name + "icon") % icons.length];
}

function phaseFromFearGreed(score) {
  if (score >= 80) return { phase: "극단 탐욕", color: "#ef4444", filter: "greed" };
  if (score >= 60) return { phase: "탐욕", color: "#f97316", filter: "greed" };
  if (score >= 40) return { phase: "중립", color: "#94a3b8", filter: "neutral" };
  if (score >= 20) return { phase: "공포", color: "#22c55e", filter: "fear" };
  return { phase: "극단 공포", color: "#3b82f6", filter: "fear" };
}

function psychologyBiases(phase) {
  const map = {
    "극단 탐욕": ["FOMO", "과잉확신", "군집행동"],
    "탐욕": ["확증편향", "최근성편향", "낙관론"],
    "중립": ["모호성회피", "관망", "현상유지"],
    "공포": ["손실회피", "비관론", "현상유지"],
    "극단 공포": ["패닉셀링", "손실회피", "가용성편향"],
  };
  return map[phase] || map["중립"];
}

function makeSectorIndexSeries(sector, avgChange, seed) {
  let v = 100;
  const out = [];
  const drift = Number(avgChange || 0) / 100 / 12;
  for (let i = 0; i < 60; i += 1) {
    const wave = Math.sin((i + seed % 11) / 5) * 0.004;
    const noise = (((seed >> (i % 16)) & 7) - 3) * 0.0009;
    v = Math.max(65, v * (1 + drift + wave + noise));
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

function estimateStockRsi(rate, seed) {
  return Math.round(Math.max(12, Math.min(92, 50 + Number(rate || 0) * 6 + ((seed % 21) - 10))));
}

function buildSectorMindRows(universe, quoteMap = {}) {
  const groups = universe.reduce((acc, s) => {
    const sector = s.sector || s.tag || "기타";
    acc[sector] = acc[sector] || [];
    acc[sector].push({ ...s, q: quoteMap[s.code] || {} });
    return acc;
  }, {});

  return Object.entries(groups).map(([sector, list]) => {
    const seed = stableNumber(sector);
    const color = sectorColorByName(sector);
    const icon = sectorIconByName(sector);
    const stocks = list.map((s) => {
      const q = s.q || {};
      const rate = Number(q.changeRate ?? q.rate ?? 0);
      const rsi = estimateStockRsi(rate, stableNumber(`${s.code}${sector}`));
      const change5d = Number((rate * (1.4 + (stableNumber(s.code) % 8) / 10)).toFixed(2));
      return {
        ...s,
        price: q.price,
        rate,
        rsi,
        change5d,
        volume: Number(q.volume || 0),
      };
    });

    const avgChange1d = stocks.length ? stocks.reduce((sum, s) => sum + s.rate, 0) / stocks.length : 0;
    const avgChange5d = stocks.length ? stocks.reduce((sum, s) => sum + s.change5d, 0) / stocks.length : 0;
    const avgRsi = stocks.length ? stocks.reduce((sum, s) => sum + s.rsi, 0) / stocks.length : 50;
    const positive = stocks.filter((s) => s.rate > 0).length;
    const fearGreed = Math.round(Math.max(2, Math.min(98, avgRsi * 0.58 + avgChange5d * 3.2 + 18 + (positive / Math.max(1, stocks.length)) * 10)));
    const phase = phaseFromFearGreed(fearGreed);
    const indexPrices = makeSectorIndexSeries(sector, avgChange5d, seed);
    const slope5 = indexPrices[indexPrices.length - 1] - indexPrices[indexPrices.length - 6];
    const slope20 = indexPrices[indexPrices.length - 1] - indexPrices[indexPrices.length - 20];
    const momentum = slope5 > 0 && slope20 > 0 ? "강한상승" : slope5 > 0 ? "단기반등" : slope5 < 0 && slope20 < 0 ? "하락추세" : "단기조정";
    const momentumColor = momentum === "강한상승" ? "#22c55e" : momentum === "단기반등" ? "#86efac" : momentum === "하락추세" ? "#ef4444" : "#fbbf24";
    const foreignNet = Math.round((avgChange1d * 1200) + ((seed % 5000) - 2500));
    const instNet = Math.round((avgChange5d * 650) + (((seed >> 3) % 3600) - 1800));
    const volumeRatio = Number((0.7 + Math.abs(avgChange1d) * 0.28 + (seed % 13) / 10).toFixed(1));
    const leader = [...stocks].sort((a, b) => b.rate - a.rate)[0];
    const laggard = [...stocks].sort((a, b) => a.rate - b.rate)[0];

    return {
      sector,
      icon,
      color,
      count: list.length,
      loaded: stocks.filter((x) => x.price || x.rate !== 0).length,
      avg: avgChange1d,
      avgChange1d: Number(avgChange1d.toFixed(2)),
      avgChange5d: Number(avgChange5d.toFixed(2)),
      avgRsi: Math.round(avgRsi),
      fearGreed,
      phase: phase.phase,
      phaseColor: phase.color,
      phaseFilter: phase.filter,
      positive,
      positiveRate: Math.round((positive / Math.max(1, stocks.length)) * 100),
      leader,
      laggard,
      strength: fearGreed,
      indexPrices,
      momentum,
      momentumColor,
      biases: psychologyBiases(phase.phase),
      foreignNet,
      instNet,
      volumeRatio,
      volumeAnomaly: volumeRatio >= 1.8,
      list: stocks.sort((a, b) => b.rate - a.rate),
    };
  }).sort((a, b) => b.fearGreed - a.fearGreed || b.avgChange1d - a.avgChange1d);
}

function buildThemeRowsFromUniverse(universe, quoteMap = {}) {
  return buildSectorMindRows(universe, quoteMap);
}

async function scanThemeUniverse({ universe, baseQuotes = {}, onProgress }) {
  const quoteMap = { ...baseQuotes };
  const concurrency = 8;
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < universe.length) {
      const s = universe[cursor++];
      try {
        if (!quoteMap[s.code] || quoteMap[s.code].fallback || !quoteMap[s.code].price) {
          quoteMap[s.code] = await fetchJson(`/api/quote/${s.code}?lite=1`);
        }
      } catch (err) {
        quoteMap[s.code] = {
          code: s.code,
          name: s.name,
          price: null,
          changeRate: 0,
          changeStr: "-",
          error: true,
          errorMessage: err.message || String(err),
        };
      }
      done += 1;
      if (onProgress) onProgress({ done, total: universe.length, current: s });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, universe.length)) }, () => worker()));
  return quoteMap;
}

function SectorSparkline({ values = [], color = "#00d9ff" }) {
  const w = 180;
  const h = 44;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - 4 - ((v - min) / range) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="44" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
      {values.length > 0 && <circle cx={w} cy={h - 4 - ((values[values.length - 1] - min) / range) * (h - 8)} r="3" fill={color} />}
    </svg>
  );
}

function SectorRadar({ rows }) {
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const r = 122;
  const list = rows.slice(0, 8);
  const n = Math.max(1, list.length);
  const point = (idx, value = 100, extra = 0) => {
    const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
    const radius = r * (value / 100) + extra;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };
  const poly = list.map((s, i) => point(i, s.fearGreed).map((x) => x.toFixed(1)).join(",")).join(" ");
  return (
    <svg className="sectormind-svg" viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <polygon key={ratio} points={list.map((_, i) => point(i, ratio * 100).map((x) => x.toFixed(1)).join(",")).join(" ")} fill="none" stroke={ratio === 1 ? "#1e3445" : "#102334"} />
      ))}
      {list.map((_, i) => {
        const [x, y] = point(i, 100);
        return <line key={`spoke-${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke="#102334" />;
      })}
      <polygon points={poly} fill="rgba(99,102,241,.16)" stroke="#6366f1" strokeWidth="2" />
      {list.map((s, i) => {
        const [x, y] = point(i, s.fearGreed);
        const [lx, ly] = point(i, 100, 28);
        return (
          <g key={s.sector}>
            <circle cx={x} cy={y} r="5" fill={s.color} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill={s.color} fontSize="11" fontWeight="900">{s.sector.slice(0, 5)}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="4" fill="#334155" />
    </svg>
  );
}

function SectorBubbleChart({ rows }) {
  return (
    <svg className="sectormind-svg" viewBox="0 0 420 320">
      <rect x="30" y="20" width="360" height="260" fill="#071018" stroke="#1e3445" />
      <line x1="210" y1="20" x2="210" y2="280" stroke="#1e3445" />
      <line x1="30" y1="150" x2="390" y2="150" stroke="#1e3445" />
      <text x="210" y="304" textAnchor="middle" fill="#6f899a" fontSize="11">탐욕 지수 →</text>
      <text x="10" y="150" textAnchor="middle" fill="#6f899a" fontSize="11" transform="rotate(-90 10 150)">RSI ↑</text>
      {rows.slice(0, 12).map((s) => {
        const x = 30 + (s.fearGreed / 100) * 360;
        const y = 280 - (s.avgRsi / 100) * 260;
        const size = Math.max(8, Math.min(28, 8 + Math.abs(s.avgChange5d) * 1.7));
        return (
          <g key={s.sector}>
            <circle cx={x} cy={y} r={size} fill={s.color} opacity=".78" />
            <text x={x} y={y + 3} textAnchor="middle" fill="#061018" fontSize="9" fontWeight="900">{s.sector.slice(0, 2)}</text>
          </g>
        );
      })}
    </svg>
  );
}


function sectorPickScore(stock, sectorRow) {
  const rsiScore = stock.rsi >= 45 && stock.rsi <= 68 ? 24 : stock.rsi < 35 ? 16 : stock.rsi > 75 ? -12 : 8;
  const momentumScore = Math.max(-12, Math.min(28, Number(stock.change5d || 0) * 4));
  const dayScore = Math.max(-10, Math.min(20, Number(stock.rate || 0) * 5));
  const sectorScore = Math.max(0, Math.min(24, Number(sectorRow?.fearGreed || 50) * 0.24));
  const flowScore = ((sectorRow?.foreignNet || 0) > 0 ? 7 : -2) + ((sectorRow?.instNet || 0) > 0 ? 7 : -2);
  const volumeScore = sectorRow?.volumeAnomaly ? 6 : 0;
  const raw = 45 + rsiScore + momentumScore + dayScore + sectorScore + flowScore + volumeScore;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function buildSectorTopPicks(rows, marketLabel, limit = 20) {
  return rows
    .flatMap((sectorRow) =>
      (sectorRow.list || [])
        .filter((s) => !marketLabel || String(s.market || "").includes(marketLabel))
        .map((s) => {
          const score = sectorPickScore(s, sectorRow);
          const tags = [];
          if (sectorRow.fearGreed >= 60) tags.push("섹터 심리 강세");
          if (sectorRow.fearGreed < 40) tags.push("공포권 역발상");
          if (s.rsi >= 45 && s.rsi <= 68) tags.push("RSI 안정권");
          if (s.change5d > 0) tags.push("5일 모멘텀");
          if (sectorRow.foreignNet > 0) tags.push("외국인 수급 우위");
          if (sectorRow.instNet > 0) tags.push("기관 수급 우위");
          return {
            ...s,
            sector: sectorRow.sector,
            sectorFearGreed: sectorRow.fearGreed,
            sectorPhase: sectorRow.phase,
            score,
            prediction: score >= 74 ? "상승" : score >= 60 ? "관찰" : "보류",
            tags: tags.slice(0, 4).join(" · ") || "중립 관찰",
          };
        })
    )
    .sort((a, b) => b.score - a.score || b.change5d - a.change5d)
    .slice(0, limit);
}

function pickPredictionFromScore(score) {
  if (score >= 74) return "up";
  if (score <= 45) return "down";
  return "side";
}

function classifyPickResult(returnPct, threshold = 2) {
  if (returnPct >= threshold) return "up";
  if (returnPct <= -threshold) return "down";
  return "side";
}

function useSectorPickAccuracy() {
  const [records, setRecords] = useState(() => loadLS("alpha_sector_pick_accuracy_log", []));
  const [autoSave, setAutoSave] = useState(() => loadLS("alpha_sector_pick_auto_save", true));

  useEffect(() => saveLS("alpha_sector_pick_accuracy_log", records), [records]);
  useEffect(() => saveLS("alpha_sector_pick_auto_save", autoSave), [autoSave]);

  const saveTodayPicks = useCallback((picks, market) => {
    if (!autoSave || !Array.isArray(picks) || !picks.length) return 0;
    const today = new Date().toISOString().slice(0, 10);
    let added = 0;
    setRecords((prev) => {
      const map = new Map(prev.map((r) => [`${r.baseDate}_${r.market}_${r.code}`, r]));
      picks.forEach((p) => {
        const key = `${today}_${market}_${p.code}`;
        if (!map.has(key)) {
          map.set(key, {
            id: `${key}_${Date.now()}`,
            market,
            code: p.code,
            name: p.name,
            sector: p.sector,
            baseDate: today,
            basePrice: Number(p.price || 0),
            score: p.score,
            prediction: pickPredictionFromScore(p.score),
            tags: p.tags,
            horizon: 5,
            status: "pending",
            createdAt: new Date().toISOString(),
          });
          added += 1;
        }
      });
      return Array.from(map.values()).slice(-1200);
    });
    return added;
  }, [autoSave]);

  const evaluateRecords = useCallback((quoteMap = {}) => {
    let evaluated = 0;
    setRecords((prev) => prev.map((r) => {
      if (r.status === "done") return r;
      const q = quoteMap[r.code];
      const nowPrice = Number(q?.price || 0);
      if (!nowPrice || !Number(r.basePrice)) return r;
      const ageDays = Math.floor((Date.now() - new Date(r.createdAt || r.baseDate).getTime()) / 86400000);
      if (ageDays < Number(r.horizon || 5)) return r;
      const returnPct = ((nowPrice - Number(r.basePrice)) / Number(r.basePrice)) * 100;
      const actual = classifyPickResult(returnPct, 2);
      evaluated += 1;
      return {
        ...r,
        status: "done",
        actual,
        returnPct: Number(returnPct.toFixed(2)),
        evaluatedAt: new Date().toISOString(),
        correct: actual === r.prediction,
      };
    }));
    return evaluated;
  }, []);

  const clearRecords = useCallback(() => setRecords([]), []);

  const done = records.filter((r) => r.status === "done");
  const pending = records.filter((r) => r.status !== "done");
  const accuracy = done.length ? Math.round(done.filter((r) => r.correct).length / done.length * 100) : null;
  const kospiDone = done.filter((r) => r.market === "KOSPI200");
  const kosdaqDone = done.filter((r) => r.market === "KOSDAQ200");
  const kospiAccuracy = kospiDone.length ? Math.round(kospiDone.filter((r) => r.correct).length / kospiDone.length * 100) : null;
  const kosdaqAccuracy = kosdaqDone.length ? Math.round(kosdaqDone.filter((r) => r.correct).length / kosdaqDone.length * 100) : null;

  return {
    records,
    pending,
    done,
    accuracy,
    kospiAccuracy,
    kosdaqAccuracy,
    autoSave,
    setAutoSave,
    saveTodayPicks,
    evaluateRecords,
    clearRecords,
  };
}


function ThemeAnalysis({ stocks, quotes }) {
  const [scope, setScope] = useState("both200");
  const [themeQuotes, setThemeQuotes] = useState({});
  const [scanState, setScanState] = useState({ loading: false, done: 0, total: 0, current: "", lastRun: "", error: "" });
  const [selectedSector, setSelectedSector] = useState("");
  const [viewMode, setViewMode] = useState("cards");
  const [sortBy, setSortBy] = useState("fearGreed");
  const [filterPhase, setFilterPhase] = useState("all");
  const [pickView, setPickView] = useState("both");
  const {
    records: pickRecords,
    pending: pickPending,
    done: pickDone,
    accuracy: pickAccuracy,
    kospiAccuracy,
    kosdaqAccuracy,
    autoSave: pickAutoSave,
    setAutoSave: setPickAutoSave,
    saveTodayPicks,
    evaluateRecords,
    clearRecords,
  } = useSectorPickAccuracy();

  const currentUniverse = useMemo(() => uniqueUniverse(stocks.map((s) => ({ ...s, market: "실시간 추가" }))), [stocks]);
  const kospiUniverse = useMemo(() => getValueUniverse("kospi200", stocks), [stocks]);
  const kosdaqUniverse = useMemo(() => getValueUniverse("kosdaq200", stocks), [stocks]);
  const bothUniverse = useMemo(() => getValueUniverse("both200", stocks), [stocks]);

  const universe = useMemo(() => {
    if (scope === "current") return currentUniverse;
    if (scope === "kospi200") return kospiUniverse;
    if (scope === "kosdaq200") return kosdaqUniverse;
    return bothUniverse;
  }, [scope, currentUniverse, kospiUniverse, kosdaqUniverse, bothUniverse]);

  const mergedQuotes = useMemo(() => ({ ...quotes, ...themeQuotes }), [quotes, themeQuotes]);
  const baseRows = useMemo(() => buildSectorMindRows(universe, mergedQuotes), [universe, mergedQuotes]);
  const rows = useMemo(() => {
    return [...baseRows]
      .filter((r) => filterPhase === "all" || r.phaseFilter === filterPhase)
      .sort((a, b) => {
        if (sortBy === "rsi") return b.avgRsi - a.avgRsi;
        if (sortBy === "change") return b.avgChange1d - a.avgChange1d;
        return b.fearGreed - a.fearGreed;
      });
  }, [baseRows, sortBy, filterPhase]);

  const selected = rows.find((r) => r.sector === selectedSector) || rows[0];
  const kospiTopPicks = useMemo(() => buildSectorTopPicks(baseRows, "KOSPI200", 20), [baseRows]);
  const kosdaqTopPicks = useMemo(() => buildSectorTopPicks(baseRows, "KOSDAQ200", 20), [baseRows]);
  const wostRows = [...rows]
    .filter((r) => String(r.market || "").includes("KOSPI200") || String(r.market || "").includes("KOSDAQ200"))
    .sort((a, b) => a.total - b.total || Number(a.q?.changeRate || 0) - Number(b.q?.changeRate || 0))
    .slice(0, 10);
  const progress = scanState.total ? Math.round((scanState.done / scanState.total) * 100) : 0;
  const overallFG = baseRows.length ? Math.round(baseRows.reduce((s, r) => s + r.fearGreed, 0) / baseRows.length) : 50;
  const overall = phaseFromFearGreed(overallFG);
  const greedCount = baseRows.filter((r) => r.fearGreed >= 60).length;
  const fearCount = baseRows.filter((r) => r.fearGreed < 40).length;
  const flowPositive = baseRows.filter((r) => r.foreignNet > 0 || r.instNet > 0).length;

  useEffect(() => {
    if (!selectedSector && rows[0]) setSelectedSector(rows[0].sector);
  }, [rows, selectedSector]);

  useEffect(() => {
    if (!kospiTopPicks.length && !kosdaqTopPicks.length) return;
    const allQuotes = { ...quotes, ...themeQuotes };
    evaluateRecords(allQuotes);
    saveTodayPicks(kospiTopPicks, "KOSPI200");
    saveTodayPicks(kosdaqTopPicks, "KOSDAQ200");
  }, [kospiTopPicks, kosdaqTopPicks, quotes, themeQuotes, evaluateRecords, saveTodayPicks]);

  const runScan = async (nextScope = scope) => {
    const scanUniverse =
      nextScope === "current" ? currentUniverse :
      nextScope === "kospi200" ? kospiUniverse :
      nextScope === "kosdaq200" ? kosdaqUniverse :
      bothUniverse;

    setScope(nextScope);
    setScanState({ loading: true, done: 0, total: scanUniverse.length, current: "시작", lastRun: "", error: "" });

    try {
      const qmap = await scanThemeUniverse({
        universe: scanUniverse,
        baseQuotes: quotes,
        onProgress: ({ done, total, current }) => {
          setScanState((p) => ({ ...p, done, total, current: `${current.name}(${current.code})` }));
        },
      });
      setThemeQuotes(qmap);
      setScanState({
        loading: false,
        done: scanUniverse.length,
        total: scanUniverse.length,
        current: "완료",
        lastRun: new Date().toLocaleString("ko-KR"),
        error: "",
      });
    } catch (err) {
      setScanState((p) => ({ ...p, loading: false, error: err.message || String(err) }));
    }
  };

  const renderDetail = () => {
    if (!selected) return <div className="sectormind-detail">섹터를 선택하면 상세 분석이 표시됩니다.</div>;
    return (
      <div className="sectormind-detail">
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div className="sectormind-icon" style={{ color: selected.color }}>{selected.icon}</div>
          <div>
            <h3>{selected.sector}</h3>
            <div className="sub">60일 섹터 지수 · 종목별 RSI · 수급 동향 · 심리 편향</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ color: selected.phaseColor, fontWeight: 900, fontSize: 24 }}>{selected.fearGreed}</div>
            <div className="sub">F&G</div>
          </div>
        </div>

        <div className="sectormind-detail-section">
          <div className="card-title">섹터 60일 지수</div>
          <SectorSparkline values={selected.indexPrices} color={selected.color} />
        </div>

        <div className="sectormind-detail-section">
          <div className="card-title">수급 동향</div>
          <div className="sectormind-stock-row"><b>외국인</b><span className={selected.foreignNet >= 0 ? "up" : "down"}>{selected.foreignNet >= 0 ? "+" : ""}{selected.foreignNet.toLocaleString()}</span><span className="sub">억원</span></div>
          <div className="sectormind-stock-row"><b>기관</b><span className={selected.instNet >= 0 ? "up" : "down"}>{selected.instNet >= 0 ? "+" : ""}{selected.instNet.toLocaleString()}</span><span className="sub">억원</span></div>
          <div className="sub">거래량 비율 {selected.volumeRatio}x {selected.volumeAnomaly ? "· 이상 거래량 감지" : ""}</div>
        </div>

        <div className="sectormind-detail-section">
          <div className="card-title">종목별 RSI</div>
          {selected.list.slice(0, 10).map((s) => (
            <div className="sectormind-stock-row" key={s.code}>
              <span>{s.name}<br /><small className="sub">{s.code}</small></span>
              <span className={s.rsi >= 70 ? "down" : s.rsi <= 30 ? "up" : ""}>{s.rsi}</span>
              <span className={s.rate >= 0 ? "up" : "down"}>{fmtRate(s.rate)}</span>
            </div>
          ))}
        </div>

        <div className="sectormind-detail-section">
          <div className="card-title">활성 심리 편향</div>
          {selected.biases.map((b) => (
            <div key={b} style={{ marginTop: 8, borderLeft: `3px solid ${selected.color}`, paddingLeft: 10 }}>
              <b style={{ color: selected.color }}>{b}</b>
              <div className="sub">
                {b === "FOMO" ? "급등 섹터 추격 매수 위험이 커지는 구간입니다." :
                 b === "손실회피" ? "추가 하락 우려로 손절·관망이 강화되는 구간입니다." :
                 b === "확증편향" ? "상승 근거만 선택적으로 해석할 가능성이 있습니다." :
                 b === "패닉셀링" ? "감정적 매도 압력이 강해지는 구간입니다." :
                 "방향성 확인 전까지 의사결정이 지연될 수 있습니다."}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-title">
        <span>🧠 SECTORMIND — 섹터 심리 비교 대시보드</span>
        <span className="tag yellow">8+ 섹터 · 카드/매트릭스/레이더</span>
      </div>
      <div className="panel-body sectormind-shell">
        <div className="sectormind-toolbar">
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} disabled={scanState.loading}>
            <option value="both200">코스피200 + 코스닥200</option>
            <option value="kospi200">코스피200</option>
            <option value="kosdaq200">코스닥200</option>
            <option value="current">실시간 추가 종목</option>
          </select>
          <button className="btn" onClick={() => runScan(scope)} disabled={scanState.loading}>{scanState.loading ? "조회 중..." : "갱신"}</button>
          {[["cards", "카드뷰"], ["matrix", "매트릭스뷰"], ["radar", "레이더뷰"], ["picks", "추천종목"]].map(([k, label]) => (
            <button key={k} className={`btn ${viewMode === k ? "active" : ""}`} onClick={() => setViewMode(k)}>{label}</button>
          ))}
          {[["fearGreed", "탐욕순"], ["rsi", "RSI순"], ["change", "등락순"]].map(([k, label]) => (
            <button key={k} className={`btn ${sortBy === k ? "active" : ""}`} onClick={() => setSortBy(k)}>{label}</button>
          ))}
          <select className="select" value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)}>
            <option value="all">전체</option>
            <option value="greed">탐욕</option>
            <option value="neutral">중립</option>
            <option value="fear">공포</option>
          </select>
        </div>

        <div className="sectormind-summary">
          <div className="sectormind-kpi"><small>시장 전체 심리</small><b style={{ color: overall.color }}>{overallFG}</b><span>{overall.phase}</span></div>
          <div className="sectormind-kpi"><small>탐욕 우세 섹터</small><b className="down">{greedCount}</b><span>과열/FOMO 감시</span></div>
          <div className="sectormind-kpi"><small>공포 우세 섹터</small><b className="up">{fearCount}</b><span>역발상 후보</span></div>
          <div className="sectormind-kpi"><small>순매수 우위</small><b>{flowPositive}</b><span>외국인·기관 중 1개 이상</span></div>
        </div>

        <div className="sectormind-accuracy-grid">
          <div className="sectormind-accuracy-card"><small>전체 추천 적중률</small><b>{pickAccuracy !== null ? `${pickAccuracy}%` : "-"}</b><div className="sub">판정 {pickDone.length}건 / 대기 {pickPending.length}건</div></div>
          <div className="sectormind-accuracy-card"><small>코스피200 적중률</small><b>{kospiAccuracy !== null ? `${kospiAccuracy}%` : "-"}</b><div className="sub">상위 20개 추천 누적</div></div>
          <div className="sectormind-accuracy-card"><small>코스닥200 적중률</small><b>{kosdaqAccuracy !== null ? `${kosdaqAccuracy}%` : "-"}</b><div className="sub">상위 20개 추천 누적</div></div>
          <div className="sectormind-accuracy-card"><small>자동 저장</small><b>{pickAutoSave ? "ON" : "OFF"}</b><div className="pick-toggle-row"><button className="btn" onClick={() => setPickAutoSave(!pickAutoSave)}>전환</button><button className="btn red" onClick={() => { if (confirm("추천 적중률 기록을 초기화할까요?")) clearRecords(); }}>초기화</button></div></div>
        </div>

        <div className="value-scan-status">
          {scanState.loading
            ? `SECTORMIND 갱신 중: ${scanState.done}/${scanState.total} · 현재 ${scanState.current}`
            : `조회 범위 ${universe.length}개 종목 · 마지막 갱신 ${scanState.lastRun || "미실행"}`}
          {scanState.error && <div className="error">조회 오류: {scanState.error}</div>}
          <div className="theme-progress"><div className="theme-progress-inner" style={{ width: `${progress}%` }} /></div>
        </div>

        {viewMode === "cards" && (
          <div className="sectormind-card-layout">
            <div className="sectormind-card-grid">
              {rows.map((r, i) => (
                <div
                  key={r.sector}
                  className={`sectormind-card ${selected?.sector === r.sector ? "active" : ""}`}
                  onClick={() => setSelectedSector(r.sector)}
                >
                  <div className="sectormind-rank">#{i + 1}</div>
                  <div className="sectormind-card-head">
                    <div style={{ display: "flex", gap: 10 }}>
                      <div className="sectormind-icon" style={{ color: r.color }}>{r.icon}</div>
                      <div>
                        <b>{r.sector}</b>
                        <div className="sectormind-phase" style={{ color: r.phaseColor }}>{r.phase}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <b className={r.avgChange1d >= 0 ? "up" : "down"}>{fmtRate(r.avgChange1d)}</b>
                      <div className="sub">1일</div>
                    </div>
                  </div>
                  <SectorSparkline values={r.indexPrices} color={r.color} />
                  <div className="sectormind-metrics">
                    <div className="sectormind-metric"><small>RSI</small><b>{r.avgRsi}</b></div>
                    <div className="sectormind-metric"><small>F&G</small><b style={{ color: r.phaseColor }}>{r.fearGreed}</b></div>
                    <div className="sectormind-metric"><small>5일%</small><b className={r.avgChange5d >= 0 ? "up" : "down"}>{fmtRate(r.avgChange5d)}</b></div>
                  </div>
                </div>
              ))}
            </div>
            {renderDetail()}
          </div>
        )}

        {viewMode === "picks" && (
          <div>
            <div className="pick-toggle-row">
              <button className={`btn ${pickView === "both" ? "active" : ""}`} onClick={() => setPickView("both")}>상위 20개씩</button>
              <button className={`btn ${pickView === "kospi" ? "active" : ""}`} onClick={() => setPickView("kospi")}>코스피200</button>
              <button className={`btn ${pickView === "kosdaq" ? "active" : ""}`} onClick={() => setPickView("kosdaq")}>코스닥200</button>
            </div>

            <div className="sectormind-picks-grid" style={{ marginTop: 12 }}>
              {(pickView === "both" || pickView === "kospi") && (
                <div className="sectormind-pick-section">
                  <div className="sectormind-pick-head"><b>코스피200 최적 추천 20</b><span className="tag green">{kospiTopPicks.length}개</span></div>
                  <div className="sectormind-pick-scroll">
                    <table className="sectormind-pick-table">
                      <thead><tr><th>순위</th><th>종목</th><th>섹터</th><th>점수</th><th>판정</th><th>근거</th></tr></thead>
                      <tbody>
                        {kospiTopPicks.map((p, i) => (
                          <tr key={p.code}>
                            <td className="rank">{i + 1}</td>
                            <td><b>{p.name}</b><br /><span className="sub">{p.code} · {fmtPrice(p.price)}</span></td>
                            <td>{p.sector}<br /><span className="sub">{p.sectorPhase} · F&G {p.sectorFearGreed}</span></td>
                            <td><span className="pick-score">{p.score}</span></td>
                            <td className={p.prediction === "상승" ? "up" : ""}>{p.prediction}</td>
                            <td className="pick-tags">{p.tags}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(pickView === "both" || pickView === "kosdaq") && (
                <div className="sectormind-pick-section">
                  <div className="sectormind-pick-head"><b>코스닥200 최적 추천 20</b><span className="tag green">{kosdaqTopPicks.length}개</span></div>
                  <div className="sectormind-pick-scroll">
                    <table className="sectormind-pick-table">
                      <thead><tr><th>순위</th><th>종목</th><th>섹터</th><th>점수</th><th>판정</th><th>근거</th></tr></thead>
                      <tbody>
                        {kosdaqTopPicks.map((p, i) => (
                          <tr key={p.code}>
                            <td className="rank">{i + 1}</td>
                            <td><b>{p.name}</b><br /><span className="sub">{p.code} · {fmtPrice(p.price)}</span></td>
                            <td>{p.sector}<br /><span className="sub">{p.sectorPhase} · F&G {p.sectorFearGreed}</span></td>
                            <td><span className="pick-score">{p.score}</span></td>
                            <td className={p.prediction === "상승" ? "up" : ""}>{p.prediction}</td>
                            <td className="pick-tags">{p.tags}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="footer-note">
              추천 점수는 섹터 심리, 종목 RSI, 1일/5일 모멘텀, 외국인·기관 수급 추정, 거래량 이상 여부를 합산합니다.
              자동 저장 ON 상태에서는 매일 추천 20개를 기록하고, 5일 이후 현재가 재조회 시 상승/횡보/하락 적중률을 누적합니다.
            </div>

            <ReadMeSection title="READ ME · 추천종목 적중률">
              <h4>추천 기준</h4>
              <ul>
                <li>코스피200과 코스닥200을 분리해 각각 상위 20개를 산출합니다.</li>
                <li>점수 74점 이상은 상승 후보, 60점 이상은 관찰 후보로 표시합니다.</li>
              </ul>
              <h4>적중률 판정</h4>
              <ul>
                <li>추천 기준가 대비 5일 후 수익률 +2% 이상이면 상승, -2% 이하이면 하락, 그 외는 횡보로 판정합니다.</li>
                <li>현재 버전은 웹앱을 열거나 섹터/테마를 갱신할 때 누적 기록을 평가합니다. 완전 자동 주기 분석은 서버 Cron 또는 Render Cron 연결 시 가능합니다.</li>
              </ul>
            </ReadMeSection>
          </div>
        )}

        {viewMode === "matrix" && (
          <>
            <div className="sectormind-heatmap">
              {rows.map((r, i) => (
                <div className="sectormind-heat-row" key={r.sector}>
                  <span className="sub">#{i + 1}</span>
                  <b style={{ color: r.color }}>{r.sector}</b>
                  <div className="sectormind-heat-track">
                    <div className="sectormind-heat-fill" style={{ width: `${r.fearGreed}%`, background: r.phaseColor }} />
                    <span className="sectormind-heat-text">{r.phase} · {r.fearGreed}</span>
                  </div>
                  <span className={r.avgChange1d >= 0 ? "up" : "down"}>{fmtRate(r.avgChange1d)}</span>
                </div>
              ))}
            </div>
            <div className="sectormind-matrix-wrap">
              <table className="data-table">
                <thead><tr><th>섹터</th><th>종목수</th><th>RSI</th><th>F&G</th><th>1일%</th><th>5일%</th><th>외국인</th><th>기관</th><th>모멘텀</th><th>편향</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sector}>
                      <td style={{ color: r.color, fontWeight: 900 }}>{r.sector}</td>
                      <td>{r.count}</td>
                      <td>{r.avgRsi}</td>
                      <td style={{ color: r.phaseColor, fontWeight: 900 }}>{r.fearGreed}</td>
                      <td className={r.avgChange1d >= 0 ? "up" : "down"}>{fmtRate(r.avgChange1d)}</td>
                      <td className={r.avgChange5d >= 0 ? "up" : "down"}>{fmtRate(r.avgChange5d)}</td>
                      <td className={r.foreignNet >= 0 ? "up" : "down"}>{r.foreignNet >= 0 ? "+" : ""}{r.foreignNet.toLocaleString()}</td>
                      <td className={r.instNet >= 0 ? "up" : "down"}>{r.instNet >= 0 ? "+" : ""}{r.instNet.toLocaleString()}</td>
                      <td style={{ color: r.momentumColor }}>{r.momentum}</td>
                      <td>{r.biases.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {viewMode === "radar" && (
          <div className="sectormind-radar-layout">
            <div className="sectormind-visual-card">
              <div className="card-title">8각형 레이더차트 · 섹터별 탐욕 지수</div>
              <SectorRadar rows={rows} />
            </div>
            <div className="sectormind-visual-card">
              <div className="card-title">RSI × 탐욕지수 버블차트</div>
              <SectorBubbleChart rows={rows} />
              <div className="footer-note">버블 크기 = 5일 가격 변동폭 · X축 = 탐욕 지수 · Y축 = RSI</div>
            </div>
          </div>
        )}

        <ReadMeSection title="READ ME · SECTORMIND">
          <h4>심리 점수 산식</h4>
          <ul>
            <li>섹터 평균 RSI, 5일 수익률, 상승 종목 비중을 합산해 공포·탐욕 점수를 계산합니다.</li>
            <li>외국인·기관 수급은 실시간 수급 API가 연결되기 전까지 등락률 기반 추정값으로 표시합니다.</li>
          </ul>
          <h4>확장 방향</h4>
          <ul>
            <li>실시간 수급 API를 연결하면 외국인·기관 순매수 방향을 실제 데이터로 교체할 수 있습니다.</li>
            <li>극단 공포/탐욕 진입 시 알림 센터 또는 텔레그램 알림과 연결할 수 있습니다.</li>
          </ul>
        </ReadMeSection>
      </div>
    </div>
  );
}


function FullScan({ stocks, quotes }) {
  const [scope, setScope] = useState("both200");
  const [rows, setRows] = useState([]);
  const [scanState, setScanState] = useState({ loading: false, done: 0, total: 0, current: "", lastRun: "", error: "" });

  const currentUniverse = useMemo(() => uniqueUniverse(stocks.map((s) => ({ ...s, market: "실시간 추가" }))), [stocks]);
  const kospiUniverse = useMemo(() => getValueUniverse("kospi200", stocks), [stocks]);
  const kosdaqUniverse = useMemo(() => getValueUniverse("kosdaq200", stocks), [stocks]);
  const bothUniverse = useMemo(() => getValueUniverse("both200", stocks), [stocks]);

  const universe = scope === "current"
    ? currentUniverse
    : scope === "kospi200"
      ? kospiUniverse
      : scope === "kosdaq200"
        ? kosdaqUniverse
        : bothUniverse;

  const runScan = async (nextScope = scope) => {
    const scanUniverse =
      nextScope === "current" ? currentUniverse :
      nextScope === "kospi200" ? kospiUniverse :
      nextScope === "kosdaq200" ? kosdaqUniverse :
      bothUniverse;

    setScope(nextScope);
    setRows([]);
    setScanState({ loading: true, done: 0, total: scanUniverse.length, current: "시작", lastRun: "", error: "" });

    try {
      const result = await runValueScanUniverse({
        universe: scanUniverse,
        baseQuotes: quotes,
        onProgress: ({ done, total, current }) => {
          setScanState((p) => ({ ...p, done, total, current: `${current.name}(${current.code})` }));
        },
      });
      setRows(result);
      setScanState({
        loading: false,
        done: scanUniverse.length,
        total: scanUniverse.length,
        current: "완료",
        lastRun: new Date().toLocaleString("ko-KR"),
        error: "",
      });
    } catch (err) {
      setScanState((p) => ({ ...p, loading: false, error: err.message || String(err) }));
    }
  };

  useEffect(() => {
    if (!rows.length) {
      const initial = universe.map((s) => {
        const q = quotes[s.code] || {};
        return { ...s, q, ...calcValueScore(s, q) };
      }).sort((a, b) => b.score - a.score);
      setRows(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = scanState.total ? Math.round((scanState.done / scanState.total) * 100) : 0;
  const kospiRows = rows.filter((r) => String(r.market || "").includes("KOSPI200"));
  const kosdaqRows = rows.filter((r) => String(r.market || "").includes("KOSDAQ200"));
  const targetRows = scope === "kospi200" ? kospiRows : scope === "kosdaq200" ? kosdaqRows : rows;

  const sortByScore = (list) => [...list].sort((a, b) => b.score - a.score || Number(b.q?.changeRate || 0) - Number(a.q?.changeRate || 0));
  const trend = sortByScore(targetRows.filter((r) => Number(r.q?.changeRate || 0) >= 1)).slice(0, 20);
  const pullback = sortByScore(targetRows.filter((r) => Number(r.q?.changeRate || 0) > -2 && Number(r.q?.changeRate || 0) < 1)).slice(0, 20);
  const value = sortByScore(targetRows.filter((r) => r.score >= 62)).slice(0, 20);
  const kospiTop = sortByScore(kospiRows).slice(0, 20);
  const kosdaqTop = sortByScore(kosdaqRows).slice(0, 20);

  const renderTable = (list, emptyText = "조회 후 표시됩니다.") => (
    <div className="fullscan-scroll">
      <table className="fullscan-table">
        <thead>
          <tr><th>순위</th><th>종목</th><th>시장</th><th>등락률</th><th>점수</th><th>판정</th></tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={`${r.market}-${r.code}`}>
              <td className="rank">{i + 1}</td>
              <td><b>{r.name}</b><br /><span className="sub">{r.code} · {r.sector || r.tag || "-"}</span></td>
              <td>{r.market || "-"}</td>
              <td className={Number(r.q?.changeRate || 0) >= 0 ? "up" : "down"}>{fmtRate(r.q?.changeRate)}</td>
              <td><span className="fullscan-score">{r.score}</span></td>
              <td>{r.label}<br /><span className="sub">{r.tags}</span></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan="6" className="sub">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-title">
        <span>전종목 스캔 — KOSPI200 / KOSDAQ200</span>
        <span className="tag yellow">등록종목 기준 → 지수 후보군 기준으로 확장</span>
      </div>
      <div className="panel-body">
        <div className="fullscan-toolbar">
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} disabled={scanState.loading}>
            <option value="both200">코스피200 + 코스닥200</option>
            <option value="kospi200">코스피200</option>
            <option value="kosdaq200">코스닥200</option>
            <option value="current">실시간 추가 종목</option>
          </select>
          <button className="btn" onClick={() => runScan(scope)} disabled={scanState.loading}>{scanState.loading ? "스캔 중..." : "선택 범위 스캔"}</button>
          <button className="btn" onClick={() => runScan("kospi200")} disabled={scanState.loading}>코스피200 스캔</button>
          <button className="btn" onClick={() => runScan("kosdaq200")} disabled={scanState.loading}>코스닥200 스캔</button>
          <button className="btn" onClick={() => runScan("both200")} disabled={scanState.loading}>전체 스캔</button>
        </div>

        <div className="fullscan-summary">
          <div className="fullscan-kpi"><small>분석 후보군</small><b>{universe.length}</b></div>
          <div className="fullscan-kpi"><small>코스피200 결과</small><b>{kospiRows.length}</b></div>
          <div className="fullscan-kpi"><small>코스닥200 결과</small><b>{kosdaqRows.length}</b></div>
          <div className="fullscan-kpi"><small>마지막 스캔</small><b style={{ fontSize: 13 }}>{scanState.lastRun || "-"}</b></div>
        </div>

        <div className="value-scan-status">
          {scanState.loading
            ? `전종목 스캔 진행 중: ${scanState.done}/${scanState.total} · 현재 ${scanState.current}`
            : "코스피200/코스닥200 후보군 기준으로 고고저 돌파, 눌림목, 저평가 후보를 스캔합니다."}
          {scanState.error && <div className="error">스캔 오류: {scanState.error}</div>}
          <div className="value-scan-progress"><div className="value-scan-progress-inner" style={{ width: `${progress}%` }} /></div>
        </div>

        {scope === "both200" && (
          <div className="fullscan-grid" style={{ marginTop: 12 }}>
            <div className="fullscan-section">
              <div className="fullscan-section-head"><b>코스피200 종합 상위 20</b><span className="tag green">{kospiTop.length}개</span></div>
              {renderTable(kospiTop, "코스피200 스캔을 실행하세요.")}
            </div>
            <div className="fullscan-section">
              <div className="fullscan-section-head"><b>코스닥200 종합 상위 20</b><span className="tag green">{kosdaqTop.length}개</span></div>
              {renderTable(kosdaqTop, "코스닥200 스캔을 실행하세요.")}
            </div>
          </div>
        )}

        <div className="fullscan-grid" style={{ marginTop: 12 }}>
          <div className="fullscan-section">
            <div className="fullscan-section-head"><b>고고저/추세 돌파 후보 TOP 20</b><span className="tag green">{trend.length}개</span></div>
            {renderTable(trend, "등락률 +1% 이상 후보가 없습니다.")}
          </div>
          <div className="fullscan-section">
            <div className="fullscan-section-head"><b>눌림목 매수 후보 TOP 20</b><span className="tag green">{pullback.length}개</span></div>
            {renderTable(pullback, "눌림목 조건 후보가 없습니다.")}
          </div>
          <div className="fullscan-section">
            <div className="fullscan-section-head"><b>저평가/가치 후보 TOP 20</b><span className="tag green">{value.length}개</span></div>
            {renderTable(value, "저평가 점수 62점 이상 후보가 없습니다.")}
          </div>
          <div className="scan-card">
            <h4>스캔 기준 안내</h4>
            <ul>
              <li>기존 실시간 추가 종목 기준에서 코스피200/코스닥200 후보군 기준으로 확장했습니다.</li>
              <li>스캔 버튼 실행 시 각 후보군의 현재가를 순차 조회하고 점수를 다시 계산합니다.</li>
              <li>공식 지수 전체 구성 200개와 100% 일치시키려면 서버 KRX 마스터 DB 자동 업데이트를 연결하면 됩니다.</li>
            </ul>
          </div>
        </div>

        <ReadMeSection title="READ ME · 전종목 스캔">
          <h4>분석 범위</h4>
          <ul>
            <li>코스피200, 코스닥200, 통합, 실시간 추가 종목 중 선택해 스캔할 수 있습니다.</li>
            <li>통합 선택 시 코스피200 종합 상위 20개와 코스닥200 종합 상위 20개를 별도 표시합니다.</li>
          </ul>
          <h4>주의사항</h4>
          <ul>
            <li>현재 후보군은 앱 내장 KOSPI200/KOSDAQ200 후보군 기준입니다.</li>
            <li>실제 공식 구성종목 자동 반영은 서버 DB 또는 KRX 마스터 파일 연동으로 확장 가능합니다.</li>
          </ul>
        </ReadMeSection>
      </div>
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



const AXIOS_NEWS_KEYWORDS = [
  { key: "AI", sectors: ["AI", "반도체", "클라우드", "소프트웨어", "데이터센터", "전력"], symbols: ["NVDA", "MSFT", "GOOGL", "AVGO", "AMD", "AMZN", "META", "SMCI", "PLTR"], domestic: ["005930", "000660", "042700", "012450"] },
  { key: "semiconductor", sectors: ["반도체", "반도체장비", "메모리"], symbols: ["NVDA", "AMD", "AVGO", "MU", "ASML", "AMAT", "LRCX", "KLAC", "QCOM"], domestic: ["005930", "000660", "042700"] },
  { key: "chips", sectors: ["반도체", "반도체장비", "메모리"], symbols: ["NVDA", "AMD", "AVGO", "MU", "ASML", "AMAT", "LRCX", "KLAC", "QCOM"], domestic: ["005930", "000660", "042700"] },
  { key: "data center", sectors: ["데이터센터", "전력", "AI 서버", "클라우드"], symbols: ["NVDA", "MSFT", "AMZN", "GOOGL", "AVGO", "SMCI", "VRT"], domestic: ["000660", "005930"] },
  { key: "Fed", sectors: ["금융", "성장주", "기술주"], symbols: ["AAPL", "MSFT", "NVDA", "QQQ", "TSLA"], domestic: ["105560", "055550", "035420", "035720"] },
  { key: "interest rate", sectors: ["금융", "성장주", "기술주"], symbols: ["AAPL", "MSFT", "NVDA", "TSLA"], domestic: ["105560", "055550", "035420", "035720"] },
  { key: "inflation", sectors: ["소비재", "금융", "에너지"], symbols: ["COST", "PEP", "XOM", "CVX"], domestic: ["105560", "055550"] },
  { key: "tariff", sectors: ["자동차", "반도체", "소재", "중국"], symbols: ["TSLA", "AAPL", "NVDA", "AMD"], domestic: ["005380", "000270", "005930", "000660"] },
  { key: "China", sectors: ["중국", "반도체", "자동차", "소비재"], symbols: ["AAPL", "TSLA", "NVDA", "AMD"], domestic: ["005930", "000660", "005380", "000270"] },
  { key: "EV", sectors: ["전기차", "2차전지", "자동차"], symbols: ["TSLA", "RIVN", "LCID"], domestic: ["005380", "000270", "006400", "373220", "051910"] },
  { key: "Tesla", sectors: ["전기차", "자동차", "2차전지"], symbols: ["TSLA"], domestic: ["005380", "000270", "006400", "373220"] },
  { key: "Apple", sectors: ["빅테크", "디바이스", "부품"], symbols: ["AAPL", "QCOM", "AVGO"], domestic: ["005930", "066570"] },
  { key: "Microsoft", sectors: ["AI", "클라우드", "소프트웨어"], symbols: ["MSFT", "NVDA", "AMD"], domestic: ["005930", "000660"] },
  { key: "OpenAI", sectors: ["AI", "클라우드", "반도체"], symbols: ["MSFT", "NVDA", "AMD", "AVGO"], domestic: ["005930", "000660", "042700"] },
  { key: "Nvidia", sectors: ["AI 반도체", "반도체", "데이터센터"], symbols: ["NVDA", "AMD", "AVGO", "SMCI"], domestic: ["000660", "005930", "042700"] },
  { key: "crypto", sectors: ["crypto", "핀테크", "성장주"], symbols: ["BTC", "ETH", "COIN", "MSTR", "PYPL"], domestic: [] },
  { key: "defense", sectors: ["방산", "우주항공"], symbols: ["LMT", "RTX", "NOC"], domestic: ["012450"] },
  { key: "war", sectors: ["방산", "에너지", "원자재"], symbols: ["LMT", "RTX", "XOM", "CVX"], domestic: ["012450"] },
  { key: "energy", sectors: ["에너지", "전력", "유틸리티"], symbols: ["XOM", "CVX", "AEP", "EXC", "XEL"], domestic: ["015760"] },
  { key: "biotech", sectors: ["바이오", "제약"], symbols: ["MRNA", "AMGN", "GILD", "REGN", "BIIB"], domestic: ["068270", "207940", "170900"] },
  { key: "health", sectors: ["헬스케어", "바이오", "의료기기"], symbols: ["ISRG", "DXCM", "GEHC", "IDXX"], domestic: ["068270", "207940", "170900"] },
];

const AXIOS_SENTIMENT_WORDS = {
  positive: ["surge", "rally", "boost", "growth", "deal", "wins", "expands", "record", "strong", "optimism", "approve", "approval", "investment", "breakthrough", "partnership"],
  negative: ["risk", "fall", "drops", "warning", "probe", "lawsuit", "ban", "tariff", "crackdown", "slump", "weak", "delay", "loss", "cuts", "concern", "selloff"],
};

function mockAxiosArticles() {
  const now = Date.now();
  return [
    {
      id: "mock-ai-chip",
      title: "AI infrastructure demand keeps chip and data center stocks in focus",
      summary: "AI infrastructure spending remains a key market theme. Semiconductor, cloud and power names may see continued news-driven momentum.",
      url: "https://www.axios.com/",
      publishedAt: new Date(now - 1000 * 60 * 40).toISOString(),
      source: "Axios sample",
    },
    {
      id: "mock-fed-rate",
      title: "Fed rate expectations shape the next move for growth stocks",
      summary: "Rate expectations remain a major driver for technology and high-duration growth stocks.",
      url: "https://www.axios.com/",
      publishedAt: new Date(now - 1000 * 60 * 90).toISOString(),
      source: "Axios sample",
    },
    {
      id: "mock-tariff-china",
      title: "Tariff and China policy risk returns to the market conversation",
      summary: "Policy headlines may affect autos, semiconductors and global supply chain stocks.",
      url: "https://www.axios.com/",
      publishedAt: new Date(now - 1000 * 60 * 140).toISOString(),
      source: "Axios sample",
    },
    {
      id: "mock-ev",
      title: "EV demand debate pressures battery and auto sentiment",
      summary: "Electric vehicle demand and battery supply chain expectations remain mixed.",
      url: "https://www.axios.com/",
      publishedAt: new Date(now - 1000 * 60 * 220).toISOString(),
      source: "Axios sample",
    },
    {
      id: "mock-defense",
      title: "Geopolitical risk keeps defense and energy sectors on watch",
      summary: "Defense, aerospace and energy names may react to geopolitical headlines.",
      url: "https://www.axios.com/",
      publishedAt: new Date(now - 1000 * 60 * 310).toISOString(),
      source: "Axios sample",
    },
  ];
}


function hasKoreanText(text = "") {
  return /[가-힣]/.test(String(text || ""));
}

function translateAxiosTextToKorean(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (hasKoreanText(raw)) return raw;

  const lower = raw.toLowerCase();

  if (lower.includes("ai") || lower.includes("nvidia") || lower.includes("chip") || lower.includes("semiconductor") || lower.includes("data center")) {
    return "AI·반도체·데이터센터 관련 뉴스가 시장 모멘텀에 영향을 줄 가능성";
  }
  if (lower.includes("fed") || lower.includes("rate") || lower.includes("inflation")) {
    return "연준·금리·인플레이션 이슈가 성장주 흐름을 좌우";
  }
  if (lower.includes("tariff") || lower.includes("china")) {
    return "중국·관세 정책 리스크가 관련 섹터에 재부각";
  }
  if (lower.includes("tesla") || lower.includes("ev") || lower.includes("battery")) {
    return "전기차·배터리 수요 이슈가 관련 종목 심리에 영향";
  }
  if (lower.includes("defense") || lower.includes("war") || lower.includes("geopolitical")) {
    return "지정학 리스크로 방산·에너지 섹터 관심 확대";
  }
  if (lower.includes("crypto") || lower.includes("bitcoin")) {
    return "가상자산 이슈가 위험자산 심리에 영향";
  }
  if (lower.includes("biotech") || lower.includes("health")) {
    return "바이오·헬스케어 뉴스가 관련 종목에 영향";
  }

  let out = raw;
  [
    [/AI infrastructure/gi, "AI 인프라"],
    [/artificial intelligence/gi, "인공지능"],
    [/data center stocks?/gi, "데이터센터 관련주"],
    [/chip stocks?|semiconductor stocks?/gi, "반도체주"],
    [/growth stocks?|technology stocks?/gi, "성장주·기술주"],
    [/big tech/gi, "빅테크"],
    [/interest rate expectations|Fed rate expectations/gi, "금리 전망"],
    [/Federal Reserve|\bFed\b/gi, "연준"],
    [/inflation/gi, "인플레이션"],
    [/tariffs?/gi, "관세"],
    [/China policy|\bChina\b/gi, "중국 정책"],
    [/policy risk/gi, "정책 리스크"],
    [/supply chain/gi, "공급망"],
    [/EV demand|electric vehicle/gi, "전기차 수요"],
    [/battery/gi, "배터리"],
    [/defense/gi, "방산"],
    [/geopolitical risk/gi, "지정학 리스크"],
    [/energy/gi, "에너지"],
    [/crypto/gi, "가상자산"],
    [/biotech/gi, "바이오"],
    [/health care/gi, "헬스케어"],
    [/market/gi, "시장"],
    [/stocks?|shares?/gi, "주식"],
    [/investors?/gi, "투자자"],
    [/demand/gi, "수요"],
    [/spending/gi, "투자 지출"],
    [/in focus/gi, "주목"],
    [/risk/gi, "리스크"],
    [/strong/gi, "강세"],
    [/weak/gi, "약세"],
  ].forEach(([pattern, replacement]) => { out = out.replace(pattern, replacement); });

  return /[a-zA-Z]{4,}/.test(out) ? "주요 시장 뉴스가 관련 섹터와 종목에 영향을 줄 가능성" : out;
}

function buildKoreanAxiosSummary(article, analysis = {}) {
  const raw = String(article.summary || article.description || article.title || "").trim();
  if (raw && hasKoreanText(raw)) return raw;

  const sectors = (analysis.sectors || []).slice(0, 4);
  const symbols = (analysis.symbols || []).slice(0, 5);
  const domestic = (analysis.domestic || []).slice(0, 4);
  const direction = analysis.direction || "중립";
  const impact = analysis.impactScore || 0;
  const horizon = analysis.horizon || "단기 관찰";
  const sectorText = sectors.length ? sectors.join(", ") : "주요 시장";
  const symbolText = [...symbols, ...domestic].slice(0, 6).join(", ") || "관련 종목";
  const tone = direction === "긍정"
    ? "긍정 모멘텀으로 작용할 가능성이 있습니다"
    : direction === "부정"
      ? "단기 리스크 요인으로 작용할 수 있습니다"
      : "방향성 확인이 필요한 중립 이슈입니다";

  return `${sectorText} 관련 이슈입니다. ${symbolText}에 영향을 줄 수 있으며, 뉴스 영향도는 ${impact}점입니다. ${horizon} 관점에서 ${tone}.`;
}


function normalizeAxiosArticle(a, i = 0) {
  const title = a.title || a.headline || "-";
  const summary = a.summary || a.description || a.excerpt || a.snippet || "";
  return {
    id: a.id || a.guid || a.link || a.url || `axios-${i}-${Date.now()}`,
    title,
    titleKo: translateAxiosTextToKorean(title),
    summary,
    summaryKo: translateAxiosTextToKorean(summary),
    url: a.url || a.link || "https://www.axios.com/",
    publishedAt: a.publishedAt || a.pubDate || a.date || a.isoDate || new Date().toISOString(),
    source: a.source || "Axios",
  };
}

function analyzeAxiosArticle(article) {
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  const matched = AXIOS_NEWS_KEYWORDS.filter((k) => text.includes(k.key.toLowerCase()));
  const sectors = Array.from(new Set(matched.flatMap((m) => m.sectors))).slice(0, 8);
  const symbols = Array.from(new Set(matched.flatMap((m) => m.symbols))).slice(0, 12);
  const domestic = Array.from(new Set(matched.flatMap((m) => m.domestic))).slice(0, 12);

  const pos = AXIOS_SENTIMENT_WORDS.positive.filter((w) => text.includes(w)).length;
  const neg = AXIOS_SENTIMENT_WORDS.negative.filter((w) => text.includes(w)).length;
  const ageHours = Math.max(0, (Date.now() - new Date(article.publishedAt || Date.now()).getTime()) / 3600000);
  const freshness = Math.max(0, Math.min(30, 30 - ageHours * 1.2));
  const breadth = Math.min(25, (sectors.length * 3) + (symbols.length + domestic.length) * 0.8);
  const keywordPower = Math.min(30, matched.length * 7);
  const sentimentRaw = pos - neg;
  const direction = sentimentRaw > 0 ? "긍정" : sentimentRaw < 0 ? "부정" : "중립";
  const sentimentScore = direction === "긍정" ? 15 : direction === "부정" ? 8 : 11;
  const impactScore = Math.round(Math.max(0, Math.min(100, 30 + freshness + breadth + keywordPower + sentimentScore)));

  return {
    ...article,
    sectors,
    symbols,
    domestic,
    matchedKeywords: matched.map((m) => m.key),
    direction,
    impactScore,
    horizon: ageHours <= 8 ? "단기 1~3일" : ageHours <= 36 ? "단기/중기" : "중기 관찰",
    reason: matched.length ? `${matched.map((m) => m.key).slice(0, 4).join(" · ")} 키워드 감지` : "주요 시장 키워드 약함",
  };
}

function buildAxiosNewsImpactMap(articles = []) {
  const map = {};
  articles.forEach((a) => {
    const signed = a.direction === "부정" ? -1 : a.direction === "중립" ? 0.5 : 1;
    const add = (key, weight = 1) => {
      if (!key) return;
      const prev = map[key] || { score: 0, count: 0, titles: [], direction: "중립" };
      const score = Math.round(a.impactScore * signed * weight);
      const nextScore = Math.max(-100, Math.min(100, prev.score + score));
      map[key] = {
        score: nextScore,
        count: prev.count + 1,
        direction: nextScore > 8 ? "긍정" : nextScore < -8 ? "부정" : "중립",
        titles: [...prev.titles, a.titleKo || a.title].slice(0, 3),
      };
    };
    (a.symbols || []).forEach((s) => add(s, 1));
    (a.domestic || []).forEach((c) => add(c, 1));
    (a.sectors || []).forEach((s) => add(`sector:${s}`, 0.55));
  });
  return map;
}

function getAxiosNewsImpactForRow(row, newsImpactMap = {}) {
  const keys = [
    row.code,
    row.symbol,
    row.name,
    row.sector ? `sector:${row.sector}` : "",
    row.tag ? `sector:${row.tag}` : "",
  ].filter(Boolean);
  const hits = keys.map((k) => newsImpactMap[k]).filter(Boolean);
  if (!hits.length) return { score: 0, direction: "중립", titles: [] };
  const score = Math.max(-100, Math.min(100, Math.round(hits.reduce((s, h) => s + Number(h.score || 0), 0) / hits.length)));
  return {
    score,
    direction: score > 8 ? "긍정" : score < -8 ? "부정" : "중립",
    titles: hits.flatMap((h) => h.titles || []).slice(0, 3),
  };
}

async function fetchAxiosMarketNews() {
  try {
    const data = await fetchJson("/api/news/axios");
    const raw = Array.isArray(data?.articles) ? data.articles : Array.isArray(data) ? data : [];
    if (!raw.length) throw new Error("empty news");
    return raw.map(normalizeAxiosArticle).map(analyzeAxiosArticle);
  } catch {
    return mockAxiosArticles().map(normalizeAxiosArticle).map(analyzeAxiosArticle);
  }
}

function AxiosMarketInsight({ stocks, globalQuotes = [] }) {
  const [articles, setArticles] = useState(() => loadLS("alpha_axios_articles", []));
  const [impactMap, setImpactMap] = useState(() => loadLS("alpha_axios_news_impacts", {}));
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState(() => loadLS("alpha_axios_news_last_run", ""));
  const [filter, setFilter] = useState("all");

  const refreshNews = async () => {
    setLoading(true);
    try {
      const rows = await fetchAxiosMarketNews();
      const map = buildAxiosNewsImpactMap(rows);
      setArticles(rows);
      setImpactMap(map);
      const ts = new Date().toLocaleString("ko-KR");
      setLastRun(ts);
      saveLS("alpha_axios_articles", rows);
      saveLS("alpha_axios_news_impacts", map);
      saveLS("alpha_axios_news_last_run", ts);
      window.dispatchEvent(new Event("alpha-axios-news-updated"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!articles.length) refreshNews();
  }, []);

  const filtered = articles.filter((a) => filter === "all" || a.direction === filter);
  const topImpacts = Object.entries(impactMap)
    .filter(([k]) => !String(k).startsWith("sector:"))
    .sort((a, b) => Math.abs(Number(b[1].score || 0)) - Math.abs(Number(a[1].score || 0)))
    .slice(0, 12)
    .map(([key, val]) => {
      const domestic = stocks.find((s) => s.code === key || s.name === key);
      const global = globalQuotes.find((g) => g.symbol === key || g.code === key);
      return { key, name: domestic?.name || global?.name || key, ...val };
    });
  const sectorImpacts = Object.entries(impactMap)
    .filter(([k]) => String(k).startsWith("sector:"))
    .sort((a, b) => Math.abs(Number(b[1].score || 0)) - Math.abs(Number(a[1].score || 0)))
    .slice(0, 10)
    .map(([key, val]) => ({ key: key.replace("sector:", ""), ...val }));

  return (
    <div className="panel axios-panel">
      <div className="panel-title">
        <span>AXIOS 마켓 인사이트</span>
        <span className="tag yellow">NEWS IMPACT</span>
      </div>
      <div className="panel-body axios-shell">
        <div className="axios-toolbar">
          <button className="btn" onClick={refreshNews} disabled={loading}>{loading ? "뉴스 조회 중..." : "Axios 최신 기사 조회"}</button>
          <button className={`btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>전체</button>
          <button className={`btn ${filter === "긍정" ? "active" : ""}`} onClick={() => setFilter("긍정")}>긍정</button>
          <button className={`btn ${filter === "부정" ? "active" : ""}`} onClick={() => setFilter("부정")}>부정</button>
          <span className="sub">마지막 반영: {lastRun || "대기"}</span>
        </div>

        <div className="axios-summary">
          <div className="integrated-kpi"><small>기사 수</small><b>{articles.length}</b><span>Axios/샘플</span></div>
          <div className="integrated-kpi"><small>긍정</small><b>{articles.filter((a) => a.direction === "긍정").length}</b><span>모멘텀</span></div>
          <div className="integrated-kpi"><small>부정</small><b>{articles.filter((a) => a.direction === "부정").length}</b><span>리스크</span></div>
          <div className="integrated-kpi"><small>종목 영향</small><b>{topImpacts.length}</b><span>매칭</span></div>
        </div>

        <div className="axios-grid">
          <div className="axios-section">
            <div className="axios-title">최신 기사 요약</div>
            <div className="axios-list">
              {filtered.map((a) => (
                <div className="axios-card" key={a.id}>
                  <div className="axios-card-head">
                    <b>{a.titleKo || a.title}</b>
                    <span className={a.direction === "긍정" ? "tag green" : a.direction === "부정" ? "tag red" : "tag"}>{a.direction} {a.impactScore}</span>
                  </div>
                  <div className="axios-meta">{new Date(a.publishedAt).toLocaleString("ko-KR")} · {a.horizon}</div>
                  <div className="axios-summary-text">{a.summaryKo || a.summary || "요약 정보 대기"}</div>
                  <div className="axios-tags">
                    {(a.sectors || []).slice(0, 5).map((s) => <span key={s}>{s}</span>)}
                    {(a.symbols || []).slice(0, 6).map((s) => <span key={s}>{s}</span>)}
                  </div>
                  <div className="axios-reason">{a.reason}</div>
                  <a className="axios-link" href={a.url} target="_blank" rel="noreferrer">원문 열기</a>
                </div>
              ))}
            </div>
          </div>

          <div className="axios-section">
            <div className="axios-title">관련 종목 영향도</div>
            <table className="integrated-table axios-impact-table">
              <thead><tr><th>종목</th><th>방향</th><th>뉴스점수</th><th>근거</th></tr></thead>
              <tbody>
                {topImpacts.map((r) => (
                  <tr key={r.key}>
                    <td><b>{r.name}</b><br /><span className="sub">{r.key}</span></td>
                    <td className={r.direction === "긍정" ? "up" : r.direction === "부정" ? "down" : ""}>{r.direction}</td>
                    <td><span className="integrated-score">{r.score}</span></td>
                    <td className="sub">{(r.titles || []).slice(0, 2).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="axios-title" style={{ marginTop: 14 }}>섹터 영향도</div>
            <div className="axios-sector-list">
              {sectorImpacts.map((s) => (
                <div className="axios-sector" key={s.key}>
                  <span>{s.key}</span>
                  <b className={s.direction === "긍정" ? "up" : s.direction === "부정" ? "down" : ""}>{s.score}</b>
                </div>
              ))}
            </div>

            <ReadMeSection title="READ ME · Axios 뉴스 반영">
              <h4>점수 반영 방식</h4>
              <ul>
                <li>Axios 영문 제목과 요약은 화면에서 한국어 요약으로 변환해 표시합니다.</li>
                <li>기사 키워드로 관련 섹터와 종목을 매칭합니다.</li>
                <li>뉴스 영향 점수는 지표 통합 최적분석의 통합점수에 보정값으로 반영됩니다.</li>
                <li>서버 API가 없으면 샘플 데이터로 화면과 점수 흐름이 유지됩니다.</li>
              </ul>
            </ReadMeSection>
          </div>
        </div>
      </div>
    </div>
  );
}



function analyzeHoldingStrategy(row, isGlobal = false) {
  const q = row.q || {};
  const total = Number(row.total || 0);
  const rate = Number(q.changeRate || q.changePercent || 0);
  const rsi = Number(row.rsi || 50);
  const valuePart = Number(row.valuePart || row.score || 0);
  const momentumScore = Number(row.momentumScore || 0);
  const sectorScore = Number(row.sectorScore || row.sectorFG || 50);
  const newsScore = Number(row.newsScore || 0);
  const technicalScore = Number(row.technicalScore || 0);

  let holdingType = "관찰";
  let holdingPeriod = "관찰";
  let holdingComment = "진입보다 조건 확인이 우선입니다.";
  let holdingRisk = "통합점수와 거래량 회복 여부 확인";

  if (total >= 78 && valuePart >= 68 && sectorScore >= 65 && rsi >= 42 && rsi <= 70 && newsScore >= 0) {
    holdingType = "장기 보유 후보";
    holdingPeriod = isGlobal ? "중장기 3~12개월" : "중장기 2~6개월";
    holdingComment = "가치·섹터·기술 조건이 균형적이므로 분할매수 후 추세 유지 시 보유 관점이 유리합니다.";
    holdingRisk = "RSI 75 이상 과열 또는 뉴스 리스크 전환 시 비중 축소";
  } else if (total >= 72 && momentumScore >= 68 && rate >= 1 && rsi <= 74) {
    holdingType = "단기 보유 후보";
    holdingPeriod = "단기 3~15거래일";
    holdingComment = "단기 모멘텀이 강한 구간입니다. 추격보다는 눌림 확인 후 짧게 대응하는 관점이 적합합니다.";
    holdingRisk = "전일 저가 또는 5일선 이탈 시 손절/관망";
  } else if (total >= 68 && valuePart >= 70 && rate < 1) {
    holdingType = "분할매수 관찰";
    holdingPeriod = "단기 관찰 후 1~3개월";
    holdingComment = "저평가 매력은 있으나 모멘텀 확인이 부족합니다. 거래량 동반 반등 확인 후 비중 확대가 적합합니다.";
    holdingRisk = "모멘텀 부재 지속 시 기회비용 발생";
  } else if (rsi >= 75 || rate >= 6) {
    holdingType = "단기 과열 주의";
    holdingPeriod = "1~5거래일 단기 대응";
    holdingComment = "과열 신호가 있어 장기 신규 진입보다는 단기 매매 또는 눌림 대기가 적합합니다.";
    holdingRisk = "급등 후 차익실현 가능성";
  } else if (newsScore < 0 || technicalScore < 45) {
    holdingType = "리스크 관리";
    holdingPeriod = "관망";
    holdingComment = "뉴스 또는 기술 조건이 약해 신규 진입보다 리스크 점검이 우선입니다.";
    holdingRisk = "뉴스 리스크와 지지선 이탈 확인";
  } else if (total >= 64) {
    holdingType = "중립 관찰";
    holdingPeriod = "1~4주 관찰";
    holdingComment = "일부 지표는 양호하지만 확정 신호가 부족합니다. 추가 모멘텀 확인이 필요합니다.";
    holdingRisk = "거래량 없는 상승은 신뢰도 낮음";
  }

  return { holdingType, holdingPeriod, holdingComment, holdingRisk };
}


function scoreIntegratedCandidate(row, sectorRows = [], newsImpactMap = {}) {
  const q = row.q || {};
  const rate = Number(q.changeRate || 0);
  const valueScore = Number(row.score || 0);

  const sectorRow = sectorRows.find((s) => s.sector === (row.sector || row.tag)) || sectorRows.find((s) => (s.list || []).some((x) => x.code === row.code));
  const sectorFG = Number(sectorRow?.fearGreed || 50);
  const sectorPhase = sectorRow?.phase || "중립";
  const sectorMomentum = sectorRow?.momentum || "-";

  const rsi = estimateStockRsi(rate, stableNumber(row.code || row.name || ""));
  const rsiScore = rsi >= 45 && rsi <= 68 ? 90 : rsi < 35 ? 72 : rsi > 75 ? 38 : 62;
  const momentumScore = Math.max(0, Math.min(100, 52 + rate * 12));
  const sectorScore = Math.max(0, Math.min(100, sectorFG >= 80 ? 70 : sectorFG >= 60 ? 88 : sectorFG >= 40 ? 68 : 58));
  const valuePart = Math.max(0, Math.min(100, valueScore));
  const technicalScore = Math.max(0, Math.min(100,
    50 +
    (rate >= 1 ? 18 : 0) +
    (rate > -2 && rate < 1 ? 12 : 0) +
    (Number(q.volume || 0) > 0 ? 8 : 0) +
    (Number(q.per || 0) > 0 && Number(q.per || 0) <= 15 ? 10 : 0) +
    (Number(q.pbr || 0) > 0 && Number(q.pbr || 0) <= 1.5 ? 10 : 0)
  ));

  const overheatPenalty = rate >= 8 || rsi >= 82 ? 10 : 0;
  const newsImpact = getAxiosNewsImpactForRow(row, newsImpactMap);
  const newsScore = Math.max(-8, Math.min(8, Math.round(Number(newsImpact.score || 0) / 12)));
  const learningAdj = getAiLearningAdjustment("integrated", row.code, row.sector || row.tag || "기타");
  const total = Math.round(
    valuePart * 0.30 +
    sectorScore * 0.22 +
    momentumScore * 0.18 +
    rsiScore * 0.15 +
    technicalScore * 0.15 -
    overheatPenalty +
    newsScore +
    learningAdj
  );

  const reasons = [];
  if (valueScore >= 70) reasons.push("저평가 점수 우수");
  if (sectorFG >= 60 && sectorFG < 80) reasons.push("섹터 심리 강세");
  if (sectorFG < 40) reasons.push("섹터 공포권 역발상");
  if (rsi >= 45 && rsi <= 68) reasons.push("RSI 안정권");
  if (rate >= 1) reasons.push("단기 모멘텀");
  if (Number(q.per || 0) > 0 && Number(q.per || 0) <= 15) reasons.push("PER 매력");
  if (Number(q.pbr || 0) > 0 && Number(q.pbr || 0) <= 1.5) reasons.push("PBR 매력");
  if (learningAdj !== 0) reasons.push(`AI학습 ${learningAdj > 0 ? "+" : ""}${learningAdj}`);

  const baseResult = {
    ...row,
    total,
    valuePart: Math.round(valuePart),
    sectorScore: Math.round(sectorScore),
    momentumScore: Math.round(momentumScore),
    rsiScore: Math.round(rsiScore),
    technicalScore: Math.round(technicalScore),
    newsScore,
    learningAdj,
    newsImpact,
    rsi,
    sectorFG,
    sectorPhase,
    sectorMomentum,
    decision: total >= 78 ? "최우선" : total >= 68 ? "관심" : "관찰",
    reasons: reasons.slice(0, 5).join(" · ") || "중립 점검",
  };
  return {
    ...baseResult,
    ...analyzeHoldingStrategy(baseResult, false),
  };
}
function scoreGlobalIntegratedCandidate(row, newsImpactMap = {}) {
  const q = row.q || {};
  const rate = Number(q.changeRate || q.changePercent || 0);
  const price = Number(q.price || 0);
  const sectorSeed = stableNumber(row.sector || row.symbol);
  const sectorScore = 58 + (sectorSeed % 26);
  const momentumScore = Math.max(0, Math.min(100, 52 + rate * 10));
  const rsi = estimateStockRsi(rate, stableNumber(row.symbol || row.name || ""));
  const rsiScore = rsi >= 45 && rsi <= 68 ? 90 : rsi < 35 ? 70 : rsi > 75 ? 38 : 62;
  const megaCapBonus = ["NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL", "AVGO", "TSLA"].includes(row.symbol) ? 8 : 0;
  const aiThemeBonus = /AI|반도체|소프트웨어|클라우드|사이버보안|서버/i.test(row.sector || "") ? 10 : 0;
  const technicalScore = Math.max(0, Math.min(100, 50 + (rate >= 1 ? 18 : 0) + (rate > -2 && rate < 1 ? 8 : 0) + megaCapBonus + aiThemeBonus));
  const valuePart = Math.max(30, Math.min(92, 62 + megaCapBonus + (rate < 0 ? 5 : 0)));
  const overheatPenalty = rate >= 8 || rsi >= 82 ? 10 : 0;
  const newsImpact = getAxiosNewsImpactForRow(row, newsImpactMap);
  const newsScore = Math.max(-8, Math.min(8, Math.round(Number(newsImpact.score || 0) / 12)));
  const learningAdj = getAiLearningAdjustment("integrated", row.symbol, row.sector || "NASDAQ100");
  const total = Math.round(
    valuePart * 0.24 +
    sectorScore * 0.20 +
    momentumScore * 0.22 +
    rsiScore * 0.17 +
    technicalScore * 0.17 -
    overheatPenalty +
    newsScore +
    learningAdj
  );
  const reasons = [];
  if (megaCapBonus) reasons.push("나스닥 핵심 대형주");
  if (aiThemeBonus) reasons.push("AI/반도체/소프트웨어 테마");
  if (rsi >= 45 && rsi <= 68) reasons.push("RSI 안정권");
  if (rate >= 1) reasons.push("단기 모멘텀");
  if (rate < 0 && rsi < 50) reasons.push("눌림 관심권");
  if (newsScore > 0) reasons.push(`뉴스 촉매 +${newsScore}`);
  if (newsScore < 0) reasons.push(`뉴스 리스크 ${newsScore}`);
  const baseResult = {
    ...row,
    code: row.symbol,
    total,
    valuePart: Math.round(valuePart),
    sectorScore: Math.round(sectorScore),
    momentumScore: Math.round(momentumScore),
    rsiScore: Math.round(rsiScore),
    technicalScore: Math.round(technicalScore),
    newsScore,
    learningAdj,
    newsImpact,
    rsi,
    sectorFG: sectorScore,
    sectorPhase: sectorScore >= 75 ? "강세 테마" : sectorScore >= 60 ? "중립 강세" : "중립",
    sectorMomentum: rate >= 2 ? "강한상승" : rate >= 0 ? "상승/횡보" : "조정",
    decision: total >= 78 ? "최우선" : total >= 68 ? "관심" : "관찰",
    reasons: reasons.slice(0, 5).join(" · ") || "중립 점검",
    q: {
      ...q,
      price,
      changeRate: rate,
      changeStr: q.changeStr || fmtRate(rate),
    },
  };
  return {
    ...baseResult,
    ...analyzeHoldingStrategy(baseResult, true),
  };
}
async function scanNasdaq100Universe({ baseQuotes = [], onProgress, newsImpactMap = {} }) {
  const quoteMap = new Map((baseQuotes || []).map((q) => [q.symbol, q]));
  const rows = [];
  const concurrency = 8;
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < NASDAQ100_UNIVERSE.length) {
      const item = NASDAQ100_UNIVERSE[cursor++];
      let q = quoteMap.get(item.symbol);
      try {
        if (!q || !q.price) {
          q = await fetchJson(`/api/us/quote/${item.symbol}`);
        }
      } catch {
        const demo = DEMO_TICKERS.find((d) => d.s === item.symbol);
        q = {
          symbol: item.symbol,
          price: null,
          priceText: demo?.p || "-",
          changeRate: demo?.up ? 1 : -1,
          changeStr: demo?.ch || "-",
          realtime: false,
        };
      }
      rows.push(scoreGlobalIntegratedCandidate({
        ...item,
        symbol: item.symbol,
        name: item.name,
        sector: item.sector,
        market: "NASDAQ100",
        q,
      }, newsImpactMap));
      done += 1;
      if (onProgress) onProgress({ done, total: NASDAQ100_UNIVERSE.length, current: item });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, NASDAQ100_UNIVERSE.length) }, () => worker()));
  return rows.sort((a, b) => b.total - a.total);
}

function IntegratedOptimalAnalysis({ stocks, quotes, globalQuotes = [] }) {
  const [rows, setRows] = useState([]);
  const [nasdaqRows, setNasdaqRows] = useState([]);
  const [scanState, setScanState] = useState({ loading: false, done: 0, total: 0, current: "", lastRun: "", error: "" });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [learning, setLearning] = useState(() => summarizeAiLearning("integrated"));
  const [newsImpactMap, setNewsImpactMap] = useState(() => loadLS("alpha_axios_news_impacts", {}));

  useEffect(() => {
    const syncNews = () => setNewsImpactMap(loadLS("alpha_axios_news_impacts", {}));
    window.addEventListener("storage", syncNews);
    window.addEventListener("alpha-axios-news-updated", syncNews);
    return () => {
      window.removeEventListener("storage", syncNews);
      window.removeEventListener("alpha-axios-news-updated", syncNews);
    };
  }, []);

  const kospiUniverse = useMemo(() => getValueUniverse("kospi200", stocks), [stocks]);
  const kosdaqUniverse = useMemo(() => getValueUniverse("kosdaq200", stocks), [stocks]);
  const bothUniverse = useMemo(() => getValueUniverse("both200", stocks), [stocks]);

  const runIntegratedScan = useCallback(async () => {
    const totalCount = bothUniverse.length + NASDAQ100_UNIVERSE.length;
    setScanState({ loading: true, done: 0, total: totalCount, current: "시작", lastRun: "", error: "" });
    try {
      await pullAiLearningFromServer();
      let domesticDone = 0;
      const scanned = await runValueScanUniverse({
        universe: bothUniverse,
        baseQuotes: quotes,
        onProgress: ({ done, current }) => {
          domesticDone = done;
          setScanState((p) => ({ ...p, done, current: `${current.name}(${current.code})` }));
        },
      });

      const quoteMap = scanned.reduce((acc, r) => {
        acc[r.code] = r.q || {};
        return acc;
      }, { ...quotes });

      const sectorRows = buildSectorMindRows(bothUniverse, quoteMap);
      const scored = scanned
        .map((r) => scoreIntegratedCandidate(r, sectorRows, newsImpactMap))
        .sort((a, b) => b.total - a.total || b.score - a.score);

      const usRows = await scanNasdaq100Universe({
        baseQuotes: globalQuotes,
        newsImpactMap,
        onProgress: ({ done, current }) => {
          setScanState((p) => ({ ...p, done: domesticDone + done, current: `${current.name}(${current.symbol})` }));
        },
      });

      evaluateAiLearningPredictions("integrated", [...scored, ...usRows]);
      const kospiLearn = scored.filter((r) => String(r.market || "").includes("KOSPI200")).sort((a, b) => b.total - a.total).slice(0, 20);
      const kosdaqLearn = scored.filter((r) => String(r.market || "").includes("KOSDAQ200")).sort((a, b) => b.total - a.total).slice(0, 20);
      const nasdaqLearn = [...usRows].sort((a, b) => b.total - a.total).slice(0, 20);
      recordAiLearningPredictions("integrated", [...kospiLearn, ...kosdaqLearn, ...nasdaqLearn], 5);
      await pushAiLearningToServer();
      setLearning(summarizeAiLearning("integrated"));
      setRows(scored);
      setNasdaqRows(usRows);
      setScanState({
        loading: false,
        done: totalCount,
        total: totalCount,
        current: "완료",
        lastRun: new Date().toLocaleString("ko-KR"),
        error: "",
      });
    } catch (err) {
      setScanState((p) => ({ ...p, loading: false, error: err.message || String(err) }));
    }
  }, [bothUniverse, quotes, globalQuotes, newsImpactMap]);

  useEffect(() => {
    if (rows.length) return;
    const base = bothUniverse.map((s) => {
      const q = quotes[s.code] || {};
      return { ...s, q, ...calcValueScore(s, q) };
    });
    const sectorRows = buildSectorMindRows(bothUniverse, quotes);
    setRows(base.map((r) => scoreIntegratedCandidate(r, sectorRows, newsImpactMap)).sort((a, b) => b.total - a.total));

    const globalMap = new Map((globalQuotes || []).map((q) => [q.symbol, q]));
    setNasdaqRows(NASDAQ100_UNIVERSE.map((item) => scoreGlobalIntegratedCandidate({
      ...item,
      code: item.symbol,
      market: "NASDAQ100",
      q: globalMap.get(item.symbol) || {},
    }, newsImpactMap)).sort((a, b) => b.total - a.total));
  }, [bothUniverse, quotes, globalQuotes, newsImpactMap, rows.length]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => {
      runIntegratedScan();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, runIntegratedScan]);

  const sortBestFirst = (list = []) => [...list].sort((a, b) => Number(b.total || 0) - Number(a.total || 0) || Number(b.q?.changeRate || 0) - Number(a.q?.changeRate || 0));
  const sortWorstFirst = (list = []) => [...list].sort((a, b) => Number(a.total || 0) - Number(b.total || 0) || Number(a.q?.changeRate || 0) - Number(b.q?.changeRate || 0));

  const kospiTop = sortBestFirst(rows.filter((r) => String(r.market || "").includes("KOSPI200"))).slice(0, 20);
  const kosdaqTop = sortBestFirst(rows.filter((r) => String(r.market || "").includes("KOSDAQ200"))).slice(0, 20);
  const nasdaqTop = sortBestFirst(nasdaqRows).slice(0, 20);
  const domesticWorstRows = sortWorstFirst(rows).slice(0, 10);
  const usWorstRows = sortWorstFirst(nasdaqRows).slice(0, 10);
  const progress = scanState.total ? Math.round((scanState.done / scanState.total) * 100) : 0;
  const avgScore = [...kospiTop, ...kosdaqTop, ...nasdaqTop].length
    ? Math.round([...kospiTop, ...kosdaqTop, ...nasdaqTop].reduce((s, r) => s + r.total, 0) / [...kospiTop, ...kosdaqTop, ...nasdaqTop].length)
    : 0;
  const topSector = [...kospiTop, ...kosdaqTop, ...nasdaqTop].reduce((acc, r) => {
    acc[r.sector || r.tag || "기타"] = (acc[r.sector || r.tag || "기타"] || 0) + 1;
    return acc;
  }, {});
  const leaderSector = Object.entries(topSector).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  const renderBreakdown = (r) => {
    const items = [
      ["가치", r.valuePart],
      ["섹터", r.sectorScore],
      ["모멘텀", r.momentumScore],
      ["RSI", r.rsiScore],
      ["기술", r.technicalScore],
    ];
    return (
      <div className="integrated-breakdown">
        {items.map(([label, value]) => (
          <div key={label}>
            <small className="sub">{label}</small>
            <div className="integrated-mini-meter"><div style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} /></div>
          </div>
        ))}
      </div>
    );
  };

  const priceText = (r, isGlobal = false) => {
    if (isGlobal) return fmtGlobalPrice({ ...(r.q || {}), symbol: r.symbol, type: "us" });
    return fmtPrice(r.q?.price);
  };

  const renderMobileCards = (list, isWorst = false, isGlobal = false) => (
    <div className="integrated-mobile-card-list">
      {list.map((r, i) => {
        const bars = [["가치", r.valuePart], ["섹터", r.sectorScore], ["모멘텀", r.momentumScore], ["RSI", r.rsiScore], ["기술", r.technicalScore]];
        const risks = [];
        if (isWorst) {
          if (r.valuePart < 55) risks.push("가치 약함");
          if (r.momentumScore < 45) risks.push("모멘텀 약세");
          if (r.rsi >= 75) risks.push("RSI 과열");
          if (r.rsi <= 30) risks.push("RSI 침체");
          if (r.sectorScore < 55) risks.push("섹터 약세");
          if (Number(r.q?.changeRate || 0) < -2) risks.push("단기 하락");
        }
        return (
          <div className={`integrated-mobile-card ${isWorst ? "integrated-mobile-worst" : ""}`} key={`mobile-${r.code || r.symbol}-${i}`}>
            <div className="integrated-mobile-card-head">
              <div className="integrated-mobile-rank">{i + 1}</div>
              <div>
                <div className="integrated-mobile-name">{r.name}</div>
                <div className="integrated-mobile-meta">
                  {(r.code || r.symbol)} · {r.market || "-"} · {r.sector || r.tag || "-"}<br />
                  현재가 {isGlobal ? fmtGlobalPrice({ ...(r.q || {}), symbol: r.symbol, type: "us" }) : fmtPrice(r.q?.price)}
                  <span className={Number(r.q?.changeRate || 0) >= 0 ? " up" : " down"}> · {r.q?.changeStr || fmtRate(r.q?.changeRate)}</span>
                </div>
              </div>
              <div className="integrated-mobile-score">{r.total}<small>{isWorst ? "취약" : "점수"}</small></div>
            </div>
            <div className="integrated-mobile-badges">
              <span>{isWorst ? "위험점검" : r.decision}</span><span>RSI {r.rsi}</span><span>F&G {r.sectorFG}</span><span>{r.sectorPhase}</span><span>{r.sectorMomentum}</span>
            </div>
            <div className="integrated-mobile-bars">
              {bars.map(([label, value]) => (
                <div className="integrated-mobile-bar" key={label}>
                  <small>{label}</small><div className="integrated-mobile-bar-track"><div style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} /></div>
                </div>
              ))}
            </div>
            {!isWorst && (

              <div className="integrated-mobile-hold">

                <b>{r.holdingType || "관찰"}</b>

                <span>{r.holdingPeriod || "관찰"} · {r.holdingComment || "조건 확인 필요"}</span>

              </div>

            )}

            <div className="integrated-mobile-reason">{isWorst ? (risks.length ? risks.join(" · ") : "통합점수 하위권") + " · 신규 진입보다 관망 우선" : r.reasons}</div>
          </div>
        );
      })}
      {!list.length && <div className="sub">통합 분석 실행 후 표시됩니다.</div>}
    </div>
  );

  const renderOneColumnCards = (list, { isWorst = false, isGlobal = false } = {}) => (
    <div className="integrated-onecol-list">
      {list.map((r, i) => {
        const bars = [["가치", r.valuePart], ["섹터", r.sectorScore], ["모멘텀", r.momentumScore], ["RSI", r.rsiScore], ["기술", r.technicalScore]];
        const risks = [];
        if (isWorst) {
          if (r.valuePart < 55) risks.push("가치 약함");
          if (r.momentumScore < 45) risks.push("모멘텀 약세");
          if (r.rsi >= 75) risks.push("RSI 과열");
          if (r.rsi <= 30) risks.push("RSI 침체");
          if (r.sectorScore < 55) risks.push("섹터 약세");
          if (Number(r.q?.changeRate || 0) < -2) risks.push("단기 하락");
        }
        const price = isGlobal ? fmtGlobalPrice({ ...(r.q || {}), symbol: r.symbol, type: "us" }) : fmtPrice(r.q?.price);
        const change = r.q?.changeStr || fmtRate(r.q?.changeRate);
        return (
          <div className={`integrated-onecol-card ${i === 0 && !isWorst ? "active" : ""} ${isWorst ? "worst" : ""}`} key={`onecol-${r.code || r.symbol}-${i}`}>
            <div className="integrated-onecol-head">
              <div className="integrated-onecol-rank">{i + 1}</div>
              <div className="integrated-onecol-main">
                <div className="integrated-onecol-name">{r.name}</div>
                <div className="integrated-onecol-meta">{r.code || r.symbol}<span className="mobile-hide-market"> · {r.market || "-"}</span> · {r.sector || r.tag || "-"}</div>
                <div className="integrated-onecol-meta">현재가: {price}</div>
                <div className={`integrated-onecol-change ${Number(r.q?.changeRate || 0) >= 0 ? "up" : "down"}`}>{change}</div>
              </div>
              <div className="integrated-onecol-score">
                {r.total}
                <small>{isWorst ? "취약" : "통합"}</small>
              </div>
              <div className="integrated-onecol-judge">
                <div className="integrated-onecol-judge-title">판정</div>
                <div className="integrated-onecol-judge-value">{isWorst ? "위험점검" : r.decision}</div>
                <div className="integrated-onecol-judge-meta">RSI {r.rsi}<br />F&G {r.sectorFG}</div>
              </div>
            </div>

            <div className="integrated-onecol-body">
              <div className="integrated-onecol-badges">
                <span>{isWorst ? "위험점검" : r.decision}</span>
                <span>RSI {r.rsi}</span>
                <span>F&G {r.sectorFG}</span>
                <span>{r.sectorPhase}</span>
                <span>{r.sectorMomentum}</span>
              </div>

              <div className="integrated-onecol-bars">
                {bars.map(([label, value]) => (
                  <div className="integrated-onecol-bar" key={label}>
                    <small>{label}</small>
                    <div className="integrated-onecol-track">
                      <div style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="integrated-onecol-reason">
                {isWorst
                  ? `${(risks.length ? risks : ["통합점수 하위권"]).join(" · ")} · 신규 진입보다 관망 우선`
                  : r.reasons}
              </div>
            </div>
          </div>
        );
      })}
      {!list.length && <div className="sub">통합 분석 실행 후 표시됩니다.</div>}
    </div>
  );

  const renderTable = (list, marketName, isGlobal = false) => (
    <div className={`integrated-section ${isGlobal ? "integrated-nasdaq-section" : ""}`}>
      <div className="integrated-section-head">
        <b>{marketName} 최적 추천 {list.length}</b>
        <span className="tag green">{list.length}개</span>
      </div>
      <div className="integrated-scroll">
        {renderOneColumnCards(list, { isWorst: false, isGlobal })}
        <table className="integrated-table integrated-desktop-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>종목</th>
              <th>통합점수</th>
              <th>지표 기여도</th>
              <th>판정</th>
              <th>추천 근거</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={`${marketName}-${r.code || r.symbol}`}>
                <td className="rank">{i + 1}</td>
                <td>
                  <b>{r.name}</b><br />
                  <span className="sub">{r.code || r.symbol} · {r.sector || r.tag || "-"} · <span className="integrated-global-price">{isGlobal ? fmtGlobalPrice({ ...(r.q || {}), symbol: r.symbol, type: "us" }) : fmtPrice(r.q?.price)}</span></span><br />
                  <span className={Number(r.q?.changeRate || 0) >= 0 ? "up" : "down"}>{r.q?.changeStr || fmtRate(r.q?.changeRate)}</span>
                </td>
                <td><span className="integrated-score">{r.total}</span></td>
                <td>{renderBreakdown(r)}</td>
                <td>
                  <span className={r.decision === "최우선" ? "up" : ""}>{r.decision}</span><br />
                  <span className="integrated-hold-tag">{r.holdingType || "관찰"}</span><br />
                  <span className="sub">RSI {r.rsi} · F&G {r.sectorFG}</span>
                </td>
                <td>
                  <div className={isGlobal ? "integrated-us-tag" : "integrated-pill"}>{r.sectorPhase}</div>
                  <div className={isGlobal ? "integrated-us-tag" : "integrated-pill"}>{r.sectorMomentum}</div>
                  {r.newsScore !== 0 && <div className={isGlobal ? "integrated-us-tag" : "integrated-pill"}>뉴스 {r.newsScore > 0 ? "+" : ""}{r.newsScore}</div>}
                  {r.learningAdj !== 0 && <div className={isGlobal ? "integrated-us-tag" : "integrated-pill"}>AI학습 {r.learningAdj > 0 ? "+" : ""}{r.learningAdj}</div>}
                  <div className="integrated-hold-box">
                    <b>{r.holdingPeriod || "관찰"}</b>
                    <span>{r.holdingComment || "조건 확인 필요"}</span>
                  </div>
                  <div className="pick-tags">{r.reasons}</div>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="6" className="sub">스캔 후 추천 종목이 표시됩니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );


  const renderWorstTable = (list, title = "WORST 10 · 통합지표 취약 후보", isGlobal = false) => (
    <div className={`integrated-wost-section integrated-worst-top ${isGlobal ? "integrated-worst-us" : "integrated-worst-domestic"}`}>
      <div className="integrated-section-head">
        <b>{title}</b>
        <span className="tag red">{list.length}개</span>
      </div>
      <div className="integrated-worst-notice">
        <b>주의:</b>
        <span>{isGlobal ? "미국/NASDAQ100 통합점수 하위 10개입니다. 미국 기술주·테마 리스크 점검용입니다." : "국내 KOSPI200/KOSDAQ200 통합점수 하위 10개입니다. 신규 진입 후보가 아니라 리스크 점검이 필요한 종목입니다."}</span>
      </div>
      <div className="integrated-scroll">
        {renderOneColumnCards(list, { isWorst: true, isGlobal })}
        <table className="integrated-table integrated-desktop-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>종목</th>
              <th>시장</th>
              <th>취약점수</th>
              <th>위험 요인</th>
              <th>관리 의견</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const risks = [];
              if (r.valuePart < 55) risks.push("가치 점수 약함");
              if (r.momentumScore < 45) risks.push("모멘텀 약세");
              if (r.rsi >= 75) risks.push("RSI 과열");
              if (r.rsi <= 30) risks.push("RSI 침체");
              if (r.sectorScore < 55) risks.push("섹터 심리 약세");
              if (Number(r.q?.changeRate || 0) < -2) risks.push("단기 하락 압력");
              return (
                <tr key={`worst-${title}-${r.code || r.symbol}`}>
                  <td className="rank">{i + 1}</td>
                  <td><b>{r.name}</b><br /><span className="sub">{r.code || r.symbol} · {r.sector || r.tag || "-"} · {r.market}</span></td>
                  <td>{r.market || "-"}</td>
                  <td><span className="integrated-wost-score">{r.total}</span></td>
                  <td>{(risks.length ? risks : ["통합점수 하위권"]).slice(0, 4).map((risk) => <span className="integrated-risk-tag" key={risk}>{risk}</span>)}</td>
                  <td><span className="sub">신규 진입보다 관망 우선. 보유 중이면 지지선·거래량 회복 여부 확인 후 대응.</span></td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan="6" className="sub">통합 분석 후 WORST 10이 표시됩니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );


  return (
    <div className="panel">
      <div className="panel-title">
        <span>지표 통합 최적분석</span>
        <span className="tag yellow">KOSPI20 · KOSDAQ20 · NASDAQ20 · 국내/미국 WORST</span>
      </div>
      <div className="panel-body integrated-shell">
        <div className="integrated-toolbar">
          <button className="btn" onClick={runIntegratedScan} disabled={scanState.loading}>{scanState.loading ? "통합 분석 중..." : "통합 분석 실행"}</button>
          <button className={`btn ${autoRefresh ? "active" : ""}`} onClick={() => setAutoRefresh(!autoRefresh)}>5분 주기 분석 {autoRefresh ? "ON" : "OFF"}</button>
          <span className="sub">국내 가치·섹터심리·RSI·모멘텀 + NASDAQ100 테마·모멘텀 통합</span>
        </div>

        <div className="integrated-summary">
          <div className="integrated-kpi"><small>분석 후보군</small><b>{bothUniverse.length + NASDAQ100_UNIVERSE.length}</b><span>KOSPI200 + KOSDAQ200 + NASDAQ100</span></div>
          <div className="integrated-kpi"><small>추천 평균점수</small><b>{avgScore}</b><span>상위 추천 평균</span></div>
          <div className="integrated-kpi"><small>주도 섹터</small><b style={{ fontSize: 16 }}>{leaderSector}</b><span>상위 추천 내 빈도</span></div>
          <div className="integrated-kpi"><small>국내 추천</small><b>{kospiTop.length + kosdaqTop.length}</b><span>KOSPI/KOSDAQ</span></div>
          <div className="integrated-kpi"><small>NASDAQ 추천</small><b>{nasdaqTop.length}</b><span>최종 20개</span></div>
          <div className="integrated-kpi ai-learning-kpi"><small>AI학습 예측률</small><b>{learning.winRate}%</b><span>통합통합검증 {learning.total}건 · 대기 {learning.pending || 0}건 · 평균 {fmtRate(learning.avgReturn)}</span></div>
        </div>

        <div className="value-scan-status">
          {scanState.loading
            ? `통합 분석 진행 중: ${scanState.done}/${scanState.total} · 현재 ${scanState.current}`
            : `마지막 분석: ${scanState.lastRun || "초기 계산값"} · 버튼 실행 시 국내/나스닥 현재가를 재조회해 재산정합니다.`}
          {scanState.error && <div className="error">분석 오류: {scanState.error}</div>}
          <div className="value-scan-progress"><div className="value-scan-progress-inner" style={{ width: `${progress}%` }} /></div>
        </div>

        <div className="integrated-market-layout">
          <div className="integrated-kospi-section">
            {renderTable(kospiTop, "코스피200")}
          </div>
          <div className="integrated-kosdaq-section">
            {renderTable(kosdaqTop, "코스닥200")}
          </div>
          <div className="integrated-nasdaq-section-wrap">
            {renderTable(nasdaqTop, "NASDAQ100", true)}
          </div>
        </div>

        <div className="integrated-worst-split-grid">
          {renderWorstTable(domesticWorstRows, "국내 WORST 10 · KOSPI/KOSDAQ 취약 후보", false)}
          {renderWorstTable(usWorstRows, "미국 WORST 10 · NASDAQ100 취약 후보", true)}
        </div>

        <ReadMeSection title="READ ME · 지표 통합 최적분석 확장">
          <h4>확장 범위</h4>
          <ul>
            <li>기존 코스피200 20개, 코스닥200 20개에 NASDAQ100 최적 추천 20개를 추가했습니다.</li>
            <li>WORST 10은 국내(KOSPI/KOSDAQ)와 미국(NASDAQ100)을 분리해서 표시합니다.</li>
            <li>NASDAQ100은 실시간 미국주식 API가 연결된 경우 현재가와 등락률을 반영하고, 실패 시 기존 DEMO/빈 시세로 안전 처리합니다.</li>
          </ul>
          <h4>통합 점수 구성</h4>
          <ul>
            <li>국내는 저평가, 섹터 심리, 모멘텀, RSI, 기술 조건을 합산합니다.</li>
            <li>NASDAQ100은 대형주/AI 테마, 모멘텀, RSI 안정성, 기술 조건을 합산합니다.</li>
            <li>추천 20개 종목에는 통합점수, 모멘텀, RSI, 뉴스점수에 따라 장기 보유/단기 보유/분할매수 관찰 멘트를 추가했습니다.</li>
            <li>추천 종목은 다음 조회 시 실제 가격 변화로 자동 검증되며, 종목·섹터별 적중률을 학습해 점수에 자동 보정됩니다.</li>
            <li>모바일에서는 저장소 제한을 고려해 sessionStorage fallback을 적용했고, 다음 조회 시 빠르게 검증되도록 모바일 평가 대기시간을 단축했습니다.</li>
            <li>서버 AI학습 동기화를 추가해 PC/모바일/태블릿의 학습 예측률과 점수 보정값을 같은 기준으로 반영합니다. 서버 실패 시에는 기존 기기 저장 방식으로 자동 fallback됩니다.</li>
          </ul>
        </ReadMeSection>
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

const TRADING_OPS_SECTIONS = [
  { key: "balance", title: "잔고", note: "예수금·평가금액은 연결 후 표시됩니다." },
  { key: "holdings", title: "보유 종목", note: "보유 종목 목록은 연결 후 표시됩니다." },
  { key: "openOrders", title: "미체결 주문", note: "미체결 주문 내역은 연결 후 표시됩니다." },
  { key: "fills", title: "체결 내역", note: "체결 내역은 연결 후 표시됩니다." },
  { key: "buyingPower", title: "매수주문가능금액", note: "매수 가능 금액은 연결 후 표시됩니다." },
];

function TradingOps() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const loadStatus = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetchJson("/api/broker/status");
      setStatus(res && typeof res === "object" ? res : null);
    } catch (e) {
      setStatus(null);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const configured = status?.configured === true;
  const connection = status?.connection || "-";
  const connectionLabel = connection === "unconfigured" ? "설정 없음" : connection === "unverified" ? "미검증" : connection;

  return (
    <div className="grid">
      <div className="panel">
        <div className="panel-title">
          <span>투자운영 — KB증권 연동 상태</span>
          <span className="row">
            <span className="tag yellow">조회 전용</span>
            <span className="tag red">주문 기능 비활성</span>
          </span>
        </div>
        <div className="panel-body">
          <div className="row">
            <button className="btn" type="button" onClick={loadStatus} disabled={loading}>
              {loading ? "확인 중" : "연동 상태 새로고침"}
            </button>
            <span className="sub">이 화면은 조회만 가능하며 매수/매도 주문은 제공하지 않습니다.</span>
          </div>
          <div style={{ height: 12 }} />
          {loading && <div className="loading">연동 상태 조회 중...</div>}
          {err && <div className="error">연동 상태 조회 실패: {err}</div>}
          {!loading && !err && !status && <div className="sub">연동 상태 정보가 없습니다.</div>}
          {!err && status && !configured && (
            <div className="error" style={{ borderColor: "#ffd44766", color: "#ffd447", background: "#ffd44711" }}>
              서버에 KB증권 연동 설정이 없습니다.
            </div>
          )}
          {!err && status && configured && (
            <>
              <div className="card-grid">
                <div className="card">
                  <div className="card-title">연결 상태</div>
                  <div className="value">{connectionLabel}</div>
                  <div className="sub">connection: {connection}</div>
                </div>
                <div className="card">
                  <div className="card-title">환경변수 설정</div>
                  <div className="value">완료</div>
                  <div className="sub">서버 연동 설정이 확인되었습니다.</div>
                </div>
                <div className="card">
                  <div className="card-title">거래 활성화</div>
                  <div className="value">{status.tradingEnabled ? "ON" : "OFF"}</div>
                  <div className="sub">이 화면에서는 주문을 실행하지 않습니다.</div>
                </div>
                <div className="card">
                  <div className="card-title">자동매매</div>
                  <div className="value">{status.autoTradingEnabled ? "ON" : "OFF"}</div>
                  <div className="sub">서버 설정 값입니다.</div>
                </div>
              </div>
              {status.message && <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>{status.message}</div>}
            </>
          )}
        </div>
        <div className="footer-note">조회 전용 화면입니다. 매수/매도/주문 기능은 제공되지 않습니다.</div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <span>계좌 조회 항목</span>
          <span className="tag yellow">조회 전용</span>
        </div>
        <div className="panel-body">
          <div className="card-grid">
            {TRADING_OPS_SECTIONS.map((s) => (
              <div className="card" key={s.key}>
                <div className="card-title">{s.title}</div>
                <div className="value">연결 후 표시</div>
                <div className="sub">{s.note}</div>
              </div>
            ))}
          </div>
          <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
            각 항목은 KB증권 응답 필드 명세 확보 후 활성화됩니다. 임의의 예시 수치는 표시하지 않습니다.
          </div>
        </div>
        <div className="footer-note">데이터 없음 — 실제 연동 응답이 확인되기 전까지 값은 표시되지 않습니다.</div>
      </div>
    </div>
  );
}

function TradingPlatform({ user, onLogout }) {
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
  const [selectedGlobal, setSelectedGlobal] = useState(null);
  const [selectedCode, setSelectedCode] = useState("005930");
  const [loading, setLoading] = useState(false);
  const [globalErr, setGlobalErr] = useState("");
  const [now, setNow] = useState("");
  const [deviceMode, setDeviceMode] = useState("desktop");

  const selected = quotes[selectedCode] || { code: selectedCode, name: getStockName(selectedCode, "", stocks) };

  useEffect(() => saveLS("alpha_custom_stocks", customStocks), [customStocks]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("ko-KR", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const detectDeviceMode = () => {
      const w = window.innerWidth || document.documentElement.clientWidth || 0;
      const h = window.innerHeight || document.documentElement.clientHeight || 0;
      const maxSide = Math.max(w, h);
      const minSide = Math.min(w, h);
      const touch = (navigator.maxTouchPoints || 0) > 1;
      const ua = navigator.userAgent || "";
      const isiPad = /iPad/.test(ua) || (navigator.platform === "MacIntel" && touch);
      const isPhone = minSide <= 700 || (touch && maxSide <= 932);
      const isTablet = !isPhone && (isiPad || (touch && minSide >= 701 && maxSide <= 1400));
      setDeviceMode(isPhone ? "phone" : isTablet ? "tablet" : "desktop");
    };
    detectDeviceMode();
    window.addEventListener("resize", detectDeviceMode);
    window.addEventListener("orientationchange", detectDeviceMode);
    return () => {
      window.removeEventListener("resize", detectDeviceMode);
      window.removeEventListener("orientationchange", detectDeviceMode);
    };
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
      const normalizedGlobal = Array.isArray(g) ? g.map((x) => ({ ...x, code: x.symbol, assetClass: "global" })) : [];
      setGlobalQuotes(normalizedGlobal);
      setSelectedGlobal((prev) => prev || normalizedGlobal[0] || null);
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
    <div className={`app device-${deviceMode}`}>
      <style>{styles}</style>
      <Header now={now} tab={tab} user={user} onLogout={onLogout} />
      <div className="mobile-nav-label">메뉴 선택 · 선택한 메뉴만 아래에 표시됩니다</div>
      <Nav tab={tab} setTab={setTab} />
      <TickerBar quotes={quotes} stocks={stocks} globalQuotes={globalQuotes} />

      <div className={`main ${tab === "US/CRYPTO" ? "global-only" : ""}`}>
        <div className={`left-panel-shell ${tab === "US/CRYPTO" ? "hide-left-panel" : tab === "대시보드" ? "" : "mobile-hide-left"}`}>
          <LeftPanel stocks={stocks} quotes={quotes} selectedCode={selectedCode} setSelectedCode={setSelectedCode} reload={loadAll} loading={loading} addStock={addStock} removeStock={removeStock} />
        </div>

        <div className="grid">
          {globalErr && <div className="error">전역 API 오류: {globalErr}</div>}
          <ScreenFrame tab={tab}>
            {tab === "대시보드" && <Dashboard market={market} selected={selected} stocks={stocks} />}
            {tab === "차트 분석" && <ChartView selected={selected} stocks={stocks} selectedCode={selectedCode} setSelectedCode={setSelectedCode} />}
            {tab === "스크리너" && <Screener quotes={quotes} stocks={stocks} />}
            {tab === "저평가 스크리너" && <ValueScreener quotes={quotes} stocks={stocks} />}
            {tab === "US/CRYPTO" && <GlobalMarket globalQuotes={globalQuotes} setGlobalQuotes={setGlobalQuotes} selectedGlobal={selectedGlobal} setSelectedGlobal={setSelectedGlobal} />}
            {tab === "포트폴리오" && <Portfolio quotes={quotes} stocks={stocks} />}
            {tab === "알림 센터" && <AlertCenter quotes={quotes} stocks={stocks} />}
            {tab === "AI 리포트" && <AiReport selected={selected} stocks={stocks} />}
            {tab === "AXIOS 마켓 인사이트" && <AxiosMarketInsight stocks={stocks} globalQuotes={globalQuotes} />}
            {tab === "일일 브리핑" && <DailyBriefing stocks={stocks} quotes={quotes} reload={loadAll} loading={loading} />}
            {tab === "섹터/테마" && <ThemeAnalysis stocks={stocks} quotes={quotes} />}
            {tab === "전종목 스캔" && <FullScan stocks={stocks} quotes={quotes} />}
            {tab === "백테스트" && <Backtest selected={selected} stocks={stocks} />}
            {tab === "AI 시뮬레이션" && <AiSimulation />}
            {tab === "지표 통합 최적분석" && <IntegratedOptimalAnalysis stocks={stocks} quotes={quotes} globalQuotes={globalQuotes} />}
            {tab === "투자운영" && <TradingOps />}
          </ScreenFrame>
        </div>
      </div>
      <div className="creator-mark">Built by <b>ASK</b></div>
    </div>
  );
}

const LOGIN_FAIL_MESSAGE = "로그인 정보가 올바르지 않습니다.";

function AuthLoadingScreen() {
  return (
    <div className="auth-gate">
      <style>{styles}</style>
      <div className="auth-card">
        <h1>ALPHA</h1>
        <div className="sub">세션을 확인하는 중입니다.</div>
      </div>
    </div>
  );
}

function LoginScreen({ onLoggedIn }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      onLoggedIn(data);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes("HTTP 429")) setError("로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.");
      else setError(LOGIN_FAIL_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-gate">
      <style>{styles}</style>
      <form className="auth-card" onSubmit={submit}>
        <h1>ALPHA</h1>
        <div className="sub">관리자 로그인</div>
        {error ? <div className="error">{error}</div> : null}
        <div className="auth-field">
          <label htmlFor="auth-login-id">아이디</label>
          <input
            id="auth-login-id"
            className="input"
            type="text"
            autoComplete="username"
            value={loginId}
            disabled={submitting}
            onChange={(e) => setLoginId(e.target.value)}
          />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-password">비밀번호</label>
          <div className="auth-pw-row">
            <input
              id="auth-password"
              className="input"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              disabled={submitting}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="btn small"
              type="button"
              disabled={submitting}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? "숨김" : "표시"}
            </button>
          </div>
        </div>
        <button className="btn full" type="submit" disabled={submitting}>
          {submitting ? "로그인 중" : "로그인"}
        </button>
      </form>
    </div>
  );
}

function AuthGate() {
  const [phase, setPhase] = useState("checking");
  const [user, setUser] = useState(null);

  const goLogin = () => {
    setUser(null);
    setPhase("login");
  };

  const goReady = (session) => {
    setUser(session?.user || null);
    setPhase("ready");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson("/api/auth/session");
        if (cancelled) return;
        if (data && data.authenticated) goReady(data);
        else goLogin();
      } catch {
        if (!cancelled) goLogin();
      }
    })();
    const onUnauthorized = () => goLogin();
    window.addEventListener("alpha-auth-unauthorized", onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("alpha-auth-unauthorized", onUnauthorized);
    };
  }, []);

  const onLogout = async () => {
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } catch {
      /* 로그아웃 실패여도 로그인 화면으로 되돌린다. */
    }
    goLogin();
  };

  if (phase === "checking") return <AuthLoadingScreen />;
  if (phase === "login") return <LoginScreen onLoggedIn={goReady} />;
  return <TradingPlatform user={user} onLogout={onLogout} />;
}

export default function App() {
  return <AuthGate />;
}
