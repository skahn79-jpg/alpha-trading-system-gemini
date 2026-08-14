# ALPHA TRADING SYSTEM — Gemini Spark 인수인계

- 문서 기준일: 2026-08-14
- 조사 범위: 저장소 코드·설정 파일 (`.env` 실제 값 미열람)
- Git: `main` / `HEAD = origin/main = 8b3429f` (조사 시점)
- 소스코드 변경: 단계 1 구현 완료 (predictor·calendar·storage). 본 문서는 조사 결과 + 단계 1 반영.

---

## 1. 문서 목적

Gemini Spark가 이 앱의 **실제 구현 상태**를 이해하고, 종목 상승·하락 분석·기간별 관점·지표 개선·성과 추적을 수행하기 위한 인수인계다.

단계 0은 조사 문서였다. 단계 1에서 예측 식별키·processMatured·로컬 StoragePort·KST/검증/락 복구가 구현되었다. 확인된 것만 사실로 적고, 추정은 `추정`, 미확인은 `unknown`으로 표시한다.

Spark에 맡길 예정 업무:

- 종목별 상승·하락 가능성 분석
- 초단기·단기·중기·장기 관점 구분
- 기술적 지표 및 수급 지표 개선
- 시장 국면별 종목 분석
- 트레이딩 종합점수 개발
- 예측 결과와 실제 결과 비교
- 백테스트 및 성과 추적
- 장 종료 후 정기 분석 보고
- 기존 앱 분석 기능 개선안

---

## 2. 프로젝트 요약

| 항목 | 내용 |
|------|------|
| 프로젝트명 | `alpha-trading-system` (표시명: ALPHA TRADING SYSTEM) |
| 버전 | `3.0.0` (`package.json`) |
| 목적 | 한국 주식 종목 조회·기술분석·AI 해설·알림. 브랜딩: 스펙터 + 독개미 + 경제명탐정 + 고고저 |
| 실행 환경 | Node.js ≥ 18, Express 서버 + Vite React SPA |
| 운영체제 | 서버: Render Linux. 개발: macOS. 클라이언트: 웹 + iOS 16+ |
| 언어 | JavaScript (서버·웹), Swift (iOS) |
| 프레임워크 | Express 4, React 18, Vite 5, SwiftUI |
| 데이터베이스 | **없음** (SQLite/Postgres 미사용·미연결). 로컬 JSON StoragePort (`lib/storage`). Firestore 모듈은 미연결 |
| 배포 | Render Web Service `alpha-trading-server`, 동일 출처로 `dist` + `/api` |
| 실행 | `npm run dev` (서버 3001 + Vite 5173), `npm start` (`node server.js`) |
| 테스트 | `npm test` (`node --test test/*.test.js`) |
| 빌드 | `npm run build` (Vite → `dist/`) |

한 줄: **분석·예측의 주 데이터는 KIS 일봉**이다. KB증권 Open API는 관리자 세션 조회 전용이며, 분석 엔진과 연결되어 있지 않다. 주문은 3중 차단이다.

---

## 3. 시스템 구성

```text
[웹 SPA: src/trading-platform.jsx]
[iOS SwiftUI: AlphaTradingIOS]
        │
        ▼
[Express server.js]  ── 정적 dist 서빙 + /api
        │
        ├── analysis.js / predictor.js / evolve.js / simulation.js
        ├── lib/calendar/krx-calendar.js
        ├── lib/storage/ (memory + json-file StoragePort)
        ├── dart.js / dart-fund.js
        ├── chartlab.js / trade.js / macro.js
        ├── crypto-report.js / btc-cycle.js / liqmap.js
        ├── apns.js
        ├── kb/*  (조회 전용, 분석 미연동)
        │
        ├── KIS Open API     (국내 시세·일봉·호가·검색)
        ├── KB Open API      (OAuth + 6 TR 조회)
        ├── DART             (실적·공시)
        ├── Gemini REST      (텍스트 해설만)
        ├── Yahoo / CoinGecko / FRED / RSS
        └── data/*.json      (마스터·런타임 캐시)
```

인증 계층:

| 계층 | 대상 | 방식 |
|------|------|------|
| 공개 | 시세·분석·검색 대부분 | `generalRateLimit`만 |
| 앱 키 | `/api/ai`, `/api/alerts`, `/api/sim` | 헤더 `X-App-Key` ↔ `APP_API_KEY` |
| 관리자 세션 | `/api/broker`, `/api/trading` | HttpOnly 쿠키 세션 (`kb/auth.js`) |

배치 (서버 `setInterval`, cron 패키지 없음):

| 작업 | 시작 | 주기 | 함수 |
|------|------|------|------|
| AI 예측 재학습 | 부팅 1분 | 6시간 | `selfTrainPredictor` → `predictor.trainFromHistory` |
| 유전 알고리즘 | 부팅 3분 | 6시간 | `runEvolution` → `evolve.evolveCycle` |
| 실적 공시 감시 | 부팅 5분 | 12시간 | `scanEarningsLoop` |
| 가격 알림 검사 | 외부 호출 | `GET /api/alerts/check` | Render Cron은 repo에 **없음** (`추정`: 대시보드 수동) |

---

## 4. 주요 디렉터리와 파일

```text
alpha-trading-system-gemini/
├── server.js                 Express 게이트웨이 (~4017줄)
├── analysis.js               일봉 기술지표 + 규칙 점수
├── predictor.js              로지스틱 회귀 (레거시 달력 7일 + 단계 1 식별키/채점)
├── lib/calendar/             KRX 거래일 캘린더 (목록 없으면 CALENDAR_PENDING)
├── lib/storage/              로컬 StoragePort (memory + JSON 파일)
├── evolve.js                 유전 알고리즘 기법 발굴
├── simulation.js             시그널 채점 (승/패)
├── dart.js / dart-fund.js 공시·실적
├── chartlab.js               매물대·유사패턴
├── trade.js / macro.js       수출·FRED 거시
├── crypto-report.js / btc-cycle.js / liqmap.js
├── apns.js
├── kb/                       KB증권 조회 어댑터
├── src/                      React (main.jsx, trading-platform.jsx)
├── data/                     KRX 마스터, 런타임 JSON
├── test/                     Node 테스트 (kb, auth, predictor-stage1)
├── test/fixtures/krx-calendar.js  테스트 픽스처. 운영 캘린더 아님
├── scripts/                  동기화·마스터 갱신
├── docs/                     본 인수인계 + KB 명세
├── AlphaTradingIOS/          SwiftUI 앱
└── render.yaml               배포 정의
```

제외: `node_modules`, `dist`, `.git`, `.env`, 캐시, 대용량 바이너리.

핵심 파일 역할:

| 파일 | 역할 |
|------|------|
| `server.js` | 라우트, KIS 토큰, Gemini 프록시, 알림, KB 라우트 연결 |
| `analysis.js` | `analyzeCandles()` — 기술 점수 0~100 |
| `predictor.js` | `createPredictor()` / `predict()` / `trainFromHistory()` / `processMatured()`. I/O는 StoragePort |
| `kb/broker.js` | IVU10140 등 6 TR. 주문 함수는 항상 throw |
| `kb/diagnostic.js` | 파싱 실패 시 키 이름만 로그 |
| `src/trading-platform.jsx` | 웹 전 화면 (~14500줄). 고고저·통합점수·백테스트 UI |
| `data/krx-master-merged.json` | 종목 카탈로그 (`code`, `name`, `market`, `sector`, …) |

