# Gemini Spark — 데이터 스키마

- 기준일: 2026-08-14
- 단계 1 구현 완료 (6필드 식별키·KST·레거시 +7 다음 거래일·검증 코드·락 복구·MODEL_UPDATE_PENDING·아카이브 기본 비활성)
- 실제 시세·계좌·토큰 값 없음. 예시는 스키마용 더미
- Postgres/Firestore 연결 없음. 신규 환경변수 없음

---

## 1. 데이터 출처

| 출처 | 유형 | 모듈 | Spark 제공 | 비고 |
|------|------|------|------------|------|
| KIS Open API | 외부 API | `server.js` `kisGet` | 승인 후 정제본 | 분석 주력 |
| KB Open API | 외부 API | `kb/broker.js` | 기본 제외 | 계좌·현재가 조회. 분석 미연동 |
| DART | 공공 API | `dart.js`, `dart-fund.js` | 승인 후 집계값 | 실적 억원 |
| KRX 마스터 | JSON 파일 | `data/krx-master-merged.json` | 가능 (공개 정보) | 종목 유니버스 |
| KOSDAQ 코드 | JSON | `data/kosdaq-codes.json` | 가능 | 코드 배열 |
| Yahoo Finance | 외부 API | `server.js` global | 해외/크립토만 | |
| FRED | 공공 CSV | `macro.js` | 집계 mood | 키 불필요 |
| RSS | 외부 피드 | `crypto-report.js` | 제목·출처만 | 본문 없음 |
| Gemini | 생성 AI | `POST /api/ai/analyze` | 제외 | 해설. 원 프롬프트에 비밀 넣지 말 것 |
| 계산 결과 | 메모리/파일 | `analysis.js`, `predictor.js` | 승인 후 | |
| 사용자 입력 | 파일 | `alerts.json`, `watchlist.json` | 개인식별 제외 | |
| Firebase | Firestore | `firebase-config.js` | 해당 없음 | **앱이 import하지 않음** |

---

## 2. 테이블 및 파일 구조

DB 테이블은 없다. Postgres는 1순위 후보이나 연결하지 않는다. 단계 1 예측/모델 I/O는 로컬 StoragePort (`lib/storage/memory-store.js`, `lib/storage/json-file-store.js`)다. JSON 저장소는 원자적 교체·파일 락(`TEMPORARY_STAGE1_POLICY`: `pid/createdAt/operationId`, 죽은 PID만 복구, 살아 있는 PID는 stale이어도 삭제 금지, retry 5ms·maxWait 30ms 후 `STORE_BUSY`. API 확률 유지, 해당 요청 로그 생략, 다음 동일 요청에서 재저장 가능. 주문과 무관. `Atomics.wait`는 주 스레드 최대 약 30ms 차단 가능. 이번 단계 비동기 락/외부 저장소 확장 없음. 향후 Postgres 또는 비동기 저장 큐 교체 대상)·손상 JSON 거부(빈 배열로 덮어쓰지 않음)·`.bak` 복구를 한다. 아카이브는 기본 비활성. `test/fixtures/krx-calendar.js`는 테스트 픽스처이며 운영 캘린더가 아니다.

