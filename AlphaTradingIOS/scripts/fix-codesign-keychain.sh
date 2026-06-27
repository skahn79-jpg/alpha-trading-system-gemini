#!/usr/bin/env bash
# iOS 코드 서명 키체인 ACL 수정 (errSecInternalComponent 해결용)
set -euo pipefail

KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=============================================="
echo " iOS 코드 서명 키체인 수정"
echo " 오류: CodeSign failed / errSecInternalComponent"
echo "=============================================="
echo ""
echo "키체인: $KEYCHAIN"
echo ""

security find-identity -v -p codesigning || true
echo ""

read -r -s -p "Mac 로그인 비밀번호: " PW
echo ""

security unlock-keychain -p "$PW" "$KEYCHAIN" 2>/dev/null || true
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KEYCHAIN"

echo ""
echo "서명 테스트 (실기기 Debug 빌드)..."
cd "$IOS_DIR"
if xcodebuild -project AlphaTrading.xcodeproj \
  -scheme AlphaTrading \
  -destination 'generic/platform=iOS' \
  -configuration Debug \
  -allowProvisioningUpdates \
  build >/tmp/alpha-codesign-test.log 2>&1; then
  echo "✅ 실기기 빌드 성공 — Xcode에서 다시 ⌘R 하세요."
else
  echo "❌ 아직 실패. 로그: /tmp/alpha-codesign-test.log"
  tail -5 /tmp/alpha-codesign-test.log || true
  echo ""
  echo "다음 단계:"
  echo "  1) Xcode → Settings → Accounts → Manage Certificates"
  echo "     → Apple Development 삭제 후 + 로 재생성"
  echo "  2) + Apple Distribution 추가 (TestFlight용)"
  echo "  3) Xcode 상단에서 'iPhone 17 Pro' 시뮬레이터 선택 후 ⌘R (임시)"
fi