---

## 5. 현재 구현 기능

상태 정의: 구현 완료 / 일부 구현 / 미구현 / 코드 존재하나 미사용 / 확인 불가

| 기능 | 상태 | 근거 |
|------|------|------|
| 관리자 로그인 | 구현 완료 | `kb/auth.js`, `/api/auth/*` |
| 관심종목 | 일부 구현 | `data/watchlist.json` + `/api/watchlist` (실적 감시용). 웹 관심은 로컬 상태 `추정` |
| 종목 검색 | 구현 완료 | `/api/search`, `/api/master/*`, KRX 마스터 + KIS |
| 현재가 조회 (분석용) | 구현 완료 | KIS `FHKST01010100` → `/api/quote/:code` |
| 현재가 조회 (KB) | 일부 구현 | `/api/trading/quotes/:symbol` (IVU10140). 장 마감 후 `dataHeader`만 관측. iOS `networkEnabled=false` |
| 일봉 | 구현 완료 | KIS `FHKST03010100` |
| 주봉·월봉 | 일부 구현 | 동일 TR의 기간 파라미터. 분석 엔진은 **일봉 기준** |
| 분봉 | 미구현 | 코드에서 분봉 TR 없음 |
| 차트 | 구현 완료 | `/api/chart/:code`, 웹·iOS 차트 |
| 기술적 지표 | 구현 완료 | `analysis.js` (아래 8장) |
| 종목 점수 | 구현 완료 | `analyzeCandles` 규칙 점수 + 웹 통합점수 |
| 상승·하락 예측 | 일부 구현 | 기본은 `LEGACY_7_CALENDAR_DAYS`. 단계 1에서 SHORT+5거래일 target을 캘린더로 계산 가능. ULTRA_SHORT/MEDIUM/LONG 모델 **미구현** |
| 뉴스 | 일부 구현 | RSS + 키워드. NLP 감성 **미구현** |
| 공시 | 일부 구현 | DART 목록·실적. 본문 분석 **미구현**. NPS 필터는 placeholder |
| 수급 (외인/기관/프로그램/공매도) | 미구현 | 웹 UI에 등락률 기반 **추정값**. 실API 없음 |
| 시장지수 | 구현 완료 | `/api/index` KIS |
| 자동 종목 선정 | 일부 구현 | `/api/signals/featured`, `/api/trade/picks`, 웹 전종목 스캔 |
| 알림 | 구현 완료 | 서버 가격 알림 + Telegram + APNs + iOS 로컬 |
| 백테스트 | 일부 구현 | `trainFromHistory`/`evolve`는 학습용 walk-forward. 웹 Backtest 탭은 **예시 UI** (`/api/history` 없음) |
| 모의투자 | 일부 구현 | `simulation.js` 시그널 채점. 가상 계좌 엔진 **미구현** |
| 실거래 | 미구현 | 주문 3중 차단 |
| 거래 내역 | 일부 구현 | KB `SSQM2341` 조회 API만. 분석 미연동. iOS 미호출 |
| 예측 결과 저장 | 일부 구현 | 로컬 JSON StoragePort (`data/ai-predictions.json`). 2000건 slice 제거. Render 디스크 휘발은 여전. Postgres 미연결 |
| 예측 성과 분석 | 일부 구현 | `getModelStats()`에 `horizonCounts`로 LEGACY/SHORT 분리. 국면별 분해 **미구현**. SHORT+LEGACY 합산 금지 |
| 관리자 화면 | 일부 구현 | 웹 로그인 + iOS KB 상태. 전용 어드민 콘솔 **없음** |
| 스케줄 실행 | 일부 구현 | `setInterval` 3종. 장 종료 정기 보고 **미구현** |
| Firebase 동기화 | 코드 존재하나 미사용 | `firebase-config.js`를 앱이 import하지 않음 |
| 고고저 | 일부 구현 | 웹만 (`calculateGogojeoSignal`). 서버·iOS **미포팅** |

---

## 6. KB증권 API 연동 현황

### 6.1 인증 (값 기록 금지)

| 환경변수 | 용도 | 필수 | 실제 값 |
|----------|------|-----:|--------:|
| `KBSEC_APP_KEY` | OAuth App Key | 필수 | 금지 |
| `KBSEC_APP_SECRET` | OAuth Secret | 필수 | 금지 |
| `KBSEC_BASE_URL` | API 호스트. 기본 `https://developer.kbsec.com:32484` | 선택 | 금지 |
| `KBSEC_IP_ADDR` | 요청 `dataHeader.ipAddr` | 선택 | 금지 |
| `KBSEC_MAC_ADDR` | 요청 `dataHeader.macAddr` | 선택 | 금지 |
| `KBSEC_TRADING_ENABLED` | 주문 플래그. `"true"`만 활성. 기본 false | 선택 | 금지 |
| `KBSEC_AUTO_TRADING_ENABLED` | 자동매매 플래그. 기본 false | 선택 | 금지 |

- 방식: `POST /oauth2/token`, `grantType: client_credentials`
- 저장: **프로세스 메모리만**. 파일/DB에 토큰 저장 없음
- 갱신: 만료 5분 전 (`REFRESH_MARGIN_MS = 300000`). 동시 호출은 `_inflight` 공유
- 운영/모의 계정 구분: **코드에 없음**. 단일 `KBSEC_BASE_URL`
- 요청 헤더: `Authorization: Bearer {token}`, `Content-Type: application/json`
- 요청 envelope: `{ dataHeader: { ipAddr, macAddr }, dataBody }` — **변경 금지 상태**
- 성공 코드: `resultCode` ∈ `{ "0", "0000", "200" }`
- 재시도: TR 호출 **재시도 없음** (`retryCount`는 진단 필드, 기본 0)
- 로그: `[kb-diagnostic]` 허용 필드만. 본문·값·헤더 금지
- 클라이언트 오류: HTTP 502, `{"error":"KB증권 조회에 실패했습니다."}`
- `connection`: 서버가 `"unverified"`로 고정. `verified`로 바꾸지 말 것

### 6.2 사용 TR

| 기능 | TR | 경로 | 호출 위치 | 입력 | 주요 응답 필드(코드 기준) | 저장 | 주기 |
|------|-----|------|-----------|------|---------------------------|------|------|
| 장운영 | SZQM0771 | `/api/v1/szqm0771` | `getMarketStatus` → `/api/trading/market-status` | 없음 | `now_dt`, `now_tm`, `stk_mkoprt_ccd` 등 | 없음 | 요청 시 |
| 현재가 | IVU10140 | `/api/v1/ivu10140` | `getQuote` → `/api/trading/quotes/:symbol` | `excg_clsf`, `shrt_cd` | `is_nm`, `now_prc`를 **dataBody 최상위**에서 읽음 | 없음 | 요청 시 |
| 주문가능금액 | SSQM1802 | `/api/v1/ssqm1802` | `getOrderableAmount` | 명세 INPUT | 주문가능 금액 필드 | 없음 | 요청 시 |
| 잔고(결제) | SSQM2932 | `/api/v1/ssqm2932` | `getBalanceSettled` | 명세 INPUT | `Record1` | 없음 | 요청 시 |
| 잔고/포지션 | SSQM2952 | `/api/v1/ssqm2952` | `getBalance` / `getPositions` | 명세 INPUT | `Record1` | 없음 | 요청 시 |
| 체결 | SSQM2341 | `/api/v1/ssqm2341` | `getExecutions` | `nxt_key` 연속 | `Record1` | 없음 | 요청 시 |

