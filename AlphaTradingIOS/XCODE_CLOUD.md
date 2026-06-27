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

### A) App Store Connect (웹 — 권장)

1. [App Store Connect](https://appstoreconnect.apple.com) → **ALPHA TRADING**
2. **Xcode Cloud** 탭 → 왼쪽 **워크플로 관리**
3. **Default** (또는 사용 중인 워크플로) → **…** → **편집**
4. **Actions** → **Archive (iOS)** 펼치기:
   - **Deployment Preparation**: **TestFlight and App Store** 선택  
     (Distribution 인증서로 서명 — TestFlight 업로드 필수)
5. **Post-Actions** → **+** → **TestFlight Internal Testing** (내부 테스트) 추가
6. **저장**

### B) Xcode (동일 설정)

```bash
open AlphaTradingIOS/AlphaTrading.xcodeproj
# 또는
osascript AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript
```

1. **Product → Xcode Cloud → Manage Workflows…**
2. **Default** → **Edit Workflow**
3. Archive → **TestFlight and App Store**
4. Post-Actions → **+ TestFlight Internal Testing**
5. **Save**

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
| `ci_post_clone.sh` | 클론 직후 | `npm ci` + `sync-ios-api-config.mjs release` |

Xcode Cloud 빌드 머신에서 `.env.local` 없이도 프로덕션 API URL로 동기화됩니다.

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
| Prepare Build for App Store Connect 실패 | ① `Release.xcconfig`에 `MARKETING_VERSION` 확인 ② [인증서](https://developer.apple.com/account/resources/certificates/list)에서 **Distribution Managed (Xcode Cloud)** 폐기 후 재빌드 ③ 빌드 **로그** → `xcodebuild-export-archive.log` 확인 |

---

## 7. 관련 파일

| 파일 | 역할 |
|------|------|
| `AlphaTradingIOS/ci_scripts/ci_post_clone.sh` | 클론 후 API 동기화 |
| `AlphaTradingIOS/TESTFLIGHT.md` | 로컬 Archive 가이드 |
| `GITHUB_SETUP.md` | GitHub Actions 대안 |
