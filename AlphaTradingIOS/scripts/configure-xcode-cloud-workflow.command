#!/usr/bin/env bash
# Xcode Cloud 워크플로 자동 설정 (Terminal에서 실행 — 접근성 권한 필요)
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=============================================="
echo " Xcode Cloud 자동 설정"
echo " Archive: 배포 준비 없음 | Test: OFF"
echo "=============================================="
echo ""
echo "macOS가 접근성 권한을 물으면 Terminal 을 허용하세요."
echo "시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용"
echo ""

open AlphaTradingIOS/AlphaTrading.xcodeproj
sleep 2

RESULT="$(osascript AlphaTradingIOS/scripts/configure-xcode-cloud-workflow.applescript 2>&1)" || true
echo "$RESULT"

if echo "$RESULT" | grep -q "^OK"; then
  echo ""
  echo "✅ 워크플로 설정 + 빌드 시작 완료"
  exit 0
fi

echo ""
echo "⚠️  자동 설정 실패 — 수동 3클릭:"
echo "  1) 왼쪽 Archive - iOS 클릭"
echo "  2) 배포 준비 → 없음"
echo "  3) 저장"
exit 1
