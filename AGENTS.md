# AGENTS.md — Cursor Native Multi-Agent Orchestration

## 0. 목적

이 저장소에서는 Cursor에서 실제 호출 가능한 sub-agent만 사용하여 자동 오케스트레이션을 수행한다.

외부 Agent인 Gemini Antigravity와 Codex는 Cursor 내부 자동 호출 대상으로 간주하지 않는다.

현재 확인된 Cursor 호출 가능 Agent:

```text
generalPurpose
explore
shell
cursor-guide
ci-investigator
bugbot
security-review
best-of-n-runner
deep-reasoner
runner
```

외부 Agent:

```text
Gemini Antigravity
Codex
```

는 별도 독립 검증 단계에서만 사용한다.

---

# 1. 기본 실행 구조

사용자가 Gate 작업을 요청하면 다음 순서로 자동 진행한다.

```text
USER TASK
   ↓
CURSOR ORCHESTRATOR
   ↓
TIER CLASSIFICATION
   ↓
PLAN / ANALYSIS
   ↓
RED TEAM
   ↓
IMPLEMENTATION
   ↓
TEST
   ↓
CODE REVIEW
   ↓
FIX
   ↓
FULL REGRESSION
   ↓
FINAL VERIFICATION
   ↓
READY_FOR_GATE_REVIEW
```

Gate 범위 내에서는 각 단계가 끝날 때마다 사용자 확인 없이 다음 단계로 진행한다.

단 다음 작업은 자동 실행하지 않는다.

```text
git add
git commit
git push
git merge
git rebase
git tag
production deployment
paper trading execution
live trading
real order
account-changing operation
```

---

# 2. Orchestrator

기본 Orchestrator:

```text
Cursor parent Agent
```

역할:

* 현재 branch 확인
* HEAD 확인
* git status 확인
* 현재 Gate 판정
* 직전 승인 Gate 확인
* 작업 범위 파악
* TIER 판정
* 필요한 sub-agent 선택
* file ownership 지정
* handoff 관리
* 테스트 관리
* fallback 관리
* 최종 결과 취합

---

# 3. TIER 자동 분류

## TIER 1 — TRIVIAL

예:

```text
오타
문서 수정
rename
주석
format
한 줄 수정
```

실행:

```text
generalPurpose
→ runner
```

---

## TIER 2 — STANDARD

예:

```text
단일 함수
작은 API
UI component
기존 validation 확장
간단한 bug fix
국소 refactoring
```

실행:

```text
generalPurpose
→ runner
→ bugbot
```

---

## TIER 3 — COMPLEX

예:

```text
복수 모듈 수정
새 상태 머신
새 pipeline
데이터 contract 변경
인증/권한
백테스트 lifecycle
복잡한 API 연계
```

실행:

```text
deep-reasoner
→ best-of-n-runner
→ generalPurpose
→ runner
→ bugbot
→ runner(full regression)
```

---

## TIER 4 — CRITICAL

다음 중 하나라도 해당:

```text
financial accounting
portfolio
capital constraint
performance metrics
broker/order
security
authorization
data integrity
production deployment
paper/live trading
critical state machine
benchmark/alpha
walk-forward/OOS
```

실행:

```text
deep-reasoner
→ best-of-n-runner
→ generalPurpose
→ runner
→ bugbot
→ security-review (해당 시)
→ ci-investigator (실패 시)
→ Fixer
→ runner full regression
→ Final Verification
```

TIER 4에서는 최소 하나의 구현 Agent와 별도 review Agent가 존재해야 한다.

---

# 4. Agent 역할

## deep-reasoner

역할:

```text
Architecture
Complex reasoning
State machine
Accounting contract
Error contract
Invariant
Acceptance criteria
Risk prioritization
```

실제 구현은 최소화한다.

출력:

```text
PLAN
INVARIANTS
ERROR_CONTRACT
ACCEPTANCE_CRITERIA
OUT_OF_SCOPE
RISKS
```

---

## best-of-n-runner

역할:

```text
Red Team
Alternative design comparison
Edge case discovery
Failure scenario generation
Test gap analysis
```

주 질문:

```text
무엇이 깨질 수 있는가?
어떤 경계값이 빠졌는가?
silent fallback이 있는가?
기존 contract를 깨는가?
테스트가 구현을 과도하게 따라가는가?
```

코드는 기본적으로 수정하지 않는다.

---

## explore

역할:

```text
repository exploration
dependency tracing
call-site search
legacy contract discovery
```

읽기 전용 조사에 우선 사용한다.

---

## generalPurpose

기본 Builder.

역할:

```text
actual implementation
module creation
minimal refactoring
integration
targeted test implementation
```

Planner/Red Team에서 확정한 범위 밖으로 임의 확장하지 않는다.

---

## runner

역할:

```text
unit tests
integration tests
regression
lint
type check
git diff --check
```

테스트 실행 전담으로 우선 사용한다.

---

## bugbot

기본 Code Reviewer.

검토:

```text
logic bug
off-by-one
error swallowing
error contract overwrite
mutation
double counting
rounding
state transition
incorrect fallback
dead code
test/implementation mismatch
non-determinism
```

Finding severity:

```text
BLOCKER
HIGH
MEDIUM
LOW
```

BLOCKER/HIGH만 현재 Gate 자동 수정 대상으로 한다.

---

## security-review

다음 경우에만 호출:

```text
authentication
authorization
session
secret
API key
admin capability
broker access
order access
external input
security boundary
```