| 데이터셋 | 저장 위치 | 기본키 | 주요 필드 | 갱신 주기 | 보존 기간 | Spark 제공 |
|----------|-----------|--------|-----------|-----------|-----------|------------|
| KRX 마스터 | `data/krx-master-merged.json` | `code` | `name`, `tag`, `sector`, `market`, `indexes`, `industry` | `scripts/update-krx-master.mjs` 수동 | 파일 유지 | 가능 |
| KOSDAQ 코드 | `data/kosdaq-codes.json` | 배열 원소 | 6자리 코드 | 수동 | 파일 유지 | 가능 |
| 서버 내장 폴백 | `server.js` `KRX_MASTER_DB` | `code` | 큐레이션 소수 종목 | 코드 변경 시 | 코드와 동일 | 불필요 |
| DART corp | `data/corp-codes.json` | 종목/corp | corp_code 매핑 | 약 7일 캐시 | 런타임 | 코드만 가능, 대량 덤프 비권장 |
| 관심종목 | `data/watchlist.json` | code | 실적 감시 목록 | 사용자 POST | 디스크 휘발 가능 | 코드만 |
| 실적 중복방지 | `data/earnings-seen.json` | 공시 id | 본 공시 | 감시 루프 | 휘발 가능 | 제외 |
| AI 모델 | `data/ai-model.json` | 단일 객체 | `weights`, `trained`, `wins`, `losses` | 학습 시 | 휘발 가능 | 가중치 키만. 운영 원본 복사 주의 |
| 예측 로그 | `data/ai-predictions.json` (로컬 StoragePort) | 신규 UUID `predictionId`. 레거시 `{code}-{date}` 읽기 호환 | 아래 3.5/4.4 평가 필드 | 예측 시. 2000건 slice **제거됨** | Render 디스크 휘발은 여전. Postgres 미연결 | 승인 후 집계. 레거시와 신규 분리 |
| 진화 상태 | `data/evolve.json` | 단일 | population | 6시간 | 휘발 가능 | 규칙 설명만 |
| 가격 알림 | `alerts.json` 또는 `ALERTS_FILE` | id | 조건, 종목 | CRUD | 휘발 가능 | 제외 (사용자 설정) |
| APNs 토큰 | `data/push-tokens.json` | device | 토큰 | 등록 시 | 휘발 가능 | **금지** |
| KB 픽스처 | `test/fixtures/kb-samples.js` | — | 테스트용 더미 | 고정 | 테스트 | 구조만. 운영 응답 아님 |

Render 무료 플랜은 재배포 시 런타임 JSON이 사라질 수 있다.

---

## 3. 필드 사전

### 3.1 종목 마스터

| 필드명 | 한글명 | 자료형 | 단위 | 설명 | Null 가능 | 예시 |
|--------|--------|--------|------|------|-----------|------|
| code | 종목코드 | string | — | 6자리 | 아니오 | `"005930"` |
| name | 종목명 | string | — | 한글명 | 아니오 | `"예시종목"` |
| tag | 태그 | string | — | 짧은 업종 태그 | 가능 | `"반도체"` |
| sector | 섹터 | string | — | 분류 | 가능 | `"반도체"` |
| market | 시장 | string | — | KOSPI/KOSDAQ 등 | 가능 | `"KOSPI"` |
| indexes | 지수편입 | string[] | — | 예: KOSPI200 | 가능 | `["KOSPI200"]` |
| industry | 산업 | string | — | 마스터 산업명 | 가능 | `"반도체"` |

### 3.2 KIS 일봉 (분석 입력, 코드가 기대하는 형태)

| 필드명 | 한글명 | 자료형 | 단위 | 설명 | Null 가능 | 예시 |
|--------|--------|--------|------|------|-----------|------|
| date / tradingDate | 일자 | string | — | YYYY-MM-DD 권장 | 아니오 | `"2026-08-13"` |
| open | 시가 | number \| null | 원 | 결측은 null. 0은 실제 0과 구분 불가 | 가능 | `null` |
| high | 고가 | number \| null | 원 | 동일 | 가능 | `null` |
| low | 저가 | number \| null | 원 | 동일 | 가능 | `null` |
| close | 종가 | number \| null | 원 | `analyzeCandles`는 유한 숫자 필요 | 가능 | `null` |
| volume | 거래량 | number \| null | 주 | | 가능 | `null` |
| dataAsOf | 데이터 시점 | string | — | ISO8601+KST | 아니오 | `"2026-08-14T15:40:00+09:00"` |
| isFinal | 확정 여부 | boolean | — | 정규장 종료 후 종가 확정 시 true | 아니오 | `true` |
| marketSession | 장 세션 | string | — | `PRE`/`OPEN`/`CLOSED` | 아니오 | `"CLOSED"` |
| candleFinality | 봉 확정 상태 | string | — | 호환 확장. `FINAL`/`NOT_FINAL`/`UNKNOWN`. candle-meta는 opts 최상위 | 가능 | `"FINAL"` |
| finalitySource | 확정 출처 | string | — | 호환 확장. `TIME_HEURISTIC`(시각 판정, KIS 공식 아님)/`HISTORICAL_DATE`/`EXPLICIT_FINAL_FLAG`/`UNKNOWN` | 가능 | `"HISTORICAL_DATE"` |
| candleTradingDate | 봉 거래일 | string | — | 호환 확장. YYYY-MM-DD | 가능 | `"2026-08-13"` |
| adjustmentStatus | 수정주가 | string | — | `ADJUSTED`/`UNADJUSTED`/`UNKNOWN` | 아니오 | `"UNKNOWN"` |
| featureFormulaVersion | 피처 공식 버전 | string | — | 정규화 피처와 함께 제공 | 가능 | `"features-v1"` |