분석 엔진이 쓰는 시세는 **KIS**다. KB 현재가는 분석 파이프라인에 연결되지 않았다.

호가·일봉·수급·공매도·재무 KB TR: **미사용**.

### 6.3 IVU10140 파싱 제한 (2026-08-13 관측)

장 마감 후 1회 호출 결과 (값 없음, 구조만):

```text
HTTP 200, stage=quote, errorType=parsing
payloadType=object
topLevelKeys=["dataHeader"]
dataBodyType=unknown
dataBodyKeys=[]
is_nm=missing, now_prc=missing
```

코드 경로: `dataBody.is_nm` / `dataBody.now_prc`.
명세상 JSON 중첩은 **unknown**. 정규장 비교 호출은 별도 승인 시에만 1회.

### 6.4 주문 분리 — Spark 연결 제외

| 구분 | 상태 |
|------|------|
| 조회 전용 | 6 TR 구현. 관리자 세션 필요 |
| 모의투자 (KB) | 미구현 |
| 실거래 주문 | `placeOrder`/`amendOrder`/`cancelOrder`는 항상 throw (`TRADING_DISABLED` 또는 `NOT_IMPLEMENTED`) |
| 서버 POST `/api/trading` | `KBSEC_TRADING_ENABLED !== "true"`면 403. POST 라우트 자체 없음 |
| iOS | `KBInquiryPolicy.networkEnabled=false`, `orderControlsEnabled=false` |

Spark는 주문·이체·계좌비밀번호·토큰을 다루지 않는다.

---

## 7. 데이터 구조와 데이터 사전

상세 스키마는 `docs/GEMINI_SPARK_DATA_SCHEMA.md`.

출처 요약:

| 출처 | 용도 |
|------|------|
| KIS | 국내 현재가, 일/주/월봉, 지수, 호가, PER/PBR/EPS |
| KB | 계좌·현재가 조회 (분석 미연동) |
| DART | 매출·영업이익, corp_code |
| KRX 마스터 JSON | 종목코드·이름·시장·섹터 |
| Yahoo | 해외·크립토 차트 |
| FRED | 거시 |
| RSS | 뉴스 제목 |
| Gemini | 자연어 해설 (숫자 계산 아님) |
| 계산 결과 | `analyzeCandles`, `predict` |
| 사용자 입력 | 알림 조건, 관심종목, 관리자 로그인 |

주요 필드 존재 여부:

| 필드 | 존재 | 위치 |
|------|------|------|
| 종목코드 | 있음 | `code` / `shrt_cd` |
| 종목명 | 있음 | `name` / `is_nm` |
| 거래일 | 있음 | 캔들 `date` |
| 시가·고가·저가·종가 | 있음 | KIS 일봉 |
| 거래량 | 있음 | `volume` |
| 거래대금 | 일부 | KIS 시세 필드. 분석 점수에는 직접 미사용 `추정` |
| 시가총액 | 일부 | KIS 시세. 필수 아님 |
| 외인/기관/개인/프로그램 순매수 | 없음 (실데이터) | 웹 추정만 |
| 공매도·대차 | 없음 | |
| 업종·시장 | 있음 | 마스터 `sector`, `market` |
| PER/PBR | 있음 | KIS 제공값. 자체 계산 없음 |
| 뉴스 감성 | 일부 | 키워드. 확률 아님 |
| 예측확률 | 있음 | `probUp`/`probDown` (레거시 달력 7일). 응답은 %, 로그는 0~1 |
| 예측 방향 | 있음 | `UP`/`DOWN` (`probUp>=0.5`) |
| 실제 수익률 | 일부 | 단계 1: `processMatured`가 `targetTradingDate`의 확정 종가만 사용. 없으면 `CALENDAR_PENDING`. 최신 종가 채점 금지 |
| 종합점수 | 있음 | `score` 0~100 |
| 신뢰도 | 있음 | `high`/`medium`/`low`는 \|p-0.5\| 구간. **통계적 신뢰도가 아님** |

품질:

| 이슈 | 처리 |
|------|------|
| 결측 | 캔들 5개 미만이면 점수 0. 지표별 null |
| 중복 | 단계 1: UUID `predictionId`. 6필드 키 `symbol, baseTradingDate, horizonType, horizonTradingDays, modelVersion, featureVersion`. 구 로그 version fallback은 `unspecified`(≠ `predictor-legacy-v1`) |
| 수정주가 | `adjustmentStatus: "UNKNOWN"` (열거). 문자열 unknown만 쓰지 말 것 |
| 액면분할·배당락 | 전용 처리 **없음** |
| 신규상장·상폐·정지·관리 | 마스터 필터 일부. 체계적 처리 **미구현** |
| 시간대 | `lib/calendar/kst.js` Intl `Asia/Seoul`. Date/ISO는 Instant 후 KST. YYYY-MM-DD만 있으면 TZ 변환 없음 |
| 휴장일 | `lib/calendar/krx-calendar.js`. 목록에 없으면 임의 계산 금지 → `CALENDAR_PENDING`. 테스트 픽스처는 운영 캘린더 아님 |
| 장전/장중/장후 | 당일 봉은 `isFinal===true` 또는 `CLOSED` 필요. 당일·isFinal 없으면 예측 로그 미기록(확률 응답은 유지). 미확정 봉은 채점 금지. `TIME_HEURISTIC`은 15:40 시각 판정 출처이며 KIS 공식 확정/공식 캘린더가 아님. `UNKNOWN`·`NOT_FINAL`은 예측 로그·학습 대상에서 제외(현재 로그 미저장). 과거 확정봉(`HISTORICAL_DATE`)은 허용. 현재 SGD/`trainFromHistory`는 변경 없음. candle-meta는 opts 최상위, `predict()`는 저장 레코드·반환 JSON에 `candleFinality`/`finalitySource`/`candleTradingDate`/`dataAsOf` 호환 확장(기존 키 유지). 이후 품질 점검은 `finalitySource`별 성과 분리 |
| 미래정보 누출 | 예측 **피처**에는 `dataAsOf` 이후 정보를 쓰지 않음. 성과평가에는 `targetTradingDate`의 미래 종가를 쓰는 것이 정상. 단계 1에서 `processMatured`는 평가일 최신 종가 사용을 중지 |
| 생존편향 | 마스터는 현재 상장 위주. 과거 폐지 종목 **미포함** (`추정`) |

---

## 8. 기술적 지표

계산 파일: `analysis.js`. 입력: KIS 일봉 배열 (함수 내부에서 **최신순** 정렬).

