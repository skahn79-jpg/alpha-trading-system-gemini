# GitHub 설정 가이드

저장소: `https://github.com/skahn79-jpg/alpha-trading-system-gemini`

이 문서는 GitHub Actions CI/CD, Secrets, Render/Firebase 연동을 한 번에 설정하는 방법을 설명합니다.

---

## 1. 저장소 기본 구조

| 워크플로 | 파일 | 트리거 | 역할 |
|----------|------|--------|------|
| **CI** | `.github/workflows/ci.yml` | `main` push / PR | 웹 빌드 + iOS 시뮬레이터 빌드 |
| **TestFlight** | `.github/workflows/ios-testflight.yml` | 수동 실행 / `ios/v*` 태그 | Archive → TestFlight 업로드 |

---

## 2. GitHub Secrets 등록

**저장소 → Settings → Secrets and variables → Actions → New repository secret**

### iOS TestFlight (필수 6개)

| Secret 이름 | 설명 | 얻는 방법 |
|-------------|------|-----------|
| `IOS_DIST_SIGNING_CERTIFICATE_BASE64` | Distribution .p12 (Base64) | Keychain Access에서 Apple Distribution보내기 |
| `IOS_DIST_SIGNING_CERTIFICATE_PASSWORD` | .p12 비밀번호 |보낼 때 설정한 비밀번호 |
| `IOS_KEYCHAIN_PASSWORD` | CI 임시 키체인 비밀번호 | 임의 문자열 (`openssl rand -base64 32`) |
| `ASC_API_KEY_ID` | App Store Connect API Key ID | App Store Connect → 사용자 및 액세스 → 키 |
| `ASC_ISSUER_ID` | Issuer ID | 동일 페이지 상단 |
| `ASC_API_PRIVATE_KEY` | `.p8` 파일 **전체 내용** | API 키 생성 시 1회 다운로드 |

> API 키 권한: **Developer** 또는 **App Manager** (TestFlight 업로드 가능)

### 로컬 준비 스크립트 (권장)

Mac에서 Distribution 인증서와 API Key를 준비한 뒤:

```bash
bash scripts/prepare-github-ios-secrets.sh
```

생성된 `.github-secrets-export/` 폴더의 값을 GitHub Secrets에 복사합니다.  
**이 폴더는 git에 올리지 마세요.**

### 공통 (선택)

| Secret | 용도 |
|--------|------|
| `APP_API_KEY` | iOS 앱 API 인증 (Render `APP_API_KEY`와 동일) |
| `VITE_API_URL` | 미설정 시 `https://alpha-trading-server.onrender.com` 사용 |

---

## 3. Apple Distribution 인증서 (최초 1회)

Xcode에 Distribution 인증서가 없으면 CI Archive가 실패합니다.

1. Xcode → **Settings** (⌘,) → **Accounts**
2. Apple ID → **Manage Certificates…**
3. **+** → **Apple Distribution** 추가

이후 Keychain Access에서 `.p12`로보내 GitHub Secret에 등록합니다.

---

## 4. 워크플로 실행 방법

### CI (자동)

`main` 브랜치에 push하거나 PR을 열면 자동 실행됩니다.

- ✅ `npm run build` (웹)
- ✅ iOS Simulator 빌드

### TestFlight (수동)

1. GitHub → **Actions** → **iOS TestFlight**
2. **Run workflow** → Branch: `main`
3. (선택) 빌드 번호 입력 — TestFlight 재업로드 시 증가 필요
4. **Run workflow** 클릭

또는 태그로 자동 배포:

```bash
git tag ios/v1.0.0-build2
git push origin ios/v1.0.0-build2
```

### 배포 확인

1. [App Store Connect](https://appstoreconnect.apple.com) → **TestFlight**
2. 빌드 처리 완료(10~30분) 후 내부 테스터 추가
3. iPhone **TestFlight** 앱에서 설치

---

## 5. Render (서버) GitHub 연동

`render.yaml`이 저장소 루트에 있으면 Render가 자동 감지합니다.

1. [render.com](https://render.com) → **New Web Service**
2. GitHub 저장소 `alpha-trading-system-gemini` 연결
3. Branch: `main`, Region: Singapore
4. **Environment**에 아래 변수 수동 입력 (`sync: false` 항목):

| 변수 | 필수 |
|------|------|
| `KIS_APP_KEY` / `KIS_APP_SECRET` | ✅ |
| `DART_API_KEY` | ✅ |
| `GEMINI_API_KEY` | AI 기능 |
| `APP_API_KEY` | 보안 강화 |
| `ALERT_CHECK_SECRET` | 알림 크론 |
| `ALLOWED_ORIGIN` | Firebase Hosting URL |

`main` push 시 Render가 자동 재배포됩니다.

---

## 6. Firebase Hosting (선택)

웹 클라이언트를 GitHub Actions로 배포하려면:

1. Firebase CLI 토큰 발급: `firebase login:ci`
2. GitHub Secret `FIREBASE_TOKEN` 등록
3. (필요 시) `.github/workflows/firebase-hosting.yml` 워크플로 추가

로컬 배포는 기존과 동일:

```bash
npm run build
firebase deploy --only hosting
```

---

## 7. 브랜치 보호 (권장)

**Settings → Branches → Add branch protection rule**

- Branch: `main`
- ✅ Require status checks to pass before merging
- Required checks: `Web build`, `iOS Simulator build`

---

## 8. 문제 해결

| 증상 | 해결 |
|------|------|
| `Missing secret: IOS_*` | GITHUB_SETUP.md 2절 Secrets 6개 등록 |
| `No signing certificate` | Apple Distribution .p12 재보내기 |
| `errSecInternalComponent` (로컬) | `AlphaTradingIOS/scripts/fix-codesign-keychain.sh` |
| TestFlight 빌드 번호 중복 | workflow 입력 또는 `Release.xcconfig`의 `CURRENT_PROJECT_VERSION` 증가 |
| CI Simulator 실패 | `macos-14` 러너의 시뮬레이터 기기명 변경 시 `ci.yml`의 `iPhone 16` 조정 |

---

## 9. 관련 파일

| 파일 | 역할 |
|------|------|
| `.github/workflows/ci.yml` | PR/merge 검증 |
| `.github/workflows/ios-testflight.yml` | TestFlight 자동 업로드 |
| `scripts/prepare-github-ios-secrets.sh` | Secrets 값 준비 |
| `AlphaTradingIOS/TESTFLIGHT.md` | 로컬 Xcode 배포 가이드 |
| `DEPLOY_GUIDE.md` | Render + Firebase 전체 배포 |
