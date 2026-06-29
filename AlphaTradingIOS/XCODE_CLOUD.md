# Xcode Cloud 설정 가이드

App Store Connect **Xcode Cloud** 탭에서 보이는 화면은 워크플로가 아직 없을 때의 안내입니다.  
아래 순서대로 Xcode에서 워크플로를 **한 번** 만들면 이후 push마다 자동 빌드·TestFlight 배포가 됩니다.

> **GitHub Actions** (`GITHUB_SETUP.md`)와 **Xcode Cloud** 중 하나만 써도 됩니다.  
> Apple 생태계에 익숙하면 Xcode Cloud가 더 간단합니다 (인증서를 Xcode가 관리).

---

## 1. 사전 조건

| 항목 | 상태 |
|------|------|
| App Store Connect 앱 `ALPHA TRADING` | ✅ 등록됨 |
| Bundle ID `com.alpha.trading.ios` | ✅ |
| GitHub 저장소 push | ✅ `cursor/ios-native-app-and-github-ci` (또는 `main` merge 후) |
| `AlphaTradingIOS/ci_scripts/` | ✅ API 동기화 스크립트 포함 |

---

## 2. Xcode / App Store Connect에서 워크플로 + TestFlight 설정

> **MaterialDelivery(성공 사례)와 동일한 3단계 전략**을 사용하세요.  
> 처음부터 TestFlight ON 하면 Prepare Build가 실패할 수 있습니다.

### 단계별 배포 준비 (권장)

| 단계 | Archive → 배포 준비 | Post-Actions |
|------|---------------------|--------------|
| **1차** (Archive 검증) | **없음** | 모두 OFF |
| **2차** (업로드) | **TestFlight and App Store** | TestFlight Internal OFF |
| **3차** (내부 테스트) | **TestFlight and App Store** | **TestFlight Internal Testing** ON |

1차 빌드가 ✅이면 2차로 올리고, TestFlight에 Processing이 보이면 3차를 켭니다.

### A) App Store Connect (웹 — 권장)

