# App Store Connect · TestFlight 실기기 테스트 가이드

## 1. 사전 준비 (Apple)

| 항목 | 값 |
|------|-----|
| **Bundle ID** | `com.alpha.trading.ios` |
| **앱 이름** | ALPHA TRADING |
| **Team ID** | `VWAZ3CVW5Z` (Signing.xcconfig에 설정됨) |
| **최소 iOS** | 16.0 |
| **카테고리** | 금융 (Finance) |

### Apple Developer Program
1. [developer.apple.com](https://developer.apple.com) 로그인
2. **Certificates, Identifiers & Profiles** → **Identifiers** → **+**
3. **App IDs** → Bundle ID: `com.alpha.trading.ios` 등록

### App Store Connect 앱 등록
1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) 로그인
2. **앱** → **+** → **새로운 앱**
3. 입력:
   - 플랫폼: iOS
   - 이름: `ALPHA TRADING`
   - 기본 언어: 한국어
   - 번들 ID: `com.alpha.trading.ios`
   - SKU: `alpha-trading-ios` (임의 고유값)
   - 사용자 액세스: 전체 액세스

---

## 2. Xcode 서명 설정 (최초 1회)

프로젝트를 엽니다:

```bash
open AlphaTradingIOS/AlphaTrading.xcodeproj
```

1. 왼쪽 **AlphaTrading** 타깃 선택
2. **Signing & Capabilities** 탭
3. **Automatically manage signing** ✅
4. **Team**: `Sangkyoun An` (또는 본인 팀) 선택
5. Bundle Identifier: `com.alpha.trading.ios` 확인

> Team ID는 `Config/Signing.xcconfig`에 이미 설정되어 있습니다.

---

## 3. API 설정 (Release 빌드)

웹앱과 동일한 `.env.local` 사용:

```bash
cd ~/Desktop/alpha-trading-system-gemini
npm run sync:ios:release
```

---

## 4. Archive & TestFlight 업로드

### 방법 A — Xcode (권장)

1. 상단 디바이스: **Any iOS Device (arm64)** 선택 (시뮬레이터 X)
2. **Product → Archive**
3. Archive 완료 후 **Organizer** 창:
   - **Distribute App**
   - **App Store Connect** → **Upload**
   - 옵션 기본값 유지 → **Upload**
4. App Store Connect → **TestFlight** 탭
5. 빌드 처리 완료 후 (10~30분):
   - **내부 테스트** → 테스터 추가 (본인 Apple ID)
   - iPhone에 **TestFlight** 앱 설치 → 초대 수락 → 설치

### 방법 B — CLI 스크립트

```bash
cd ~/Desktop/alpha-trading-system-gemini
npm run archive:ios
```

생성된 IPA: `AlphaTradingIOS/build/export/AlphaTrading.ipa`

**Transporter** 앱(macOS)으로 IPA 드래그 앤 드롭 업로드.

---

## 5. App Store Connect 필수 입력 (첫 업로드 후)

TestFlight 내부 테스트는 아래가 비어 있어도 가능하지만, **외부 테스트** 전에 필요합니다.

| 항목 | 권장 내용 |
|------|-----------|
| **암호화** | 표준 암호화만 사용 → **아니오** (Info.plist에 설정됨) |
| **개인정보 처리방침 URL** | 웹앱 호스팅 URL 또는 Notion 페이지 |
| **앱 설명** | AI 기반 국내 주식 정보·분석 앱 (투자 권유 아님) |
| **연령 등급** | 17+ (금융 정보) |
| **스크린샷** | iPhone 6.7" (1290×2796) 최소 3장 |

### TestFlight 베타 앱 설명 (예시)

```
ALPHA TRADING은 국내 주식 시세, 차트, AI 분석을 제공하는 정보 앱입니다.
투자 권유·매매 대행을 하지 않으며, 모든 투자 결정은 사용자 책임입니다.
```

---

## 6. 실기기 테스트 체크리스트

- [ ] 온보딩 면책 동의
- [ ] 대시보드 KOSPI/KOSDAQ 로딩
- [ ] 종목 검색 · 차트 · 기술분석
- [ ] 업종별 검색
- [ ] 스크리너 / US·CRYPTO
- [ ] 알림 권한 · 알림 등록
- [ ] AI 리포트 (Render GEMINI_API_KEY 필요)
- [ ] 셀룰러/Wi-Fi 모두 동작
- [ ] Render 콜드 스타트 시 재시도

---

## 7. 빌드 번호 올리기 (재업로드 시)

TestFlight에 같은 빌드 번호는 업로드 불가. `Config/Release.xcconfig` 수정:

