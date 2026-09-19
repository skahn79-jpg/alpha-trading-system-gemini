# Gemini Spark — 보안 체크리스트

- 기준일: 2026-08-14
- 실제 비밀값 없음. 변수명과 용도만 기록
- 단계 1: 신규 환경변수·자격증명 없음. 예측 저장은 로컬 JSON only. Postgres/Firestore 연결 없음. 주문 3중 차단 유지

---

## 1. 전달 금지 정보

Spark, 채팅, 문서, 로그, 이슈에 다음을 넣지 않는다.

- API App Key / Secret (KIS, KB, Gemini, DART)
- `APP_API_KEY`, `ALERT_CHECK_SECRET`
- 관리자 로그인 ID, 비밀번호, `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`, 세션 쿠키 원문
- OAuth `access_token`, Authorization 헤더
- 계좌번호, 잔고 원문, 주문 원문
- `.env` / `.env.local` / xcconfig Secrets 실제 값
- APNs 키, App Store Connect `.p8`, Issuer
- 디바이스 푸시 토큰
- 사용자 개인정보
- KB/KIS 요청·응답 Body 전체
- 운영 서버 SSH·대시보드 비밀번호

허용: 환경변수 **이름**, TR 코드, 필드 **이름**, 구조 타입, `present`/`missing`.

---

## 2. 환경변수 목록 (이름만)

### 2.1 서버·웹 (`render.yaml`, `scripts/env.example`, `server.js`, `kb/config.js`)

| 이름 | 용도 | Spark 전달 |
|------|------|------------|
| `NODE_ENV` | production 판정 | 가능 (값 `production` 여부만) |
| `PORT` | 리슨 포트 | 불필요 |
| `KIS_APP_KEY` | KIS 인증 | 금지 |
| `KIS_APP_SECRET` | KIS 인증 | 금지 |
| `KIS_BASE_URL` | KIS 호스트 | 이름만 |
| `DART_API_KEY` | DART | 금지 |
| `GEMINI_API_KEY` | Gemini | 금지 |
| `GOOGLE_API_KEY` | Gemini 대체 이름 | 금지 |
| `GEMINI_MODEL` | 모델명 | 가능 (모델명만) |
| `ALLOWED_ORIGIN` / `ALLOWED_ORIGINS` | CORS | 금지 (내부 호스트) |
| `APP_API_KEY` | X-App-Key | 금지 |
| `ALERT_CHECK_SECRET` | 알림 크론 | 금지 |
| `ADMIN_LOGIN_ID` | 관리자 ID | 금지 |
| `ADMIN_PASSWORD_HASH` | Argon2id 해시 | 금지 |
| `SESSION_SECRET` | 세션 HMAC | 금지 |
| `SESSION_TTL_MINUTES` | 세션 TTL | 가능 (숫자 정책) |
| `KBSEC_BASE_URL` | KB 호스트 | 이름만 |
| `KBSEC_APP_KEY` | KB OAuth | 금지 |
| `KBSEC_APP_SECRET` | KB OAuth | 금지 |
| `KBSEC_IP_ADDR` | dataHeader | 금지 |
| `KBSEC_MAC_ADDR` | dataHeader | 금지 |
| `KBSEC_TRADING_ENABLED` | 주문 플래그 | 가능 (`false` 유지) |
| `KBSEC_AUTO_TRADING_ENABLED` | 자동매매 플래그 | 가능 (`false` 유지) |
| `RATE_LIMIT_GENERAL` | /api 분당 | 가능 |
| `RATE_LIMIT_AI` | /api/ai 분당 | 가능 |
| `VITE_API_URL` | 프론트 API 주소 | 공개 URL만 |
| `VITE_APP_API_KEY` | 프론트 앱키 | 금지 |
| `TRADE_API_KEY` | 관세청 선택 | 금지 |
| `ALERTS_FILE` | 알림 파일 경로 | 이름만 |
| `VITE_FIREBASE_*` | Firebase (미연결) | 금지 |

### 2.2 iOS / Apple (이름만, 값 금지)

