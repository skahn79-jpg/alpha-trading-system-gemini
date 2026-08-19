# AGENTS.md — Alpha Trading System Multi-Agent Orchestration Rules

## 1. 목적

이 저장소는 멀티 에이전트 방식으로 개발한다.

각 에이전트는 동일한 업무를 중복 수행하지 않고 역할을 분리한다.

기본 흐름:

```text
Requirement
→ Planner
→ Red Team
→ Builder
→ Test
→ Reviewer
→ Fixer
→ Final Verification
→ Gate Review
```

현재 프로젝트의 기본 역할:

```text
Cursor       = Orchestrator + Main Builder
Antigravity  = Architecture Review + Red Team + Independent Analysis
Codex        = Code Review + Local Fix + Regression Review
```

모든 단계가 정상 완료되면 현재 승인된 작업 범위 안에서는 다음 단계로 자동 진행한다.

단 다음은 자동 실행 금지:

```text
git commit
git push
git merge
git rebase
git tag
production deployment
real trading
real order
account-changing operation
```

---

# 2. 최우선 원칙

항상 다음 구조를 유지한다.

```text
설계자 ≠ 구현자 ≠ 최종 검증자
```

동일 에이전트가 설계·구현·검증을 전부 독점하지 않는다.

다만 작은 수정은 비용 절감을 위해 단순화할 수 있다.

---

# 3. 작업 난이도 분류

작업 시작 시 반드시 다음 중 하나로 분류한다.

## TIER 1 — Trivial

예:

* 오타 수정
* 주석 수정
* 단순 rename
* 명확한 한 줄 버그
* 테스트 expectation 단순 수정
* 문서 정리

권장 흐름:

```text
Builder
→ Targeted Test
```

Red Team 생략 가능.

---

## TIER 2 — Standard

예:

* 단일 함수 구현
* 작은 API 변경
* UI 컴포넌트
* 단순 validation
* 기존 패턴을 따르는 테스트 추가
* 국소 리팩터링

권장 흐름:

```text
Planner-light
→ Builder
→ Test
→ Reviewer
```

---

## TIER 3 — Complex

예:

* 여러 모듈 변경
* 상태 머신
* 데이터 모델 변경
* API contract 변경
* 백테스트 lifecycle
* 인증/권한
* 회계 계산
* multi-step pipeline

권장 흐름:

```text
Planner
→ Antigravity Red Team
→ Builder
→ Independent Test
→ Codex Review
→ Fixer
→ Full Regression
```

---

## TIER 4 — Critical

예:

* 금융 계산
* 주문 관련 코드
* 계좌 처리
* 권한/보안
* 데이터 무결성
* migration
* production deployment
* 실제 broker API
* 자본/수익률 계산
* safety boundary 변경

필수 흐름:

```text
Deep Planner
→ Antigravity Independent Review
→ Builder
→ Independent Test
→ Codex Review
→ Red Team Re-check
→ Full Regression
→ Final Verifier
→ Human Approval
```

자동 commit 금지.

---

# 4. Cursor 역할

Cursor는 기본적으로 Orchestrator와 Builder 역할을 맡는다.

Cursor가 먼저 해야 할 일:

```text
1. 현재 branch 확인
2. HEAD 확인
3. git status 확인
4. 현재 Gate 확인
5. 변경 금지 파일 확인
6. acceptance criteria 추출
7. 작업 난이도 분류
8. 필요한 에이전트 결정
```

그 후 작업을 분할한다.

---

# 5. Antigravity 호출 조건

다음 조건 중 하나라도 해당하면 Antigravity 검토를 수행한다.

```text
회계
금융 수학
알고리즘
상태 머신
복수 모듈 변경
보안
동시성
데이터 무결성
look-ahead bias
leakage
백테스트
performance calculation
architecture decision
새로운 error contract
```

Antigravity의 기본 역할은 구현이 아니다.

다음 질문을 중심으로 검토한다.

```text
무엇이 깨질 수 있는가?
어떤 edge case가 빠졌는가?
어떤 invariant가 필요한가?
설계가 기존 contract를 깨는가?
silent fallback이 존재하는가?
테스트가 구현을 과도하게 신뢰하는가?
```

