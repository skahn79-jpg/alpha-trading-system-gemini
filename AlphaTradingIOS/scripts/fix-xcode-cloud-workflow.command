#!/usr/bin/env bash
# Xcode Cloud 워크플로 수정 안내 + 편집 창 열기
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=============================================="
echo " Xcode Cloud 워크플로 수정"
echo "=============================================="
echo ""
echo "【필수 1】Test - iOS 시뮬레이터"
echo "  기존 행 삭제 (-)"
echo "  + → iPhone 15 → OS: iOS 18.0 이상"
echo "  (iPhone 16 + iOS 16.4 조합은 실패합니다)"
echo ""
echo "【필수 2】Environment"
echo "  Xcode Version: Xcode 16.4 (16F6)"
echo ""
echo "【선택】Environment Variables (Prepare Build 우회 업로드)"
echo "  ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_PRIVATE_KEY"
echo ""
echo "저장 후 App Store Connect → 빌드 시작"
echo ""

open "https://appstoreconnect.apple.com" 2>/dev/null || true
open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj"
sleep 2
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

read -r -p "Enter 키를 누르면 종료합니다..."