장중 당일 봉: `isFinal=false`. 예측 피처에 넣을지는 `dataAsOf`와 세션으로 판단한다. `UNKNOWN`·`NOT_FINAL`은 예측 로그·학습 대상에서 제외(현재 로그 미저장). 과거 확정봉(`HISTORICAL_DATE`)은 허용. 현재 SGD/`trainFromHistory`는 변경 없음. 이후 품질 점검은 `finalitySource`별 성과 분리.

### 3.3 `analyzeCandles` 주요 출력

| 필드명 | 한글명 | 자료형 | 단위 | 설명 | Null 가능 | 예시 |
|--------|--------|--------|------|------|-----------|------|
| score | 기술점수 | number | 점 | 0~100 | 아니오 | `50` |
| grade | 등급 | string | — | A/B/C/D/N/A | 아니오 | `"C"` |
| action | 행동 문구 | string | — | 관심 진입 등 | 아니오 | `"중립/대기"` |
| signalBadge | 배지 | string | — | 매수/매도/중립 | 아니오 | `"중립"` |
| rsi | RSI | number | — | 14, 단순평균 | 가능 | `50` |
| movingAverages.ma5/20/60/120 | 이동평균 | number | 원 | SMA | 가능 | `0` |
| distance.ma20/ma60 | 이격 | number | % | 종가 대비 | 가능 | `0` |
| volume.ratio | 거래량비 | number | 배 | 20일 평균 대비 | 가능 | `1` |
| signals | 신호 목록 | string[] | — | 가산 사유 | 아니오 | `[]` |
| atr.pct | ATR비율 | number | % | | 가능 | `2` |
| week52.position | 52주 위치 | number | % | | 가능 | `50` |

전체 중첩 객체: `bollinger`, `macd`, `stochastic`, `ichimoku`, `adx`, `obv`, `supertrend`, `minervini`, `divergence` 등. 값은 Spark 전달 시 승인된 필드만.

### 3.4 `predict` 출력

| 필드명 | 한글명 | 자료형 | 단위 | 설명 | Null 가능 | 예시 |
|--------|--------|--------|------|------|-----------|------|
| probUp | 상승확률 | number | % | 코드는 0~100 한 자리 (내부 0~1을 ×100) | 아니오 | `50.0` |
| probDown | 하락확률 | number | % | 100-probUp | 아니오 | `50.0` |
| direction | 방향 | string | — | UP/DOWN | 아니오 | `"UP"` |
| confidence | 거리 구간 | string | — | \|p-0.5\|. **통계적 신뢰도 아님** | 아니오 | `"low"` |
| horizonDays | 예측기간 | number | 달력일 | 레거시 7. 신규는 `horizonTradingDays` | 아니오 | `7` |
| topFactors | 기여 상위 | object[] | — | key, label, impact | 아니오 | `[]` |
| model.accuracy | 적중률 | number | % | resolved>0일 때 | 가능 | `null` |
| candleFinality | 봉 확정 상태 | string | — | 호환 확장. `FINAL`/`NOT_FINAL`/`UNKNOWN` | 가능 | `"FINAL"` |
| finalitySource | 확정 출처 | string | — | 호환 확장. `TIME_HEURISTIC`(KIS 공식 아님)/`HISTORICAL_DATE`/`EXPLICIT_FINAL_FLAG`/`UNKNOWN` | 가능 | `"TIME_HEURISTIC"` |
| candleTradingDate | 봉 거래일 | string | — | 호환 확장. YYYY-MM-DD | 가능 | `"2026-08-14"` |

