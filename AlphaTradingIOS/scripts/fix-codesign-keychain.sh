#!/usr/bin/env bash
# iOS 코드 서명 키체인 ACL 수정 (errSecInternalComponent 해결용)
# Mac 로그인 비밀번호가 필요합니다. 터미널에서 직접 실행하세요.
set -euo pipefail

KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
echo "키체인: $KEYCHAIN"
echo "codesign 이 개발 인증서 개인키에 접근할 수 있도록 ACL을 설정합니다."
echo ""
read -r -s -p "Mac 로그인 비밀번호: " PW
echo ""

security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KEYCHAIN"

echo ""
echo "완료. 아래로 서명 테스트:"
security find-identity -v -p codesigning
echo ""
echo "이후 npm run archive:ios 또는 deploy-testflight.command 를 다시 실행하세요."