| 지표 | 함수 | 기간 | 계산식 요지 | 일반 정의와 차이 | 점수 반영 | 상태 |
|------|------|-----:|-------------|------------------|-----------|------|
| SMA | `sma` | 5/20/50/60/120/200 | 단순평균 | 동일 | 정배열·이격·골든 | 구현 |
| EMA | `emaSeries` | MACD용 | 표준 EMA | 단독 출력 없음 | MACD 간접 | 구현 |
| RSI | `rsi` | 14 | 최근 14봉 gain/loss **단순평균** | **Wilder 평활 아님** | ±5 | 구현 |
| Wilder RSI | `wilderRsiSeries` | 14 | 다이버전스용 | 메인 RSI와 다름 | 간접 | 구현 |
| 볼린저 | `bollinger` | 20, 2σ | mid=SMA, position% | 동일 | ±4 | 구현 |
| MACD | `macd` | 12/26/9 | EMA차 + signal | 동일 | ±8/±3 | 구현 |
| Stochastic | `stochastic` | 14,3 | %K/%D | 동일 | ±4 | 구현 |
| Stoch Slow | `stochasticSlow` | 20,12,6 | 스펙터 시트 | 우물(K,D≤20) | +6/−4 | 구현 |
| ATR | `atr` | 14 | Wilder TR | 동일 | ATR%≥5 −2 | 구현 |
| 일목 | `ichimoku` | 9/26/52 | 구름 위치 | 표준 근사 | ±6 | 구현 |
| ADX | `adx` | 14 | Wilder | 동일 | ±5 | 구현 |
| OBV | `obv` | lookback 20 | 누적 거래량 추세 | 동일 | ±4 | 구현 |
| MFI | `mfi` | 14 | 거래량 가중 RSI | 동일 | ±4 | 구현 |
| SuperTrend | `supertrend` | 10,3 | ATR 밴드 | 동일 | ±4, 전환 ±3 | 구현 |
| EWO | `ewo` | 5−35 | 중간가 SMA차 | 동일 | ±2 | 구현 |
| Mayer | `mayerMultiple` | 200 | 종가/SMA200 | BTC식 전용 | +5/+2/−5 | 구현 |
| VixFix | `williamsVixFix` | 22 | 고점 대비 저가% | 동일 | +5 | 구현 |
| 미너비니 | `minervini` | ≥200봉 | 8조건 | 자체 구현 | +6/+3/−4 | 구현 |
| 다이버전스 | `divergence` | 피벗 | RSI/MACD/OBV/MFI | 자체 | ±8 | 구현 |
| 히트맵 | `stochHeatmap` | 다중 길이 | 바닥/고점 도배 | 자체 | ±6 | 구현 |
| 고통지수 | `painMeter` | 50 | 고점 대비 하락 + UO | 자체 | +5 | 구현 |
| BBP | `bullBearPower` | 50 | ATR 정규화 | 자체 | +4/−3 | 구현 |
| 피보 | `fibonacci` | 60 | 되돌림 | 점수 가산 없음 | 미반영 | 구현 |
| 지지저항 | `supportResistance` | 60 | 피벗 | ±4/−3 | 구현 |
| 캔들패턴 | `detectPatterns` | 최근봉 | 도지·망치 등 | 규칙 | ±5 | 구현 |
| 골든/데드 50/200 | `analyzeCandles` | 5봉 전 비교 | SMA50 vs 200 | 교차 판정 단순 | ±10/+3 | 구현 |
| 낙폭존 | drawdown | 252 | 고점 대비 % | 자체 | bottom +5 | 구현 |
| 52주 | week52 | 252 | 위치% | 동일 | 예측 피처만 | 구현 |

웹 전용 (`trading-platform.jsx`): 고고저, MA 눌림, 볼린저 수축, 거래량 돌파, RSI 반등, 박스 돌파, 삼각수렴, TD Sequential, 갭, 리더 낙폭. **서버 점수에 미포함**.

미구현 지표: ROC, Momentum, CCI(단독), 거래량 MA(별도 함수), 외국인/기관/프로그램/공매도/대차, 역사적 변동성, 베타, 손절/목표/손익비(규칙 점수에 없음), PSR, 부채비율, 배당수익률, 영업현금흐름, ROE.

PER/PBR: KIS 응답 필드 표시. 계산 함수 없음.

---

## 9. 예측 및 점수 계산 로직

### 9.1 기술 종합점수 — `analyzeCandles`

- 대상: 일봉이 있는 종목
- 기본 50, 0~100 clamp
- 등급: A≥80, B≥65, C≥50, D<50
- 배지 `signalBadge`: 점수≥70 또는 (RSI≤30이고 점수≥55) → 매수; 점수≤40 또는 (RSI≥70이고 점수≤55) → 매도; 그 외 중립
- 기간 구분: **없음** (현재 봉 스냅샷)

가중치(가산점)는 8장 표와 `analysis.js:812-993`과 동일하다. 별도 학습 가중치가 아니다.

### 9.2 AI 예측 — `predictor.js`

| 항목 | 값 |
|------|-----|
| 모델 | 온라인 로지스틱 회귀, `sigmoid(Σ w·x)` |
| 예측 대상 | 종가 상승 여부 (`final > entry` → UP) |
| 예측 기간 | 코드 `HORIZON_DAYS=7` = **LEGACY_7_CALENDAR_DAYS**. 신규 1·5·20·60거래일과 성과표를 섞지 말 것 |
| 상승 정의 | `probUp >= 0.5` → `UP` |
| 신뢰도 | \|p-0.5\|≥0.2 high, ≥0.1 medium, else low. 모델 검증 전 통계적 신뢰도로 표현 금지 |
| 학습률 | `0.05` |
| 재학습 | 부팅+6시간 `trainFromHistory`. 종목당 하루 1예측 기록 |
| 저장 | 로컬 JSON StoragePort. 2000건 slice **제거됨**. Render 디스크 휘발은 여전 |
| 현재 로그 id | 신규 UUID `predictionId`. 레거시 `{code}-{date}` 읽기 호환 |
| 현재 채점 | 단계 1: `targetTradingDate`의 확정 종가만. 없으면 `CALENDAR_PENDING`. 최신 종가 사용 금지 |

초기 가중치 (`DEFAULT_WEIGHTS`):

| 구분 | 지표 | 현재 가중치 | 적용 조건 | 코드 위치 |
|------|------|------------:|-----------|-----------|
| 절편 | bias | 0 | 항상 | `predictor.js:26` |
| 모멘텀 | rsi | -0.3 | 정규화 (RSI-50)/50 | `:27` |
| 모멘텀 | bbPos | -0.2 | (pos-50)/50 | `:28` |
| 이격 | dist20 | -0.25 | /10 clamp | `:29` |
| 이격 | dist60 | -0.2 | /20 clamp | `:30` |
| 거래량 | volRatio | 0.15 | ratio-1 | `:31` |
| 추세 | macdHist | 0.35 | 종가 대비 | `:32` |
| 추세 | macdCross | 0.4 | golden 1 / dead -1 | `:33` |
| 모멘텀 | stochK | -0.2 | (K-50)/50 | `:34` |
| 추세 | alignment | 0.35 | 정배열 신호 | `:35` |
| 추세 | aboveMa20 | 0.25 | 상단 1 / 하단 -1 | `:36` |
| 패턴 | patternScore | 0.3 | ±2 clamp | `:37` |
| 위치 | w52Pos | 0.1 | (pos-50)/50 | `:38` |
| 위치 | nearSupport | 0.25 | 거리≤3% | `:39` |
| 위치 | nearResistance | -0.25 | 거리≤3% | `:40` |
| 추세 | ichimokuCloud | 0.3 | above 1 / below -1 | `:41` |
| 추세 | adxTrend | 0.3 | 방향×ADX/40 | `:42` |
| 수급대리 | obvTrend | 0.25 | rising/falling | `:43` |
| 위험 | atrPct | -0.1 | ATR%/5 | `:44` |
| 추세 | supertrendDir | 0.35 | up/down | `:45` |
| 모멘텀 | stochSlowWell | 0.3 | inWell | `:46` |
| 변동 | vixFixSpike | 0.25 | spike | `:47` |
| 수급대리 | mfiNorm | -0.2 | (MFI-50)/50 | `:48` |
| 가치대리 | mayerDev | -0.2 | multiple-1 | `:49` |
| 추세 | minerviniScore | 0.3 | (passed-4)/4 | `:50` |
| 모멘텀 | divergenceSig | 0.45 | bull/bear | `:51` |
| 모멘텀 | heatmapPaint | 0.3 | bottom/top | `:52` |
| 모멘텀 | painBottomDiv | 0.3 | bullDiv | `:53` |
| 위치 | bbpZone | 0.25 | bottom/top | `:54` |

