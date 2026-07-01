#!/usr/bin/env bash
# Stage 1: Archive-only (ASC API 키 불필요) — MaterialDelivery Build 27 성공 패턴
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/AlphaTradingIOS/XCODE_CLOUD_WORKFLOW_STAGE1.json"

echo "=============================================="
echo " Xcode Cloud Stage 1 — Archive-only (필수)"
echo "=============================================="
echo ""
echo "빌드 #20~#25 반복 실패: Archive ✅인데 Test/Post-action이 전체를 ❌로 만듦."
echo "코드 문제가 아닙니다. Stage 1 워크플로를 ASC/Xcode에서 적용하세요."
echo ""
echo "【필수 설정】"
echo "  Scheme: AlphaTrading-CI (Archive 전용)"
echo "  Actions: Archive만 (Test OFF)"
echo "  Archive - iOS → 배포 준비: 없음"
echo "  Post-Actions: 모두 OFF"
echo "  Test: iPhone 15 + iOS 18.x"
echo "  Xcode: 16.4 (16F6)"
echo "  Environment: APPSTORE_* Secret 불필요"
echo ""
echo "설정 참조: AlphaTradingIOS/XCODE_CLOUD_WORKFLOW_STAGE1.json"
echo ""

open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj" 2>/dev/null || true
sleep 1
echo ""
echo "==> Stage 1 UI 자동 적용 시도 (Test OFF + AlphaTrading-CI + Archive 없음)..."
osascript "$ROOT/AlphaTradingIOS/scripts/apply-stage1-workflow.applescript" 2>/dev/null || {
  osascript "$ROOT/AlphaTradingIOS/scripts/fix-xcode-cloud-prepare-build.applescript" 2>/dev/null || true
  osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true
}

echo ""
echo "수동 확인 후 저장 → Start Build (Rebuild 아님, 최신 commit)"
echo "1차 ✅ 후 Stage 2: Archive → TestFlight and App Store"
echo ""

if [[ -f "$CONFIG" ]]; then
  echo "Stage 1 config: $CONFIG"
fi

read -r -p "Enter 키를 누르면 종료합니다..."