`ASC_API_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_PATH`, `APPLE_ID`, `APPLE_APP_PASSWORD` 및 관련 시크릿.

---

## 3. 주문 기능 차단 기준

다음이 모두 유지되어야 한다.

| 계층 | 기준 |
|------|------|
| 환경 | `KBSEC_TRADING_ENABLED=false`, `KBSEC_AUTO_TRADING_ENABLED=false` |
| `kb/broker.js` | `placeOrder`/`amendOrder`/`cancelOrder`는 네트워크 전에 throw |
| `server.js` | `/api/trading` POST 403. POST 주문 라우트 없음 |
| iOS | `KBInquiryPolicy.orderControlsEnabled=false`, `networkEnabled=false` |
| Spark | 주문·이체·계좌비밀번호 도구 없음 |

플래그를 `true`로 바꾸는 것은 **사용자 승인 작업**이다. Spark가 요청해도 자동 변경하지 않는다.

`connection`은 `"unverified"`로 유지한다.

---

## 4. 조회 전용 권한

Spark 연동 시 (미구현, 설계):

- 읽기 전용 경로만 (`GET` 또는 정적 파일)
- `/api/trading/*` 계좌 조회는 Spark에 열지 않음
- `/api/broker/*` 관리자 상태도 기본 제외
- 종목 화이트리스트 적용 가능
- 앱키는 Spark용 **별도 읽기 키** (기존 `APP_API_KEY` 재사용 금지 `권장`)
- KB/KIS 자격증명은 서버에만 남김

---

## 5. 로그 마스킹

이미 있는 규칙:

- `kb/envelope.js` `sanitize`: secret/token/password/appkey/authorization 키 마스킹
- `kb/config.js` `maskSecret` / `maskAccount`
- `kb/diagnostic.js`: 키 이름만. 값·Body·헤더 금지
- `sendKbError`: 일반화 502
- 로그인 실패 응답에 어떤 필드가 틀렸는지 구분하지 않음

Spark/앱 추가 로그도 동일하게:

- `JSON.stringify(response.data)` 금지
- `Object.entries(dataBody)` 덤프 금지
- 종목명·현재가 운영 로그 금지 (구조 진단 단계)

---

## 6. 개인정보 제거

| 데이터 | 처리 |
|--------|------|
| 관리자 계정 | Spark 제외 |
| 알림 설정 | 사용자 식별 가능 → 제외 또는 종목코드만 |
| APNs 토큰 | 금지 |
| IP (로그인 로그) | Spark 제외 |
| 계좌·잔고 | 금지 |

마스터의 종목명·코드는 공개 상장 정보로 제공 가능하다.

---

## 7. API 호출 제한

| 구간 | 기본 | Render 설정 |
|------|------|-------------|
| `/api` | 분당 300 | `RATE_LIMIT_GENERAL=60` |
| `/api/ai` | 분당 10 | `RATE_LIMIT_AI=10` |
| 로그인 | 15분 5회/IP | 고정 |
| KB/KIS 업스트림 | 앱 레벨 limiter 없음 | 호출 남용 주의 |

Spark 경로를 만들면 별도 한도와 감사 로그가 필요하다.

금지: KB/KIS 재호출을 Spark가 직접 트리거. 정규장 비교 등 1회 호출은 **별도 지시문**으로만.

---

## 8. 입력값 검증

기존:

- 종목코드 `toStr` / 비어 있으면 `KB_INVALID_ARGUMENT`
- 관리자 세션 HMAC 검증
- CSRF Origin allowlist
- Gemini 프록시는 본문을 모델에 전달 — **비밀을 프롬프트에 넣지 말 것**

Spark 입력 권장:

- 종목코드 `^[0-9]{6}$` (국내)
- horizon enum만: `ULTRA_SHORT`/`SHORT`/`MEDIUM`/`LONG`/`LEGACY_7_CALENDAR_DAYS`
- 모든 입력 데이터의 시점은 `dataAsOf` 이하
- 당일 일봉은 정규장 종료 후 종가가 확정된 경우에만 포함 (`isFinal=true`, `marketSession=CLOSED`)
- 장중 당일 봉은 `isFinal=false`로 표시하고 확정 종가로 쓰지 않음
- 기본 `predict()`가 당일이고 isFinal 없으면 **로그 미기록**(확률만 반환)
- `TIME_HEURISTIC`은 15:40 시각 판정 출처이며 KIS 공식 확정/공식 캘린더가 아님. `UNKNOWN`·`NOT_FINAL`은 예측 로그·학습 대상에서 제외(현재 로그 미저장). 과거 확정봉(`HISTORICAL_DATE`)은 허용. 현재 SGD/`trainFromHistory`는 변경 없음. candle-meta는 opts 최상위, `predict()`는 저장 레코드·반환 JSON에 `candleFinality`/`finalitySource`/`candleTradingDate`/`dataAsOf` 호환 확장(기존 키 유지). 이후 품질 점검은 `finalitySource`별 성과 분리
- 성과평가의 `targetClose`는 `targetTradingDate`의 미래 종가이며, 이는 피처 누출이 아님
- 임의 URL·파일 경로 거부

---

## 9. 승인 필요 작업

다음을 Spark나 에이전트가 혼자 하지 않는다.

1. 환경변수 변경 (Render 포함)
2. `KBSEC_TRADING_ENABLED=true`
3. iOS `networkEnabled` / 주문 UI 활성화
4. `connection=verified`
5. Git commit / push (사용자가 명시할 때만)
6. KB/KIS/SZQM0771 실호출
7. 파서·envelope·성공코드·Authorization 변경
8. TestFlight 업로드
9. 수급/계좌 API를 Spark에 연결
10. `.env` 내용 출력

---

## 10. 운영 적용 전 점검사항

- [ ] 문서에 키·토큰·계좌·비밀번호가 없는가
- [ ] 주문 3중 차단이 그대로인가
- [ ] Spark 입력이 조회 전용인가
- [ ] 예측 피처에 `dataAsOf` 이후 가격이 없는가
- [ ] 성과평가가 `targetTradingDate` 종가만 쓰고 평가일 최신가로 대체하지 않는가
- [ ] 당일 봉에 `isFinal`/`marketSession`이 있는가
- [ ] 로그가 값 대신 키만 남기는가
- [ ] rate limit이 적용되는가
- [ ] 기존 `APP_API_KEY`를 Spark와 공유하지 않는가
- [ ] 런타임 JSON에 푸시 토큰이 섞이지 않는가
- [ ] 사용자가 문서와 연동 방식을 승인했는가

하나라도 실패하면 연동을 시작하지 않는다.


---

## 11. 단계 1 저장소

- 신규 환경변수·자격증명 없음
- 예측/모델은 로컬 JSON only (`data/ai-predictions.json`, `data/ai-model.json`)
- Postgres/Firestore 연결 없음
- `/api/trading/*`, `kb/broker.js` 변경 없음. `server.js`는 `/api/predict`와 selfTrain `predict`에 candle-meta opts만 전달
- 손상 JSON을 빈 배열로 덮어쓰지 않음 (`CorruptedJsonError`)
- 파일 락 복구 로그는 `{event:"stale-lock-recovered", pid, operationId, createdAt}`만. 파일 내용·민감정보 금지
- 살아 있는 PID lock은 stale이어도 삭제 금지
- 요청 경로 파일 락 (`TEMPORARY_STAGE1_POLICY`): retry 5ms, maxWait 30ms. 초과 시 `STORE_BUSY`. API 확률 유지, 해당 요청 로그 생략, 다음 동일 요청에서 재저장 가능. 주문과 무관. `Atomics.wait`는 주 스레드 최대 약 30ms 차단 가능. 이번 단계 비동기 락/외부 저장소 확장 없음. 향후 Postgres 또는 비동기 저장 큐 교체 대상
- 아카이브 기본 비활성. pending/MODEL_UPDATE_PENDING 기록 삭제 금지
- 당일 미확정 봉으로 예측 로그를 쓰지 않음
- 문서·코드에 비밀값·실제 키·계좌를 쓰지 않음