학습이 쌓이면 파일 가중치가 바뀐다. Render 재배포 시 초기값으로 돌아간다.

결합 배지 (`predict`): 점수≤45 & p≥0.62 → 반등 매수 후보; 점수≥75 & p≤0.42 → 과열 조정 주의 등.

목표가격·손절가격: **예측 모듈에 없음**. Gemini 프롬프트가 서술적으로 요청할 뿐 계산 필드가 아니다. Spark 출력은 `targetRange` 배열 대신 `targetPriceLow`/`targetPriceHigh`(number 또는 null)를 쓴다.

### 9.3 펀더멘털 점수 — `dart-fund.js`

기본 50. 연매출 YoY>0 +10 / ≤0 −5. 영업이익 YoY>0 +15 / ≤0 −10. 이익률 개선 +10. 최근분기 흑자 +5, YoY>0 +10. 등급 A≥75, B≥60, C≥45, D.

### 9.4 웹 통합점수 — `scoreIntegratedCandidate`

```text
total ≈ value×0.30 + sector×0.22 + momentum×0.18 + rsi×0.15 + technical×0.15
        - overheat + news + learningAdj
```

일부 RSI는 등락률로 **추정** (`estimateStockRsi`). 서버 `analyzeCandles`와 다른 축이다.

웹 `WEIGHTS` 상수(거래량 1.31, 20일선 1.22, 고고저 1.18, NPS 1.15)는 **AI 프롬프트용 정적 값**이며 서버 학습 가중치가 아니다.

### 9.5 기간별 구분 (확정)

신규 예측·평가는 **한국거래소 영업일** 기준 네 가지만 사용한다. 범위(1~2일 등)로 쓰지 않는다.

| horizon | 거래일 | 용도 | 현재 코드 |
|---------|-------:|------|-----------|
| `ULTRA_SHORT` | 1 | 다음 거래일 | **미구현** |
| `SHORT` | 5 | 약 1주 | 단계 1: opts로 SHORT+5거래일 target 계산 가능. 기본 export는 LEGACY |
| `MEDIUM` | 20 | 약 1개월 | **미구현** |
| `LONG` | 60 | 약 3개월 | **미구현** |
| `LEGACY_7_CALENDAR_DAYS` | 달력 7일 | 기존 `HORIZON_DAYS` | **구현됨**. 5거래일 성과표에 섞지 말 것 |

`targetTradingDate`는 날짜 덧셈이 아니라 KRX 영업일 달력으로 `baseTradingDate`에서 `horizonTradingDays`만큼 진행한 날이다. 예: 2026-08-14 + 5거래일 = **2026-08-24**(8/17 대체공휴일 반영). `lib/calendar/krx-calendar.js`가 목록 기반으로 계산한다. 목록에 없으면 임의 계산하지 말고 `targetTradingDate=null`, `evaluationStatus=CALENDAR_PENDING`, `missingData=["krxTradingCalendar"]`를 쓴다.

레거시 `LEGACY_7_CALENDAR_DAYS`: nominal = base + 7 달력일. 거래일이면 그대로, 아니면 이후 첫 거래일, 없으면 `CALENDAR_PENDING`. 예: 2026-08-14→2026-08-21, 2026-08-10→2026-08-18(대체공휴일), 2026-08-15(토)→2026-08-24, 2026-08-16(일)→2026-08-24, 2026-12-24→2027-01-04. 5거래일 08-24와 섞지 말 것.

날짜 검증 코드: `INVALID_BASE_TRADING_DATE`(base > dataAsOf KST 날짜), `INVALID_TARGET_TRADING_DATE`(target≤base, 채점 안 함), `INVALID_HORIZON`, `INVALID_DATE_FORMAT`, `CANDLE_NOT_FINAL`, `CALENDAR_PENDING`, `STORE_BUSY`. 저장/채점은 차단하고 확률 응답은 유지.

### 9.6 평가 로그 (단계 1 구현)

신규 기본키: UUID `predictionId` (`id`에도 동일 UUID). 레거시 `{code}-{date}`는 `getPrediction`으로 읽기 가능. 중복키 6필드: `symbol, baseTradingDate, horizonType, horizonTradingDays, modelVersion, featureVersion`. fallback: symbol←code, baseTradingDate←date, horizonType←LEGACY, horizonTradingDays 없으면 null, model/feature version 없으면 `unspecified`. `unspecified` ≠ `predictor-legacy-v1` 이므로 구 로그를 덮어쓰지 않는다. 테스트 픽스처 `test/fixtures/krx-calendar.js`는 운영 캘린더가 아니다.

필수 필드: `predictionId`, `symbol`, `createdAt`, `baseTradingDate`, `baseClose`, `horizonType`, `horizonTradingDays`, `targetTradingDate`, `predictedDirection`, `upProbability`(0~1), `modelVersion`(`predictor-legacy-v1`), `featureVersion`(`features-v1`), `dataAsOf`, `targetClose`, `actualReturnPct`, `actualDirection`, `evaluationStatus`, `evaluatedAt`. 복구 필드: `priceEvaluatedAt`, `modelUpdateStatus`, `modelUpdatedAt`, `evaluationOperationId`.

레거시 호환 필드 유지: `id`, `code`, `date`, `entryPrice`, `features`, `probUp`(0~1), `status`.

`processMatured`: 평가 실행일의 최신 종가가 아니라 `targetTradingDate`의 확정 종가(`targetClose`)만 사용한다. 미확정 봉 금지. `resolved`/`EVALUATED` skip. `PRICE_EVALUATED`/`MODEL_UPDATE_PENDING`은 가격 재계산 없이 모델만 재시도. 가격 성공 시 먼저 예측을 `MODEL_UPDATE_PENDING`으로 커밋한 뒤 `saveModel`. 모델의 `appliedEvaluations: [{ predictionId, operationId }]`로 중복 SGD 방지. `saveModel` 실패 시 예측은 `MODEL_UPDATE_PENDING` 유지. 모델 성공 후 EVALUATED 커밋 실패 시 다음 실행에서 SGD 없이 EVALUATED. `commitMaturedBatch`는 processMatured에서 사용하지 않음. 동시 processMatured는 mutex+재조회로 wins 1번.

로컬 JSON 락 (`TEMPORARY_STAGE1_POLICY`): `{pid, createdAt, operationId}`. 산 PID/오래된 잘못된 JSON만 복구. 살아 있는 PID는 stale이어도 삭제 금지. retry 5ms, maxWait 30ms, 초과 `STORE_BUSY`. API 확률 유지, 해당 요청 로그 생략, 다음 동일 요청에서 재저장 가능. 주문과 무관. `Atomics.wait`는 주 스레드 최대 약 30ms 차단 가능. 이번 단계 비동기 락/외부 저장소 확장 없음. 향후 Postgres 또는 비동기 저장 큐 교체 대상. 복구 로그는 `{event:"stale-lock-recovered", pid, operationId, createdAt}` 한 줄(파일 내용 금지).

