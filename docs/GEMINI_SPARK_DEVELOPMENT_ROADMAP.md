# Gemini Spark — 개발 로드맵

- 기준일: 2026-08-14
- 단계 1 구현 완료 (식별키 + processMatured + 로컬 StoragePort + KST/6필드/락 복구/MODEL_UPDATE_PENDING)
- Postgres/Firestore 연결 없음. 이후 단계는 사용자 승인 후

---

## 1. 현재 기능

| 영역 | 있음 |
|------|------|
| 시세·일봉 | KIS `/api/quote`, `/api/chart`, `/api/analyze` |
| 기술점수 | `analyzeCandles` 0~100, 다수 지표 |
| 레거시 달력 7일 예측 | `predictor.js` (`LEGACY_7_CALENDAR_DAYS`) |
| 실적 점수 | DART `fundamentalScore` |
| 해설 | Gemini 프록시 |
| 선정 | featured signals, trade picks, 웹 스캔 |
| 알림 | 서버 + Telegram + APNs |
| 거시 | FRED mood |
| KB 조회 | 6 TR, 관리자 세션, 주문 차단 |
| iOS | 시세·분석 화면. KB 조회 네트워크 off |

---

## 2. 부족한 기능

| 영역 | 상태 |
|------|------|
| 1·5·20·60거래일 예측 | 없음 |
| 예측 로그 식별키 | 단계 1에서 UUID `predictionId` 도입. 레거시 `{code}-{date}` 읽기 호환 |
| `processMatured` targetClose | 단계 1에서 `targetTradingDate` 확정 종가만 사용. 없으면 `CALENDAR_PENDING` |
| 시장 국면 통합 | 매크로 mood만 |
| 외인·기관 수급 실데이터 | 없음 |
| ATR 손절·손익비 필드 | 없음 |
| 업종 상대강도 표준화 | 부분 |
| 뉴스 NLP | 없음 |
| 확률 보정 | 없음 |
| 웹 백테스트 엔진 | UI만 |
| 예측 영구 저장 | 로컬 JSON StoragePort 구현. 2000건 slice 제거. Render 디스크 휘발은 여전. Postgres는 1순위 후보이나 미연결 |
| 장 종료 정기 보고 | 없음 |
| KB 시세 ↔ 분석 연결 | 없음 |
| 고고저 서버/iOS | 웹만 |
| 분봉 | 없음 |
| Spark 조회 API | 없음 |

---

## 3. 단계별 개발계획

### 단계 0 — 문서 및 스키마 확정 (완료)

- 산출물: 문서 4종
- 코드 변경: 문서만 (당시)

### 단계 1 — 예측 로그 식별키·채점 수정·로컬 StoragePort (완료)

원래 단계 1(식별키·targetTradingDate)과 원래 단계 2(`processMatured`) 및 로컬 StoragePort가 **이번 단계에 포함**되었다. Postgres 영속화는 이후 단계다.

| 항목 | 상태 |
|------|------|
| `predictionId` UUID | 완료. 레거시 `{code}-{date}` 읽기 호환 |
| `baseTradingDate`, `horizonTradingDays`, `targetTradingDate` | 완료 |
| KRX 영업일 달력 (`lib/calendar/krx-calendar.js`) | 완료. 목록에 없으면 임의 계산 금지, `CALENDAR_PENDING` |
| 테스트 픽스처 `test/fixtures/krx-calendar.js` | 완료. **운영 캘린더 아님** |
| 레거시 `{code}-{date}` / `LEGACY_7_CALENDAR_DAYS` 분리 | 완료. SHORT와 합산 금지 |
| `processMatured`가 평가일 최신 종가 사용 중지 | 완료 |
| `targetTradingDate`의 `targetClose`만 사용 | 완료 |
| 해당 봉 없으면 `PENDING`. 목표일 없으면 `CALENDAR_PENDING` | 완료 |
| 로컬 StoragePort (`lib/storage/*`) | 완료. memory + JSON. 원자적 쓰기·파일 락(`TEMPORARY_STAGE1_POLICY`: retry 5ms, maxWait 30ms 후 STORE_BUSY. API 확률 유지, 해당 요청 로그 생략, 다음 동일 요청에서 재저장 가능. 주문과 무관. `Atomics.wait` 주 스레드 최대 약 30ms 차단 가능. 이번 단계 비동기 락/외부 저장소 확장 없음. 향후 Postgres 또는 비동기 저장 큐 교체 대상)·복구(죽은 PID만)·손상 JSON 거부 |
| 2000건 `slice(-2000)` 제거 | 완료 |
| Postgres/Firestore 연결 | **하지 않음**. 1순위 후보이나 미연결 |
| 6필드 중복키 + `unspecified` fallback | 완료. 구 로그 덮어쓰지 않음 |
| KST (`lib/calendar/kst.js`) | 완료. Intl Asia/Seoul. YYYY-MM-DD는 TZ 변환 없음 |
| 레거시 +7 다음 거래일 | 완료. 08-14→08-21, 토/일→08-24, 연말 12-24→2027-01-04 |
| 날짜·봉 검증 코드 | 완료. INVALID_* / CANDLE_NOT_FINAL / CALENDAR_PENDING / STORE_BUSY. 당일 isFinal 없으면 로그 미기록. `UNKNOWN`·`NOT_FINAL`은 로그·학습 제외(현재 미저장). `TIME_HEURISTIC`은 시각 판정 출처(KIS 공식 아님). 과거 확정봉(`HISTORICAL_DATE`) 허용. SGD/`trainFromHistory` 미변경. candle-meta는 opts 최상위, `predict()` 저장 레코드·반환 JSON에 `candleFinality`/`finalitySource`/`candleTradingDate`/`dataAsOf` 호환 확장. 이후 품질 점검은 `finalitySource`별 성과 분리. 락 경합 시 확률은 반환 |
| `MODEL_UPDATE_PENDING` 부분 성공 복구 | 완료. 가격 먼저, 모델 다음, EVALUATED는 복구 완료 후 |
| 아카이브 정책 | 구현·기본 비활성. predictor 자동 실행 없음 |