```
CURRENT_PROJECT_VERSION = 2
```

또는 Xcode → Target → General → **Build** 숫자 증가 후 다시 Archive.

---

## 8. Render 서버 (실기기 API)

실기기는 `https://alpha-trading-server.onrender.com` 사용 (Release xcconfig).

| 변수 | 필수 |
|------|------|
| `KIS_APP_KEY` / `KIS_APP_SECRET` | ✅ |
| `GEMINI_API_KEY` | AI 기능 |
| `APP_API_KEY` | 보안 강화 시 |

---

## 9. 문제 해결

| 오류 | 해결 |
|------|------|
| No signing certificate | Xcode → Settings → Accounts → Download Manual Profiles |
| Bundle ID mismatch | App Store Connect와 Xcode Bundle ID 일치 확인 |
| Missing app icon | `AppIcon-1024.png` 포함 여부 확인 |
| 401 AI/알림 | Render `APP_API_KEY` + `.env.local` `VITE_APP_API_KEY` 동기화 |
| Archive 회색 | Any iOS Device 선택 후 Archive |
| `errSecInternalComponent` | 아래 **코드 서명 오류** 참고 |
| Apple Distribution 없음 | Xcode → Settings → Accounts → Manage Certificates → **+ Apple Distribution** |

### 코드 서명 오류 (`errSecInternalComponent`)

CLI·Archive 시 `CodeSign failed: errSecInternalComponent` 가 나면:

> **진단 방법(2026-07-02 확인):** 프로젝트와 무관한 임의 파일에 대해 `codesign --sign <hash> file`을
> 실행해서도 동일하게 실패하면, 이건 프로젝트 설정 문제가 아니라 **이 Mac의 키체인/보안 세션 문제**입니다.
> `fix-codesign-keychain.sh`가 이제 이 프로브를 자동으로 먼저 실행해 알려줍니다.
> 자동화 셸(AI 에이전트 터미널 포함)은 GUI 키체인 "항상 허용" 프롬프트를 띄울 수 없어서
> ACL을 미리 `security set-key-partition-list`로 부여해야만 서명이 통과합니다 — 그래도 안 되면
> Mac 재시작 또는 Xcode GUI Archive(자체 창 세션 보유)로 우회하세요.
>
> **근본 원인 확정(2026-07-02, `security dump-keychain -a` 분석):**
> 1. Apple Development 개인키의 partition list에 `apple:`만 있고 `apple-tool:`(CLI용)이 없음
>    → Xcode GUI 서명은 되지만 터미널 `codesign`은 항상 `errSecInternalComponent`.
> 2. 키체인에 무효 키 항목 존재 (`SecKeychainItemCopyAccess: The specified item is no longer valid`)
>    → 이 경우 ACL 수정(비밀번호 입력)도 실패할 수 있으며, **인증서 재발급이 확실한 해결책**:
>    Xcode → Settings → Accounts에 Apple ID 로그인 → Manage Certificates에서 기존
>    Apple Development 삭제 후 재생성 + Apple Distribution 추가.
> 3. `set-key-partition-list`는 Mac 로그인 비밀번호가 반드시 필요 (비밀번호 없는 우회 불가).

**1) Apple Distribution 인증서 추가 (TestFlight 필수)**

1. Xcode → **Settings** (⌘,) → **Accounts**
2. Apple ID 선택 → **Manage Certificates…**
3. **+** → **Apple Distribution** 추가

**2) 키체인 ACL 수정**

터미널에서 (Mac 로그인 비밀번호 필요):

```bash
bash AlphaTradingIOS/scripts/fix-codesign-keychain.sh
```

**3) Xcode GUI로 Archive (가장 안정적)**

1. **Any iOS Device (arm64)** 선택
2. **Product → Archive**
3. Organizer → **Distribute App** → App Store Connect → Upload

**4) 더블클릭 배포 스크립트**

Finder에서 `AlphaTradingIOS/scripts/deploy-testflight.command` 실행
(키체인 허용 창이 뜨면 **항상 허용**)

---

## 10. 관련 파일

| 파일 | 역할 |
|------|------|
| `Config/Signing.xcconfig` | Team ID |
| `Config/Generated.xcconfig` | API URL (자동) |
| `ExportOptions.plist` | IPA 업로드 옵션 |
| `scripts/archive-testflight.sh` | CLI Archive |
| `scripts/deploy-testflight.command` | 더블클릭 배포 |
| `scripts/fix-codesign-keychain.sh` | 서명 키체인 ACL 수정 |
| `GITHUB_SETUP.md` (루트) | GitHub Actions · Secrets 설정 |