1. [App Store Connect](https://appstoreconnect.apple.com) → **ALPHA TRADING**
2. **Xcode Cloud** 탭 → 왼쪽 **워크플로 관리**
3. **Default** (또는 사용 중인 워크플로) → **…** → **편집**
4. **Environment** → Xcode **16.4 (16F6)** (26.x 사용 중이면 변경)
5. **Test** → **iPhone 15** + **iOS 18.x**
6. **Actions** → **Archive (iOS)**:
   - 1차: **Deployment Preparation** = **없음**
   - 2차 이후: **TestFlight and App Store**
7. **Post-Actions** → 3차에서만 **TestFlight Internal Testing** 추가
8. **저장** → **Start Build** (Rebuild 아님, 최신 commit)

### B) Xcode (동일 설정)

```bash
open AlphaTradingIOS/AlphaTrading.xcodeproj
```

1. **Product → Xcode Cloud → Manage Workflows…**
2. **Default** → **Edit Workflow**
3. 위 표와 동일하게 단계별 설정
4. **Save**

### C) TestFlight 테스터 (App Store Connect)

1. **TestFlight** 탭 → **내부 테스트**
2. **+** 그룹 생성 (예: `팀 내부`)
3. **테스터 추가** → 본인 Apple ID (App Store Connect 계정과 동일 이메일)
4. Xcode Cloud 빌드 완료 후 해당 그룹에 **빌드 선택** → 테스터에게 자동 초대

> `Info.plist`에 `ITSAppUsesNonExemptEncryption = false` 설정됨 — 수출 규정 질문 자동 통과.

---

## 2-1. (구) 워크플로 최초 생성

1. App Store Connect → **Xcode Cloud** → **Xcode 열기** 클릭  
   또는 터미널:
   ```bash
   open AlphaTradingIOS/AlphaTrading.xcodeproj
   ```

2. Xcode 상단 메뉴: **Product → Xcode Cloud → Create Workflow…**

3. **GitHub 저장소 연결** (최초 1회)
   - `skahn79-jpg/alpha-trading-system-gemini` 선택
   - 브랜치: `main` (merge 후) 또는 현재 작업 브랜치

4. 워크플로 설정 권장값:

   | 항목 | 값 |
   |------|-----|
   | Name | `Alpha Trading TestFlight` |
   | Primary Repository | `alpha-trading-system-gemini` |
   | Project/Scheme | `AlphaTrading` |
   | Platform | iOS |
   | Actions | **Archive** ✅ |
   | Post-Actions | **TestFlight Internal Testing** ✅ (선택) |

5. **Environment** (선택 — API 키 사용 시):
   | 변수 | 값 |
   |------|-----|
   | `VITE_API_URL` | `https://alpha-trading-server.onrender.com` |
   | `APP_API_KEY` | Render와 동일 (비밀) |

6. **Start Build** 또는 저장 후 자동 트리거 확인

---

## 3. ci_scripts 동작

| 스크립트 | 시점 | 역할 |
|----------|------|------|
| `ci_post_clone.sh` | 클론 직후 | `Generated.xcconfig` 생성 + (가능 시) npm sync |
| `ci_pre_xcodebuild.sh` | xcodebuild 직전 | API 설정 검증·동기화 |
| `ci_post_xcodebuild.sh` | Archive 직후 | (선택) ASC API 키 있으면 iTMSTransporter 수동 업로드 |

> **MaterialDelivery 성공 패턴 (권장):** ASC API 키 **불필요**.  
> 1차 **배포 준비 = 없음** → 2차 **TestFlight and App Store** → 3차 **Internal Testing**.  
> Xcode Cloud가 자체 인증으로 업로드합니다 (`VWAZ3CVW5Z` 동일 팀).

> **ASC API 키** (`APPSTORE_*`)는 401이 나도 **Xcode Cloud 자동 배포와 무관**합니다.  
> 수동 IPA 업로드(`upload-ipa-testflight.sh`)할 때만 필요합니다.

---

## 4. 빌드 후 확인

1. **Xcode** → Report navigator → Cloud 탭에서 빌드 로그
2. **App Store Connect** → **TestFlight** → 빌드 처리 (10~30분)
3. **내부 테스트** → 본인 Apple ID 추가 → iPhone TestFlight 앱 설치

---

## 5. GitHub Actions vs Xcode Cloud

| | GitHub Actions | Xcode Cloud |
|--|----------------|-------------|
| 설정 | Secrets 6개 수동 | Xcode GUI, 인증서 자동 |
| 트리거 | push / 수동 / 태그 | push / PR / 수동 |
| 비용 | GitHub 무료 한도 | Apple 25시간/월 무료 |
| 가이드 | `GITHUB_SETUP.md` | 이 문서 |

둘 다 켜두면 push 시 **두 번** 빌드될 수 있으니 하나만 사용하는 것을 권장합니다.

---

## 6. 문제 해결

| 증상 | 해결 |
|------|------|
| 워크플로 생성 불가 | Xcode → Settings → Accounts → Apple ID 로그인 확인 |
| GitHub 연결 실패 | GitHub → Settings → Applications → Xcode Cloud 권한 |
| Archive 실패 (서명) | Xcode → Signing → Automatically manage signing |
| API 연결 실패 | Environment에 `VITE_API_URL` 확인 |
| 빌드 번호 중복 | `Release.xcconfig`의 `CURRENT_PROJECT_VERSION` 증가 후 push |
| Prepare Build for App Store Connect 실패 | **§6-1** — `ExportOptions.plist`를 프로젝트 루트에서 제거함 (MaterialDelivery와 동일) |
| Test - iOS: `iPhone 16 is incompatible with iOS 16.4` | 워크플로 Test → **iPhone 15** + **iOS 18.x** (Xcode 16.4 기준). iPhone 16은 iOS 18+ 필요 |

### 6-1. Prepare Build 실패 (빌드 8~20) — **코드 버그 아님**

Archive·Test ✅ 인데 **Prepare Build for App Store Connect** 만 ❌:

**원인:** Xcode Cloud가 App Store Connect에 인증할 때 `Session Proxy Provider` 오류 (Apple 서버/팀 권한 이슈). MaterialDelivery도 **배포 준비 없음**으로 1차 통과 후 TestFlight를 켰습니다.

#### ✅ 해결 1 — 워크플로 변경 (필수, 2분)

```text
Product → Xcode Cloud → Manage Workflows → Edit
→ Archive - iOS → 배포 준비: 없음
→ Post-Actions: 모두 OFF
```

또는 터미널:

```bash
osascript AlphaTradingIOS/scripts/fix-xcode-cloud-prepare-build.applescript
```

→ **Prepare Build 단계 자체가 실행되지 않아** 빌드 전체 ✅

#### ✅ 해결 2 — TestFlight 업로드 (ASC API)

```bash
bash AlphaTradingIOS/scripts/encode-asc-key-for-cloud.sh
```

출력된 3개 Secret을 Workflow → **Environment**에 추가.  
`ci_post_xcodebuild.sh`가 Archive 직후 **iTMSTransporter**로 업로드합니다.

#### ✅ 해결 3 — 수동 (가장 빠름)

빌드 → **아티팩트** → `app-store` IPA → Transporter

### 6-2. 전체 실패 + Archive 오류 1개 (빌드 23)

**증상:** Archive / Prepare Build / `ci_post_xcodebuild` 로그는 ✅인데 빌드 전체 ❌, Archive - iOS에 오류 1개, Test - iOS 진행 중 또는 ❌

**핵심:** `ci_post_xcodebuild.sh`는 **항상 exit 0**입니다. 업로드 실패·export 실패도 Xcode Cloud 전체 상태를 바꾸지 않습니다.

| 단계 | exit code | 빌드 실패 원인? |
|------|-----------|----------------|
| `ci_post_xcodebuild.sh` | **항상 0** | ❌ 아님 |
| Prepare Build for App Store Connect | non-zero | ✅ Archive 하위 오류 1개 |
| Post-action TestFlight Internal Testing | non-zero | ✅ 전체 ❌ |
| Test - iOS | non-zero | ✅ 전체 ❌ |

**TestFlight 업로드 확인 (빌드 ❌여도 업로드됐을 수 있음):**

1. Xcode Cloud Build #23 → **ci_post_xcodebuild** 로그 검색: `SUMMARY upload_succeeded=1`
2. [App Store Connect](https://appstoreconnect.apple.com) → **ALPHA TRADING** → **TestFlight** → `1.0.0` 아래 빌드 **23** Processing 여부
3. 없으면 Artifacts → IPA → Transporter

**다음 자동 조치 (MaterialDelivery Build 25~27 패턴):**

| 우선 | 조치 |
|------|------|
| 1 | Workflow **1차**: Archive 배포 준비 **없음**, Post-actions **모두 OFF** → Start Build (빌드 24) |
| 2 | 1차 ✅ 후 **2차**: 배포 준비 TestFlight and App Store, Internal Testing OFF |
| 3 | Test - iOS 실패 시: Test → **iPhone 15 + iOS 18.x** (Xcode 16.4) |
| 4 | 진단 스크립트: `bash AlphaTradingIOS/scripts/diagnose-xcode-cloud-build.sh` |
| 5 | 로컬 테스트: `bash AlphaTradingIOS/scripts/run-local-ci-preflight.sh` |

**Internal Testing Post-action:** TestFlight에 빌드가 Processing 된 뒤에만 켜세요. Prepare Build와 동시에 켜면 전체 ❌가 자주 납니다.

### 6-3. Archive·Prepare Build ✅ + 전체 ❌ (빌드 25)

**증상:** `Archive - iOS`, `Prepare Build for App Store Connect`, `ci_post_xcodebuild` 로그는 ✅인데 **빌드 전체 ❌**

**왜?** Xcode Cloud는 **Actions**(Test, Archive)와 **Post-Actions**를 별도로 집계합니다. Archive가 성공해도 다른 단계가 실패하면 전체가 ❌입니다.

| 실패 단계 | 전형적 로그 | 원인 |
|-----------|-------------|------|
| **Test - iOS** | `incompatible with iOS`, `Unable to find destination` | 워크플로 Test → iPhone 16 + iOS 16.4 등 **시뮬레이터/OS 불일치** |
| **Post-action TestFlight Internal Testing** | `No builds available`, `build not found` | TestFlight Processing 전에 Internal Testing ON |
| Prepare Build | (빌드 25에서는 통과) | — |
| ci_post_xcodebuild | 항상 exit 0 | **원인 아님** |

**근본 원인 (빌드 25, 우선순위 2개):**

1. **Test - iOS** — 워크플로에 Test action이 켜져 있고, 시뮬레이터/OS가 Xcode 16.4 러너와 맞지 않음 (MaterialDelivery 빌드 25와 동일 패턴의 *후속* 실패)
2. **Post-action TestFlight Internal Testing** — Archive 직후 내부 테스트 배포를 시도하지만 ASC에 해당 빌드가 아직 없음

**영구 수정 (저장소 + 워크플로):**

| 조치 | 내용 |
|------|------|
| **1차 워크플로** | Scheme **`AlphaTrading-CI`** (Test 없음), Actions: **Archive만**, 배포 준비 **없음**, Post-actions **모두 OFF** |
| **대안** | Scheme `AlphaTrading` 유지 시 Test action **OFF**, 또는 Test → **iPhone 15 + iOS 18.x** |
| **스킴** | `AlphaTrading-CI.xcscheme` — Test 타깃 제외, Archive 전용 (로컬 개발은 `AlphaTrading` 사용) |
| **2차** | 배포 준비 TestFlight and App Store, Internal Testing OFF |
| **3차** | TestFlight Processing 확인 후 Internal Testing ON |

```bash
bash AlphaTradingIOS/scripts/fix-xcode-cloud-workflow.command
```

---

## 7. 관련 파일

| 파일 | 역할 |
|------|------|
| `AlphaTradingIOS/ci_scripts/ci_post_clone.sh` | 클론 후 API 설정 |
| `AlphaTradingIOS/ci_scripts/ci_pre_xcodebuild.sh` | 빌드 직전 API 설정 검증 |
| `AlphaTradingIOS/scripts/ExportOptions-export.plist` | GitHub Actions / 로컬 export 전용 |
| `AlphaTradingIOS/scripts/ExportOptions-upload.plist` | 로컬 Transporter 업로드 전용 |
| `AlphaTradingIOS/scripts/upload-ipa-testflight.sh` | 로컬 IPA 업로드 |
| `AlphaTrading.xcodeproj/xcshareddata/xcschemes/AlphaTrading.xcscheme` | 로컬 개발 (Test skipped=YES — Cloud Test 실패 방지) |
| `AlphaTrading.xcodeproj/xcshareddata/xcschemes/AlphaTrading-CI.xcscheme` | **Xcode Cloud 1차** Archive 전용 (Test 없음) |
| `AlphaTradingIOS/scripts/diagnose-xcode-cloud-build.sh` | 빌드 실패 원인 진단 |
| `AlphaTradingIOS/scripts/run-local-ci-preflight.sh` | 로컬 Test+Build 사전 검증 |
| `AlphaTradingIOS/TESTFLIGHT.md` | 로컬 Archive 가이드 |
| `GITHUB_SETUP.md` | GitHub Actions 대안 |
