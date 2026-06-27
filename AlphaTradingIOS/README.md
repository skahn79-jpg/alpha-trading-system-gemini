# ALPHA TRADING iOS (SwiftUI)

Render 백엔드를 사용하는 ALPHA TRADING 네이티브 iOS 앱입니다.

## 요구 사항

- macOS + Xcode 15 이상
- iOS 16 이상
- Render `alpha-trading-server` API

## Xcode에서 열기

```bash
open AlphaTradingIOS/AlphaTrading.xcodeproj
```

1. **Signing & Capabilities** → Apple Developer Team 선택
2. `Config/Secrets.xcconfig` 설정 (아래 참고)
3. 상단 디바이스: **iPhone 17 Pro (Simulator)** 선택 ← 실기기가 아닌 **시뮬레이터**
4. **⌘R** 실행

### CodeSign failed / errSecInternalComponent

**실기기** 또는 **Archive** 빌드 시 키체인 접근 오류가 날 수 있습니다.

| 즉시 해결 | 영구 해결 |
|-----------|-----------|
| 디바이스 메뉴에서 **iOS Simulators → iPhone 17 Pro** 선택 | `scripts/fix-codesign-keychain.command` 더블클릭 |
| | Xcode → Settings → Accounts → Certificates 재생성 |

시뮬레이터 빌드는 서명 없이 동작합니다. TestFlight는 **Xcode Cloud** 또는 Distribution 인증서로 Archive하세요.

## API 키 설정 (웹앱과 자동 동기화)

웹앱과 **동일한** `.env.local` 설정을 iOS가 자동으로 사용합니다.

```bash
# 프로젝트 루트
cp scripts/env.example .env.local
# VITE_API_URL, VITE_APP_API_KEY 입력 (웹앱과 동일)

npm run sync:ios   # 수동 동기화
```

Xcode **빌드 시** `Sync API Config from Web` 스크립트가 자동 실행되어  
`AlphaTradingIOS/Config/Generated.xcconfig` 를 생성합니다.

| 웹 (.env.local) | iOS (Generated.xcconfig) |
|-----------------|--------------------------|
| `VITE_API_URL` | `API_BASE_URL` |
| `VITE_APP_API_KEY` 또는 `APP_API_KEY` | `APP_API_KEY` |

로컬 서버 테스트 시 `.env.local`에 `VITE_API_URL=http://localhost:3001` 설정.

(선택) iOS 전용 오버라이드: `Config/Secrets.xcconfig`

## 앱 기능

| 탭 | 기능 |
|----|------|
| 관심 | 즐겨찾기 종목 + 시세 |
| 종목 | 검색, 업종별 탐색, 상세(차트/기술분석/종합) |
| 대시보드 | KOSPI / KOSDAQ |
| 포트폴리오 | 보유 종목 평가손익 |
| 더보기 | 스크리너, US/CRYPTO, 알림, AI 리포트, 업종 검색 |

## 보안

- **ATS**: HTTPS only (`NSAllowsArbitraryLoads = false`)
- **Certificate Pinning**: `alpha-trading-server.onrender.com` 호스트 검증
- **Keychain**: `APP_API_KEY` 안전 저장
- **API 인증**: `X-App-Key` 헤더 (AI/알림/시뮬레이션)

## TestFlight 배포

자세한 절차: [TESTFLIGHT.md](TESTFLIGHT.md)

## 테스트

```bash
# 서버
node --check server.js && npm run server

# iOS 빌드
cd AlphaTradingIOS && xcodebuild -scheme AlphaTrading \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

## 프로젝트 구조

```
AlphaTradingIOS/
├── AlphaTrading/     # SwiftUI 소스
├── Config/           # xcconfig (Secrets는 gitignore)
├── ExportOptions.plist
├── TESTFLIGHT.md
└── AlphaTrading.xcodeproj
```