일반 백테스트 계산에는 호출하지 않는다.

---

## ci-investigator

호출 조건:

```text
CI failure
test environment discrepancy
build failure
local PASS / CI FAIL
dependency issue
```

정상 테스트에는 호출하지 않는다.

---

## shell

명령 실행 보조.

직접적인 설계 판단 역할로 사용하지 않는다.

---

## cursor-guide

Cursor 자체 기능/설정 확인이 필요한 경우에만 사용한다.

---

# 5. File Ownership

한 시점에 같은 파일을 두 Agent가 동시에 수정하지 않는다.

예:

```text
portfolio-ledger.js
WRITE_OWNER = generalPurpose

portfolio-ledger.test.js
WRITE_OWNER = test/generalPurpose
```

Review Agent는 읽기 전용.

---

# 6. Handoff Protocol

각 sub-agent는 종료 시 다음을 남긴다.

```text
TASK_ID:
GATE:
ROLE:
SUBAGENT:
STATUS:
WORK_COMPLETED:
FILES_READ:
FILES_CHANGED:
TESTS_RUN:
TEST_RESULT:
RISKS:
BLOCKERS:
OPEN_ISSUES:
NEXT_ROLE:
NEXT_ACTION:
```

다음 Agent는 이전 결과를 읽고 이어서 진행한다.

---

# 7. 자동 실행

다음 흐름은 자동이다.

```text
deep-reasoner PASS
→ best-of-n-runner

Red Team 완료
→ Builder

Build 완료
→ runner

Target tests PASS
→ bugbot

BLOCKER/HIGH 있음
→ Fix

Fix
→ affected tests
→ full regression

Full regression PASS
→ Final Verification
```

---

# 8. 실패 Loop

테스트 실패:

```text
FAIL
→ root cause analysis
→ smallest safe fix
→ affected tests
→ regression
```

동일 root cause로 최대 3회.

3회 실패 시:

```text
REPEATED_FAILURE
```

로 종료하고 상세 보고한다.

---

# 9. 테스트 정책

순서:

```text
affected unit
→ related integration
→ full npm test
→ lint/type/static
→ git diff --check
→ git status
```

금지:

```text
기존 테스트 삭제
assert 약화
skip 추가
validation 제거
error contract 약화
테스트 통과용 fallback 추가
```

---

# 10. Error Contract

root error와 stage status를 분리한다.

예:

```text
rootError = COST_POLICY_MARKET_MISMATCH
stageStatus = COST_STAGE_FAILED
failedStage = COST
```

상위 계층은 구체적인 root error를 generic error로 덮지 않는다.

---

# 11. Determinism

Backtest 계층에서 금지:

```text
Math.random()
Date.now()
random UUID
현재시각 기반 결과
locale-dependent ordering
implicit timezone parsing
```

동일 입력은 동일 결과를 생성한다.

---

# 12. Financial Safety Boundary

Synthetic/backtest Gate에서는 기본:

```text
real data calls = 0
network calls = 0
KB API calls = 0
real quote calls = 0
order calls = 0
```

별도 승인 없는 한 유지한다.

---

# 13. Git Boundary

Gate 구현 동안:

```text
git add 금지
git commit 금지
git push 금지
git merge 금지
git rebase 금지
git tag 금지
```

`READY_FOR_GATE_REVIEW: YES` 이후에도 자동 commit하지 않는다.

사용자 승인 필요.

---

# 14. 외부 Agent 처리

Cursor 내부에서 다음을 실제 호출하려 하지 않는다.

```text
Antigravity
Codex
```

`subagent_type="antigravity"`
`subagent_type="codex"`

사용 금지.

Cursor 내부 review는:

```text
best-of-n-runner
bugbot
deep-reasoner
```

를 사용한다.

Antigravity/Codex 별도 검증이 필요한지는 최종 보고에 다음 형태로 제안한다.

```text
EXTERNAL_REVIEW_RECOMMENDATION:
Antigravity:
REQUIRED / OPTIONAL / NOT_REQUIRED
Codex:
REQUIRED / OPTIONAL / NOT_REQUIRED
Reason:
...
```

---

# 15. Orchestration Log

각 Gate 최종 보고에는 반드시 기록:

```text
GATE:
TIER:
SUBAGENTS_REQUESTED:
SUBAGENTS_USED:
Planner:
Red Team:
Builder:
Test:
Reviewer:
Security Review:
CI Investigator:
Fixer:
Final Verifier:
Fallbacks:
Unavailable Agents:
Files Changed:
Tests Added:
Total Tests:
Pass:
Fail:
BLOCKER:
HIGH:
MEDIUM:
LOW:
Network Calls:
Order Calls:
Git Status:
EXTERNAL_REVIEW_RECOMMENDATION:
READY_FOR_GATE_REVIEW:
```

---

# 16. Final Verification

최종적으로 반드시 확인:

```text
Acceptance criteria
Invariant
Root error contract
Stage contract
Input immutability
Determinism
Safety boundary
Full tests
git diff --check
git status
Network calls
Order calls
```

성공:

```text
READY_FOR_GATE_REVIEW: YES
```

실패:

```text
READY_FOR_GATE_REVIEW: NO
```

---

# 17. 현재 운영 원칙

사용자가:

```text
GATE <번호> 진행
```

이라고만 하면 이 규칙을 자동 적용한다.

필요한 sub-agent를 자동 선택하고 구현·테스트·리뷰·회귀까지 진행한다.

단 commit/push/merge는 수행하지 않는다.
