#!/usr/bin/env bash
# 더블클릭 실행 — 키체인 비밀번호 입력 창이 뜨면 허용하세요.
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "ALPHA TRADING iOS → TestFlight 배포"
echo "======================================"
npm run archive:ios
echo ""
echo "완료. App Store Connect → TestFlight 에서 빌드 처리를 확인하세요."
read -r -p "Enter 키를 누르면 종료합니다..."