아카이브(`lib/storage/archive.js`)는 기본 `enabled:false`. EVALUATED만 이동. PENDING/CALENDAR_PENDING/MODEL_UPDATE_PENDING/PRICE_EVALUATED 금지. predictor 자동 실행 없음. Postgres 미연결. 주문 3중 차단 유지.

---

## 10. 백테스트와 검증 구조

| 구분 | 존재 | 내용 |
|------|------|------|
| 학습용 walk-forward | 있음 | `trainFromHistory`: step=5, minHistory=80, 종목당 최대 30샘플, **달력 7일**. 레거시. 5거래일 결과와 혼용 금지 |
| 진화 백테스트 | 있음 | `evolve.js` POP=40, GEN=30, horizon=7(달력), step=4. 레거시 |
| 시그널 채점 | 있음 | `simulation.js` 기본 horizon 5일. 승=pnl≥0 |
| 웹 백테스트 화면 | UI만 | 고정 예시. `/api/history/:code` **미구현** |
| 거래비용·세금·슬리피지 | 없음 | |
| 벤치마크 | 없음 | |
| 포지션 크기 | 없음 | |
| 손절·익절 엔진 | 없음 | |

성과지표:

| 지표 | 구현 |
|------|------|
| 승률 | `getModelStats`, `computeStats.winRate` |
| 누적/연환산 수익률 | 미구현 |
| 평균수익·손실·손익비·PF | 미구현 (평균 pnl%만 simulation) |
| MDD·샤프·소르티노 | 미구현 |
| 연속 손실 | 미구현 |
| 국면별·종목별 분해 | 미구현 |
| 확률 보정 (calibration) | 미구현 |

오류 가능성:

- (단계 1에서 수정) `processMatured`는 `targetTradingDate`의 `targetClose`만 사용. 평가일 최신 종가 대체 금지
- 예측 피처에 `dataAsOf` 이후 정보를 쓰면 누출. 성과평가에 `targetTradingDate` 종가를 쓰는 것은 정상
- 생존편향: 현재 마스터 종목만 학습 유니버스
- 수정주가: `adjustmentStatus: "UNKNOWN"`
- 거래비용 미반영
- 웹 통합점수의 추정 RSI는 미래정보가 아니라 **부정확한 대리변수**
- 학습과 검증 분리 없음 (온라인 SGD)
- 레거시 달력 7일 로그를 1·5·20·60거래일 성과표에 합산하면 오염

백테스트 성과와 실전 성과를 같은 숫자로 말하지 말 것.

---

## 11. 현재 문제점과 제한사항

1. 분석 데이터와 KB 조회 데이터가 분리되어 있다.
2. IVU10140은 장 마감 후 `dataHeader`만 관측됨. 정규장 비교 전 파서 수정 금지.
3. 예측 horizon이 달력 7일(`LEGACY_7_CALENDAR_DAYS`) 하나다. 1·5·20·60거래일은 미구현.
4. ~~예측 로그 id가 `{code}-{date}`라 기간·모델 추가 시 충돌한다.~~ **단계 1에서 수정됨**: UUID + 6필드 중복키. `unspecified` fallback으로 구 로그 보존.
5. ~~`processMatured`가 `targetTradingDate` 종가가 아니라 평가일 최신 종가를 쓴다.~~ **단계 1에서 수정됨**: `targetTradingDate`의 확정 종가만 사용. 없으면 `CALENDAR_PENDING`. 최신 종가 채점 금지.
6. 외인·기관 수급 실데이터가 없다.
7. RSI 메인 계산이 Wilder가 아니다.
8. Render 무료 디스크 재배포 시 모델·예측 로그가 사라질 수 있다. 2000건 slice는 단계 1에서 제거. 로컬 JSON만 사용. Postgres 미연결.
9. 웹 백테스트는 예시 UI다.
10. Firebase 모듈은 연결되어 있지 않다.
11. 고고저는 웹에만 있다.
12. Gemini는 해설만 하며 숫자를 계산하지 않는다.
13. 상승확률을 확정 예측으로 쓰면 안 된다. `confidence`는 \|p-0.5\|이지 통계적 신뢰도가 아니다.
14. 주문·자동매매는 꺼져 있어야 한다.

---

## 12. Spark에 제공 가능한 정보

- 종목 마스터: `code`, `name`, `market`, `sector` (공개 상장 정보)
- KIS 기반 일봉 OHLCV와 정규화 피처를 함께 제공 가능. `featureFormulaVersion` 필수
- 당일 봉은 `dataAsOf`, `isFinal`, `marketSession` 포함. 장중은 `isFinal=false`
- `analyzeCandles` 결과 (점수, 신호, 지표 값 — **운영 로그에 값 덤프 금지**와 별개로, Spark용 정제 JSON은 승인 후)
- `predict` 결과: 레거시 달력 7일 확률. 신규 기간과 혼용 금지
- DART 실적 점수 (단위 억원)
- 섹터 트렌드, 매크로 mood (`risk_on`/`risk_off`/`mixed`)
- 모델 통계: trained, wins, losses, accuracy
- 본 문서 4종

제공 시에도 계좌·주문·토큰은 제외한다.

---

## 13. Spark에 제공하면 안 되는 정보

- `KBSEC_APP_KEY`, `KBSEC_APP_SECRET`, `KIS_APP_KEY`, `KIS_APP_SECRET`
- `GEMINI_API_KEY`, `DART_API_KEY`, `APP_API_KEY`, `ALERT_CHECK_SECRET`
- `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`
- 세션 쿠키, Authorization, access_token
- 계좌번호, 잔고 원문, 주문 원문
- `.env` 실제 값
- APNs 키, App Store Connect 키
- 사용자 개인정보, 푸시 토큰 원문
- KB/KIS 요청·응답 Body 전체
- 종목명·현재가 운영 로그 원문 (진단 로그 규칙)

상세: `docs/GEMINI_SPARK_SECURITY_CHECKLIST.md`

---

## 14. 조회 전용 데이터 명세

구현하지 말고 인터페이스만 정의한다. 상세 JSON은 `GEMINI_SPARK_DATA_SCHEMA.md`.

권장 원칙:

- 읽기 전용
- 예측 **피처**에는 `dataAsOf` 이후 정보를 쓰지 않음
- 성과평가에는 예측 당시 확정한 `targetTradingDate`의 종가만 사용. 평가 실행일의 최신 종가로 대체하지 않음
- 당일 일봉은 정규장 종료 후 종가 확정 시에만 `isFinal=true`. 장중은 `isFinal=false`. 15:40 `TIME_HEURISTIC`은 시각 판정이며 KIS 공식 종가 확정이 아님
- 확률 단위를 명시 (Spark `upProbability`는 0~1, 앱 응답 `probUp`은 %)
- `riskScore`는 0~100, **높을수록 위험**
- 목표가: `targetPriceLow`, `targetPriceHigh` (number 또는 null). `targetRange` 배열 사용 금지
- `missingData` 배열로 결측 표시
- 주문 필드 없음

---

## 15. Spark 연동 권장안