주의: `probUp`은 퍼센트다. Spark 스키마의 0~1과 혼동하지 말 것. `predict()` 반환 JSON·저장 레코드에 위 필드와 `dataAsOf`를 호환 확장한다(기존 키 유지).

### 3.5 예측 로그 레코드

단계 1에서 신규 필드가 구현되었다. 레거시 필드는 유지한다.

**레거시 필드 (유지)**

| 필드명 | 한글명 | 자료형 | 설명 | Null 가능 |
|--------|--------|--------|------|-----------|
| id | 식별 | string | 신규는 UUID(`predictionId`와 동일). 레거시는 `{code}-{YYYY-MM-DD}` | 아니오 |
| code | 종목 | string | | 아니오 |
| date | 예측일 | string | ISO 날짜 | 아니오 |
| entryPrice | 기준가 | number | 기록 당시 종가 | 아니오 |
| features | 피처 | object | 정규화 숫자 | 아니오 |
| probUp | 상승확률 | number | 0~1 기록 (`toFixed(4)`) | 아니오 |
| status | 상태 | string | pending/resolved | 아니오 |
| finalPrice | 채점가 | number | 단계 1: `targetTradingDate`의 확정 종가. 최신 종가 아님 | 가능 |
| actual | 실제방향 | string | UP/DOWN | 가능 |
| correct | 적중 | boolean | | 가능 |

`predict()` 응답의 `probUp`은 %이고, 로그 파일의 `probUp`은 0~1이다.

**신규 필드 (단계 1 구현)** — 4.4절. 기본키는 UUID `predictionId`. 중복키 6필드: symbol, baseTradingDate, horizonType, horizonTradingDays, modelVersion, featureVersion. 신규 기본 `modelVersion=predictor-legacy-v1`, `featureVersion=features-v1`. 구 로그 없는 version은 `unspecified`(덮어쓰기 방지). LEGACY target은 base+7 달력일 후 다음 거래일. 호환 확장(기존 키 유지): `candleFinality`, `finalitySource`, `candleTradingDate`, `dataAsOf`.

### 3.6 DART 실적

| 필드명 | 한글명 | 자료형 | 단위 | 설명 |
|--------|--------|--------|------|------|
| fundamentalScore | 실적점수 | number | 점 | 0~100 |
| fundamentalGrade | 실적등급 | string | — | A~D |
| unit | 단위 | string | — | `"억원"` |
| years | 연간 | object[] | 억원 | 매출·영업이익·YoY |
| quarters | 분기 | object[] | 억원 | 최근 최대 4 |

### 3.7 KB 현재가 (분석 미사용, 참고)

코드가 읽는 필드: `dataBody.is_nm`, `dataBody.now_prc`.
장 마감 후 관측: 최상위 `dataHeader`만. JSON 경로는 **unknown**.

---

## 4. JSON 요청·응답 예시 (Spark 인터페이스 — 미구현)

구현하지 말 것. 앱이 나중에 만들 조회 전용 계약이다.

### 4.1 종목 기본정보

```json
{
  "symbol": "005930",
  "name": "예시종목",
  "market": "KOSPI",
  "sector": "전기전자",
  "dataAsOf": "2026-08-14T15:40:00+09:00"
}
```

### 4.2 가격 데이터

결측은 `null`. 더미로 `0`을 쓰지 않는다. 설명이 필요하면 비실제 양수에 `"example": true`를 붙인다.

```json
{
  "symbol": "005930",
  "tradingDate": "2026-08-14",
  "open": null,
  "high": null,
  "low": null,
  "close": null,
  "volume": null,
  "tradingValue": null,
  "dataAsOf": "2026-08-14T15:40:00+09:00",
  "isFinal": true,
  "marketSession": "CLOSED",
  "adjustmentStatus": "UNKNOWN",
  "featureFormulaVersion": "features-v1",
  "features": {}
}
```

장중이면 `isFinal: false`, `marketSession: "OPEN"`. 예측 피처에는 `dataAsOf` 이하만 넣는다.