---

# 6. Codex 호출 조건

다음 상황에서 Codex reviewer를 사용한다.

```text
Builder 구현 완료
diff 50줄 이상
복수 파일 수정
새 모듈 생성
복잡한 조건 분기
error propagation 변경
계산식 변경
테스트 10개 이상 추가
```

Codex는 먼저 review 결과를 작성한다.

바로 대규모 수정하지 않는다.

각 finding:

```text
Severity:
File:
Location:
Problem:
Impact:
Expected:
Recommended Fix:
```

Severity:

```text
BLOCKER
HIGH
MEDIUM
LOW
```

BLOCKER/HIGH만 현재 Gate에서 자동 수정 대상으로 한다.

---

# 7. 파일 Ownership

한 시점에 한 파일의 write owner는 하나만 허용한다.

예:

```text
portfolio-ledger.js
OWNER = CURSOR_BUILDER

portfolio-ledger.test.js
OWNER = TEST_AGENT
```

다른 Agent는 읽기/review만 수행한다.

동시 쓰기 금지.

---

# 8. Handoff 규칙

각 Agent는 작업 종료 시 반드시 다음 형식으로 결과를 남긴다.

```text
TASK_ID:
ROLE:
STATUS:

WORK_COMPLETED:
FILES_CHANGED:
TESTS_RUN:
TEST_RESULT:

RISKS_FOUND:
OPEN_ISSUES:

NEXT_ROLE:
NEXT_ACTION:
```

다음 Agent는 기존 handoff를 우선 읽고 이어서 작업한다.

같은 조사를 반복하지 않는다.

---

# 9. 자동 진행 규칙

다음은 사용자 승인 없이 연속 진행 가능하다.

```text
Plan 완료
→ Red Team

Red Team 완료
→ Build

Build 완료
→ Targeted Tests

Targeted Tests PASS
→ Review

Review BLOCKER/HIGH
→ Fix

Fix 완료
→ Regression

Regression PASS
→ Final Verification
```

---

# 10. 자동 중단 조건

다음이면 즉시 멈추고 보고한다.

```text
요구사항 충돌
기존 확정 contract 변경 필요
tracked unrelated change 발견
secret/API key 노출
실제 계좌 변경 필요
실제 주문 필요
production deployment 필요
destructive git 필요
3회 연속 동일 실패
```

사소한 구현 선택은 중단 사유가 아니다.

합리적인 최소 변경을 선택한다.

---

# 11. 테스트 정책

항상 테스트 순서:

```text
Affected Unit Tests
→ Related Integration Tests
→ Full Regression
→ Static Check
→ git diff --check
```

기존 테스트 삭제 금지.

다음 방식으로 실패를 숨기지 않는다.

```text
assert 약화
테스트 skip
오류 코드 generic화
validation 제거
fallback 추가
```

---

# 12. 금융 프로젝트 공통 Safety Boundary

Synthetic/backtest 계층에서는 기본적으로:

```text
external network = 0
KB Open API = 0
real quotes = 0
account query = 0
order call = 0
```

실제 주문 관련 코드는 실행하지 않는다.

---

# 13. Determinism

백테스트 및 계산 코드에서는 금지:

```text
Math.random()
Date.now()
random UUID
현재시각 기반 값
locale-dependent ordering
timezone-dependent implicit parsing
```

동일 입력은 동일 결과를 반환해야 한다.

---

# 14. Error Contract

구체적인 root error를 generic stage error로 덮지 않는다.

예:

```text
root:
COST_POLICY_MARKET_MISMATCH

stage:
COST_STAGE_FAILED
```

둘 다 필요한 경우 별도로 보존한다.

---

# 15. Model Routing

에이전트 선택과 별도로 모델 비용을 자동 최적화한다.

## Low-cost model

사용:

```text
검색
파일 탐색
간단한 코드 이해
rename
boilerplate
단순 테스트
문서 업데이트
formatting
```

권장:

```text
Gemini Flash 계열
Claude Sonnet 계열의 빠른 모드
경량 Codex
```