| 방식 | 장점 | 단점 | 보안 위험 | 난이도 | 실시간성 | 추천 |
|------|------|------|-----------|-------:|--------:|------|
| 읽기 전용 REST | 앱과 동일 출처, 권한 분리 가능 | 개발 필요, rate limit | 중간 (키 유출 시 조회만) | 중 | 높음 | 2단계 추천 |
| 정제 CSV/JSON 파일 | 구현 빠름, 주문과 분리 | 수동 갱신 | 낮음 (값 포함 시 주의) | 낮 | 낮음 | **1단계 추천** |
| Google Sheets | 사람이 보기 쉬움 | 권한·유출 | 중 | 낮 | 낮음 | 보조 |
| Google Drive | 대용량 | 접근제어 | 중 | 낮 | 낮음 | 비추천 |
| MCP 서버 | Spark 직접 도구화 | 공격면 증가 | 중~높 | 높 | 중 | 보류 |
| DB 읽기 전용 | 없음 (DB 없음) | — | — | — | — | 해당 없음 |
| 정기 보고서 | 장 종료 보고 목표와 맞음 | 자동화 미구현 | 낮 | 중 | 일 1회 | 2단계 추천 |
| Git 문서/코드 | 이미 가능 | 비밀 커밋 위험 | 낮 (문서만) | 낮 | 없음 | **문서 단계 추천** |

최종 권장:

1. **지금:** Git 문서 + 승인된 샘플 JSON (시세 값 최소화, 스키마 중심)
2. **다음:** 장 종료 후 정제 JSON 스냅샷 (`data/spark/` 같은 별도 경로, 미구현)
3. **이후:** `/api/spark/*` 읽기 전용, 앱키·종목 화이트리스트·주문 경로 차단
4. KB/KIS 원본 자격증명은 Spark에 주지 않음
5. 분석 결과는 운영 로직과 분리된 파일/테이블에만 저장

---

## 16. 단계별 개선 계획

상세는 `docs/GEMINI_SPARK_DEVELOPMENT_ROADMAP.md`.

| 단계 | 내용 | 담당 |
|------|------|------|
| 0 | 문서·스키마 확정 | 사용자 |
| 1 | 예측 로그 식별키·`targetTradingDate`·`processMatured`·로컬 StoragePort | 앱 (**완료**) |
| 2 | (원래 processMatured) 단계 1에 포함 | 앱 (**완료**) |
| 3 | 예측 로그 외부 영속화 (Postgres 후보). 로컬 JSON은 단계 1 완료 | 앱 |
| 4 | 읽기 전용 스냅샷 (`isFinal`/`dataAsOf`) | 앱 |
| 5 | 1·5·20·60거래일 분석 구조 | Spark 제안 / 앱 |
| 6 | 기간별 확률 모델 | 앱 + Spark |
| 7 | 백테스트·확률 보정 | 앱 + Spark |
| 8 | Spark 자동 연동 | 앱 |

오류가 있는 평가 로그를 더 쌓은 뒤 기간별 모델을 확장하면 학습·검증이 오염된다. 2·3이 5·6보다 앞선다.

---

## 17. 개발 우선순위

요구 기준 순서 + 현재 상태:

| 우선순위 | 개선 항목 | 현재 상태 | 필요 데이터 | 개발 내용 | 난이도 | 예상 효과 | 선행 조건 |
|--------:|-----------|-----------|-------------|-----------|-------:|-----------|-----------|
| 1 | 스키마·식별키 | **단계 1 완료** UUID | — | UUID + 평가 필드 | 낮 | 로그 충돌 방지 | 문서 승인 |
| 2 | `processMatured` 수정 | **단계 1 완료** targetClose | 영업일 달력 | `targetClose`만 사용 | 중 | 평가 오염 방지 | 1 |
| 3 | 로그 영속화 | 로컬 JSON 완료. Render 휘발·Postgres 미연결 | 외부 스토리지 | Postgres 등 | 중 | 사후검증 | 1~2 |
| 4 | 읽기 전용 스냅샷 | 없음 | 일봉 | `dataAsOf`/`isFinal` | 중 | Spark 입력 | 3 |
| 5 | 1·5·20·60 분석 구조 | 미구현 | 확정 일봉 | horizon 필드 | 중 | 기간 분리 | 2~4 |
| 6 | 시장 국면 분류 | mood만 | 지수·변동성 | regime | 중 | 국면 해석 | 4 |
| 7 | 추세·모멘텀·거래량 점수 | 가산 혼재 | 기존 지표 | 축 분리 | 중 | 설명 가능 | 기존 점수 유지 |
| 8 | ATR 손절·손익비 | ATR%만 | ATR | 표시 필드 | 낮 | 리스크 | 주문 금지 |
| 9 | 업종 상대강도 | 일부 | 섹터 수익률 | RS | 중 | 상대 평가 | 유니버스 |
| 10 | 외인·기관 수급 | 미구현 | 수급 API | 연동 또는 보류 | 높 | 수급 | **사용자 승인** |
| 11 | 공시·뉴스 | RSS+DART | 본문 | NLP는 Spark | 중 | 이벤트 | 본문 승인 |
| 12 | 기간별 확률 모델 | 레거시 7일만 | 정리된 로그 | 1/5/20/60 | 높 | 예측 확장 | 2~5 |
| 13 | 확률 보정·백테스트 | 미구현 | 영속 로그 | reliability+비용 | 높 | 검증 | 3, 12 |
| 14 | Spark 자동 연동 | 문서만 | 스냅샷 | REST/파일 | 중 | 자동화 | 보안 체크리스트 |

그룹:

- **Spark:** 국면 해석, 1·5·20·60 분석안, 확률 해석, 장 종료 보고, 개선안
- **앱:** 식별키·`processMatured`·로컬 저장은 단계 1 완료. Postgres 영속화·스냅샷을 **기간별 모델보다 먼저**
- **사용자 승인:** 수급 연동, KB 파서 수정, 정규장 재호출, 주문 관련 일체, 비밀정보

---

## 17.1 향후 실행·전략 구조 (이번 단계 미구현)

단계 1은 예측 로그·채점·로컬 저장만 다룬다. 전략 엔진은 구현하지 않았다.

- **Paper:** Strategy → OrderIntent → Risk Engine → Paper Broker (실거래 승인 불필요)
- **Live:** Strategy → OrderIntent → Risk Engine → User Approval → Live Broker
- `executionAllowed`를 전략이 바꾸는 권한값으로 쓰지 않음
- 향후 분리: `OrderIntent`, `RiskDecision`, `UserApproval`, `ExecutionRecord`
- 향후 전략 해시: Canonical JSON (키 정렬, UTF-8, 숫자 표현 통일, null·빈 배열 규칙, 표시용 필드 포함 여부 확정)
- 웹 메뉴는 향후 투자운영 하위. iOS 메뉴는 향후 더보기
- 로컬 포트폴리오 ≠ 가상거래 계좌 (합치지 않음)
- 백테스트 API 향후 `/api/strategy/backtest`
- 전략 자동 승격 금지
- 신규 환경변수·자격증명 없음. 기존 KB 조회와 `/api/trading/*` 변경 없음

## 18. 확인이 필요한 질문