### 4.3 분석 결과 (Spark 출력 계약)

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
  "technicalScore": 50,
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
  "missingData": ["supplyDemand", "horizon.ULTRA_SHORT", "horizon.LONG"],
  "sourceScores": {
    "appTechnicalScore": 50,
    "appProbUpPercent": 50.0,
    "appHorizon": "LEGACY_7_CALENDAR_DAYS"
  }
}
```

단위·의미:

| 필드 | 자료형 | 의미 |
|------|--------|------|
| `upProbability` | number 0~1 또는 null | Spark 표준. 앱 응답 %는 100으로 나눔 |
| `horizon` | enum | `ULTRA_SHORT`=1, `SHORT`=5, `MEDIUM`=20, `LONG`=60거래일. 레거시는 `LEGACY_7_CALENDAR_DAYS` |
| `horizonTradingDays` | integer | 1 / 5 / 20 / 60. 레거시는 이 필드 대신 달력 7 |
| `riskScore` | number 0~100 또는 null | **높을수록 위험** |
| `targetPriceLow` / `targetPriceHigh` | number 또는 null | 목표가 하한·상한. `targetRange` 배열 금지 |
| `confidence` | LOW/MEDIUM/HIGH | \|p-0.5\|만. 검증 전 통계적 신뢰도로 쓰지 않음 |

### 4.4 예측 성과 데이터 (단계 1 구현됨)

`targetTradingDate`는 단순 날짜 덧셈이 아니라 **KRX 영업일 달력**으로 `baseTradingDate`에서 `horizonTradingDays`만큼 진행한 날이다.

확정 예시: `baseTradingDate=2026-08-14`(금) + 5거래일. 2026-08-15~16 주말, 2026-08-17 광복절 대체공휴일 휴장을 반영하면 5번째 거래일은 **2026-08-24**다. `2026-08-21`로 계산하지 않는다.

`dataAsOf` 예시는 정규장 종료 후 종가 확정을 반영해 **15:40 KST 이후**로 통일한다.

KRX 거래일 캘린더를 확인할 수 없으면 날짜를 임의로 더하지 말고 아래 상태를 쓴다.

```json
{
  "targetTradingDate": null,
  "evaluationStatus": "CALENDAR_PENDING",
  "missingData": ["krxTradingCalendar"]
}
```

캘린더가 확인된 경우:

```json
{
  "predictionId": "uuid",
  "symbol": "005930",
  "createdAt": "2026-08-14T15:40:00+09:00",
  "baseTradingDate": "2026-08-14",
  "baseClose": null,
  "horizonType": "SHORT",
  "horizonTradingDays": 5,
  "targetTradingDate": "2026-08-24",
  "predictedDirection": "UP",
  "upProbability": 0.5,
  "modelVersion": "predictor-v2",
  "featureVersion": "features-v1",
  "dataAsOf": "2026-08-14T15:40:00+09:00",
  "targetClose": null,
  "actualReturnPct": null,
  "actualDirection": null,
  "evaluationStatus": "PENDING",
  "evaluatedAt": null,
  "missingData": []
}
```

`evaluationStatus`: `CALENDAR_PENDING` / `PENDING` / `PRICE_EVALUATED` / `MODEL_UPDATE_PENDING` / `EVALUATED`. 레거시 `status=resolved`는 채점 완료로 skip. 당일 봉 미확정(`isFinal` 없음)이면 로그 미기록. `UNKNOWN`·`NOT_FINAL`도 로그·학습 제외(현재 미저장). `TIME_HEURISTIC`+`FINAL`은 저장 가능하나 KIS 공식 확정이 아님.

`processMatured` (단계 1 구현): `targetClose`는 평가 실행일의 최신 종가가 아니라 `targetTradingDate`의 확정 종가다. 미확정 봉 금지. 가격 커밋(`MODEL_UPDATE_PENDING`) → `saveModel`(`appliedEvaluations`) → EVALUATED. 부분 실패는 재실행으로 복구(이미 적용된 predictionId는 SGD 생략). `commitMaturedBatch` 미사용.

레거시 +7 예시: 2026-08-14→2026-08-21, 2026-08-10→2026-08-18, 토/일 08-15/16→2026-08-24, 연말 12-24→2027-01-04. 검증 코드: INVALID_BASE_TRADING_DATE, INVALID_TARGET_TRADING_DATE, INVALID_HORIZON, INVALID_DATE_FORMAT, CANDLE_NOT_FINAL, CALENDAR_PENDING, STORE_BUSY. `createdAt`/`dataAsOf`는 KST ISO8601. 구현: `lib/calendar/kst.js`, `lib/calendar/krx-calendar.js`, `lib/storage/*`. 픽스처는 운영 캘린더가 아니다. Postgres 미연결. 주문 차단 유지.

레거시 달력 7일 로그는 `horizonType: "LEGACY_7_CALENDAR_DAYS"`로만 보관하고 5거래일 표에 넣지 않는다.

---

## 5. Null 처리

| 상황 | 앱 동작 | Spark 권장 |
|------|---------|------------|
| 일봉 < 5 | score 0, grade N/A | 분석 거부, missingData |
| 지표 계산 불가 | 해당 키 null, 가산 생략 | null 유지 |
| 수급 없음 | 웹은 추정값 가능 | **추정 금지**, null |
| KB dataBody 없음 | parsing 실패 | 시세로 사용 금지 |
| 예측 미학습 | accuracy null | `confidence`는 거리 구간만. 통계적 신뢰도 표현 금지 |
| 장중 당일 봉 | 구분 없음 | `isFinal=false`, 확정 종가로 쓰지 않음 |
| KRX 영업일 달력 없음 | 달력 없음. 날짜 덧셈 금지 | `targetTradingDate=null`, `evaluationStatus=CALENDAR_PENDING`, `missingData=["krxTradingCalendar"]` |
| OHLCV 0 | 코드는 0을 유효 종가로 볼 수 있음 | Spark 예시·결측은 null |

---

## 6. 갱신 주기

| 데이터 | 주기 |
|--------|------|
| KIS 시세 | 요청 시 (캐시: featured 약 30분) |
| 일봉 분석 | 요청 시 |
| AI 재학습 | 6시간 + 부팅 1분 |
| 진화 | 6시간 + 부팅 3분 |
| 실적 감시 | 12시간 + 부팅 5분 |
| DART corp 캐시 | 약 7일 |
| 마스터 JSON | 수동 스크립트 |
| KB 조회 | 요청 시, 분석 캐시 없음 |

---

## 7. 보존 정책

- 예측 로그: 2000건 slice 제거. 로컬 JSON StoragePort. 아카이브 기본 비활성(`enabled:false`). EVALUATED만 월별 `predictions-YYYY-MM.json`로 이동 가능. pending류 삭제 금지. Postgres는 1순위 후보이나 미연결
- Render 재배포: 런타임 JSON 소실 가능. 외부 영속화는 기간별 모델보다 선행
- Git: 마스터 JSON만 커밋. 토큰·알림·푸시 파일은 커밋하지 말 것
- Spark 스냅샷: 운영 자격증명과 분리된 경로. **미구현**

---

## 8. Spark 제공 가능 여부 요약

| 가능 | 조건부 | 금지 |
|------|--------|------|
| 마스터 코드·시장·섹터 | 일봉 OHLCV + 정규화 피처 (`featureFormulaVersion` 필수) | 앱키·시크릿·토큰 |
| 지표 이름·공식 | 점수·확률 (승인). 레거시 7일과 거래일 기간 분리 | 계좌·잔고·주문 |
| 결측 목록 | DART 집계 점수 | 푸시 토큰 |
| 모델 통계 집계 | 예측 로그 비식별 | `.env` 값 |
| 본 스키마 | KB 구조 키 이름만 | KB/KIS 원문 Body |


---

## 9. 향후 실행 레코드 (미구현)

단계 1에서 전략 엔진은 구현하지 않는다. 로컬 포트폴리오와 가상거래 계좌는 합치지 않는다.

향후 분리: `OrderIntent`, `RiskDecision`, `UserApproval`, `ExecutionRecord`.

- Paper: Strategy → OrderIntent → Risk Engine → Paper Broker
- Live: Strategy → OrderIntent → Risk Engine → User Approval → Live Broker

`executionAllowed`를 전략이 바꾸는 권한값으로 쓰지 않는다. 전략 해시는 Canonical JSON(키 정렬, UTF-8, 숫자 표현 통일, null·빈 배열 규칙). 백테스트 API는 향후 `/api/strategy/backtest`. 전략 자동 승격 금지.
