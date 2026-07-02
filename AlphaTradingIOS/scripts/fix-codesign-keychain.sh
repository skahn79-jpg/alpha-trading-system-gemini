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

IDENTITIES="$(security find-identity -v -p codesigning || true)"
echo "$IDENTITIES"
echo ""

if ! echo "$IDENTITIES" | grep -q "Apple Distribution"; then
  echo "⚠️  Apple Distribution 인증서가 없습니다. TestFlight/App Store Archive에는 필수입니다."
  echo "   Xcode → Settings (⌘,) → Accounts → Apple ID 선택 → Manage Certificates… → + → Apple Distribution"
  echo "   (Apple ID가 로그인되어 있지 않으면 먼저 + 로 계정을 추가하세요)"
  echo ""
fi

if ! defaults read com.apple.dt.Xcode IDEProvisioningTeams >/dev/null 2>&1; then
  echo "⚠️  Xcode에 로그인된 Apple ID가 없습니다. Automatic signing이 인증서를 발급/갱신할 수 없습니다."
  echo "   Xcode → Settings (⌘,) → Accounts → + → Apple ID로 로그인하세요."
  echo ""
fi

echo "빠른 서명 테스트 (임시 파일, 프로젝트와 무관)..."
TMP_SIGN_TEST="$(mktemp)"
echo "codesign-probe" > "$TMP_SIGN_TEST"
FIRST_IDENTITY_HASH="$(echo "$IDENTITIES" | grep -m1 -oE '[A-F0-9]{40}' || true)"
if [[ -n "$FIRST_IDENTITY_HASH" ]] && /usr/bin/codesign --force --sign "$FIRST_IDENTITY_HASH" "$TMP_SIGN_TEST" >/tmp/alpha-codesign-probe.log 2>&1; then
  echo "✅ 임의 파일 서명 성공 — 키체인 자체는 정상입니다."
else
  echo "❌ 임의 파일 서명도 실패 (errSecInternalComponent 등) — 프로젝트와 무관한 키체인/보안 세션 문제입니다."
  cat /tmp/alpha-codesign-probe.log 2>/dev/null || true
fi
rm -f "$TMP_SIGN_TEST"
echo ""

PW="${CI_KEYCHAIN_PASSWORD:-${ALPHA_CI_KEYCHAIN_PASSWORD:-}}"
if [[ -n "$PW" ]]; then
  echo "CI_KEYCHAIN_PASSWORD provided; using it to unlock the keychain."
else
  if [[ -t 0 ]]; then
    read -r -s -p "Mac 로그인 비밀번호: " PW
    echo ""
  else
    echo "⚠️  자동 실행을 위해 CI_KEYCHAIN_PASSWORD 또는 ALPHA_CI_KEYCHAIN_PASSWORD를 설정하세요."
    echo "   예: CI_KEYCHAIN_PASSWORD='비밀번호' bash $0"
    exit 1
  fi
fi

security unlock-keychain -p "$PW" "$KEYCHAIN" 2>/dev/null || true
ACL_OUT="$(security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KEYCHAIN" 2>&1)" || ACL_FAILED=1
if echo "$ACL_OUT" | grep -q "no longer valid"; then
  echo ""
  echo "❌ 키체인에 손상된(무효) 키 항목이 있습니다: 'The specified item is no longer valid'"
  echo "   이 경우 ACL 수정으로 해결되지 않습니다. 인증서를 재발급하세요:"
  echo "   1) Xcode → Settings (⌘,) → Accounts → Apple ID 로그인 (없으면 + 로 추가)"
  echo "   2) Manage Certificates… → 기존 Apple Development 우클릭 → Delete Certificate"
  echo "   3) + → Apple Development 재생성, + → Apple Distribution 추가"
  echo "   4) 이 스크립트 재실행"
  exit 1
elif [[ "${ACL_FAILED:-0}" == "1" ]]; then
  echo "❌ set-key-partition-list 실패 (비밀번호 오류 가능):"
  echo "$ACL_OUT" | tail -3
  exit 1
fi

echo ""
echo "빠른 재검증 (임의 파일 서명)..."
TMP_SIGN_TEST2="$(mktemp)"
echo "codesign-probe-2" > "$TMP_SIGN_TEST2"
if [[ -n "$FIRST_IDENTITY_HASH" ]] && /usr/bin/codesign --force --sign "$FIRST_IDENTITY_HASH" "$TMP_SIGN_TEST2" >/tmp/alpha-codesign-probe2.log 2>&1; then
  PROBE2_OK=1
  echo "✅ ACL 수정 후 서명 성공."
else
  PROBE2_OK=0
  echo "❌ ACL 수정 후에도 서명 실패."
  cat /tmp/alpha-codesign-probe2.log 2>/dev/null || true
fi
rm -f "$TMP_SIGN_TEST2"

if [[ "$PROBE2_OK" == "0" ]]; then
  echo ""
  echo "⚠️  키체인 ACL 수정으로 해결되지 않았습니다. 이 경우 GUI 보안 세션이 없는 셸(자동화 도구·AI 에이전트 터미널 포함)에서"
  echo "   실행 중이면 macOS가 '항상 허용' 키체인 프롬프트를 띄울 수 없어 계속 errSecInternalComponent가 납니다."
  echo "   다음을 시도하세요:"
  echo "  1) Mac을 재시작한 뒤 이 스크립트를 다시 실행 (securityd 상태 초기화, 가장 흔한 해결책)"
  echo "  2) Xcode GUI에서 직접 Archive: Any iOS Device 선택 → Product → Archive"
  echo "     (Xcode는 자체 창 세션이 있어 키체인 '항상 허용' 프롬프트를 띄울 수 있습니다)"
  echo "  3) Finder에서 scripts/deploy-testflight.command 더블클릭 실행 (동일 이유로 더 안정적)"
  echo ""
fi

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