---

## Standard model

사용:

```text
일반 코드 구현
React
Node
API
테스트
작은 리팩터링
bug fix
```

권장 우선순위:

```text
1. Sonnet
2. Gemini
3. Codex
```

동일 업무에 고비용 reasoning model을 기본 사용하지 않는다.

---

## High-reasoning model

사용 조건:

```text
architecture
금융 회계
복잡한 상태 머신
multi-module contract
root cause 불명확
3개 이상 대안 비교
보안
데이터 무결성
복잡한 디버깅
```

권장:

```text
Opus 또는 동급 deep reasoning
```

고비용 모델은 전체 작업이 아니라 **설계/판단 부분만** 사용한다.

이후 구현은 Sonnet/Codex로 넘긴다.

---

# 16. 모델별 기본 역할

## Sonnet

기본 Builder.

사용:

```text
일반 구현
리팩터링
API
React
Node
테스트
기존 패턴 확장
```

프로젝트의 기본 모델로 우선 사용한다.

---

## Opus

Architect / Critical Reasoner.

사용:

```text
복잡한 architecture
금융 회계 설계
상태 머신
대규모 리팩터링 판단
복잡한 실패 분석
security-critical design
```

단순 코딩에는 사용하지 않는다.

---

## Gemini / Antigravity

Red Team / Independent Analyst.

사용:

```text
edge case
대안 설계
수학 검산
알고리즘 비교
대규모 context review
test gap 분석
```

주 구현자로 기본 사용하지 않는다.

---

## Codex

Reviewer / Local Fixer.

사용:

```text
diff review
bug localization
국소 patch
test-driven correction
repository code reasoning
```

전체 아키텍처 결정은 기본 역할이 아니다.

---

# 17. 비용 최적화 라우팅

항상 가장 저렴하게 성공 가능한 모델부터 사용한다.

```text
Simple
→ cheap model

Standard
→ Sonnet

Complex
→ Sonnet + Antigravity review

Critical
→ Opus plan
  + Antigravity red team
  + Sonnet build
  + Codex review
```

다음 패턴 금지:

```text
Opus로 파일 검색
Opus로 boilerplate 생성
여러 고비용 모델이 같은 코드를 중복 구현
모든 Agent에게 전체 repository 전달
```

---

# 18. Escalation Rule

저비용 모델이 실패하면 단계적으로 승격한다.

```text
Tier 1 model
  ↓ failure
Sonnet
  ↓ unresolved
Codex / Antigravity independent analysis
  ↓ unresolved
Opus
```

처음부터 최고비용 모델을 사용하지 않는다.

---

# 19. Context 최소화

각 Agent에게 필요한 파일만 제공한다.

예:

Architect:

```text
requirements
interfaces
critical modules
```

Antigravity:

```text
design
relevant code
tests
known risks
```

Builder:

```text
target files
dependencies
acceptance criteria
```

Codex:

```text
git diff
test failures
contracts
```

Verifier:

```text
acceptance criteria
diff summary
test results
git status
```

---

# 20. GATE 실행 규칙

현재 프로젝트는 Gate 단위로 관리한다.

각 Gate:

```text
PLAN
→ RED TEAM
→ BUILD
→ TEST
→ REVIEW
→ FIX
→ VERIFY
```

완료 상태:

```text
READY_FOR_GATE_REVIEW: YES
```

에서 자동 작업을 멈춘다.

사용자 승인 전 commit 금지.

---

# 21. 현재 프로젝트 기준

현재 승인된 기준:

```text
GATE 5J
Commit:
76c9f972134124d4efc4e82346641f15a6a2a497
```

다음:

```text
GATE 5K
Cash / Position / Equity Ledger
```

GATE 5K는 TIER 4 / CRITICAL로 분류한다.

따라서:

```text
Opus/Deep Planner
→ Antigravity Red Team
→ Sonnet/Cursor Builder
→ Independent Test
→ Codex Review
→ Fix
→ Full Regression
→ Final Verify
```

순으로 실행한다.

Commit은 자동 실행하지 않는다.