1. 실제 OHLCV와 정규화 피처를 함께 제공하되 `featureFormulaVersion`을 기록한다. 값 제공 범위(전 종목 vs 화이트리스트)만 확인할 것.
2. 수급 실데이터를 KIS/KB/다른 소스로 살 계획이 있는가?
3. 예측 로그를 Render 디스크 대신 어디에 보존할 것인가?
4. 웹 고고저를 서버 `analyzeCandles`에 넣을 것인가?
5. Gemini 해설과 Spark 분석을 병행할 것인가, Spark로 대체할 것인가?
6. 정규장 IVU10140 1회 비교를 언제 승인할 것인가?
7. 저평가 스크리너의 추정 RSI를 유지할 것인가?

---

## 19. Spark 전달용 최종 요약문

아래는 Spark가 다른 문서 없이 읽어도 되는 독립 지시문이다.

---

### Spark 작업 지시문 (프로젝트 실측 기준)

너는 ALPHA TRADING SYSTEM의 분석 보조다. 앱 목적은 한국 주식 종목의 조회·기술분석·해설이며, **주문을 실행하지 않는다.**

**현재 앱이 하는 일**

- KIS 일봉으로 `analysis.js` `analyzeCandles()`가 규칙 점수 0~100과 등급 A~D를 만든다. 기본 50점에서 정배열·이격·RSI·MACD·스토캐·일목·ADX·OBV·ATR·미너비니·다이버전스 등을 가감한다.
- `predictor.js`는 같은 분석 결과로 로지스틱 회귀 상승확률을 낸다. 현재 horizon은 **LEGACY_7_CALENDAR_DAYS**(달력 7일)다. 신규 표준은 1·5·20·60**거래일**이며 레거시와 성과표를 섞지 마라. `probUp>=0.5`면 UP. `confidence`는 \|p-0.5\| 구간이며 통계적 신뢰도가 아니다.
- Gemini(`POST /api/ai/analyze`)는 텍스트 해설만 한다. 차트 숫자와 확률을 Gemini가 계산하지 않는다.
- KB증권 API는 관리자 조회 전용이다. 분석 입력으로 쓰지 마라. 주문 함수는 차단되어 있다.
- 외인·기관·프로그램·공매도 실데이터는 없다. 웹 화면에 보이는 수급은 등락률 추정일 수 있다.
- 1·5·20·60거래일 예측은 **없다.** 기존 달력 7일만 있다.

**사용 중인 데이터**

- 종목 마스터: `data/krx-master-merged.json` (`code`, `name`, `market`, `sector`)
- 가격: KIS OHLCV 일봉
- 실적: DART 매출·영업이익(억원)과 `fundamentalScore`
- 뉴스: RSS 제목 + 키워드
- 거시: FRED 기반 `mood`
- 예측 로그: `data/ai-predictions.json` (로컬 StoragePort, 2000건 slice 제거, Render 디스크 휘발은 여전)

**기존 점수와 예측**

- 기술점수와 레거시 달력 7일 확률은 다른 축이다. 고점수+하락확률은 코드가 의도한 평균회귀 해석이다. 모순으로 지우지 마라.
- 메인 RSI는 14봉 단순평균이라 Wilder RSI와 다를 수 있다.
- 웹 `WEIGHTS`(1.31 등)는 프롬프트용 상수다. 서버 학습 가중치가 아니다.
- 단계 1 이후 `processMatured`는 `targetTradingDate`의 확정 종가(`targetClose`)만 사용한다. 목표일이 없거나 캘린더 미확정이면 `CALENDAR_PENDING`이며 최신 종가로 채점하지 않는다. 레거시 달력 7일 로그를 5거래일 성과로 쓰지 마라.

**Spark가 할 일**

1. 제공된 조회 전용 데이터만으로 종목의 상승·하락 **가능성**을 기간별로 논하라. 기간은 `ULTRA_SHORT`(1거래일), `SHORT`(5), `MEDIUM`(20), `LONG`(60)만 사용하라. 데이터가 없으면 `missingData`로 표시하고 지어내지 마라. 레거시 달력 7일은 `LEGACY_7_CALENDAR_DAYS`로만 인용하라.
2. 기술·수급·국면·재무·뉴스 축을 나눠 점수를 제안하라. 수급 실데이터가 없으면 수급 점수는 null이고 이유를 적어라.
3. 결과는 확정 매수 지시가 아니라 확률·조건·무효화 조건이다.
4. 백테스트 조건을 제안할 때 거래비용·생존편향·수정주가 미확인·미래정보 누출을 빠짐없이 적어라.
5. 예측 **피처**에는 `dataAsOf` 이후 정보를 쓰지 마라. 성과평가에는 예측 당시 확정한 `targetTradingDate`의 종가(`targetClose`)를 쓰는 것이 정상이다. 평가 실행일의 최신 종가로 대체하지 마라.
6. 장 종료 보고는 정규장 데이터가 있을 때만 한다. 당일 일봉은 `isFinal`과 `marketSession`을 본다. 장중 미완성 봉(`isFinal=false`)을 확정 종가로 쓰지 마라. 장 마감 후 KB `dataHeader`만 있는 상태를 정상 시세로 해석하지 마라.

**결과 출력 형식 (최소)**

```json
{
  "symbol": "005930",
  "dataAsOf": "2026-08-14T15:40:00+09:00",
  "baseTradingDate": "2026-08-14",
  "horizon": "SHORT",
  "horizonTradingDays": 5,
  "upProbability": null,
  "downProbability": null,
  "confidence": "LOW",
  "confidenceNote": "|p-0.5| 구간. 통계적 신뢰도 아님",
  "technicalScore": null,
  "supplyDemandScore": null,
  "marketScore": null,
  "fundamentalScore": null,
  "newsScore": null,
  "riskScore": null,
  "riskScoreDirection": "HIGHER_IS_RISKIER",
  "totalScore": null,
  "marketRegime": "UNKNOWN",
  "status": "NEUTRAL",
  "positiveSignals": [],
  "negativeSignals": [],
  "entryCondition": "",
  "invalidationCondition": "",
  "targetPriceLow": null,
  "targetPriceHigh": null,
  "riskRewardRatio": null,
  "featureFormulaVersion": "features-v1",
  "modelVersion": null,
  "missingData": [],
  "disclaimer": "확률은 추정치이며 확정 예측이 아니다."
}
```

- `upProbability`/`downProbability`: **0~1**. 앱 응답 %와 혼동하지 말 것
- `riskScore`: 0~100, **높을수록 위험** (`HIGHER_IS_RISKIER`). 미계산이면 null
- `targetPriceLow`/`targetPriceHigh`: number 또는 null. 배열 `targetRange` 사용 금지
- 숫자는 제공된 데이터에서만 계산한다. 없으면 null + `missingData`

**금지**

- 실제 주문, 주문 정정·취소, 이체
- KB/KIS 자격증명·토큰·계좌 취급
- 코드 임의 수정. 수정이 필요하면 파일·이유·위험을 적고 **승인 후**에만
- 확인되지 않은 지표를 구현된 것처럼 인용
- 예측 피처에 `dataAsOf` 이후 정보 사용
- 성과평가에서 평가일 최신 종가로 `targetClose` 대체
- 레거시 달력 7일 결과를 5거래일 성과표에 합산

**개선안 제출 순서**

1. 데이터 결측과 한계
2. 기존 점수/예측과의 차이
3. 제안 공식 (입력·기간·단위)
4. 검증 방법 (누출·비용·생존편향)
5. 앱이 구현할 일 / Spark가 반복할 일 / 사용자 승인 항목

이 지시문과 코드가 충돌하면 **코드를 우선**하고, 문서를 고치라고 요청하라.