검증: 6필드가 같으면 덮어쓰지 않음. 다른 model/feature/horizonTradingDays는 별도 저장. 당일 미확정 봉은 로그 없음. 성과평가에 미래 `targetClose`를 쓰는 것은 정상. 피처에는 `dataAsOf` 이후 없음. 주문 차단 유지.

구현 파일: `predictor.js`, `lib/calendar/krx-calendar.js`, `lib/calendar/candle-meta.js`, `lib/storage/*`, `test/fixtures/krx-calendar.js`, `test/predictor-stage1.test.js`.

`/api/trading/*`와 `kb/broker.js`는 변경하지 않았다. `server.js`는 `/api/predict`와 selfTrain `predict`에 candle-meta opts만 전달한다. 신규 환경변수·자격증명 없음.

### 단계 2 — `processMatured` 채점 수정 (단계 1에 포함, 완료)

원래 단계 2 항목은 단계 1에서 구현되었다.

### 단계 3 — 예측 로그 외부 영속화 (이후)

| 항목 | 담당 |
|------|------|
| Render 디스크 밖 저장 (Postgres 1순위 후보) | 앱 |
| 로컬 JSON은 단계 1에서 구현됨. 재배포 시 휘발은 여전 | — |

오류 로그를 더 쌓은 뒤 기간별 모델을 확장하지 않는다.

### 단계 4 — 읽기 전용 스냅샷

| 항목 | 담당 |
|------|------|
| 장 종료 JSON (`dataAsOf`, `isFinal`, `marketSession`) | 앱 |
| OHLCV + 피처 + `featureFormulaVersion` | 앱 |
| 종목 화이트리스트, 자격증명 제외 | 운영 |

정규장 IVU10140 1회 비교는 별도 지시. 파서 확정 전 수정 없음.

### 단계 5 — 1·5·20·60거래일 분석 구조

| 항목 | 담당 |
|------|------|
| horizon enum 고정 | 앱 + Spark |
| 국면·추세·모멘텀·거래량 축 병행 | Spark 제안 / 앱 |
| ATR 손절·손익비 표시 | 앱 |
| 업종 상대강도 | 앱 |

기존 `analyzeCandles` 점수는 삭제하지 않음.

### 단계 6 — 기간별 확률 모델

단계 2·3 완료 후에만. 레거시 달력 7일과 학습 데이터를 섞지 않음.

### 단계 7 — 백테스트 및 확률 보정

비용·생존편향·`adjustmentStatus` 명시. 웹 Backtest 예시 UI를 실제 엔진으로 교체할 때는 영속 로그를 쓴다.

### 단계 8 — Spark 자동 연동

`/api/spark/*` 또는 파일. 주문 경로 없음.

수급·뉴스 본문·KB 파서·iOS 조회 on은 사용자 승인 게이트. 주문 활성화는 로드맵에 넣지 않는다.

---

## 4. 우선순위

`HANDOFF` 16~17장과 동일:

1. 문서·스키마 확정 — 완료
2. 예측 로그 식별키와 `targetTradingDate` — 단계 1 완료
3. `processMatured` 채점 수정 — 단계 1에 포함, 완료
4. 예측 로그 영속화 — 로컬 JSON 완료. Postgres는 이후
5. 읽기 전용 스냅샷
6. 1·5·20·60거래일 분석 구조
7. 기간별 확률 모델
8. 백테스트 및 확률 보정
9. Spark 자동 연동

수급·뉴스는 데이터 승인 없이 구현하지 않는다. 기간별 모델은 2~4 완료 전 시작하지 않는다.

---

## 5. 의존성

```text
문서·스키마 확정
  → 식별키 + targetTradingDate
      → processMatured (targetClose만)
          → 로그 영속화
              → 읽기 전용 스냅샷 (dataAsOf / isFinal)
                  → 1·5·20·60 분석 구조
                      → 기간별 확률 모델
                          → 백테스트·확률 보정
                              → Spark 연동

수급/뉴스 본문 ──(사용자 승인)──→ 해당 점수 축
KB 파서 확정 ──(사용자 승인)──→ KB 시세 사용
정규장 IVU10140 1회 ──(별도 지시)──→ 구조만
```

---

## 6. 검증 기준

| 기능 | 검증 |
|------|------|
| 점수 | 기존 테스트 `npm test` 유지. 새 필드는 병행 |
| 예측 피처 | `dataAsOf` 이후 종가 미사용 |
| 성과평가 | `targetTradingDate`의 `targetClose`만. 평가일 최신가 대체 금지 |
| 백테스트 | 비용 파라미터 명시, walk-forward |
| KB | 값 로그 없음, 주문 미호출 |
| Spark 출력 | 결측은 null + missingData. 확정 매수 문구 없음 |
| 보안 | `GEMINI_SPARK_SECURITY_CHECKLIST.md` 10장 |

---

## 7. 완료 조건

### 문서 단계

- [x] HANDOFF / SCHEMA / SECURITY / ROADMAP 작성
- [x] 단계 1 구현 반영으로 문서 보완 (2026-08-14)
- [ ] 사용자 검토
- [ ] Spark에 문서 전달 승인

### 단계 1 앱 완료 조건

- [x] 식별키 충돌 없음 (UUID + horizonType 분리)
- [x] `processMatured`가 `targetClose`만 사용
- [x] 로컬 StoragePort (JSON). Postgres 미연결
- [x] 2000건 slice 제거
- [ ] 예측 로그가 재배포 후에도 남음 (Render 디스크 휘발은 여전)

### Spark 분석 최소 완료

- 기간은 1·5·20·60거래일만. 없으면 missing
- 레거시 달력 7일은 `LEGACY_7_CALENDAR_DAYS`로만 인용
- 수급 없으면 수급 점수 null
- `riskScore`는 높을수록 위험. 목표가은 low/high
- 주문 제안이 실행 지시가 아님

### 앱 연동 최소 완료 (미래, 단계 1 이후)

- 예측 로그가 재배포 후에도 남음 (Postgres 등)
- 조회 전용 스냅샷 1종 (`isFinal`/`dataAsOf`)
- 비밀 미포함

어느 단계도 주문을 완료 조건에 넣지 않는다.

---

## 8. 향후 실행·전략 구조 (이번 단계 미구현)

단계 1은 예측 로그·채점·로컬 저장만 다룬다. 전략 엔진·주문 경로는 구현하지 않는다.

실행 파이프라인 (설계만):

- **Paper:** Strategy → OrderIntent → Risk Engine → Paper Broker (실거래 승인 불필요)
- **Live:** Strategy → OrderIntent → Risk Engine → User Approval → Live Broker

`executionAllowed`를 전략이 바꾸는 권한값으로 쓰지 않는다.

향후 분리할 레코드: `OrderIntent`, `RiskDecision`, `UserApproval`, `ExecutionRecord`.

향후 전략 해시: Canonical JSON (키 정렬, UTF-8, 숫자 표현 통일, null·빈 배열 규칙, 표시용 필드 포함 여부 확정). 이번 단계 전략 엔진 미구현.

메뉴 배치 (향후):

- 웹: 투자운영 하위
- iOS: 더보기

로컬 포트폴리오 ≠ 가상거래 계좌. 합치지 않는다.

백테스트 API는 향후 `/api/strategy/backtest`. 전략 자동 승격 금지.

기존 KB 조회와 `/api/trading/*`는 변경 없음. 신규 환경변수·자격증명 없음.
